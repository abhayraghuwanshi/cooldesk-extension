const SIDECAR_HTTP_URL = 'http://127.0.0.1:4000';

async function testVisibleApps() {
    console.log('--- Testing Visible Apps API (Strict Filtering) ---');
    try {
        const response = await fetch(`${SIDECAR_HTTP_URL}/activity/visible`);
        const apps = await response.json();

        if (apps && Array.isArray(apps)) {
            console.log(`✅ Success: Found ${apps.length} visible apps`);
            apps.forEach((app, i) => {
                console.log(`${i + 1}. [${app.name}] ${app.title} (PID: ${app.pid})`);
            });

            if (apps.length > 10) {
                console.log('\n⚠️ Warning: Still quite a few apps. Check if these are actually visible windows.');
            } else {
                console.log('\n🌟 Clean results! Only truly visible windows should be listed.');
            }
        } else {
            console.log('❌ Failed: Received invalid data from /activity/visible');
        }
    } catch (e) {
        console.error('❌ Error testing visible apps API:', e.message);
    }
}

testVisibleApps();
