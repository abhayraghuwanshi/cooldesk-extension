/**
 * Modern Activity Tracker
 * Uses IntersectionObserver, Page Visibility API, and event delegation
 * for robust, accurate activity tracking
 */

export class ActivityTracker {
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
            scrollMilestones: new Set(), // 25, 50, 75, 100
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

    /**
     * Track page visibility using Page Visibility API
     */
    setupVisibilityTracking() {
        const handleVisibilityChange = () => {
            const now = Date.now();

            if (document.hidden) {
                // Page became hidden - accumulate visible time
                if (this.visibilityStartTime) {
                    this.metrics.visibleTime += now - this.visibilityStartTime;
                    this.visibilityStartTime = null;
                }
                this.isVisible = false;
            } else {
                // Page became visible
                this.visibilityStartTime = now;
                this.isVisible = true;
                this.lastActivityTime = now;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        this.eventListeners.push({ type: 'visibilitychange', handler: handleVisibilityChange });
    }

    /**
     * Track scroll depth using IntersectionObserver
     */
    setupScrollTracking() {
        // Create markers at 25%, 50%, 75%, 100% of page height
        const createScrollMarkers = () => {
            const docHeight = Math.max(
                document.body.scrollHeight,
                document.documentElement.scrollHeight
            );

            const markers = [
                { depth: 25, element: null },
                { depth: 50, element: null },
                { depth: 75, element: null },
                { depth: 100, element: null }
            ];

            markers.forEach(marker => {
                const div = document.createElement('div');
                div.style.position = 'absolute';
                div.style.top = `${(docHeight * marker.depth / 100) - 1}px`;
                div.style.height = '1px';
                div.style.width = '100%';
                div.style.pointerEvents = 'none';
                div.style.visibility = 'hidden';
                div.dataset.scrollDepth = marker.depth;
                document.body.appendChild(div);
                marker.element = div;
            });

            return markers;
        };

        // Observe scroll markers
        const markers = createScrollMarkers();

        this.scrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const depth = parseInt(entry.target.dataset.scrollDepth);
                    this.metrics.scrollMilestones.add(depth);
                    this.metrics.maxScrollDepth = Math.max(this.metrics.maxScrollDepth, depth);
                    this.lastActivityTime = Date.now();
                }
            });

            // Update current scroll depth
            this.updateCurrentScrollDepth();
        }, { threshold: 0.01 });

        markers.forEach(marker => {
            if (marker.element) {
                this.scrollObserver.observe(marker.element);
            }
        });

        // Also track scroll events for real-time depth
        const handleScroll = () => {
            this.updateCurrentScrollDepth();
            this.lastActivityTime = Date.now();
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        this.eventListeners.push({ type: 'scroll', handler: handleScroll, target: window });
    }

    /**
     * Calculate current scroll depth percentage
     */
    updateCurrentScrollDepth() {
        const windowHeight = window.innerHeight;
        const documentHeight = Math.max(
            document.body.scrollHeight,
            document.documentElement.scrollHeight
        );
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        const scrollableHeight = documentHeight - windowHeight;
        const scrollPercentage = scrollableHeight > 0
            ? Math.round((scrollTop / scrollableHeight) * 100)
            : 100;

        this.metrics.scrollDepth = Math.min(100, Math.max(0, scrollPercentage));
    }

    /**
     * Track user interactions using event delegation
     */
    setupInteractionTracking() {
        // Click tracking
        const handleClick = (e) => {
            this.metrics.clicks++;
            this.lastActivityTime = Date.now();

            // Track specific interaction types
            const target = e.target;
            const tagName = target.tagName.toLowerCase();

            if (tagName === 'a') {
                this.metrics.interactions.push({ type: 'link', time: Date.now() });
            } else if (tagName === 'button' || target.type === 'submit') {
                this.metrics.interactions.push({ type: 'button', time: Date.now() });
            }
        };

        // Keypress tracking
        const handleKeypress = () => {
            this.metrics.keypresses++;
            this.lastActivityTime = Date.now();
        };

        // Form submission tracking
        const handleFormSubmit = () => {
            this.metrics.forms++;
            this.metrics.interactions.push({ type: 'form', time: Date.now() });
            this.lastActivityTime = Date.now();
        };

        // Use event delegation on document
        document.addEventListener('click', handleClick, { passive: true });
        document.addEventListener('keypress', handleKeypress, { passive: true });
        document.addEventListener('submit', handleFormSubmit, { passive: true });

        this.eventListeners.push(
            { type: 'click', handler: handleClick },
            { type: 'keypress', handler: handleKeypress },
            { type: 'submit', handler: handleFormSubmit }
        );
    }

    /**
     * Track time spent on page
     */
    startTimeTracking() {
        // Update time every second
        this.timeInterval = setInterval(() => {
            const now = Date.now();
            this.metrics.timeSpent = now - this.startTime;

            // Update visible time if currently visible
            if (this.isVisible && this.visibilityStartTime) {
                this.metrics.visibleTime += now - this.visibilityStartTime;
                this.visibilityStartTime = now;
            }

            // Calculate engagement score
            this.calculateEngagementScore();
        }, 1000);
    }

    /**
     * Calculate engagement score (0-100)
     */
    calculateEngagementScore() {
        const timeScore = Math.min(30, (this.metrics.visibleTime / 1000) / 10); // Max 30 points for 5+ min
        const scrollScore = Math.min(25, this.metrics.maxScrollDepth / 4); // Max 25 points for 100% scroll
        const interactionScore = Math.min(25, (this.metrics.clicks + this.metrics.keypresses) / 2); // Max 25 points
        const formScore = Math.min(20, this.metrics.forms * 10); // Max 20 points for 2+ forms

        this.metrics.engagementScore = Math.round(timeScore + scrollScore + interactionScore + formScore);
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        // Final update before returning
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
            interactions: this.metrics.interactions.slice(-10) // Last 10 interactions only
        };
    }

    /**
     * Check if user is actively engaged (activity in last 30s)
     */
    isActivelyEngaged() {
        return (Date.now() - this.lastActivityTime) < 30000;
    }

    /**
     * Cleanup and destroy tracker
     */
    destroy() {
        // Clear interval
        if (this.timeInterval) {
            clearInterval(this.timeInterval);
        }

        // Disconnect scroll observer
        if (this.scrollObserver) {
            this.scrollObserver.disconnect();
        }

        // Remove event listeners
        this.eventListeners.forEach(({ type, handler, target = document }) => {
            target.removeEventListener(type, handler);
        });

        this.eventListeners = [];
    }
}
