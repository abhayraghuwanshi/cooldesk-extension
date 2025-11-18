import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase.js';

let started = false;

async function startAuth() {
    if (started) return;
    started = true;
    try {
        const provider = new GoogleAuthProvider();
        const cred = await signInWithPopup(auth, provider);
        const user = cred.user;
        const token = await user.getIdToken(true);
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTH_RESULT', ok: true, user: { uid: user.uid, email: user.email, displayName: user.displayName }, idToken: token });
    } catch (e) {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTH_RESULT', ok: false, error: e?.message || String(e) });
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'START_OFFSCREEN_AUTH') {
        startAuth();
        return false;
    }
    if (message?.action === 'LOGIN_WITH_GOOGLE') {
        (async () => {
            try {
                const provider = new GoogleAuthProvider();
                const cred = await signInWithPopup(auth, provider);
                const user = cred.user;
                const token = await user.getIdToken(true);
                sendResponse({ ok: true, user: { uid: user.uid, email: user.email, displayName: user.displayName }, idToken: token });
            } catch (e) {
                sendResponse({ ok: false, error: e?.message || String(e) });
            }
        })();
        return true; // keep channel open for async sendResponse
    }
    return false;
});

onAuthStateChanged(auth, (user) => {
    if (user && !started) {
        started = true;
        user.getIdToken(true).then((token) => {
            chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTH_RESULT', ok: true, user: { uid: user.uid, email: user.email, displayName: user.displayName }, idToken: token });
        });
    }
});

// Notify background that offscreen is ready to receive messages
try { chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }); } catch { }
