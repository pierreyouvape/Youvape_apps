import { useState, useRef, useContext, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#D97706', accentL: '#FEF3C7', accent: '#B45309',
  green: '#16A34A', greenL: '#DCFCE7',
  red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFF7ED',
  blue: '#2563EB', blueL: '#DBEAFE',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280',
  dark: '#111827', white: '#FFFFFF',
};

function fmtKg(v) { return v !== null && v !== undefined && v !== '—' ? `${parseFloat(v).toFixed(3)} kg` : '—'; }
function fmtEur(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} €`;
}
function fmtDiff(g) {
  if (g === null || g === undefined) return '—';
  return `${g > 0 ? '+' : ''}${g} g`;
}
function diffBg(g) {
  if (g === null || g === undefined) return C.white;
  if (Math.abs(g) <= 20) return C.greenL;
  if (Math.abs(g) > 200) return C.redL;
  return C.white;
}
function diffColor(g) {
  if (g === null || g === undefined) return C.greyT;
  if (Math.abs(g) <= 20) return C.green;
  if (Math.abs(g) > 200) return C.red;
  return C.dark;
}

function StatCard({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: 110, background: C.white, borderRadius: 10, border: `1px solid ${C.greyB}`, padding: '14px 16px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.primary }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.greyT, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function TabBtn({ label, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{ padding: '10px 18px', border: 'none', cursor: 'pointer', fontWeight: active ? 700 : 500, fontSize: 13, color: active ? C.accent : C.greyT, borderBottom: active ? `2.5px solid ${C.accent}` : '2.5px solid transparent', background: 'transparent', display: 'flex', alignItems: 'center', gap: 7 }}>
      {label}
      {badge != null && <span style={{ background: active ? C.accent : C.greyB, color: active ? C.white : C.greyT, borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{badge}</span>}
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

function TotalsView({ totals, totalsLoading, loadTotals, totalsByPeriod }) {
  const { months, years, byPaysYear, yearCols, monthCols, byPaysMonth } = totalsByPeriod;
  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>
          Total payé à Colissimo (port + suppléments HT), par mois et par année.
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
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.greyT }}>{m.colis.toLocaleString('en-US').replace(/,/g, ' ')}</td>
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
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Coût des colis HT par pays de destination (hors suppléments globaux). Colis = total sur la période.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><Th label="Pays" /><Th label="Colis" align="right" />{yearCols.map(y => <Th key={y} label={y} align="right" />)}<Th label="Total HT" align="right" /></tr></thead>
                  <tbody>{byPaysYear.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></Td>
                      <Td align="right" color={C.greyT}>{fmtColis(r.totalColis)}</Td>
                      {yearCols.map(y => <Td key={y} align="right">{r.ym[y] ? fmtEur(r.ym[y].ht) : '—'}</Td>)}
                      <Td align="right" bold color={C.accent}>{fmtEur(r.total)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <Td bold>Total</Td>
                    <Td align="right" bold>{fmtColis(byPaysYear.reduce((s, r) => s + r.totalColis, 0))}</Td>
                    {yearCols.map(y => <Td key={y} align="right" bold>{fmtEur(byPaysYear.reduce((s, r) => s + (r.ym[y]?.ht || 0), 0))}</Td>)}
                    <Td align="right" bold color={C.accent}>{fmtEur(byPaysYear.reduce((s, r) => s + r.total, 0))}</Td>
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
                  <thead><tr>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, position: 'sticky', left: 0, zIndex: 2, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>Pays</th>
                    {monthCols.map(mc => <Th key={mc.key} label={mc.label} align="right" />)}<Th label="Total" align="right" />
                  </tr></thead>
                  <tbody>{byPaysMonth.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${C.greyB}`, background: i % 2 === 0 ? C.white : C.grey, position: 'sticky', left: 0, zIndex: 1, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></td>
                      {monthCols.map(mc => <Td key={mc.key} align="right">{r.bm[mc.key] ? fmtColis(r.bm[mc.key]) : '—'}</Td>)}
                      <Td align="right" bold color={C.accent}>{fmtColis(r.total)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, background: C.white, borderTop: `2px solid ${C.greyB}`, position: 'sticky', left: 0, zIndex: 1, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>Total</td>
                    {monthCols.map(mc => <Td key={mc.key} align="right" bold>{fmtColis(byPaysMonth.reduce((s, r) => s + (r.bm[mc.key] || 0), 0))}</Td>)}
                    <Td align="right" bold color={C.accent}>{fmtColis(byPaysMonth.reduce((s, r) => s + r.total, 0))}</Td>
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
                  <thead><tr><Th label="Pays" />{yearCols.map(y => <Th key={y} label={y} align="right" />)}<Th label="Total" align="right" /></tr></thead>
                  <tbody>{byPaysYear.map((r, i) => (
                    <tr key={r.code} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{countryName(r.code)} <span style={{ color: C.greyT, fontWeight: 400, fontSize: 11.5 }}>{r.code !== '—' ? r.code : ''}</span></Td>
                      {yearCols.map(y => <Td key={y} align="right">{r.ym[y] ? fmtColis(r.ym[y].colis) : '—'}</Td>)}
                      <Td align="right" bold color={C.accent}>{fmtColis(r.totalColis)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <Td bold>Total</Td>
                    {yearCols.map(y => <Td key={y} align="right" bold>{fmtColis(byPaysYear.reduce((s, r) => s + (r.ym[y]?.colis || 0), 0))}</Td>)}
                    <Td align="right" bold color={C.accent}>{fmtColis(byPaysYear.reduce((s, r) => s + r.totalColis, 0))}</Td>
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

function Th({ label, align = 'left', sortKey, currentSort, onSort }) {
  const sortable = !!sortKey && !!onSort;
  const active = sortable && currentSort?.key === sortKey;
  return (
    <th
      onClick={sortable ? () => onSort(sortKey) : undefined}
      style={{
        padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.dark, fontSize: 11.5,
        borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
        cursor: sortable ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {label}{sortable && (active ? (currentSort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇕')}
    </th>
  );
}

// Tri de l'historique des factures
const HISTORY_SORTERS = {
  invoice_number:        inv => inv.invoice_number || '',
  period:                inv => { const [d, m, y] = (inv.period_start || '').split('/'); return (y && m && d) ? `${y}${m}${d}` : ''; },
  total_parcels:         inv => inv.total_parcels ?? 0,
  parcels_matched:       inv => inv.parcels_matched ?? 0,
  weight_ok:             inv => inv.weight_ok ?? 0,
  weight_ecart:          inv => inv.weight_ecart ?? 0,
  total_ht:              inv => parseFloat(inv.total_ht ?? 0),
  supplements_total:     inv => parseFloat(inv.supplements_total ?? 0),
  indemnizations_total:  inv => parseFloat(inv.indemnizations_total ?? 0),
  tariffs_applied_at:    inv => inv.tariffs_applied_at ? 1 : 0,
  created_at:            inv => new Date(inv.created_at).getTime(),
};

function sortHistory(history, sort) {
  if (!sort?.key) return history;
  const getValue = HISTORY_SORTERS[sort.key];
  const sorted = [...history].sort((a, b) => {
    const va = getValue(a), vb = getValue(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function Td({ children, align = 'left', bg, color, bold }) {
  return <td style={{ padding: '8px 12px', textAlign: align, background: bg, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13 }}>{children}</td>;
}

export default function ColissimoApp() {
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
  const [search, setSearch] = useState('');
  const [filterPoids, setFilterPoids] = useState('all');
  const [currentFile, setCurrentFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySort, setHistorySort] = useState(null); // { key, dir: 'asc' | 'desc' }
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
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

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/colissimo/history`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setHistory(data.invoices);
    } catch { /* silently fail */ }
    finally { setHistoryLoading(false); }
  }

  async function loadTotals() {
    setTotalsLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/colissimo/totals`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setTotals(data);
    } catch { /* silently fail */ }
    finally { setTotalsLoading(false); }
  }

  useEffect(() => { loadHistory(); loadTotals(); }, []);

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
    for (const inv of (totals?.invoices || [])) {
      const parts = (inv.period_start || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      const total = parseFloat(inv.total_ht || 0);
      if (!monthMap[monthKey]) monthMap[monthKey] = { ht: 0, colis: 0 };
      monthMap[monthKey].ht += total;
      monthMap[monthKey].colis += parseInt(inv.total_parcels || 0, 10);
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

  // Charge une facture depuis l'historique BDD et la réaffiche comme si elle venait d'être analysée
  async function handleLoadFromHistory(inv) {
    setLoading(true); setError(null); setCurrentFile(null); setApplyResult(null); setApplyProgress(0);
    try {
      const { data } = await axios.get(`${API_URL}/colissimo/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error);

      const detailByTracking = {};
      for (const p of (data.invoice.parcels_detail || [])) detailByTracking[p.tracking] = p;

      const parcels = (data.parcels || []).map(p => {
        const det = detailByTracking[p.tracking] || {};
        return {
          tracking: p.tracking,
          order_id: p.order_id,
          decarbonation_unit: det.decarbonation_unit ?? null,
          date: p.date,
          weight_colissimo: p.weight_carrier != null ? parseFloat(p.weight_carrier) : null,
          weight_bdd:       p.weight_bdd    != null ? parseFloat(p.weight_bdd)    : null,
          diff_g: p.diff_g,
          port_brut: det.port_brut ?? null,
          tx_remise: det.tx_remise ?? null,
          remise_ht: det.remise_ht ?? null,
          port_net:  det.port_net ?? null,
          cae_ht:    det.cae_ht ?? null,
          total_ht:  p.amount_ht != null ? parseFloat(p.amount_ht) : (det.total_ht ?? null),
        };
      });
      const supplements = (data.supplements || []).map(s => ({
        tracking: s.tracking,
        label: s.description,
        amount: s.amount_ht != null ? parseFloat(s.amount_ht) : null,
      }));
      const indemnizations = (data.invoice.indemnizations || []).map(i => ({
        date: i.date, reference: i.reference, tracking: i.tracking, label: i.label, amount: i.amount, type: i.type,
      }));
      const inv2 = data.invoice;
      const rebuilt = {
        success: true,
        invoiceNumber: inv2.invoice_number,
        periodStart: inv2.period_start,
        periodEnd: inv2.period_end,
        accountNumber: inv2.account_number,
        parcels, supplements, indemnizations,
        globalSummary: {
          portBrut: inv2.port_brut != null ? parseFloat(inv2.port_brut) : null,
          remise:   inv2.remise    != null ? parseFloat(inv2.remise)    : null,
          portNet:  inv2.port_net  != null ? parseFloat(inv2.port_net)  : null,
          cae:      inv2.cae       != null ? parseFloat(inv2.cae)       : null,
        },
        stats: {
          total_parcels: inv2.total_parcels,
          parcels_matched: inv2.parcels_matched,
          parcels_unmatched: parcels.filter(p => !p.order_id).length,
          weight_ok: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) <= 20).length,
          weight_ecart: parcels.filter(p => p.diff_g !== null && Math.abs(p.diff_g) > 200).length,
          supplements_count: supplements.length,
          supplements_total: inv2.supplements_total != null ? parseFloat(inv2.supplements_total) : 0,
          indemnizations_total: inv2.indemnizations_total != null ? parseFloat(inv2.indemnizations_total) : 0,
        },
        _fromHistory: true,
      };
      setResult(rebuilt);
      setSaveState('already');
      setCurrentInvoiceId(inv2.id);
      setTariffsAppliedAt(inv2.tariffs_applied_at || null);
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
    setSearch('');
    setFilterPoids('all');
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
      const { data } = await axios.get(`${API_URL}/colissimo/search-order`, {
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
        setSearch(String(r.order_id || r.tracking || q));
        setFilterPoids('all');
        setTab('tarifs');
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
      setSearch(String(r.order_id || r.tracking || globalSearch.trim()));
      setFilterPoids('all');
      setTab('tarifs');
    } catch (e) {
      setGlobalSearchError(e.message);
    } finally { setGlobalSearchLoading(false); }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify(result));
      if (currentFile) fd.append('pdf', currentFile);
      const { data } = await axios.post(`${API_URL}/colissimo/save`, fd, { headers: { Authorization: `Bearer ${token}` } });
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
      await axios.delete(`${API_URL}/colissimo/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (result?.invoiceNumber === inv.invoice_number) {
        setResult(null); setSaveState(null); setCurrentFile(null);
        setCurrentInvoiceId(null); setTariffsAppliedAt(null); setApplyResult(null);
      }
      loadHistory();
      loadTotals();
    } catch {
      setError('Erreur lors de la suppression');
    }
  }

  function handleDownloadPdf(inv, e) {
    e.stopPropagation();
    fetch(`${API_URL}/colissimo/history/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Colissimo_${inv.invoice_number}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError('PDF non disponible pour cette facture'));
  }

  async function handleApplyTariffs() {
    const matchedParcels = parcels.filter(p => p.order_id && p.total_ht != null);
    if (!matchedParcels.length) { setError('Aucun colis avec un tarif et une commande identifiée.'); return; }

    const ok = window.confirm(
      `Mettre à jour le coût livraison HT pour ${matchedParcels.length} commande(s) ?\n\nCette action remplace le coût actuel par le Total HT de la facture Colissimo, majoré des suppléments correspondants et de la participation décarbonation (0,05€/colis).`
    );
    if (!ok) return;

    setApplying(true); setApplyResult(null); setApplyProgress(5);
    let prog = 5;
    const timer = setInterval(() => {
      prog = prog < 85 ? prog + Math.random() * 8 : prog + 0.5;
      setApplyProgress(Math.min(prog, 90));
    }, 300);

    try {
      // Suppléments rattachés à un colis (via le tracking) ajoutés à la commande correspondante.
      // La "Participation à la décarbonation" n'apparaît que dans le récap global de la facture
      // (jamais par colis) mais s'applique à 100% des colis — son montant unitaire est reporté
      // sur chaque colis lors de l'analyse (p.decarbonation_unit) et ajouté ici à toutes les commandes.
      const supplByTracking = {};
      for (const s of supplements) {
        if (s.tracking) supplByTracking[s.tracking] = (supplByTracking[s.tracking] || 0) + (s.amount || 0);
      }

      const tariffs = matchedParcels.map(p => ({
        order_id: p.order_id,
        tarif: p.total_ht + (supplByTracking[p.tracking] || 0) + (p.decarbonation_unit || 0),
      }));
      const { data } = await axios.post(`${API_URL}/colissimo/apply-tariffs`, { tariffs, invoiceId: currentInvoiceId }, {
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
      setError(e.response?.data?.error || 'Délai dépassé — réessaie');
    } finally { setApplying(false); }
  }

  async function handleZip(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setError('Fichier ZIP requis.'); return; }
    setImportingZip(true); setImportResult(null); setError(null);
    try {
      const fd = new FormData(); fd.append('zip', file);
      const { data } = await axios.post(`${API_URL}/colissimo/import-zip`, fd, { headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
      if (!data.success) throw new Error(data.error);
      setImportResult(data); loadHistory(); loadTotals();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setImportingZip(false); if (zipRef.current) zipRef.current.value = ''; }
  }

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('Fichier PDF requis.'); return; }
    setCurrentFile(file); setError(null); setResult(null); setSaveState(null); setApplyResult(null); setApplyProgress(0); setCurrentInvoiceId(null); setTariffsAppliedAt(null); setLoading(true);
    try {
      const fd = new FormData(); fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/colissimo/analyze`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setResult(data); setTab('poids');
      if (data.invoiceNumber) {
        const alreadySaved = history.some(h => h.invoice_number === data.invoiceNumber);
        if (alreadySaved) setSaveState('already');
      }
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }

  async function handleExport() {
    if (!currentFile) return;
    setExporting(true);
    try {
      const fd = new FormData(); fd.append('pdf', currentFile);
      const resp = await axios.post(`${API_URL}/colissimo/export-excel`, fd, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url; a.download = result?.invoiceNumber ? `Colissimo_${result.invoiceNumber}.xlsx` : 'Colissimo_analyse.xlsx';
      a.click(); URL.revokeObjectURL(url);
    } catch { setError('Erreur export Excel.'); }
    finally { setExporting(false); }
  }

  const parcels = result?.parcels || [];
  const supplements = result?.supplements || [];
  const indemnizations = result?.indemnizations || [];
  const stats = result?.stats || {};
  const gs = result?.globalSummary || {};

  const filteredParcels = parcels.filter(p => {
    if (search && !String(p.order_id || '').includes(search) && !(p.tracking||'').toLowerCase().includes(search.toLowerCase())) return false;
    if (filterPoids === 'ok' && (p.diff_g === null || Math.abs(p.diff_g) > 20)) return false;
    if (filterPoids === 'ecart' && (p.diff_g === null || Math.abs(p.diff_g) <= 20)) return false;
    if (filterPoids === 'unmatched' && p.order_id) return false;
    return true;
  });

  return (
    <AppShell currentPath="/colissimo">
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 20px' }}>

        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: C.dark, margin: 0 }}>Analyse facture Colissimo</h1>
          <p style={{ color: C.greyT, margin: '5px 0 0', fontSize: 13 }}>
            Importe une facture PDF Colissimo pour comparer les poids, vérifier les tarifs et lister les suppléments.
          </p>
        </div>

        {/* ── RECHERCHE GLOBALE D'UNE COMMANDE */}
        <div style={{ marginBottom: 22 }}>
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

        {/* Upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? C.accent : C.greyB}`, borderRadius: 14, background: dragging ? C.accentL : C.grey, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 22, transition: 'all .15s' }}
        >
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 36, marginBottom: 10 }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: C.dark }}>{loading ? 'Analyse en cours…' : 'Déposer la facture PDF ici'}</div>
          <div style={{ color: C.greyT, fontSize: 12.5, marginTop: 5 }}>ou cliquer pour sélectionner</div>
          {currentFile && !loading && <div style={{ marginTop: 8, color: C.accent, fontSize: 12.5, fontWeight: 600 }}>📎 {currentFile.name}</div>}
          {loading && <div style={{ marginTop: 12 }}><div style={{ display: 'inline-block', width: 26, height: 26, border: `3px solid ${C.accentL}`, borderTop: `3px solid ${C.accent}`, borderRadius: '50%', animation: 'spin .8s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <input ref={zipRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={e => handleZip(e.target.files[0])} />
          <button onClick={() => zipRef.current?.click()} disabled={importingZip}
            style={{ background: C.white, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: importingZip ? 'wait' : 'pointer', opacity: importingZip ? .7 : 1 }}>
            {importingZip ? '⏳ Import en cours…' : '📦 Importer un ZIP de factures'}
          </button>
          <span style={{ color: C.greyT, fontSize: 12.5 }}>Toutes les factures PDF du ZIP sont analysées et enregistrées d'un coup (doublons ignorés).</span>
        </div>
        {importResult && (
          <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 10, padding: '11px 15px', color: C.dark, fontSize: 13, marginBottom: 18 }}>
            ✓ Import terminé : <strong>{importResult.imported}</strong> ajoutée(s){importResult.already > 0 && <>, {importResult.already} déjà présente(s)</>}{importResult.failed?.length > 0 && <>, <span style={{ color: C.red }}>{importResult.failed.length} en échec</span></>} sur {importResult.total}.
            {importResult.failed?.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: C.red }}>{importResult.failed.map((f, i) => <li key={i}>{f.name} — {f.error}</li>)}</ul>}
          </div>
        )}

        {error && <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 10, padding: '11px 15px', color: C.red, fontSize: 13, marginBottom: 18 }}>⚠️ {error}</div>}

        {result && (
          <>
            {/* Meta + export */}
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <button onClick={handleBackToHome} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: C.greyT, cursor: 'pointer', marginRight: 12 }}>
                  ← Retour à l'accueil
                </button>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>Facture {result.invoiceNumber}</span>
                {result.periodStart && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>{result.periodStart} → {result.periodEnd}</span>}
                {result.accountNumber && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>Compte n° {result.accountNumber}</span>}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {saveState === 'saved' && (
                  <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Facture enregistrée</span>
                )}
                {saveState === 'already' && (
                  <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>
                    ⚠ Facture déjà enregistrée en BDD
                  </span>
                )}
                {saveState === null && (
                  <button onClick={handleSave} disabled={saving} style={{ background: C.green, color: C.white, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: saving ? .7 : 1 }}>
                    {saving ? '⏳ Enregistrement…' : '💾 Enregistrer la facture'}
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 230 }}>
                    {applyResult && (
                      <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>
                        ✓ {applyResult.updated} commande(s) mise(s) à jour
                        {applyResult.skipped > 0 && ` (${applyResult.skipped} ignorées)`}
                      </span>
                    )}
                    {!applyResult && tariffsAppliedAt && (
                      <span style={{ background: '#FEF9E7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                        ✓ Tarifs déjà appliqués le {new Date(tariffsAppliedAt).toLocaleString('fr-FR')}
                      </span>
                    )}
                    <button
                      onClick={handleApplyTariffs}
                      disabled={applying || !parcels.filter(p => p.order_id && p.total_ht != null).length}
                      title="Remplace le Coût livraison HT de chaque commande par le Total HT indiqué sur la facture"
                      style={{ background: '#7C3AED', color: C.white, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: applying ? 'wait' : 'pointer', opacity: applying ? .85 : 1, width: '100%' }}
                    >
                      {applying
                        ? `⏳ Mise à jour… ${Math.round(applyProgress)}%`
                        : (tariffsAppliedAt ? '🔄 Réappliquer les tarifs aux commandes' : '🔄 Appliquer les tarifs aux commandes')}
                    </button>
                    {applying && (
                      <div style={{ height: 6, background: C.greyB, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #7C3AED, #A78BFA)', width: `${applyProgress}%`, transition: 'width 0.3s ease' }} />
                      </div>
                    )}
                  </div>
                <button onClick={handleExport} disabled={exporting} style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? .7 : 1 }}>
                  {exporting ? '⏳ Export…' : '⬇️ Télécharger Excel'}
                </button>
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
              <StatCard value={stats.total_parcels} label="Colis facturés" />
              <StatCard value={stats.parcels_matched} label="Commandes trouvées" color={C.blue} />
              <StatCard value={stats.weight_ok} label="Poids OK (≤20g)" color={C.green} />
              <StatCard value={stats.weight_ecart} label="Écarts >200g" color={C.red} />
              <StatCard value={stats.supplements_count} label="Suppléments" color={C.orange} />
              <StatCard value={fmtEur(stats.supplements_total || 0)} label="Total suppl. HT" color={C.orange} />
              <StatCard value={fmtEur(stats.indemnizations_total || 0)} label="Indemnisations" color={C.blue} />
            </div>

            {/* Tabs */}
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', borderBottom: `1px solid ${C.greyB}`, padding: '0 14px', flexWrap: 'wrap' }}>
                <TabBtn label="Comparaison poids" active={tab==='poids'}   onClick={() => setTab('poids')}    badge={parcels.length} />
                <TabBtn label="Tarifs"            active={tab==='tarifs'}  onClick={() => setTab('tarifs')}   badge={parcels.length} />
                <TabBtn label="Suppléments"       active={tab==='suppl'}   onClick={() => setTab('suppl')}    badge={supplements.length} />
                <TabBtn label="Indemnisations"    active={tab==='indemn'}  onClick={() => setTab('indemn')}   badge={indemnizations.length} />
                <TabBtn label="Résumé global"     active={tab==='resume'}  onClick={() => setTab('resume')} />
                <TabBtn label="Historique"        active={tab==='historique'} onClick={() => setTab('historique')} badge={history.length} />
              </div>

              {/* ── POIDS */}
              {tab === 'poids' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder="Rechercher commande / suivi…" value={search} onChange={e => setSearch(e.target.value)}
                      style={{ padding: '7px 11px', border: `1px solid ${C.greyB}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 180 }} />
                    {[['all','Tous'],['ok','✓ OK'],['ecart','⚠ Écart'],['unmatched','❓ Non trouvé']].map(([k,l]) => (
                      <button key={k} onClick={() => setFilterPoids(k)} style={{ padding: '6px 13px', border: `1px solid ${filterPoids===k ? C.accent : C.greyB}`, borderRadius: 8, background: filterPoids===k ? C.accentL : C.white, color: filterPoids===k ? C.accent : C.dark, fontWeight: filterPoids===k ? 700 : 500, fontSize: 12.5, cursor: 'pointer' }}>{l}</button>
                    ))}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr><Th label="N° Commande" /><Th label="Date" /><Th label="N° Suivi" /><Th label="Poids BDD" align="right" /><Th label="Poids Colissimo" align="right" /><Th label="Écart" align="right" /></tr></thead>
                      <tbody>
                        {filteredParcels.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Aucun résultat</td></tr>}
                        {filteredParcels.map((p, i) => (
                          <tr key={i} style={{ background: i%2===0 ? C.white : C.grey }}>
                            <Td bold>{p.order_id ?? <span style={{ color: C.greyT }}>—</span>}</Td>
                            <Td color={C.greyT}>{p.date || '—'}</Td>
                            <Td><span style={{ fontFamily: 'monospace', fontSize: 12, color: C.greyT }}>{p.tracking}</span></Td>
                            <Td align="right">{fmtKg(p.weight_bdd)}</Td>
                            <Td align="right" bold>{fmtKg(p.weight_colissimo)}</Td>
                            <Td align="right" bg={diffBg(p.diff_g)} color={diffColor(p.diff_g)} bold>{fmtDiff(p.diff_g)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ color: C.greyT, fontSize: 12, marginTop: 8 }}>{filteredParcels.length} ligne(s) sur {parcels.length}</div>
                </div>
              )}

              {/* ── TARIFS */}
              {tab === 'tarifs' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder="Rechercher commande / suivi…" value={search} onChange={e => setSearch(e.target.value)}
                      style={{ padding: '7px 11px', border: `1px solid ${C.greyB}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 180 }} />
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>
                        <Th label="Commande" /><Th label="Date" /><Th label="N° Suivi" />
                        <Th label="Port brut" align="right" /><Th label="Remise" align="right" /><Th label="Port net" align="right" />
                        <Th label="CAE" align="right" /><Th label="Total HT" align="right" />
                      </tr></thead>
                      <tbody>
                        {filteredParcels.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Aucun résultat</td></tr>}
                        {filteredParcels.map((p, i) => (
                          <tr key={i} style={{ background: i%2===0 ? C.white : C.grey }}>
                            <Td bold>{p.order_id ?? <span style={{ color: C.greyT }}>—</span>}</Td>
                            <Td color={C.greyT}>{p.date || '—'}</Td>
                            <Td><span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.greyT }}>{p.tracking}</span></Td>
                            <Td align="right">{fmtEur(p.port_brut)}</Td>
                            <Td align="right" color={C.red}>{p.remise_ht != null ? fmtEur(p.remise_ht) : '—'}</Td>
                            <Td align="right">{fmtEur(p.port_net)}</Td>
                            <Td align="right" color={C.greyT}>{fmtEur(p.cae_ht)}</Td>
                            <Td align="right" bold>{fmtEur(p.total_ht)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredParcels.length > 0 && (
                    <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.dark }}>
                      Total HT : <span style={{ color: C.accent }}>{fmtEur(filteredParcels.reduce((s,p) => s+(p.total_ht||0), 0))}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── SUPPLÉMENTS */}
              {tab === 'suppl' && (
                <div style={{ padding: 18 }}>
                  {supplements.length === 0
                    ? <div style={{ textAlign: 'center', padding: 36, color: C.greyT }}>Aucun supplément détecté.</div>
                    : <>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr><Th label="N° Suivi" /><Th label="Commande" /><Th label="Type" /><Th label="Montant HT" align="right" /></tr></thead>
                            <tbody>
                              {supplements.map((s, i) => (
                                <tr key={i} style={{ background: i%2===0 ? '#FFFBF5' : C.white }}>
                                  <Td><span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.greyT }}>{s.tracking}</span></Td>
                                  <Td bold>{(result?.parcels?.find(p=>p.tracking===s.tracking)?.order_id) ?? '—'}</Td>
                                  <Td><span style={{ background: C.orangeL, color: C.orange, padding: '2px 8px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>{s.label}</span></Td>
                                  <Td align="right" bold color={C.orange}>{fmtEur(s.amount)}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.orange }}>
                          Total suppléments HT : {fmtEur(supplements.reduce((s,x) => s+(x.amount||0),0))}
                        </div>
                      </>
                  }
                </div>
              )}

              {/* ── INDEMNISATIONS */}
              {tab === 'indemn' && (
                <div style={{ padding: 18 }}>
                  {indemnizations.length === 0
                    ? <div style={{ textAlign: 'center', padding: 36, color: C.greyT }}>Aucune indemnisation sur cette facture.</div>
                    : <>
                        <p style={{ color: C.greyT, fontSize: 12.5, margin: '0 0 12px' }}>
                          Les indemnisations sont des <strong>remboursements</strong> de Colissimo (retards, pertes). Le montant est négatif = crédit.
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr><Th label="Date" /><Th label="Référence" /><Th label="N° Suivi" /><Th label="Libellé" /><Th label="Montant HT" align="right" /><Th label="Type" /></tr></thead>
                            <tbody>
                              {indemnizations.map((ind, i) => (
                                <tr key={i} style={{ background: i%2===0 ? C.blueL.replace('DBEAFE','F0F9FF') : C.white }}>
                                  <Td color={C.greyT}>{ind.date || '—'}</Td>
                                  <Td><span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.greyT }}>{ind.reference || '—'}</span></Td>
                                  <Td><span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.greyT }}>{ind.tracking || '—'}</span></Td>
                                  <Td>{ind.label}</Td>
                                  <Td align="right" bold color={C.blue}>{fmtEur(ind.amount)}</Td>
                                  <Td color={C.greyT}>{ind.type}</Td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.blue }}>
                          Total indemnisations : {fmtEur(indemnizations.reduce((s,i) => s+(i.amount||0),0))}
                        </div>
                      </>
                  }
                </div>
              )}

              {/* ── RÉSUMÉ GLOBAL */}
              {tab === 'resume' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 14 }}>
                    {[
                      { label: 'Colis facturés', value: stats.total_parcels, color: C.dark },
                      { label: 'Commandes identifiées', value: stats.parcels_matched, color: C.blue },
                      { label: 'Port Brut HT', value: gs.portBrut != null ? fmtEur(gs.portBrut) : '—', color: C.dark },
                      { label: 'Remise HT', value: gs.remise != null ? fmtEur(gs.remise) : '—', color: C.red },
                      { label: 'Port Net HT', value: gs.portNet != null ? fmtEur(gs.portNet) : '—', color: C.dark },
                      { label: 'CAE (Énergie)', value: gs.cae != null ? fmtEur(gs.cae) : '—', color: C.greyT },
                      { label: 'Suppléments HT', value: fmtEur(stats.supplements_total || 0), color: C.orange },
                      { label: 'Indemnisations HT', value: fmtEur(stats.indemnizations_total || 0), color: C.blue },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: C.grey, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.greyB}` }}>
                        <div style={{ fontSize: 11.5, color: C.greyT, marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── HISTORIQUE */}
              {tab === 'historique' && (
                <div style={{ padding: 18 }}>
                  <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>
                      Factures Colissimo enregistrées — évolution des coûts transporteur.
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
                          <tr>
                            {[
                              { label: 'N° Facture', key: 'invoice_number' },
                              { label: 'Période', key: 'period' },
                              { label: 'Colis', key: 'total_parcels', align: 'right' },
                              { label: 'Cmdes trouvées', key: 'parcels_matched', align: 'right' },
                              { label: 'Poids OK', key: 'weight_ok', align: 'right' },
                              { label: 'Écarts', key: 'weight_ecart', align: 'right' },
                              { label: 'Total HT', key: 'total_ht' },
                              { label: 'Suppléments HT', key: 'supplements_total' },
                              { label: 'Indemn. HT', key: 'indemnizations_total' },
                              { label: 'Tarifs', key: 'tariffs_applied_at', align: 'center' },
                              { label: 'Enregistrée le', key: 'created_at' },
                              { label: '' },
                            ].map(({ label, key, align }) => (
                              <Th key={label || 'actions'} label={label} align={align} sortKey={key} currentSort={historySort} onSort={toggleHistorySort} />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedHistory.map((inv, i) => (
                            <tr key={inv.id}
                              onClick={() => handleLoadFromHistory(inv)}
                              style={{ background: i % 2 === 0 ? C.white : C.grey, cursor: 'pointer', transition: 'background .1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
                            >
                              <Td bold color={C.accent}>🔍 {inv.invoice_number}</Td>
                              <Td color={C.greyT}>{inv.period_start ? `${inv.period_start} → ${inv.period_end}` : '—'}</Td>
                              <Td align="right">{inv.total_parcels}</Td>
                              <Td align="right" color={C.blue}>{inv.parcels_matched}</Td>
                              <Td align="right" color={C.green}>{inv.weight_ok ?? '—'}</Td>
                              <Td align="right" color={inv.weight_ecart > 0 ? C.red : C.dark}>{inv.weight_ecart ?? '—'}</Td>
                              <Td bold>{inv.total_ht != null ? fmtEur(inv.total_ht) : '—'}</Td>
                              <Td color={C.orange}>{inv.supplements_total != null ? fmtEur(inv.supplements_total) : '—'}</Td>
                              <Td color={C.blue}>{inv.indemnizations_total != null ? fmtEur(inv.indemnizations_total) : '—'}</Td>
                              <Td align="center">
                                {inv.tariffs_applied_at
                                  ? <span style={{ background: C.greenL, color: C.green, padding: '2px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>✓ Appliqués</span>
                                  : <span style={{ background: C.greyB, color: C.greyT, padding: '2px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>Non appliqués</span>}
                              </Td>
                              <Td color={C.greyT}>{new Date(inv.created_at).toLocaleDateString('fr-FR')}</Td>
                              <td style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.greyB}` }}>
                                <button onClick={e => handleDownloadPdf(inv, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, marginRight: 4 }}>⬇️</button>
                                <button onClick={e => handleDeleteInvoice(inv, e)} title="Supprimer la facture" style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14, color: C.red }}>🗑️</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ borderTop: `2px solid ${C.greyB}`, background: C.grey }}>
                            <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL ({history.length} factures)</td>
                            <td colSpan={5} />
                            <td style={{ padding: '10px 12px', fontWeight: 800, color: C.accent }}>
                              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.total_ht || 0), 0))}
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: C.orange }}>
                              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.supplements_total || 0), 0))}
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: C.blue }}>
                              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.indemnizations_total || 0), 0))}
                            </td>
                            <td colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Historique accessible même sans facture chargée */}
        {!result && (
          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, marginTop: 8 }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.greyB}`, padding: '0 16px', flexWrap: 'wrap' }}>
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
                      <tr>
                        {[
                          { label: 'N° Facture', key: 'invoice_number' },
                          { label: 'Période', key: 'period' },
                          { label: 'Colis', key: 'total_parcels', align: 'right' },
                          { label: 'Total HT', key: 'total_ht' },
                          { label: 'Suppléments HT', key: 'supplements_total' },
                          { label: 'Indemn. HT', key: 'indemnizations_total' },
                          { label: 'Tarifs', key: 'tariffs_applied_at', align: 'center' },
                          { label: 'Enregistrée le', key: 'created_at' },
                          { label: '' },
                        ].map(({ label, key, align }) => (
                          <Th key={label || 'actions'} label={label} align={align} sortKey={key} currentSort={historySort} onSort={toggleHistorySort} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedHistory.map((inv, i) => (
                        <tr key={inv.id}
                          onClick={() => handleLoadFromHistory(inv)}
                          style={{ background: i % 2 === 0 ? C.white : C.grey, cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
                        >
                          <Td bold color={C.accent}>🔍 {inv.invoice_number}</Td>
                          <Td color={C.greyT}>{inv.period_start ? `${inv.period_start} → ${inv.period_end}` : '—'}</Td>
                          <Td align="right">{inv.total_parcels}</Td>
                          <Td bold>{inv.total_ht != null ? fmtEur(inv.total_ht) : '—'}</Td>
                          <Td color={C.orange}>{inv.supplements_total != null ? fmtEur(inv.supplements_total) : '—'}</Td>
                          <Td color={C.blue}>{inv.indemnizations_total != null ? fmtEur(inv.indemnizations_total) : '—'}</Td>
                          <Td align="center">
                            {inv.tariffs_applied_at
                              ? <span style={{ background: C.greenL, color: C.green, padding: '2px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>✓ Appliqués</span>
                              : <span style={{ background: C.greyB, color: C.greyT, padding: '2px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>Non appliqués</span>}
                          </Td>
                          <Td color={C.greyT}>{new Date(inv.created_at).toLocaleDateString('fr-FR')}</Td>
                          <td style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.greyB}` }}>
                            <button onClick={e => handleDownloadPdf(inv, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, marginRight: 4 }}>⬇️</button>
                            <button onClick={e => handleDeleteInvoice(inv, e)} title="Supprimer" style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, color: C.red }}>🗑️</button>
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
    </AppShell>
  );
}
