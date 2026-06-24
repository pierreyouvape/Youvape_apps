import { useEffect } from 'react';

/**
 * Tiroir glissant générique pour les layouts mobiles.
 *
 * Affiche `children` dans un panneau en position fixe qui glisse depuis le
 * bord gauche ou droit, par-dessus un voile sombre cliquable. Utilisé pour la
 * nav AppShell, les vues, et les panneaux Champs/Client de la fiche ticket.
 *
 * Props :
 *   open       bool      — tiroir ouvert ?
 *   onClose    fn        — appelé au clic sur le voile ou la touche Échap
 *   side       'left'|'right' (défaut 'left')
 *   width      number|string — largeur du panneau (défaut: min(86vw, 360px))
 *   zIndex     number    — z-index du voile (le panneau est au-dessus)
 *   children   ReactNode
 */
export default function Drawer({
  open,
  onClose,
  side = 'left',
  width = 'min(86vw, 360px)',
  zIndex = 2000,
  children,
}) {
  // Fermeture au clavier (Échap) + verrou du scroll de fond quand ouvert.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const hiddenTransform = side === 'right' ? 'translateX(100%)' : 'translateX(-100%)';

  return (
    <>
      {/* Voile — monté seulement quand ouvert, fondu via opacity */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(20,24,33,0.45)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
          zIndex,
        }}
      />
      {/* Panneau glissant */}
      <div
        style={{
          position: 'fixed', top: 0, bottom: 0,
          [side]: 0,
          width,
          maxWidth: '100vw',
          background: '#fff',
          boxShadow: side === 'right'
            ? '-8px 0 24px rgba(0,0,0,0.18)'
            : '8px 0 24px rgba(0,0,0,0.18)',
          transform: open ? 'translateX(0)' : hiddenTransform,
          transition: 'transform 0.22s ease',
          zIndex: zIndex + 1,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </>
  );
}
