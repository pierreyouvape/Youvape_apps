import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
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
 * Les captures s'insèrent DANS le texte, à l'endroit du curseur : collées
 * (Cmd+V), déposées, ou via le bouton « Capture ». Le fichier part sur le
 * serveur (onUploadImage) et seule son URL entre dans le HTML — jamais de
 * base64. La bande photo sous le texte reste disponible à côté.
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
    .yv-process-editor .ProseMirror img {
      display: block; max-width: 100%; max-height: 420px; height: auto;
      margin: 10px 0; border: 1px solid ${C.grisCL}; border-radius: 8px;
    }
    .yv-process-editor .ProseMirror img.ProseMirror-selectednode {
      outline: 3px solid ${PROCESS_COLOR}; outline-offset: 2px;
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

function Toolbar({ editor, onPickImages, uploading }) {
  const fileRef = useRef(null);
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
      {onPickImages && (
        <>
          {b('📷 Capture', () => fileRef.current?.click(), false, 'Insérer une capture à l\'endroit du curseur (ou collez-la avec Cmd+V)')}
          <input
            ref={fileRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { onPickImages(e.target.files); e.target.value = ''; }}
          />
        </>
      )}
      {uploading > 0 && (
        <span style={{ fontSize: 12, color: C.grisM, alignSelf: 'center', marginLeft: 4 }}>
          Envoi de la capture…
        </span>
      )}
    </div>
  );
}

const imageFiles = (list) =>
  Array.from(list || []).filter((f) => f && f.type && f.type.startsWith('image/'));

export default function ProcessEditor({ value, onChange, placeholder, onUploadImage }) {
  ensureStyles();
  const [uploading, setUploading] = useState(0);

  // Refs : ces callbacks changent d'identité à chaque rendu du parent, or
  // recréer l'éditeur ferait perdre le curseur à chaque frappe.
  const onUploadImageRef = useRef(onUploadImage);
  onUploadImageRef.current = onUploadImage;
  const editorRef = useRef(null);

  /**
   * Envoie les fichiers puis insère chaque capture à `pos` (position du
   * curseur au moment du collage, ou point de dépôt), dans l'ordre.
   */
  const insertImagesRef = useRef(null);
  insertImagesRef.current = async (files, pos) => {
    const upload = onUploadImageRef.current;
    const ed = editorRef.current;
    if (!upload || !ed || files.length === 0) return;
    let at = pos;
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const image = await upload(file);
        if (!image?.url || ed.isDestroyed) continue;
        // Le texte a pu bouger pendant l'envoi : on borne à la taille du document.
        const target = Math.min(at ?? ed.state.selection.to, ed.state.doc.content.size);
        const before = ed.state.doc.content.size;
        ed.chain().focus()
          .insertContentAt(target, { type: 'image', attrs: { src: image.url, alt: image.original_name || '' } })
          .run();
        at = target + (ed.state.doc.content.size - before);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
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
      Image.configure({ inline: false, allowBase64: false }),
    ],
    editorProps: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items || !onUploadImageRef.current) return false;
        const files = imageFiles(Array.from(items)
          .filter((it) => it.kind === 'file')
          .map((it) => it.getAsFile()));
        if (files.length === 0) return false;
        // La capture s'insère là où est le curseur.
        insertImagesRef.current(files, view.state.selection.to);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // moved = déplacement d'un contenu déjà dans l'éditeur : comportement natif.
        if (moved || !onUploadImageRef.current) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertImagesRef.current(files, coords?.pos ?? view.state.selection.to);
        return true;
      },
    },
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.isEmpty ? '' : editor.getHTML()),
  });
  editorRef.current = editor;

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
      <Toolbar
        editor={editor}
        uploading={uploading}
        onPickImages={onUploadImage
          ? (list) => insertImagesRef.current(imageFiles(list), editor?.state.selection.to)
          : null}
      />
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
