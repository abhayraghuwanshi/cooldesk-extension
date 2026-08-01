import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testCategorization() {
    const syncDataPath = path.join(__dirname, '../src-tauri/sync-data/sync-data.json');
    console.log(`Reading sync data from: ${syncDataPath}`);

    const rawData = fs.readFileSync(syncDataPath, 'utf8');
    const data = JSON.parse(rawData);

    let items = [];
    let count = 1;
    const maxItems = 40; // Limit items to prevent token overflow

    if (data.workspaces) {
        for (let ws of data.workspaces) {
            if (ws.urls) {
                for (let u of ws.urls) {
                    const title = u.title || 'Unknown Title';
                    const url = u.url || '';
                    items.push(`${count}. ${title} (${url})`);
                    count++;
                    if (count > maxItems) break;
                }
            }
            if (count > maxItems) break;
        }
    }

    const itemsStr = items.join('\n');
    console.log(`\nTesting with ${items.length} items:\n`);
    console.log(itemsStr);
    console.log('\n----------------------------------------\n');
    console.log('Loading LLM model...');
    try {
        const loadRes = await fetch('http://127.0.0.1:4000/llm/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                modelName: 'llama-3.2-1b-instruct.Q4_K_M.gguf',
                gpuLayers: 33
            })
        });
        const loadJson = await loadRes.json();
        if (!loadJson.success) {
            console.error('❌ Failed to load model');
            return;
        }
        console.log('✅ Model loaded successfully.\n');
    } catch (err) {
        console.error('❌ Error loading model:', err);
        return;
    }

    console.log('Sending request to LLM endpoint...');

    try {
        const res = await fetch('http://127.0.0.1:4000/llm/group-workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: itemsStr,
                context: 'User browsing data from sync-data.json. Organize these into logical workspaces.'
            })
        });

        const json = await res.json();
        console.log('\nResponse from server:');
        console.log(JSON.stringify(json, null, 2));

        if (json.ok && json.result) {
            console.log('\nParsing result:');
            try {
                const parsed = JSON.parse(json.result);
                console.log(JSON.stringify(parsed, null, 2));
                console.log('\n✅ Successfully parsed JSON from LLM!');
            } catch (err) {
                console.error('\n❌ Failed to parse result as JSON:', err.message);
                console.log('Raw result was:\n', json.result);
            }
        } else {
            console.error('\n❌ Request failed. Backend returned ok=false.');
        }
    } catch (err) {
        console.error('\n❌ Error communicating with endpoint:', err);
    }
}

testCategorization();
