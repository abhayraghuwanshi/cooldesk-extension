const SIDECAR_HTTP_URL = 'http://127.0.0.1:4000';

async function testFocus() {
    console.log('--- Testing Current Focus API ---');
    try {
        const response = await fetch(`${SIDECAR_HTTP_URL}/activity/focused`);
        const data = await response.json();

        if (data) {
            console.log('✅ Success: Received Focus Data');
            console.log('   App Name:', data.name);
            console.log('   Window Title:', data.title);
            console.log('   PID:', data.pid);
            console.log('   Path:', data.path);

            if (data.name && (data.name.toLowerCase().includes('antigravity') || data.title.toLowerCase().includes('antigravity'))) {
                console.log('\n🌟 Focus verified: Current app is Antigravity!');
            } else {
                console.log('\nℹ️ Current focus is not Antigravity. It is:', data.name || data.title);
            }
        } else {
            console.log('❌ Failed: Received null or empty data from /activity/focused');
        }
    } catch (e) {
        console.error('❌ Error testing focus API:', e.message);
        console.log('   Make sure the sidecar is running at', SIDECAR_HTTP_URL);
    }
}

testFocus();
