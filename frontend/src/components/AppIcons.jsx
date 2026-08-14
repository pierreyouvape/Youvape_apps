const sw = 1.6;

const Base = ({ size = 56, color = 'currentColor', children, viewBox = '0 0 24 24' }) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    stroke={color}
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', flexShrink: 0 }}
  >
    {children}
  </svg>
);

export const Reviews = (props) => (
  <Base {...props}>
    <path d="M12 3 L4 6 V12 C4 16.5 7.5 20 12 21 C16.5 20 20 16.5 20 12 V6 Z" />
    <path d="M12 8.5 L13.2 11 L15.8 11.4 L13.9 13.2 L14.4 15.8 L12 14.5 L9.6 15.8 L10.1 13.2 L8.2 11.4 L10.8 11 Z" />
  </Base>
);

export const Rewards = (props) => (
  <Base {...props}>
    <rect x={3.5} y={8} width={17} height={12} rx={1.5} />
    <path d="M3.5 12 H20.5" />
    <path d="M12 8 V20" />
    <path d="M12 8 C9.5 8 7.5 6.5 7.5 5 C7.5 3.8 8.5 3 9.7 3 C11 3 12 4.5 12 8 Z" />
    <path d="M12 8 C14.5 8 16.5 6.5 16.5 5 C16.5 3.8 15.5 3 14.3 3 C13 3 12 4.5 12 8 Z" />
  </Base>
);

export const Emails = (props) => (
  <Base {...props}>
    <rect x={3} y={5.5} width={18} height={13} rx={1.5} />
    <path d="M3.5 7 L12 13 L20.5 7" />
    <path d="M16 17 L20 17 M18 15 L20 17 L18 19" strokeWidth={sw} />
  </Base>
);

export const Stats = (props) => (
  <Base {...props}>
    <path d="M3.5 20 H20.5" />
    <rect x={5} y={13} width={3} height={6} />
    <rect x={10.5} y={9} width={3} height={10} />
    <rect x={16} y={5} width={3} height={14} />
  </Base>
);

export const Purchases = (props) => (
  <Base {...props}>
    <path d="M3 4 H5.5 L7.5 15 H18.5 L20.5 7 H7" />
    <circle cx={9} cy={19} r={1.4} />
    <circle cx={17} cy={19} r={1.4} />
  </Base>
);

export const Packing = (props) => (
  <Base {...props}>
    <path d="M3.5 7 L12 3 L20.5 7 V17 L12 21 L3.5 17 Z" />
    <path d="M3.5 7 L12 11 L20.5 7" />
    <path d="M12 11 V21" />
    <path d="M7.7 5 L16.3 9" />
  </Base>
);

export const Catalog = (props) => (
  <Base {...props}>
    <path d="M3.5 7.5 L12 3.5 L20.5 7.5 V16.5 L12 20.5 L3.5 16.5 Z" />
    <path d="M3.5 7.5 L12 11.5 L20.5 7.5" />
    <path d="M12 11.5 V20.5" />
    <path d="M7.75 5.5 V14 L12 16" />
  </Base>
);

export const SettingsIcon = (props) => (
  <Base {...props}>
    <circle cx={12} cy={12} r={3} />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Base>
);

export const LogoutIcon = (props) => (
  <Base {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </Base>
);

export const OrdersSearch = (props) => (
  <Base {...props}>
    <rect x={3.5} y={3.5} width={17} height={17} rx={2} />
    <path d="M7 8 H17" />
    <path d="M7 12 H13" />
    <circle cx={16} cy={15.5} r={2.5} />
    <path d="M17.8 17.3 L20 19.5" />
  </Base>
);

export const GripIcon = ({ size = 24, color = 'currentColor' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth={1.4}
    style={{ display: 'block', flexShrink: 0 }}
  >
    <circle cx={9} cy={6} r={1} fill={color} />
    <circle cx={15} cy={6} r={1} fill={color} />
    <circle cx={9} cy={12} r={1} fill={color} />
    <circle cx={15} cy={12} r={1} fill={color} />
    <circle cx={9} cy={18} r={1} fill={color} />
    <circle cx={15} cy={18} r={1} fill={color} />
  </svg>
);

export const Tickets = (props) => (
  <Base {...props}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    <path d="M8 9h8M8 13h5" />
  </Base>
);

/* ─── LOGOS MARQUE (cubes isométriques) ────────────────────── */
export const Colissimo = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: 'block', flexShrink: 0 }}>
    <defs>
      <linearGradient id="col-top" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFBA4D" />
        <stop offset="100%" stopColor="#FF8800" />
      </linearGradient>
      <linearGradient id="col-left" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FF8800" />
        <stop offset="100%" stopColor="#E05000" />
      </linearGradient>
      <linearGradient id="col-right" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#CC4400" />
        <stop offset="100%" stopColor="#AA2800" />
      </linearGradient>
    </defs>
    {/* Face supérieure */}
    <polygon points="50,10 90,30 50,50 10,30" fill="url(#col-top)" />
    {/* Face gauche */}
    <polygon points="10,30 50,50 50,90 10,70" fill="url(#col-left)" />
    {/* Face droite */}
    <polygon points="90,30 90,70 50,90 50,50" fill="url(#col-right)" />
    {/* Lignes d'ouverture (séam blanc) */}
    <line x1="50" y1="50" x2="50" y2="18" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="50" y1="38" x2="15" y2="52" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="50" y1="38" x2="85" y2="52" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);

export const Chronopost = ({ size = 56 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: 'block', flexShrink: 0 }}>
    <defs>
      <linearGradient id="chr-top" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#5ECFED" />
        <stop offset="100%" stopColor="#1AABD4" />
      </linearGradient>
      <linearGradient id="chr-left" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1AABD4" />
        <stop offset="100%" stopColor="#0076A8" />
      </linearGradient>
      <linearGradient id="chr-right" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#005C8A" />
        <stop offset="100%" stopColor="#003D5C" />
      </linearGradient>
    </defs>
    {/* Face supérieure */}
    <polygon points="50,10 90,30 50,50 10,30" fill="url(#chr-top)" />
    {/* Face gauche */}
    <polygon points="10,30 50,50 50,90 10,70" fill="url(#chr-left)" />
    {/* Face droite */}
    <polygon points="90,30 90,70 50,90 50,50" fill="url(#chr-right)" />
    {/* Lignes d'ouverture (séam blanc) */}
    <line x1="50" y1="50" x2="50" y2="18" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="50" y1="38" x2="15" y2="52" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="50" y1="38" x2="85" y2="52" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);

export const LettreSuivie = ({ size = 56, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
    {/* Enveloppe */}
    <rect x="3" y="6" width="18" height="12" rx="2.4" />
    <path d="M3.6 7.2 L12 12.8 L20.4 7.2" />
    {/* Coche de suivi */}
    <path d="M14.5 16.8 l2 2 l3.6 -4.2" />
  </svg>
);

export const MondialRelay = ({ size = 56, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block', flexShrink: 0 }}>
    {/* Pin point relais (goutte) avec trou ajouré laissant voir la tuile */}
    <path fillRule="evenodd" clipRule="evenodd"
      d="M12 2.2 c-4.3 0 -7.8 3.4 -7.8 7.6 c0 5.3 7.8 12 7.8 12 s7.8 -6.7 7.8 -12 c0 -4.2 -3.5 -7.6 -7.8 -7.6 Z M12 7.1 a2.7 2.7 0 1 0 0 5.4 a2.7 2.7 0 0 0 0 -5.4 Z" />
  </svg>
);

export const Transporteurs = (props) => (
  <Base {...props}>
    <path d="M3 5.5 h10 v9 h-10 z" />
    <path d="M13 8.5 h4 l3 3 v3 h-7 z" />
    <circle cx={7} cy={17} r={1.6} />
    <circle cx={16.5} cy={17} r={1.6} />
  </Base>
);

export const Customers = (props) => (
  <Base {...props}>
    <circle cx={9} cy={8} r={3.2} />
    <path d="M3.5 19 c0 -3.3 2.5 -5.5 5.5 -5.5 s5.5 2.2 5.5 5.5" />
    <path d="M16 5.2 a3 3 0 0 1 0 5.8" />
    <path d="M16.5 13.7 c2.6 0.3 4.5 2.4 4.5 5.3" />
  </Base>
);

export const Reception = (props) => (
  <Base {...props}>
    {/* Carton ouvert */}
    <path d="M3.5 11.5 V19 a1.5 1.5 0 0 0 1.5 1.5 h14 a1.5 1.5 0 0 0 1.5 -1.5 V11.5" />
    <path d="M3.5 11.5 L6 8.5 h12 l2.5 3" />
    <path d="M9.5 11.5 h5" />
    {/* Flèche entrante */}
    <path d="M12 2.5 V6.5" />
    <path d="M10 4.8 L12 6.8 L14 4.8" />
  </Base>
);

export const Veille = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <polyline points="8 12 10.5 9.5 12.5 11.5 15 8" />
  </svg>
);

// Inscrit sans commande : silhouette + point d'interrogation (aucun achat)
export const Inscrits = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M17.5 8.5a2 2 0 1 1 2.6 1.9c-.6.2-1.1.8-1.1 1.6v.5" />
    <line x1="19" y1="15.5" x2="19" y2="15.5" />
  </svg>
);

// Actions Promos : étiquette de remise (%)
export const Promos = (props) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20.6 13.4 12.9 21a1.9 1.9 0 0 1-2.7 0l-7.2-7.2a1.9 1.9 0 0 1-.6-1.4V4.5A1.5 1.5 0 0 1 3.9 3h7.9c.5 0 1 .2 1.4.6l7.4 7.4a1.9 1.9 0 0 1 0 2.4z" />
    <circle cx="7" cy="7" r="1.2" />
    <line x1="15.5" y1="10.5" x2="10.5" y2="15.5" />
    <circle cx="10.7" cy="10.7" r="1.1" />
    <circle cx="15.3" cy="15.3" r="1.1" />
  </svg>
);


export const ChevronIcon = ({ size = 14, color = 'currentColor', open = false }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'block', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.16s' }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const APPS = [
  { key: 'customers', path: '/customers', label: 'Clients',                   Icon: Customers, color: '#0EA5A5' },
  { key: 'reviews',   path: '/reviews',   label: 'Avis Garantis',            Icon: Reviews,   color: '#0071EB' },
  { key: 'rewards',   path: '/rewards',   label: 'Récompense Avis',          Icon: Rewards,   color: '#8B5CF6' },
  { key: 'emails',    path: '/emails',    label: "Envoi d'Emails",           Icon: Emails,    color: '#22A06B' },
  { key: 'stats',     path: '/stats',     label: 'Statistiques WooCommerce', Icon: Stats,     color: '#E85A5A' },
  { key: 'purchases', path: '/purchases', label: "Gestion d'achat",          Icon: Purchases, color: '#F59E0B' },
  { key: 'purchases-v2', path: '/purchases-v2', label: "Gestion d'achat V2",  Icon: Purchases, color: '#D97706' },
  { key: 'reception', path: '/reception', label: 'Réception',                Icon: Reception, color: '#65A30D' },
  { key: 'packing',   path: '/packing',   label: 'Packing',                  Icon: Packing,   color: '#6366F1' },
  { key: 'catalog',   path: '/catalog',   label: 'Produits',                 Icon: Catalog,   color: '#059669' },
  { key: 'financier',  path: '/financier',  label: 'Rapport',                  Icon: Stats,         color: '#135E84' },
  { key: 'commandes',  path: '/commandes',  label: 'Commandes',                Icon: OrdersSearch, color: '#5B21B6' },
  { key: 'tickets',    path: '/tickets',    label: 'SAV / Tickets',            Icon: Tickets,      color: '#0891B2' },
  { key: 'chronopost', path: '/chronopost', label: 'Factures Chronopost',      Icon: Chronopost,   color: '#0D7FA8' },
  { key: 'colissimo',  path: '/colissimo',  label: 'Factures Colissimo',       Icon: Colissimo,    color: '#D96000' },
  { key: 'lettre-suivie', path: '/lettre-suivie', label: 'Factures Lettre Suivie', Icon: LettreSuivie, color: '#FFB000' },
  { key: 'mondial-relay', path: '/mondial-relay', label: 'Factures Mondial Relay', Icon: MondialRelay, color: '#9C2462' },
  { key: 'transporteurs', path: '/transporteurs', label: 'Transporteurs (vue globale)', Icon: Transporteurs, color: '#334155' },
  { key: 'veille', path: '/veille', label: 'Veille concurrentielle', Icon: Veille, color: '#135E84' },
  { key: 'inscrits', path: '/inscrits', label: 'Inscrits sans commande', Icon: Inscrits, color: '#0EA5A5' },
  { key: 'promos', path: '/promos', label: 'Actions Promos', Icon: Promos, color: '#DB2777' },
];

/* ─── PILES D'APPS (dossiers du launcher) ──────────────────
 * Regroupe plusieurs apps sous UNE tuile (accueil) et UN dossier dépliable
 * (sidebar). Les permissions restent strictement par app : une pile n'affiche
 * que les membres auxquels l'utilisateur a accès et disparaît s'il n'en a
 * aucun. Ne rien changer à APPS ni aux clés de permission : SettingsApp et
 * backend/src/config/apps.js continuent de raisonner app par app.
 * ──────────────────────────────────────────────────────── */
export const APP_GROUPS = [
  {
    key: 'grp-factures-transporteurs',
    label: 'Factures Transporteurs',
    color: '#1F4B6E',
    members: ['chronopost', 'colissimo', 'mondial-relay', 'transporteurs'],
  },
];

/**
 * Vignette d'une pile : mini-grille 2×2 des icônes des apps qu'elle contient
 * (métaphore « dossier »). `apps` = entrées APPS déjà filtrées par permission.
 */
export const PileIcon = ({ apps = [], size = 56 }) => {
  const cell = Math.round(size * 0.42);
  const gap = Math.max(2, Math.round(size * 0.07));
  return (
    <div style={{
      width: size, height: size, display: 'grid',
      gridTemplateColumns: `repeat(2, ${cell}px)`,
      gridTemplateRows: `repeat(2, ${cell}px)`,
      gap, justifyContent: 'center', alignContent: 'center', flexShrink: 0,
    }}>
      {apps.slice(0, 4).map(a => (
        <div key={a.key} style={{
          width: cell, height: cell, borderRadius: Math.max(3, Math.round(cell * 0.3)),
          background: 'rgba(255,255,255,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <a.Icon size={Math.round(cell * 0.74)} color="#fff" />
        </div>
      ))}
    </div>
  );
};
