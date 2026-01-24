/**
 * Google Calendar Scraper
 * Scrapes upcoming meetings from the Agenda view OR Grid view (Day/Week)
 * Runs in an invisible tab created by background script, OR passively on user visits.
 */

console.log('[CalendarScraper] Script loaded');

// Configuration
const CONFIG = {
    selectors: {
        // Agenda View
        eventRow: '[role="row"]',
        time: '.shd',
        title: '.Jmftbes',

        // Grid View (Day/Week) - based on user provided HTML
        gridEventChip: 'div[role="button"][data-eventid]',
        gridEventSummary: '.XuJrye', // Contains accessible text like "1:30am to 2:30am, zccc..."

        // Common
        link: 'a[href*="meet.google.com"], a[href*="zoom.us"], a[href*="teams.microsoft.com"]',
    }
};

/**
 * Check if we are in "scraping mode" (forced background tab)
 */
function isScrapingMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('scraping') === 'true';
}

/**
 * Wait for elements to appear
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
}

/**
 * Parse a raw text summary string from Grid View
 * Example: "1:30am to 2:30am, zccc, Abhay Raghuwanshi, No location, January 23, 2026"
 */
function parseSummaryString(text) {
    if (!text) return null;

    // Simple heuristic parsing
    const parts = text.split(',').map(s => s.trim());

    // First part usually time: "1:30am to 2:30am"
    const time = parts[0] || "Unknown Time";

    // Second part usually Title: "zccc"
    const title = parts[1] || "Untitled";

    return { time, title };
}

/**
 * Extract events from the DOM using multiple strategies
 */
function extractEvents() {
    const events = [];
    const seenTitles = new Set();

    // Strategy 0: Schedule/List View (User's specific view)
    // Structure: <div role="presentation" data-eventchip> ... <div role="gridcell">Time</div> ... <div role="button">Title</div>
    const scheduleRows = document.querySelectorAll('div[role="presentation"][data-eventchip]');
    console.log(`[CalendarScraper] Found ${scheduleRows.length} schedule view rows`);

    scheduleRows.forEach(row => {
        try {
            let title = "Unknown";
            let time = "Unknown";

            // Time is usually in the first text-containing gridcell or specifically class FVj2te
            const timeEl = row.querySelector('.FVj2te, .JxNhxc');
            if (timeEl) time = timeEl.textContent;

            // Title is in the button
            const titleBtn = row.querySelector('div[role="button"]');
            if (titleBtn) {
                // Title text
                title = titleBtn.textContent;

                // Fallback: aria-label often has full details "3pm to 4pm, Title, ..."
                if ((title === "Unknown" || title.trim() === "") && titleBtn.ariaLabel) {
                    // Try to parse title from aria-label if text is empty?
                    // Usually textContent is reliable in this view.
                }
            }

            // Clean up
            if (time) time = time.trim();
            if (title) title = title.trim();

            // Deduplication
            const key = `${time}-${title}`;
            if (seenTitles.has(key)) return;
            seenTitles.add(key);

            events.push({
                title: title,
                time: time,
                link: null,
                scrapedAt: Date.now()
            });

        } catch (e) {
            console.warn('[CalendarScraper] Error parsing schedule row', e);
        }
    });

    // Strategy 1: Grid View (User provided structure)
    const gridChips = document.querySelectorAll(CONFIG.selectors.gridEventChip);
    console.log(`[CalendarScraper] Found ${gridChips.length} grid event chips`);

    gridChips.forEach(chip => {
        try {
            let title = "Unknown";
            let time = "Unknown";

            // 1. Try Specific Summary Div
            const summaryDiv = chip.querySelector(CONFIG.selectors.gridEventSummary);
            if (summaryDiv && summaryDiv.textContent) {
                const parsed = parseSummaryString(summaryDiv.textContent);
                if (parsed) {
                    title = parsed.title;
                    time = parsed.time;
                }
            }

            // 2. Fallback: Parse full text content of the chip
            if (title === "Unknown" || time === "Unknown") {
                const fullText = chip.innerText || chip.textContent || "";
                // Example text: "1:30am to 2:30am, Meeting Title, Name..."
                // Or sometimes just "Meeting Title, 1:30am" depending on view

                // regex for time range like "10am - 11am" or "1:30am to 2:30am"
                const timeMatch = fullText.match(/(\d{1,2}(?::\d{2})?(?:am|pm)?\s*(?:to|–|-)\s*\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
                if (timeMatch) {
                    time = timeMatch[0];

                    // If text starts with time
                    if (fullText.startsWith(time)) {
                        const remainder = fullText.substring(time.length).replace(/^,\s*/, '').trim();
                        // Title is likely the next part before comma
                        const titlePart = remainder.split(',')[0];
                        if (titlePart) title = titlePart;
                    }
                } else {
                    // No time range found. Likely an "All Day" event or Holiday.
                    // Heuristic: If it has text but no numbers-based time, assume All Day.
                    if (fullText.length > 3) {
                        time = "All Day";
                        // Formatting: "Republic Day, Monday, January 26" -> Title is just "Republic Day"
                        // Split by comma or new line
                        title = fullText.split(/,|\n/)[0].trim();
                    }
                }
            }

            // Deduplication key
            const key = `${time}-${title}`;
            if (seenTitles.has(key)) return;
            // Ignore trivial ones
            if (title === "Unknown" && time === "Unknown") return;

            seenTitles.add(key);

            events.push({
                title: title,
                time: time,
                link: null,
                scrapedAt: Date.now()
            });

        } catch (e) {
            console.warn('[CalendarScraper] Error parsing grid chip', e);
        }
    });


    // Strategy 2: Agenda View (Roles)
    if (events.length === 0) {
        const eventRows = document.querySelectorAll('[role="row"]');
        console.log(`[CalendarScraper] Found ${eventRows.length} agenda rows`);

        eventRows.forEach(row => {
            try {
                let title = "Unknown Meeting";
                const titleEl = row.querySelector('.ad');
                if (titleEl) title = titleEl.textContent;
                else {
                    const potentialTitles = row.querySelectorAll('span[role="heading"], div[role="button"]');
                    if (potentialTitles.length > 0) title = potentialTitles[0].textContent;
                }

                let time = "All Day";
                const timeEl = row.querySelector('.g3dbUc');
                if (timeEl) time = timeEl.textContent;

                let meetingLink = null;
                const linkEl = row.querySelector(CONFIG.selectors.link);
                if (linkEl) meetingLink = linkEl.href;

                if (title && title.trim() !== "") {
                    const key = `${time}-${title}`;
                    if (seenTitles.has(key)) return;
                    seenTitles.add(key);

                    events.push({
                        title: title.trim(),
                        time: time.trim(),
                        link: meetingLink,
                        scrapedAt: Date.now()
                    });
                }
            } catch (e) {
                console.warn('[CalendarScraper] Error parsing agenda row', e);
            }
        });
    }

    return events;
}

/**
 * Main execution
 */
async function main() {
    const isForced = isScrapingMode();

    console.log('[CalendarScraper] Starting scrape. Forced mode:', isForced);

    try {
        // Wait for the main grid or agenda container
        console.log('[CalendarScraper] Waiting for role="main"...');
        await waitForElement('div[role="main"]', 15000);

        // Give a bit more time for JS rendering
        console.log('[CalendarScraper] Main found, waiting 2s for events to render...');
        await new Promise(r => setTimeout(r, 2000));

        // Scrape
        console.log('[CalendarScraper] Extracting events...');
        const events = extractEvents();
        console.log(`[CalendarScraper] 📊 Scraped ${events.length} events:`, events);

        if (events.length > 0) {
            console.log('[CalendarScraper] Sending events to background...');
            try {
                if (chrome.runtime?.id) {
                    const response = await chrome.runtime.sendMessage({
                        type: 'CALENDAR_EVENTS_SCRAPED',
                        events: events,
                        success: true
                    });
                    console.log('[CalendarScraper] ✅ Data processed by background:', response);
                } else {
                    console.warn('[CalendarScraper] Runtime ID missing, cannot send message.');
                }
            } catch (e) {
                console.warn('[CalendarScraper] ❌ Failed to send events (extension likely reloaded):', e);
            }
        } else {
            console.log('[CalendarScraper] ⚠️ No events found to send. Check selectors if events exist.');
            if (isForced) {
                // Try to dump some DOM info to see what's wrong
                console.log('[CalendarScraper] DEBUG: DOM Dump (Grid Chips):', document.querySelectorAll('[role="button"][data-eventid]').length);
                console.log('[CalendarScraper] DEBUG: DOM Dump (Rows):', document.querySelectorAll('[role="row"]').length);
            }
        }

    } catch (error) {
        console.error('[CalendarScraper] Error:', error);
        if (isForced) {
            try {
                if (chrome.runtime?.id) {
                    chrome.runtime.sendMessage({
                        type: 'CALENDAR_EVENTS_SCRAPED',
                        success: false,
                        error: error.toString()
                    });
                }
            } catch (ignore) { }
        }
    }
}

// execute with debounce
// execute with debounce
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[CalendarScraper] DOMContentLoaded, waiting 1s...');
        setTimeout(main, 1000);
    });
} else {
    console.log('[CalendarScraper] Document ready, waiting 1s...');
    setTimeout(main, 1000);
}

// Re-run on URL change (SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        console.log('[CalendarScraper] URL changed, re-running scrape...');
        setTimeout(main, 2000);
    }
}).observe(document.body, { childList: true, subtree: true });
