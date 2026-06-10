import { useState, useRef, useContext, useEffect } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

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

function TotalsView({ totals, totalsLoading, loadTotals, totalsByPeriod }) {
  const { months, years } = totalsByPeriod;
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
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.grey }}>
                  <th style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Mois</th>
                  <th style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>Total payé HT</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={m.key} style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}` }}>
                    <td style={{ padding: '8px 12px' }}>{m.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{m.total.toFixed(2)} €</td>
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
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: C.primary }}>{y.total.toFixed(2)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

  const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  const totalsByPeriod = (() => {
    const monthMap = {};
    const yearMap = {};
    for (const inv of (totals?.invoices || [])) {
      const parts = (inv.invoice_date || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      // total_ht inclut déjà les suppléments ; global_total (charges globales) s'ajoute en plus
      const total = parseFloat(inv.total_ht || 0) + parseFloat(inv.global_total || 0);
      monthMap[monthKey] = (monthMap[monthKey] || 0) + total;
      yearMap[y] = (yearMap[y] || 0) + total;
    }
    for (const c of (totals?.credits || [])) {
      const parts = (c.credit_date || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      const amt = parseFloat(c.amount_ht || 0);
      monthMap[monthKey] = (monthMap[monthKey] || 0) + amt;
      yearMap[y] = (yearMap[y] || 0) + amt;
    }
    const months = Object.entries(monthMap)
      .map(([key, total]) => {
        const [y, m] = key.split('-');
        return { key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`, total };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
    const years = Object.entries(yearMap)
      .map(([y, total]) => ({ key: y, label: y, total }))
      .sort((a, b) => b.key.localeCompare(a.key));
    return { months, years };
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
      await axios.delete(`${API_URL}/chronopost/history/${inv.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Si la facture affichée est celle supprimée, réinitialiser
      if (result?.invoiceNumber === inv.invoice_number) {
        setResult(null); setSaveState(null); setCurrentFile(null);
        setCurrentInvoiceId(null); setTariffsAppliedAt(null); setApplyResult(null);
      }
      loadHistory();
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
                value={`${result.stats?.supplements_total_ht?.toFixed(2)} €`}
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
                <TabBtn label="Charges globales" active={tab === 'global'} onClick={() => setTab('global')} badge={globalCharges.length} />
                <TabBtn label="Avoirs" active={tab === 'avoirs'} onClick={() => setTab('avoirs')} badge={creditsHistory.length} />
                <TabBtn label="Historique" active={tab === 'historique'} onClick={() => setTab('historique')} badge={history.length} />
                <TabBtn label="Totaux" active={tab === 'totaux'} onClick={() => setTab('totaux')} />
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
                          <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{totalTarifCalcule.toFixed(2)} €</div>
                          <div style={{ fontSize: 10, color: C.greyT, marginTop: 2 }}>
                            Colis {totalParcelsHT.toFixed(2)}€ + Suppl. {totalSupplHT.toFixed(2)}€ + Pro-rata {proRataTotal.toFixed(2)}€
                          </div>
                        </div>
                        <div style={{ fontSize: 20, color: C.greyT }}>vs</div>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Total facture HT</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>{totalFactureHT.toFixed(2)} €</div>
                          <div style={{ fontSize: 10, color: C.greyT, marginTop: 2 }}>
                            Colis {totalParcelsHT.toFixed(2)}€ + Suppl. {totalSupplHT.toFixed(2)}€ + Globaux {totalGlobalHT.toFixed(2)}€
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: C.greyT, marginBottom: 2 }}>Écart</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: matchOk ? C.green : C.orange }}>
                            {ecart >= 0 ? '+' : ''}{ecart.toFixed(2)} €
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
                              {o.amount_ht != null ? `${getTarif(o).toFixed(2)} €` : '—'}
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
                                  {s.amount_ht != null ? `${s.amount_ht.toFixed(2)} €` : '—'}
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
                        {supplements.reduce((s, x) => s + (x.amount_ht || 0), 0).toFixed(2)} €
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
                                  {g.amount_ht != null ? `${g.amount_ht.toFixed(2)} €` : '—'}
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
                                {globalCharges.reduce((s, x) => s + (x.amount_ht || 0), 0).toFixed(2)} €
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
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
                                <td style={{ padding: '9px 12px' }}>{o.amount_ht != null ? `${o.amount_ht.toFixed(2)} €` : '—'}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 800, color: C.red }}>
                                  {o.amount_ht != null ? `${getCreditAmount(o).toFixed(2)} €` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: `2px solid ${C.greyB}` }}>
                              <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 700, textAlign: 'right' }}>TOTAL AVOIR</td>
                              <td style={{ padding: '10px 12px', fontWeight: 800, color: C.red, fontSize: 15 }}>
                                {creditOrders.reduce((s, o) => s + (o.amount_ht != null ? getCreditAmount(o) : 0), 0).toFixed(2)} €
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
                              <td style={{ padding: '9px 12px', fontWeight: 700, color: C.red }}>{c.total_ht != null ? `${parseFloat(c.total_ht).toFixed(2)} €` : '—'}</td>
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
                            {['N° Facture', 'Date', 'Colis', 'Cmdés trouvées', 'Poids OK', 'Écarts', 'Total HT', 'Suppléments HT', 'Tarifs', 'Enregistrée le', ''].map(h => (
                              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((inv, i) => (
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
                              <td style={{ padding: '9px 12px', fontWeight: 600 }}>{inv.total_ht != null ? `${parseFloat(inv.total_ht).toFixed(2)} €` : '—'}</td>
                              <td style={{ padding: '9px 12px', color: C.orange }}>{inv.supplements_total != null ? `${parseFloat(inv.supplements_total).toFixed(2)} €` : '—'}</td>
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
                              {history.reduce((s, inv) => s + parseFloat(inv.total_ht || 0), 0).toFixed(2)} €
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: C.orange }}>
                              {history.reduce((s, inv) => s + parseFloat(inv.supplements_total || 0), 0).toFixed(2)} €
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
                        {['N° Facture', 'Date', 'Colis', 'Total HT', 'Suppléments HT', 'Tarifs', 'Enregistrée le', ''].map(h => (
                          <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((inv, i) => (
                        <tr key={inv.id}
                          onClick={() => handleLoadFromHistory(inv)}
                          style={{ background: i % 2 === 0 ? C.white : C.grey, borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.accentL}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.white : C.grey}
                        >
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: C.primary }}>🔍 {inv.invoice_number}</td>
                          <td style={{ padding: '8px 12px', color: C.greyT }}>{inv.invoice_date || '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{inv.total_parcels}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{inv.total_ht != null ? `${parseFloat(inv.total_ht).toFixed(2)} €` : '—'}</td>
                          <td style={{ padding: '8px 12px', color: C.orange }}>{inv.supplements_total != null ? `${parseFloat(inv.supplements_total).toFixed(2)} €` : '—'}</td>
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
