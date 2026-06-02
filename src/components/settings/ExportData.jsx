import { faCheckCircle, faFileExport, faFileImport, faTimesCircle } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useRef, useState } from 'react'
import { DB_CONFIG, getUnifiedDB } from '../../db/index.js'
import { storageGet, storageRemove, storageSet } from '../../services/extensionApi'


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

            // Include chrome.storage.local keys that the app relies on (pins + daily notes + view settings)
            try {
                const { pinnedWorkspaces } = await storageGet(['pinnedWorkspaces'])
                data.storageLocal.pinnedWorkspaces = Array.isArray(pinnedWorkspaces) ? pinnedWorkspaces : []

                // Export view mode and display settings
                try {
                    const viewMode = localStorage.getItem('cooldesk_view_mode') || 'default'
                    const displaySettings = localStorage.getItem('cooldesk_display_settings')
                    data.storageLocal.viewMode = viewMode
                    data.storageLocal.displaySettings = displaySettings ? JSON.parse(displaySettings) : null
                } catch { /* ignore */ }
                // Collect daily notes keys and scraping settings
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

                    // Export scraping configurations
                    if (all.domainSelectors) data.storageLocal.domainSelectors = all.domainSelectors
                    if (all.platformSettings) data.storageLocal.platformSettings = all.platformSettings
                    if (all.genericScraperAllowlist) data.storageLocal.genericScraperAllowlist = all.genericScraperAllowlist
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
                    viewMode: data.storageLocal?.viewMode || 'default',
                    displaySettingsCount: data.storageLocal?.displaySettings ? Object.keys(data.storageLocal.displaySettings).length : 0,
                    scrapingRules: Object.keys(data.storageLocal?.domainSelectors || {}).length
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

            // Restore chrome.storage.local pins, daily notes, view settings, and scraping configs
            try {
                const updates = {}

                if (parsed.storageLocal && Array.isArray(parsed.storageLocal.pinnedWorkspaces)) {
                    updates.pinnedWorkspaces = parsed.storageLocal.pinnedWorkspaces
                }

                // Restore scraping configurations
                if (parsed.storageLocal?.domainSelectors) {
                    updates.domainSelectors = parsed.storageLocal.domainSelectors
                }
                if (parsed.storageLocal?.platformSettings) {
                    updates.platformSettings = parsed.storageLocal.platformSettings
                }
                if (parsed.storageLocal?.genericScraperAllowlist) {
                    updates.genericScraperAllowlist = parsed.storageLocal.genericScraperAllowlist
                }

                if (Object.keys(updates).length > 0) {
                    await storageSet(updates)
                }

                // Restore view mode and display settings
                if (parsed.storageLocal) {
                    if (parsed.storageLocal.viewMode) {
                        localStorage.setItem('cooldesk_view_mode', parsed.storageLocal.viewMode)
                    }
                    if (parsed.storageLocal.displaySettings) {
                        localStorage.setItem('cooldesk_display_settings', JSON.stringify(parsed.storageLocal.displaySettings))
                        // Dispatch event to update UI
                        window.dispatchEvent(new CustomEvent('displaySettingsChanged', {
                            detail: parsed.storageLocal.displaySettings
                        }))
                        window.dispatchEvent(new CustomEvent('viewModeChanged', {
                            detail: { modeId: parsed.storageLocal.viewMode || 'default' }
                        }))
                    }
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
            setDetails({
                counts: importCounts,
                viewMode: parsed.storageLocal?.viewMode || 'not included',
                displaySettings: parsed.storageLocal?.displaySettings ? 'restored' : 'not included',
                scrapingRules: parsed.storageLocal?.domainSelectors ? Object.keys(parsed.storageLocal.domainSelectors).length : 0
            })
        } catch (err) {
            console.error('[ExportData] Import failed', err)
            setMessage(`Import failed: ${err.message || err}`)
        } finally {
            setBusy(false)
            // reset input so same file can be reselected
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const isError = message.includes('failed') || message.includes('Failed')

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 14px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
            }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#e5e7eb' }}>Export / Import</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                        Download or restore all your data as JSON
                    </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', marginRight: 4 }}>
                    <input
                        type="checkbox"
                        checked={replaceMode}
                        onChange={e => setReplaceMode(e.target.checked)}
                        style={{ accentColor: '#ef4444', width: 13, height: 13 }}
                    />
                    Replace
                </label>

                <button
                    onClick={onChooseFile}
                    disabled={busy}
                    style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.06)', color: '#cbd5e1',
                        cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.4 : 1,
                    }}
                >
                    <FontAwesomeIcon icon={faFileImport} style={{ marginRight: 4 }} />
                    Import
                </button>

                <button
                    onClick={exportAll}
                    disabled={busy}
                    style={{
                        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                        border: '1px solid rgba(59,130,246,0.3)',
                        background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                        cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.4 : 1,
                    }}
                >
                    <FontAwesomeIcon icon={faFileExport} style={{ marginRight: 4 }} />
                    {busy ? 'Working…' : 'Export'}
                </button>

                <input ref={fileInputRef} type="file" accept="application/json" onChange={onFileSelected} style={{ display: 'none' }} />
            </div>

            {message && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 12px', borderRadius: 8, fontSize: 11,
                    background: isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: isError ? '#f87171' : '#4ade80',
                    border: `1px solid ${isError ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                }}>
                    <FontAwesomeIcon icon={isError ? faTimesCircle : faCheckCircle} />
                    {message}
                </div>
            )}
        </div>
    )
}