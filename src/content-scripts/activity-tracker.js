/**
 * Content Script - Activity Tracking Integration
 * Uses modern ActivityTracker for robust metrics collection
 */

// Inline ActivityTracker class (can't use ES6 imports in content scripts)
class ActivityTracker {
    constructor(url) {
        this.url = url;
        this.startTime = Date.now();
        this.lastActivityTime = Date.now();

        // Metrics
        this.metrics = {
            timeSpent: 0,
            visibleTime: 0,
            scrollDepth: 0,
            maxScrollDepth: 0,
            scrollMilestones: new Set(),
            clicks: 0,
            keypresses: 0,
            forms: 0,
            interactions: [],
            engagementScore: 0
        };

        // State
        this.isVisible = !document.hidden;
        this.visibilityStartTime = this.isVisible ? Date.now() : null;
        this.scrollObserver = null;
        this.eventListeners = [];

        this.init();
    }

    init() {
        this.setupVisibilityTracking();
        this.setupScrollTracking();
        this.setupInteractionTracking();
        this.startTimeTracking();
    }

    setupVisibilityTracking() {
        const handleVisibilityChange = () => {
            const now = Date.now();

            if (document.hidden) {
                if (this.visibilityStartTime) {
                    this.metrics.visibleTime += now - this.visibilityStartTime;
                    this.visibilityStartTime = null;
                }
                this.isVisible = false;
            } else {
                this.visibilityStartTime = now;
                this.isVisible = true;
                this.lastActivityTime = now;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        this.eventListeners.push({ type: 'visibilitychange', handler: handleVisibilityChange });
    }

    setupScrollTracking() {
        // Find the main scroll container
        const findScrollContainer = () => {
            // Common scroll container selectors for SPAs
            const selectors = [
                'main[role="main"]',
                'main',
                '[role="main"]',
                '#__next',
                '.main-content',
                'article',
                '[class*="scroll"]',
                '[class*="content"]'
            ];

            // Try specific selectors first
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.scrollHeight > element.clientHeight + 10) {
                    console.log('[ActivityTracker] Found scroll container:', selector, {
                        scrollHeight: element.scrollHeight,
                        clientHeight: element.clientHeight
                    });
                    return element;
                }
            }

            // Fallback: find any scrollable element
            const allElements = document.querySelectorAll('*');
            for (const element of allElements) {
                const style = window.getComputedStyle(element);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                    element.scrollHeight > element.clientHeight + 10;

                if (isScrollable) {
                    console.log('[ActivityTracker] Found scrollable element:', element.tagName, element.className, {
                        scrollHeight: element.scrollHeight,
                        clientHeight: element.clientHeight
                    });
                    return element;
                }
            }

            // Final fallback to window
            console.log('[ActivityTracker] Using window scroll');
            return window;
        };

        const scrollContainer = findScrollContainer();

        const handleScroll = () => {
            this.updateCurrentScrollDepth(scrollContainer);
            this.lastActivityTime = Date.now();
        };

        if (scrollContainer === window) {
            window.addEventListener('scroll', handleScroll, { passive: true });
            this.eventListeners.push({ type: 'scroll', handler: handleScroll, target: window });
        } else {
            scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
            this.eventListeners.push({ type: 'scroll', handler: handleScroll, target: scrollContainer });
        }

        // Also update scroll depth immediately
        this.updateCurrentScrollDepth(scrollContainer);
    }

    updateCurrentScrollDepth(scrollContainer = window) {
        let windowHeight, documentHeight, scrollTop;

        if (scrollContainer === window) {
            windowHeight = window.innerHeight;
            documentHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
            );
            scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        } else {
            windowHeight = scrollContainer.clientHeight;
            documentHeight = scrollContainer.scrollHeight;
            scrollTop = scrollContainer.scrollTop;
        }

        const scrollableHeight = documentHeight - windowHeight;
        const scrollPercentage = scrollableHeight > 0
            ? Math.round((scrollTop / scrollableHeight) * 100)
            : 100;

        this.metrics.scrollDepth = Math.min(100, Math.max(0, scrollPercentage));
        this.metrics.maxScrollDepth = Math.max(this.metrics.maxScrollDepth, this.metrics.scrollDepth);

        // Track milestones
        [25, 50, 75, 100].forEach(milestone => {
            if (this.metrics.scrollDepth >= milestone) {
                this.metrics.scrollMilestones.add(milestone);
            }
        });

        // Debug log for scroll tracking
        if (this.metrics.scrollDepth > 0) {
            console.log('[ActivityTracker] Scroll depth:', this.metrics.scrollDepth + '%');
        }
    }

    setupInteractionTracking() {
        const handleClick = (e) => {
            this.metrics.clicks++;
            this.lastActivityTime = Date.now();

            const target = e.target;
            const tagName = target.tagName.toLowerCase();

            if (tagName === 'a') {
                this.metrics.interactions.push({ type: 'link', time: Date.now() });
            } else if (tagName === 'button' || target.type === 'submit') {
                this.metrics.interactions.push({ type: 'button', time: Date.now() });
            }
        };

        const handleKeypress = () => {
            this.metrics.keypresses++;
            this.lastActivityTime = Date.now();
        };

        const handleFormSubmit = () => {
            this.metrics.forms++;
            this.metrics.interactions.push({ type: 'form', time: Date.now() });
            this.lastActivityTime = Date.now();
        };

        document.addEventListener('click', handleClick, { passive: true });
        document.addEventListener('keypress', handleKeypress, { passive: true });
        document.addEventListener('submit', handleFormSubmit, { passive: true });

        this.eventListeners.push(
            { type: 'click', handler: handleClick },
            { type: 'keypress', handler: handleKeypress },
            { type: 'submit', handler: handleFormSubmit }
        );
    }

    startTimeTracking() {
        this.timeInterval = setInterval(() => {
            const now = Date.now();
            this.metrics.timeSpent = now - this.startTime;

            if (this.isVisible && this.visibilityStartTime) {
                this.metrics.visibleTime += now - this.visibilityStartTime;
                this.visibilityStartTime = now;
            }

            this.calculateEngagementScore();
        }, 1000);
    }

    calculateEngagementScore() {
        const timeScore = Math.min(30, (this.metrics.visibleTime / 1000) / 10);
        const scrollScore = Math.min(25, this.metrics.maxScrollDepth / 4);
        const interactionScore = Math.min(25, (this.metrics.clicks + this.metrics.keypresses) / 2);
        const formScore = Math.min(20, this.metrics.forms * 10);

        this.metrics.engagementScore = Math.round(timeScore + scrollScore + interactionScore + formScore);
    }

    getMetrics() {
        const now = Date.now();
        this.metrics.timeSpent = now - this.startTime;

        if (this.isVisible && this.visibilityStartTime) {
            this.metrics.visibleTime += now - this.visibilityStartTime;
            this.visibilityStartTime = now;
        }

        this.calculateEngagementScore();

        return {
            ...this.metrics,
            scrollMilestones: Array.from(this.metrics.scrollMilestones),
            interactions: this.metrics.interactions.slice(-10)
        };
    }

    isActivelyEngaged() {
        return (Date.now() - this.lastActivityTime) < 30000;
    }

    destroy() {
        if (this.timeInterval) {
            clearInterval(this.timeInterval);
        }

        if (this.scrollObserver) {
            this.scrollObserver.disconnect();
        }

        this.eventListeners.forEach(({ type, handler, target = document }) => {
            target.removeEventListener(type, handler);
        });

        this.eventListeners = [];
    }
}

// Activity tracking state
let tracker = null;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 5000;

function initializeTracking() {
    const url = window.location.href;

    if (tracker) {
        tracker.destroy();
    }

    tracker = new ActivityTracker(url);
    console.log('[ActivityContent] Tracker initialized for:', url);

    startHeartbeat();
    sendMetrics();
}

function startHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }

    heartbeatInterval = setInterval(() => {
        if (tracker && tracker.isActivelyEngaged()) {
            console.log('[ActivityContent] Sending heartbeat...');
            sendMetrics();
        }
    }, HEARTBEAT_INTERVAL);
}

function sendMetrics() {
    if (!tracker) return;

    const metrics = tracker.getMetrics();

    console.log('[ActivityContent] Sending metrics:', {
        url: window.location.href,
        timeSpent: metrics.timeSpent,
        visibleTime: metrics.visibleTime,
        scrollDepth: metrics.scrollDepth,
        clicks: metrics.clicks,
        engagementScore: metrics.engagementScore
    });

    chrome.runtime.sendMessage({
        type: 'ACTIVITY_HEARTBEAT',
        url: window.location.href,
        metrics: metrics,
        timestamp: Date.now()
    }).then(() => {
        console.log('[ActivityContent] Metrics sent successfully');
    }).catch(err => {
        console.warn('[ActivityContent] Failed to send metrics:', err);
    });
}

function handleUnload() {
    if (tracker) {
        sendMetrics();
        tracker.destroy();
        tracker = null;
    }

    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function handleSPANavigation() {
    let lastUrl = window.location.href;

    const observer = new MutationObserver(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('[ActivityContent] SPA navigation detected:', currentUrl);
            lastUrl = currentUrl;

            if (tracker) {
                sendMetrics();
            }

            initializeTracking();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTracking);
} else {
    initializeTracking();
}

window.addEventListener('beforeunload', handleUnload);
window.addEventListener('pagehide', handleUnload);
handleSPANavigation();
