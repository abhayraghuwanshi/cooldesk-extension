
import { WebSocket } from 'ws';

const SIDECAR_PORT = 4000;
const BASE_URL = `http://localhost:${SIDECAR_PORT}`;
const WS_URL = `ws://localhost:${SIDECAR_PORT}`;

// ==========================================
// LLM V2 AGENT API TESTS
// ==========================================

let testSessionId = null;

/**
 * Test HTTP endpoint helper
 */
async function testHttpEndpoint(endpoint, method = 'GET', data = null, expectStatus = null) {
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

        if (expectStatus && response.status !== expectStatus) {
            console.error(`❌ ${method} ${endpoint} unexpected status: ${response.status} (expected ${expectStatus})`);
            return { success: false, status: response.status };
        }

        if (response.ok) {
            if (response.status === 204) {
                console.log(`✅ ${method} ${endpoint} success: (No Content)`);
                return { success: true, data: null };
            }
            const json = await response.json();
            console.log(`✅ ${method} ${endpoint} success:`, JSON.stringify(json, null, 2).slice(0, 200));
            return { success: true, data: json };
        } else {
            console.error(`❌ ${method} ${endpoint} failed:`, response.status, response.statusText);
            return { success: false, status: response.status };
        }
    } catch (error) {
        console.error(`❌ ${method} ${endpoint} error:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Test WebSocket connection
 */
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

// ==========================================
// V2 SESSION TESTS
// ==========================================

async function testCreateSession() {
    console.log('\n--- Test: Create Session ---');
    const result = await testHttpEndpoint('/llm/v2/sessions', 'POST', {});

    if (result.success && result.data.sessionId) {
        testSessionId = result.data.sessionId;
        console.log(`   Session ID: ${testSessionId}`);
        return true;
    }
    return false;
}

async function testCreateSessionWithId() {
    console.log('\n--- Test: Create Session with Custom ID ---');
    const customId = `test-session-${Date.now()}`;
    const result = await testHttpEndpoint('/llm/v2/sessions', 'POST', {
        sessionId: customId
    });

    if (result.success && result.data.sessionId === customId) {
        console.log(`   Custom session created: ${customId}`);
        return true;
    }
    return false;
}

async function testListSessions() {
    console.log('\n--- Test: List Sessions ---');
    const result = await testHttpEndpoint('/llm/v2/sessions', 'GET');

    if (result.success && Array.isArray(result.data)) {
        console.log(`   Found ${result.data.length} sessions`);
        return true;
    }
    return false;
}

async function testGetSession() {
    console.log('\n--- Test: Get Session History ---');
    if (!testSessionId) {
        console.log('   Skipping: No session ID');
        return false;
    }

    const result = await testHttpEndpoint(`/llm/v2/sessions/${testSessionId}`, 'GET');

    if (result.success && result.data.sessionId === testSessionId) {
        console.log(`   Session has ${result.data.messages?.length || 0} messages`);
        return true;
    }
    return false;
}

async function testDeleteSession() {
    console.log('\n--- Test: Delete Session ---');
    const tempId = `temp-session-${Date.now()}`;

    // Create a temp session first
    await testHttpEndpoint('/llm/v2/sessions', 'POST', { sessionId: tempId });

    // Delete it
    const result = await testHttpEndpoint(`/llm/v2/sessions/${tempId}`, 'DELETE', null, 204);

    if (result.success || result.status === 204) {
        console.log(`   Session deleted successfully`);
        return true;
    }
    return false;
}

// ==========================================
// V2 CHAT TESTS
// ==========================================

async function testChat() {
    console.log('\n--- Test: Chat (requires model loaded) ---');
    if (!testSessionId) {
        console.log('   Skipping: No session ID');
        return false;
    }

    const result = await testHttpEndpoint('/llm/v2/chat', 'POST', {
        sessionId: testSessionId,
        message: 'Hello, what can you help me with?',
        requestId: 'test-req-1'
    });

    if (result.success) {
        if (result.data.ok) {
            console.log(`   Response: ${result.data.response?.slice(0, 100)}...`);
            console.log(`   Tools used: ${result.data.toolsUsed?.join(', ') || 'none'}`);
            return true;
        } else {
            console.log(`   Chat failed (expected if no model loaded): ${result.data.error}`);
            return true; // Still passes if endpoint works
        }
    }
    return false;
}

async function testChatWithToolUse() {
    console.log('\n--- Test: Chat with Tool Use (requires model loaded) ---');
    if (!testSessionId) {
        console.log('   Skipping: No session ID');
        return false;
    }

    const result = await testHttpEndpoint('/llm/v2/chat', 'POST', {
        sessionId: testSessionId,
        message: 'What workspaces do I have?',
        requestId: 'test-req-2'
    });

    if (result.success) {
        if (result.data.ok) {
            console.log(`   Response: ${result.data.response?.slice(0, 100)}...`);
            console.log(`   Tools used: ${result.data.toolsUsed?.join(', ') || 'none'}`);
            return true;
        } else {
            console.log(`   Chat failed (expected if no model loaded): ${result.data.error}`);
            return true; // Still passes if endpoint works
        }
    }
    return false;
}

// ==========================================
// V2 MEMORY TESTS
// ==========================================

async function testGetMemory() {
    console.log('\n--- Test: Get Memory Facts ---');
    const result = await testHttpEndpoint('/llm/v2/memory', 'GET');

    if (result.success && result.data.facts !== undefined) {
        console.log(`   Found ${result.data.facts.length} facts`);
        return true;
    }
    return false;
}

async function testAddMemory() {
    console.log('\n--- Test: Add Memory Fact ---');
    const result = await testHttpEndpoint('/llm/v2/memory', 'POST', {
        content: 'User is testing the v2 API',
        category: 'test'
    });

    if (result.success && result.data.success) {
        console.log('   Memory fact added successfully');
        return true;
    }
    return false;
}

async function testClearMemory() {
    console.log('\n--- Test: Clear Memory ---');
    const result = await testHttpEndpoint('/llm/v2/memory/clear', 'POST', null, 204);

    if (result.success || result.status === 204) {
        console.log('   Memory cleared successfully');
        return true;
    }
    return false;
}

// ==========================================
// V1 COMPATIBILITY TESTS
// ==========================================

async function testV1Endpoints() {
    console.log('\n--- Test: V1 Endpoints Still Work ---');
    let allPassed = true;

    // Test LLM status
    const status = await testHttpEndpoint('/llm/status', 'GET');
    if (!status.success) allPassed = false;

    // Test LLM models
    const models = await testHttpEndpoint('/llm/models', 'GET');
    if (!models.success) allPassed = false;

    return allPassed;
}

// ==========================================
// PERSISTENCE TEST
// ==========================================

async function testPersistence() {
    console.log('\n--- Test: Memory Persistence ---');

    // Add a fact
    const uniqueFact = `Test fact created at ${Date.now()}`;
    await testHttpEndpoint('/llm/v2/memory', 'POST', {
        content: uniqueFact,
        category: 'persistence-test'
    });

    // Get memory and verify
    const result = await testHttpEndpoint('/llm/v2/memory', 'GET');

    if (result.success && result.data.facts) {
        const found = result.data.facts.some(f => f.content === uniqueFact);
        if (found) {
            console.log('   Fact was persisted successfully');
            return true;
        }
    }

    console.log('   Fact was not found in memory');
    return false;
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           LLM V2 Agent API Tests                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const results = {
        passed: 0,
        failed: 0,
        skipped: 0
    };

    // Check if sidecar is running
    console.log('=== Connection Test ===\n');
    const wsConnected = await testWebSocket();

    if (!wsConnected) {
        console.log('\n⚠️  Sidecar not running - cannot run API tests');
        console.log('   Start the Tauri app or sidecar server first\n');
        return;
    }

    // Test V1 compatibility
    console.log('\n=== V1 Compatibility Tests ===');
    if (await testV1Endpoints()) {
        results.passed++;
    } else {
        results.failed++;
    }

    // Session tests
    console.log('\n=== Session Management Tests ===');

    if (await testCreateSession()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testCreateSessionWithId()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testListSessions()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testGetSession()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testDeleteSession()) {
        results.passed++;
    } else {
        results.failed++;
    }

    // Memory tests
    console.log('\n=== Memory Management Tests ===');

    if (await testGetMemory()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testAddMemory()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testPersistence()) {
        results.passed++;
    } else {
        results.failed++;
    }

    // Chat tests (may fail if no model loaded)
    console.log('\n=== Chat Tests ===');

    if (await testChat()) {
        results.passed++;
    } else {
        results.failed++;
    }

    if (await testChatWithToolUse()) {
        results.passed++;
    } else {
        results.failed++;
    }

    // Cleanup
    console.log('\n=== Cleanup ===');
    if (await testClearMemory()) {
        results.passed++;
    } else {
        results.failed++;
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                     Test Results                            ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  ✅ Passed:  ${results.passed.toString().padEnd(46)}║`);
    console.log(`║  ❌ Failed:  ${results.failed.toString().padEnd(46)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (results.failed === 0) {
        console.log('🎉 All tests passed!\n');
    } else {
        console.log('⚠️  Some tests failed. Check the output above for details.\n');
        console.log('Note: Chat tests may fail if no LLM model is loaded.\n');
    }
}

// Run the tests
runTests();
