// Crypto utilities for asymmetric key generation and signing

function arrayBufferToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Helper function to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

export class CryptoUtils {
    static async generateKeyPair() {
        try {
            // Generate ECDSA key pair (P-256 curve, SHA-256)
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: "ECDSA",
                    namedCurve: "P-256",
                },
                true, // extractable
                ["sign", "verify"]
            );

            // Export the keys in a storable format
            const [publicKey, privateKey] = await Promise.all([
                crypto.subtle.exportKey('jwk', keyPair.publicKey),
                crypto.subtle.exportKey('jwk', keyPair.privateKey)
            ]);

            return {
                publicKey,
                privateKey,
                keyId: crypto.randomUUID()
            };
        } catch (error) {
            console.error('Key generation failed:', error);
            throw error;
        }
    }
    static async signData(privateKeyJwk, data) {
        try {
            // Import the private key
            const privateKey = await crypto.subtle.importKey(
                'jwk',
                privateKeyJwk,
                {
                    name: "RSASSA-PKCS1-v1_5",
                    hash: { name: "SHA-256" },
                },
                false,
                ['sign']
            );

            // Convert data to ArrayBuffer if it's a string
            const encoder = new TextEncoder();
            const dataBuffer = typeof data === 'string'
                ? encoder.encode(data)
                : data;

            // Sign the data
            const signature = await crypto.subtle.sign(
                { name: "RSASSA-PKCS1-v1_5" },
                privateKey,
                dataBuffer
            );

            // Convert signature to base64 for transmission
            return this.arrayBufferToBase64(signature);
        } catch (error) {
            console.error('Error signing data:', error);
            throw error;
        }
    }

    static async verifySignature(publicKeyJwk, signature, data) {
        try {
            // Import the public key
            const publicKey = await crypto.subtle.importKey(
                'jwk',
                publicKeyJwk,
                {
                    name: "RSASSA-PKCS1-v1_5",
                    hash: { name: "SHA-256" },
                },
                false,
                ['verify']
            );

            // Convert data to ArrayBuffer if it's a string
            const encoder = new TextEncoder();
            const dataBuffer = typeof data === 'string'
                ? encoder.encode(data)
                : data;

            // Convert signature from base64 to ArrayBuffer
            const signatureBuffer = this.base64ToArrayBuffer(signature);

            // Verify the signature
            return crypto.subtle.verify(
                { name: "RSASSA-PKCS1-v1_5" },
                publicKey,
                signatureBuffer,
                dataBuffer
            );
        } catch (error) {
            console.error('Error verifying signature:', error);
            return false;
        }
    }

    // Helper method to convert ArrayBuffer to base64
    static arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    // Helper method to convert base64 to ArrayBuffer
    static base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
