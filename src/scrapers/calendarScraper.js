/**
 * Google Calendar Scraper
 *
 * NOTE: Auto-scraping functionality has been disabled as per user request.
 * This file remains as a placeholder or for potential future manual trigger use,
 * but auto-execution logic has been removed.
 */

console.log('[CalendarScraper] Script loaded (Inactive)');

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

// Auto-execution logic removed.
// To re-enable, restore the main() execution block and event listeners.
