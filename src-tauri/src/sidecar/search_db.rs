use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use lancedb::connection::Connection;
use lancedb::query::{ExecutableQuery, QueryBase};
use arrow_array::{RecordBatch, StringArray, FixedSizeListArray};
use arrow_array::types::Float32Type;
use arrow_schema::{DataType, Field, Schema};
use serde_json::Value;
use futures_util::TryStreamExt;
use crate::sidecar::storage::get_data_dir;

pub struct SearchDb {
    conn: Connection,
    table_name: String,
    /// Set to true once we know the table has at least one row.
    /// Avoids a `count_rows` disk round-trip on every search once data exists.
    has_rows: AtomicBool,
}

impl SearchDb {
    pub async fn new() -> Result<Self, lancedb::Error> {
        let db_dir = get_data_dir().join("lancedb");
        if !db_dir.exists() {
            std::fs::create_dir_all(&db_dir).map_err(|e| lancedb::Error::Runtime { message: e.to_string() })?;
        }
        
        let db_uri = db_dir.to_str().unwrap_or("sync-data/lancedb");
        let conn = lancedb::connect(db_uri).execute().await?;
        let table_name = "search_index".to_string();
        
        let mut db = Self { conn, table_name, has_rows: AtomicBool::new(false) };
        db.ensure_table().await?;
        // Check if the table already has data from a previous run so we skip count_rows on first search.
        if let Ok(tbl) = db.conn.open_table(&db.table_name).execute().await {
            if let Ok(count) = tbl.count_rows(None).await {
                if count > 0 {
                    db.has_rows.store(true, Ordering::Relaxed);
                }
            }
        }
        Ok(db)
    }

    async fn ensure_table(&self) -> Result<(), lancedb::Error> {
        let table_names = self.conn.table_names().execute().await?;
        if table_names.contains(&self.table_name) {
            return Ok(());
        }

        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Utf8, false),
            Field::new("type", DataType::Utf8, false),
            Field::new("title", DataType::Utf8, false),
            Field::new("content", DataType::Utf8, true),
            Field::new("url", DataType::Utf8, true),
            Field::new("metadata", DataType::Utf8, true),
            Field::new("search_text", DataType::Utf8, false),
            Field::new("vector", DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), 128), true),
        ]));

        // Create empty table with schema
        self.conn.create_empty_table(&self.table_name, schema).execute().await?;
        
        // Add Full Text Search index on search_text column
        let table = self.conn.open_table(&self.table_name).execute().await?;
        table.create_index(&["search_text"], lancedb::index::Index::FTS(Default::default())).execute().await?;

        Ok(())
    }

    pub async fn upsert_item(&self, 
        id: &str, 
        item_type: &str, 
        title: &str, 
        content: Option<&str>, 
        url: Option<&str>, 
        metadata: Option<Value>
    ) -> Result<(), lancedb::Error> {
        let table = self.conn.open_table(&self.table_name).execute().await?;
        
        let schema = table.schema().await?;
        let metadata_str = metadata.map(|m| m.to_string()).unwrap_or_else(|| "{}".to_string());
        
        let search_text = format!("{} {} {}", title, content.unwrap_or(""), url.unwrap_or(""));
        
        // Create a single-row RecordBatch
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec![id])),
                Arc::new(StringArray::from(vec![item_type])),
                Arc::new(StringArray::from(vec![title])),
                Arc::new(StringArray::from(vec![content.unwrap_or("")])),
                Arc::new(StringArray::from(vec![url.unwrap_or("")])),
                Arc::new(StringArray::from(vec![metadata_str.as_str()])),
                Arc::new(StringArray::from(vec![search_text.as_str()])),
                Arc::new(FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
                    vec![Some(vec![Some(0.0); 128])],
                    128
                )),
            ],
        ).map_err(|e| lancedb::Error::Runtime { message: e.to_string() })?;

        // Merge insert (upsert) based on ID
        let reader = arrow_array::RecordBatchIterator::new(
            std::iter::once(Ok(batch)),
            table.schema().await?,
        );

        let mut builder = table.merge_insert(&["id"]);
        builder.when_matched_update_all(None);
        builder.when_not_matched_insert_all();
        builder.execute(Box::new(reader)).await?;

        self.has_rows.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Drop the table and recreate it empty.
    /// Called automatically when corruption is detected.  Data will be
    /// repopulated on the next `reindex_all()` call.
    pub async fn reset_table(&self) -> Result<(), lancedb::Error> {
        log::warn!("[Search] Resetting corrupted LanceDB table '{}'", self.table_name);
        if let Err(e) = self.conn.drop_table(&self.table_name).await {
            log::warn!("[Search] drop_table failed (may already be gone): {}", e);
        }
        self.has_rows.store(false, Ordering::Relaxed);
        self.ensure_table().await?;
        log::info!("[Search] Table '{}' recreated successfully", self.table_name);
        Ok(())
    }

    pub async fn rebuild_indices(&self) -> Result<(), lancedb::Error> {
        let table = self.conn.open_table(&self.table_name).execute().await?;

        // Compact accumulated version fragments *before* rebuilding the index.
        // Doing this after building the index invalidates the index row addresses
        // causing "_rowaddr belongs to non-existent fragment" errors on subsequent searches.
        if let Err(e) = table.optimize(lancedb::table::OptimizeAction::All).await {
            log::warn!("[Search] Optimize (compaction) failed — non-fatal: {}", e);
        }

        // FTS indices in LanceDB 0.10+ are not automatically updated on write.
        // We recreate the index to ensure new data is searchable.
        table.create_index(&["search_text"], lancedb::index::Index::FTS(Default::default()))
            .replace(true)
            .execute()
            .await?;

        log::info!("[Search] Rebuilt FTS indices and compacted '{}'", self.table_name);
        Ok(())
    }

    pub async fn search(&self, 
        query_str: &str, 
        limit: usize,
        affinities: std::collections::HashMap<String, f64>,
    ) -> Result<Vec<Value>, lancedb::Error> {
        let table = self.conn.open_table(&self.table_name).execute().await?;
        
        // Safety check: if table is empty, FTS results in "Cannot read empty range 0..0" in some versions.
        // Use the atomic flag to skip the expensive count_rows disk hit once we know data exists.
        if !self.has_rows.load(Ordering::Relaxed) {
            let count = table.count_rows(None).await?;
            if count == 0 {
                return Ok(Vec::new());
            }
            self.has_rows.store(true, Ordering::Relaxed);
        }

        // Transform query for better matching
        // We split by whitespace, dots, and hyphens because LanceDB's FTS tokenizer usually drops punctuation.
        // A user searching 'google.com' needs to be translated to 'google* com*' to match the tokens.
        let optimized_query = query_str
            .split(|c: char| c.is_whitespace() || c == '.' || c == '-' || c == '/' || c == ':')
            .filter(|w| !w.is_empty())
            .map(|word| {
                if word.len() > 1 {
                    format!("{}*", word)
                } else {
                    word.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        log::debug!("[Search] Query: \"{}\" -> \"{}\"", query_str, optimized_query);

        // Full Text Search
        let results_query = table.query()
            .full_text_search(lancedb::index::scalar::FullTextSearchQuery::new(optimized_query))
            .limit(limit)
            .execute()
            .await;

        let results = match results_query {
            Ok(r) => r,
            Err(e) => {
                let msg = e.to_string();
                // Known benign: table empty when FTS index was just created
                if msg.contains("empty range") || msg.contains("0..0") {
                    return Ok(Vec::new());
                }
                // Fragment corruption — drop and recreate so future searches work.
                // Return empty for this search; reindex_all() will repopulate the table.
                if msg.contains("non-existent fragment") || msg.contains("_rowaddr") {
                    log::error!("[Search] LanceDB fragment corruption detected — auto-healing table");
                    let _ = self.reset_table().await;
                    return Ok(Vec::new());
                }
                return Err(e);
            }
        };

        let batches = results
            .try_collect::<Vec<RecordBatch>>()
            .await
            .map_err(|e| lancedb::Error::Runtime { message: e.to_string() })?;
        let mut final_results = Vec::new();

        for batch in batches {
            let row_count = batch.num_rows();
            let ids = batch.column(0).as_any().downcast_ref::<StringArray>().unwrap();
            let types = batch.column(1).as_any().downcast_ref::<StringArray>().unwrap();
            let titles = batch.column(2).as_any().downcast_ref::<StringArray>().unwrap();
            let contents = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
            let urls = batch.column(4).as_any().downcast_ref::<StringArray>().unwrap();
            let metadatas = batch.column(5).as_any().downcast_ref::<StringArray>().unwrap();
            
            // Extract scores if available (LanceDB FTS adds a _score column)
            let scores = batch.column_by_name("_score")
                .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());

            for i in 0..row_count {
                let url = urls.value(i);
                let mut score = scores.map(|s| s.value(i)).unwrap_or(0.0) as f64;
                
                // 1. Normalize score (LanceDB FTS scores are often > 1.0)
                // We'll treat 1.0 as a very strong match
                let mut final_score = (score * 50.0).min(100.0);

                // 2. Type-based boosting
                let item_type = types.value(i);
                if item_type == "app" || item_type == "tab" {
                    final_score += 10.0;
                } else if item_type == "workspace-url" {
                    final_score += 5.0;
                }

                // 3. Affinity boosting from context
                if !affinities.is_empty() {
                    if let Some(affinity) = affinities.get(url) {
                        final_score += affinity * 30.0; // Significant boost for high affinity
                    }
                }

                let metadata: Value = serde_json::from_str(metadatas.value(i)).unwrap_or(serde_json::json!({}));
                final_results.push(serde_json::json!({
                    "id": ids.value(i),
                    "type": item_type,
                    "title": titles.value(i),
                    "description": contents.value(i),
                    "url": url,
                    "metadata": metadata,
                    "score": final_score.min(100.0) as u32
                }));
            }
        }

        // Re-sort based on boosted scores
        final_results.sort_by(|a, b| {
            let sa = a["score"].as_u64().unwrap_or(0);
            let sb = b["score"].as_u64().unwrap_or(0);
            sb.cmp(&sa)
        });

        Ok(final_results)
    }
}
