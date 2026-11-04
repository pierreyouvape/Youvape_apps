import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Node, mergeAttributes, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { TABLEAU_COLOR } from './tableauShared';

/**
 * PDF joint au texte d'un post-it.
 *
 * En base : <div data-type="pdf" data-src="/api/tableau/media/<uuid>.pdf" data-name="Facture.pdf">.
 * data-src en premier : le backend (utils/tableauMedia BODY_SRC) re-signe le lien
 * à chaque lecture et ne doit pas buter sur un « > » dans le nom.
 *
 * À l'écran : une pastille (nom du fichier) ; clic = aperçu en grand dans la
 * page, bouton ⬇ = téléchargement sous le nom d'origine.
 */

/** Lien de téléchargement : le serveur répond en pièce jointe, avec ce nom. */
const pdfDownloadUrl = (src, name) =>
  `${src}${src.includes('?') ? '&' : '?'}dl=${encodeURIComponent(name || 'document.pdf')}`;

function PdfPreview({ src, name, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const link = {
    border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 700,
    textDecoration: 'none', whiteSpace: 'nowrap', fontFamily: 'inherit',
  };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        fontFamily: "'Lato', sans-serif",
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: 'min(1100px, 100%)', height: '100%',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #E5E7EB',
        }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <span style={{
            flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#1F2937',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }} title={name}>{name}</span>
          <a href={src} target="_blank" rel="noopener noreferrer" style={{ ...link, background: '#F3F4F6', color: '#374151' }}>
            Ouvrir dans un onglet
          </a>
          <a href={pdfDownloadUrl(src, name)} style={{ ...link, background: TABLEAU_COLOR, color: '#fff' }}>
            Télécharger
          </a>
          <button onClick={onClose} title="Fermer (Échap)" style={{
            background: 'none', border: 'none', fontSize: 24, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer', padding: '0 4px',
          }}>×</button>
        </div>
        <iframe title={name} src={src} style={{ flex: 1, width: '100%', border: 'none', background: '#525659' }} />
      </div>
    </div>,
    document.body,
  );
}

function PdfChip({ node, selected }) {
  const { src, name } = node.attrs;
  const [open, setOpen] = useState(false);

  const btn = {
    background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '3px 7px', color: '#374151',
    textDecoration: 'none', lineHeight: 1.3, fontFamily: 'inherit', flexShrink: 0,
  };

  return (
    <NodeViewWrapper
      contentEditable={false}
      data-drag-handle=""
      style={{
        display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0', padding: '5px 6px 5px 8px',
        background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 7,
        outline: selected ? `3px solid ${TABLEAU_COLOR}` : 'none', outlineOffset: 1, userSelect: 'none',
      }}
    >
      <span
        onClick={() => setOpen(true)}
        title={`Aperçu de ${name}`}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, cursor: 'pointer' }}
      >
        <span style={{
          flexShrink: 0, background: '#DC2626', color: '#fff', borderRadius: 4,
          fontSize: 9.5, fontWeight: 900, padding: '2px 4px', letterSpacing: 0.3,
        }}>PDF</span>
        <span style={{
          fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{name}</span>
      </span>
      <button type="button" style={btn} onClick={() => setOpen(true)} title="Aperçu">👁</button>
      <a style={btn} href={pdfDownloadUrl(src, name)} title="Télécharger" draggable={false}>⬇</a>
      {open && <PdfPreview src={src} name={name} onClose={() => setOpen(false)} />}
    </NodeViewWrapper>
  );
}

export const PdfNode = Node.create({
  name: 'pdfFile',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-src'),
        renderHTML: (attrs) => ({ 'data-src': attrs.src }),
      },
      name: {
        default: 'document.pdf',
        parseHTML: (el) => el.getAttribute('data-name') || 'document.pdf',
        renderHTML: (attrs) => ({ 'data-name': attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pdf"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Ordre : data-type, data-src, data-name (cf. en-tête)
    return ['div', mergeAttributes({ 'data-type': 'pdf' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfChip);
  },
});
