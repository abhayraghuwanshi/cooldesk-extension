import { faChevronLeft, faChevronRight, faExclamationTriangle, faFileLines, faFilePdf, faFolderOpen, faImage, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
// Load order matters — each of these extends/clones an earlier one
// (typescript extends javascript, tsx extends jsx+typescript, cpp extends c,
// …), so importing out of order leaves the later language silently falling
// back to whatever partial grammar happened to exist yet.
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import './PreviewPane.css';

function formatBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Middle-ellipsis so both the drive/leading folders and the filename stay
// visible — a plain CSS text-overflow: ellipsis on a long path hides the
// filename, which is the part that actually matters here.
function ellipsizeMiddle(text, max = 64) {
    if (!text || text.length <= max) return text;
    const keep = Math.floor((max - 1) / 2);
    return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`;
}

const PREVIEW_ICONS = { image: faImage, code: faFileLines, video: faVideo, pdf: faFilePdf };

function Skeleton() {
    return (
        <div className="preview-pane-skeleton">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="preview-pane-skeleton-line" style={{ width: `${55 + (i * 37) % 40}%` }} />
            ))}
        </div>
    );
}

function ErrorState({ message }) {
    return (
        <div className="preview-pane-error">
            <FontAwesomeIcon icon={faExclamationTriangle} />
            <div>{message}</div>
        </div>
    );
}

/** Image and code/text previews share one shape: invoke a Rust command with
 * the path, debounced and request-guarded against rapid arrow-key scrolling. */
function useFilePreview(path, kind, command) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null });
    const requestIdRef = useRef(0);
    const debounceRef = useRef(null);

    useEffect(() => {
        if (!path || !command) return undefined;

        const requestId = ++requestIdRef.current;
        setState({ status: 'loading', data: null, error: null });

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const result = await invoke(command, { path });
                if (requestIdRef.current !== requestId) return; // superseded by a newer selection
                setState({ status: 'ready', data: result, error: null });
            } catch (e) {
                if (requestIdRef.current !== requestId) return;
                setState({ status: 'error', data: null, error: typeof e === 'string' ? e : (e?.message || 'Preview failed') });
            }
        }, 120);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [path, kind, command]);

    return state;
}

function ImagePreview({ item, fileName }) {
    const state = useFilePreview(item.path, 'image', 'preview_image_file');
    const [dims, setDims] = useState(null);

    if (state.status === 'loading') return <Skeleton />;
    if (state.status === 'error') return <ErrorState message="Couldn't preview this image." />;

    return (
        <>
            <div className="preview-pane-image-wrap">
                <img
                    src={state.data.data_url}
                    alt={fileName}
                    className="preview-pane-image"
                    onLoad={(e) => setDims({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
                />
                {dims && <div className="preview-pane-image-dims">{dims.width} × {dims.height}</div>}
            </div>
            <div className="preview-pane-footer-meta">{formatBytes(state.data.size)}</div>
        </>
    );
}

function CodePreview({ item }) {
    const state = useFilePreview(item.path, 'code', 'preview_text_file');

    const highlighted = useMemo(() => {
        if (state.status !== 'ready') return null;
        const content = state.data?.content;
        if (typeof content !== 'string') return null;
        const grammar = Prism.languages[item.language] || Prism.languages.markup;
        try {
            return Prism.highlight(content, grammar, item.language);
        } catch {
            // Escape manually — a raw dump beats a crash if a grammar throws
            // on unusual input.
            return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    }, [state.status, state.data, item.language]);

    if (state.status === 'loading') return <Skeleton />;
    if (state.status === 'error') {
        return <ErrorState message={state.error === 'Binary file'
            ? "This file isn't text — no preview available."
            : "Couldn't preview this file."} />;
    }

    return (
        <>
            <div className="preview-pane-footer-meta">{state.data.lines} lines · {formatBytes(state.data.size)}</div>
            <div className="preview-pane-code-wrap">
                <div className="preview-pane-gutter" aria-hidden="true">
                    {Array.from({ length: state.data.lines }).map((_, i) => (
                        <span key={i}>{i + 1}</span>
                    ))}
                </div>
                <pre className="preview-pane-code">
                    <code
                        className={`language-${item.language}`}
                        dangerouslySetInnerHTML={{ __html: highlighted || '' }}
                    />
                </pre>
            </div>
            {state.data.truncated && (
                <div className="preview-pane-truncated">
                    <FontAwesomeIcon icon={faFolderOpen} />
                    Showing the first part of this file — it's larger than the preview limit.
                </div>
            )}
        </>
    );
}

// Video needs no Rust round trip at all — convertFileSrc hands the webview a
// URL it can stream directly from disk via Tauri's asset protocol (scoped to
// $HOME in tauri.conf.json), so playback/seeking work like any normal
// <video>, without ever loading the file into JS memory.
function VideoPreview({ item }) {
    const src = useMemo(() => convertFileSrc(item.path), [item.path]);
    const [errored, setErrored] = useState(false);

    useEffect(() => setErrored(false), [item.path]);

    if (errored) return <ErrorState message="Couldn't play this video." />;

    return (
        <div className="preview-pane-video-wrap">
            <video
                key={item.path}
                src={src}
                controls
                autoPlay={false}
                className="preview-pane-video"
                onError={() => setErrored(true)}
            />
        </div>
    );
}

// PDF.js is loaded on demand (only once a PDF is actually selected) — it's
// real weight on top of Prism, and the vast majority of previews are never
// PDFs at all.
function PdfPreview({ item }) {
    const [status, setStatus] = useState('loading');
    const [doc, setDoc] = useState(null);
    const [pageNum, setPageNum] = useState(1);
    const [numPages, setNumPages] = useState(0);
    const canvasRef = useRef(null);
    const requestIdRef = useRef(0);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        setStatus('loading');
        setDoc(null);
        setPageNum(1);

        (async () => {
            try {
                const pdfjsLib = await import('pdfjs-dist');
                const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
                pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

                // Bytes via Rust `invoke`, not `convertFileSrc` + a URL fetch —
                // same reasoning as ImagePreview above: pdf.js's default loader
                // does HTTP range-request probing against whatever URL it's
                // given, and Tauri's asset:// protocol handler doesn't behave
                // like a real range-capable server for that, so it was failing
                // silently. Handing pdf.js the bytes directly sidesteps it.
                const { invoke } = await import('@tauri-apps/api/core');
                const { data_b64 } = await invoke('preview_pdf_file', { path: item.path });
                const binary = atob(data_b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

                const loaded = await pdfjsLib.getDocument({ data: bytes }).promise;
                if (requestIdRef.current !== requestId) return;
                setDoc(loaded);
                setNumPages(loaded.numPages);
                setStatus('ready');
            } catch (e) {
                if (requestIdRef.current !== requestId) return;
                // Was a silent catch — the error state gave no way to tell a CSP
                // violation (worker/fetch blocked) apart from a genuinely corrupt
                // PDF. Logging it is the only way to diagnose which, since this
                // fires inside an async IIFE with nothing else surfacing it.
                console.error('[PreviewPane] PDF load failed:', e);
                setStatus('error');
            }
        })();
    }, [item.path]);

    useEffect(() => {
        if (!doc || !canvasRef.current) return undefined;
        let cancelled = false;

        (async () => {
            const page = await doc.getPage(pageNum);
            if (cancelled) return;
            // Fixed render scale for crisp text; the canvas is then CSS-scaled
            // down to fit the pane (max-width: 100% in PreviewPane.css) rather
            // than measuring the container — simpler, and avoids a
            // ResizeObserver just for this.
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = canvasRef.current;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
        })();

        return () => { cancelled = true; };
    }, [doc, pageNum]);

    if (status === 'loading') return <Skeleton />;
    if (status === 'error') return <ErrorState message="Couldn't preview this PDF." />;

    return (
        <>
            <div className="preview-pane-pdf-wrap">
                <canvas ref={canvasRef} className="preview-pane-pdf-canvas" />
            </div>
            {numPages > 1 && (
                <div className="preview-pane-pdf-nav">
                    <button
                        onClick={() => setPageNum(p => Math.max(1, p - 1))}
                        disabled={pageNum <= 1}
                        title="Previous page"
                    >
                        <FontAwesomeIcon icon={faChevronLeft} />
                    </button>
                    <span>Page {pageNum} of {numPages}</span>
                    <button
                        onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
                        disabled={pageNum >= numPages}
                        title="Next page"
                    >
                        <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                </div>
            )}
        </>
    );
}

/**
 * Quick-Look-style preview for the currently-selected spotlight result.
 * Images, code/text, video and PDF each get their own renderer below —
 * dispatched here by item.previewKind — so a bug/crash in one kind's
 * fetching logic can't take another kind down with it.
 */
export function PreviewPane({ item }) {
    if (!item) return null;
    const { path, previewKind: kind } = item;
    const fileName = path.split(/[/\\]/).pop();

    return (
        <div className="preview-pane">
            <div className="preview-pane-header">
                <FontAwesomeIcon icon={PREVIEW_ICONS[kind] || faFileLines} className="preview-pane-header-icon" />
                <div className="preview-pane-header-text">
                    <div className="preview-pane-title" title={fileName}>{fileName}</div>
                    <div className="preview-pane-path" title={path}>{ellipsizeMiddle(path)}</div>
                </div>
            </div>

            <div className="preview-pane-body">
                {kind === 'image' && <ImagePreview item={item} fileName={fileName} />}
                {kind === 'code' && <CodePreview item={item} />}
                {kind === 'video' && <VideoPreview item={item} />}
                {kind === 'pdf' && <PdfPreview item={item} />}
            </div>
        </div>
    );
}

export default PreviewPane;
