// create export data component here and export it
import React, { useRef, useState } from 'react'
import { DB_CONFIG, getUnifiedDB } from '../../db/index.js'
import { storageGet, storageSet, storageRemove } from '../../services/extensionApi'
import './ExportData.css'

export default function ExportData() {
    const fileInputRef = useRef(null)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [details, setDetails] = useState(null)
    const [replaceMode, setReplaceMode] = useState(false)

    const storeNames = Object.values(DB_CONFIG.STORES)

    async function exportAll() {
        setBusy(true)
        setMessage('Preparing export...')
        setDetails(null)
        try {
            const db = await getUnifiedDB()
            const data = { meta: { exportedAt: Date.now(), version: db.version }, stores: {}, storageLocal: {} }

            for (const storeName of storeNames) {
                const tx = db.transaction(storeName, 'readonly')
                const store = tx.objectStore(storeName)
                const request = store.getAll()
                // eslint-disable-next-line no-await-in-loop
                const rows = await new Promise((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result || [])
                    request.onerror = () => reject(request.error)
                })
                data.stores[storeName] = rows
            }

            // Include chrome.storage.local keys that the app relies on (pins + daily notes)
            try {
                const { pinnedWorkspaces } = await storageGet(['pinnedWorkspaces'])
                data.storageLocal.pinnedWorkspaces = Array.isArray(pinnedWorkspaces) ? pinnedWorkspaces : []
                // Collect daily notes keys
                let notesByDate = {}
                let dailyNotesSummary = {}
                let dailyNotesLastUpdate = 0
                try {
                    // Get all keys to extract dailyNotes_* efficiently
                    const all = await chrome.storage.local.get(null)
                    for (const [k, v] of Object.entries(all)) {
                        if (k.startsWith('dailyNotes_') && k !== 'dailyNotesSummary' && k !== 'dailyNotesLastUpdate') {
                            notesByDate[k] = v
                        }
                    }
                    dailyNotesSummary = all.dailyNotesSummary || {}
                    dailyNotesLastUpdate = all.dailyNotesLastUpdate || 0
                } catch { /* ignore storage errors */ }
                data.storageLocal.dailyNotes = {
                    notesByDate,
                    summary: dailyNotesSummary,
                    lastUpdate: dailyNotesLastUpdate,
                }
            } catch { /* ignore storage errors */ }

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            a.download = `cooldesk-backup-${ts}.json`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)

            setMessage('Export complete')
            const storeCounts = Object.fromEntries(Object.entries(data.stores).map(([k, v]) => [k, v.length]))
            setDetails({
                counts: storeCounts,
                storageLocal: {
                    pinnedWorkspaces: (data.storageLocal?.pinnedWorkspaces || []).length,
                    dailyNotesDays: Object.keys(data.storageLocal?.dailyNotes?.notesByDate || {}).length,
                },
                scrapedChats: storeCounts[DB_CONFIG.STORES.SCRAPED_CHATS] || 0
            })
        } catch (err) {
            console.error('[ExportData] Export failed', err)
            setMessage(`Export failed: ${err.message || err}`)
        } finally {
            setBusy(false)
        }
    }

    function onChooseFile() {
        fileInputRef.current?.click()
    }

    async function onFileSelected(e) {
        const file = e.target.files?.[0]
        if (!file) return
        setBusy(true)
        setMessage('Reading import file...')
        setDetails(null)
        try {
            const text = await file.text()
            const parsed = JSON.parse(text)
            if (!parsed || typeof parsed !== 'object' || !parsed.stores) {
                throw new Error('Invalid backup format: missing stores')
            }

            const db = await getUnifiedDB()

            // Replace mode: clear all known stores first
            if (replaceMode) {
                setMessage('Clearing existing data...')
                for (const storeName of storeNames) {
                    const tx = db.transaction(storeName, 'readwrite')
                    const store = tx.objectStore(storeName)
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((resolve, reject) => {
                        try {
                            const req = store.clear()
                            req.onsuccess = () => resolve()
                            req.onerror = () => reject(req.error)
                        } catch (err) {
                            // Some stores may not exist in older versions; ignore
                            resolve()
                        }
                    })
                }
                // Also clear existing daily notes keys in storage.local
                try {
                    const all = await chrome.storage.local.get(null)
                    const toRemove = Object.keys(all).filter(k => k.startsWith('dailyNotes_'))
                    if (toRemove.length) {
                        await storageRemove(toRemove)
                    }
                } catch { /* ignore */ }
            }

            // Import data per store (merge/replace handled above)
            const importCounts = {}
            for (const [storeName, rows] of Object.entries(parsed.stores)) {
                if (!Array.isArray(rows)) continue
                importCounts[storeName] = 0
                const tx = db.transaction(storeName, 'readwrite')
                const store = tx.objectStore(storeName)
                for (const row of rows) {
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((resolve, reject) => {
                        try {
                            const req = store.put(row)
                            req.onsuccess = () => resolve()
                            req.onerror = () => reject(req.error)
                        } catch (err) {
                            // If store not found in current schema, skip gracefully
                            resolve()
                        }
                    })
                    importCounts[storeName] += 1
                }
            }

            // Restore chrome.storage.local pins and daily notes
            try {
                if (parsed.storageLocal && Array.isArray(parsed.storageLocal.pinnedWorkspaces)) {
                    await storageSet({ pinnedWorkspaces: parsed.storageLocal.pinnedWorkspaces })
                }
                if (parsed.storageLocal && parsed.storageLocal.dailyNotes && typeof parsed.storageLocal.dailyNotes === 'object') {
                    const dn = parsed.storageLocal.dailyNotes
                    const obj = {}
                    if (dn.notesByDate && typeof dn.notesByDate === 'object') {
                        for (const [k, v] of Object.entries(dn.notesByDate)) {
                            if (k.startsWith('dailyNotes_')) obj[k] = v
                        }
                    }
                    if (dn.summary && typeof dn.summary === 'object') obj['dailyNotesSummary'] = dn.summary
                    if (Number.isFinite(Number(dn.lastUpdate))) obj['dailyNotesLastUpdate'] = Number(dn.lastUpdate)
                    if (Object.keys(obj).length) await storageSet(obj)
                }
            } catch { /* ignore storage errors */ }

            setMessage('Import complete')
            setDetails({ counts: importCounts })
        } catch (err) {
            console.error('[ExportData] Import failed', err)
            setMessage(`Import failed: ${err.message || err}`)
        } finally {
            setBusy(false)
            // reset input so same file can be reselected
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    return (
        <div className="export-data-container">
            <div className="export-header">
                <h2>Export / Import Data</h2>
                <p className="export-subtitle">Backup and restore your workspaces, activities, notes, and AI chats</p>
            </div>

            <div className="export-actions">
                <button className="export-btn primary" onClick={exportAll} disabled={busy}>
                    <span className="btn-icon">📦</span>
                    {busy ? 'Working...' : 'Export JSON'}
                </button>
                <button className="export-btn secondary" onClick={onChooseFile} disabled={busy}>
                    <span className="btn-icon">📥</span>
                    Import JSON
                </button>
                <label className="replace-mode-toggle">
                    <input
                        type="checkbox"
                        checked={replaceMode}
                        onChange={(e) => setReplaceMode(e.target.checked)}
                    />
                    <span>Replace existing data</span>
                </label>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    onChange={onFileSelected}
                    style={{ display: 'none' }}
                />
            </div>

            {message && (
                <div className={`export-status ${message.includes('failed') ? 'error' : 'success'}`}>
                    <span className="status-icon">{message.includes('failed') ? '❌' : '✅'}</span>
                    <span>{message}</span>
                </div>
            )}

            {details && (
                <div className="export-details">
                    <div className="details-header">
                        <h3>Export Summary</h3>
                    </div>
                    
                    <div className="details-grid">
                        <div className="detail-card highlight">
                            <div className="detail-icon">💬</div>
                            <div className="detail-content">
                                <div className="detail-label">AI Chats</div>
                                <div className="detail-value">{details.scrapedChats || 0}</div>
                            </div>
                        </div>
                        
                        <div className="detail-card">
                            <div className="detail-icon">📌</div>
                            <div className="detail-content">
                                <div className="detail-label">Pinned Workspaces</div>
                                <div className="detail-value">{details.storageLocal?.pinnedWorkspaces || 0}</div>
                            </div>
                        </div>
                        
                        <div className="detail-card">
                            <div className="detail-icon">📝</div>
                            <div className="detail-content">
                                <div className="detail-label">Daily Notes</div>
                                <div className="detail-value">{details.storageLocal?.dailyNotesDays || 0} days</div>
                            </div>
                        </div>
                    </div>

                    {details.counts && (
                        <div className="store-counts">
                            <h4>Database Stores</h4>
                            <div className="store-list">
                                {Object.entries(details.counts).map(([store, count]) => (
                                    <div key={store} className="store-item">
                                        <code className="store-name">{store}</code>
                                        <span className="store-count">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="export-info">
                <div className="info-title">📊 Included in Export:</div>
                <div className="info-stores">{storeNames.join(', ')}</div>
            </div>
        </div>
    )
}