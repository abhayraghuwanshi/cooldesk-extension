const DB_NAME = 'ActivityTimeSeriesDB'
const DB_VERSION = 1
const ACTIVITY_TIME_SERIES_STORE = 'activityTimeSeries'

let dbCache = null

/**
 * Open or create the IndexedDB database
 */
async function openDB() {
    if (dbCache) return dbCache

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => {
            console.error('Failed to open notes database:', request.error)
            reject(request.error)
        }

        request.onsuccess = () => {
            dbCache = request.result

            // Handle unexpected database closure
            dbCache.onclose = () => {
                console.warn('Notes database connection closed unexpectedly')
                dbCache = null
            }

            // Handle version change while database is open
            dbCache.onversionchange = () => {
                console.warn('Notes database version changed, closing connection')
                dbCache.close()
                dbCache = null
            }

            resolve(dbCache)
        }

        request.onupgradeneeded = (event) => {
            const db = event.target.result

            // Create notes object store if it doesn't exist
            if (!db.objectStoreNames.contains(ACTIVITY_TIME_SERIES_STORE)) {
                const store = db.createObjectStore(ACTIVITY_TIME_SERIES_STORE, {
                    keyPath: 'id'
                })

                // Create indexes for efficient querying
                store.createIndex('url', 'url', { unique: false })
                store.createIndex('timestamp', 'timestamp', { unique: false })
                store.createIndex('sessionId', 'sessionId', { unique: false })
                store.createIndex('url_timestamp', ['url', 'timestamp'], { unique: false })

                console.log('Created notes object store with indexes')
            }
        }

        request.onblocked = () => {
            console.warn('Notes database upgrade blocked by another connection')
        }
    })
}

export async function putActivityRow(record) {
    if (!record || !record.url) return;
    const db = await openDB();
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readwrite');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        } catch { resolve(); }
    });
}

export async function getAllActivity() {
    const db = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readonly');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const req = store.getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch { resolve([]); }
    });
}

// ===== Time Series Activity APIs =====

export async function putActivityTimeSeriesEvent(event) {
    if (!event || !event.url || !event.timestamp) return;
    const db = await openDB();
    await new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readwrite');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const req = store.put(event);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        } catch { resolve(); }
    });
}

export async function getActivityTimeSeriesByUrl(url, startTime = 0, endTime = Date.now()) {
    const db = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readonly');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const index = store.index('by_url_timestamp');
            const range = IDBKeyRange.bound([url, startTime], [url, endTime]);
            const req = index.getAll(range);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch { resolve([]); }
    });
}

export async function getActivityTimeSeriesByTimeRange(startTime, endTime = Date.now()) {
    const db = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readonly');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const index = store.index('by_timestamp');
            const range = IDBKeyRange.bound(startTime, endTime);
            const req = index.getAll(range);
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => resolve([]);
        } catch { resolve([]); }
    });
}

// Data retention and cleanup
export async function cleanupOldTimeSeriesData(retentionDays = 30) {
    const db = await openDB();
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readwrite');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const index = store.index('by_timestamp');
            const range = IDBKeyRange.upperBound(cutoffTime);

            let deletedCount = 0;
            const request = index.openCursor(range);

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`[Cleanup] Deleted ${deletedCount} old time series events`);
                    resolve(deletedCount);
                }
            };

            request.onerror = () => resolve(0);
        } catch {
            resolve(0);
        }
    });
}

export async function getTimeSeriesStorageStats() {
    const db = await openDB();
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(ACTIVITY_TIME_SERIES_STORE, 'readonly');
            const store = tx.objectStore(ACTIVITY_TIME_SERIES_STORE);
            const countRequest = store.count();

            countRequest.onsuccess = () => {
                const totalEvents = countRequest.result;
                const estimatedSizeMB = (totalEvents * 0.5) / 1024; // ~500 bytes per event

                // Get oldest and newest timestamps
                const index = store.index('by_timestamp');
                const oldestRequest = index.openCursor();
                const newestRequest = index.openCursor(null, 'prev');

                let oldest = null, newest = null;

                oldestRequest.onsuccess = (e) => {
                    if (e.target.result) oldest = e.target.result.value.timestamp;

                    newestRequest.onsuccess = (e2) => {
                        if (e2.target.result) newest = e2.target.result.value.timestamp;

                        resolve({
                            totalEvents,
                            estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
                            oldestEvent: oldest,
                            newestEvent: newest,
                            spanDays: oldest && newest ? Math.round((newest - oldest) / (24 * 60 * 60 * 1000)) : 0
                        });
                    };
                };
            };

            countRequest.onerror = () => resolve({ totalEvents: 0, estimatedSizeMB: 0 });
        } catch {
            resolve({ totalEvents: 0, estimatedSizeMB: 0 });
        }
    });
}

export async function getActivityAnalytics(url = null, days = 7) {
    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);

    // Limit query size for performance
    const MAX_EVENTS = 10000;
    let events = url
        ? await getActivityTimeSeriesByUrl(url, startTime, endTime)
        : await getActivityTimeSeriesByTimeRange(startTime, endTime);

    // Sample data if too large
    if (events.length > MAX_EVENTS) {
        const step = Math.ceil(events.length / MAX_EVENTS);
        events = events.filter((_, i) => i % step === 0);
        console.warn(`[Analytics] Sampled ${events.length} events from ${events.length * step} total`);
    }

    // Aggregate analytics
    const analytics = {
        totalTime: 0,
        totalClicks: 0,
        totalForms: 0,
        avgScrollDepth: 0,
        sessionsCount: new Set(),
        dailyBreakdown: {},
        hourlyPattern: Array(24).fill(0),
        topUrls: {},
    };

    events.forEach(event => {
        const { metrics, sessionId, timestamp } = event;
        analytics.totalTime += metrics.timeSpent || 0;
        analytics.totalClicks += metrics.clicks || 0;
        analytics.totalForms += metrics.forms || 0;
        analytics.sessionsCount.add(sessionId);

        // Daily breakdown
        const day = new Date(timestamp).toDateString();
        if (!analytics.dailyBreakdown[day]) {
            analytics.dailyBreakdown[day] = { time: 0, clicks: 0, forms: 0, sessions: new Set() };
        }
        analytics.dailyBreakdown[day].time += metrics.timeSpent || 0;
        analytics.dailyBreakdown[day].clicks += metrics.clicks || 0;
        analytics.dailyBreakdown[day].forms += metrics.forms || 0;
        analytics.dailyBreakdown[day].sessions.add(sessionId);

        // Hourly pattern
        const hour = new Date(timestamp).getHours();
        analytics.hourlyPattern[hour] += metrics.timeSpent || 0;

        // Top URLs
        if (!url) {
            if (!analytics.topUrls[event.url]) {
                analytics.topUrls[event.url] = { time: 0, clicks: 0, forms: 0 };
            }
            analytics.topUrls[event.url].time += metrics.timeSpent || 0;
            analytics.topUrls[event.url].clicks += metrics.clicks || 0;
            analytics.topUrls[event.url].forms += metrics.forms || 0;
        }
    });

    // Convert sets to counts
    analytics.sessionsCount = analytics.sessionsCount.size;
    Object.keys(analytics.dailyBreakdown).forEach(day => {
        analytics.dailyBreakdown[day].sessions = analytics.dailyBreakdown[day].sessions.size;
    });

    // Calculate average scroll depth
    const scrollEvents = events.filter(e => e.metrics.scrollDepth > 0);
    analytics.avgScrollDepth = scrollEvents.length > 0
        ? scrollEvents.reduce((sum, e) => sum + e.metrics.scrollDepth, 0) / scrollEvents.length
        : 0;

    return {
        ...analytics,
        sampledData: events.length < (url ? 1000 : 5000), // Indicate if data was sampled
        queriedEvents: events.length
    };
}
