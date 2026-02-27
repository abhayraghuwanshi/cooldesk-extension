
import { WebSocket } from 'ws';

const SIDECAR_PORT = 4000;
const BASE_URL = `http://localhost:${SIDECAR_PORT}`;

/**
 * Test HTTP endpoint helper
 */
async function testHttpEndpoint(endpoint, method = 'GET', data = null) {
    console.log(`\nTesting ${method} ${endpoint}...`);
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
                return { success: true, data: null };
            }
            const json = await response.json();
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

async function runWebSearchTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           Web Search Agent Tests                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Check if model is loaded
    const status = await testHttpEndpoint('/llm/status', 'GET');
    console.log('LLM Status:', JSON.stringify(status.data, null, 2));

    if (!status.data?.modelLoaded) {
        console.log('\n⚠️  Model not loaded. Loading model...');
        const loadResult = await testHttpEndpoint('/llm/load', 'POST', {
            modelName: 'llama-3.2-1b-instruct.Q4_K_M.gguf'
        });
        console.log('Load result:', JSON.stringify(loadResult.data, null, 2));

        // Wait for model to load
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Create a test session
    console.log('\n=== Creating Test Session ===');
    const sessionResult = await testHttpEndpoint('/llm/v2/sessions', 'POST', {});
    const sessionId = sessionResult.data?.sessionId;
    console.log(`Session created: ${sessionId}`);

    // Test 1: Web search for current information
    console.log('\n=== Test 1: Web Search for Current Information ===');
    const test1 = await testHttpEndpoint('/llm/v2/chat', 'POST', {
        sessionId: sessionId,
        message: 'Search the web for information about TypeScript programming',
        requestId: 'web-test-1'
    });
    console.log('\nResponse:', JSON.stringify(test1.data, null, 2));
    if (test1.data?.toolsUsed?.includes('web_search')) {
        console.log('✅ Web search tool was used!');
    } else {
        console.log('⚠️  Web search tool may not have been triggered');
    }

    // Test 2: Ask a question that requires web search
    console.log('\n=== Test 2: Question Requiring Web Search ===');
    const test2 = await testHttpEndpoint('/llm/v2/chat', 'POST', {
        sessionId: sessionId,
        message: 'Use web_search to find what is Node.js',
        requestId: 'web-test-2'
    });
    console.log('\nResponse:', JSON.stringify(test2.data, null, 2));
    if (test2.data?.toolsUsed?.includes('web_search')) {
        console.log('✅ Web search tool was used!');
    } else {
        console.log('⚠️  Web search tool may not have been triggered');
    }

    // Test 3: Combine web search with local data
    console.log('\n=== Test 3: Web Search + Local Data ===');
    const test3 = await testHttpEndpoint('/llm/v2/chat', 'POST', {
        sessionId: sessionId,
        message: 'Search the web for React documentation and also check my workspaces for any React related content',
        requestId: 'web-test-3'
    });
    console.log('\nResponse:', JSON.stringify(test3.data, null, 2));
    console.log('Tools used:', test3.data?.toolsUsed || 'none');

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    Test Summary                             ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  Test 1 (Web search): ' + (test1.data?.ok ? '✅ Passed' : '❌ Failed'));
    console.log('║  Test 2 (Explicit tool use): ' + (test2.data?.ok ? '✅ Passed' : '❌ Failed'));
    console.log('║  Test 3 (Combined search): ' + (test3.data?.ok ? '✅ Passed' : '❌ Failed'));
    console.log('╚════════════════════════════════════════════════════════════╝\n');
}

runWebSearchTests();
