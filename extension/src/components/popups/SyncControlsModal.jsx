import { faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { useState } from 'react';

// Lightweight modal wrapper to host EnhancedSyncControls
export function SyncControlsModal({
    show,
    onClose,
    onBulkSync,
    onRecategorize,
    onSingleCategorySync,
    categories = [],
    progress = { running: false },
}) {
    const [selectedCategory, setSelectedCategory] = useState('');
    const [syncOptions, setSyncOptions] = useState({
        batchSize: 10,
        minVisitCount: 1,
        forceRecategorize: false,
    });

    if (!show) return null;

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ maxWidth: 640 }}>
                <div
                    className="modal-header"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8, paddingBottom: 8, borderBottom: '1px solid #273043', marginBottom: 10,
                    }}
                >
                    <div>
                        <h3 style={{ margin: 0 }}>AI Category Sync</h3>
                        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                            Choose what to sync and tweak options before running enrichment.
                        </div>
                    </div>
                    <button className="cancel-btn" onClick={onClose} title="Close" aria-label="Close" style={{ padding: '4px 8px' }}>×</button>
                </div>

                {/* Actions */}
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr' }}>
                    {/* Bulk Sync */}
                    <div style={{ padding: 12, border: '1px solid #273043', borderRadius: 8, background: '#0f1522' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <FontAwesomeIcon icon={faWandMagicSparkles} />
                                <div>
                                    <div style={{ fontWeight: 600 }}>Bulk Categorize All</div>
                                    <div style={{ fontSize: 12, opacity: 0.75 }}>Process all uncategorized items</div>
                                </div>
                            </div>
                            <button
                                onClick={() => onBulkSync && onBulkSync(syncOptions)}
                                disabled={!!progress.running}
                                className="add-link-btn ai-button"
                                aria-label="Run bulk categorization"
                            >
                                {progress.running ? 'Working…' : 'Run'}
                            </button>
                        </div>
                    </div>

                    {/* Recategorize Existing */}
                    <div style={{ padding: 12, border: '1px solid #273043', borderRadius: 8, background: '#0f1522' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>Re-evaluate Categories</div>
                                <div style={{ fontSize: 12, opacity: 0.75 }}>Check and optionally overwrite existing categorizations</div>
                            </div>
                            <button
                                onClick={() => onRecategorize && onRecategorize({ forceRecategorize: syncOptions.forceRecategorize })}
                                disabled={!!progress.running}
                                className="add-link-btn"
                                aria-label="Re-evaluate categories"
                            >
                                {progress.running ? 'Working…' : 'Run'}
                            </button>
                        </div>
                    </div>

                    {/* Single Category Sync */}
                    <div style={{ padding: 12, border: '1px solid #273043', borderRadius: 8, background: '#0f1522' }}>
                        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 600 }}>Sync Single Category</div>
                                <div style={{ fontSize: 12, opacity: 0.75 }}>
                                    {Array.isArray(categories) && categories.length > 0 ? 'Select a category to process uncategorized items into it.' : 'No categories available. Create a workspace first.'}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <select
                                    aria-label="Category"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    disabled={!!progress.running || !Array.isArray(categories) || categories.length === 0}
                                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px' }}
                                >
                                    <option value="">Select…</option>
                                    {categories.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => selectedCategory && onSingleCategorySync && onSingleCategorySync(selectedCategory)}
                                    disabled={!!progress.running || !selectedCategory}
                                    className="add-link-btn ai-button"
                                    aria-label="Sync selected category"
                                >
                                    {progress.running ? 'Working…' : 'Sync'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Options */}
                <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Sync Options</summary>
                    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', padding: 12, border: '1px solid #273043', borderRadius: 8, background: '#0f1522' }}>
                        <label>
                            Batch Size:
                            <input
                                type="number"
                                value={syncOptions.batchSize}
                                onChange={(e) => setSyncOptions((prev) => ({ ...prev, batchSize: Number(e.target.value) }))}
                                min="1"
                                max="50"
                                disabled={!!progress.running}
                                style={{ width: '100%', padding: 4 }}
                            />
                        </label>
                        <label>
                            Min Visit Count:
                            <input
                                type="number"
                                value={syncOptions.minVisitCount}
                                onChange={(e) => setSyncOptions((prev) => ({ ...prev, minVisitCount: Number(e.target.value) }))}
                                min="1"
                                disabled={!!progress.running}
                                style={{ width: '100%', padding: 4 }}
                            />
                        </label>
                        <label style={{ gridColumn: '1 / -1' }}>
                            <input
                                type="checkbox"
                                checked={syncOptions.forceRecategorize}
                                onChange={(e) => setSyncOptions((prev) => ({ ...prev, forceRecategorize: e.target.checked }))}
                                disabled={!!progress.running}
                            />
                            {' '}Force recategorize all items
                        </label>
                        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                className="filter-btn"
                                onClick={() => setSyncOptions({ batchSize: 10, minVisitCount: 1, forceRecategorize: false })}
                                disabled={!!progress.running}
                            >
                                Reset defaults
                            </button>
                        </div>
                    </div>
                </details>

                <div className="modal-actions">
                    <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
                        <button className="filter-btn" onClick={onClose} disabled={!!progress.running}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
