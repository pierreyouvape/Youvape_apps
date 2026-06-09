import { useState, useRef, useContext, useEffect } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

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
function fmtEur(v) { return v !== null && v !== undefined ? `${parseFloat(v).toFixed(2)} €` : '—'; }
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

function Th({ label, align = 'left' }) {
  return <th style={{ padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{label}</th>;
}

function Td({ children, align = 'left', bg, color, bold }) {
  return <td style={{ padding: '8px 12px', textAlign: align, background: bg, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13 }}>{children}</td>;
}

export default function ColissimoApp() {
  const { token } = useContext(AuthContext);
  const fileRef = useRef(null);
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
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyResult, setApplyResult] = useState(null); // {updated, skipped}

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/colissimo/history`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setHistory(data.invoices);
    } catch { /* silently fail */ }
    finally { setHistoryLoading(false); }
  }

  useEffect(() => { loadHistory(); }, []);

  // Charge une facture depuis l'historique BDD et la réaffiche comme si elle venait d'être analysée
  async function handleLoadFromHistory(inv) {
    setLoading(true); setError(null); setCurrentFile(null); setApplyResult(null);
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
      setTab('poids');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
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
        if (!data.already_saved) loadHistory();
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
      if (result?.invoiceNumber === inv.invoice_number) { setResult(null); setSaveState(null); setCurrentFile(null); }
      loadHistory();
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
      const { data } = await axios.post(`${API_URL}/colissimo/apply-tariffs`, { tariffs }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      clearInterval(timer);
      setApplyProgress(100);
      if (data.success) setApplyResult(data);
      else setError(data.error);
    } catch (e) {
      clearInterval(timer);
      setApplyProgress(0);
      setError(e.response?.data?.error || 'Délai dépassé — réessaie');
    } finally { setApplying(false); }
  }

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('Fichier PDF requis.'); return; }
    setCurrentFile(file); setError(null); setResult(null); setSaveState(null); setApplyResult(null); setLoading(true);
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

        {error && <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 10, padding: '11px 15px', color: C.red, fontSize: 13, marginBottom: 18 }}>⚠️ {error}</div>}

        {result && (
          <>
            {/* Meta + export */}
            <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
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
                {applyResult ? (
                  <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>
                    ✓ {applyResult.updated} commande(s) mise(s) à jour
                    {applyResult.skipped > 0 && ` (${applyResult.skipped} ignorées)`}
                  </span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 230 }}>
                    <button
                      onClick={handleApplyTariffs}
                      disabled={applying || !parcels.filter(p => p.order_id && p.total_ht != null).length}
                      title="Remplace le Coût livraison HT de chaque commande par le Total HT indiqué sur la facture"
                      style={{ background: '#7C3AED', color: C.white, border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: applying ? 'wait' : 'pointer', opacity: applying ? .85 : 1, width: '100%' }}
                    >
                      {applying ? `⏳ Mise à jour… ${Math.round(applyProgress)}%` : '🔄 Appliquer les tarifs aux commandes'}
                    </button>
                    {applying && (
                      <div style={{ height: 6, background: C.greyB, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #7C3AED, #A78BFA)', width: `${applyProgress}%`, transition: 'width 0.3s ease' }} />
                      </div>
                    )}
                  </div>
                )}
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
              <StatCard value={`${(stats.supplements_total || 0).toFixed(2)} €`} label="Total suppl. HT" color={C.orange} />
              <StatCard value={`${(stats.indemnizations_total || 0).toFixed(2)} €`} label="Indemnisations" color={C.blue} />
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
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr>
                        <Th label="Commande" /><Th label="Date" /><Th label="N° Suivi" />
                        <Th label="Port brut" align="right" /><Th label="Remise" align="right" /><Th label="Port net" align="right" />
                        <Th label="CAE" align="right" /><Th label="Total HT" align="right" />
                      </tr></thead>
                      <tbody>
                        {parcels.map((p, i) => (
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
                  {parcels.length > 0 && (
                    <div style={{ marginTop: 12, textAlign: 'right', fontWeight: 700, fontSize: 13, color: C.dark }}>
                      Total HT : <span style={{ color: C.accent }}>{fmtEur(parcels.reduce((s,p) => s+(p.total_ht||0), 0))}</span>
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
                            {['N° Facture', 'Période', 'Colis', 'Cmdes trouvées', 'Poids OK', 'Écarts', 'Total HT', 'Suppléments HT', 'Indemn. HT', 'Enregistrée le', ''].map(h => (
                              <Th key={h} label={h} />
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((inv, i) => (
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
                            <td colSpan={2} />
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
            <div style={{ borderBottom: `1px solid ${C.greyB}`, padding: '0 16px' }}>
              <TabBtn label="Historique des factures" active={true} onClick={() => {}} badge={history.length} />
            </div>
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
                        {['N° Facture', 'Période', 'Colis', 'Total HT', 'Suppléments HT', 'Indemn. HT', 'Enregistrée le', ''].map(h => <Th key={h} label={h} />)}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((inv, i) => (
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
          </div>
        )}
      </div>
    </AppShell>
  );
}
