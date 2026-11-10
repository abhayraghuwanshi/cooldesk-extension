import { useEffect, useState } from 'react';
import { useNow } from './useNow';
import { getLocale } from '../../shared/i18n';

// Frames (header/footer bars) for the Workflow skins — see boardSkins.js.
// Skins for the Workflow boards (OVERVIEW_VIBES group 'work'). The cards are
// the same CardBoard cards; a skin changes the *material* around them:
//   - a full-screen backdrop (.ocb-skin-bg.skin-<name>) over the wallpaper
//   - card chrome + a per-card label (file tab, HUD tag, ticker code…)
//   - a frame: a header and/or footer around the grid with live, real info
//     (exchange hours, the ISO week, how long you've been on watch…)
//   - `theme`: the widget iframes' theme (light skins get light widgets)
// Styles live in cooldesk.css under "Workflow skins" (.ocb[data-skin=…]).

const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hms = (d) => `${hm(d)}:${pad(d.getSeconds())}`;

function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
const dayOfYear = (d) => Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1;
const daysInYear = (d) => ((d.getFullYear() % 4 === 0 && d.getFullYear() % 100 !== 0) || d.getFullYear() % 400 === 0 ? 366 : 365);
const dayFrac = (d) => (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
const longDate = (d) => d.toLocaleDateString(getLocale(), { weekday: 'long', month: 'long', day: 'numeric' });

// ── Frames ──────────────────────────────────────────────────────────────────

export function IdeHeader() {
    const now = useNow(10_000);
    return (
        <div className="skin-bar skin-ide-title">
            <span className="skin-lights"><i /><i /><i /></span>
            <span className="skin-ide-path">cooldesk — ~/dev</span>
            <span className="skin-ide-time">{hm(now)}</span>
        </div>
    );
}
export function IdeFooter() {
    const now = useNow(10_000);
    return (
        <div className="skin-bar skin-ide-status">
            <span>◉ localhost</span>
            <span>{now.toLocaleDateString(getLocale(), { weekday: 'short' })}</span>
            <span className="skin-spacer" />
            <span>Ln {now.getHours()}, Col {now.getMinutes()}</span>
            <span>UTF-8</span>
            <span>LF</span>
            <span>{'{ } JavaScript'}</span>
        </div>
    );
}

export function DevtoolsHeader() {
    return (
        <div className="skin-bar skin-dt-tabs">
            {['Elements', 'Console', 'Sources', 'Network', 'Application'].map(t => (
                <span key={t} className={t === 'Sources' ? 'on' : undefined}>{t}</span>
            ))}
        </div>
    );
}
export function DevtoolsFooter() {
    const now = useNow(1000);
    return (
        <div className="skin-bar skin-dt-paused">
            <span className="skin-dt-pill">⏸ Paused in debugger</span>
            <span className="skin-spacer" />
            <span>{hms(now)}</span>
        </div>
    );
}

export function MissionHeader() {
    const now = useNow(1000);
    const [since] = useState(() => new Date());
    const up = Math.floor((now - since) / 60000);
    const utc = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    return (
        <div className="skin-bar skin-mission-hud">
            <span className="skin-blink">●</span>
            <span>ON WATCH SINCE {hm(since)}</span>
            <span className="skin-dim">T+{pad(Math.floor(up / 60))}:{pad(up % 60)}</span>
            <span className="skin-spacer" />
            <span><b>UTC</b> {utc}</span>
            <span><b>LCL</b> {hms(now)}</span>
        </div>
    );
}

export function DashHeader() {
    const now = useNow(60_000);
    const doy = dayOfYear(now);
    const kpis = [
        ['Week', isoWeek(now)],
        ['Quarter', `Q${Math.floor(now.getMonth() / 3) + 1}`],
        ['Day', `${doy}/${daysInYear(now)}`],
        ['Year done', `${(((doy - 1) + dayFrac(now)) / daysInYear(now) * 100).toFixed(1)}%`],
        ['Today done', `${Math.round(dayFrac(now) * 100)}%`],
    ];
    return (
        <div className="skin-bar skin-dash-kpis">
            {kpis.map(([k, v]) => (
                <div key={k} className="skin-kpi"><span>{k}</span><b>{v}</b></div>
            ))}
        </div>
    );
}

export function LibraryHeader() {
    const now = useNow(60_000);
    return (
        <div className="skin-bar skin-library-head">
            <span className="skin-library-rule" />
            <span className="skin-library-title">The Reading Room</span>
            <span className="skin-library-date">{longDate(now)} · Vol. {dayOfYear(now)}</span>
            <span className="skin-library-rule" />
        </div>
    );
}

export function PlannerHeader() {
    const now = useNow(60_000);
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
    });
    return (
        <div className="skin-bar skin-planner-week">
            <span className="skin-planner-wk">W{isoWeek(now)}</span>
            {days.map(d => (
                <span key={d.getDate()} className={`skin-planner-day ${d.toDateString() === now.toDateString() ? 'on' : ''} ${d.getDay() % 6 === 0 ? 'off' : ''}`}>
                    <small>{d.toLocaleDateString(getLocale(), { weekday: 'short' })}</small>
                    <b>{d.getDate()}</b>
                </span>
            ))}
        </div>
    );
}

export function NotebookHeader() {
    const now = useNow(60_000);
    return (
        <div className="skin-bar skin-notebook-head">
            <span className="skin-tape" />
            <span>{longDate(now)}</span>
            <span className="skin-notebook-wk">week {isoWeek(now)} ✎</span>
        </div>
    );
}

// Regular trading hours (local to each exchange, Mon–Fri, holidays ignored).
const EXCHANGES = [
    ['NYSE', 'America/New_York', 9.5, 16],
    ['LSE', 'Europe/London', 8, 16.5],
    ['XETRA', 'Europe/Berlin', 9, 17.5],
    ['NSE', 'Asia/Kolkata', 9.25, 15.5],
    ['HKEX', 'Asia/Hong_Kong', 9.5, 16],
    ['TSE', 'Asia/Tokyo', 9, 15.5],
    ['ASX', 'Australia/Sydney', 10, 16],
];
function exchangeState(now, tz, open, close) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(now).map(p => [p.type, p.value]));
    const h = Number(parts.hour) + Number(parts.minute) / 60;
    const weekday = !['Sat', 'Sun'].includes(parts.weekday);
    return { open: weekday && h >= open && h < close, local: `${parts.hour}:${parts.minute}` };
}
export function TickerHeader() {
    const now = useNow(30_000);
    const items = EXCHANGES.map(([name, tz, o, c]) => ({ name, ...exchangeState(now, tz, o, c) }));
    const row = items.map(x => (
        <span key={x.name} className={`skin-tick ${x.open ? 'up' : 'down'}`}>
            {x.name} <b>{x.open ? '▲ OPEN' : '▼ CLOSED'}</b> <i>{x.local}</i>
        </span>
    ));
    return (
        <div className="skin-bar skin-ticker" title="Regular trading hours; holidays not included">
            <div className="skin-ticker-track">{row}{row}</div>
        </div>
    );
}
export function TickerFooter() {
    return (
        <div className="skin-bar skin-fkeys">
            {['HELP', 'NEWS', 'FX', 'CRYP', 'CAL', 'NOTE'].map((k, i) => <span key={k}><b>F{i + 1}</b>{k}</span>)}
        </div>
    );
}

export function PaperHeader() {
    const now = useNow(60_000);
    return (
        <div className="skin-bar skin-paper-head">
            <span className="skin-paper-date">{longDate(now)}</span>
            <span className="skin-paper-stamp">Draft Nº {dayOfYear(now)}</span>
        </div>
    );
}

export function CanvasHeader() {
    // The viewport as the "frame size" a design tool shows.
    const [size, setSize] = useState(() => `${window.innerWidth} × ${window.innerHeight}`);
    useEffect(() => {
        const on = () => setSize(`${window.innerWidth} × ${window.innerHeight}`);
        window.addEventListener('resize', on);
        return () => window.removeEventListener('resize', on);
    }, []);
    return (
        <div className="skin-bar skin-canvas-tools">
            <span className="skin-canvas-group">
                {['▸', '#', '▢', '◯', '✎', 'T', '✋'].map((t, i) => <span key={t} className={i === 0 ? 'on' : undefined}>{t}</span>)}
            </span>
            <span className="skin-canvas-file">Moodboard <i>/ Page 1</i></span>
            <span className="skin-canvas-zoom">{size}</span>
        </div>
    );
}

function greeting(h) {
    if (h < 5) return 'Still up';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}
export function DawnHeader() {
    const now = useNow(60_000);
    return (
        <div className="skin-bar skin-dawn-head">
            <b>{greeting(now.getHours())}.</b>
            <span>Pick up where you left off — {longDate(now)}</span>
        </div>
    );
}

export function DuskHeader() {
    const now = useNow(30_000);
    const left = 1440 - (now.getHours() * 60 + now.getMinutes());
    const pct = dayFrac(now) * 100;
    return (
        <div className="skin-bar skin-dusk-head">
            <span className="skin-dusk-title">Shut down well.</span>
            <span className="skin-dusk-meter"><i style={{ width: `${pct.toFixed(1)}%` }} /></span>
            <span className="skin-dusk-left">{Math.round(pct)}% of today gone · {Math.floor(left / 60)}h {left % 60}m to midnight</span>
        </div>
    );
}


// ── Looks (any layout can wear these; see looks.js) ──

export function MonoHeader() {
    const now = useNow(60_000);
    return (
        <div className="skin-bar skin-mono-head">
            <b>{now.toLocaleDateString(getLocale(), { weekday: 'long' })}</b>
            <span className="skin-spacer" />
            <span>{pad(now.getDate())}.{pad(now.getMonth() + 1)}.{now.getFullYear()}</span>
            <span>W{pad(isoWeek(now))}</span>
            <span>{hm(now)}</span>
        </div>
    );
}

export function BrutalHeader() {
    const now = useNow(30_000);
    const day = now.toLocaleDateString(getLocale(), { weekday: 'long' }).toUpperCase();
    const row = (
        <span className="skin-brutal-run">
            TODAY IS {day} ★ {hm(now)} ★ WEEK {isoWeek(now)} ★ DAY {dayOfYear(now)} OF {daysInYear(now)} ★&nbsp;
        </span>
    );
    return (
        <div className="skin-bar skin-brutal-head" aria-label={`${day} ${hm(now)}`}>
            <div className="skin-brutal-track">{row}{row}{row}{row}</div>
        </div>
    );
}

export function VaporHeader() {
    const now = useNow(1000);
    return (
        <div className="skin-bar skin-vapor-head">
            <span className="skin-vapor-title">{'ｗｅｌｃｏｍｅ\u3000ｂａｃｋ'}</span>
            <span className="skin-spacer" />
            <span className="skin-vapor-time">{hms(now)}</span>
        </div>
    );
}
