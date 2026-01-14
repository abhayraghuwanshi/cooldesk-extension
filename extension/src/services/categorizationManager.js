// src/services/categorizationManager.js
import { CryptoUtils } from '../utils/cryptoUtils.js';
import { CloudflareService } from './cloudflareService.js';

// Configuration
const CONFIG = {
    ALARM_NAME: 'daily_categorization_sync',
    MIN_ENGAGEMENT_SCORE: 50,
    BATCH_CHUNK_SIZE: 50,
    LOOKBACK_HOURS: 24,
    SIGNATURE_TTL: 5 * 60 * 1000 // 5 minutes
};

let categorizedUrlCache = new Set();
let isInitialized = false;

export const CategorizationManager = {
    async init() {
        if (isInitialized) return;

        await this.refreshCache();
        if (typeof subscribeWorkspaceChanges === 'function') {
            subscribeWorkspaceChanges(() => this.refreshCache());
        }

        await this.setupDailyAlarm();

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === CONFIG.ALARM_NAME) {
                this.processDailyBatch().catch(console.error);
            }
        });

        isInitialized = true;
        console.log('[CategorizationManager] Daily DB-based service initialized');
    },

    async refreshCache() {
        try {
            const urls = await listWorkspaceUrls();
            const urlList = urls.map(u => (typeof u === 'string' ? u : u.url));
            categorizedUrlCache = new Set(urlList);
            console.log(`[CategorizationManager] Refreshed cache with ${urlList.length} URLs`);
        } catch (e) {
            console.warn('[CategorizationManager] Failed to refresh cache:', e);
            throw e;
        }
    },

    async setupDailyAlarm() {
        const alarm = await chrome.alarms.get(CONFIG.ALARM_NAME);
        if (!alarm) {
            // Randomize start time to distribute server load
            const randomDelayMinutes = Math.floor(Math.random() * 1440) + 1;
            chrome.alarms.create(CONFIG.ALARM_NAME, {
                delayInMinutes: randomDelayMinutes,
                periodInMinutes: 1440 // 24 hours
            });
            console.log(`[CategorizationManager] Created daily alarm with ${randomDelayMinutes} min delay`);
        }
    },

    async signRequestData(data) {
        try {
            const auth = await getAuth();
            if (!auth?.keyPair?.privateKey) {
                throw new Error('No private key available for signing');
            }

            const timestamp = Date.now();
            const payload = {
                ...data,
                timestamp,
                expires: timestamp + CONFIG.SIGNATURE_TTL
            };

            const signature = await CryptoUtils.signData(
                auth.keyPair.privateKey,
                JSON.stringify(payload)
            );

            return {
                ...payload,
                signature,
                keyId: auth.user?.keyId
            };
        } catch (error) {
            console.error('[CategorizationManager] Error signing request:', error);
            throw error;
        }
    },

    async processDailyBatch(params = {}) {
        console.log('[CategorizationManager] ⏰ Starting daily analysis...', { params });

        try {
            // 1. Get auth and validate
            const auth = await getAuth();
            if (!auth?.keyPair?.privateKey || !auth.user?.uid) {
                throw new Error('Authentication required for categorization');
            }

            // 2. Fetch recent activity with configurable lookback
            const endTime = Date.now();
            const lookbackHours = params.lookbackHours || CONFIG.LOOKBACK_HOURS;
            const startTime = endTime - (lookbackHours * 60 * 60 * 1000);

            console.log(`[CategorizationManager] Fetching data from last ${lookbackHours} hours`);

            const rawEvents = await getTimeSeriesDataRange(startTime, endTime);

            if (!rawEvents?.length) {
                console.log('[CategorizationManager] No activity found in the specified time range');
                return { processed: 0, failed: 0, successful: [] };
            }

            // 3. Process and score URLs
            const { candidates } = this.analyzeActivity(rawEvents, params);
            if (candidates.length === 0) {
                console.log('[CategorizationManager] No URLs met the minimum engagement score');
                return { processed: 0, failed: 0, successful: [] };
            }

            // 4. Apply limit if specified
            const limit = params.limit > 0 ? Math.min(params.limit, candidates.length) : candidates.length;
            const candidatesToProcess = candidates.slice(0, limit);

            console.log(`[CategorizationManager] Processing ${candidatesToProcess.length} URLs`);

            // 5. Sign the request data
            const signedRequest = await this.signRequestData({
                urls: candidatesToProcess.map(c => c.url),
                userId: auth.user.uid
            });

            // 6. Call Cloudflare service
            const batchResults = await CloudflareService.categorizeBatch(
                signedRequest,
                auth.user.uid
            );

            // 7. Process and return results
            return this.processCategorizationResults(batchResults, candidatesToProcess);

        } catch (error) {
            console.error('[CategorizationManager] Error in processDailyBatch:', error);
            throw error;
        }
    },

    analyzeActivity(events, params = {}) {
        const aggregation = new Map();
        const candidates = [];

        // Aggregate metrics by URL
        for (const event of events) {
            if (!event?.url || !event.metrics) continue;

            const url = event.url;
            if (!aggregation.has(url)) {
                aggregation.set(url, { time: 0, clicks: 0, forms: 0, scroll: 0 });
            }

            const stats = aggregation.get(url);
            const m = event.metrics;

            stats.time += (Number(m.timeSpent) || 0);
            stats.clicks += (Number(m.clicks) || 0);
            stats.forms += (Number(m.forms) || 0);
            stats.scroll = Math.max(stats.scroll, (Number(m.scrollDepth) || 0));
        }

        // Score and filter URLs
        for (const [url, stats] of aggregation.entries()) {
            // Skip if URL is already categorized and we're not forcing reprocessing
            if (!params.force && categorizedUrlCache.has(url)) {
                continue;
            }

            const score = (
                (stats.forms * 100) +
                (stats.clicks * 10) +
                (stats.scroll * 0.5) +
                ((stats.time / 1000) * 0.1)
            );

            if (score >= CONFIG.MIN_ENGAGEMENT_SCORE) {
                candidates.push({
                    url,
                    score,
                    stats,
                    lastSeen: stats.lastSeen // Make sure this is set when aggregating
                });
            }
        }

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);

        return { candidates, aggregation };
    },

    async processCategorizationResults(results, candidates) {
        const successful = [];
        const failed = [];

        if (!Array.isArray(results)) {
            throw new Error('Invalid results format from categorization service');
        }

        results.forEach((result, index) => {
            const candidate = candidates[index];
            if (!candidate) return;

            if (result.success) {
                successful.push({
                    url: candidate.url,
                    category: result.category,
                    score: candidate.score,
                    stats: candidate.stats
                });
                categorizedUrlCache.add(candidate.url);
            } else {
                failed.push({
                    url: candidate.url,
                    error: result.error || 'Unknown error'
                });
            }
        });

        console.log(`[CategorizationManager] Processed ${successful.length} URLs successfully, ${failed.length} failed`);
        return { processed: successful.length, failed: failed.length, successful, failed };
    }
};