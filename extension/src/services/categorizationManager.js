// src/services/categorizationManager.js
import {
    // You need to expose a function to read time series from your DB
    // Assuming it returns an array of { url, metrics: { timeSpent, clicks, ... } }
    getTimeSeriesDataRange,
    listWorkspaceUrls,
    subscribeWorkspaceChanges
} from '../db/index.js';

import './cloudflareService.js';
// Configuration
const CONFIG = {
    ALARM_NAME: 'daily_categorization_sync',
    MIN_ENGAGEMENT_SCORE: 50,
    BATCH_CHUNK_SIZE: 50,
    LOOKBACK_HOURS: 24
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
                this.processDailyBatch();
            }
        });

        isInitialized = true;
        console.log('[CategorizationManager] Daily DB-based service initialized');
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
        }
    },

    async refreshCache() {
        try {
            const urls = await listWorkspaceUrls();
            const urlList = urls.map(u => (typeof u === 'string' ? u : u.url));
            categorizedUrlCache = new Set(urlList);
        } catch (e) {
            console.warn('[CategorizationManager] Failed to refresh cache:', e);
        }
    },

    // NOTE: queueUrl is REMOVED. We no longer queue things manually.

    /**
     * The Daily Cron Job
     * 1. Reads raw activity from DB
     * 2. Aggregates and scores it
     * 3. Filters and sends to Cloudflare
     */

    async processDailyBatch() {
        console.log('[CategorizationManager] ⏰ Starting daily analysis...');

        try {
            // 1. Fetch data from the last 24 hours
            const endTime = Date.now();
            const startTime = endTime - (CONFIG.LOOKBACK_HOURS * 60 * 60 * 1000);

            // Fetch from the DB using the new function
            const rawEvents = await getTimeSeriesDataRange(startTime, endTime);

            if (!rawEvents || rawEvents.length === 0) {
                console.log('[CategorizationManager] No activity in the last 24h.');
                return;
            }

            // 2. Aggregate Data (Group by URL)
            const aggregation = new Map();

            for (const event of rawEvents) {
                // Validate URL based on your data sample
                const url = event.url;
                if (!url || !event.metrics) continue;

                if (!aggregation.has(url)) {
                    aggregation.set(url, { time: 0, clicks: 0, forms: 0, scroll: 0 });
                }

                const stats = aggregation.get(url);
                const m = event.metrics;

                // Accumulate totals
                stats.time += (Number(m.timeSpent) || 0);
                stats.clicks += (Number(m.clicks) || 0);
                stats.forms += (Number(m.forms) || 0);

                // For scroll, we take the MAX depth reached across all sessions
                stats.scroll = Math.max(stats.scroll, (Number(m.scrollDepth) || 0));
            }

            // 3. Score and Filter
            const candidates = [];

            for (const [url, stats] of aggregation.entries()) {
                if (categorizedUrlCache.has(url)) continue;

                // Scoring Logic
                // 1 form = 100 pts (Instant qualify)
                // 1 click = 10 pts
                // 1% scroll = 0.5 pts (50% scroll = 25 pts)
                // 1 second = 0.1 pts (60 seconds = 6 pts)
                const score = (
                    (stats.forms * 100) +
                    (stats.clicks * 10) +
                    (stats.scroll * 0.5) +
                    ((stats.time / 1000) * 0.1)
                );

                if (score >= CONFIG.MIN_ENGAGEMENT_SCORE) {
                    candidates.push(url);
                }
            }

            // ... (Rest of the batch sending logic remains the same)

            if (candidates.length > 0) {
                console.log(`[CategorizationManager] Processing ${candidates.length} URLs`);
                // Call batch API here...
            }

        } catch (error) {
            console.error('[CategorizationManager] Daily process failed:', error);
        }
    }
};