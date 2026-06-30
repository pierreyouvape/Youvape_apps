import { useState, useRef, useContext, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

// Remise contractuelle attendue (palier 15 000–20 000 colis PR/Locker + Collecte)
const EXPECTED_REMISE = 14;

const C = {
  primary: '#9C2462', accentL: '#FBEAF2', accent: '#7A1F4E',
  blue: '#1457A8', blueL: '#E5EEFA',
  green: '#16A34A', greenL: '#DCFCE7',
  red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFF7ED',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280',
  dark: '#111827', white: '#FFFFFF',
};

function fmtEur(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} €`;
}
function fmtKg(v) { return v !== null && v !== undefined ? `${parseFloat(v).toFixed(2)} kg` : '—'; }
const fmtColis = n => (n || 0).toLocaleString('en-US').replace(/,/g, ' ');
const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function dateKey(d) {
  const parts = (d || '').split('/');
  if (parts.length !== 3) return 0;
  const [dd, mm, yy] = parts;
  return parseInt(`${yy}${mm}${dd}`, 10) || 0;
}

function useSorted(rows, sorters) {
  const [sort, setSort] = useState(null);
  const toggle = key => setSort(p => p?.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  const sorted = useMemo(() => {
    if (!sort || !sorters[sort.key]) return rows;
    const get = sorters[sort.key];
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, sorters]);
  return { sorted, sort, toggle };
}

function StatCard({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: 110, background: C.white, borderRadius: 10, border: `1px solid ${C.greyB}`, padding: '14px 16px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.accent }}>{value}</div>
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

function Th({ label, align = 'left', sortKey, sort, onSort }) {
  const sortable = !!sortKey && !!onSort;
  const active = sortable && sort?.key === sortKey;
  return (
    <th onClick={sortable ? () => onSort(sortKey) : undefined}
      style={{ padding: '10px 12px', textAlign: align, fontWeight: 700, color: active ? C.accent : C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}>
      {label}{sortable && (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇕')}
    </th>
  );
}
function Td({ children, align = 'left', bg, color, bold }) {
  return <td style={{ padding: '8px 12px', textAlign: align, background: bg, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13 }}>{children}</td>;
}

const HISTORY_SORTERS = {
  invoice_number: i => i.invoice_number || '',
  invoice_date:   i => dateKey(i.invoice_date),
  period:         i => dateKey(i.period_start),
  pays:           i => i.pays || '',
  total_parcels:  i => Number(i.total_parcels) || 0,
  total_ht:       i => parseFloat(i.total_ht || 0),
  total_ttc:      i => parseFloat(i.total_ttc || 0),
  remise_rate:    i => parseFloat(i.remise_rate || 0),
  created_at:     i => new Date(i.created_at).getTime() || 0,
};

function HistoryTable({ history, loadFromHistory, onDelete, onDownload }) {
  const { sorted, sort, toggle } = useSorted(history, HISTORY_SORTERS);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <Th label="N° Facture" sortKey="invoice_number" sort={sort} onSort={toggle} />
            <Th label="Date" sortKey="invoice_date" sort={sort} onSort={toggle} />
            <Th label="Période" sortKey="period" sort={sort} onSort={toggle} />
            <Th label="Pays" sortKey="pays" sort={sort} onSort={toggle} />
            <Th label="Colis" align="right" sortKey="total_parcels" sort={sort} onSort={toggle} />
            <Th label="Remise" align="right" sortKey="remise_rate" sort={sort} onSort={toggle} />
            <Th label="Total HT" align="right" sortKey="total_ht" sort={sort} onSort={toggle} />
            <Th label="Total TTC" align="right" sortKey="total_ttc" sort={sort} onSort={toggle} />
            <Th label="Enregistrée le" sortKey="created_at" sort={sort} onSort={toggle} /><Th label="" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, i) => (
            <tr key={inv.id} onClick={() => loadFromHistory(inv)}
              style={{ background: i % 2 === 0 ? C.white : C.grey, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = C.accentL}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}>
              <Td bold color={C.accent}>🔍 {inv.invoice_number}</Td>
              <Td color={C.greyT}>{inv.invoice_date || '—'}</Td>
              <Td color={C.greyT}>{inv.period_start ? `${inv.period_start} → ${inv.period_end}` : '—'}</Td>
              <Td><span style={{ background: C.blueL, color: C.blue, padding: '2px 8px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>{inv.pays || '—'}</span></Td>
              <Td align="right">{inv.total_parcels ?? '—'}</Td>
              <Td align="right" color={inv.remise_rate != null && parseFloat(inv.remise_rate) !== EXPECTED_REMISE ? C.orange : C.greyT}>{inv.remise_rate != null ? `${parseFloat(inv.remise_rate)} %` : '—'}</Td>
              <Td align="right" bold>{fmtEur(inv.total_ht)}</Td>
              <Td align="right" bold color={C.blue}>{fmtEur(inv.total_ttc)}</Td>
              <Td color={C.greyT}>{new Date(inv.created_at).toLocaleDateString('fr-FR')}</Td>
              <td style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.greyB}` }}>
                <button onClick={e => onDownload(inv, e)} title="Télécharger le PDF" style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, marginRight: 4 }}>⬇️</button>
                <button onClick={e => onDelete(inv, e)} title="Supprimer" style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '3px 7px', cursor: 'pointer', fontSize: 13, color: C.red }}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${C.greyB}`, background: C.grey }}>
            <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL ({history.length})</td>
            <td colSpan={3} />
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{history.reduce((s, i) => s + (Number(i.total_parcels) || 0), 0)}</td>
            <td />
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.accent }}>{fmtEur(history.reduce((s, i) => s + parseFloat(i.total_ht || 0), 0))}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.blue }}>{fmtEur(history.reduce((s, i) => s + parseFloat(i.total_ttc || 0), 0))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TotalsView({ totals, totalsLoading, loadTotals }) {
  const { months, years, byPays, yearCols, byPaysYear, monthCols, byPaysMonth } = useMemo(() => {
    const monthMap = {}, yearMap = {}, paysMap = {}, paysYearMap = {}, paysMonthMap = {}, yearsSet = new Set();
    for (const inv of (totals?.invoices || [])) {
      const parts = (inv.period_start || '').split('/');
      const ttc = parseFloat(inv.total_ttc || inv.total_ht || 0);
      const ht = parseFloat(inv.total_ht || 0);
      const colis = Number(inv.total_parcels) || 0;
      const y = parts.length === 3 ? parts[2] : '—';
      const pays = inv.pays || '—';
      let key = null;
      if (parts.length === 3) {
        key = `${y}-${parts[1]}`;
        monthMap[key] = monthMap[key] || { ht: 0, ttc: 0, colis: 0 };
        monthMap[key].ht += ht; monthMap[key].ttc += ttc; monthMap[key].colis += colis;
        yearMap[y] = yearMap[y] || { ht: 0, ttc: 0 };
        yearMap[y].ht += ht; yearMap[y].ttc += ttc;
        paysMonthMap[pays] = paysMonthMap[pays] || {};
        paysMonthMap[pays][key] = (paysMonthMap[pays][key] || 0) + colis;
      }
      yearsSet.add(y);
      paysMap[pays] = paysMap[pays] || { ht: 0, ttc: 0, colis: 0 };
      paysMap[pays].ht += ht; paysMap[pays].ttc += ttc; paysMap[pays].colis += colis;
      paysYearMap[pays] = paysYearMap[pays] || {};
      paysYearMap[pays][y] = paysYearMap[pays][y] || { ttc: 0, colis: 0 };
      paysYearMap[pays][y].ttc += ttc; paysYearMap[pays][y].colis += colis;
    }
    const months = Object.entries(monthMap).map(([key, v]) => { const [yy, m] = key.split('-'); return { key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${yy}`, ...v }; }).sort((a, b) => b.key.localeCompare(a.key));
    const years = Object.entries(yearMap).map(([yy, v]) => ({ key: yy, label: yy, ...v })).sort((a, b) => b.key.localeCompare(a.key));
    const byPays = Object.entries(paysMap).map(([p, v]) => ({ pays: p, ...v })).sort((a, b) => b.ttc - a.ttc);
    const yearCols = [...yearsSet].sort();
    const byPaysYear = Object.entries(paysYearMap).map(([p, ym]) => ({
      pays: p, ym,
      total: Object.values(ym).reduce((s, x) => s + x.ttc, 0),
      totalColis: Object.values(ym).reduce((s, x) => s + x.colis, 0),
    })).sort((a, b) => b.total - a.total);
    const monthCols = [...months].map(m => ({ key: m.key, label: m.label })).reverse();
    const byPaysMonth = Object.entries(paysMonthMap).map(([p, bm]) => ({
      pays: p, bm, total: Object.values(bm).reduce((s, x) => s + x, 0),
    })).sort((a, b) => b.total - a.total);
    return { months, years, byPays, yearCols, byPaysYear, monthCols, byPaysMonth };
  }, [totals]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>Total payé à Mondial Relay, par mois, par année et par pays de livraison.</p>
        <button onClick={loadTotals} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>↻ Actualiser</button>
      </div>
      {totalsLoading ? <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
        : months.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>Aucune donnée. Enregistrez des factures pour voir les totaux.</div>
        : (
        <>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Évolution mensuelle (TTC)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={[...months].reverse()} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                <Tooltip formatter={v => fmtEur(v)} />
                <Line type="monotone" dataKey="ttc" name="Total payé TTC" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par pays</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Pays" /><Th label="Colis" align="right" /><Th label="HT" align="right" /><Th label="TTC" align="right" /></tr></thead>
                <tbody>{byPays.map((p, i) => (<tr key={p.pays} style={{ background: i % 2 === 0 ? C.white : C.grey }}><Td bold>{p.pays}</Td><Td align="right">{p.colis}</Td><Td align="right">{fmtEur(p.ht)}</Td><Td align="right" bold color={C.accent}>{fmtEur(p.ttc)}</Td></tr>))}</tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par année</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Année" /><Th label="HT" align="right" /><Th label="TTC" align="right" /></tr></thead>
                <tbody>{years.map((y, i) => (<tr key={y.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}><Td bold>{y.label}</Td><Td align="right">{fmtEur(y.ht)}</Td><Td align="right" bold color={C.accent}>{fmtEur(y.ttc)}</Td></tr>))}</tbody>
              </table>
            </div>
          </div>
          {yearCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par pays et par année (TTC)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Pays" /><Th label="Colis" align="right" />{yearCols.map(y => <Th key={y} label={y} align="right" />)}<Th label="Total TTC" align="right" /></tr></thead>
                <tbody>{byPaysYear.map((r, i) => (
                  <tr key={r.pays} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                    <Td bold>{r.pays}</Td>
                    <Td align="right" color={C.greyT}>{fmtColis(r.totalColis)}</Td>
                    {yearCols.map(y => <Td key={y} align="right">{r.ym[y] ? fmtEur(r.ym[y].ttc) : '—'}</Td>)}
                    <Td align="right" bold color={C.accent}>{fmtEur(r.total)}</Td>
                  </tr>
                ))}</tbody>
                <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                  <Td bold>Total</Td>
                  <Td align="right" bold>{fmtColis(byPaysYear.reduce((s, r) => s + r.totalColis, 0))}</Td>
                  {yearCols.map(y => <Td key={y} align="right" bold>{fmtEur(byPaysYear.reduce((s, r) => s + (r.ym[y]?.ttc || 0), 0))}</Td>)}
                  <Td align="right" bold color={C.accent}>{fmtEur(byPaysYear.reduce((s, r) => s + r.total, 0))}</Td>
                </tr></tfoot>
              </table>
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr><Th label="Mois" /><Th label="Colis" align="right" /><Th label="HT" align="right" /><Th label="TTC" align="right" /></tr></thead>
              <tbody>{months.map((m, i) => (<tr key={m.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}><Td>{m.label}</Td><Td align="right" color={C.greyT}>{fmtColis(m.colis)}</Td><Td align="right">{fmtEur(m.ht)}</Td><Td align="right" bold>{fmtEur(m.ttc)}</Td></tr>))}</tbody>
            </table>
          </div>

          {byPaysMonth.length > 0 && monthCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Nombre de colis par pays et par mois</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Nombre de colis par pays de livraison, mois par mois.</p>
              <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
                  <thead><tr>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, position: 'sticky', left: 0, zIndex: 2, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>Pays</th>
                    {monthCols.map(mc => <Th key={mc.key} label={mc.label} align="right" />)}<Th label="Total" align="right" />
                  </tr></thead>
                  <tbody>{byPaysMonth.map((r, i) => (
                    <tr key={r.pays} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${C.greyB}`, background: i % 2 === 0 ? C.white : C.grey, position: 'sticky', left: 0, zIndex: 1, boxShadow: `2px 0 4px -2px rgba(0,0,0,0.15)` }}>{r.pays}</td>
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

          {byPaysYear.length > 0 && yearCols.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Nombre de colis par pays et par année</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Nombre de colis par pays de livraison, année par année.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><Th label="Pays" />{yearCols.map(y => <Th key={y} label={y} align="right" />)}<Th label="Total" align="right" /></tr></thead>
                  <tbody>{byPaysYear.map((r, i) => (
                    <tr key={r.pays} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{r.pays}</Td>
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

const DELIV_SORTERS = {
  type: d => d.type || '', bracket: d => d.gridIndex ?? 99,
  poids: d => d.poids || 0, qty: d => d.qty || 0, pu: d => d.pu || 0, montant: d => d.montant || 0,
};

export default function MondialRelayApp() {
  const { token } = useContext(AuthContext);
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('livraisons');
  const [search, setSearch] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const zipRef = useRef(null);
  const [importingZip, setImportingZip] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [totals, setTotals] = useState(null);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [homeTab, setHomeTab] = useState('historique');

  async function loadHistory() {
    setHistoryLoading(true);
    try { const { data } = await axios.get(`${API_URL}/mondial-relay/history`, { headers: { Authorization: `Bearer ${token}` } }); if (data.success) setHistory(data.invoices); }
    catch { /* */ } finally { setHistoryLoading(false); }
  }
  async function loadTotals() {
    setTotalsLoading(true);
    try { const { data } = await axios.get(`${API_URL}/mondial-relay/totals`, { headers: { Authorization: `Bearer ${token}` } }); if (data.success) setTotals(data); }
    catch { /* */ } finally { setTotalsLoading(false); }
  }
  useEffect(() => { loadHistory(); loadTotals(); }, []);

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('Fichier PDF requis.'); return; }
    setCurrentFile(file); setError(null); setResult(null); setSaveState(null); setLoading(true);
    try {
      const fd = new FormData(); fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/mondial-relay/analyze`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setResult(data); setTab('livraisons');
      if (data.invoiceNumber && history.some(h => h.invoice_number === data.invoiceNumber)) setSaveState('already');
    } catch (e) { setError(e.response?.data?.error || e.message); } finally { setLoading(false); }
  }

  async function handleLoadFromHistory(inv) {
    setLoading(true); setError(null); setCurrentFile(null);
    try {
      const { data } = await axios.get(`${API_URL}/mondial-relay/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error);
      setResult({ ...data.parsed, _fromHistory: true }); setSaveState('already'); setTab('livraisons');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  function handleBackToHome() { setResult(null); setCurrentFile(null); setError(null); setSaveState(null); setSearch(''); setTab('livraisons'); }

  async function handleZip(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setError('Fichier ZIP requis.'); return; }
    setImportingZip(true); setImportResult(null); setError(null);
    try {
      const fd = new FormData(); fd.append('zip', file);
      const { data } = await axios.post(`${API_URL}/mondial-relay/import-zip`, fd, { headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
      if (!data.success) throw new Error(data.error);
      setImportResult(data);
      loadHistory(); loadTotals();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setImportingZip(false); if (zipRef.current) zipRef.current.value = ''; }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const fd = new FormData(); fd.append('data', JSON.stringify(result)); if (currentFile) fd.append('pdf', currentFile);
      const { data } = await axios.post(`${API_URL}/mondial-relay/save`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) { setSaveState(data.already_saved ? 'already' : 'saved'); if (!data.already_saved) { loadHistory(); loadTotals(); } }
    } catch (e) { setError(e.response?.data?.error || "Erreur lors de l'enregistrement"); } finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv, e) {
    e.stopPropagation();
    if (!window.confirm(`Supprimer la facture ${inv.invoice_number} ?`)) return;
    try { await axios.delete(`${API_URL}/mondial-relay/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } }); if (result?.invoiceNumber === inv.invoice_number) handleBackToHome(); loadHistory(); loadTotals(); }
    catch { setError('Erreur lors de la suppression'); }
  }
  function handleDownloadPdf(inv, e) {
    e.stopPropagation();
    fetch(`${API_URL}/mondial-relay/history/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `MondialRelay_${inv.invoice_number}.pdf`; a.click(); URL.revokeObjectURL(url); })
      .catch(() => setError('PDF non disponible'));
  }
  async function handleExport() {
    if (!currentFile) return;
    setExporting(true);
    try {
      const fd = new FormData(); fd.append('pdf', currentFile);
      const resp = await axios.post(`${API_URL}/mondial-relay/export-excel`, fd, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data); const a = document.createElement('a'); a.href = url; a.download = result?.invoiceNumber ? `MondialRelay_${result.invoiceNumber}.xlsx` : 'MondialRelay.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { setError('Erreur export Excel.'); } finally { setExporting(false); }
  }

  const deliveries = result?.deliveries || [];
  const stats = result?.stats || {};
  const filteredDeliveries = deliveries.filter(d => !search || (d.type || '').toLowerCase().includes(search.toLowerCase()) || (d.bracket || '').toLowerCase().includes(search.toLowerCase()));
  const delivSort = useSorted(filteredDeliveries, DELIV_SORTERS);

  const fees = [];
  if (result) {
    if (result.remiseMontant != null) fees.push({ label: `Remise ${result.remiseRate} %`, qty: 1, pu: null, montant: result.remiseMontant, kind: 'remise' });
    if (result.indexation) fees.push({ label: `Indexation Gasoil (${result.indexation.taux} % sur ${fmtEur(result.indexation.base)})`, qty: '', pu: null, montant: result.indexation.montant, kind: 'index' });
    (result.collecte || []).forEach(c => fees.push({ ...c, kind: 'collecte' }));
    (result.retourPCI || []).forEach(c => fees.push({ ...c, kind: 'pci' }));
    (result.complements || []).forEach(c => fees.push({ ...c, kind: 'compl' }));
    (result.surcharges || []).forEach(c => fees.push({ ...c, kind: 'surcharge' }));
    (result.participations || []).forEach(c => fees.push({ ...c, kind: 'partic' }));
  }

  const remiseConform = result && result.remiseRate != null && parseFloat(result.remiseRate) === EXPECTED_REMISE;

  return (
    <AppShell currentPath="/mondial-relay">
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: C.dark, margin: 0 }}>Analyse facture Mondial Relay</h1>
          <p style={{ color: C.greyT, margin: '5px 0 0', fontSize: 13 }}>
            Importe une facture PDF Mondial Relay pour lire le détail par pays / tranche de poids, vérifier la remise et les tarifs.
          </p>
        </div>

        <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? C.accent : C.greyB}`, borderRadius: 14, background: dragging ? C.accentL : C.grey, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 22 }}>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 36, marginBottom: 10 }}>📍</div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: C.dark }}>{loading ? 'Analyse en cours…' : 'Déposer la facture PDF ici'}</div>
          <div style={{ color: C.greyT, fontSize: 12.5, marginTop: 5 }}>ou cliquer pour sélectionner</div>
          {currentFile && !loading && <div style={{ marginTop: 8, color: C.accent, fontSize: 12.5, fontWeight: 600 }}>📎 {currentFile.name}</div>}
          {loading && <div style={{ marginTop: 12 }}><div style={{ display: 'inline-block', width: 26, height: 26, border: `3px solid ${C.accentL}`, borderTop: `3px solid ${C.accent}`, borderRadius: '50%', animation: 'spin .8s linear infinite' }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>}
        </div>

        {/* Import ZIP en lot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
          <input ref={zipRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }} onChange={e => handleZip(e.target.files[0])} />
          <button onClick={() => zipRef.current?.click()} disabled={importingZip}
            style={{ background: C.white, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, padding: '9px 16px', fontWeight: 700, fontSize: 13, cursor: importingZip ? 'wait' : 'pointer', opacity: importingZip ? .7 : 1 }}>
            {importingZip ? '⏳ Import en cours…' : '📦 Importer un ZIP de factures'}
          </button>
          <span style={{ color: C.greyT, fontSize: 12.5 }}>Toutes les factures PDF du ZIP sont analysées et enregistrées d'un coup (les doublons sont ignorés).</span>
        </div>

        {importResult && (
          <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 10, padding: '11px 15px', color: C.dark, fontSize: 13, marginBottom: 18 }}>
            ✓ Import terminé : <strong>{importResult.imported}</strong> facture(s) ajoutée(s)
            {importResult.already > 0 && <>, {importResult.already} déjà présente(s)</>}
            {importResult.failed?.length > 0 && <>, <span style={{ color: C.red }}>{importResult.failed.length} en échec</span></>}
            {' '}sur {importResult.total}.
            {importResult.failed?.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: C.red }}>
                {importResult.failed.map((f, i) => <li key={i}>{f.name} — {f.error}</li>)}
              </ul>
            )}
          </div>
        )}

        {error && <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 10, padding: '11px 15px', color: C.red, fontSize: 13, marginBottom: 18 }}>⚠️ {error}</div>}

        {result && (
          <>
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <button onClick={handleBackToHome} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: C.greyT, cursor: 'pointer', marginRight: 12 }}>← Retour à l'accueil</button>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>Facture {result.invoiceNumber}</span>
                <span style={{ background: C.blueL, color: C.blue, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700, marginLeft: 10 }}>{result.pays}</span>
                {(result.periodStart) && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>{result.periodStart} → {result.periodEnd}</span>}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {saveState === 'saved' && <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Enregistrée</span>}
                {saveState === 'already' && <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>⚠ Déjà enregistrée</span>}
                {saveState === null && <button onClick={handleSave} disabled={saving} style={{ background: C.green, color: C.white, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: saving ? .7 : 1 }}>{saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}</button>}
                {currentFile && <button onClick={handleExport} disabled={exporting} style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? .7 : 1 }}>{exporting ? '⏳ Export…' : '⬇️ Excel'}</button>}
              </div>
            </div>

            {/* Badges vérification */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {result.remiseRate != null && (
                <div style={{ background: remiseConform ? C.greenL : C.orangeL, color: remiseConform ? C.green : C.orange, border: `1px solid ${remiseConform ? C.green : C.orange}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700 }}>
                  {remiseConform ? '✓' : '⚠'} Remise {result.remiseRate} % {remiseConform ? '(conforme)' : `(attendu ${EXPECTED_REMISE} %)`}
                </div>
              )}
              <div style={{ background: stats.reconcile_ok ? C.greenL : C.redL, color: stats.reconcile_ok ? C.green : C.red, border: `1px solid ${stats.reconcile_ok ? C.green : C.red}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700 }}>
                {stats.reconcile_ok ? '✓ Réconcilié' : `⚠ Écart ${fmtEur(stats.lines_total)} vs HT ${fmtEur(result.totalHT)}`}
              </div>
              {stats.pu_checked > 0 && (
                <div style={{ background: stats.pu_grid_ok ? C.greenL : C.orangeL, color: stats.pu_grid_ok ? C.green : C.orange, border: `1px solid ${stats.pu_grid_ok ? C.green : C.orange}`, borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700 }}>
                  {stats.pu_grid_ok ? '✓' : '⚠'} Grille 2026 : {stats.pu_conform}/{stats.pu_checked} tarifs conformes
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
              <StatCard value={fmtEur(result.totalHT)} label="Total HT" />
              <StatCard value={fmtEur(result.totalTVA)} label={`TVA${result.tvaRate ? ` (${result.tvaRate}%)` : ''}`} color={result.totalTVA > 0 ? C.orange : C.greyT} />
              <StatCard value={fmtEur(result.totalTTC)} label="Total TTC" color={C.blue} />
              <StatCard value={result.nbColis ?? '—'} label="Colis" color={C.dark} />
              <StatCard value={fmtEur(result.remiseMontant)} label="Remise €" color={C.green} />
              <StatCard value={fmtEur(result.indexation?.montant)} label="Indexation Gasoil" color={C.greyT} />
            </div>

            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', borderBottom: `1px solid ${C.greyB}`, padding: '0 14px', flexWrap: 'wrap' }}>
                <TabBtn label="Livraisons" active={tab === 'livraisons'} onClick={() => setTab('livraisons')} badge={deliveries.length} />
                <TabBtn label="Frais & remise" active={tab === 'frais'} onClick={() => setTab('frais')} badge={fees.length} />
                <TabBtn label="Résumé" active={tab === 'resume'} onClick={() => setTab('resume')} />
                <TabBtn label="Historique" active={tab === 'historique'} onClick={() => setTab('historique')} badge={history.length} />
              </div>

              {tab === 'livraisons' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <input placeholder="Rechercher type / tranche…" value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '7px 11px', border: `1px solid ${C.greyB}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 180 }} />
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>
                        <Th label="Type de livraison" sortKey="type" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="Tranche de poids" sortKey="bracket" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="Poids" align="right" sortKey="poids" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="Quantité" align="right" sortKey="qty" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="PU" align="right" sortKey="pu" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="Montant HT" align="right" sortKey="montant" sort={delivSort.sort} onSort={delivSort.toggle} />
                        <Th label="Grille 2026" align="right" />
                      </tr></thead>
                      <tbody>
                        {delivSort.sorted.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Aucune ligne</td></tr>}
                        {delivSort.sorted.map((d, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                            <Td>{d.type}</Td>
                            <Td><span style={{ background: C.accentL, color: C.accent, padding: '2px 8px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>{d.bracket}</span></Td>
                            <Td align="right" color={C.greyT}>{fmtKg(d.poids)}</Td>
                            <Td align="right" bold>{d.qty}</Td>
                            <Td align="right">{fmtEur(d.pu)}</Td>
                            <Td align="right" bold>{fmtEur(d.montant)}</Td>
                            <Td align="right" bg={d.pu_ok === false ? C.orangeL : undefined} color={d.pu_ok === false ? C.orange : C.greyT}>
                              {d.grid_pu != null ? `${fmtEur(d.grid_pu)}${d.pu_ok === false ? ' ⚠' : ''}` : '—'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.dark }}>
                    Sous-total livraisons HT : <span style={{ color: C.accent }}>{fmtEur(filteredDeliveries.reduce((s, d) => s + (d.montant || 0), 0))}</span>
                  </div>
                </div>
              )}

              {tab === 'frais' && (
                <div style={{ padding: 18 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr><Th label="Libellé" /><Th label="Quantité" align="right" /><Th label="PU" align="right" /><Th label="Montant HT" align="right" /></tr></thead>
                      <tbody>
                        {fees.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Aucun frais</td></tr>}
                        {fees.map((f, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                            <Td bold={f.kind === 'remise'}>{f.label}</Td>
                            <Td align="right" color={C.greyT}>{f.qty !== '' ? f.qty : ''}</Td>
                            <Td align="right" color={C.greyT}>{f.pu != null ? fmtEur(f.pu) : ''}</Td>
                            <Td align="right" bold color={f.montant < 0 ? C.green : (f.kind === 'surcharge' ? C.orange : C.dark)}>{fmtEur(f.montant)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === 'resume' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 14 }}>
                    {[
                      { label: 'Facture n°', value: result.invoiceNumber, color: C.dark },
                      { label: 'Pays de livraison', value: result.pays, color: C.blue },
                      { label: 'Période', value: `${result.periodStart} → ${result.periodEnd}`, color: C.dark },
                      { label: 'Date facture', value: result.invoiceDate, color: C.dark },
                      { label: 'Colis facturés', value: result.nbColis, color: C.dark },
                      { label: `Remise${result.remiseRate != null ? ` (${result.remiseRate}%)` : ''}`, value: fmtEur(result.remiseMontant), color: C.green },
                      { label: 'Indexation Gasoil', value: fmtEur(result.indexation?.montant), color: C.greyT },
                      { label: 'Total HT', value: fmtEur(result.totalHT), color: C.dark },
                      { label: `TVA${result.tvaRate ? ` (${result.tvaRate}%)` : ''}`, value: fmtEur(result.totalTVA), color: C.orange },
                      { label: 'Total TTC', value: fmtEur(result.totalTTC), color: C.blue },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: C.grey, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.greyB}` }}>
                        <div style={{ fontSize: 11.5, color: C.greyT, marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'historique' && (
                <div style={{ padding: 18 }}>
                  {historyLoading ? <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
                    : history.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>Aucune facture enregistrée.</div>
                    : <HistoryTable history={history} loadFromHistory={handleLoadFromHistory} onDelete={handleDeleteInvoice} onDownload={handleDownloadPdf} />}
                </div>
              )}
            </div>
          </>
        )}

        {!result && (
          <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, marginTop: 8 }}>
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.greyB}`, padding: '0 16px', flexWrap: 'wrap' }}>
              <TabBtn label="Historique des factures" active={homeTab === 'historique'} onClick={() => setHomeTab('historique')} badge={history.length} />
              <TabBtn label="Totaux" active={homeTab === 'totaux'} onClick={() => setHomeTab('totaux')} />
            </div>
            {homeTab === 'totaux'
              ? <TotalsView totals={totals} totalsLoading={totalsLoading} loadTotals={loadTotals} />
              : <div style={{ padding: 20 }}>
                  {historyLoading ? <div style={{ textAlign: 'center', padding: 20, color: C.greyT }}>Chargement…</div>
                    : history.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Aucune facture enregistrée pour l'instant.</div>
                    : <HistoryTable history={history} loadFromHistory={handleLoadFromHistory} onDelete={handleDeleteInvoice} onDownload={handleDownloadPdf} />}
                </div>}
          </div>
        )}
      </div>
    </AppShell>
  );
}
