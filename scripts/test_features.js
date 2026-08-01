

const SIDECAR_HTTP_URL = 'http://127.0.0.1:4000';
const SIDECAR_WS_URL = 'ws://127.0.0.1:4000';

async function testFeatures() {
    console.log('--- Testing Main AI Features: Project Creation & URL Enhancement ---\n');

    // 1. Ensure model is loaded (optional but good for test)
    console.log('1. Checking model status...');
    try {
        const statusRes = await fetch(`${SIDECAR_HTTP_URL}/llm/status`);
        const status = await statusRes.json();
        if (!status.modelLoaded) {
            console.log('   Loading model: llama-3.2-1b-instruct...');
            const loadRes = await fetch(`${SIDECAR_HTTP_URL}/llm/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName: 'llama-3.2-1b-instruct.Q4_K_M.gguf', gpuLayers: 33 })
            });
            const loadResult = await loadRes.json();
            if (!loadResult.success) {
                console.error('❌ Failed to load model. Ensure it is downloaded.');
                return;
            }
        }
        console.log('✅ Model ready.\n');
    } catch (e) {
        console.error('❌ Sidecar not reachable. Is it running?', e.message);
        return;
    }

    // 2. Test Project Creation from List
    console.log('2. Testing Project Creation (group-workspaces)...');
    const projectIdeas = [
        "Create a new design system for my personal portfolio website using Tailwind CSS and Framer Motion.",
        "Research the top 5 vector databases for local LLM applications (Chroma, LanceDB, Qdrant, Milvus, Weaviate).",
        "Write a blog post about the benefits of agentic coding assistants in modern web development.",
        "Implement a custom HNSW index in Rust for fast similarity search of memory facts.",
        "Design a premium holographic UI for a browser extension using glassmorphism and acrylic effects."
    ].map((idea, i) => `${i + 1}. ${idea}`).join('\n');

    try {
        const projectRes = await fetch(`${SIDECAR_HTTP_URL}/llm/group-workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: projectIdeas,
                context: 'The user is a full-stack developer working on AI-powered productivity tools.'
            })
        });
        const projectData = await projectRes.json();
        if (projectData.ok && projectData.result) {
            const parsed = JSON.parse(projectData.result);
            console.log('✅ Success: Projects Created');
            console.log('   Groups Found:', parsed.groups.map(g => g.name).join(', '));
            console.log('   Suggestions:', parsed.suggestions?.[0]);
        } else {
            console.error('❌ Project creation failed:', projectData);
        }
    } catch (e) {
        console.error('❌ Error in project creation test:', e.message);
    }

    // 3. Test URL Enhancement
    console.log('\n3. Testing URL Enhancement (enhance-url)...');
    const urlToEnhance = {
        title: "Tauri v2 - Rust-powered desktop apps",
        url: "https://v2.tauri.app/start/",
        contentHint: "Getting started guide for Tauri v2. Learn how to create cross-platform desktop apps with Rust and any frontend framework. Version 2 introduces multi-window support and improved security."
    };

    try {
        const enhanceRes = await fetch(`${SIDECAR_HTTP_URL}/llm/enhance-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(urlToEnhance)
        });
        const enhanceData = await enhanceRes.json();
        if (enhanceData.ok && enhanceData.result) {
            const parsed = JSON.parse(enhanceData.result);
            console.log('✅ Success: URL Enhanced');
            console.log('   New Title:', parsed.title);
            console.log('   Description:', parsed.description);
            console.log('   Tags:', parsed.tags.join(', '));
            console.log('   Category:', parsed.category);
        } else {
            console.error('❌ URL enhancement failed:', enhanceData);
        }
    } catch (e) {
        console.error('❌ Error in URL enhancement test:', e.message);
    }

    // 4. Test Workspace Suggestion
    console.log('\n4. Testing Workspace Suggestion (suggest-workspaces)...');
    const tabsForSuggestion = [
        { title: "React Documentation", url: "https://react.dev" },
        { title: "Vite Guide", url: "https://vitejs.dev" },
        { title: "Tailwind CSS", url: "https://tailwindcss.com" }
    ];

    try {
        const suggestRes = await fetch(`${SIDECAR_HTTP_URL}/llm/suggest-workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: tabsForSuggestion })
        });
        const suggestData = await suggestRes.json();
        if (suggestData.ok && suggestData.suggestions) {
            console.log('✅ Success: Workspace Names Suggested');
            console.log('   Suggestions:', suggestData.suggestions.join(', '));
        } else {
            console.error('❌ Workspace suggestion failed:', suggestData);
        }
    } catch (e) {
        console.error('❌ Error in suggestion test:', e.message);
    }

    // 5. Test Command Parsing
    console.log('\n5. Testing Command Parsing (parse-command)...');
    const commandToParse = {
        command: "Create a new project for my react research",
        context: { current_page: "https://react.dev" }
    };

    try {
        const parseRes = await fetch(`${SIDECAR_HTTP_URL}/llm/parse-command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(commandToParse)
        });
        const parseData = await parseRes.json();
        if (parseData.ok && parseData.parsed) {
            console.log('✅ Success: Command Parsed');
            console.log('   Intent:', parseData.parsed.intent);
            console.log('   Thought:', parseData.parsed.thought);
        } else {
            console.error('❌ Command parsing failed:', parseData);
        }
    } catch (e) {
        console.error('❌ Error in parsing test:', e.message);
    }

    console.log('\n--- Feature Testing Complete ---');
}

testFeatures();
