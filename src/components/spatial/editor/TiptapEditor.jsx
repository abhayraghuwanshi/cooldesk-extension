import {
    faBold,
    faCheckSquare,
    faCode,
    faImage,
    faItalic,
    faListUl,
    faMinus,
    faQuoteRight,
    faStrikethrough,
    faTable,
    faTrash,
    faUnderline
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import { BubbleMenu, EditorContent, FloatingMenu, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import './TiptapEditor.css';

const TiptapEditor = forwardRef(({ content, onChange, isEditable = true }, ref) => {
    // Debounce timer ref for onChange
    const debounceRef = useRef(null);

    const extensions = useMemo(() => [
        StarterKit.configure({
            heading: {
                levels: [1, 2, 3],
            },
        }),
        Placeholder.configure({
            placeholder: "Type '/' for commands...",
        }),
        TaskList,
        TaskItem.configure({
            nested: true,
        }),
        Link.configure({
            openOnClick: false,
        }),
        Underline,
        Image,
        Table.configure({
            resizable: true,
            HTMLAttributes: {
                class: 'tiptap-table',
            },
        }),
        TableRow,
        TableHeader,
        TableCell,
    ], []);

    const editorProps = useMemo(() => ({
        attributes: {
            class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-none',
        },
        handlePaste: (view, event, slice) => {
            const items = Array.from(event.clipboardData?.items || []);
            console.log('[Tiptap] Paste event items:', items.length, items);
            const item = items.find(x => x.type.indexOf('image') === 0);

            if (item) {
                console.log('[Tiptap] Image item found:', item.type);
                event.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();

                reader.onload = (e) => {
                    console.log('[Tiptap] Image read successfully, creating node');
                    const { schema } = view.state;
                    const node = schema.nodes.image.create({ src: e.target.result });
                    const transaction = view.state.tr.replaceSelectionWith(node);
                    view.dispatch(transaction);
                };

                reader.onerror = (e) => {
                    console.error('[Tiptap] Failed to read image file:', e);
                };

                reader.readAsDataURL(file);
                return true;
            }
            console.log('[Tiptap] No image item found in paste');
            return false;
        },
    }), []);

    // Use a ref to access the latest onChange without re-creating the editor
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    // Debounced onChange handler to reduce INP
    const debouncedOnChange = useCallback((html) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
            onChangeRef.current(html);
        }, 150); // 150ms debounce for better INP
    }, []);

    const editor = useEditor({
        extensions,
        content: content, // Initial content only
        editable: isEditable,
        onUpdate: ({ editor }) => {
            debouncedOnChange(editor.getHTML());
        },
        editorProps,
    }, []); // Stable dependency array

    // Handle external updates to content (e.g. switching notes)
    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            // Avoid re-rendering if content is effectively the same (HTML normalization can vary)
            // For now, we only update if focus is not on editor to prevent cursor jumps,
            // OR if the content is drastically different (switched note).
            if (!editor.isFocused) {
                editor.commands.setContent(content || '');
            }
        }
    }, [content, editor]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        insertContent: (text) => {
            if (editor) {
                editor.chain().focus().insertContent(text).run();
            }
        },
        focus: () => {
            editor?.commands.focus();
        },
        getEditor: () => editor
    }));

    if (!editor) {
        return null;
    }

    return (
        <div className="tiptap-editor-container">
            {/* Floating Menu - appears on empty lines */}
            {isEditable && (
                <FloatingMenu
                    editor={editor}
                    tippyOptions={{
                        duration: 100,
                        placement: 'bottom-start',
                        offset: [0, 10], // Move slightly down
                        maxWidth: 'none'
                    }}
                    className="tiptap-floating-menu"
                >
                    <button
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
                        title="Heading 1"
                    >
                        H1
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
                        title="Heading 2"
                    >
                        H2
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={editor.isActive('bulletList') ? 'is-active' : ''}
                        title="Bullet List"
                    >
                        <FontAwesomeIcon icon={faListUl} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleTaskList().run()}
                        className={editor.isActive('taskList') ? 'is-active' : ''}
                        title="Task List"
                    >
                        <FontAwesomeIcon icon={faCheckSquare} />
                    </button>
                    <div style={{ width: '1px', background: 'var(--border-secondary)', margin: '0 2px' }} />
                    <button
                        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                        className={editor.isActive('codeBlock') ? 'is-active' : ''}
                        title="Code Block"
                    >
                        <FontAwesomeIcon icon={faCode} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        className={editor.isActive('blockquote') ? 'is-active' : ''}
                        title="Quote"
                    >
                        <FontAwesomeIcon icon={faQuoteRight} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().setHorizontalRule().run()}
                        title="Divider"
                    >
                        <FontAwesomeIcon icon={faMinus} />
                    </button>
                    <button
                        onClick={() => {
                            const url = window.prompt('Enter image URL');
                            if (url) {
                                editor.chain().focus().setImage({ src: url }).run();
                            }
                        }}
                        title="Add Image"
                    >
                        <FontAwesomeIcon icon={faImage} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                        title="Insert Table"
                    >
                        <FontAwesomeIcon icon={faTable} />
                    </button>
                </FloatingMenu>
            )}

            {/* Bubble Menu - appears on text selection */}
            {isEditable && (
                <BubbleMenu
                    editor={editor}
                    tippyOptions={{
                        duration: 100,
                        placement: 'top',
                        offset: [0, 10]
                    }}
                    className="tiptap-bubble-menu"
                    shouldShow={({ editor, from, to }) => {
                        // Only show if selection is not empty AND NOT inside a table (table has its own menu)
                        return !editor.isActive('table') && from !== to;
                    }}
                >
                    <button
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        className={editor.isActive('bold') ? 'is-active' : ''}
                        title="Bold"
                    >
                        <FontAwesomeIcon icon={faBold} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        className={editor.isActive('italic') ? 'is-active' : ''}
                        title="Italic"
                    >
                        <FontAwesomeIcon icon={faItalic} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                        className={editor.isActive('underline') ? 'is-active' : ''}
                        title="Underline"
                    >
                        <FontAwesomeIcon icon={faUnderline} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                        className={editor.isActive('strike') ? 'is-active' : ''}
                        title="Strikethrough"
                    >
                        <FontAwesomeIcon icon={faStrikethrough} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleCode().run()}
                        className={editor.isActive('code') ? 'is-active' : ''}
                        title="Code"
                    >
                        <FontAwesomeIcon icon={faCode} />
                    </button>
                    <div style={{ width: '1px', background: 'var(--border-secondary)', margin: '0 2px' }} />
                    <button
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={editor.isActive('bulletList') ? 'is-active' : ''}
                        title="Bullet List"
                    >
                        <FontAwesomeIcon icon={faListUl} />
                    </button>
                    <button
                        onClick={() => editor.chain().focus().toggleTaskList().run()}
                        className={editor.isActive('taskList') ? 'is-active' : ''}
                        title="Task List"
                    >
                        <FontAwesomeIcon icon={faCheckSquare} />
                    </button>
                </BubbleMenu>
            )}

            {/* Table Bubble Menu - appears when inside a table */}
            {isEditable && (
                <BubbleMenu
                    editor={editor}
                    pluginKey="tableBubbleMenu"
                    tippyOptions={{
                        duration: 100,
                        placement: 'top',
                        offset: [0, 10],
                        maxWidth: 'none'
                    }}
                    className="tiptap-bubble-menu table-menu"
                    shouldShow={({ editor }) => editor.isActive('table')}
                >
                    {/* Columns */}
                    <button onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add Column Before">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9" />
                            <path d="M14 3v18" />
                            <path d="M5 12h3m-3 0v-3m0 3v3" />
                        </svg>
                    </button>
                    <button onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add Column After">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10" />
                            <path d="M10 3v18" />
                            <path d="M19 12h3m0 0v-3m0 3v3" />
                        </svg>
                    </button>
                    <button onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete Column">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                            <path d="M10 3v18" />
                            <path d="M14 3v18" />
                            <path d="M4 8h16" style={{ stroke: '#ef4444' }} />
                        </svg>
                    </button>
                    <div style={{ width: '1px', background: 'var(--border-secondary)', margin: '0 2px' }} />

                    {/* Rows */}
                    <button onClick={() => editor.chain().focus().addRowBefore().run()} title="Add Row Before">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 9v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
                            <path d="M3 14h18" />
                            <path d="M12 5v3m0 3v-3m-3 0h3m3 0h-3" />
                        </svg>
                    </button>
                    <button onClick={() => editor.chain().focus().addRowAfter().run()} title="Add Row After">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 15V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10" />
                            <path d="M3 10h18" />
                            <path d="M12 19v3m0 0h-3m3 0h3m0-3v3" />
                        </svg>
                    </button>
                    <button onClick={() => editor.chain().focus().deleteRow().run()} title="Delete Row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <line x1="3" y1="9" x2="21" y2="9" />
                            <line x1="3" y1="15" x2="21" y2="15" />
                            <line x1="8" y1="5" x2="8" y2="19" style={{ stroke: '#ef4444', opacity: 0 }} /> {/* Hidden ref */}
                            <line x1="3" y1="12" x2="21" y2="12" style={{ stroke: '#ef4444' }} />
                        </svg>
                    </button>
                    <div style={{ width: '1px', background: 'var(--border-secondary)', margin: '0 2px' }} />

                    {/* Cells */}
                    <button onClick={() => editor.chain().focus().mergeCells().run()} title="Merge Cells">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 5h18v14H3z" />
                            <path d="M12 5v14" style={{ strokeDasharray: '4 2', opacity: 0.5 }} />
                            <path d="M8 12h8" />
                        </svg>
                    </button>
                    <button onClick={() => editor.chain().focus().splitCell().run()} title="Split Cell">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 5h18v14H3z" />
                            <path d="M12 5v14" />
                        </svg>
                    </button>
                    <div style={{ width: '1px', background: 'var(--border-secondary)', margin: '0 2px' }} />
                    <button
                        onClick={() => {
                            if (confirm('Delete entire table?')) editor.chain().focus().deleteTable().run()
                        }}
                        title="Delete Table"
                        className="text-danger"
                    >
                        <FontAwesomeIcon icon={faTrash} />
                    </button>
                </BubbleMenu>
            )}

            {/* Main Editor Content */}
            <EditorContent editor={editor} className="tiptap-content" />
        </div>
    );
});

export default memo(TiptapEditor);
