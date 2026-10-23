import { useEffect, useImperativeHandle, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { imageFilesOf, copyImageToClipboard, TABLEAU_COLOR } from './tableauShared';

/**
 * Texte enrichi d'un post-it, images comprises (au milieu du texte).
 *
 * Volontairement sans barre d'outils, pour que le post-it reste un post-it :
 * raccourcis seulement (Cmd+B gras, « - » ou « 1. » en début de ligne pour une
 * liste). Une image collée (Cmd+V) ou déposée part sur le serveur et s'insère
 * au curseur — jamais de base64 dans le HTML.
 *
 * Une image cliquée est sélectionnée : Cmd+C la remet dans le presse-papiers
 * (en vraie image, collable ailleurs), Suppr la retire du texte.
 *
 * `ref` expose insertFiles(files), pour le menu « Ajouter une image ».
 */

const STYLE_ID = 'yv-tableau-note-editor';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    .yv-note-editor .ProseMirror { outline: none; min-height: 100%; font-size: 14px; line-height: 1.4; word-break: break-word; }
    .yv-note-editor .ProseMirror p { margin: 0 0 4px; }
    .yv-note-editor .ProseMirror ul, .yv-note-editor .ProseMirror ol { margin: 0 0 4px; padding-left: 20px; }
    .yv-note-editor .ProseMirror a { color: inherit; text-decoration: underline; }
    .yv-note-editor .ProseMirror img { display: block; max-width: 100%; height: auto; margin: 6px 0; border-radius: 4px; cursor: pointer; }
    .yv-note-editor .ProseMirror img.ProseMirror-selectednode { outline: 3px solid ${TABLEAU_COLOR}; outline-offset: 1px; }
    .yv-note-editor .ProseMirror p.is-editor-empty:first-child::before {
      content: attr(data-placeholder); float: left; opacity: 0.45; pointer-events: none; height: 0;
    }
  `;
  document.head.appendChild(el);
}

// Les liens d'images sont re-signés à chaque lecture : on compare sans la signature
const unsigned = (html) => (html || '').replace(/\?exp=\d+&amp;sig=[0-9a-f]+/g, '');

export default function NoteEditor({ value, onChange, onUpload, onFocusChange, onImageSelect, onError, ref }) {
  ensureStyles();
  const cb = useRef({});
  cb.current = { onChange, onUpload, onFocusChange, onImageSelect, onError };
  const editorRef = useRef(null);

  const insertFiles = async (files, pos) => {
    const ed = editorRef.current;
    if (!ed || !files.length) return;
    let at = pos;
    for (const file of files) {
      try {
        const { url } = await cb.current.onUpload(file);
        if (ed.isDestroyed) return;
        const target = Math.min(at ?? ed.state.selection.to, ed.state.doc.content.size);
        const before = ed.state.doc.content.size;
        ed.chain().focus().insertContentAt(target, [
          { type: 'image', attrs: { src: url, alt: '' } },
          { type: 'paragraph' },
        ]).run();
        at = target + (ed.state.doc.content.size - before);
      } catch (e) {
        cb.current.onError?.(e);
      }
    }
  };
  const insertRef = useRef(insertFiles);
  insertRef.current = insertFiles;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, code: false }),
      Placeholder.configure({ placeholder: 'Écrire… (Cmd+V colle une image)' }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: value || '',
    editorProps: {
      handlePaste: (view, event) => {
        const files = imageFilesOf(event.clipboardData);
        if (!files.length) return false;
        insertRef.current(files, view.state.selection.to);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFilesOf(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertRef.current(files, coords?.pos ?? view.state.selection.to);
        return true;
      },
      handleKeyDown: (view, event) => {
        const node = view.state.selection.node;
        if (node?.type.name === 'image' && (event.metaKey || event.ctrlKey) && event.key === 'c') {
          copyImageToClipboard(node.attrs.src).catch((e) => cb.current.onError?.(e));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => cb.current.onChange(ed.isEmpty ? '' : ed.getHTML()),
    onFocus: () => cb.current.onFocusChange?.(true),
    onBlur: () => cb.current.onFocusChange?.(false),
    onSelectionUpdate: ({ editor: ed }) => {
      const node = ed.state.selection.node;
      cb.current.onImageSelect?.(node?.type.name === 'image' ? node.attrs.src : null);
    },
  });
  editorRef.current = editor;

  useImperativeHandle(ref, () => ({ insertFiles: (files) => insertRef.current(files) }), []);

  // Relecture du tableau : on ne remplace pas un texte en cours de frappe
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (unsigned(value) !== unsigned(current)) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  return (
    <div
      className="yv-note-editor"
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 14px', cursor: 'text' }}
      onClick={(e) => { if (e.target === e.currentTarget) editor?.chain().focus('end').run(); }}
    >
      <EditorContent editor={editor} style={{ minHeight: '100%' }} />
    </div>
  );
}
