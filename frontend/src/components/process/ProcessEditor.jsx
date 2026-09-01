import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extensions';
import { C, PROCESS_COLOR } from './processConstants';

/**
 * Éditeur riche du corps d'une étape.
 *
 * Volontairement distinct de components/tickets/RichEditor.jsx : les besoins ne
 * se recouvrent pas. Ici on veut des sous-titres, du code et des citations
 * (chemins de fichiers, requêtes SQL, mises en garde) ; là-bas on veut une API
 * impérative pour les macros et les emojis, mais pas de titres.
 *
 * Les images ne passent PAS par l'éditeur : une capture collée est remontée au
 * parent via onPasteImage et rejoint la bande photo de l'étape, pour que toutes
 * les photos vivent au même endroit, légendées et ordonnées.
 */

const STYLE_ID = 'yv-process-editor-styles';
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .yv-process-editor .ProseMirror {
      outline: none; min-height: 90px;
      font-family: Lato, sans-serif; font-size: 14px;
      color: ${C.grisTF}; line-height: 1.6;
    }
    .yv-process-editor .ProseMirror p { margin: 0 0 8px; }
    .yv-process-editor .ProseMirror p:last-child { margin-bottom: 0; }
    .yv-process-editor .ProseMirror h3 { font-size: 15px; font-weight: 800; margin: 12px 0 6px; }
    .yv-process-editor .ProseMirror h4 { font-size: 14px; font-weight: 700; margin: 10px 0 5px; }
    .yv-process-editor .ProseMirror ul,
    .yv-process-editor .ProseMirror ol { margin: 0 0 8px; padding-left: 22px; }
    .yv-process-editor .ProseMirror li { margin: 3px 0; }
    .yv-process-editor .ProseMirror a {
      color: ${PROCESS_COLOR}; font-weight: 600; text-decoration: underline; word-break: break-word;
    }
    .yv-process-editor .ProseMirror code {
      background: ${C.grisTL}; border: 1px solid ${C.grisCL}; border-radius: 4px;
      padding: 1px 5px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px;
    }
    .yv-process-editor .ProseMirror pre {
      background: ${C.grisTF}; color: #F2F6F8; border-radius: 8px;
      padding: 10px 12px; overflow-x: auto; margin: 8px 0;
    }
    .yv-process-editor .ProseMirror pre code { background: none; border: none; color: inherit; padding: 0; }
    .yv-process-editor .ProseMirror blockquote {
      border-left: 3px solid ${C.grisCL}; margin: 8px 0; padding: 2px 0 2px 12px; color: ${C.grisF};
    }
    .yv-process-editor .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder);
      float: left; color: ${C.grisM}; pointer-events: none; height: 0;
    }
  `;
  document.head.appendChild(el);
}

const btnStyle = (active) => ({
  minWidth: 30, height: 28, padding: '0 8px',
  border: `1px solid ${active ? PROCESS_COLOR : C.grisCL}`,
  background: active ? '#F5EDFF' : C.blanc,
  color: active ? PROCESS_COLOR : C.grisF,
  borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
});

function Toolbar({ editor }) {
  if (!editor) return null;
  const b = (label, action, active, title) => (
    <button type="button" title={title} onClick={action} style={btnStyle(active)}>{label}</button>
  );

  const setLink = () => {
    const previous = editor.getAttributes('link').href || '';
    const url = window.prompt('Adresse du lien', previous);
    if (url === null) return;
    if (url.trim() === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5, padding: '7px 9px',
      borderBottom: `1px solid ${C.grisCL}`, background: C.grisTL,
      borderRadius: '8px 8px 0 0',
    }}>
      {b(<strong>B</strong>, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Gras')}
      {b(<em>I</em>, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italique')}
      {b(<span style={{ textDecoration: 'underline' }}>U</span>, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Souligné')}
      <span style={{ width: 1, background: C.grisCL, margin: '0 3px' }} />
      {b('T1', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }), 'Sous-titre')}
      {b('T2', () => editor.chain().focus().toggleHeading({ level: 4 }).run(), editor.isActive('heading', { level: 4 }), 'Petit sous-titre')}
      <span style={{ width: 1, background: C.grisCL, margin: '0 3px' }} />
      {b('• Liste', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Liste à puces')}
      {b('1. Liste', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Liste numérotée')}
      <span style={{ width: 1, background: C.grisCL, margin: '0 3px' }} />
      {b('</>', () => editor.chain().focus().toggleCode().run(), editor.isActive('code'), 'Code (chemin, SKU, requête…)')}
      {b('Bloc', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'), 'Bloc de code')}
      {b('❝', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Citation')}
      <span style={{ width: 1, background: C.grisCL, margin: '0 3px' }} />
      {b('Lien', setLink, editor.isActive('link'), 'Insérer un lien')}
    </div>
  );
}

export default function ProcessEditor({ value, onChange, placeholder, onPasteImage }) {
  ensureStyles();

  // Refs : ces callbacks changent d'identité à chaque rendu du parent, or
  // recréer l'éditeur ferait perdre le curseur à chaque frappe.
  const onPasteImageRef = useRef(onPasteImage);
  onPasteImageRef.current = onPasteImage;
  const placeholderRef = useRef(placeholder || '');
  placeholderRef.current = placeholder || '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items || !onPasteImageRef.current) return false;
        const files = Array.from(items)
          .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
          .map((it) => it.getAsFile())
          .filter(Boolean);
        if (files.length === 0) return false;
        // La capture rejoint la bande photo de l'étape, pas le corps du texte.
        files.forEach((f) => onPasteImageRef.current(f));
        return true;
      },
    },
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.isEmpty ? '' : editor.getHTML()),
  });

  // Synchronise un changement venu de l'extérieur (annulation, restauration)
  // sans casser la frappe en cours.
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if ((value || '') !== current) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, background: C.blanc }}>
      <Toolbar editor={editor} />
      <div
        className="yv-process-editor"
        style={{ padding: '12px 14px', cursor: 'text' }}
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
