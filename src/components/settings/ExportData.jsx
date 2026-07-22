import { faCheckCircle, faFileExport, faFileImport, faTimesCircle } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useRef, useState } from 'react'
import { DB_CONFIG, getUnifiedDB } from '../../db/index.js'
import { storageGet } from '../../services/extensionApi'
import { parseBackup, restoreBackup } from '../../services/backupRestore'


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
            const parsed = parseBackup(await file.text())

            // Restore is version-aware: it applies forward row migrations for a
            // backup older than this schema, and skips (rather than fails on)
            // stores a newer backup carries that this build doesn't know.
            setMessage('Restoring...')
            const report = await restoreBackup(parsed, { replace: replaceMode })

            const counts = {}
            for (const [store, r] of Object.entries(report.stores)) {
                if (r.written || r.skipped) {
                    counts[store] = r.skipped ? `${r.written} (${r.skipped} skipped)` : r.written
                }
            }

            const versionNote = {
                upgrade: `Backup from schema v${report.dbVersion}, migrated to v${report.currentVersion}`,
                newer: `Backup is from a newer version (v${report.dbVersion} > v${report.currentVersion}) — unsupported data was skipped`,
                unknown: 'Backup has no version stamp — applied all migrations',
                ok: `Schema v${report.currentVersion}`,
            }[report.compatibility]

            setMessage(report.written ? 'Import complete' : 'Import finished, but nothing was written')
            setDetails({
                rowsWritten: report.written,
                rowsSkipped: report.skipped,
                version: versionNote,
                ...(report.appVersion ? { fromAppVersion: report.appVersion } : {}),
                ...(report.pendingMigrations.length
                    ? { migrationsApplied: report.pendingMigrations.join(', ') }
                    : {}),
                ...(report.unknownStores.length
                    ? { unknownStores: report.unknownStores.join(', ') }
                    : {}),
                counts,
                ...(report.errors.length ? { errors: report.errors } : {}),
                viewMode: parsed.storageLocal?.viewMode || 'not included',
                displaySettings: parsed.storageLocal?.displaySettings ? 'restored' : 'not included',
                scrapingRules: parsed.storageLocal?.domainSelectors
                    ? Object.keys(parsed.storageLocal.domainSelectors).length
                    : 0,
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

            {details && (
                <div style={{
                    padding: '9px 12px', borderRadius: 8, fontSize: 11, lineHeight: 1.6,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.55)',
                }}>
                    {details.version && (
                        <div style={{ color: 'rgba(255,255,255,0.75)', marginBottom: 4 }}>{details.version}</div>
                    )}
                    {Number.isFinite(details.rowsWritten) && (
                        <div>
                            {details.rowsWritten} rows restored
                            {details.rowsSkipped ? `, ${details.rowsSkipped} skipped` : ''}
                        </div>
                    )}
                    {details.fromAppVersion && <div>From app v{details.fromAppVersion}</div>}
                    {details.migrationsApplied && <div>Migrations applied: v{details.migrationsApplied}</div>}
                    {details.unknownStores && (
                        <div style={{ color: '#fbbf24' }}>Unrecognised stores skipped: {details.unknownStores}</div>
                    )}
                    {details.counts && Object.keys(details.counts).length > 0 && (
                        <div style={{ marginTop: 4, opacity: 0.8 }}>
                            {Object.entries(details.counts).map(([store, n]) => (
                                <div key={store}>{store}: {n}</div>
                            ))}
                        </div>
                    )}
                    {Array.isArray(details.errors) && details.errors.map((e, i) => (
                        <div key={i} style={{ color: '#f87171' }}>{e}</div>
                    ))}
                </div>
            )}
        </div>
    )
}