import { useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extensions';
import { TICKETS_COLOR } from './ticketConstants';

// ─── Styles de contenu de l'éditeur (injectés une seule fois) ────────────────
// Tiptap rend dans un .ProseMirror ; on scope nos styles à .yv-rich-editor.
const STYLE_ID = 'yv-rich-editor-styles';
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .yv-rich-editor .ProseMirror {
      outline: none;
      min-height: 100%;
      font-family: Lato, sans-serif;
      font-size: 14px;
      color: #2a2e38;
      line-height: 1.55;
    }
    .yv-rich-editor .ProseMirror p { margin: 0 0 8px; }
    .yv-rich-editor .ProseMirror p:last-child { margin-bottom: 0; }
    .yv-rich-editor .ProseMirror ul,
    .yv-rich-editor .ProseMirror ol { margin: 0 0 8px; padding-left: 22px; }
    .yv-rich-editor .ProseMirror li { margin: 2px 0; }
    .yv-rich-editor .ProseMirror a {
      color: ${TICKETS_COLOR}; font-weight: 600;
      text-decoration: underline; word-break: break-word;
    }
    .yv-rich-editor .ProseMirror:focus { outline: none; }
    /* Placeholder (quand vide) */
    .yv-rich-editor .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left; color: #8A99A4; pointer-events: none; height: 0;
    }
  `;
  document.head.appendChild(el);
}

/**
 * Éditeur riche WYSIWYG (Tiptap) — remplace la textarea du composer SAV.
 *
 * Props :
 *  - value        : HTML courant (contrôlé de l'extérieur pour macros/draft/reset)
 *  - onChange(html): appelé à chaque modification
 *  - placeholder  : texte affiché quand vide
 *  - editorRef    : ref exposant insertText / setLink / setHTML / clear / getText / focus / isEmpty
 */
export default function RichEditor({ value, onChange, placeholder, editorRef }) {
  ensureStyles();

  // Placeholder réactif (public ↔ note privée) sans re-créer l'éditeur :
  // la fonction Placeholder lit toujours la dernière valeur via ce ref.
  const placeholderRef = useRef(placeholder || '');
  placeholderRef.current = placeholder || '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? '' : editor.getHTML();
      onChange?.(html);
    },
  });

  // Synchroniser le contenu externe → éditeur (draft restauré, reset après envoi,
  // changement de ticket). On évite la boucle en comparant au HTML courant.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    const next = value || '';
    if (next !== current) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  // API impérative pour le parent (emoji, lien, macros…)
  useImperativeHandle(editorRef, () => ({
    insertText: (str) => editor?.chain().focus().insertContent(str).run(),
    setLink: ({ url, text }) => {
      if (!editor) return;
      const chain = editor.chain().focus();
      const { from, to } = editor.state.selection;
      if (from === to) {
        // Pas de sélection : insérer le texte affiché puis le lier
        const label = text || url;
        chain.insertContent(label)
          .setTextSelection({ from, to: from + label.length })
          .setLink({ href: url })
          .setTextSelection(from + label.length)
          .run();
      } else {
        // Sélection existante : si un texte affiché custom est fourni, on remplace
        if (text && text.trim()) {
          chain.insertContent(text).setTextSelection({ from, to: from + text.length })
            .setLink({ href: url }).run();
        } else {
          chain.setLink({ href: url }).run();
        }
      }
    },
    getSelectedText: () => {
      if (!editor) return '';
      const { from, to } = editor.state.selection;
      return from === to ? '' : editor.state.doc.textBetween(from, to, ' ');
    },
    setHTML: (html) => editor?.chain().focus().setContent(html || '', { emitUpdate: true }).run(),
    clear: () => editor?.chain().clearContent(true).run(),
    getText: () => editor?.getText() || '',
    isEmpty: () => editor?.isEmpty ?? true,
    focus: () => editor?.chain().focus().run(),
  }), [editor]);

  return (
    <div
      className="yv-rich-editor"
      style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '14px 14px 10px', boxSizing: 'border-box',
        cursor: 'text',
      }}
      onClick={() => editor?.chain().focus().run()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
