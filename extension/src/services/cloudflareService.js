// src/services/cloudflareService.js
import { arrayBufferToBase64 } from '../utils/cryptoUtils.js';
const CLOUDFLARE_WORKER_URL = 'https://cool-desk.raghuwanshi-abhay405.workers.dev';

export class CloudflareService {
    /**
     * Make an authenticated request with ECDSA signature
     * @private
     */
    // In src/services/cloudflareService.js

    /**
     * Make an authenticated request with ECDSA signature, and optionally, a Bearer token.
     * @private
     */
    static async fetchWithAuth(url, method, privateKey, userId, body = null, idToken = null) {
        const timestamp = Date.now().toString();
        const fullUrl = `${CLOUDFLARE_WORKER_URL}${url}`;

        try {
            // Create signature (This part remains the same)
            const payloadString = `${method}:${fullUrl}:${timestamp}`;
            const encoder = new TextEncoder();
            const data = encoder.encode(payloadString);

            const signatureBuffer = await crypto.subtle.sign(
                {
                    name: "ECDSA",
                    hash: { name: "SHA-256" }
                },
                privateKey,
                data
            );

            const signatureBase64 = arrayBufferToBase64(signatureBuffer);

            // --- 🔑 Authentication Headers Setup ---
            const headers = {
                'Content-Type': 'application/json',
                'X-User-Id': userId,
                'X-Timestamp': timestamp,
                'X-Signature': signatureBase64 // ECDSA Signature for request integrity
            };

            // **NEW: Add Authorization header if idToken is provided**
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`; // Google ID Token for user identity
            }
            // --- -------------------------------- ---

            // Make the request
            const response = await fetch(fullUrl, {
                method,
                headers: headers, // Use the dynamically created headers object
                body: body ? JSON.stringify(body) : null
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.message || `HTTP error! status: ${response.status}`);
            }

            return response;
        } catch (error) {
            console.error('Request error in fetchWithAuth:', error);
            throw error;
        }
    }

    /**
     * Categorize a URL using the Cloudflare Worker
     */
    static async categorizeUrl(url, privateKey, userId, save = false) {
        try {
            const response = await this.fetchWithAuth(
                `/api/categorize${save ? '?save=true' : ''}`,
                'POST',
                privateKey,
                userId,
                { url }
            );
            return await response.json();
        } catch (error) {
            console.error('Categorization error:', error);
            throw error;
        }
    }

    /**
     * Get workspace by ID
     */
    static async getWorkspace(workspaceId, privateKey, userId) {
        try {
            const response = await this.fetchWithAuth(
                `/workspace?id=${encodeURIComponent(workspaceId)}`,
                'GET',
                privateKey,
                userId
            );
            return await response.json();
        } catch (error) {
            console.error('Fetch workspace error:', error);
            throw error;
        }
    }

    /**
     * Register a public key with the server
     */
    static async registerKey({ keyId, publicKey }, privateKey, userId, idToken) {
        try {
            const response = await this.fetchWithAuth(
                '/api/register-key',
                'POST',
                privateKey,
                userId,
                { keyId, publicKey },
                idToken // <-- PASS idToken here
            );
            return await response.json();
        } catch (error) {
            console.error('Key registration error:', error);
            throw error;
        }
    }

    /**
     * Save a new workspace
     */
    static async saveWorkspace(workspace, privateKey, userId) {
        try {
            const response = await this.fetchWithAuth(
                '/api/workspaces',
                'POST',
                privateKey,
                userId,
                workspace
            );
            return await response.json();
        } catch (error) {
            console.error('Save workspace error:', error);
            throw error;
        }
    }

    /**
     * Update an existing workspace
     */
    static async updateWorkspace(workspaceId, updates, privateKey, userId) {
        try {
            const response = await this.fetchWithAuth(
                `/api/workspaces/${workspaceId}`,
                'PUT',
                privateKey,
                userId,
                updates
            );
            return await response.json();
        } catch (error) {
            console.error('Update workspace error:', error);
            throw error;
        }
    }

    /**
     * Delete a workspace
     */
    static async deleteWorkspace(workspaceId, privateKey, userId) {
        try {
            const response = await this.fetchWithAuth(
                `/api/workspaces/${workspaceId}`,
                'DELETE',
                privateKey,
                userId
            );
            return await response.json();
        } catch (error) {
            console.error('Delete workspace error:', error);
            throw error;
        }
    }

    static async categorizeBatch(urls, privateKey, userId) {
        try {
            const response = await this.fetchWithAuth(
                '/api/categorize-batch',
                'POST',
                privateKey,
                userId,
                { urls } // Send array of URLs
            );
            return await response.json();
        } catch (error) {
            console.error('Batch categorization error:', error);
            throw error;
        }
    }
}

// Example usage:
// const privateKey = ...; // Your private key from crypto.subtle
// const userId = 'user123';
//
// // Categorize URL
// const result = await CloudflareService.categorizeUrl(
//     'https://example.com',
//     privateKey,
//     userId,
//     true
// );
//
// // Save workspace
// const workspace = await CloudflareService.saveWorkspace(
//     {
//         title: 'My Workspace',
//         url: 'https://example.com',
//         // ... other workspace data
//     },
//     privateKey,
//     userId
// );