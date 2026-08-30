import {
    faCss3Alt, faGithub, faGolang, faHtml5, faJava, faJs, faMarkdown, faNodeJs, faPhp,
    faPython, faReact, faRust, faSwift, faVuejs,
} from '@fortawesome/free-brands-svg-icons';
import {
    faBriefcase, faChartLine, faCloud, faCode, faCog, faDatabase, faDesktop,
    faFile, faFileCode, faFileCsv, faFileExcel, faFileLines, faFilePdf, faFilePowerpoint,
    faFileWord, faFileZipper, faFlask, faFolder, faFolderOpen, faFont, faGamepad, faGlobe,
    faGraduationCap, faHashtag, faHeartPulse, faHistory, faHome, faImage, faLightbulb,
    faLink, faMicrochip, faMusic, faNewspaper, faPalette, faPlane, faRobot,
    faSearch, faShoppingBag, faStar, faStickyNote, faTasks, faTerminal, faTools,
    faUtensils, faVial, faVideo,
} from '@fortawesome/free-solid-svg-icons';
import {
    SiC, SiClojure, SiCplusplus, SiCss, SiDart, SiDocker, SiElixir, SiGnubash, SiGo,
    SiGraphql, SiHaskell, SiHtml5, SiJavascript, SiJson, SiJupyter, SiKotlin, SiLua,
    SiMarkdown, SiMysql, SiOpenjdk, SiPerl, SiPhp, SiPrisma, SiPython, SiR, SiReact,
    SiRuby, SiRust, SiSass, SiScala, SiSharp, SiSqlite, SiSvelte, SiSwift, SiTailwindcss,
    SiToml, SiTypescript, SiVuedotjs, SiYaml,
} from 'react-icons/si';

// Map workspace names to category icons (mirrors WorkspaceCard logic)
const WORKSPACE_CATEGORY_ICONS = {
    finance: faChartLine,
    health: faHeartPulse,
    education: faGraduationCap,
    sports: faGamepad,
    social: faHashtag,
    travel: faPlane,
    entertainment: faVideo,
    shopping: faShoppingBag,
    food: faUtensils,
    utilities: faTools,
    github: faGithub,
    git: faGithub,
    dev: faCode,
    development: faCode,
    coding: faCode,
    code: faCode,
    terminal: faTerminal,
    ai: faRobot,
    gpt: faRobot,
    openai: faRobot,
    work: faBriefcase,
    business: faBriefcase,
    office: faBriefcase,
    personal: faHome,
    home: faHome,
    tasks: faTasks,
    management: faTasks,
    project: faTasks,
    design: faPalette,
    creative: faPalette,
    research: faSearch,
    google: faSearch,
    search: faSearch,
    cloud: faCloud,
    gaming: faGamepad,
    games: faGamepad,
    music: faMusic,
    video: faVideo,
    news: faNewspaper,
    reading: faFlask,
    ideas: faLightbulb,
    test: faVial,
    lab: faFlask,
};

// Get contextual icon for workspace based on its name
export function getWorkspaceIcon(name) {
    if (!name) return faFolder;
    const normalized = name.toLowerCase().trim();
    for (const [key, icon] of Object.entries(WORKSPACE_CATEGORY_ICONS)) {
        if (normalized === key || normalized.includes(key + ' ') || normalized.includes(' ' + key) || normalized.startsWith(key)) {
            return icon;
        }
    }
    return faFolder;
}

// Real brand logos (Simple Icons) for code/tech extensions, with official-ish
// brand colors. Anything not here falls back to the FontAwesome map below.
const SI_FILE_ICONS = {
    // JS / TS ecosystem
    ts: { Icon: SiTypescript, color: '#3178c6' }, mts: { Icon: SiTypescript, color: '#3178c6' }, cts: { Icon: SiTypescript, color: '#3178c6' },
    tsx: { Icon: SiReact, color: '#61dafb' }, jsx: { Icon: SiReact, color: '#61dafb' },
    js: { Icon: SiJavascript, color: '#f7df1e' }, mjs: { Icon: SiJavascript, color: '#f7df1e' }, cjs: { Icon: SiJavascript, color: '#f7df1e' },
    vue: { Icon: SiVuedotjs, color: '#42b883' }, svelte: { Icon: SiSvelte, color: '#ff3e00' },
    // Web / styling
    html: { Icon: SiHtml5, color: '#e34f26' }, htm: { Icon: SiHtml5, color: '#e34f26' },
    css: { Icon: SiCss, color: '#2965f1' }, scss: { Icon: SiSass, color: '#cc6699' }, sass: { Icon: SiSass, color: '#cc6699' },
    tailwind: { Icon: SiTailwindcss, color: '#38bdf8' },
    // Languages
    py: { Icon: SiPython, color: '#3776ab' }, ipynb: { Icon: SiJupyter, color: '#f37726' },
    rs: { Icon: SiRust, color: '#dea584' }, go: { Icon: SiGo, color: '#00add8' },
    java: { Icon: SiOpenjdk, color: '#e76f00' }, class: { Icon: SiOpenjdk, color: '#e76f00' },
    kt: { Icon: SiKotlin, color: '#7f52ff' }, kts: { Icon: SiKotlin, color: '#7f52ff' },
    rb: { Icon: SiRuby, color: '#cc342d' }, php: { Icon: SiPhp, color: '#777bb4' }, swift: { Icon: SiSwift, color: '#f05138' },
    c: { Icon: SiC, color: '#a8b9cc' }, h: { Icon: SiC, color: '#a8b9cc' },
    cpp: { Icon: SiCplusplus, color: '#00599c' }, cc: { Icon: SiCplusplus, color: '#00599c' }, hpp: { Icon: SiCplusplus, color: '#00599c' },
    cs: { Icon: SiSharp, color: '#9b4f96' }, dart: { Icon: SiDart, color: '#0175c2' },
    lua: { Icon: SiLua, color: '#2c2d72' }, pl: { Icon: SiPerl, color: '#39457e' }, pm: { Icon: SiPerl, color: '#39457e' },
    scala: { Icon: SiScala, color: '#dc322f' }, ex: { Icon: SiElixir, color: '#4b275f' }, exs: { Icon: SiElixir, color: '#4b275f' },
    clj: { Icon: SiClojure, color: '#5881d8' }, hs: { Icon: SiHaskell, color: '#5e5086' }, r: { Icon: SiR, color: '#276dc3' },
    // Data / config / tooling
    json: { Icon: SiJson, color: '#cbcb41' },
    yaml: { Icon: SiYaml, color: '#cb171e' }, yml: { Icon: SiYaml, color: '#cb171e' },
    toml: { Icon: SiToml, color: '#9c4221' }, md: { Icon: SiMarkdown, color: '#cbd5e1' }, markdown: { Icon: SiMarkdown, color: '#cbd5e1' },
    graphql: { Icon: SiGraphql, color: '#e10098' }, gql: { Icon: SiGraphql, color: '#e10098' }, prisma: { Icon: SiPrisma, color: '#2d3748' },
    dockerfile: { Icon: SiDocker, color: '#2496ed' },
    sql: { Icon: SiMysql, color: '#4479a1' }, sqlite: { Icon: SiSqlite, color: '#003b57' }, sqlite3: { Icon: SiSqlite, color: '#003b57' }, db: { Icon: SiSqlite, color: '#003b57' },
    sh: { Icon: SiGnubash, color: '#4eaa25' }, bash: { Icon: SiGnubash, color: '#4eaa25' }, zsh: { Icon: SiGnubash, color: '#4eaa25' },
};

// Resolve a filename to { kind: 'si'|'fa', Icon, color } — react-icons brand
// logo where we have one, otherwise the FontAwesome category icon.
export function getFileVisual(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const si = SI_FILE_ICONS[ext];
    if (si) return { kind: 'si', Icon: si.Icon, color: si.color };
    const meta = getFileIconMeta(filename);
    return { kind: 'fa', Icon: meta.icon, color: meta.color };
}

// Per-extension icon + brand color. Returns { icon, color } so file rows show a
// recognizable logo (React for .tsx/.jsx, Python, Rust, ...) tinted by language.
export function getFileIconMeta(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    switch (ext) {
        // Web / frameworks
        case 'tsx': case 'jsx': return { icon: faReact, color: '#61dafb' };
        case 'ts':              return { icon: faFileCode, color: '#3178c6' };
        case 'js': case 'mjs': case 'cjs': return { icon: faJs, color: '#f7df1e' };
        case 'vue':             return { icon: faVuejs, color: '#42b883' };
        case 'svelte':          return { icon: faFileCode, color: '#ff3e00' };
        case 'html': case 'htm': return { icon: faHtml5, color: '#e34f26' };
        case 'css': case 'scss': case 'sass': case 'less': return { icon: faCss3Alt, color: '#2965f1' };
        case 'php':             return { icon: faPhp, color: '#8993be' };
        case 'node':            return { icon: faNodeJs, color: '#83cd29' };
        // Languages
        case 'py':              return { icon: faPython, color: '#4b8bbe' };
        case 'rs':              return { icon: faRust, color: '#f74c00' };
        case 'java': case 'class': return { icon: faJava, color: '#e76f00' };
        case 'go':              return { icon: faGolang, color: '#00add8' };
        case 'swift':           return { icon: faSwift, color: '#f05138' };
        case 'rb':              return { icon: faFileCode, color: '#cc342d' };
        case 'c': case 'h':     return { icon: faFileCode, color: '#5c6bc0' };
        case 'cpp': case 'cc': case 'hpp': return { icon: faFileCode, color: '#00599c' };
        case 'cs':              return { icon: faFileCode, color: '#9b4f96' };
        case 'kt': case 'kts':  return { icon: faFileCode, color: '#a97bff' };
        // Data / config / docs
        case 'json':            return { icon: faFileCode, color: '#cbcb41' };
        case 'xml': case 'yaml': case 'yml': case 'toml': return { icon: faFileCode, color: '#89cff0' };
        case 'md': case 'markdown': return { icon: faMarkdown, color: '#cbd5e1' };
        case 'sql': case 'db': case 'sqlite': case 'sqlite3': return { icon: faDatabase, color: '#38bdf8' };
        case 'txt': case 'log': case 'rtf': return { icon: faFileLines, color: '#94a3b8' };
        case 'pdf':             return { icon: faFilePdf, color: '#ef4444' };
        case 'doc': case 'docx': return { icon: faFileWord, color: '#2b579a' };
        case 'xls': case 'xlsx': return { icon: faFileExcel, color: '#217346' };
        case 'ppt': case 'pptx': return { icon: faFilePowerpoint, color: '#d24726' };
        case 'csv':             return { icon: faFileCsv, color: '#217346' };
        // Media
        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp': case 'bmp': case 'ico': case 'tiff': case 'heic':
            return { icon: faImage, color: '#c084fc' };
        case 'mp4': case 'mkv': case 'avi': case 'mov': case 'wmv': case 'flv': case 'webm': case 'm4v':
            return { icon: faVideo, color: '#f87171' };
        case 'mp3': case 'wav': case 'flac': case 'ogg': case 'aac': case 'm4a': case 'wma':
            return { icon: faMusic, color: '#34d399' };
        // Archives / scripts / binaries / fonts
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz': case 'bz2': case 'xz':
            return { icon: faFileZipper, color: '#eab308' };
        case 'sh': case 'bash': case 'zsh': case 'bat': case 'cmd': case 'ps1':
            return { icon: faTerminal, color: '#4ade80' };
        case 'ttf': case 'otf': case 'woff': case 'woff2':
            return { icon: faFont, color: '#a78bfa' };
        case 'exe': case 'msi': case 'dmg': case 'pkg': case 'deb': case 'rpm': case 'appimage':
            return { icon: faMicrochip, color: '#94a3b8' };
        default:
            return { icon: faFile, color: null };
    }
}

function getFileIcon(filename) {
    return getFileIconMeta(filename).icon;
}

export function getIcon(type, name) {
    switch (type) {
        case 'tab': return faGlobe;
        case 'history': return faHistory;
        case 'bookmark': return faStar;
        case 'workspace': return getWorkspaceIcon(name);
        case 'note': return faStickyNote;
        case 'app': return faDesktop;
        case 'file': return getFileIcon(name);
        case 'folder': return faFolderOpen;
        case 'setting': return faCog;
        case 'tool': return faTools;
        case 'command': return faTerminal;
        case 'agent-suggest': return faRobot;
        case 'workspace-edit': return faFolder;
        case 'todo': return faTasks;
        default: return faLink;
    }
}
