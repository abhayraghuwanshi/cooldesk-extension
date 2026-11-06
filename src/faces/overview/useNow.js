import { useEffect, useState } from 'react';

// A ticking "now" for the stage layouts' clocks; pass 1000 only where seconds
// are on screen. Each caller owns its interval, cleared on unmount.
export function useNow(stepMs) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), stepMs);
        return () => clearInterval(id);
    }, [stepMs]);
    return now;
}
