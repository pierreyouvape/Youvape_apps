import { useState, useRef, useContext, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── DESIGN TOKENS ─────────────────────────────────────────── */
const C = {
  primary:   '#1F4E79',
  accent:    '#2E86C1',
  accentL:   '#AED6F1',
  green:     '#27AE60',
  greenL:    '#D5F5E3',
  red:       '#E74C3C',
  redL:      '#FADBD8',
  orange:    '#E67E22',
  orangeL:   '#FDEBD0',
  yellow:    '#F1C40F',
  yellowL:   '#FEF9E7',
  grey:      '#F2F6F8',
  greyB:     '#E2E8EE',
  greyT:     '#7F8C9A',
  dark:      '#2C3E50',
  white:     '#FFFFFF',
};

/* ─── UTILS ──────────────────────────────────────────────────── */
function fmtEur(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} €`;
}
function fmtKg(val) {
  if (val === null || val === undefined || val === 'N/A') return '—';
  return `${parseFloat(val).toFixed(3)} kg`;
}
function fmtDiff(g) {
  if (g === null || g === undefined || g === '?') return '—';
  const sign = g > 0 ? '+' : '';
  return `${sign}${g} g`;
}
function diffColor(g) {
  if (g === null || g === undefined) return C.greyB;
  if (Math.abs(g) <= 20)  return C.greenL;
  if (Math.abs(g) <= 200) return C.white;
  return C.redL;
}
function diffTextColor(g) {
  if (g === null || g === undefined) return C.greyT;
  if (Math.abs(g) <= 20)  return C.green;
  if (Math.abs(g) <= 200) return C.dark;
  return C.red;
}

/* ─── SUB-COMPONENTS ─────────────────────────────────────────── */
function SortTh({ label, align = 'left', sortKey, currentSort, onSort, style }) {
  const sortable = !!sortKey && !!onSort;
  const active = sortable && currentSort?.key === sortKey;
  return (
    <th
      onClick={sortable ? () => onSort(sortKey) : undefined}
      style={{
        padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.dark, fontSize: 11.5,
        borderBottom: `2px solid ${C.greyB}`, whiteSpace: 'nowrap',
        cursor: sortable ? 'pointer' : 'default', userSelect: 'none',
        ...style,
      }}
    >
      {label}{sortable && (active ? (currentSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇕')}
    </th>
  );
}

// Tri de l'historique des factures
const HISTORY_SORTERS = {
  invoice_number:     inv => inv.invoice_number || '',
  date:               inv => { const [d, m, y] = (inv.invoice_date || '').split('/'); return (y && m && d) ? `${y}${m}${d}` : ''; },
  total_parcels:      inv => inv.total_parcels ?? 0,
  parcels_matched:    inv => inv.parcels_matched ?? 0,
  weight_ok:          inv => inv.weight_ok ?? 0,
  weight_ecart:       inv => inv.weight_ecart ?? 0,
  total_ht:           inv => parseFloat(inv.total_ht ?? 0),
  supplements_total:  inv => parseFloat(inv.supplements_total ?? 0),
  tariffs_applied_at: inv => inv.tariffs_applied_at ? 1 : 0,
  created_at:         inv => new Date(inv.created_at).getTime(),
};

function sortHistory(history, sort) {
  if (!sort?.key) return history;
  const getValue = HISTORY_SORTERS[sort.key];
  return [...history].sort((a, b) => {
    const va = getValue(a), vb = getValue(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function Badge({ label, color, bg }) {
  return (
    <span style={{
      background: bg, color,
      padding: '2px 10px', borderRadius: 20,
      fontSize: 11.5, fontWeight: 700,
    }}>{label}</span>
  );
}

function StatCard({ value, label, color }) {
  return (
    <div style={{
      background: C.white, borderRadius: 10,
      border: `1px solid ${C.greyB}`,
      padding: '16px 20px', textAlign: 'center', flex: 1,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.primary }}>{value}</div>
      <div style={{ fontSize: 12, color: C.greyT, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function TabBtn({ label, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 20px', border: 'none', cursor: 'pointer',
      fontWeight: active ? 700 : 500, fontSize: 13.5,
      color: active ? C.accent : C.greyT,
      borderBottom: active ? `2.5px solid ${C.accent}` : '2.5px solid transparent',
      background: 'transparent',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {label}
      {badge != null && (
        <span style={{
          background: active ? C.accent : C.greyB,
          color: active ? C.white : C.greyT,
          borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700,
        }}>{badge}</span>
      )}
    </button>
  );
}

const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', NL: 'Pays-Bas', DE: 'Allemagne', IT: 'Italie',
  ES: 'Espagne', PT: 'Portugal', LU: 'Luxembourg', AT: 'Autriche', DK: 'Danemark', SE: 'Suède',
  FI: 'Finlande', NO: 'Norvège', IE: 'Irlande', GB: 'Royaume-Uni', PL: 'Pologne', CZ: 'Tchéquie',
  SK: 'Slovaquie', HU: 'Hongrie', RO: 'Roumanie', BG: 'Bulgarie', GR: 'Grèce', HR: 'Croatie',
  SI: 'Slovénie', LT: 'Lituanie', LV: 'Lettonie', EE: 'Estonie', CY: 'Chypre', MT: 'Malte',
  MC: 'Monaco', AD: 'Andorre', LI: 'Liechtenstein', SM: 'Saint-Marin',
  RE: 'Réunion', MQ: 'Martinique', GP: 'Guadeloupe', GF: 'Guyane', YT: 'Mayotte',
  PF: 'Polynésie fr.', NC: 'Nouvelle-Calédonie', PM: 'St-Pierre-et-M.', BL: 'St-Barthélemy', MF: 'St-Martin',
  CA: 'Canada', US: 'États-Unis', AU: 'Australie', ZA: 'Afrique du Sud', MA: 'Maroc',
  TN: 'Tunisie', DZ: 'Algérie', SA: 'Arabie S.', AE: 'Émirats', JP: 'Japon', CN: 'Chine', BZ: 'Belize',
  '—': 'Non identifié',
};
const countryName = code => COUNTRY_NAMES[code] || code;
const fmtColis = n => (n || 0).toLocaleString('en-US').replace(/,/g, ' ');

/* ─── GRILLES TARIFAIRES CONTRATS 2025 ──────────────────────────────────────
   Règle Chronopost : poids à la limite inférieure de tranche → tranche inférieure.
   Ex: 1.000 kg exact → tranche 0-1 kg (non 1-2 kg).
   Source : contrat My Chrono 34751303 (eff. 01/10/2025) + 2Shop 84284503 (eff. 01/04/2025)
   Format : [weight_from_kg, weight_to_kg_excluded, price_ht]
   DEP = NAT = REG = même prix pour tous les services France.
   ─────────────────────────────────────────────────────────────────────────── */
const TARIF_CHRONO_13 = [
  [0,1,6.99],[1,2,7.41],[2,3,7.83],[3,4,8.25],[4,5,8.67],
  [5,6,9.09],[6,7,9.51],[7,8,9.93],[8,9,10.35],[9,10,10.77],
  [10,11,11.36],[11,12,11.95],[12,13,12.54],[13,14,13.13],[14,15,13.72],
  [15,16,14.31],[16,17,14.90],[17,18,15.49],[18,19,16.08],[19,20,16.67],
  [20,21,17.26],[21,22,17.85],[22,23,18.44],[23,24,19.03],[24,25,19.62],
  [25,26,20.21],[26,27,20.80],[27,28,21.39],[28,29,21.98],[29,30,22.57],
];
const TARIF_RELAIS_13 = [
  [0,1,4.29],[1,2,4.55],[2,3,4.81],[3,4,5.14],[4,5,5.47],
  [5,6,5.87],[6,7,6.27],[7,8,6.67],[8,9,7.07],[9,10,7.47],
  [10,11,8.06],[11,12,8.65],[12,13,9.24],[13,14,9.83],[14,15,10.42],
  [15,16,11.01],[16,17,11.60],[17,18,12.19],[18,19,12.78],[19,20,13.37],
];
const TARIF_2SHOP_DIRECT = [
  [0,0.5,3.06],[0.5,1,3.56],[1,2,4.15],[2,3,4.74],[3,4,5.59],
  [4,5,6.44],[5,6,7.29],[6,7,8.14],[7,8,8.99],[8,9,9.84],
  [9,10,10.69],[10,11,11.54],[11,12,12.39],[12,13,13.24],[13,14,14.09],
  [14,15,14.94],[15,16,15.79],[16,17,16.64],[17,18,17.49],[18,19,18.34],
  [19,20,19.19],
];
// Chrono Express (XF...FR) — Z1–Z9 — tranches de 0.5 kg jusqu'à 30 kg
const XF_ZONES = ['Z1','Z2','Z3','Z4','Z5','Z6','Z7','Z8','Z9'];
const TARIF_XF = [
  // Z1
  [8.47,9.37,10.83,11.92,13.01,14.10,15.19,16.28,17.37,18.46,19.55,20.64,21.73,22.82,23.91,25.00,26.09,27.18,28.27,29.36,30.60,31.84,33.08,34.32,35.56,36.80,38.04,39.28,40.52,41.76,43.00,44.24,45.48,46.72,47.96,49.20,50.44,51.68,52.92,54.16,55.69,57.22,58.75,60.28,61.81,63.34,64.87,66.40,67.93,69.46,70.99,72.52,74.05,75.58,77.11,78.64,80.17,81.70,83.23,84.76],
  // Z2
  [8.47,10.44,11.90,12.99,14.08,15.17,16.26,17.35,18.44,19.53,20.62,21.71,22.80,23.89,24.98,26.07,27.16,28.25,29.34,30.43,31.67,32.91,34.15,35.39,36.63,37.87,39.11,40.35,41.59,42.83,44.07,45.31,46.55,47.79,49.03,50.27,51.51,52.75,53.99,55.23,56.76,58.29,59.82,61.35,62.88,64.41,65.94,67.47,69.00,70.53,72.06,73.59,75.12,76.65,78.18,79.71,81.24,82.77,84.30,85.83],
  // Z3
  [10.07,12.62,14.66,16.27,17.88,19.49,21.10,22.71,24.32,25.93,27.61,29.29,30.97,32.65,34.33,36.01,37.69,39.37,41.05,42.73,44.77,46.81,48.85,50.89,52.93,54.97,57.01,59.05,61.09,63.13,65.17,67.21,69.25,71.29,73.33,75.37,77.41,79.45,81.49,83.53,85.72,87.91,90.10,92.29,94.48,96.67,98.86,101.05,103.24,105.43,107.62,109.81,112.00,114.19,116.38,118.57,120.76,122.95,125.14,127.33],
  // Z4
  [18.10,21.17,23.58,25.55,27.52,29.49,31.46,33.43,35.40,37.37,39.41,41.45,43.49,45.53,47.57,49.61,51.65,53.69,55.73,57.77,60.25,62.73,65.21,67.69,70.17,72.65,75.13,77.61,80.09,82.57,85.05,87.53,90.01,92.49,94.97,97.45,99.93,102.41,104.89,107.37,110.07,112.77,115.47,118.17,120.87,123.57,126.27,128.97,131.67,134.37,137.07,139.77,142.47,145.17,147.87,150.57,153.27,155.97,158.67,161.37],
  // Z5
  [19.81,23.02,25.57,27.61,29.65,31.69,33.73,35.77,37.81,39.85,42.04,44.23,46.42,48.61,50.80,52.99,55.18,57.37,59.56,61.75,64.38,67.01,69.64,72.27,74.90,77.53,80.16,82.79,85.42,88.05,90.68,93.31,95.94,98.57,101.20,103.83,106.46,109.09,111.72,114.35,117.20,120.05,122.90,125.75,128.60,131.45,134.30,137.15,140.00,142.85,145.70,148.55,151.40,154.25,157.10,159.95,162.80,165.65,168.50,171.35],
  // Z6
  [24.59,29.12,32.77,35.69,38.61,41.53,44.45,47.37,50.29,53.21,56.13,59.05,61.97,64.89,67.81,70.73,73.65,76.57,79.49,82.41,85.91,89.41,92.91,96.41,99.91,103.41,106.91,110.41,113.91,117.41,120.91,124.41,127.91,131.41,134.91,138.41,141.91,145.41,148.91,152.41,156.28,160.15,164.02,167.89,171.76,175.63,179.50,183.37,187.24,191.11,194.98,198.85,202.72,206.59,210.46,214.33,218.20,222.07,225.94,229.81],
  // Z7
  [26.11,31.66,36.11,39.69,43.27,46.85,50.43,54.01,57.59,61.17,64.75,68.33,71.91,75.49,79.07,82.65,86.23,89.81,93.39,96.97,100.91,104.85,108.79,112.73,116.67,120.61,124.55,128.49,132.43,136.37,140.31,144.25,148.19,152.13,156.07,160.01,163.95,167.89,171.83,175.77,180.08,184.39,188.70,193.01,197.32,201.63,205.94,210.25,214.56,218.87,223.18,227.49,231.80,236.11,240.42,244.73,249.04,253.35,257.66,261.97],
  // Z8
  [23.22,26.72,29.42,31.61,33.80,35.99,38.18,40.37,42.56,44.75,46.94,49.13,51.32,53.51,55.70,57.89,60.08,62.27,64.46,66.65,69.20,71.75,74.30,76.85,79.40,81.95,84.50,87.05,89.60,92.15,94.70,97.25,99.80,102.35,104.90,107.45,110.00,112.55,115.10,117.65,120.42,123.19,125.96,128.73,131.50,134.27,137.04,139.81,142.58,145.35,148.12,150.89,153.66,156.43,159.20,161.97,164.74,167.51,170.28,173.05],
  // Z9
  [30.04,36.10,40.55,44.13,47.71,51.29,54.87,58.45,62.03,65.61,69.19,72.77,76.35,79.93,83.51,87.09,90.67,94.25,97.83,101.41,105.35,109.29,113.23,117.17,121.11,125.05,128.99,132.93,136.87,140.81,144.75,148.69,152.63,156.57,160.51,164.45,168.39,172.33,176.27,180.21,184.52,188.83,193.14,197.45,201.76,206.07,210.38,214.69,219.00,223.31,227.62,231.93,236.24,240.55,244.86,249.17,253.48,257.79,262.10,266.41],
];
// Retourne l'index de tranche XF (0.5 kg/tranche) — limite haute incluse (ex: 0.500 kg → tranche 0)
function xfBracketIdx(weightKg) {
  if (weightKg == null || weightKg < 0) return -1;
  return Math.max(0, Math.ceil(weightKg / 0.5) - 1);
}
// Retrouve la zone Z1-Z9 d'un colis XF depuis le montant facturé + poids Chrono
function getXfZone(amountHt, weightChrono) {
  const idx = xfBracketIdx(weightChrono);
  if (idx < 0 || idx >= 60) return -1;
  for (let z = 0; z < 9; z++) {
    if (Math.abs(TARIF_XF[z][idx] - amountHt) < 0.02) return z;
  }
  return -1;
}

// 2Shop Europe (XT...TS) — par pays — tranches mixtes : 0–0.5, 0.5–1, puis 1 kg jusqu'à 20 kg
const XT_COUNTRIES = ['AT','BE','BG','CH','CZ','DE','DK','EE','ES','FI','HR','HU','IE','IT','LT','LU','LV','NL','PL','PT','RO','SE','SI','SK'];
const TARIF_XT = [
  // AT
  [8.57,8.79,9.12,11.61,12.27,12.93,13.59,14.25,14.91,15.57,16.23,16.89,17.55,18.21,18.87,19.53,20.19,20.85,21.51,22.17,22.83],
  // BE
  [3.39,3.50,3.83,6.43,7.09,7.75,8.41,9.07,9.73,10.39,11.05,11.71,12.37,13.03,13.69,14.35,15.01,15.67,16.33,16.99,17.65],
  // BG
  [11.85,12.07,12.40,14.89,15.55,16.21,16.87,17.53,18.19,18.85,19.51,20.17,20.83,21.49,22.15,22.81,23.47,24.13,24.79,25.45,26.11],
  // CH
  [28.67,28.89,29.22,31.71,32.37,33.03,33.69,34.35,35.01,35.67,36.33,36.99,37.65,38.31,38.97,39.63,40.29,40.95,41.61,42.27,42.93],
  // CZ
  [7.51,7.73,8.06,10.55,11.21,11.87,12.53,13.19,13.85,14.51,15.17,15.83,16.49,17.15,17.81,18.47,19.13,19.79,20.45,21.11,21.77],
  // DE
  [4.43,4.65,4.98,7.47,8.13,8.79,9.45,10.11,10.77,11.43,12.09,12.75,13.41,14.07,14.73,15.39,16.05,16.71,17.37,18.03,18.69],
  // DK
  [8.57,8.79,9.12,11.61,12.27,12.93,13.59,14.25,14.91,15.57,16.23,16.89,17.55,18.21,18.87,19.53,20.19,20.85,21.51,22.17,22.83],
  // EE
  [11.85,12.07,12.40,14.89,15.55,16.21,16.87,17.53,18.19,18.85,19.51,20.17,20.83,21.49,22.15,22.81,23.47,24.13,24.79,25.45,26.11],
  // ES
  [5.50,5.72,6.05,8.54,9.20,9.86,10.52,11.18,11.84,12.50,13.16,13.82,14.48,15.14,15.80,16.46,17.12,17.78,18.44,19.10,19.76],
  // FI
  [11.85,12.07,12.40,14.89,15.55,16.21,16.87,17.53,18.19,18.85,19.51,20.17,20.83,21.49,22.15,22.81,23.47,24.13,24.79,25.45,26.11],
  // HR
  [11.85,12.07,12.40,14.89,15.55,16.21,16.87,17.53,18.19,18.85,19.51,20.17,20.83,21.49,22.15,22.81,23.47,24.13,24.79,25.45,26.11],
  // HU
  [7.51,7.73,8.06,10.55,11.21,11.87,12.53,13.19,13.85,14.51,15.17,15.83,16.49,17.15,17.81,18.47,19.13,19.79,20.45,21.11,21.77],
  // IE — prix différents à partir de 10 kg
  [8.57,8.79,9.12,11.61,12.27,12.93,13.59,14.25,14.91,15.57,16.23,20.69,21.35,22.01,22.67,23.33,23.99,24.65,25.31,25.97,26.63],
  // IT
  [5.50,5.72,6.05,8.54,9.20,9.86,10.52,11.18,11.84,12.50,13.16,13.82,14.48,15.14,15.80,16.46,17.12,17.78,18.44,19.10,19.76],
  // LT
  [9.42,9.64,9.97,12.46,13.12,13.78,14.44,15.10,15.76,16.42,17.08,17.74,18.40,19.06,19.72,20.38,21.04,21.70,22.36,23.02,23.68],
  // LU
  [4.43,4.65,4.98,7.47,8.13,8.79,9.45,10.11,10.77,11.43,12.09,12.75,13.41,14.07,14.73,15.39,16.05,16.71,17.37,18.03,18.69],
  // LV
  [11.85,12.07,12.40,14.89,15.55,16.21,16.87,17.53,18.19,18.85,19.51,20.17,20.83,21.49,22.15,22.81,23.47,24.13,24.79,25.45,26.11],
  // NL
  [4.43,4.65,4.98,7.47,8.13,8.79,9.45,10.11,10.77,11.43,12.09,12.75,13.41,14.07,14.73,15.39,16.05,16.71,17.37,18.03,18.69],
  // PL
  [7.51,7.73,8.06,10.55,11.21,11.87,12.53,13.19,13.85,14.51,15.17,15.83,16.49,17.15,17.81,18.47,19.13,19.79,20.45,21.11,21.77],
  // PT
  [5.50,5.72,6.05,8.54,9.20,9.86,10.52,11.18,11.84,12.50,13.16,13.82,14.48,15.14,15.80,16.46,17.12,17.78,18.44,19.10,19.76],
  // RO
  [11.85,12.90,13.95,15.00,16.05,17.10,18.15,19.20,20.25,21.30,22.35,23.40,24.45,25.50,26.55,27.60,28.65,29.70,30.75,31.80,32.85],
  // SE
  [9.42,9.64,9.97,12.46,13.12,13.78,14.44,15.10,15.76,16.42,17.08,17.74,18.40,19.06,19.72,20.38,21.04,21.70,22.36,23.02,23.68],
  // SI
  [8.57,8.79,9.12,11.61,12.27,12.93,13.59,14.25,14.91,15.57,16.23,16.89,17.55,18.21,18.87,19.53,20.19,20.85,21.51,22.17,22.83],
  // SK
  [8.57,8.79,9.12,11.61,12.27,12.93,13.59,14.25,14.91,15.57,16.23,16.89,17.55,18.21,18.87,19.53,20.19,20.85,21.51,22.17,22.83],
];
// Retourne l'index de tranche XT (tranches mixtes 0.5/1 kg) — limite haute incluse (ex: 0.500 kg → tranche 0)
function xtBracketIdx(weightKg) {
  if (weightKg == null || weightKg < 0) return -1;
  const bounds = [0,0.5,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
  for (let i = 1; i < bounds.length; i++) {
    if (weightKg <= bounds[i]) return i - 1;
  }
  return bounds.length - 2;
}
// Retrouve le pays d'un colis XT depuis le montant facturé + poids Chrono
function getXtCountryIdx(amountHt, weightChrono) {
  const idx = xtBracketIdx(weightChrono);
  if (idx < 0 || idx >= 21) return -1;
  for (let c = 0; c < TARIF_XT.length; c++) {
    if (Math.abs(TARIF_XT[c][idx] - amountHt) < 0.02) return c;
  }
  return -1;
}

// Préfixe (2 cars) + suffixe (2 cars) → service + grille
const TRACKING_SERVICES = {
  XS_FR: { name: 'Chrono Relais 13', tarif: TARIF_RELAIS_13 },
  XA_FR: { name: 'Chrono 13',        tarif: TARIF_CHRONO_13 },
  XN_FR: { name: 'Chrono 13',        tarif: TARIF_CHRONO_13 },
  XR_TS: { name: '2Shop Direct',     tarif: TARIF_2SHOP_DIRECT },
  XY_TS: { name: '2Shop Direct',     tarif: TARIF_2SHOP_DIRECT },
};
function getTrackingService(tracking) {
  if (!tracking || tracking.length < 4) return null;
  const key = `${tracking.slice(0,2)}_${tracking.slice(-2)}`.toUpperCase();
  return TRACKING_SERVICES[key] || null;
}
function lookupContractPrice(tarif, weightKg) {
  if (weightKg == null || !tarif) return null;
  for (const [from, to, price] of tarif) {
    if (weightKg >= from && weightKg < to) return price;
  }
  return null;
}
function isXfTracking(tracking) {
  return !!tracking && tracking.slice(0,2).toUpperCase() === 'XF' && tracking.slice(-2).toUpperCase() === 'FR';
}
function isXtTracking(tracking) {
  return !!tracking && tracking.slice(0,2).toUpperCase() === 'XT' && tracking.slice(-2).toUpperCase() === 'TS';
}
// Retourne true si le pays/zone du colis est identifiable (tarif calculable)
function hasKnownTariff(order) {
  if (getTrackingService(order.tracking)) return true;
  if (order.amount_ht != null) {
    if (isXfTracking(order.tracking)) return getXfZone(order.amount_ht, order.weight_chrono) >= 0;
    if (isXtTracking(order.tracking)) return getXtCountryIdx(order.amount_ht, order.weight_chrono) >= 0;
  }
  return false;
}
function computePriceEcart(order) {
  if (order.is_return || order.weight_bdd == null || order.weight_chrono == null) return null;
  const svc = getTrackingService(order.tracking);
  if (svc) {
    const priceDu  = lookupContractPrice(svc.tarif, order.weight_bdd);
    const priceFac = lookupContractPrice(svc.tarif, order.weight_chrono);
    if (priceDu == null || priceFac == null || priceDu === priceFac) return null;
    return { service: svc.name, priceDu, priceFac, ecart: +(priceFac - priceDu).toFixed(2) };
  }
  if (order.amount_ht == null) return null;
  // Chrono Express (XF...FR) — reverse-lookup zone depuis amount_ht
  if (isXfTracking(order.tracking)) {
    const zoneIdx   = getXfZone(order.amount_ht, order.weight_chrono);
    if (zoneIdx < 0) return null;
    const idxBdd    = xfBracketIdx(order.weight_bdd);
    const idxChrono = xfBracketIdx(order.weight_chrono);
    if (idxBdd < 0 || idxChrono < 0 || idxBdd === idxChrono) return null;
    if (idxBdd >= TARIF_XF[zoneIdx].length || idxChrono >= TARIF_XF[zoneIdx].length) return null;
    const priceDu  = TARIF_XF[zoneIdx][idxBdd];
    const priceFac = TARIF_XF[zoneIdx][idxChrono];
    if (priceDu >= priceFac) return null;
    return { service: `Chrono Express ${XF_ZONES[zoneIdx]}`, priceDu, priceFac, ecart: +(priceFac - priceDu).toFixed(2) };
  }
  // 2Shop Europe (XT...TS) — reverse-lookup pays depuis amount_ht
  if (isXtTracking(order.tracking)) {
    const countryIdx = getXtCountryIdx(order.amount_ht, order.weight_chrono);
    if (countryIdx < 0) return null;
    const idxBdd    = xtBracketIdx(order.weight_bdd);
    const idxChrono = xtBracketIdx(order.weight_chrono);
    if (idxBdd < 0 || idxChrono < 0 || idxBdd === idxChrono) return null;
    if (idxBdd >= TARIF_XT[countryIdx].length || idxChrono >= TARIF_XT[countryIdx].length) return null;
    const priceDu  = TARIF_XT[countryIdx][idxBdd];
    const priceFac = TARIF_XT[countryIdx][idxChrono];
    if (priceDu >= priceFac) return null;
    return { service: `2Shop Europe (${XT_COUNTRIES[countryIdx]})`, priceDu, priceFac, ecart: +(priceFac - priceDu).toFixed(2) };
  }
  return null;
}

function TotalsView({ totals, totalsLoading, loadTotals, totalsByPeriod }) {
  const { months, years, byPaysYear, yearCols, monthCols, byPaysMonth } = totalsByPeriod;
  const thRight = { padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` };
  const thLeft = { ...thRight, textAlign: 'left' };
  const tdL = { padding: '8px 12px', borderBottom: `1px solid ${C.greyB}` };
  const tdR = { ...tdL, textAlign: 'right' };
  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>
          Total payé à Chronopost (colis + suppléments + charges globales − avoirs HT), par mois et par année.
        </p>
        <button onClick={loadTotals} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>
          ↻ Actualiser
        </button>
      </div>

      {totalsLoading ? (
        <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
      ) : !totals || (months.length === 0 && years.length === 0) ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
          Aucune donnée disponible. Enregistrez des factures pour voir les totaux.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Évolution mensuelle</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={[...months].reverse()} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                <Tooltip formatter={v => fmtEur(v)} />
                <Line type="monotone" dataKey="total" name="Total payé HT" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.grey }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Mois</th>
                  <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Colis</th>
                  <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Total payé HT</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={m.key} style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}` }}>
                    <td style={{ padding: '8px 12px' }}>{m.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.greyT }}>{fmtColis(m.colis)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtEur(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par année</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.grey }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Année</th>
                  <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Total payé HT</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y, i) => (
                  <tr key={y.key} style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}` }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>{y.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: C.primary }}>{fmtEur(y.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>

          {byPaysYear && byPaysYear.length > 0 && yearCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Par pays et par année (HT)</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Coût des colis HT par pays de destination (colonne Zone des factures).</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: C.grey }}>
                    <th style={thLeft}>Pays</th>
                    <th style={thRight}>Colis</th>
                    {yearCols.map(y => <th key={y} style={thRight}>{y}</th>)}
                    <th style={thRight}>Total HT</th>
                  </tr></thead>
                  <tbody>{byPaysYear.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <td style={{ ...tdL, fontWeight: 700 }}>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></td>
                      <td style={{ ...tdR, color: C.greyT }}>{fmtColis(r.totalColis)}</td>
                      {yearCols.map(y => <td key={y} style={tdR}>{r.ym[y] ? fmtEur(r.ym[y].ht) : '—'}</td>)}
                      <td style={{ ...tdR, fontWeight: 700, color: C.primary }}>{fmtEur(r.total)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                    <td style={{ ...tdL, fontWeight: 700 }}>Total</td>
                    <td style={{ ...tdR, fontWeight: 700 }}>{fmtColis(byPaysYear.reduce((s, r) => s + r.totalColis, 0))}</td>
                    {yearCols.map(y => <td key={y} style={{ ...tdR, fontWeight: 700 }}>{fmtEur(byPaysYear.reduce((s, r) => s + (r.ym[y]?.ht || 0), 0))}</td>)}
                    <td style={{ ...tdR, fontWeight: 800, color: C.primary }}>{fmtEur(byPaysYear.reduce((s, r) => s + r.total, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          {byPaysMonth && byPaysMonth.length > 0 && monthCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Nombre de colis par pays et par mois</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Nombre de colis par pays de destination, mois par mois.</p>
              <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
                  <thead><tr style={{ background: C.grey }}>
                    <th style={{ ...thLeft, background: C.grey, position: 'sticky', left: 0, zIndex: 2, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>Pays</th>{monthCols.map(mc => <th key={mc.key} style={thRight}>{mc.label}</th>)}<th style={thRight}>Total</th>
                  </tr></thead>
                  <tbody>{byPaysMonth.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <td style={{ ...tdL, fontWeight: 700, background: i % 2 === 0 ? C.white : C.grey, position: 'sticky', left: 0, zIndex: 1, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></td>
                      {monthCols.map(mc => <td key={mc.key} style={tdR}>{r.bm[mc.key] ? fmtColis(r.bm[mc.key]) : '—'}</td>)}
                      <td style={{ ...tdR, fontWeight: 700, color: C.primary }}>{fmtColis(r.total)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                    <td style={{ ...tdL, fontWeight: 700, background: C.white, position: 'sticky', left: 0, zIndex: 1, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>Total</td>
                    {monthCols.map(mc => <td key={mc.key} style={{ ...tdR, fontWeight: 700 }}>{fmtColis(byPaysMonth.reduce((s, r) => s + (r.bm[mc.key] || 0), 0))}</td>)}
                    <td style={{ ...tdR, fontWeight: 800, color: C.primary }}>{fmtColis(byPaysMonth.reduce((s, r) => s + r.total, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          {byPaysYear && byPaysYear.length > 0 && yearCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Nombre de colis par pays et par année</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Nombre de colis par pays de destination, année par année.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ background: C.grey }}>
                    <th style={thLeft}>Pays</th>{yearCols.map(y => <th key={y} style={thRight}>{y}</th>)}<th style={thRight}>Total</th>
                  </tr></thead>
                  <tbody>{byPaysYear.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <td style={{ ...tdL, fontWeight: 700 }}>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></td>
                      {yearCols.map(y => <td key={y} style={tdR}>{r.ym[y] ? fmtColis(r.ym[y].colis) : '—'}</td>)}
                      <td style={{ ...tdR, fontWeight: 700, color: C.primary }}>{fmtColis(r.totalColis)}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                    <td style={{ ...tdL, fontWeight: 700 }}>Total</td>
                    {yearCols.map(y => <td key={y} style={{ ...tdR, fontWeight: 700 }}>{fmtColis(byPaysYear.reduce((s, r) => s + (r.ym[y]?.colis || 0), 0))}</td>)}
                    <td style={{ ...tdR, fontWeight: 800, color: C.primary }}>{fmtColis(byPaysYear.reduce((s, r) => s + r.totalColis, 0))}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── TARIF HELPERS (réutilisés pour factures et avoirs) ──────── */
// Formule : (base + redevance_unit) × (1 + carburant_rate) + eco_unit + frais_gestion / nb_sûreté
function computeTarifParams(orders, globalCharges) {
  let redevanceUnit = 0, nbSûreté = orders.length || 1;
  let ecoUnit = 0, carburantRate = 0, fraisGestionTotal = 0;

  for (const g of (globalCharges || [])) {
    const desc = g.description || '';
    const detail = g.detail || '';
    if (/redevance/i.test(desc)) {
      // Le détail "N colis × X EUR" donne le nb de colis ; le signe (avoir = négatif)
      // doit suivre le montant total (amount_ht), pas le tarif unitaire (toujours positif dans le texte)
      const m = detail.match(/(\d+)\s*colis/);
      if (m) { nbSûreté = parseInt(m[1]); redevanceUnit = (g.amount_ht || 0) / nbSûreté; }
      else redevanceUnit = (g.amount_ht || 0) / (orders.length || 1);
    } else if (/eco/i.test(desc)) {
      const m = detail.match(/(\d+)\s*colis/);
      if (m) {
        const n = parseInt(m[1]);
        ecoUnit = (g.amount_ht || 0) / n;
        if (redevanceUnit === 0) nbSûreté = n;
      } else {
        ecoUnit = (g.amount_ht || 0) / (orders.length || 1);
      }
    } else if (/carburant/i.test(desc)) {
      const m = detail.match(/([\d.]+)\s*%/);
      if (m) carburantRate = parseFloat(m[1]) / 100;
    } else if (/frais de gestion/i.test(desc)) {
      fraisGestionTotal = g.amount_ht || 0;
    }
  }
  return { redevanceUnit, nbSûreté, ecoUnit, carburantRate, fraisGestionTotal };
}

// Suppléments plats (hors base carburant) : pénalités administratives
const FLAT_SUPPL_RE = /réacheminement|[eé]tiquette\s+non\s+conforme/i;

function computeSupplMaps(supplements) {
  const supplByTracking = {};      // total pour affichage tooltip
  const supplBaseByTracking = {};  // dans la base carburant (retour, zone, manutention…)
  const supplFlatByTracking = {};  // hors base carburant (réacheminement)

  for (const s of (supplements || [])) {
    const key = s.related_tracking || s.tracking;
    if (!key) continue;
    const amt = s.amount_ht || 0;
    const label = s.description || s.label || '';
    supplByTracking[key] = (supplByTracking[key] || 0) + amt;
    if (FLAT_SUPPL_RE.test(label)) {
      supplFlatByTracking[key] = (supplFlatByTracking[key] || 0) + amt;
    } else {
      supplBaseByTracking[key] = (supplBaseByTracking[key] || 0) + amt;
    }
  }
  return { supplByTracking, supplBaseByTracking, supplFlatByTracking };
}

function computeTarif(order, params, supplBaseByTracking, supplFlatByTracking) {
  if (order.amount_ht == null) return null;
  const base      = order.amount_ht;
  const supplBase = supplBaseByTracking[order.tracking] || 0; // soumis carburant
  const supplFlat = supplFlatByTracking[order.tracking] || 0; // hors carburant
  const { redevanceUnit, ecoUnit, carburantRate, fraisGestionTotal, nbSûreté } = params;

  if (order.is_return) {
    return (base + supplBase) * (1 + carburantRate) + supplFlat;
  }
  return (base + supplBase + redevanceUnit) * (1 + carburantRate) + ecoUnit + (fraisGestionTotal / nbSûreté) + supplFlat;
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────── */
export default function ChronopostApp() {
  const { token } = useContext(AuthContext);
  const fileRef = useRef(null);
  const zipRef = useRef(null);
  const [importingZip, setImportingZip] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null); // null | 'saved' | 'already'
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('poids');
  const [searchOrder, setSearchOrder] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // all | ok | ecart | return
  const [currentFile, setCurrentFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySort, setHistorySort] = useState(null); // { key, dir: 'asc' | 'desc' }
  const [tooltip, setTooltip] = useState(null); // {text, x, y}
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0); // 0-100
  const [applyResult, setApplyResult] = useState(null); // {updated, skipped}
  const [currentInvoiceId, setCurrentInvoiceId] = useState(null);
  const [tariffsAppliedAt, setTariffsAppliedAt] = useState(null);

  // ── Recherche globale d'une commande (toutes factures)
  const [globalSearch, setGlobalSearch] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState(null);
  const [globalSearchResults, setGlobalSearchResults] = useState(null);

  // ── Totaux payés par mois / par année
  const [totals, setTotals] = useState(null);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [homeTab, setHomeTab] = useState('historique'); // historique | totaux

  const [emailCopied, setEmailCopied] = useState(false);

  // ── Avoirs (credit notes)
  const creditFileRef = useRef(null);
  const [creditDragging, setCreditDragging] = useState(false);
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditSaveState, setCreditSaveState] = useState(null); // null | 'saved' | 'already'
  const [creditError, setCreditError] = useState(null);
  const [creditResult, setCreditResult] = useState(null);
  const [creditFile, setCreditFile] = useState(null);
  const [creditsHistory, setCreditsHistory] = useState([]);
  const [creditsHistoryLoading, setCreditsHistoryLoading] = useState(false);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) setHistory(data.invoices);
    } catch { /* silently fail */ }
    finally { setHistoryLoading(false); }
  }

  async function loadCreditsHistory() {
    setCreditsHistoryLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/credits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) setCreditsHistory(data.credits);
    } catch { /* silently fail */ }
    finally { setCreditsHistoryLoading(false); }
  }

  async function loadTotals() {
    setTotalsLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/totals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) setTotals(data);
    } catch { /* silently fail */ }
    finally { setTotalsLoading(false); }
  }

  useEffect(() => { loadHistory(); loadCreditsHistory(); loadTotals(); }, []);

  function toggleHistorySort(key) {
    setHistorySort(prev => prev?.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' });
  }

  const sortedHistory = useMemo(() => sortHistory(history, historySort), [history, historySort]);

  const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  const totalsByPeriod = (() => {
    const monthMap = {};       // monthKey -> { ht, colis }
    const yearMap = {};
    const paysYearMap = {};    // code -> year -> { ht, colis }
    const paysMonthMap = {};   // monthKey -> code -> { ht, colis }
    const yearsSet = new Set();
    const mAdd = (k, ht, colis) => { if (!monthMap[k]) monthMap[k] = { ht: 0, colis: 0 }; monthMap[k].ht += ht; monthMap[k].colis += colis; };
    for (const inv of (totals?.invoices || [])) {
      const parts = (inv.invoice_date || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      // total_ht inclut déjà les suppléments ; global_total (charges globales) s'ajoute en plus
      const total = parseFloat(inv.total_ht || 0) + parseFloat(inv.global_total || 0);
      mAdd(monthKey, total, parseInt(inv.total_parcels || 0, 10));
      yearMap[y] = (yearMap[y] || 0) + total;
      yearsSet.add(y);
      const ct = inv.country_totals || {};
      for (const [code, v] of Object.entries(ct)) {
        const ht = parseFloat(v?.ht || 0), colis = parseInt(v?.colis || 0, 10);
        if (!paysYearMap[code]) paysYearMap[code] = {};
        if (!paysYearMap[code][y]) paysYearMap[code][y] = { ht: 0, colis: 0 };
        paysYearMap[code][y].ht += ht; paysYearMap[code][y].colis += colis;
        if (!paysMonthMap[monthKey]) paysMonthMap[monthKey] = {};
        if (!paysMonthMap[monthKey][code]) paysMonthMap[monthKey][code] = { ht: 0, colis: 0 };
        paysMonthMap[monthKey][code].ht += ht; paysMonthMap[monthKey][code].colis += colis;
      }
    }
    for (const c of (totals?.credits || [])) {
      const parts = (c.credit_date || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      const amt = parseFloat(c.amount_ht || 0);
      mAdd(monthKey, amt, 0);
      yearMap[y] = (yearMap[y] || 0) + amt;
    }
    const months = Object.entries(monthMap)
      .map(([key, v]) => { const [y, m] = key.split('-'); return { key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`, total: v.ht, colis: v.colis }; })
      .sort((a, b) => b.key.localeCompare(a.key));
    const years = Object.entries(yearMap)
      .map(([y, total]) => ({ key: y, label: y, total }))
      .sort((a, b) => b.key.localeCompare(a.key));
    const yearCols = [...yearsSet].sort();
    const byPaysYear = Object.entries(paysYearMap)
      .map(([code, ym]) => ({
        code, ym,
        total: Object.values(ym).reduce((s, x) => s + x.ht, 0),
        totalColis: Object.values(ym).reduce((s, x) => s + x.colis, 0),
      }))
      .sort((a, b) => b.total - a.total);
    const monthCols = [...months].map(m => ({ key: m.key, label: m.label })).reverse(); // ascendant
    const paysMonthByCode = {};
    for (const [mk, codes] of Object.entries(paysMonthMap))
      for (const [code, v] of Object.entries(codes)) { (paysMonthByCode[code] = paysMonthByCode[code] || {})[mk] = v.colis; }
    const byPaysMonth = Object.entries(paysMonthByCode)
      .map(([code, bm]) => ({ code, bm, total: Object.values(bm).reduce((s, x) => s + x, 0) }))
      .sort((a, b) => b.total - a.total);
    return { months, years, byPaysYear, yearCols, monthCols, byPaysMonth };
  })();

  // Charge une facture depuis l'historique BDD et l'affiche comme si elle venait d'être analysée
  async function handleLoadFromHistory(inv) {
    setLoading(true);
    setError(null);
    setCurrentFile(null);
    setApplyResult(null);
    setApplyProgress(0);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/history/${inv.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!data.success) throw new Error(data.error);
      // Reconstruire le format result depuis les données BDD
      const orders = (data.parcels || []).map(p => ({
        tracking: p.tracking,
        order_id: p.order_id,
        date: p.date,
        weight_chrono: p.weight_carrier != null ? parseFloat(p.weight_carrier) : null,
        weight_bdd:    p.weight_bdd    != null ? parseFloat(p.weight_bdd)    : null,
        diff_g:        p.diff_g,
        amount_ht:     p.amount_ht != null ? parseFloat(p.amount_ht) : null,
        is_return:     p.is_return || false,
        weight_corrected: p.weight_corrected || false,
      }));
      const supplements = (data.supplements || []).map(s => ({
        description:      s.description,
        amount_ht:        s.amount_ht != null ? parseFloat(s.amount_ht) : null,
        related_order_id: s.order_id,
        related_tracking: s.tracking,
      }));
      const globalCharges = data.invoice.global_charges || [];
      const rebuilt = {
        success: true,
        invoiceNumber: data.invoice.invoice_number,
        invoiceDate:   data.invoice.invoice_date,
        orders,
        supplements,
        globalCharges: Array.isArray(globalCharges) ? globalCharges : [],
        stats: {
          total_orders:      data.invoice.total_parcels,
          orders_with_bdd:   data.invoice.parcels_matched,
          returns:           orders.filter(o => o.is_return).length,
          supplements_count: supplements.length,
          supplements_total_ht: supplements.reduce((s,x) => s+(x.amount_ht||0), 0),
        },
        _fromHistory: true,
      };
      setResult(rebuilt);
      setSaveState('already');
      setCurrentInvoiceId(data.invoice.id);
      setTariffsAppliedAt(data.invoice.tariffs_applied_at || null);
      setTab('poids');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  function handleBackToHome() {
    setResult(null);
    setCurrentFile(null);
    setError(null);
    setSaveState(null);
    setApplyResult(null);
    setApplyProgress(0);
    setCurrentInvoiceId(null);
    setTariffsAppliedAt(null);
    setSearchOrder('');
    setFilterTab('all');
    setTab('poids');
    setGlobalSearch('');
    setGlobalSearchError(null);
    setGlobalSearchResults(null);
  }

  async function handleGlobalSearch() {
    const q = globalSearch.trim();
    if (!q) return;
    setGlobalSearchLoading(true);
    setGlobalSearchError(null);
    setGlobalSearchResults(null);
    try {
      const { data } = await axios.get(`${API_URL}/chronopost/search-order`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { q },
      });
      if (!data.success) throw new Error(data.error);
      if (!data.results.length) {
        setGlobalSearchError(`Aucune commande/suivi correspondant à "${q}" trouvé dans les factures enregistrées.`);
        return;
      }
      if (data.results.length === 1) {
        const r = data.results[0];
        await handleLoadFromHistory({ id: r.id });
        setSearchOrder(String(r.order_id || r.tracking || q));
        setFilterTab('all');
      } else {
        setGlobalSearchResults(data.results);
      }
    } catch (e) {
      setGlobalSearchError(e.message);
    } finally { setGlobalSearchLoading(false); }
  }

  async function handlePickGlobalSearchResult(r) {
    setGlobalSearchResults(null);
    setGlobalSearchLoading(true);
    try {
      await handleLoadFromHistory({ id: r.id });
      setSearchOrder(String(r.order_id || r.tracking || globalSearch.trim()));
      setFilterTab('all');
    } catch (e) {
      setGlobalSearchError(e.message);
    } finally { setGlobalSearchLoading(false); }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      // Envoyer PDF + données en multipart pour pouvoir retélécharger plus tard
      const fd = new FormData();
      fd.append('data', JSON.stringify(result));
      if (currentFile) fd.append('pdf', currentFile);

      const { data } = await axios.post(`${API_URL}/chronopost/save`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) {
        setSaveState(data.already_saved ? 'already' : 'saved');
        setCurrentInvoiceId(data.id);
        if (!data.already_saved) { loadHistory(); loadTotals(); }
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de l\'enregistrement');
    } finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv, e) {
    e.stopPropagation();
    if (!window.confirm(`Supprimer la facture ${inv.invoice_number} ?\nElle pourra être réimportée ensuite.`)) return;
    try {
      await axios.delete(`${API_URL}/chronopost/history/${inv.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Si la facture affichée est celle supprimée, réinitialiser
      if (result?.invoiceNumber === inv.invoice_number) {
        setResult(null); setSaveState(null); setCurrentFile(null);
        setCurrentInvoiceId(null); setTariffsAppliedAt(null); setApplyResult(null);
      }
      loadHistory();
      loadTotals();
    } catch (e) {
      setError('Erreur lors de la suppression');
    }
  }

  async function handleApplyTariffs() {
    const matchedOrders = orders.filter(o => o.order_id && o.amount_ht != null);
    if (!matchedOrders.length) { setError('Aucune commande avec un tarif calculé.'); return; }

    const confirm = window.confirm(
      `Mettre à jour le coût livraison HT pour ${matchedOrders.length} commande(s) ?\n\nCette action remplace le coût actuel par le tarif réel calculé depuis la facture.`
    );
    if (!confirm) return;

    setApplying(true); setApplyResult(null); setApplyProgress(5);

    // Animation de progression pendant la requête
    let prog = 5;
    const timer = setInterval(() => {
      prog = prog < 85 ? prog + Math.random() * 8 : prog + 0.5;
      setApplyProgress(Math.min(prog, 90));
    }, 300);

    try {
      const tariffs = matchedOrders.map(o => ({ order_id: o.order_id, tarif: getTarif(o) }));
      const { data } = await axios.post(`${API_URL}/chronopost/apply-tariffs`, { tariffs, invoiceId: currentInvoiceId }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      clearInterval(timer);
      setApplyProgress(100);
      if (data.success) {
        setApplyResult(data);
        setTariffsAppliedAt(data.tariffsAppliedAt || new Date().toISOString());
        loadHistory();
      } else setError(data.error);
    } catch (e) {
      clearInterval(timer);
      setApplyProgress(0);
      setError(e.response?.data?.error || 'Délai dépassé — réessaie, la requête est optimisée maintenant');
    }
    finally { setApplying(false); }
  }

  function handleDownloadPdf(inv, e) {
    e.stopPropagation(); // ne pas déclencher le clic de ligne
    const a = document.createElement('a');
    a.href = `${API_URL}/chronopost/history/${inv.id}/pdf`;
    a.download = `Chronopost_${inv.invoice_number}.pdf`;
    // Ajouter le token dans l'URL via fetch + blob pour l'auth
    fetch(`${API_URL}/chronopost/history/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError('PDF non disponible pour cette facture'));
  }

  async function handleZip(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setError('Fichier ZIP requis.'); return; }
    setImportingZip(true); setImportResult(null); setError(null);
    try {
      const fd = new FormData(); fd.append('zip', file);
      const { data } = await axios.post(`${API_URL}/chronopost/import-zip`, fd, { headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
      if (!data.success) throw new Error(data.error);
      setImportResult(data); loadHistory(); loadTotals();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setImportingZip(false); if (zipRef.current) zipRef.current.value = ''; }
  }

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setError('Veuillez sélectionner un fichier PDF Chronopost.');
      return;
    }
    setCurrentFile(file);
    setError(null);
    setResult(null);
    setSaveState(null);
    setApplyResult(null);
    setApplyProgress(0);
    setCurrentInvoiceId(null);
    setTariffsAppliedAt(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/chronopost/analyze`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setResult(data);
      setTab('poids');
      // Vérifier si cette facture est déjà enregistrée
      if (data.invoiceNumber) {
        const alreadySaved = history.some(h => h.invoice_number === data.invoiceNumber);
        if (alreadySaved) setSaveState('already');
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!currentFile) return;
    setExporting(true);
    try {
      const fd = new FormData();
      fd.append('pdf', currentFile);
      const resp = await axios.post(`${API_URL}/chronopost/export-excel`, fd, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      const fname = result?.invoiceNumber
        ? `Chronopost_${result.invoiceNumber}.xlsx`
        : 'Chronopost_analyse.xlsx';
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError('Erreur lors de la génération Excel.');
    } finally {
      setExporting(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  /* ── AVOIRS (credit notes) ── */
  function onCreditDrop(e) {
    e.preventDefault();
    setCreditDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleCreditFile(file);
  }

  async function handleCreditFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setCreditError('Veuillez sélectionner un fichier PDF Chronopost.');
      return;
    }
    setCreditFile(file);
    setCreditError(null);
    setCreditResult(null);
    setCreditSaveState(null);
    setCreditLoading(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/chronopost/analyze-credit`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setCreditResult(data);
      if (data.creditNumber && creditsHistory.some(c => c.credit_number === data.creditNumber)) {
        setCreditSaveState('already');
      }
    } catch (e) {
      setCreditError(e.response?.data?.error || e.message);
    } finally {
      setCreditLoading(false);
    }
  }

  async function handleSaveCredit() {
    if (!creditResult) return;
    setCreditSaving(true);
    try {
      const params = computeTarifParams(creditResult.orders || [], creditResult.globalCharges || []);
      const { supplBaseByTracking, supplFlatByTracking } = computeSupplMaps(creditResult.supplements || []);
      const credits = (creditResult.orders || [])
        .filter(o => o.amount_ht != null)
        .map(o => ({
          order_id: o.order_id || null,
          tracking: o.tracking || null,
          amount_ht: computeTarif(o, params, supplBaseByTracking, supplFlatByTracking),
        }));

      const fd = new FormData();
      fd.append('data', JSON.stringify({
        creditNumber: creditResult.creditNumber,
        creditDate: creditResult.creditDate,
        relatedInvoiceNumber: creditResult.relatedInvoiceNumber,
        credits,
      }));
      if (creditFile) fd.append('pdf', creditFile);

      const { data } = await axios.post(`${API_URL}/chronopost/save-credit`, fd, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) {
        setCreditSaveState(data.already_saved ? 'already' : 'saved');
        if (!data.already_saved) loadCreditsHistory();
      }
    } catch (e) {
      setCreditError(e.response?.data?.error || "Erreur lors de l'enregistrement");
    } finally { setCreditSaving(false); }
  }

  async function handleDeleteCredit(c, e) {
    e.stopPropagation();
    if (!window.confirm(`Supprimer l'avoir ${c.credit_number} ?`)) return;
    try {
      await axios.delete(`${API_URL}/chronopost/credits/${c.credit_number}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (creditResult?.creditNumber === c.credit_number) {
        setCreditResult(null); setCreditSaveState(null); setCreditFile(null);
      }
      loadCreditsHistory();
    } catch (e) {
      setCreditError("Erreur lors de la suppression");
    }
  }

  function handleDownloadCreditPdf(c, e) {
    e.stopPropagation();
    fetch(`${API_URL}/chronopost/credits/${c.credit_number}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Avoir_Chronopost_${c.credit_number}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setCreditError('PDF non disponible pour cet avoir'));
  }

  // Tarifs (négatifs) calculés pour les commandes de l'avoir en cours d'analyse
  const creditOrders = creditResult?.orders || [];
  const _creditTarifParams = computeTarifParams(creditOrders, creditResult?.globalCharges || []);
  const _creditSupplMaps = computeSupplMaps(creditResult?.supplements || []);
  function getCreditAmount(order) {
    return computeTarif(order, _creditTarifParams, _creditSupplMaps.supplBaseByTracking, _creditSupplMaps.supplFlatByTracking);
  }

  // Filtered orders
  const filteredOrders = (result?.orders || []).filter(o => {
    if (searchOrder && !String(o.order_id).includes(searchOrder) && !(o.tracking || '').toLowerCase().includes(searchOrder.toLowerCase())) return false;
    if (filterTab === 'ok' && (o.diff_g === null || Math.abs(o.diff_g) > 20)) return false;
    if (filterTab === 'ecart' && (o.diff_g === null || Math.abs(o.diff_g) <= 20)) return false;
    if (filterTab === 'return' && !o.is_return) return false;
    return true;
  });

  const orders = result?.orders || [];
  const supplements = result?.supplements || [];
  const globalCharges = result?.globalCharges || [];

  const countEcart = orders.filter(o => o.diff_g !== null && Math.abs(o.diff_g) > 200).length;
  const countOk    = orders.filter(o => o.diff_g !== null && Math.abs(o.diff_g) <= 20).length;
  const countRet   = orders.filter(o => o.is_return).length;

  const tarifEcarts = useMemo(
    () => orders
      .filter(o => !o.is_return)
      .map(o => ({ ...o, _ecart: computePriceEcart(o) }))
      .filter(o => o._ecart !== null && o._ecart.ecart > 0)
      .sort((a, b) => b._ecart.ecart - a._ecart.ecart),
    [orders],
  );

  // ── Extraction des tarifs unitaires depuis les charges globales
  const _tarifParams = computeTarifParams(orders, globalCharges);
  const { redevanceUnit, nbSûreté, ecoUnit, carburantRate, fraisGestionTotal } = _tarifParams;
  // Total pro-rata pour l'encart récap (toutes charges globales)
  const proRataTotal = globalCharges.reduce((s, g) => s + (g.amount_ht || 0), 0);

  // Map supplements par tracking — séparation base carburant / flat (réacheminement)
  const { supplByTracking, supplBaseByTracking, supplFlatByTracking } = computeSupplMaps(supplements);

  function getTarif(order) {
    return computeTarif(order, _tarifParams, supplBaseByTracking, supplFlatByTracking);
  }

  const proRataPerParcel = 0; // conservé pour compatibilité affichage

  function generateEmailHtml() {
    const th = (txt, right = false) =>
      `<th style="padding:8px 12px;text-align:${right?'right':'left'};background:#1F4E79;color:#fff;white-space:nowrap">${txt}</th>`;
    const td = (txt, right = false, bold = false, color = '') =>
      `<td style="padding:7px 12px;border-bottom:1px solid #E2E8EE;text-align:${right?'right':'left'};${bold?'font-weight:700;':''}${color?`color:${color};`:''}">${txt}</td>`;
    const tfoot = (cols) =>
      `<tr style="background:#EDF2F7">${cols.map((c, i) => `<td style="padding:8px 12px;font-weight:700;border-top:2px solid #B0BEC5;text-align:${i===0?'left':'right'}">${c}</td>`).join('')}</tr>`;
    const TABLE = (rows) =>
      `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;margin-bottom:20px">${rows}</table>`;

    const supplGroups = {};
    for (const s of supplements) {
      const key = s.description;
      if (!supplGroups[key]) supplGroups[key] = { description: key, count: 0, total: 0, unitCost: s.amount_ht };
      supplGroups[key].count += 1;
      supplGroups[key].total += s.amount_ht || 0;
    }

    const tarifOvercharges = orders
      .filter(o => !o.is_return)
      .map(o => ({ ...o, _ecart: computePriceEcart(o) }))
      .filter(o => o._ecart !== null && o._ecart.ecart > 0)
      .sort((a, b) => b._ecart.ecart - a._ecart.ecart);

    const bigDiffs = orders.filter(o => o.diff_g !== null && o.diff_g > 200 && !o.is_return && !hasKnownTariff(o));

    let html = `<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#2C3E50;line-height:1.6">`;
    html += `<p>Bonjour Amel,</p>`;
    html += `<p>Comme précédemment, je vous transmets les facturations anormales reçues. Votre service facturation avait accepté le remboursement.</p>`;

    if (Object.keys(supplGroups).length > 0) {
      const totalSup = supplements.reduce((s, x) => s + (x.amount_ht || 0), 0);
      html += `<p><strong>Facture ${result.invoiceNumber} du ${result.invoiceDate}</strong></p>`;
      html += TABLE(
        `<thead><tr>${th('Type de supplément')}${th('Coût unitaire', true)}${th('Nb', true)}${th('Total HT', true)}</tr></thead>` +
        `<tbody>${Object.values(supplGroups).map((g, i) => `<tr style="background:${i%2===0?'#fff':'#F8FAFB'}">${
          td(g.description)}${td(g.unitCost!=null?`${g.unitCost.toFixed(2)} €`:'—',true)}${td(String(g.count),true)}${td(`${g.total.toFixed(2)} €`,true,true)
        }</tr>`).join('')}</tbody>` +
        `<tfoot>${tfoot(['TOTAL','','',`${totalSup.toFixed(2)} €`])}</tfoot>`
      );
    }

    if (tarifOvercharges.length > 0) {
      const totalEcart = tarifOvercharges.reduce((s, o) => s + o._ecart.ecart, 0);
      html += `<p><strong style="color:#E74C3C">Surcoûts tarifaires — changement de tranche (${tarifOvercharges.length} colis)</strong><br>`;
      html += `Total réclamable : <strong style="color:#E74C3C">+${totalEcart.toFixed(2)} €&nbsp;HT</strong></p>`;
      html += TABLE(
        `<thead><tr>${th('N° Commande')}${th('N° Suivi')}${th('Service')}${th('Poids déclaré',true)}${th('Poids Chrono',true)}${th('Tarif dû',true)}${th('Tarif facturé',true)}${th('Surcoût HT',true)}</tr></thead>` +
        `<tbody>${tarifOvercharges.map((o, i) => {
          const { service, priceDu, priceFac, ecart } = o._ecart;
          const wBdd = o.weight_bdd!=null?`${parseFloat(o.weight_bdd).toFixed(3)} kg`:'—';
          const wChr = o.weight_chrono!=null?`${parseFloat(o.weight_chrono).toFixed(3)} kg`:'—';
          return `<tr style="background:${i%2===0?'#fff':'#F8FAFB'}">${
            td(o.order_id||'—',false,true)}${td(o.tracking||'—')}${td(service)}${td(wBdd,true)}${td(wChr,true,'','#E74C3C')}${
            td(`${priceDu.toFixed(2)} €`,true,false,'#27AE60')}${td(`${priceFac.toFixed(2)} €`,true)}${td(`+${ecart.toFixed(2)} €`,true,true,'#E74C3C')
          }</tr>`;
        }).join('')}</tbody>` +
        `<tfoot>${tfoot(['TOTAL','','','','','','',`+${totalEcart.toFixed(2)} €`])}</tfoot>`
      );
    }

    if (bigDiffs.length > 0) {
      html += `<p><strong>Écarts de poids importants — tarif non calculable (Chrono Relais Europe / service inconnu)</strong></p>`;
      html += TABLE(
        `<thead><tr>${th('N° Commande')}${th('N° Suivi')}${th('Poids déclaré',true)}${th('Poids Chrono',true)}${th('Écart',true)}</tr></thead>` +
        `<tbody>${bigDiffs.map((o, i) => {
          const bdd    = o.weight_bdd!=null?`${parseFloat(o.weight_bdd).toFixed(3)} kg`:'—';
          const chrono = o.weight_chrono!=null?`${parseFloat(o.weight_chrono).toFixed(3)} kg`:'—';
          return `<tr style="background:${i%2===0?'#fff':'#F8FAFB'}">${td(o.order_id||'—',false,true)}${td(o.tracking||'—')}${td(bdd,true)}${td(chrono,true,'','#E74C3C')}${td(o.diff_g!=null?`+${o.diff_g} g`:'—',true,true,'#E74C3C')}</tr>`;
        }).join('')}</tbody>`
      );
    }

    html += `<p>Cordialement<br><br><strong>Maxime Coglitore</strong><br>Directeur<br>04 99 78 24 53<br>direction@youvape.fr<br>www.youvape.fr</p>`;
    html += `</body></html>`;
    return html;
  }

  function generateEmailText() {
    const supplGroups = {};
    for (const s of supplements) {
      const key = s.description;
      if (!supplGroups[key]) supplGroups[key] = { description: key, count: 0, total: 0, unitCost: s.amount_ht };
      supplGroups[key].count += 1;
      supplGroups[key].total += s.amount_ht || 0;
    }

    const bigDiffs = orders
      .filter(o => o.diff_g !== null && o.diff_g > 200 && !o.is_return)
      .sort((a, b) => b.diff_g - a.diff_g);

    let text = 'Bonjour Amel,\n\n';
    text += 'Comme précédemment, je vous transmets les facturations anormales reçues. Votre service facturation avait accepté le remboursement.\n';

    const row = cols => '| ' + cols.join(' | ') + ' |';
    const sep = cols => '|' + cols.map(w => '-'.repeat(w + 2)).join('|') + '|';

    if (supplements.length > 0) {
      const totalSup = supplements.reduce((s, x) => s + (x.amount_ht || 0), 0);
      text += `\nFacture ${result.invoiceNumber} du ${result.invoiceDate}\n\n`;
      text += row(['Type de supplément', 'Coût unitaire', 'Nb', 'Total HT']) + '\n';
      text += sep([34, 13, 4, 10]) + '\n';
      for (const g of Object.values(supplGroups)) {
        const unitStr = g.unitCost != null ? `${g.unitCost.toFixed(2)} €` : '—';
        text += row([g.description, unitStr, String(g.count), `${g.total.toFixed(2)} €`]) + '\n';
      }
      text += sep([34, 13, 4, 10]) + '\n';
      text += row(['TOTAL', '', '', `${totalSup.toFixed(2)} €`]) + '\n';
    }

    // Surcoûts tarifaires réels (changement de tranche)
    const tarifOvercharges = orders
      .filter(o => !o.is_return)
      .map(o => ({ ...o, _ecart: computePriceEcart(o) }))
      .filter(o => o._ecart !== null && o._ecart.ecart > 0)
      .sort((a, b) => b._ecart.ecart - a._ecart.ecart);

    if (tarifOvercharges.length > 0) {
      const totalEcartTarif = tarifOvercharges.reduce((s, o) => s + o._ecart.ecart, 0);
      text += `\n\nSurcoûts tarifaires — changement de tranche (${tarifOvercharges.length} colis)\n\n`;
      text += row(['N° Commande', 'N° Suivi', 'Service', 'Poids déclaré', 'Poids Chrono', 'Tarif dû', 'Tarif facturé', 'Surcoût HT']) + '\n';
      text += sep([11, 16, 14, 13, 12, 8, 13, 10]) + '\n';
      for (const o of tarifOvercharges) {
        const { service, priceDu, priceFac, ecart } = o._ecart;
        const wBdd  = o.weight_bdd    != null ? `${parseFloat(o.weight_bdd).toFixed(3)} kg`    : '—';
        const wChr  = o.weight_chrono != null ? `${parseFloat(o.weight_chrono).toFixed(3)} kg`  : '—';
        text += row([
          String(o.order_id || '—'),
          String(o.tracking || '—'),
          service,
          wBdd,
          wChr,
          `${priceDu.toFixed(2)} €`,
          `${priceFac.toFixed(2)} €`,
          `+${ecart.toFixed(2)} €`,
        ]) + '\n';
      }
      text += sep([11, 16, 14, 13, 12, 8, 13, 10]) + '\n';
      text += row(['TOTAL', '', '', '', '', '', '', `+${totalEcartTarif.toFixed(2)} €`]) + '\n';
    }

    // Écarts de poids importants sur services non analysés tarifairement (XF, XT, XU…)
    const unknownServiceBigDiffs = bigDiffs.filter(o => !hasKnownTariff(o));
    if (unknownServiceBigDiffs.length > 0) {
      text += '\n\nÉcarts de poids importants — tarif non calculable (Chrono Relais Europe / service inconnu)\n\n';
      text += row(['N° Commande', 'Date', 'N° Suivi', 'Poids déclaré', 'Poids Chrono', 'Écart']) + '\n';
      text += sep([11, 12, 16, 13, 12, 8]) + '\n';
      for (const o of unknownServiceBigDiffs) {
        const bdd    = o.weight_bdd    != null ? `${parseFloat(o.weight_bdd).toFixed(3)} kg`    : '—';
        const chrono = o.weight_chrono != null ? `${parseFloat(o.weight_chrono).toFixed(3)} kg`  : '—';
        const ecart  = o.diff_g != null ? `+${o.diff_g} g` : '—';
        text += row([String(o.order_id || '—'), String(o.date || '—'), String(o.tracking || '—'), bdd, chrono, ecart]) + '\n';
      }
    }

    text += '\n\nCordialement\n\nMaxime Coglitore\nDirecteur\n04 99 78 24 53\ndirection@youvape.fr\nwww.youvape.fr';
    return text;
  }

  return (
    <AppShell currentPath="/chronopost">
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>

        {/* ── HEADER */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.dark, margin: 0 }}>
            Analyse facture Chronopost
          </h1>
          <p style={{ color: C.greyT, margin: '6px 0 0', fontSize: 13.5 }}>
            Importe une facture PDF Chronopost pour comparer les poids avec la BDD et lister les suppléments.
          </p>
        </div>

        {/* ── RECHERCHE GLOBALE D'UNE COMMANDE */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              placeholder="Rechercher une commande ou un n° de suivi dans toutes les factures…"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGlobalSearch(); }}
              style={{
                padding: '10px 14px', border: `1px solid ${C.greyB}`,
                borderRadius: 8, fontSize: 13.5, flex: 1, minWidth: 240,
                background: C.white,
              }}
            />
            <button
              onClick={handleGlobalSearch}
              disabled={globalSearchLoading || !globalSearch.trim()}
              style={{
                padding: '10px 20px', border: 'none', borderRadius: 8,
                background: C.accent, color: C.white, fontWeight: 700,
                fontSize: 13.5, cursor: globalSearchLoading ? 'default' : 'pointer',
                opacity: globalSearchLoading || !globalSearch.trim() ? 0.6 : 1,
              }}
            >
              {globalSearchLoading ? 'Recherche…' : '🔍 Rechercher'}
            </button>
          </div>
          {globalSearchError && (
            <div style={{ marginTop: 8, color: C.red, fontSize: 13 }}>⚠️ {globalSearchError}</div>
          )}
          {globalSearchResults && (
            <div style={{
              marginTop: 10, background: C.white, border: `1px solid ${C.greyB}`,
              borderRadius: 8, overflow: 'hidden',
            }}>
              {globalSearchResults.map((r, i) => (
                <div key={i}
                  onClick={() => handlePickGlobalSearchResult(r)}
                  style={{
                    padding: '10px 14px', fontSize: 13, cursor: 'pointer',
                    borderBottom: i < globalSearchResults.length - 1 ? `1px solid ${C.greyB}` : 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Facture <strong>{r.invoice_number}</strong> ({r.invoice_date || '—'}) — Commande <strong>{r.order_id || '—'}</strong> · Suivi {r.tracking}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── UPLOAD ZONE */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? C.accent : C.greyB}`,
            borderRadius: 14,
            background: dragging ? C.accentL : C.grey,
            padding: '40px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
            marginBottom: 24,
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.dark }}>
            {loading ? 'Analyse en cours…' : 'Déposer la facture PDF ici'}
          </div>
          <div style={{ color: C.greyT, fontSize: 13, marginTop: 6 }}>
            ou cliquer pour sélectionner le fichier
          </div>
          {currentFile && !loading && (
            <div style={{ marginTop: 10, color: C.accent, fontSize: 13, fontWeight: 600 }}>
              📎 {currentFile.name}
            </div>
          )}
          {loading && (
            <div style={{ marginTop: 14 }}>
              <div style={{
                display: 'inline-block', width: 28, height: 28,
                border: `3px solid ${C.accentL}`,
                borderTop: `3px solid ${C.accent}`,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
        </div>

        {/* ── IMPORT ZIP */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <input ref={zipRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={e => handleZip(e.target.files[0])} />
          <button onClick={() => zipRef.current?.click()} disabled={importingZip}
            style={{ background: C.white, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: importingZip ? 'wait' : 'pointer', opacity: importingZip ? .7 : 1 }}>
            {importingZip ? '⏳ Import en cours…' : '📦 Importer un ZIP de factures'}
          </button>
          <span style={{ color: C.greyT, fontSize: 12.5 }}>Toutes les factures PDF du ZIP sont analysées et enregistrées d'un coup (doublons ignorés).</span>
        </div>
        {importResult && (
          <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 10, padding: '12px 16px', color: C.dark, fontSize: 13.5, marginBottom: 20 }}>
            ✓ Import terminé : <strong>{importResult.imported}</strong> ajoutée(s){importResult.already > 0 && <>, {importResult.already} déjà présente(s)</>}{importResult.failed?.length > 0 && <>, <span style={{ color: C.red }}>{importResult.failed.length} en échec</span></>} sur {importResult.total}.
            {importResult.failed?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: C.red }}>{importResult.failed.map((f, i) => <li key={i}>{f.name} — {f.error}</li>)}</ul>}
          </div>
        )}

        {/* ── ERROR */}
        {error && (
          <div style={{
            background: C.redL, border: `1px solid ${C.red}`,
            borderRadius: 10, padding: '12px 16px',
            color: C.red, fontSize: 13.5, marginBottom: 20,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── RESULTS */}
        {result && (
          <>
            {/* Metadata + stats */}
            <div style={{
              background: C.white, borderRadius: 12,
              border: `1px solid ${C.greyB}`,
              padding: '16px 20px', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 12,
            }}>
              <div>
                <button onClick={handleBackToHome} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: C.greyT, cursor: 'pointer', marginRight: 12 }}>
                  ← Retour à l'accueil
                </button>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>
                  Facture {result.invoiceNumber}
                </span>
                {result.invoiceDate && (
                  <span style={{ color: C.greyT, fontSize: 13, marginLeft: 12 }}>
                    {result.invoiceDate}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Bouton Enregistrer */}
                {saveState === 'saved' && (
                  <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Facture enregistrée</span>
                )}
                {saveState === 'already' && (
                  <span style={{
                    background: C.yellowL, color: '#92400E',
                    border: '1px solid #F59E0B', borderRadius: 8,
                    padding: '6px 14px', fontSize: 13, fontWeight: 600,
                  }}>⚠ Facture déjà enregistrée en BDD</span>
                )}
                {saveState === null && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      background: C.green, color: C.white,
                      border: 'none', borderRadius: 8,
                      padding: '9px 18px', fontWeight: 700,
                      fontSize: 13.5, cursor: saving ? 'wait' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? '⏳ Enregistrement…' : '💾 Enregistrer la facture'}
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 240 }}>
                    {applyResult && (
                      <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>
                        ✓ {applyResult.updated} commande(s) mise(s) à jour
                        {applyResult.skipped > 0 && ` (${applyResult.skipped} ignorées)`}
                      </span>
                    )}
                    {!applyResult && tariffsAppliedAt && (
                      <span style={{
                        background: C.yellowL, color: '#92400E',
                        border: '1px solid #F59E0B', borderRadius: 8,
                        padding: '4px 10px', fontSize: 12, fontWeight: 600,
                      }}>
                        ✓ Tarifs déjà appliqués le {new Date(tariffsAppliedAt).toLocaleString('fr-FR')}
                      </span>
                    )}
                    <button
                      onClick={handleApplyTariffs}
                      disabled={applying || !orders.filter(o=>o.order_id && o.amount_ht!=null).length}
                      title="Remplace le Coût livraison HT de chaque commande par le tarif réel calculé"
                      style={{
                        background: '#7C3AED', color: C.white,
                        border: 'none', borderRadius: 8,
                        padding: '9px 18px', fontWeight: 700,
                        fontSize: 13.5, cursor: applying ? 'wait' : 'pointer',
                        opacity: applying ? 0.85 : 1, width: '100%',
                      }}
                    >
                      {applying
                        ? `⏳ Mise à jour… ${Math.round(applyProgress)}%`
                        : (tariffsAppliedAt ? '🔄 Réappliquer les tarifs aux commandes' : '🔄 Appliquer les tarifs aux commandes')}
                    </button>
                    {applying && (
                      <div style={{ height: 6, background: C.greyB, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 4,
                          background: 'linear-gradient(90deg, #7C3AED, #A78BFA)',
                          width: `${applyProgress}%`,
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                    )}
                  </div>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  style={{
                    background: C.primary, color: C.white,
                    border: 'none', borderRadius: 8,
                    padding: '9px 18px', fontWeight: 700,
                    fontSize: 13.5, cursor: exporting ? 'wait' : 'pointer',
                    opacity: exporting ? 0.7 : 1,
                  }}
                >
                  {exporting ? '⏳ Export…' : '⬇️ Télécharger Excel'}
                </button>
              </div>
            </div>

            {/* Stats cards */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <StatCard value={orders.length} label="Colis facturés" />
              <StatCard value={countOk} label="Poids OK (≤ 20g)" color={C.green} />
              <StatCard value={countEcart} label="Écarts > 200g" color={C.red} />
              <StatCard value={countRet} label="Retours" color={C.orange} />
              <StatCard value={supplements.length} label="Suppléments" color={C.accent} />
              <StatCard
                value={fmtEur(result.stats?.supplements_total_ht)}
                label="Total suppléments HT"
                color={C.orange}
              />
            </div>

            {/* Tabs */}
            <div style={{
              background: C.white, borderRadius: 12,
              border: `1px solid ${C.greyB}`,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <div style={{
                display: 'flex', borderBottom: `1px solid ${C.greyB}`,
                padding: '0 16px',
              }}>
                <TabBtn label="Comparaison poids" active={tab === 'poids'} onClick={() => setTab('poids')} badge={orders.length} />
                <TabBtn label="Suppléments colis" active={tab === 'suppléments'} onClick={() => setTab('suppléments')} badge={supplements.length} />
                <TabBtn
                  label="Écart tarifaire"
                  active={tab === 'ecart-tarif'}
                  onClick={() => setTab('ecart-tarif')}
                  badge={tarifEcarts.length || null}
                />
                <TabBtn label="Charges globales" active={tab === 'global'} onClick={() => setTab('global')} badge={globalCharges.length} />
                <TabBtn label="Avoirs" active={tab === 'avoirs'} onClick={() => setTab('avoirs')} badge={creditsHistory.length} />
                <TabBtn label="Historique" active={tab === 'historique'} onClick={() => setTab('historique')} badge={history.length} />
                <TabBtn label="Totaux" active={tab === 'totaux'} onClick={() => setTab('totaux')} />
                <TabBtn
                  label="✉ Email réclamation"
                  active={tab === 'email'}
                  onClick={() => { setTab('email'); setEmailCopied(false); }}
                  badge={supplements.length + orders.filter(o => o.diff_g !== null && o.diff_g > 200 && !o.is_return).length || null}
                />
              </div>

              {/* ── TAB POIDS */}
              {tab === 'poids' && (
                <div style={{ padding: 20 }}>
                  {/* ── Récapitulatif tarifs */}
                  {(() => {
                    const totalTarifCalcule = orders.reduce((s, o) => s + (o.amount_ht != null ? getTarif(o) : 0), 0);
                    const totalParcelsHT    = orders.reduce((s, o) => s + (o.amount_ht || 0), 0);
                    const totalSupplHT      = supplements.reduce((s, x) => s + (x.amount_ht || 0), 0);
                    const totalGlobalHT     = globalCharges.reduce((s, g) => s + (g.amount_ht || 0), 0);
                    const totalFactureHT    = totalParcelsHT + totalSupplHT + totalGlobalHT;
                    const ecart             = totalTarifCalcule - totalFactureHT;
                    const ecartPct          = totalFactureHT > 0 ? (Math.abs(ecart) / totalFactureHT * 100).toFixed(2) : '—';
                    const matchOk           = Math.abs(ecart) < 0.02;
                    return (
                      <div style={{
                        marginBottom: 16, background: matchOk ? C.greenL : C.yellowL,
                        border: `1px solid ${matchOk ? C.green : '#F59E0B'}`,
                        borderRadius: 10, padding: '14px 18px',
                        display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
                      }}>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Total tarif réel calculé</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{fmtEur(totalTarifCalcule)}</div>
                          <div style={{ fontSize: 10, color: C.greyT, marginTop: 2 }}>
                            Colis {fmtEur(totalParcelsHT)} + Suppl. {fmtEur(totalSupplHT)} + Pro-rata {fmtEur(proRataTotal)}
                          </div>
                        </div>
                        <div style={{ fontSize: 20, color: C.greyT }}>vs</div>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Total facture HT</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>{fmtEur(totalFactureHT)}</div>
                          <div style={{ fontSize: 10, color: C.greyT, marginTop: 2 }}>
                            Colis {fmtEur(totalParcelsHT)} + Suppl. {fmtEur(totalSupplHT)} + Globaux {fmtEur(totalGlobalHT)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Écart</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: matchOk ? C.green : C.orange }}>
                            {ecart >= 0 ? '+' : ''}{fmtEur(ecart)}
                          </div>
                          <div style={{ fontSize: 10, color: C.greyT, marginTop: 2 }}>
                            {matchOk ? '✓ Correspond' : `${ecartPct}% — charges non pro-ratisées`}
                          </div>
                        </div>
                        {carburantRate > 0 && (
                          <div style={{ fontSize: 11, color: C.greyT, borderLeft: `1px solid ${C.greyB}`, paddingLeft: 16 }}>
                            ℹ️ Rdev: <strong>{redevanceUnit.toFixed(2)}€</strong> · Carburant: <strong>{(carburantRate*100).toFixed(2)}%</strong> · Éco: <strong>{ecoUnit.toFixed(2)}€</strong> · Gestion: <strong>{(fraisGestionTotal/nbSûreté).toFixed(3)}€</strong>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      placeholder="Rechercher commande ou suivi…"
                      value={searchOrder}
                      onChange={e => setSearchOrder(e.target.value)}
                      style={{
                        padding: '8px 12px', border: `1px solid ${C.greyB}`,
                        borderRadius: 8, fontSize: 13, flex: 1, minWidth: 200,
                      }}
                    />
                    {[
                      { key: 'all', label: 'Tous' },
                      { key: 'ok', label: '✓ OK (≤20g)' },
                      { key: 'ecart', label: '⚠ Écart (>20g)' },
                      { key: 'return', label: '↩ Retours' },
                    ].map(({ key, label }) => (
                      <button key={key} onClick={() => setFilterTab(key)} style={{
                        padding: '7px 14px', border: `1px solid ${filterTab === key ? C.accent : C.greyB}`,
                        borderRadius: 8, background: filterTab === key ? C.accentL : C.white,
                        color: filterTab === key ? C.accent : C.dark,
                        fontWeight: filterTab === key ? 700 : 500,
                        fontSize: 12.5, cursor: 'pointer',
                      }}>{label}</button>
                    ))}
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: C.grey }}>
                          {['N° Commande', 'Date', 'N° Suivi', 'Poids BDD', 'Poids Chrono', 'Écart', 'Tarif réel HT', 'Statut'].map(h => (
                            <th key={h} style={{
                              padding: '10px 12px', textAlign: 'left',
                              fontWeight: 700, color: C.dark, fontSize: 12,
                              borderBottom: `2px solid ${C.greyB}`,
                              whiteSpace: 'nowrap',
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.length === 0 && (
                          <tr>
                            <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>
                              Aucun résultat
                            </td>
                          </tr>
                        )}
                        {filteredOrders.map((o, i) => (
                          <tr key={i} style={{
                            background: i % 2 === 0 ? C.white : C.grey,
                            borderBottom: `1px solid ${C.greyB}`,
                          }}>
                            <td style={{ padding: '9px 12px', fontWeight: 600, color: C.dark }}>
                              {o.order_id
                                ? <a href={`/orders/${o.order_id}`} target="_blank" rel="noreferrer"
                                    style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}
                                    onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                                    onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                  >{o.order_id}</a>
                                : <span style={{ color: C.greyT }}>—</span>
                              }
                            </td>
                            <td style={{ padding: '9px 12px', color: C.greyT }}>{o.date || '—'}</td>
                            <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, color: C.greyT }}>
                              {o.tracking}
                            </td>
                            <td style={{ padding: '9px 12px' }}>{fmtKg(o.weight_bdd)}</td>
                            <td style={{ padding: '9px 12px', fontWeight: 600 }}>{fmtKg(o.weight_chrono)}</td>
                            <td style={{
                              padding: '9px 12px', fontWeight: 700,
                              color: diffTextColor(o.diff_g),
                              background: diffColor(o.diff_g),
                            }}>
                              {fmtDiff(o.diff_g)}
                            </td>
                            <td
                              style={{ padding: '9px 12px', fontWeight: 700, color: C.primary, cursor: 'help', position: 'relative' }}
                              onMouseEnter={e => {
                                if (o.amount_ht == null) return;
                                const txt = o.is_return
                                  ? `Retour : (${o.amount_ht.toFixed(2)} + ${(supplByTracking[o.tracking]||0).toFixed(2)} suppl) × ${(1+carburantRate).toFixed(4)}`
                                  : `(${o.amount_ht.toFixed(2)} + ${(supplByTracking[o.tracking]||0).toFixed(2)} suppl + ${redevanceUnit.toFixed(2)} rdev) × ${(1+carburantRate).toFixed(4)} + ${ecoUnit.toFixed(2)} éco + ${(fraisGestionTotal/nbSûreté).toFixed(3)} gest`;
                                const r = e.currentTarget.getBoundingClientRect();
                                setTooltip({ text: txt, x: r.left, y: r.bottom + 6 });
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            >
                              {o.amount_ht != null ? fmtEur(getTarif(o)) : '—'}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {o.is_return && <Badge label="Retour" color={C.red} bg={C.redL} />}
                              {!o.is_return && o.weight_corrected && <Badge label="Corrigé" color={C.accent} bg={C.accentL} />}
                              {!o.is_return && !o.weight_corrected && o.diff_g !== null && Math.abs(o.diff_g) <= 20 && (
                                <Badge label="OK" color={C.green} bg={C.greenL} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ color: C.greyT, fontSize: 12, marginTop: 6 }}>
                    {filteredOrders.length} ligne(s) affichée(s) sur {orders.length}
                  </div>
                </div>
              )}

              {/* ── TAB SUPPLÉMENTS */}
              {tab === 'suppléments' && (
                <div style={{ padding: 20 }}>
                  {supplements.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucun supplément détecté sur cette facture.
                    </div>
                  ) : (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: C.grey }}>
                              {['N° Commande', 'N° Suivi', 'Type de supplément', 'Montant HT'].map(h => (
                                <th key={h} style={{
                                  padding: '10px 12px', textAlign: 'left',
                                  fontWeight: 700, color: C.dark, fontSize: 12,
                                  borderBottom: `2px solid ${C.greyB}`,
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {supplements.map((s, i) => (
                              <tr key={i} style={{
                                background: i % 2 === 0 ? '#FFFBF5' : C.white,
                                borderBottom: `1px solid ${C.greyB}`,
                              }}>
                                <td style={{ padding: '9px 12px', fontWeight: 600, color: C.dark }}>
                                  {s.related_order_id ?? '—'}
                                </td>
                                <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, color: C.greyT }}>
                                  {s.related_tracking || '—'}
                                </td>
                                <td style={{ padding: '9px 12px' }}>
                                  <Badge label={s.description} color={C.orange} bg={C.orangeL} />
                                </td>
                                <td style={{ padding: '9px 12px', fontWeight: 700, color: C.orange }}>
                                  {fmtEur(s.amount_ht)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{
                        marginTop: 16, textAlign: 'right',
                        fontWeight: 700, fontSize: 14, color: C.orange,
                      }}>
                        Total suppléments HT :{' '}
                        {fmtEur(supplements.reduce((s, x) => s + (x.amount_ht || 0), 0))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── TAB ÉCART TARIFAIRE */}
              {tab === 'ecart-tarif' && (
                <div style={{ padding: 20 }}>
                  {orders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Chargez une facture pour voir les écarts tarifaires.
                    </div>
                  ) : tarifEcarts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucun changement de tranche tarifaire détecté sur cette facture.
                      <div style={{ fontSize: 12, marginTop: 8 }}>
                        Les services analysés : Chrono 13 (XA/XN), Chrono Relais 13 (XS), 2Shop Direct (XR/XY).
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{
                        marginBottom: 16, background: C.redL,
                        border: `1px solid ${C.red}`, borderRadius: 10,
                        padding: '14px 18px', display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
                      }}>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Surcoût tarifaire total réclamable</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: C.red }}>
                            +{fmtEur(tarifEcarts.reduce((s, o) => s + o._ecart.ecart, 0))}
                          </div>
                          <div style={{ fontSize: 11, color: C.greyT, marginTop: 2 }}>
                            {tarifEcarts.length} colis avec changement de tranche tarifaire
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: C.greyT, maxWidth: 400 }}>
                          Uniquement les colis où le poids déclaré (BDD) et le poids Chronopost tombent dans des tranches
                          différentes — ce qui génère un vrai surcoût réclamable.
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: C.grey }}>
                              {['N° Commande', 'Date', 'N° Suivi', 'Service', 'Poids BDD', 'Poids Chrono', 'Prix dû', 'Prix facturé', 'Surcoût'].map(h => (
                                <th key={h} style={{
                                  padding: '10px 12px', textAlign: h === 'Surcoût' || h === 'Prix dû' || h === 'Prix facturé' ? 'right' : 'left',
                                  fontWeight: 700, color: C.dark, fontSize: 12,
                                  borderBottom: `2px solid ${C.greyB}`, whiteSpace: 'nowrap',
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tarifEcarts.map((o, i) => {
                              const { service, priceDu, priceFac, ecart } = o._ecart;
                              return (
                                <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}` }}>
                                  <td style={{ padding: '9px 12px', fontWeight: 600 }}>
                                    {o.order_id
                                      ? <a href={`/orders/${o.order_id}`} target="_blank" rel="noreferrer"
                                          style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}
                                          onMouseEnter={e => e.currentTarget.style.textDecoration='underline'}
                                          onMouseLeave={e => e.currentTarget.style.textDecoration='none'}
                                        >{o.order_id}</a>
                                      : <span style={{ color: C.greyT }}>—</span>}
                                  </td>
                                  <td style={{ padding: '9px 12px', color: C.greyT }}>{o.date || '—'}</td>
                                  <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 11, color: C.greyT }}>{o.tracking}</td>
                                  <td style={{ padding: '9px 12px' }}>
                                    <Badge label={service} color={C.primary} bg={C.accentL} />
                                  </td>
                                  <td style={{ padding: '9px 12px', color: C.green, fontWeight: 600 }}>{fmtKg(o.weight_bdd)}</td>
                                  <td style={{ padding: '9px 12px', fontWeight: 600 }}>{fmtKg(o.weight_chrono)}</td>
                                  <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 700 }}>{fmtEur(priceDu)}</td>
                                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtEur(priceFac)}</td>
                                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: C.red }}>+{fmtEur(ecart)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ background: C.grey, borderTop: `2px solid ${C.greyB}` }}>
                              <td colSpan={8} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right', color: C.dark }}>
                                Total surcoût réclamable HT
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.red, whiteSpace: 'nowrap' }}>
                                +{fmtEur(tarifEcarts.reduce((s, o) => s + o._ecart.ecart, 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <div style={{ color: C.greyT, fontSize: 12, marginTop: 6 }}>
                        Services analysés : Chrono 13, Relais 13, 2Shop Direct, Chrono Express (XF), 2Shop Europe (XT). Non analysé : Chrono Relais Europe (XU).
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── TAB GLOBAL */}
              {tab === 'global' && (
                <div style={{ padding: 20 }}>
                  {globalCharges.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucune charge globale détectée.
                    </div>
                  ) : (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: C.grey }}>
                              {['Description', 'Détail', 'Montant HT'].map(h => (
                                <th key={h} style={{
                                  padding: '10px 12px', textAlign: 'left',
                                  fontWeight: 700, color: C.dark, fontSize: 12,
                                  borderBottom: `2px solid ${C.greyB}`,
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {globalCharges.map((g, i) => (
                              <tr key={i} style={{
                                background: i % 2 === 0 ? C.white : C.grey,
                                borderBottom: `1px solid ${C.greyB}`,
                              }}>
                                <td style={{ padding: '9px 12px', fontWeight: 600, color: C.dark }}>
                                  {g.description}
                                </td>
                                <td style={{ padding: '9px 12px', color: C.greyT }}>{g.detail || '—'}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700, color: C.accent }}>
                                  {fmtEur(g.amount_ht)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                              <td colSpan={2} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>
                                TOTAL
                              </td>
                              <td style={{ padding: '10px 12px', fontWeight: 800, color: C.primary, fontSize: 15 }}>
                                {fmtEur(globalCharges.reduce((s, x) => s + (x.amount_ht || 0), 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── TAB EMAIL RÉCLAMATION */}
              {tab === 'email' && (
                <div style={{ padding: 20 }}>
                  {supplements.length === 0 && orders.filter(o => o.diff_g !== null && o.diff_g > 200 && !o.is_return).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucun supplément ni écart de poids important (&gt;200g) détecté sur cette facture.
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>
                          Aperçu de l'email — cliquez <strong>Copier</strong> puis collez directement dans Gmail ou Outlook.
                        </p>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.write([new ClipboardItem({
                                'text/html':  new Blob([generateEmailHtml()],  { type: 'text/html' }),
                                'text/plain': new Blob([generateEmailText()], { type: 'text/plain' }),
                              })]);
                            } catch {
                              navigator.clipboard.writeText(generateEmailText());
                            }
                            setEmailCopied(true);
                            setTimeout(() => setEmailCopied(false), 2500);
                          }}
                          style={{
                            background: emailCopied ? C.green : C.accent, color: C.white,
                            border: 'none', borderRadius: 8,
                            padding: '9px 20px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
                            transition: 'background 0.2s',
                          }}
                        >
                          {emailCopied ? '✓ Copié !' : '📋 Copier l\'email'}
                        </button>
                      </div>
                      <div
                        dangerouslySetInnerHTML={{ __html: generateEmailHtml() }}
                        style={{
                          border: `1px solid ${C.greyB}`, borderRadius: 8,
                          padding: '20px 24px', background: C.white,
                          minHeight: 300, overflowY: 'auto',
                        }}
                      />
                    </>
                  )}
                </div>
              )}

              {/* ── TAB AVOIRS */}
              {tab === 'avoirs' && (
                <div style={{ padding: 20 }}>
                  <p style={{ margin: '0 0 14px', color: C.greyT, fontSize: 13 }}>
                    Importe un PDF d'avoir Chronopost ("Avoir sur facture …") : son montant sera déduit
                    du tarif réel de la commande correspondante (via le n° de commande, ou à défaut le n° de suivi).
                  </p>

                  {/* Upload zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setCreditDragging(true); }}
                    onDragLeave={() => setCreditDragging(false)}
                    onDrop={onCreditDrop}
                    onClick={() => creditFileRef.current?.click()}
                    style={{
                      border: `2px dashed ${creditDragging ? C.accent : C.greyB}`,
                      borderRadius: 12,
                      background: creditDragging ? C.accentL : C.grey,
                      padding: '28px 20px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      marginBottom: 16,
                    }}
                  >
                    <input
                      ref={creditFileRef}
                      type="file"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      onChange={e => handleCreditFile(e.target.files[0])}
                    />
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>
                      {creditLoading ? 'Analyse en cours…' : "Déposer le PDF d'avoir Chronopost ici"}
                    </div>
                    <div style={{ color: C.greyT, fontSize: 12.5, marginTop: 4 }}>
                      ou cliquer pour sélectionner le fichier
                    </div>
                    {creditFile && !creditLoading && (
                      <div style={{ marginTop: 8, color: C.accent, fontSize: 12.5, fontWeight: 600 }}>
                        📎 {creditFile.name}
                      </div>
                    )}
                  </div>

                  {creditError && (
                    <div style={{
                      background: C.redL, border: `1px solid ${C.red}`,
                      borderRadius: 10, padding: '12px 16px',
                      color: C.red, fontSize: 13.5, marginBottom: 16,
                    }}>
                      ⚠️ {creditError}
                    </div>
                  )}

                  {creditResult && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        flexWrap: 'wrap', gap: 12, marginBottom: 12,
                      }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>
                            Avoir {creditResult.creditNumber}
                          </span>
                          {creditResult.creditDate && (
                            <span style={{ color: C.greyT, fontSize: 13, marginLeft: 12 }}>{creditResult.creditDate}</span>
                          )}
                          {creditResult.relatedInvoiceNumber && (
                            <span style={{ color: C.greyT, fontSize: 13, marginLeft: 12 }}>
                              (sur facture {creditResult.relatedInvoiceNumber})
                            </span>
                          )}
                        </div>
                        <div>
                          {creditSaveState === 'saved' && (
                            <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Avoir enregistré</span>
                          )}
                          {creditSaveState === 'already' && (
                            <span style={{
                              background: C.yellowL, color: '#92400E',
                              border: '1px solid #F59E0B', borderRadius: 8,
                              padding: '6px 14px', fontSize: 13, fontWeight: 600,
                            }}>⚠ Avoir déjà enregistré en BDD</span>
                          )}
                          {creditSaveState === null && (
                            <button
                              onClick={handleSaveCredit}
                              disabled={creditSaving}
                              style={{
                                background: C.green, color: C.white,
                                border: 'none', borderRadius: 8,
                                padding: '9px 18px', fontWeight: 700,
                                fontSize: 13.5, cursor: creditSaving ? 'wait' : 'pointer',
                                opacity: creditSaving ? 0.7 : 1,
                              }}
                            >
                              {creditSaving ? '⏳ Enregistrement…' : "💾 Enregistrer l'avoir"}
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: C.grey }}>
                              {['N° Commande', 'Date', 'N° Suivi', 'Montant HT colis', 'Avoir total HT (déduit)'].map(h => (
                                <th key={h} style={{
                                  padding: '10px 12px', textAlign: 'left',
                                  fontWeight: 700, color: C.dark, fontSize: 12,
                                  borderBottom: `2px solid ${C.greyB}`,
                                }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {creditOrders.map((o, i) => (
                              <tr key={i} style={{
                                background: i % 2 === 0 ? C.white : C.grey,
                                borderBottom: `1px solid ${C.greyB}`,
                              }}>
                                <td style={{ padding: '9px 12px', fontWeight: 600, color: C.dark }}>
                                  {o.order_id
                                    ? <a href={`/orders/${o.order_id}`} target="_blank" rel="noreferrer" style={{ color: C.accent, textDecoration: 'none', fontWeight: 700 }}>{o.order_id}</a>
                                    : <span style={{ color: C.greyT }}>—</span>}
                                </td>
                                <td style={{ padding: '9px 12px', color: C.greyT }}>{o.date || '—'}</td>
                                <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, color: C.greyT }}>{o.tracking}</td>
                                <td style={{ padding: '9px 12px' }}>{fmtEur(o.amount_ht)}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 800, color: C.red }}>
                                  {o.amount_ht != null ? fmtEur(getCreditAmount(o)) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                              <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>TOTAL AVOIR</td>
                              <td style={{ padding: '10px 12px', fontWeight: 800, color: C.red, fontSize: 15 }}>
                                {fmtEur(creditOrders.reduce((s, o) => s + (o.amount_ht != null ? getCreditAmount(o) : 0), 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Historique des avoirs enregistrés */}
                  <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>Avoirs Chronopost enregistrés.</p>
                    <button onClick={loadCreditsHistory} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>
                      ↻ Actualiser
                    </button>
                  </div>
                  {creditsHistoryLoading ? (
                    <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
                  ) : creditsHistory.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucun avoir enregistré pour l'instant.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: C.grey }}>
                            {['N° Avoir', 'Date', 'Facture liée', 'Lignes', 'Total HT', 'Enregistré le', ''].map(h => (
                              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {creditsHistory.map((c, i) => (
                            <tr key={c.credit_number} style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}` }}>
                              <td style={{ padding: '9px 12px', fontWeight: 700, color: C.primary }}>{c.credit_number}</td>
                              <td style={{ padding: '9px 12px', color: C.greyT }}>{c.credit_date || '—'}</td>
                              <td style={{ padding: '9px 12px', color: C.greyT }}>{c.related_invoice_number || '—'}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>{c.lines_count}</td>
                              <td style={{ padding: '9px 12px', fontWeight: 700, color: C.red }}>{fmtEur(c.total_ht)}</td>
                              <td style={{ padding: '9px 12px', color: C.greyT, fontSize: 12 }}>{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                              <td style={{ padding: '9px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <button onClick={e => handleDownloadCreditPdf(c, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, marginRight: 4 }}>⬇️</button>
                                <button onClick={e => handleDeleteCredit(c, e)} title="Supprimer l'avoir" style={{ background: 'none', border: `1px solid #FECACA`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, color: C.red }}>🗑️</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB HISTORIQUE */}
              {tab === 'historique' && (
                <div style={{ padding: 20 }}>
                  <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>
                      Factures Chronopost enregistrées — évolution des coûts transporteur.
                    </p>
                    <button onClick={loadHistory} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>
                      ↻ Actualiser
                    </button>
                  </div>

                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
                  ) : history.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>
                      Aucune facture enregistrée. Analysez et sauvegardez votre première facture.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: C.grey }}>
                            {[
                              { label: 'N° Facture', key: 'invoice_number' },
                              { label: 'Date', key: 'date' },
                              { label: 'Colis', key: 'total_parcels', align: 'center' },
                              { label: 'Cmdés trouvées', key: 'parcels_matched', align: 'center' },
                              { label: 'Poids OK', key: 'weight_ok', align: 'center' },
                              { label: 'Écarts', key: 'weight_ecart', align: 'center' },
                              { label: 'Total HT', key: 'total_ht' },
                              { label: 'Suppléments HT', key: 'supplements_total' },
                              { label: 'Tarifs', key: 'tariffs_applied_at', align: 'center' },
                              { label: 'Enregistrée le', key: 'created_at' },
                              { label: '' },
                            ].map(({ label, key, align }) => (
                              <SortTh key={label || 'actions'} label={label} align={align} sortKey={key} currentSort={historySort} onSort={toggleHistorySort} />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedHistory.map((inv, i) => (
                            <tr key={inv.id}
                              onClick={() => handleLoadFromHistory(inv)}
                              style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer', transition: 'background .1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
                            >
                              <td style={{ padding: '9px 12px', fontWeight: 700, color: C.primary }}>🔍 {inv.invoice_number}</td>
                              <td style={{ padding: '9px 12px', color: C.greyT }}>{inv.invoice_date || '—'}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>{inv.total_parcels}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center', color: C.accent }}>{inv.parcels_matched}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center', color: C.green }}>{inv.weight_ok ?? '—'}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center', color: inv.weight_ecart > 0 ? C.red : C.dark }}>{inv.weight_ecart ?? '—'}</td>
                              <td style={{ padding: '9px 12px', fontWeight: 600 }}>{fmtEur(inv.total_ht)}</td>
                              <td style={{ padding: '9px 12px', color: C.orange }}>{fmtEur(inv.supplements_total)}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                {inv.tariffs_applied_at
                                  ? <Badge label="✓ Appliqués" color={C.green} bg={C.greenL} />
                                  : <Badge label="Non appliqués" color={C.greyT} bg={C.greyB} />}
                              </td>
                              <td style={{ padding: '9px 12px', color: C.greyT, fontSize: 12 }}>
                                {new Date(inv.created_at).toLocaleDateString('fr-FR')}
                              </td>
                              <td style={{ padding: '9px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <button onClick={e => handleDownloadPdf(inv, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, marginRight: 4 }}>⬇️</button>
                                <button onClick={e => handleDeleteInvoice(inv, e)} title="Supprimer la facture" style={{ background: 'none', border: `1px solid #FECACA`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, color: C.red }}>🗑️</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: `2px solid ${C.greyB}`, background: C.grey }}>
                            <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL ({history.length} factures)</td>
                            <td colSpan={6} />
                            <td style={{ padding: '10px 12px', fontWeight: 800, color: C.primary }}>
                              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.total_ht || 0), 0))}
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: C.orange }}>
                              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.supplements_total || 0), 0))}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── TAB TOTAUX */}
              {tab === 'totaux' && (
                <TotalsView totals={totals} totalsLoading={totalsLoading} loadTotals={loadTotals} totalsByPeriod={totalsByPeriod} />
              )}
            </div>
          </>
        )}

        {/* Historique / Totaux accessibles même sans facture chargée */}
        {!result && (
          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, marginTop: 8 }}>
            <div style={{ borderBottom: `1px solid ${C.greyB}`, padding: '0 16px', display: 'flex' }}>
              <TabBtn label="Historique des factures" active={homeTab === 'historique'} onClick={() => setHomeTab('historique')} badge={history.length} />
              <TabBtn label="Totaux" active={homeTab === 'totaux'} onClick={() => setHomeTab('totaux')} />
            </div>
            {homeTab === 'totaux' && (
              <TotalsView totals={totals} totalsLoading={totalsLoading} loadTotals={loadTotals} totalsByPeriod={totalsByPeriod} />
            )}
            {homeTab === 'historique' && (
            <div style={{ padding: 20 }}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: 20, color: C.greyT }}>Chargement…</div>
              ) : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>
                  Aucune facture enregistrée pour l'instant.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: C.grey }}>
                        {[
                          { label: 'N° Facture', key: 'invoice_number' },
                          { label: 'Date', key: 'date' },
                          { label: 'Colis', key: 'total_parcels', align: 'center' },
                          { label: 'Total HT', key: 'total_ht' },
                          { label: 'Suppléments HT', key: 'supplements_total' },
                          { label: 'Tarifs', key: 'tariffs_applied_at', align: 'center' },
                          { label: 'Enregistrée le', key: 'created_at' },
                          { label: '' },
                        ].map(({ label, key, align }) => (
                          <SortTh key={label || 'actions'} label={label} align={align} sortKey={key} currentSort={historySort} onSort={toggleHistorySort} style={{ padding: '9px 12px' }} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHistory.map((inv, i) => (
                        <tr key={inv.id}
                          onClick={() => handleLoadFromHistory(inv)}
                          style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
                        >
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: C.primary }}>🔍 {inv.invoice_number}</td>
                          <td style={{ padding: '8px 12px', color: C.greyT }}>{inv.invoice_date || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{inv.total_parcels}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{fmtEur(inv.total_ht)}</td>
                          <td style={{ padding: '8px 12px', color: C.orange }}>{fmtEur(inv.supplements_total)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            {inv.tariffs_applied_at
                              ? <Badge label="✓ Appliqués" color={C.green} bg={C.greenL} />
                              : <Badge label="Non appliqués" color={C.greyT} bg={C.greyB} />}
                          </td>
                          <td style={{ padding: '8px 12px', color: C.greyT, fontSize: 12 }}>{new Date(inv.created_at).toLocaleDateString('fr-FR')}</td>
                          <td style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button onClick={e => handleDownloadPdf(inv, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, marginRight: 4 }}>⬇️</button>
                            <button onClick={e => handleDeleteInvoice(inv, e)} title="Supprimer" style={{ background: 'none', border: `1px solid #FECACA`, borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, color: C.red }}>🗑️</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>

      {/* Tooltip flottant */}
      {tooltip && (
        <div style={{
          position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 9999,
          background: C.dark, color: C.white, borderRadius: 8,
          padding: '8px 12px', fontSize: 12.5, fontWeight: 500,
          maxWidth: 420, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          pointerEvents: 'none', whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
        }}>
          {tooltip.text}
        </div>
      )}
    </AppShell>
  );
}
