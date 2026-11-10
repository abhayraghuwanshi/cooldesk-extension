import { createContext, memo, useContext, useEffect, useRef } from 'react';
import { ActivityFeed } from './parts/ActivityFeed';
import { SearchHero } from './parts/SearchHero';
import { ActivityOverview } from '../../features/activity/ActivityOverview';
import { WidgetEmbed } from '../../features/widgets/WidgetBoard';
import { AnalogClock, BinaryClock, CodeRain, FlipClock, ProgressBars, SkyArc, SkyBackground, WordClock } from './stagePieces';
import { useNow } from './useNow';
import { getLocale, t, useT } from '../../shared/i18n';
import { getSkin } from './boardSkins';
import { useLook } from './looks';

// The stage's look (looks.js), for the widget pieces: they restyle their
// insides to match (?skin=) and go light on light looks.
const LookCtx = createContext(null);

// "Start pages" and the just-for-fun layouts: classic and not-so-classic
// new-tab arrangements built only from pieces the page already has. Unlike the
// card boards these are fixed compositions: pieces sit in regions of the
// screen — top corners, a centered stack, bottom corners / line, an optional
// left rail — so a clock can be centered, the weather tucked into a corner,
// or shortcuts docked along the bottom. See OVERVIEW_VIBES (stage entries).
//
// Piece kinds (all sizes are max px):
//   widget     { id, w, h, glass?, theme?, align? }  a catalog widget
//   time/date  { size?, seconds? }                    plain text, any size
//   text       { text, className? }                   a label / masthead
//   greeting   {}                                     "Good morning."
//   searchbar  { w }                                  the search hero
//   shortcuts  { variant: grid|dock|list|rail|orbit, size?, title?, w?, max? }
//   feed       { tab, title?, w, h }                  one activity-feed section
//   summary    { title?, w }                          today's activity
//   group      { pieces, dir: row|col, className?, w? }
//   wordclock / analog / flip / binary / skyarc / progress   drawn clocks
//   deco       { className }                          an empty shape to style
// stage.bg: a full-screen backdrop — a CSS class (bg-<name>), or 'sky' /
// 'coderain' for the drawn ones.
const NO_TABS = ['all', 'tabs', 'local', 'suites', 'search', 'media'];


function TimeText({ p }) {
    useT();
    const now = useNow(p.seconds ? 1000 : 10_000);
    const full = now.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', ...(p.h24 ? { hourCycle: 'h23' } : {}) });
    const ampm = (full.match(/[AP]M/i) || [''])[0];
    const hm = full.replace(/\s?[AP]M$/i, '');
    return (
        <div className={`ostage-time is-${p.size || 'xl'}`}>
            {hm}
            {p.seconds && <span className="ostage-time-sec">{String(now.getSeconds()).padStart(2, '0')}</span>}
            {ampm && <span className="ostage-time-ampm">{ampm}</span>}
        </div>
    );
}

function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

function formatDate(now, p) {
    switch (p.format) {
        case 'ja': return now.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' });
        case 'iso': return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        case 'week': return t('date.week', { n: isoWeek(now) });
        case 'dm': return now.toLocaleDateString(getLocale(), { day: '2-digit', month: 'short' }).toUpperCase();
        default: return now.toLocaleDateString(getLocale(), p.long
            ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
            : { weekday: 'long', month: 'long', day: 'numeric' });
    }
}

function DateText({ p }) {
    useT();
    const now = useNow(60_000);
    const text = formatDate(now, p);
    // Vertical Japanese: each number sits upright as one glyph (縦中横).
    if (p.format === 'ja') {
        return (
            <div className={`ostage-date ${p.className || ''}`}>
                {text.split(/(\d+)/).map((part, i) => (/^\d+$/.test(part) ? <span key={i} className="tcy">{part}</span> : part))}
            </div>
        );
    }
    return <div className={`ostage-date ${p.className || ''}`}>{text}</div>;
}

function greetingFor(hour) {
    if (hour < 5) return t('greet.night');
    if (hour < 12) return t('greet.morning');
    if (hour < 17) return t('greet.afternoon');
    if (hour < 22) return t('greet.evening');
    return t('greet.night');
}

function Greeting() {
    useT();
    const now = useNow(60_000);
    return <div className="ostage-greeting">{greetingFor(now.getHours())}.</div>;
}

// Orbit: number the favorite tiles so CSS can place tile i at angle
// 360°·i/n around the core. Re-numbered when the list changes (tiles load
// async); only child-list mutations are watched, which this never causes.
function Orbit({ p }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const max = p.max || 12;
        const apply = () => {
            const tiles = el.querySelectorAll('.fav-tile');
            tiles.forEach((t, i) => {
                t.style.setProperty('--i', i);
                t.style.display = i < max ? '' : 'none';
            });
            el.style.setProperty('--n', Math.max(1, Math.min(tiles.length, max)));
        };
        apply();
        const mo = new MutationObserver(apply);
        mo.observe(el, { childList: true, subtree: true });
        return () => mo.disconnect();
    }, [p.max]);
    return (
        <div className="ostage-piece ostage-orbit" ref={ref} style={{ '--r': `${p.radius || 240}px` }}>
            <div className="ostage-orbit-ring">
                <ActivityFeed showList={false} />
            </div>
            <div className="ostage-orbit-core">
                <TimeText p={{ size: 'lg' }} />
                <DateText p={{}} />
            </div>
        </div>
    );
}

// Dock: the hover label (CSS) names each icon, so the native title tooltip
// would only duplicate it, late and in the wrong place. Titles are moved to
// data-title as tiles mount (aria-label still names them).
function DockShortcuts({ p }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const strip = () => el.querySelectorAll('.fav-tile[title]').forEach((t) => {
            t.dataset.title = t.getAttribute('title');
            t.removeAttribute('title');
        });
        strip();
        const mo = new MutationObserver(strip);
        mo.observe(el, { childList: true, subtree: true });
        return () => mo.disconnect();
    }, []);
    return (
        <div ref={ref} className={`ostage-piece ostage-shortcuts is-dock is-${p.size || 'sm'}`}>
            <ActivityFeed showList={false} />
        </div>
    );
}

function LookWidget({ p }) {
    const look = useContext(LookCtx);
    return (
        <WidgetEmbed
            widgetId={p.id}
            center={p.align !== 'left'}
            theme={p.theme || look?.theme || null}
            skin={look?.name || null}
        />
    );
}

const sizeStyle = (p) => ({
    ...(p.w ? { width: '100%', maxWidth: p.w } : {}),
    ...(p.h ? { height: p.h } : {}),
});

function Piece({ p }) {
    switch (p.kind) {
        case 'widget':
            // Bare by default: no glass, the widget's own (clear) surface on
            // the wallpaper. Centered unless it sits in a left-aligned spot.
            return (
                <div className={`ostage-piece ostage-widget ${p.glass ? 'ostage-glass' : ''} ${p.className || ''}`} style={sizeStyle(p)}>
                    <LookWidget p={p} />
                </div>
            );
        case 'time':
            return <TimeText p={p} />;
        case 'date':
            return <DateText p={p} />;
        case 'text':
            return <div className={`ostage-text ${p.className || ''}`}>{p.text}</div>;
        case 'greeting':
            return <Greeting />;
        case 'searchbar':
            return (
                <div className="ostage-piece ostage-search" style={sizeStyle(p)}>
                    <SearchHero />
                </div>
            );
        case 'shortcuts':
            if (p.variant === 'orbit') return <Orbit p={p} />;
            if (p.variant === 'dock') return <DockShortcuts p={p} />;
            return (
                <div
                    className={`ostage-piece ostage-shortcuts is-${p.variant || 'grid'} is-${p.size || 'sm'} ${p.title ? 'has-title' : ''}`}
                    style={sizeStyle(p)}
                >
                    {p.title && <h2 className="ostage-heading">{p.title}</h2>}
                    <ActivityFeed showList={false} />
                </div>
            );
        case 'feed':
            return (
                <section className="ostage-piece ostage-section" style={{ width: '100%', maxWidth: p.w }}>
                    {p.title && <h2 className="ostage-heading">{p.title}</h2>}
                    <div className="ostage-glass ostage-feed" style={{ height: p.h }}>
                        <ActivityFeed showFavorites={false} hiddenTabs={p.tab ? NO_TABS.filter(t => t !== p.tab) : []} />
                    </div>
                </section>
            );
        case 'summary':
            return (
                <section className="ostage-piece ostage-section" style={{ width: '100%', maxWidth: p.w }}>
                    {p.title && <h2 className="ostage-heading">{p.title}</h2>}
                    <div className="ostage-glass ostage-summary">
                        <ActivityOverview embedded />
                    </div>
                </section>
            );
        case 'wordclock':
            return <WordClock />;
        case 'analog':
            return <AnalogClock />;
        case 'flip':
            return <FlipClock seconds={p.seconds !== false} />;
        case 'binary':
            return <BinaryClock />;
        case 'skyarc':
            return <SkyArc />;
        case 'progress':
            return <ProgressBars />;
        case 'deco':
            return <div className={`ostage-deco ${p.className || ''}`} aria-hidden="true" />;
        case 'group':
            return (
                <div className={`ostage-group is-${p.dir || 'col'} ${p.className || ''}`} style={p.w ? { width: '100%', maxWidth: p.w } : undefined}>
                    {p.pieces.map((c, i) => <Piece key={`${c.kind}-${c.id || ''}-${i}`} p={c} />)}
                </div>
            );
        default:
            return null;
    }
}

const Region = ({ name, pieces }) => (pieces?.length ? (
    <div className={`ostage-${name}`}>
        {pieces.map((p, i) => <Piece key={`${p.kind}-${p.id || ''}-${i}`} p={p} />)}
    </div>
) : null);

const StageBoard = memo(function StageBoard({ vibe }) {
    const { stage } = vibe;
    const lookName = useLook(vibe.key);
    const skin = getSkin(lookName);
    const look = skin ? { name: lookName, theme: skin.theme || null } : null;
    const main = (
        <>
            {(stage.topLeft || stage.topRight) && (
                <div className="ostage-top">
                    <Region name="tl" pieces={stage.topLeft} />
                    <Region name="tr" pieces={stage.topRight} />
                </div>
            )}
            <Region name="center" pieces={stage.center} />
            <Region name="bottom" pieces={stage.bottom} />
            {(stage.bottomLeft || stage.bottomRight) && (
                <div className="ostage-top ostage-bottom-row">
                    <Region name="tl" pieces={stage.bottomLeft} />
                    <Region name="tr" pieces={stage.bottomRight} />
                </div>
            )}
        </>
    );
    return (
        <LookCtx.Provider value={look}>
        <div
            className={`ostage ostage-align-${stage.align || 'center'} ${stage.left ? 'has-rail' : ''}`}
            data-stage={vibe.key.replace(/^(start|vibe|fun|design)-/, '')}
            data-skin={look ? look.name : undefined}
            data-light={look?.theme === 'light' ? '' : undefined}
        >
            {look ? <div className={`ostage-bg ocb-skin-bg skin-${look.name}`} aria-hidden="true"><i /></div>
                : stage.bg === 'sky' ? <SkyBackground />
                : stage.bg === 'coderain' ? <CodeRain />
                    : stage.bg ? <div className={`ostage-bg bg-${stage.bg}`} aria-hidden="true"><i className="bg-layer" /></div> : null}
            {stage.left ? (
                <>
                    <Region name="rail" pieces={stage.left} />
                    <div className="ostage-main">{main}</div>
                </>
            ) : main}
        </div>
        </LookCtx.Provider>
    );
});

export { StageBoard };
