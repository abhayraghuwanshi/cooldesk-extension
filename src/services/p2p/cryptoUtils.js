import CryptoJS from 'crypto-js';
import { ec as EC } from 'elliptic';

const ec = new EC('secp256k1');

class P2PCryptoUtils {
    /**
     * Generate a Public/Private key pair for Admin authentication
     * @returns {Object} { privateKey, publicKey } (Hex strings)
     */
    generateAdminKeys() {
        const key = ec.genKeyPair();
        return {
            privateKey: key.getPrivate('hex'),
            publicKey: key.getPublic('hex') // Compact hex usually, or uncompressed
        };
    }

    /**
     * Sign a message (or stringified payload) with a Private Key
     * @param {string} message 
     * @param {string} privateKeyHex 
     * @returns {string} Hex signature
     */
    sign(message, privateKeyHex) {
        try {
            const key = ec.keyFromPrivate(privateKeyHex);
            // We hash the message first to ensure it fits in the curve
            const msgHash = CryptoJS.SHA256(message).toString();
            const signature = key.sign(msgHash);
            return signature.toDER('hex');
        } catch (e) {
            console.error('[P2P Crypto] Signing failed:', e);
            return null;
        }
    }

    /**
     * Verify a signature against a message and Public Key
     * @param {string} message 
     * @param {string} signatureHex 
     * @param {string} publicKeyHex 
     * @returns {boolean}
     */
    verify(message, signatureHex, publicKeyHex) {
        try {
            const key = ec.keyFromPublic(publicKeyHex, 'hex');
            const msgHash = CryptoJS.SHA256(message).toString();
            return key.verify(msgHash, signatureHex);
        } catch (e) {
            console.error('[P2P Crypto] Verification failed:', e);
            return false;
        }
    }

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
    /**
     * Encrypt data using a PIN/Password with PBKDF2 + AES
     * Protocol: Salt (16 bytes) + IV (16 bytes) + Ciphertext
     * key = PBKDF2(pin, salt, 10000, 256/32)
     * @param {any} data - Data to encrypt
     * @param {string} pin - The PIN/Password
     * @returns {string} Base64 encoded string of (Salt + IV + Ciphertext)
     */
    encryptWithPin(data, pin) {
        if (!data || !pin) throw new Error('Data and PIN are required');

        // 1. Generate Salt and IV
        const salt = CryptoJS.lib.WordArray.random(128 / 8); // 16 bytes
        const iv = CryptoJS.lib.WordArray.random(128 / 8);   // 16 bytes

        // 2. Derive Key using PBKDF2
        const key = CryptoJS.PBKDF2(pin, salt, {
            keySize: 256 / 32,
            iterations: 10000
        });

        // 3. Encrypt
        const json = JSON.stringify(data);
        const encrypted = CryptoJS.AES.encrypt(json, key, {
            iv: iv,
            padding: CryptoJS.pad.Pkcs7,
            mode: CryptoJS.mode.CBC
        });

        // 4. Combine Salt + IV + Ciphertext
        // We need to access the ciphertext words directly
        const encryptedWords = encrypted.ciphertext;

        // Concatenate: salt + iv + ciphertext
        const combined = salt.clone().concat(iv).concat(encryptedWords);

        // 5. Return as Base64
        return CryptoJS.enc.Base64.stringify(combined);
    }

    /**
     * Decrypt data using a PIN/Password
     * @param {string} encryptedBase64 - The Base64 encoded string (Salt + IV + Ciphertext)
     * @param {string} pin - The PIN/Password
     * @returns {any} Decrypted data
     */
    decryptWithPin(encryptedBase64, pin) {
        if (!encryptedBase64 || !pin) throw new Error('Encrypted data and PIN are required');

        try {
            // 1. Decode Base64
            const combined = CryptoJS.enc.Base64.parse(encryptedBase64);

            // 2. Extract Salt (first 16 bytes = 4 words)
            // Note: WordArray uses 32-bit (4 byte) words
            const salt = CryptoJS.lib.WordArray.create(combined.words.slice(0, 4));

            // 3. Extract IV (next 16 bytes = 4 words)
            const iv = CryptoJS.lib.WordArray.create(combined.words.slice(4, 8));

            // 4. Extract Ciphertext (rest)
            const ciphertext = CryptoJS.lib.WordArray.create(combined.words.slice(8));

            // 5. Derive Key
            const key = CryptoJS.PBKDF2(pin, salt, {
                keySize: 256 / 32,
                iterations: 10000
            });

            // 6. Decrypt
            const decryptParams = {
                ciphertext: ciphertext
            };
            const decrypted = CryptoJS.AES.decrypt(decryptParams, key, {
                iv: iv,
                padding: CryptoJS.pad.Pkcs7,
                mode: CryptoJS.mode.CBC
            });

            const utf8 = decrypted.toString(CryptoJS.enc.Utf8);
            if (!utf8) throw new Error('Decryption resulted in empty data (wrong PIN?)');

            return JSON.parse(utf8);
        } catch (e) {
            console.error('[P2P Crypto] PIN Decryption failed:', e);
            throw new Error('Decryption failed. Incorrect PIN or invalid link.');
        }
    }
}

export const cryptoUtils = new P2PCryptoUtils();
