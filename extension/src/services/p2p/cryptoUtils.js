import CryptoJS from 'crypto-js';

class P2PCryptoUtils {
    /**
     * Derive the Room ID (Discovery Key) and Encryption Key from a secret phrase
     * @param {string} secretPhrase - The user-provided 4-word secret
     * @returns {Object} { roomId, encryptionKey }
     */
    deriveKeys(secretPhrase) {
        if (!secretPhrase || typeof secretPhrase !== 'string') {
            throw new Error('Invalid secret phrase');
        }

        const normalizedSecret = secretPhrase.trim().toLowerCase();

        // 1. Discovery Key (Room ID)
        // SHA-1 hash of the secret, converted to Hex
        // This is safe to share with the signaling server/DHT as it's a one-way hash
        const roomId = CryptoJS.SHA1(normalizedSecret).toString(CryptoJS.enc.Hex);

        // 2. Encryption Key
        // PBKDF2 derivation with a static salt (since we don't have a central DB to store per-user salts)
        // In a strictly local-first P2P app, the "Salt" is effectively the secret itself or a static app-wide string.
        // We use a high iteration count to slow down brute-force attacks.
        const salt = 'cooldesk-p2p-salt-v1';
        const keySize = 256 / 32; // 256 bits
        const iterations = 10000;

        const encryptionKey = CryptoJS.PBKDF2(normalizedSecret, salt, {
            keySize: keySize,
            iterations: iterations
        }).toString(CryptoJS.enc.Base64);

        return {
            roomId,
            encryptionKey
        };
    }

    /**
     * Encrypt data using the derived encryption key
     * @param {any} data - Data to encrypt
     * @param {string} key - The Base64 encryption key
     * @returns {string} Encrypted string
     */
    encrypt(data, key) {
        const json = JSON.stringify(data);
        return CryptoJS.AES.encrypt(json, key).toString();
    }

    /**
     * Decrypt data using the derived encryption key
     * @param {string} encrypted - The AES encrypted string
     * @param {string} key - The Base64 encryption key
     * @returns {any} Decrypted data or null if failure
     */
    decrypt(encrypted, key) {
        try {
            const bytes = CryptoJS.AES.decrypt(encrypted, key);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            if (!decrypted) return null;
            return JSON.parse(decrypted);
        } catch (e) {
            console.error('[P2P Crypto] Decryption failed:', e);
            return null;
        }
    }
}

export const cryptoUtils = new P2PCryptoUtils();
