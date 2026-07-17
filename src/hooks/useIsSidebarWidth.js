import { useEffect, useState } from 'react';

// Matches the CSS sidebar/drawer breakpoint in cooldesk.css ("Sidebar mode",
// max-width: 500px). Keep the two in sync if the breakpoint ever moves.
const SIDEBAR_QUERY = '(max-width: 500px)';

export function useIsSidebarWidth() {
    const [isSidebarWidth, setIsSidebarWidth] = useState(
        () => window.matchMedia(SIDEBAR_QUERY).matches
    );

    useEffect(() => {
        const mq = window.matchMedia(SIDEBAR_QUERY);
        const onChange = (e) => setIsSidebarWidth(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    return isSidebarWidth;
}
