import { Dropbox } from 'dropbox'
import { listWorkspaces, saveWorkspace } from '../db/index.js'
import { getDropboxClient } from './auth.js'

function normalizeGroupKey(input) {
  let s = String(input || 'default').trim()
  if (!s) s = 'default'
  // prevent path traversal
  s = s.replace(/\\/g, '/').replace(/\.\.+/g, '').replace(/^\/+|\/+$/g, '')
  return s
}

function normalizeBaseFolder(baseFolder) {
  let s = String(baseFolder || '/groups').trim()
  if (!s.startsWith('/')) s = `/${s}`
  // remove trailing slashes
  s = s.replace(/\\/g, '/').replace(/\/+$|\/$/g, '')
  return s
}

function getGroupFolder(groupKey = 'default', baseFolder = '/groups') {
  const safe = normalizeGroupKey(groupKey)
  const base = normalizeBaseFolder(baseFolder)
  return `${base}/${safe}`
}

function getFilePath(groupKey = 'default', baseFolder = '/groups') {
  return `${getGroupFolder(groupKey, baseFolder)}/workspaces.json`
}

async function ensureFolder(dbx, path) {
  try {
    await dbx.filesGetMetadata({ path })
  } catch (e) {
    const tag = e?.error?.error?.['.tag']
    const summary = e?.error?.error_summary || ''
    const notFound = tag === 'path' || String(summary).includes('path/not_found') || String(summary).includes('not_found')
    if (notFound) {
      try {
        await dbx.filesCreateFolderV2({ path, autorename: false })
      } catch (e2) {
        // if created by someone else between calls, ignore folder/conflict
        const s2 = e2?.error?.error_summary || ''
        if (!String(s2).includes('conflict/folder')) throw e2
      }
    } else {
      // other errors propagate
      throw e
    }
  }
}

async function ensureGroupFolder(dbx, groupKey = 'default', baseFolder = '/groups') {
  const base = normalizeBaseFolder(baseFolder)
  await ensureFolder(dbx, base)
  const groupPath = getGroupFolder(groupKey, baseFolder)
  await ensureFolder(dbx, groupPath)
}

export async function listGroups({ baseFolder = '/groups' } = {}) {
  const dbx = await getDropboxClient()
  if (!dbx) throw new Error('Not connected to Dropbox')
  const root = normalizeBaseFolder(baseFolder)
  try {
    const res = await dbx.filesListFolder({ path: root })
    const entries = (res?.result?.entries || res?.entries || [])
    const folders = entries.filter(e => e['.tag'] === 'folder').map(f => f.name)
    return { ok: true, groups: folders }
  } catch (e) {
    const summary = e?.error?.error_summary || ''
    if (String(summary).includes('path/not_found')) {
      // create root groups folder implicitly on first upload
      return { ok: true, groups: [] }
    }
    throw e
  }
}

export async function uploadWorkspaces({ groupKey = 'default', baseFolder = '/groups' } = {}) {
  const dbx = await getDropboxClient()
  if (!dbx) throw new Error('Not connected to Dropbox')

  const result = await listWorkspaces()
  const workspaces = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : [])

  const body = JSON.stringify({ workspaces, updatedAt: Date.now() })
  // ensure folder exists
  await ensureGroupFolder(dbx, groupKey, baseFolder)
  await dbx.filesUpload({
    path: getFilePath(groupKey, baseFolder),
    contents: body,
    mode: { '.tag': 'overwrite' }
  })
  return { ok: true, count: workspaces.length }
}

export async function downloadWorkspaces({ groupKey = 'default', baseFolder = '/groups' } = {}) {
  const dbx = await getDropboxClient()
  if (!dbx) throw new Error('Not connected to Dropbox')

  try {
    const filePath = getFilePath(groupKey, baseFolder)
    const groupFolder = getGroupFolder(groupKey, baseFolder)
    
    // Preflight: check if file exists by listing parent folder to avoid 409s
    try {
      const folderList = await dbx.filesListFolder({ path: groupFolder })
      const entries = folderList?.result?.entries || folderList?.entries || []
      const fileExists = entries.some(entry => 
        entry.name === 'workspaces.json' && entry['.tag'] === 'file'
      )
      if (!fileExists) {
        return { ok: true, workspaces: [], updatedAt: 0 }
      }
    } catch (pre) {
      const preSummary = pre?.error?.error_summary || ''
      const preTag = pre?.error?.error?.path?.['.tag']
      if (preTag === 'not_found' || String(preSummary).includes('path/not_found')) {
        return { ok: true, workspaces: [], updatedAt: 0 }
      }
      // other folder listing errors propagate
      throw pre
    }

    const res = await dbx.filesDownload({ path: filePath })
    const r = res?.result || res
    let text
    if (r?.fileBlob && typeof r.fileBlob.text === 'function') {
      text = await r.fileBlob.text()
    } else if (r?.fileBinary) {
      // fileBinary may be ArrayBuffer or string depending on env
      if (r.fileBinary instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array(r.fileBinary))
      } else if (typeof r.fileBinary === 'string') {
        text = r.fileBinary
      }
    }
    if (!text) throw new Error('Unexpected download payload from Dropbox')
    const parsed = JSON.parse(text)
    const items = Array.isArray(parsed?.workspaces) ? parsed.workspaces : []
    return { ok: true, workspaces: items, updatedAt: parsed?.updatedAt || 0 }
  } catch (e) {
    const tag = e?.error?.error?.path?.['.tag']
    const summary = e?.error?.error_summary
    if (tag === 'not_found' || String(summary || '').includes('path/not_found')) {
      return { ok: true, workspaces: [], updatedAt: 0 }
    }
    throw e
  }
}

export async function syncWorkspaces({ strategy = 'newer-wins', groupKey = 'default', baseFolder = '/groups' } = {}) {
  const localList = await listWorkspaces()
  const local = Array.isArray(localList?.data) ? localList.data : (Array.isArray(localList) ? localList : [])
  const remoteRes = await downloadWorkspaces({ groupKey, baseFolder })
  const remote = remoteRes.workspaces

  const byId = (arr) => Object.fromEntries(arr.map(w => [w.id, w]))
  const lmap = byId(local)
  const rmap = byId(remote)
  const mergedIds = new Set([...Object.keys(lmap), ...Object.keys(rmap)])

  let updated = 0
  for (const id of mergedIds) {
    const L = lmap[id]
    const R = rmap[id]
    if (L && !R) {
      // keep local
      await saveWorkspace(L)
      updated++
    } else if (!L && R) {
      await saveWorkspace(R)
      updated++
    } else if (L && R) {
      const lu = Number(L.updatedAt || L.createdAt || 0)
      const ru = Number(R.updatedAt || R.createdAt || 0)
      const pick = strategy === 'remote-wins' ? R : (strategy === 'local-wins' ? L : (ru > lu ? R : L))
      await saveWorkspace({ ...pick })
      updated++
    }
  }

  // push latest back to Dropbox for consistency
  await uploadWorkspaces({ groupKey, baseFolder })

  return { ok: true, merged: updated }
}

export async function getGroupMembers({ groupKey = 'default', baseFolder = '/groups' } = {}) {
  const dbx = await getDropboxClient()
  if (!dbx) throw new Error('Not connected to Dropbox')
  const folderPath = getGroupFolder(groupKey, baseFolder)
  try {
    const meta = await dbx.filesGetMetadata({ path: folderPath })
    const m = meta?.result || meta
    const sharedId = m?.shared_folder_id
    if (!sharedId) {
      return { ok: true, shared: false, members: [] }
    }
    const membersRes = await dbx.sharingListFolderMembers({ shared_folder_id: sharedId })
    const r = membersRes?.result || membersRes
    const members = [
      ...(r?.users || []).map(u => ({
        type: 'user',
        email: u?.user?.email,
        name: u?.user?.display_name,
        access_type: u?.access_type?.['.tag']
      })),
      ...(r?.groups || []).map(g => ({
        type: 'group',
        name: g?.group?.name,
        access_type: g?.access_type?.['.tag']
      })),
      ...(r?.invitees || []).map(i => ({
        type: 'invitee',
        email: i?.invitee?.email,
        access_type: i?.access_type?.['.tag']
      }))
    ]
    return { ok: true, shared: true, members }
  } catch (e) {
    // If path not found, report empty
    const summary = e?.error?.error_summary || ''
    if (String(summary).includes('path/not_found')) return { ok: true, shared: false, members: [] }
    throw e
  }
}

export async function getDropboxStatus() {
  const client = await getDropboxClient()
  if (!client) return { connected: false }
  try {
    const current = await client.usersGetCurrentAccount()
    return { connected: true, account: { name: current?.name?.display_name, email: current?.email } }
  } catch {
    return { connected: true }
  }
}
