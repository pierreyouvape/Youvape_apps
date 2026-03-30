/**
 * Logo posé sur un nuage blanc, pour les headers bleus.
 * Le nuage déborde légèrement en bas pour un effet "flottant".
 */
const CloudLogo = ({ logoHeight = 72 }) => {
  const cloudW = 260;
  const cloudH = 110;
  return (
    <div style={{ position: 'relative', width: `${cloudW}px`, height: `${cloudH}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Nuage SVG blanc */}
      <svg
        viewBox="0 0 260 110"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.18))'
        }}
      >
        <ellipse cx="40"  cy="85" rx="34" ry="26" fill="white" />
        <ellipse cx="78"  cy="70" rx="40" ry="34" fill="white" />
        <ellipse cx="130" cy="62" rx="46" ry="40" fill="white" />
        <ellipse cx="182" cy="70" rx="40" ry="34" fill="white" />
        <ellipse cx="220" cy="85" rx="34" ry="26" fill="white" />
        <rect x="6" y="80" width="248" height="30" fill="white" />
      </svg>
      {/* Logo centré sur le nuage */}
      <img
        src="/images/logo.jpg"
        alt="YouVape"
        style={{ height: `${logoHeight}px`, position: 'relative', zIndex: 1 }}
      />
    </div>
  );
};

export default CloudLogo;
