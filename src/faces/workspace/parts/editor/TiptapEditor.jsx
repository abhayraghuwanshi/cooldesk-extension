import {
    faBold,
    faCheckSquare,
    faCode,
    faImage,
    faItalic,
    faListUl,
    faMinus,
    faObjectGroup,
    faObjectUngroup,
    faPlus,
    faQuoteRight,
    faStrikethrough,
    faTable,
    faTrash,
    faUnderline
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { marked } from 'marked';
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
    // Ref to access the editor instance from inside the paste handler closure
    const editorInstanceRef = useRef(null);

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
        Image.configure({
            allowBase64: true,
            inline: true,
            HTMLAttributes: {
                class: 'tiptap-image',
                style: 'max-width: 100%; border-radius: 8px;'
            },
        }),
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
            const imageItem = items.find(x => x.type.indexOf('image') === 0);

            if (imageItem) {
                event.preventDefault();
                const file = imageItem.getAsFile();
                const reader = new FileReader();
                reader.onload = (e) => {
                    const { schema } = view.state;
                    const node = schema.nodes.image.create({ src: e.target.result });
                    const transaction = view.state.tr.replaceSelectionWith(node);
                    view.dispatch(transaction);
                };
                reader.onerror = (e) => console.error('[Tiptap] Failed to read image file:', e);
                reader.readAsDataURL(file);
                return true;
            }

            // If there's already rich HTML in the clipboard (e.g. copy from a webpage), let Tiptap handle it
            const hasHtml = items.some(x => x.type === 'text/html');
            if (hasHtml) return false;

            // Check if plain text looks like markdown and convert it
            const text = event.clipboardData?.getData('text/plain') || '';
            const looksLikeMarkdown = /^#{1,6}\s|^\*\*|^[-*]\s|\*\*.*\*\*|^>\s|^```|^\d+\.\s/m.test(text);
            if (text && looksLikeMarkdown) {
                event.preventDefault();
                const html = marked.parse(text, { breaks: true });
                editorInstanceRef.current?.chain().focus().insertContent(html).run();
                return true;
            }

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
        onCreate: ({ editor }) => {
            editorInstanceRef.current = editor;
        },
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
                    <div className="divider" />
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
                    <div className="divider" />
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
                    <button onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add Column Before" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Col ←</span>
                    </button>
                    <button onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add Column After" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Col →</span>
                    </button>
                    <button onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete Column" style={{ gap: '4px', padding: '6px 10px', width: 'auto', color: '#ef4444' }}>
                        <FontAwesomeIcon icon={faTrash} />
                        <span>Col</span>
                    </button>
                    <div className="divider" />

                    {/* Rows */}
                    <button onClick={() => editor.chain().focus().addRowBefore().run()} title="Add Row Above" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Row ↑</span>
                    </button>
                    <button onClick={() => editor.chain().focus().addRowAfter().run()} title="Add Row Below" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Row ↓</span>
                    </button>
                    <button onClick={() => editor.chain().focus().deleteRow().run()} title="Delete Row" style={{ gap: '4px', padding: '6px 10px', width: 'auto', color: '#ef4444' }}>
                        <FontAwesomeIcon icon={faTrash} />
                        <span>Row</span>
                    </button>
                    <div className="divider" />

                    {/* Cells */}
                    <button onClick={() => editor.chain().focus().mergeCells().run()} title="Merge Cells" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faObjectGroup} />
                        <span>Merge</span>
                    </button>
                    <button onClick={() => editor.chain().focus().splitCell().run()} title="Split Cell" style={{ gap: '4px', padding: '6px 10px', width: 'auto' }}>
                        <FontAwesomeIcon icon={faObjectUngroup} />
                        <span>Split</span>
                    </button>
                    <div className="divider" />
                    <button
                        onClick={() => {
                            if (confirm('Delete entire table?')) editor.chain().focus().deleteTable().run()
                        }}
                        title="Delete Table"
                        style={{ gap: '4px', padding: '6px 10px', width: 'auto', color: '#ef4444' }}
                    >
                        <FontAwesomeIcon icon={faTrash} />
                        <span>Table</span>
                    </button>
                </BubbleMenu>
            )}

            {/* Main Editor Content */}
            <EditorContent editor={editor} className="tiptap-content" />
        </div>
    );
});

export default memo(TiptapEditor);
