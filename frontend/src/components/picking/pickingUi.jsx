import { visuelTransporteur } from '../../utils/carrierVisuals';
import { getCountryName } from '../../utils/countries';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

export const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export const C = {
  primary: '#135E84', violet: '#7C3AED', violetL: '#F3EEFF',
  accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  amber: '#B45309', amberL: '#FEF3C7', blue: '#1D4ED8', blueL: '#DBEAFE',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF', zebra: '#F8FAFC', rowSel: '#EEF2FF',
};

/** Tags « à corriger » : la ligne n'est ni sélectionnable ni prise par une règle. */
export const CORRECTION_TAGS = {
  transporteur_inconnu: 'Transporteur non reconnu',
  point_relais_manquant: 'Point relais manquant',
  adresse_incomplete: 'Adresse incomplète',
  commande_absente: 'Pas encore synchronisée',
};

/** Clé de regroupement d'un transporteur : 2Shop se distingue de Chronopost par son contrat. */
export const carrierKey = (carrier) => {
  if (!carrier?.carrierCode) return carrier?.status === 'unknown' ? 'inconnu' : 'sans_etiquette';
  return carrier.carrierCode === 'chronopost' && carrier.accountCode === '2shop' ? 'chronopost_2shop' : carrier.carrierCode;
};

export const carrierLabel = (carrier) => {
  const key = carrierKey(carrier);
  if (key === 'inconnu') return 'Transporteur inconnu';
  if (key === 'sans_etiquette') return 'Sans étiquette';
  return visuelTransporteur(carrier.carrierCode, carrier.accountCode).label;
};

/** Logo du transporteur ; repli sur une pastille texte s'il n'y en a pas. */
export const CarrierLogo = ({ carrier, height = 22 }) => {
  if (!carrier?.carrierCode) {
    return <span style={{ fontSize: 12, color: C.greyT }}>{carrierLabel(carrier)}</span>;
  }
  const v = visuelTransporteur(carrier.carrierCode, carrier.accountCode);
  if (!v.logo) {
    return (
      <span style={{
        padding: '2px 8px', borderRadius: 4, background: v.couleur, color: v.encre,
        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      }}>{v.court}</span>
    );
  }
  return (
    <span title={v.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <img src={v.logo} alt={v.label} style={{ height, width: 'auto', display: 'block' }} />
      {v.mention && (
        <span style={{
          padding: '1px 6px', borderRadius: 4, background: v.couleur, color: v.encre,
          fontSize: 10.5, fontWeight: 800,
        }}>{v.mention}</span>
      )}
    </span>
  );
};

/** Drapeau en image (les emojis s'affichent en lettres sous Windows). */
export const CountryFlag = ({ code, size = 18 }) => {
  if (!code) return <span style={{ color: C.greyM }}>—</span>;
  const cc = String(code).toLowerCase();
  return (
    <img
      src={`/images/flags/${cc}.svg`}
      alt={code}
      title={getCountryName(code)}
      onError={(e) => { e.currentTarget.replaceWith(document.createTextNode(String(code).toUpperCase())); }}
      style={{ height: size, width: size * 4 / 3, borderRadius: 2, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)', display: 'block' }}
    />
  );
};

export const Chip = ({ children, color, bg, title, onClick }) => (
  <span
    title={title}
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, background: bg, color,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      cursor: onClick ? 'pointer' : 'default',
    }}
  >{children}</span>
);

/** Pastille de compteur sur un onglet. */
export const CountBadge = ({ n, active }) => (
  <span style={{
    minWidth: 22, padding: '1px 7px', borderRadius: 999, fontSize: 12, fontWeight: 700,
    background: active ? C.violet : C.greyB, color: active ? C.white : C.greyT,
    textAlign: 'center',
  }}>{n}</span>
);
