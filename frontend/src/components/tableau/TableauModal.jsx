import { useEffect } from 'react';

/** Fenêtre modale simple de l'app Tableau (fermeture : voile, Échap, ×). */
export default function TableauModal({ title, onClose, children, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', fontFamily: "'Lato', sans-serif",
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid #E5E7EB',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1F2937' }}>{title}</div>
          <button onClick={onClose} title="Fermer" style={{
            background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer',
          }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}
