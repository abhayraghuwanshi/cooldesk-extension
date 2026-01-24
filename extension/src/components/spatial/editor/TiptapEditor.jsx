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
    faUnderline
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import { BubbleMenu, EditorContent, FloatingMenu, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import './TiptapEditor.css';
// ... imports

const TiptapEditor = forwardRef(({ content, onChange, isEditable = true }, ref) => {

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
    ], []);

    const editorProps = useMemo(() => ({
        attributes: {
            class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-none',
        },
        handlePaste: (view, event, slice) => {
            const items = Array.from(event.clipboardData?.items || []);
            const item = items.find(x => x.type.indexOf('image') === 0);

            if (item) {
                event.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();

                reader.onload = (e) => {
                    const { schema } = view.state;
                    const node = schema.nodes.image.create({ src: e.target.result });
                    const transaction = view.state.tr.replaceSelectionWith(node);
                    view.dispatch(transaction);
                };

                reader.readAsDataURL(file);
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

    const editor = useEditor({
        extensions,
        content: content, // Initial content only
        editable: isEditable,
        onUpdate: ({ editor }) => {
            onChangeRef.current(editor.getHTML());
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
                </BubbleMenu>
            )}

            {/* Main Editor Content */}
            <EditorContent editor={editor} className="tiptap-content" />
        </div>
    );
});

export default memo(TiptapEditor);
