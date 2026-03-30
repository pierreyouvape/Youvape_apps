/**
 * Logo posé sur un nuage blanc, pour les headers bleus.
 * Le nuage déborde légèrement en bas pour un effet "flottant".
 */
const CloudLogo = ({ height = 70 }) => (
  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    {/* Nuage SVG blanc derrière le logo */}
    <svg
      viewBox="0 0 320 110"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: 'absolute',
        width: '100%',
        height: '130%',
        top: '-15%',
        left: 0,
        filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.15))'
      }}
    >
      {/* Forme nuage : plusieurs cercles fusionnés */}
      <ellipse cx="60"  cy="78" rx="42" ry="32" fill="white" />
      <ellipse cx="108" cy="64" rx="48" ry="38" fill="white" />
      <ellipse cx="160" cy="58" rx="52" ry="42" fill="white" />
      <ellipse cx="212" cy="64" rx="48" ry="38" fill="white" />
      <ellipse cx="258" cy="76" rx="42" ry="32" fill="white" />
      {/* Remplissage bas pour ne pas avoir de trous */}
      <rect x="18" y="75" width="284" height="35" fill="white" />
    </svg>
    <img
      src="/images/logo.jpg"
      alt="YouVape"
      style={{ height: `${height}px`, position: 'relative', zIndex: 1 }}
    />
  </div>
);

export default CloudLogo;
