/**
 * Test file for the Simple Chat API (/llm/v2/simple-chat)
 *
 * This tests the new context-injection based AI that:
 * - Passes user data (workspaces, tabs, activity) as context to LLM
 * - Lets the model naturally understand and respond
 * - Parses JSON actions from responses for workspace modifications
 *
 * Run: node test/test_simple_chat.js
 */

const SIDECAR_PORT = 4545;
const BASE_URL = `http://localhost:${SIDECAR_PORT}`;

// ==========================================
// HELPERS
// ==========================================

async function post(endpoint, data) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return { status: response.status, data: await response.json() };
    } catch (error) {
        return { status: 0, error: error.message };
    }
}

async function get(endpoint) {
    try {
        const response = await fetch(`${BASE_URL}${endpoint}`);
        return { status: response.status, data: await response.json() };
    } catch (error) {
        return { status: 0, error: error.message };
    }
}

function log(icon, message, detail = '') {
    const detailStr = detail ? ` - ${typeof detail === 'object' ? JSON.stringify(detail).slice(0, 200) : detail}` : '';
    console.log(`${icon} ${message}${detailStr}`);
}

// ==========================================
// TEST CASES
// ==========================================

const testCases = [
    {
        name: 'Basic greeting',
        message: 'Hello, what can you help me with?',
        validate: (res) => res.ok && res.response.length > 0
    },
    {
        name: 'List workspaces',
        message: 'What workspaces do I have?',
        validate: (res) => res.ok && res.response.length > 0
    },
    {
        name: 'Suggest URLs for workspace',
        message: 'Suggest some useful URLs for my AI workspace',
        validate: (res) => res.ok && res.response.length > 0
    },
    {
        name: 'Ask about tabs',
        message: 'What tabs do I currently have open?',
        validate: (res) => res.ok && res.response.length > 0
    },
    {
        name: 'Create workspace action',
        message: 'Create a new workspace called "Research" and add wikipedia.org to it',
        validate: (res) => res.ok && (res.actions?.length > 0 || res.response.includes('workspace'))
    },
    {
        name: 'Search history',
        message: 'What sites have I visited recently related to programming?',
        validate: (res) => res.ok && res.response.length > 0
    },
    {
        name: 'Organize tabs',
        message: 'How should I organize my current tabs into workspaces?',
        validate: (res) => res.ok && res.response.length > 0
    }
];

// ==========================================
// TEST RUNNER
// ==========================================

async function checkServerRunning() {
    const result = await get('/health');
    return result.status === 200;
}

async function checkModelLoaded() {
    const result = await get('/llm/status');
    if (result.status === 200 && result.data) {
        return result.data.loaded === true;
    }
    return false;
}

async function runSimpleChatTest(testCase) {
    const requestId = `test-${Date.now()}`;
    const startTime = Date.now();

    const result = await post('/llm/v2/simple-chat', {
        message: testCase.message,
        requestId
    });

    const elapsed = Date.now() - startTime;

    if (result.error) {
        log('❌', testCase.name, `Network error: ${result.error}`);
        return false;
    }

    if (result.status !== 200) {
        log('❌', testCase.name, `HTTP ${result.status}`);
        return false;
    }

    const data = result.data;

    if (!data.ok) {
        log('⚠️', testCase.name, `API error: ${data.error || 'Unknown error'}`);
        return false; // Expected if model not loaded
    }

    const valid = testCase.validate(data);

    if (valid) {
        log('✅', testCase.name, `(${elapsed}ms)`);
        console.log(`   Response: "${data.response.slice(0, 150)}${data.response.length > 150 ? '...' : ''}"`);
        if (data.actions?.length > 0) {
            console.log(`   Actions: ${JSON.stringify(data.actions)}`);
        }
        return true;
    } else {
        log('❌', testCase.name, 'Validation failed');
        console.log(`   Response: ${JSON.stringify(data).slice(0, 200)}`);
        return false;
    }
}

async function runInteractiveTest() {
    console.log('\n--- Interactive Test ---');
    console.log('Enter messages to test (Ctrl+C to exit):\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const askQuestion = () => {
        rl.question('You: ', async (input) => {
            if (!input.trim()) {
                askQuestion();
                return;
            }

            const result = await post('/llm/v2/simple-chat', {
                message: input,
                requestId: `interactive-${Date.now()}`
            });

            if (result.data?.ok) {
                console.log(`\nAI: ${result.data.response}`);
                if (result.data.actions?.length > 0) {
                    console.log(`\nActions: ${JSON.stringify(result.data.actions, null, 2)}`);
                }
            } else {
                console.log(`\nError: ${result.data?.error || result.error || 'Unknown'}`);
            }
            console.log('');
            askQuestion();
        });
    };

    askQuestion();
}

async function main() {
    const args = process.argv.slice(2);
    const interactive = args.includes('--interactive') || args.includes('-i');
    const verbose = args.includes('--verbose') || args.includes('-v');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           Simple Chat API Tests                            ║');
    console.log('║           Endpoint: /llm/v2/simple-chat                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Check server
    console.log('Checking server...');
    if (!await checkServerRunning()) {
        console.log('❌ Sidecar server not running at port', SIDECAR_PORT);
        console.log('   Start the Tauri app first.\n');
        process.exit(1);
    }
    log('✅', 'Server running');

    // Check model
    const modelLoaded = await checkModelLoaded();
    if (modelLoaded) {
        log('✅', 'LLM model loaded');
    } else {
        log('⚠️', 'LLM model not loaded - tests will show errors (expected)');
    }

    if (interactive) {
        await runInteractiveTest();
        return;
    }

    // Run test cases
    console.log('\n=== Running Test Cases ===\n');

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        const result = await runSimpleChatTest(testCase);
        if (result) {
            passed++;
        } else {
            failed++;
        }
        console.log(''); // Spacing
    }

    // Summary
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                     Test Results                           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  ✅ Passed:  ${passed.toString().padEnd(46)}║`);
    console.log(`║  ❌ Failed:  ${failed.toString().padEnd(46)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (!modelLoaded) {
        console.log('Note: Tests require an LLM model to be loaded.');
        console.log('      Load a model via Settings > AI Models in the app.\n');
    }

    if (failed === 0 && passed > 0) {
        console.log('🎉 All tests passed!\n');
    }
}

main().catch(console.error);
