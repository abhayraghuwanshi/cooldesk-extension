import { Dropbox } from 'dropbox'

const STORAGE_KEY = 'dropboxToken'
const APPKEY_STORAGE = 'dropboxAppKey'

export async function getStoredToken() {
  try {
    const obj = await chrome.storage.local.get(STORAGE_KEY)
    return obj?.[STORAGE_KEY] || null
  } catch (e) {
    return null
  }
}

export async function setStoredToken(token) {
  await chrome.storage.local.set({ [STORAGE_KEY]: token })
}

export async function clearStoredToken() {
  await chrome.storage.local.remove(STORAGE_KEY)
}

export function getRedirectUri() {
  return chrome.identity.getRedirectURL('dropbox')
}

export async function connectDropbox(appKey) {
  const dbx = new Dropbox({ clientId: appKey })
  const redirectUri = getRedirectUri()
  const authUrl = await dbx.auth.getAuthenticationUrl(
    redirectUri,
    undefined,
    'code',
    'offline',
    ['files.content.read', 'files.content.write', 'files.metadata.read', 'files.metadata.write', 'account_info.read', 'sharing.read'],
    'none',
    true
  )

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message))
      }
      try {
        // Prefer PKCE code in query string
        const urlObj = new URL(redirectUrl)
        const code = urlObj.searchParams.get('code')
        if (code) {
          const tokenRes = await dbx.auth.getAccessTokenFromCode(redirectUri, code)
          const r = tokenRes?.result || tokenRes
          const accessToken = r?.access_token
          const refreshToken = r?.refresh_token
          const expiresIn = Number(r?.expires_in || 0)
          if (!accessToken) throw new Error('No access_token in token response')
          const tokenObj = {
            accessToken,
            refreshToken: refreshToken || null,
            expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : 0,
            scope: r?.scope,
            accountId: r?.account_id || r?.uid || null
          }
          await setStoredToken(tokenObj)
          // Persist appKey for future refreshes
          await chrome.storage.local.set({ [APPKEY_STORAGE]: appKey })
          return resolve(accessToken)
        }

        // Fallback: implicit grant (hash fragment)
        const hash = redirectUrl.split('#')[1] || ''
        const params = new URLSearchParams(hash)
        const implicitToken = params.get('access_token')
        if (implicitToken) {
          await setStoredToken({ accessToken: implicitToken, refreshToken: null, expiresAt: 0 })
          await chrome.storage.local.set({ [APPKEY_STORAGE]: appKey })
          return resolve(implicitToken)
        }
      } catch (err) {
        reject(err)
      }
    })
  })
}

export async function getDropboxClient() {
  const tok = await getStoredToken()
  if (!tok) return null

  // If nearing expiry and we have refresh_token, refresh
  try {
    const now = Date.now()
    if (tok.refreshToken && tok.expiresAt && tok.expiresAt - now < 30 * 1000) {
      const appKeyObj = await chrome.storage.local.get(APPKEY_STORAGE)
      const appKey = appKeyObj?.[APPKEY_STORAGE]
      if (appKey) {
        const refreshed = await refreshAccessToken(appKey, tok.refreshToken)
        const newTok = {
          accessToken: refreshed.access_token,
          refreshToken: tok.refreshToken,
          expiresAt: refreshed.expires_in ? now + refreshed.expires_in * 1000 : 0,
          scope: refreshed.scope || tok.scope,
          accountId: tok.accountId || null
        }
        await setStoredToken(newTok)
      }
    }
  } catch {}

  const latest = await getStoredToken()
  if (!latest?.accessToken) return null
  return new Dropbox({ accessToken: latest.accessToken })
}

async function refreshAccessToken(appKey, refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey
  })
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  return await res.json()
}
