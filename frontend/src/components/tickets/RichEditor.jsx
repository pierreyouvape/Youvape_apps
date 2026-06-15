import { useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { TextSelection } from 'prosemirror-state';
import { TICKETS_COLOR } from './ticketConstants';

// Triple-clic : sélectionner la LIGNE logique (segment borné par les sauts de
// ligne <br> / frontières de bloc), pas le paragraphe entier comme le fait
// ProseMirror par défaut. `pos` est la position cliquée.
function selectLineAt(view, pos) {
  const { state } = view;
  const { doc } = state;
  const $pos = doc.resolve(pos);
  // Bornes du bloc texte contenant le clic.
  const blockStart = $pos.start();
  const blockEnd = $pos.end();

  // Étend vers la gauche jusqu'à un hardBreak (exclu) ou le début du bloc.
  let from = blockStart;
  for (let p = pos; p > blockStart; p--) {
    const node = doc.nodeAt(p - 1);
    if (node && node.type.name === 'hardBreak') { from = p; break; }
  }
  // Étend vers la droite jusqu'à un hardBreak (exclu) ou la fin du bloc.
  let to = blockEnd;
  for (let p = pos; p < blockEnd; p++) {
    const node = doc.nodeAt(p);
    if (node && node.type.name === 'hardBreak') { to = p; break; }
  }

  const tr = state.tr.setSelection(TextSelection.create(doc, from, to));
  view.dispatch(tr);
  return true; // on a géré la sélection, ProseMirror n'applique pas son défaut
}

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
    .yv-rich-editor .ProseMirror img {
      max-width: 100%; max-height: 320px; display: block;
      border-radius: 6px; margin: 6px 0;
    }
    .yv-rich-editor .ProseMirror img.yv-image-uploading {
      opacity: 0.5;
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
 *  - onImageUpload(file) : appelé quand une image est collée (Ctrl+V) — doit
 *    uploader le fichier et renvoyer une Promise<string> (URL publique). L'image
 *    est alors insérée directement dans le texte.
 */
export default function RichEditor({ value, onChange, placeholder, editorRef, onStateChange, onImageUpload }) {
  ensureStyles();

  // Placeholder réactif (public ↔ note privée) sans re-créer l'éditeur :
  // la fonction Placeholder lit toujours la dernière valeur via ce ref.
  const placeholderRef = useRef(placeholder || '');
  placeholderRef.current = placeholder || '';

  // Ref pour ne pas re-créer l'éditeur quand onImageUpload change de référence
  const onImageUploadRef = useRef(onImageUpload);
  onImageUploadRef.current = onImageUpload;

  // Remonte au parent l'état des marques actives (gras, italique…) pour
  // surligner les boutons de la toolbar.
  const reportState = (ed) => {
    if (!ed || !onStateChange) return;
    onStateChange({
      bold:       ed.isActive('bold'),
      italic:     ed.isActive('italic'),
      underline:  ed.isActive('underline'),
      bulletList: ed.isActive('bulletList'),
      orderedList: ed.isActive('orderedList'),
    });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      Image.configure({ inline: true, allowBase64: true }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    editorProps: {
      // Triple-clic : sélectionner la ligne logique, pas tout le paragraphe.
      handleTripleClick: (view, pos) => selectLineAt(view, pos),
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        const imageFiles = Array.from(items)
          .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
          .map(it => it.getAsFile())
          .filter(Boolean);
        if (imageFiles.length === 0 || !onImageUploadRef.current) return false;

        imageFiles.forEach(async (file) => {
          try {
            const url = await onImageUploadRef.current(file);
            if (url) {
              editor?.chain().focus().setImage({ src: url }).run();
            }
          } catch (err) {
            console.error('Erreur upload image collée :', err);
          }
        });
        return true; // image insérée inline une fois uploadée, pas de comportement par défaut
      },
    },
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? '' : editor.getHTML();
      onChange?.(html);
      reportState(editor);
    },
    onSelectionUpdate: ({ editor }) => reportState(editor),
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
    // Commandes de formatage (boutons toolbar)
    toggleBold:       () => editor?.chain().focus().toggleBold().run(),
    toggleItalic:     () => editor?.chain().focus().toggleItalic().run(),
    toggleUnderline:  () => editor?.chain().focus().toggleUnderline().run(),
    toggleBulletList: () => editor?.chain().focus().toggleBulletList().run(),
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
