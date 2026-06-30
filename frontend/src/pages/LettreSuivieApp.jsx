import { useState, useRef, useContext, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#FFB000', accentL: '#FFF7E0', accent: '#B97A00',
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

const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// Clé triable pour une date "JJ/MM/AAAA"
function dateKey(d) {
  const parts = (d || '').split('/');
  if (parts.length !== 3) return 0;
  const [dd, mm, yy] = parts;
  return parseInt(`${yy}${mm}${dd}`, 10) || 0;
}

// Hook de tri générique (clic sur en-tête → desc puis asc)
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
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.accent }}>{value}</div>
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
    <th
      onClick={sortable ? () => onSort(sortKey) : undefined}
      style={{ padding: '10px 12px', textAlign: align, fontWeight: 700, color: active ? C.accent : C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
    >
      {label}{sortable && (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇕')}
    </th>
  );
}
function Td({ children, align = 'left', bg, color, bold }) {
  return <td style={{ padding: '8px 12px', textAlign: align, background: bg, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13 }}>{children}</td>;
}

const CONTRACT_LABELS = {
  A: 'Port Payé (par commande)',
  B: 'API AFF Entreprise (par date)',
  service: 'Service',
};

const HISTORY_SORTERS = {
  invoice_number: inv => inv.invoice_number || '',
  invoice_date:   inv => dateKey(inv.invoice_date),
  period:         inv => dateKey(inv.period_start),
  contract_type:  inv => inv.contract_type || '',
  total_parcels:  inv => Number(inv.total_parcels) || 0,
  total_ht:       inv => parseFloat(inv.total_ht || 0),
  total_tva:      inv => parseFloat(inv.total_tva || 0),
  total_ttc:      inv => parseFloat(inv.total_ttc || 0),
  created_at:     inv => new Date(inv.created_at).getTime() || 0,
};

const LINE_SORTERS = {
  tier:    l => l.tier || '',
  qty:     l => l.qty || 0,
  pu:      l => l.pu || 0,
  montant: l => l.montant || 0,
};

const TIER_SORTERS = {
  tier:    t => t.tier || '',
  pu:      t => t.pu || 0,
  qty:     t => t.qty || 0,
  count:   t => t.count || 0,
  montant: t => t.montant || 0,
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
            <Th label="Contrat" sortKey="contract_type" sort={sort} onSort={toggle} />
            <Th label="Lettres" align="right" sortKey="total_parcels" sort={sort} onSort={toggle} />
            <Th label="Total HT" align="right" sortKey="total_ht" sort={sort} onSort={toggle} />
            <Th label="TVA" align="right" sortKey="total_tva" sort={sort} onSort={toggle} />
            <Th label="Total TTC" align="right" sortKey="total_ttc" sort={sort} onSort={toggle} />
            <Th label="Enregistrée le" sortKey="created_at" sort={sort} onSort={toggle} /><Th label="" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, i) => (
            <tr key={inv.id}
              onClick={() => loadFromHistory(inv)}
              style={{ background: i % 2 === 0 ? C.white : C.grey, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = C.accentL}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
            >
              <Td bold color={C.accent}>🔍 {inv.invoice_number}</Td>
              <Td color={C.greyT}>{inv.invoice_date || '—'}</Td>
              <Td color={C.greyT}>{inv.period_end ? `${inv.period_start} → ${inv.period_end}` : (inv.period_start || '—')}</Td>
              <Td color={C.greyT}>{inv.contract_type || CONTRACT_LABELS[inv.format] || '—'}</Td>
              <Td align="right">{inv.total_parcels ?? '—'}</Td>
              <Td align="right" bold>{fmtEur(inv.total_ht)}</Td>
              <Td align="right" color={parseFloat(inv.total_tva) > 0 ? C.orange : C.greyT}>{fmtEur(inv.total_tva)}</Td>
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
            <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL ({history.length} factures)</td>
            <td colSpan={4} />
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.accent }}>
              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.total_ht || 0), 0))}
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: C.orange }}>
              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.total_tva || 0), 0))}
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.blue }}>
              {fmtEur(history.reduce((s, inv) => s + parseFloat(inv.total_ttc || 0), 0))}
            </td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TotalsView({ totals, totalsLoading, loadTotals }) {
  const { months, years } = useMemo(() => {
    const monthMap = {}, yearMap = {};
    for (const inv of (totals?.invoices || [])) {
      const parts = (inv.period_start || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const key = `${y}-${m}`;
      const ht = parseFloat(inv.total_ht || 0);
      const ttc = parseFloat(inv.total_ttc || inv.total_ht || 0);
      monthMap[key] = monthMap[key] || { ht: 0, ttc: 0 };
      monthMap[key].ht += ht; monthMap[key].ttc += ttc;
      yearMap[y] = yearMap[y] || { ht: 0, ttc: 0 };
      yearMap[y].ht += ht; yearMap[y].ttc += ttc;
    }
    const months = Object.entries(monthMap).map(([key, v]) => {
      const [y, m] = key.split('-');
      return { key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`, ...v };
    }).sort((a, b) => b.key.localeCompare(a.key));
    const years = Object.entries(yearMap).map(([y, v]) => ({ key: y, label: y, ...v })).sort((a, b) => b.key.localeCompare(a.key));
    return { months, years };
  }, [totals]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, color: C.greyT, fontSize: 13 }}>Total payé à La Poste (Lettre Suivie & services), par mois et par année.</p>
        <button onClick={loadTotals} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>↻ Actualiser</button>
      </div>
      {totalsLoading ? (
        <div style={{ textAlign: 'center', padding: 30, color: C.greyT }}>Chargement…</div>
      ) : months.length === 0 && years.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>Aucune donnée. Enregistrez des factures pour voir les totaux.</div>
      ) : (
        <>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Évolution mensuelle (TTC)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={[...months].reverse()} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                <Tooltip formatter={v => fmtEur(v)} />
                <Line type="monotone" dataKey="ttc" name="Total payé TTC" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Mois" /><Th label="HT" align="right" /><Th label="TTC" align="right" /></tr></thead>
                <tbody>
                  {months.map((m, i) => (
                    <tr key={m.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td>{m.label}</Td><Td align="right">{fmtEur(m.ht)}</Td><Td align="right" bold>{fmtEur(m.ttc)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par année</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Année" /><Th label="HT" align="right" /><Th label="TTC" align="right" /></tr></thead>
                <tbody>
                  {years.map((y, i) => (
                    <tr key={y.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{y.label}</Td><Td align="right">{fmtEur(y.ht)}</Td><Td align="right" bold color={C.accent}>{fmtEur(y.ttc)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function LettreSuivieApp() {
  const { token } = useContext(AuthContext);
  const fileRef = useRef(null);
  const zipRef = useRef(null);
  const [importingZip, setImportingZip] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('detail');
  const [search, setSearch] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [totals, setTotals] = useState(null);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [homeTab, setHomeTab] = useState('historique');

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/lettre-suivie/history`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setHistory(data.invoices);
    } catch { /* silently */ } finally { setHistoryLoading(false); }
  }
  async function loadTotals() {
    setTotalsLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/lettre-suivie/totals`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setTotals(data);
    } catch { /* silently */ } finally { setTotalsLoading(false); }
  }
  useEffect(() => { loadHistory(); loadTotals(); }, []);

  async function handleZip(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { setError('Fichier ZIP requis.'); return; }
    setImportingZip(true); setImportResult(null); setError(null);
    try {
      const fd = new FormData(); fd.append('zip', file);
      const { data } = await axios.post(`${API_URL}/lettre-suivie/import-zip`, fd, { headers: { Authorization: `Bearer ${token}` }, timeout: 600000 });
      if (!data.success) throw new Error(data.error);
      setImportResult(data); loadHistory(); loadTotals();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setImportingZip(false); if (zipRef.current) zipRef.current.value = ''; }
  }

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('Fichier PDF requis.'); return; }
    setCurrentFile(file); setError(null); setResult(null); setSaveState(null); setLoading(true);
    try {
      const fd = new FormData(); fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/lettre-suivie/analyze`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setResult(data); setTab('detail');
      if (data.invoiceNumber && history.some(h => h.invoice_number === data.invoiceNumber)) setSaveState('already');
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }

  async function handleLoadFromHistory(inv) {
    setLoading(true); setError(null); setCurrentFile(null);
    try {
      const { data } = await axios.get(`${API_URL}/lettre-suivie/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error);
      setResult({ ...data.parsed, _fromHistory: true });
      setSaveState('already'); setTab('detail');
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  function handleBackToHome() {
    setResult(null); setCurrentFile(null); setError(null); setSaveState(null); setSearch(''); setTab('detail');
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify(result));
      if (currentFile) fd.append('pdf', currentFile);
      const { data } = await axios.post(`${API_URL}/lettre-suivie/save`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) {
        setSaveState(data.already_saved ? 'already' : 'saved');
        if (!data.already_saved) { loadHistory(); loadTotals(); }
      }
    } catch (e) { setError(e.response?.data?.error || "Erreur lors de l'enregistrement"); }
    finally { setSaving(false); }
  }

  async function handleDeleteInvoice(inv, e) {
    e.stopPropagation();
    if (!window.confirm(`Supprimer la facture ${inv.invoice_number} ?`)) return;
    try {
      await axios.delete(`${API_URL}/lettre-suivie/history/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (result?.invoiceNumber === inv.invoice_number) handleBackToHome();
      loadHistory(); loadTotals();
    } catch { setError('Erreur lors de la suppression'); }
  }

  function handleDownloadPdf(inv, e) {
    e.stopPropagation();
    fetch(`${API_URL}/lettre-suivie/history/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `LettreSuivie_${inv.invoice_number}.pdf`; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setError('PDF non disponible pour cette facture'));
  }

  async function handleExport() {
    if (!currentFile) return;
    setExporting(true);
    try {
      const fd = new FormData(); fd.append('pdf', currentFile);
      const resp = await axios.post(`${API_URL}/lettre-suivie/export-excel`, fd, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a'); a.href = url; a.download = result?.invoiceNumber ? `LettreSuivie_${result.invoiceNumber}.xlsx` : 'LettreSuivie.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Erreur export Excel.'); }
    finally { setExporting(false); }
  }

  const lines = result?.lines || [];
  const tierSummary = result?.tierSummary || [];
  const commands = result?.commands || [];
  const prestationDates = result?.prestationDates || [];
  const stats = result?.stats || {};

  const filteredLines = lines.filter(l =>
    !search || (l.tier || '').toLowerCase().includes(search.toLowerCase()) || String(l.montant).includes(search)
  );
  const lineSort = useSorted(filteredLines, LINE_SORTERS);
  const tierSort = useSorted(tierSummary, TIER_SORTERS);

  return (
    <AppShell currentPath="/lettre-suivie">
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 20px' }}>

        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: C.dark, margin: 0 }}>Analyse facture Lettre Suivie</h1>
          <p style={{ color: C.greyT, margin: '5px 0 0', fontSize: 13 }}>
            Importe une facture PDF La Poste pour extraire le détail des affranchissements (tranches de poids, quantités, montants) et suivre les dépenses dans le temps.
          </p>
        </div>

        {/* Upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? C.accent : C.greyB}`, borderRadius: 14, background: dragging ? C.accentL : C.grey, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 22 }}
        >
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 36, marginBottom: 10 }}>✉️</div>
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
            {/* Meta + actions */}
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <button onClick={handleBackToHome} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: C.greyT, cursor: 'pointer', marginRight: 12 }}>← Retour à l'accueil</button>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>Facture {result.invoiceNumber}</span>
                {result.invoiceDate && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>du {result.invoiceDate}</span>}
                {(result.periodRange || result.periodDate) && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>conso. {result.periodRange || result.periodDate}</span>}
                {result.contractNumber && <span style={{ color: C.greyT, fontSize: 12.5, marginLeft: 12 }}>{result.contractType} {result.contractNumber}</span>}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                {saveState === 'saved' && <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓ Facture enregistrée</span>}
                {saveState === 'already' && <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>⚠ Déjà enregistrée</span>}
                {saveState === null && <button onClick={handleSave} disabled={saving} style={{ background: C.green, color: C.white, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: saving ? .7 : 1 }}>{saving ? '⏳ Enregistrement…' : '💾 Enregistrer la facture'}</button>}
                {currentFile && <button onClick={handleExport} disabled={exporting} style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? .7 : 1 }}>{exporting ? '⏳ Export…' : '⬇️ Télécharger Excel'}</button>}
              </div>
            </div>

            {/* Réconciliation */}
            {stats.reconcile_ok === false && (
              <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 12.5, marginBottom: 16 }}>
                ⚠️ Écart de réconciliation : somme des lignes ({fmtEur(stats.lines_total)}) ≠ total HT facture ({fmtEur(result.totalHT)}). Vérifie le PDF.
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
              <StatCard value={fmtEur(result.totalHT)} label="Total HT" />
              <StatCard value={fmtEur(result.totalTVA)} label={`TVA${result.tvaRate ? ` (${result.tvaRate}%)` : ''}`} color={result.totalTVA > 0 ? C.orange : C.greyT} />
              <StatCard value={fmtEur(result.totalTTC)} label="Total TTC" color={C.blue} />
              <StatCard value={stats.nb_lettres ?? '—'} label="Lettres" color={C.dark} />
              <StatCard value={stats.nb_lines ?? '—'} label="Lignes" color={C.dark} />
              {stats.reconcile_ok && <StatCard value="✓" label="Réconcilié" color={C.green} />}
            </div>

            {/* Tabs */}
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', borderBottom: `1px solid ${C.greyB}`, padding: '0 14px', flexWrap: 'wrap' }}>
                <TabBtn label="Détail des lignes" active={tab === 'detail'} onClick={() => setTab('detail')} badge={lines.length} />
                <TabBtn label="Par tranche" active={tab === 'tranche'} onClick={() => setTab('tranche')} badge={tierSummary.length} />
                {result.format === 'A' && <TabBtn label="Commandes" active={tab === 'commandes'} onClick={() => setTab('commandes')} badge={commands.length} />}
                {result.format === 'B' && <TabBtn label="Dates de prestation" active={tab === 'commandes'} onClick={() => setTab('commandes')} badge={prestationDates.length} />}
                <TabBtn label="Résumé" active={tab === 'resume'} onClick={() => setTab('resume')} />
                <TabBtn label="Historique" active={tab === 'historique'} onClick={() => setTab('historique')} badge={history.length} />
              </div>

              {/* DÉTAIL */}
              {tab === 'detail' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <input placeholder="Rechercher une tranche / montant…" value={search} onChange={e => setSearch(e.target.value)}
                      style={{ padding: '7px 11px', border: `1px solid ${C.greyB}`, borderRadius: 8, fontSize: 13, flex: 1, minWidth: 180 }} />
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>
                        <Th label="Tranche de poids" sortKey="tier" sort={lineSort.sort} onSort={lineSort.toggle} />
                        <Th label="Quantité" align="right" sortKey="qty" sort={lineSort.sort} onSort={lineSort.toggle} />
                        <Th label="Prix unitaire" align="right" sortKey="pu" sort={lineSort.sort} onSort={lineSort.toggle} />
                        <Th label="Montant HT" align="right" sortKey="montant" sort={lineSort.sort} onSort={lineSort.toggle} />
                      </tr></thead>
                      <tbody>
                        {lineSort.sorted.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Aucune ligne</td></tr>}
                        {lineSort.sorted.map((l, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                            <Td><span style={{ background: C.accentL, color: C.accent, padding: '2px 8px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>{l.tier}</span></Td>
                            <Td align="right" bold>{l.qty ?? '—'}</Td>
                            <Td align="right" color={C.greyT}>{fmtEur(l.pu)}</Td>
                            <Td align="right" bold>{fmtEur(l.montant)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.dark }}>
                    Total HT : <span style={{ color: C.accent }}>{fmtEur(filteredLines.reduce((s, l) => s + (l.montant || 0), 0))}</span>
                  </div>
                </div>
              )}

              {/* PAR TRANCHE */}
              {tab === 'tranche' && (
                <div style={{ padding: 18 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>
                        <Th label="Tranche de poids" sortKey="tier" sort={tierSort.sort} onSort={tierSort.toggle} />
                        <Th label="Prix unitaire" align="right" sortKey="pu" sort={tierSort.sort} onSort={tierSort.toggle} />
                        <Th label="Lettres" align="right" sortKey="qty" sort={tierSort.sort} onSort={tierSort.toggle} />
                        <Th label="Lignes" align="right" sortKey="count" sort={tierSort.sort} onSort={tierSort.toggle} />
                        <Th label="Montant HT" align="right" sortKey="montant" sort={tierSort.sort} onSort={tierSort.toggle} />
                      </tr></thead>
                      <tbody>
                        {tierSort.sorted.map((t, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                            <Td bold>{t.tier}</Td>
                            <Td align="right" color={C.greyT}>{fmtEur(t.pu)}</Td>
                            <Td align="right" bold>{t.qty}</Td>
                            <Td align="right" color={C.greyT}>{t.count}</Td>
                            <Td align="right" bold color={C.accent}>{fmtEur(t.montant)}</Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: `2px solid ${C.greyB}`, background: C.grey }}>
                          <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL</td>
                          <td />
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>{tierSummary.reduce((s, t) => s + (t.qty || 0), 0)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: C.greyT }}>{tierSummary.reduce((s, t) => s + (t.count || 0), 0)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: C.accent }}>{fmtEur(tierSummary.reduce((s, t) => s + (t.montant || 0), 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* COMMANDES / DATES */}
              {tab === 'commandes' && (
                <div style={{ padding: 18 }}>
                  {result.format === 'A' ? (
                    commands.length === 0 ? <div style={{ textAlign: 'center', padding: 36, color: C.greyT }}>Aucune commande.</div> : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead><tr><Th label="N° Commande (SAF)" /><Th label="Date" /></tr></thead>
                          <tbody>
                            {commands.map((c, i) => (
                              <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                                <Td bold>{c.saf}</Td>
                                <Td color={C.greyT}>{c.date}{c.dateEnd ? ` → ${c.dateEnd}` : ''}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : (
                    prestationDates.length === 0 ? <div style={{ textAlign: 'center', padding: 36, color: C.greyT }}>Aucune date de prestation.</div> : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {prestationDates.sort().map((d, i) => (
                          <span key={i} style={{ background: C.blueL, color: C.blue, padding: '5px 12px', borderRadius: 16, fontSize: 12.5, fontWeight: 600 }}>{d}</span>
                        ))}
                      </div>
                    )
                  )}
                </div>
              )}

              {/* RÉSUMÉ */}
              {tab === 'resume' && (
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 14 }}>
                    {[
                      { label: 'Facture n°', value: result.invoiceNumber, color: C.dark },
                      { label: 'Date facture', value: result.invoiceDate || '—', color: C.dark },
                      { label: 'Période consommée', value: result.periodRange || result.periodDate || '—', color: C.dark },
                      { label: 'Contrat', value: `${result.contractType || ''} ${result.contractNumber || ''}`.trim() || '—', color: C.dark },
                      { label: 'N° client', value: result.clientNumber || '—', color: C.greyT },
                      { label: 'Total HT', value: fmtEur(result.totalHT), color: C.dark },
                      { label: `TVA${result.tvaRate ? ` (${result.tvaRate}%)` : ''}`, value: fmtEur(result.totalTVA), color: C.orange },
                      { label: 'Total TTC', value: fmtEur(result.totalTTC), color: C.blue },
                      { label: 'Lettres facturées', value: stats.nb_lettres ?? '—', color: C.dark },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: C.grey, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.greyB}` }}>
                        <div style={{ fontSize: 11.5, color: C.greyT, marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* HISTORIQUE */}
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

        {/* Accueil (sans facture chargée) */}
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
