/**
 * Logo posé sur un nuage blanc, pour les headers bleus.
 * Le nuage déborde légèrement en bas pour un effet "flottant".
 */
const CloudLogo = ({ logoHeight = 68 }) => (
  <div style={{ position: 'relative', width: '260px', height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {/* Nuage SVG : forme centrée dans le conteneur, fond blanc */}
    <svg
      viewBox="0 0 260 90"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: '100%', height: '100%',
        filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.18))',
        overflow: 'visible'
      }}
    >
      {/* Bosses du nuage en haut */}
      <ellipse cx="65"  cy="52" rx="32" ry="24" fill="white" />
      <ellipse cx="105" cy="40" rx="38" ry="32" fill="white" />
      <ellipse cx="155" cy="36" rx="42" ry="36" fill="white" />
      <ellipse cx="200" cy="42" rx="36" ry="30" fill="white" />
      <ellipse cx="230" cy="54" rx="28" ry="22" fill="white" />
      {/* Base plate du nuage */}
      <rect x="33" y="58" width="200" height="32" fill="white" />
    </svg>
    {/* Logo centré */}
    <img
      src="/images/logo.jpg"
      alt="YouVape"
      style={{ height: `${logoHeight}px`, position: 'relative', zIndex: 1 }}
    />
  </div>
);

export default CloudLogo;
