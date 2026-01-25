const statusEl = document.getElementById('status');
const btn = document.getElementById('login');

function setStatus(msg) { statusEl.textContent = msg; }

async function loginWithGoogle() {
    setStatus('Starting login...');
    const resp = await chrome.runtime.sendMessage({ action: 'LOGIN_WITH_GOOGLE' }).catch(e => ({ ok: false, error: e?.message || String(e) }));
    if (resp?.ok) {
        setStatus(`Logged in as ${resp.user?.email || resp.user?.uid}`);
    } else {
        setStatus(`Login failed: ${resp?.error || 'Unknown error'}`);
    }
}

btn.addEventListener('click', loginWithGoogle);
