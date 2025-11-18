import { auth } from '../auth/firebase.js';

export async function fetchApi(input, init = {}) {
    const headers = new Headers(init.headers || {});
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const token = await user.getIdToken(true);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
}
