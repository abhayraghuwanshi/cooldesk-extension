import { useEffect, useRef } from 'react';
import { useNow } from './useNow';

// Self-drawn pieces for the design layouts (StageBoard.jsx): clocks whose
// look *is* the design (word clock, flip cards, binary, analog), the day-cycle
// sky, progress bars and the code-rain canvas. No data, no widgets — just the
// current time drawn different ways. Each ticks with its own interval and
// cleans up on unmount (layouts mount/unmount as the picker switches).

const pad = (n) => String(n).padStart(2, '0');

// ── Word clock: an 11×10 letter grid; the words of the current time light up.
const WC_ROWS = [
    'ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE',
    'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK',
];
// word -> [row, first column, length]
const WC_WORDS = {
    IT: [0, 0, 2], IS: [0, 3, 2], A: [1, 0, 1], QUARTER: [1, 2, 7], TWENTY: [2, 0, 6],
    FIVE_M: [2, 6, 4], HALF: [3, 0, 4], TEN_M: [3, 5, 3], TO: [3, 9, 2], PAST: [4, 0, 4],
    NINE: [4, 7, 4], ONE: [5, 0, 3], SIX: [5, 3, 3], THREE: [5, 6, 5], FOUR: [6, 0, 4],
    FIVE: [6, 4, 4], TWO: [6, 8, 3], EIGHT: [7, 0, 5], ELEVEN: [7, 5, 6], SEVEN: [8, 0, 5],
    TWELVE: [8, 5, 6], TEN: [9, 0, 3], OCLOCK: [9, 5, 6],
};
const WC_HOURS = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
const WC_MINUTES = {
    0: ['OCLOCK'], 5: ['FIVE_M', 'PAST'], 10: ['TEN_M', 'PAST'], 15: ['A', 'QUARTER', 'PAST'],
    20: ['TWENTY', 'PAST'], 25: ['TWENTY', 'FIVE_M', 'PAST'], 30: ['HALF', 'PAST'],
    35: ['TWENTY', 'FIVE_M', 'TO'], 40: ['TWENTY', 'TO'], 45: ['A', 'QUARTER', 'TO'],
    50: ['TEN_M', 'TO'], 55: ['FIVE_M', 'TO'],
};

function wordClockWords(d) {
    const m5 = Math.floor(d.getMinutes() / 5) * 5;
    const hour = WC_HOURS[(d.getHours() + (m5 >= 35 ? 1 : 0)) % 12];
    const mins = WC_MINUTES[m5];
    // Reading order: "IT IS HALF PAST TEN" / "IT IS TEN O'CLOCK".
    return m5 === 0 ? ['IT', 'IS', hour, 'OCLOCK'] : ['IT', 'IS', ...mins, hour];
}

export function WordClock() {
    const now = useNow(10_000);
    const words = wordClockWords(now);
    const lit = new Set();
    for (const w of words) {
        const [r, c, len] = WC_WORDS[w];
        for (let i = 0; i < len; i++) lit.add(`${r}-${c + i}`);
    }
    const extra = now.getMinutes() % 5;
    const label = words.map(w => (w === 'OCLOCK' ? "o'clock" : w.replace(/_M$/, '').toLowerCase())).join(' ');
    return (
        <div className="wordclock" role="img" aria-label={label}>
            {WC_ROWS.map((row, r) => row.split('').map((ch, c) => (
                <span key={`${r}-${c}`} className={lit.has(`${r}-${c}`) ? 'lit' : undefined}>{ch}</span>
            )))}
            {[0, 1, 2, 3].map(i => <i key={i} className={`wordclock-dot d${i} ${i < extra ? 'lit' : ''}`} />)}
        </div>
    );
}

// ── Analog: a minimal SVG face.
export function AnalogClock() {
    const now = useNow(1000);
    const s = now.getSeconds();
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    return (
        <div className="analog-wrap" role="img" aria-label={now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}>
            <svg className="analog" viewBox="0 0 200 200">
                {Array.from({ length: 60 }, (_, i) => (
                    <line
                        key={i}
                        className={i % 5 ? 'analog-tick' : 'analog-tick is-hour'}
                        x1="100" y1={i % 5 ? 10 : 8} x2="100" y2={i % 5 ? 14 : 20}
                        transform={`rotate(${i * 6} 100 100)`}
                    />
                ))}
                <line className="analog-h" x1="100" y1="100" x2="100" y2="54" transform={`rotate(${h * 30} 100 100)`} />
                <line className="analog-m" x1="100" y1="100" x2="100" y2="30" transform={`rotate(${m * 6} 100 100)`} />
                <line className="analog-s" x1="100" y1="116" x2="100" y2="22" transform={`rotate(${s * 6} 100 100)`} />
                <circle className="analog-pin" cx="100" cy="100" r="4" />
            </svg>
        </div>
    );
}

// ── Flip clock: each digit is a card; a changed digit remounts (key) and
// replays the flip-in animation.
export function FlipClock({ seconds = true }) {
    const now = useNow(1000);
    const groups = [pad(now.getHours()), pad(now.getMinutes()), ...(seconds ? [pad(now.getSeconds())] : [])];
    return (
        <div className="flip" role="img" aria-label={groups.join(':')}>
            {groups.map((g, gi) => (
                <div className="flip-unit" key={gi}>
                    {gi > 0 && <span className="flip-sep">:</span>}
                    <div className="flip-group">
                        {g.split('').map((d, i) => (
                            <span className="flip-card" key={`${gi}-${i}-${d}`}><span>{d}</span></span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Binary: HH MM SS as six columns of 4-bit dots (binary-coded decimal).
export function BinaryClock() {
    const now = useNow(1000);
    const digits = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`.split('').map(Number);
    const maxBits = [2, 4, 3, 4, 3, 4]; // tens of hours never need the 4s/8s bit
    return (
        <div className="binary" role="img" aria-label={`${digits.slice(0, 2).join('')}:${digits.slice(2, 4).join('')}:${digits.slice(4).join('')}`}>
            {digits.map((d, i) => (
                <div className={`binary-col ${i % 2 === 1 && i < 5 ? 'gap-after' : ''}`} key={i}>
                    {[8, 4, 2, 1].map((bit, b) => (
                        <i key={bit} className={`binary-dot ${d & bit ? 'on' : ''} ${4 - b > maxBits[i] ? 'slot-off' : ''}`} />
                    ))}
                    <span className="binary-digit">{d}</span>
                </div>
            ))}
        </div>
    );
}

// ── Day cycle: the sun (06–18) or moon (18–06) on an arc across the sky.
function skyPhase(h) {
    if (h < 5 || h >= 20) return 'night';
    if (h < 8) return 'dawn';
    if (h < 17) return 'day';
    return 'dusk';
}

export function SkyBackground() {
    const now = useNow(60_000);
    return <div className={`ostage-bg bg-sky is-${skyPhase(now.getHours())}`} aria-hidden="true" />;
}

export function SkyArc() {
    const now = useNow(60_000);
    const h = now.getHours() + now.getMinutes() / 60;
    const isDay = h >= 6 && h < 18;
    const t = isDay ? (h - 6) / 12 : ((h >= 18 ? h - 18 : h + 6) / 12);
    const a = Math.PI * (1 - t);
    const x = 160 + 140 * Math.cos(a);
    const y = 160 - 140 * Math.sin(a);
    return (
        <svg className="skyarc" viewBox="0 0 320 180" aria-hidden="true">
            <path className="skyarc-path" d="M20 160 A140 140 0 0 1 300 160" />
            <line className="skyarc-horizon" x1="0" y1="160" x2="320" y2="160" />
            <circle className={isDay ? 'skyarc-sun' : 'skyarc-moon'} cx={x} cy={y} r={isDay ? 13 : 10} />
            <text className="skyarc-label" x="20" y="176" textAnchor="middle">{isDay ? '06:00' : '18:00'}</text>
            <text className="skyarc-label" x="300" y="176" textAnchor="middle">{isDay ? '18:00' : '06:00'}</text>
        </svg>
    );
}

// ── Progress: how far through the day / week / month / year.
export function ProgressBars() {
    const now = useNow(30_000);
    const dayFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
    const weekday = (now.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const daysInYear = (new Date(now.getFullYear() + 1, 0, 1) - startOfYear) / 86400000;
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const rows = [
        ['Day', dayFrac],
        ['Week', (weekday + dayFrac) / 7],
        ['Month', (now.getDate() - 1 + dayFrac) / daysInMonth],
        ['Year', (dayOfYear + dayFrac) / daysInYear],
    ];
    return (
        <div className="progress-list">
            {rows.map(([label, f]) => (
                <div className="progress-row" key={label}>
                    <span className="progress-label">{label}</span>
                    <span className="progress-track"><span className="progress-fill" style={{ width: `${(f * 100).toFixed(2)}%` }} /></span>
                    <span className="progress-pct">{(f * 100).toFixed(1)}%</span>
                </div>
            ))}
        </div>
    );
}

// ── Code rain: a canvas behind the page. ~15fps, stops drawing while the tab
// is hidden, and doesn't animate at all under reduced motion.
export function CodeRain() {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;
        const size = 16;
        const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEF';
        let w = 0;
        let h = 0;
        let drops = [];
        const resize = () => {
            w = canvas.width = canvas.clientWidth;
            h = canvas.height = canvas.clientHeight;
            drops = Array.from({ length: Math.ceil(w / size) }, () => Math.random() * -60);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => ro.disconnect();
        let raf = 0;
        let last = 0;
        const draw = (t) => {
            raf = requestAnimationFrame(draw);
            if (document.hidden || t - last < 66) return;
            last = t;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.09)';
            ctx.fillRect(0, 0, w, h);
            ctx.font = `${size}px ui-monospace, monospace`;
            for (let i = 0; i < drops.length; i++) {
                const y = drops[i] * size;
                ctx.fillStyle = Math.random() < 0.04 ? '#d9ffe8' : '#22e57a';
                ctx.fillText(chars[(Math.random() * chars.length) | 0], i * size, y);
                if (y > h && Math.random() > 0.975) drops[i] = 0;
                drops[i] += 1;
            }
        };
        raf = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, []);
    return <canvas ref={ref} className="ostage-bg bg-coderain" aria-hidden="true" />;
}
