
import { WebSocket } from 'ws';
import { performance } from 'perf_hooks';

const SIDECAR_PORT = 4000;
const BASE_URL = `http://localhost:${SIDECAR_PORT}`;
const WS_URL = `ws://localhost:${SIDECAR_PORT}`;

// ==========================================
// SEARCH PERFORMANCE TEST
// ==========================================

/**
 * Simulates the in-memory search to verify performance
 * Target: < 5ms for filtering 500+ items
 */
function testSearchPerformance() {
    console.log('\n=== Search Performance Test ===\n');

    // Simulate cached data (realistic sizes)
    const mockInstalledApps = Array.from({ length: 200 }, (_, i) => ({
        name: `Application ${i} ${['Chrome', 'Firefox', 'VSCode', 'Slack', 'Discord'][i % 5]}`,
        path: `C:\\Program Files\\App${i}\\app.exe`,
        icon: null
    }));

    const mockRunningApps = Array.from({ length: 50 }, (_, i) => ({
        name: `Process ${i}`,
        pid: 1000 + i,
        title: `Window Title ${i}`
    }));

    const mockTabs = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        title: `Tab Title ${i} - Some Website`,
        url: `https://example${i}.com/page`
    }));

    const mockHistory = Array.from({ length: 100 }, (_, i) => ({
        id: `hist-${i}`,
        title: `History Item ${i}`,
        url: `https://visited${i}.com/page`
    }));

    const mockBookmarks = Array.from({ length: 50 }, (_, i) => ({
        id: `bm-${i}`,
        title: `Bookmark ${i}`,
        url: `https://bookmarked${i}.com`
    }));

    const totalItems = mockInstalledApps.length + mockRunningApps.length +
        mockTabs.length + mockHistory.length + mockBookmarks.length;

    console.log(`Total cached items: ${totalItems}\n`);

    // Simulate searchElectronCache function
    function searchCache(query) {
        const results = [];
        const q = query.toLowerCase();

        // Search installed apps
        for (const app of mockInstalledApps) {
            if ((app.name || '').toLowerCase().includes(q)) {
                results.push({ ...app, type: 'app', score: 75 });
            }
        }

        // Search running apps
        for (const app of mockRunningApps) {
            if ((app.name || '').toLowerCase().includes(q) ||
                (app.title || '').toLowerCase().includes(q)) {
                results.push({ ...app, type: 'app', isRunning: true, score: 90 });
            }
        }

        // Search tabs
        for (const tab of mockTabs) {
            if ((tab.title || '').toLowerCase().includes(q) ||
                (tab.url || '').toLowerCase().includes(q)) {
                results.push({ ...tab, type: 'tab', score: 80 });
            }
        }

        // Search history
        for (const h of mockHistory) {
            if ((h.title || '').toLowerCase().includes(q) ||
                (h.url || '').toLowerCase().includes(q)) {
                results.push({ ...h, type: 'history', score: 55 });
            }
        }

        // Search bookmarks
        for (const b of mockBookmarks) {
            if ((b.title || '').toLowerCase().includes(q) ||
                (b.url || '').toLowerCase().includes(q)) {
                results.push({ ...b, type: 'bookmark', score: 65 });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }

    // Run search tests
    const queries = ['app', 'chrome', 'a', 'tab', 'example', 'bookmark', 'process', 'vscode'];
    const iterations = 100;

    let allPassed = true;

    for (const query of queries) {
        const times = [];
        let resultCount = 0;

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            const results = searchCache(query);
            times.push(performance.now() - start);
            resultCount = results.length;
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);

        const passed = avgTime < 5;
        if (!passed) allPassed = false;

        const status = passed ? '✅' : avgTime < 10 ? '⚠️' : '❌';
        console.log(`${status} Query "${query}": avg=${avgTime.toFixed(2)}ms, min=${minTime.toFixed(2)}ms, max=${maxTime.toFixed(2)}ms, results=${resultCount}`);
    }

    console.log('\nTarget: < 5ms average per search');
    console.log(allPassed ? '✅ All tests passed!' : '❌ Some tests failed');
    return allPassed;
}

async function testHttpEndpoint(endpoint, method = 'GET', data = null) {
    console.log(`Testing ${method} ${endpoint}...`);
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        if (data) {
            options.body = JSON.stringify(data);
        }
        const response = await fetch(`${BASE_URL}${endpoint}`, options);
        if (response.ok) {
            if (response.status === 204) {
                console.log(`✅ ${method} ${endpoint} success: (No Content)`);
                return true;
            }
            const json = await response.json();
            console.log(`✅ ${method} ${endpoint} success:`, Object.keys(json));
            return true;
        } else {
            console.error(`❌ ${method} ${endpoint} failed:`, response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.error(`❌ ${method} ${endpoint} error:`, error.message);
        return false;
    }
}

async function testWebSocket() {
    console.log('Testing WebSocket connection...');
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL);

        const timeout = setTimeout(() => {
            console.error('❌ WebSocket connection timed out');
            ws.terminate();
            resolve(false);
        }, 5000);

        ws.on('open', () => {
            console.log('✅ WebSocket connected');
            ws.send(JSON.stringify({ type: 'ping' }));
        });

        ws.on('message', (data) => {
            console.log('✅ WebSocket received message:', data.toString());
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        });

        ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
            clearTimeout(timeout);
            resolve(false);
        });
    });
}

async function runTests() {
    console.log('Starting Sidecar API Tests...\n');

    // 0. Test Search Performance (no network required)
    testSearchPerformance();

    // 1. Test WebSocket
    console.log('\n=== Sidecar Connection Tests ===\n');
    const wsSuccess = await testWebSocket();

    if (!wsSuccess) {
        console.log('\n⚠️  Sidecar not running - skipping API tests');
        console.log('   Start sidecar with: node sidecar/server.js\n');
        return;
    }

    // 2. Test GET Endpoints
    const endpoints = [
        '/workspaces',
        '/notes',
        '/settings',
        '/daily-memory'
    ];

    for (const endpoint of endpoints) {
        await testHttpEndpoint(endpoint);
    }

    // 3. Test POST Endpoint (Sync)
    await testHttpEndpoint('/notes', 'POST', {
        testNote: { id: 'test-1', content: 'Hello Sidecar', updatedAt: Date.now() }
    });

    console.log('\nTests completed.');
}

runTests();
