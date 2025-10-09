// create export data component here and export it
import React, { useRef, useState } from 'react'
import { DB_CONFIG, getUnifiedDB } from '../../db/index.js'
import { storageGet, storageSet, storageRemove } from '../../services/extensionApi'

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
            setDetails({
                counts: Object.fromEntries(Object.entries(data.stores).map(([k, v]) => [k, v.length])),
                storageLocal: {
                    pinnedWorkspaces: (data.storageLocal?.pinnedWorkspaces || []).length,
                    dailyNotesDays: Object.keys(data.storageLocal?.dailyNotes?.notesByDate || {}).length,
                }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>Export / Import Data</h2>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={exportAll} disabled={busy}>
                    {busy ? 'Working...' : 'Export JSON'}
                </button>
                <button onClick={onChooseFile} disabled={busy}>Import JSON</button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                        type="checkbox"
                        checked={replaceMode}
                        onChange={(e) => setReplaceMode(e.target.checked)}
                    />
                    Replace existing data
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
                <div style={{ fontSize: 14 }}>
                    <strong>Status:</strong> {message}
                </div>
            )}

            {details?.counts && (
                <div style={{ marginTop: 8 }}>
                    <strong>Per-store counts:</strong>
                    <ul>
                        {Object.entries(details.counts).map(([store, count]) => (
                            <li key={store}>
                                <code>{store}</code>: {count}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div style={{ marginTop: 8, color: '#666', fontSize: 12 }}>
                <div>Export includes all unified DB stores:</div>
                <code>{storeNames.join(', ')}</code>
            </div>
        </div>
    )
}