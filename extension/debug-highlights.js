// DEBUG SCRIPT - Paste this in console to see why highlights aren't rendering
// This will manually call renderInlineHighlight with detailed logging

console.log('=== HIGHLIGHT DEBUG START ===');

// Get the shadow root
const shadowHost = document.getElementById('cooldesk-floating-button');
if (!shadowHost) {
    console.error('ERROR: CoolDesk not injected on this page');
} else {
    console.log('✓ Found CoolDesk shadow host');

    // Fetch highlights from DB
    chrome.runtime.sendMessage({ action: 'getUrlNotes', url: window.location.href }, (response) => {
        console.log('DB Response:', response);

        if (response && response.success && response.notes) {
            const highlights = response.notes.filter(n => n.type === 'highlight');
            console.log('Found', highlights.length, 'highlights in DB');

            highlights.forEach((note, idx) => {
                console.log(`\n--- Highlight ${idx + 1} ---`);
                console.log('ID:', note.id);
                console.log('Text (first 100 chars):', note.text.substring(0, 100));
                console.log('Full text length:', note.text.length);

                // Try to find the text on the page
                const searchStr = note.text.trim().replace(/\s+/g, ' ');
                const pageText = document.body.innerText;

                if (pageText.includes(searchStr)) {
                    console.log('✓ Text FOUND on page (simple search)');
                } else {
                    console.log('✗ Text NOT FOUND on page');
                    console.log('Trying fuzzy match...');

                    // Try first 50 chars
                    const shortStr = searchStr.substring(0, 50);
                    if (pageText.includes(shortStr)) {
                        console.log('  → First 50 chars found!');
                    } else {
                        console.log('  → First 50 chars also not found');
                    }
                }

                // Check if already highlighted
                const existingMarks = document.querySelectorAll(`mark.cooldesk-text-highlight[data-id="${note.id}"]`);
                console.log('Existing marks on page:', existingMarks.length);
            });
        } else {
            console.log('No notes in response or fetch failed');
        }

        console.log('\n=== HIGHLIGHT DEBUG END ===');
    });
}
