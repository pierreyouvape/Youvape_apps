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

  useEffect(() => { loadHistory(); }, []);

  // Charge une facture depuis l'historique BDD et l'affiche comme si elle venait d'être analysée
  async function handleLoadFromHistory(inv) {
    setLoading(true);
    setError(null);
    setCurrentFile(null);
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
        is_return:     p.is_return,
        weight_corrected: p.weight_corrected,
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
      setTab('poids');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
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
      }
      loadHistory();
    } catch (e) {
      setError('Erreur lors de la suppression');
    }
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
                <TabBtn label="Historique" active={tab === 'historique'} onClick={() => setTab('historique')} badge={history.length} />
              </div>

              {/* ── TAB POIDS */}
              {tab === 'poids' && (
                <div style={{ padding: 20 }}>
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
                          {['N° Commande', 'Date', 'N° Suivi', 'Poids BDD', 'Poids Chrono', 'Écart', 'Statut'].map(h => (
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
                              {o.order_id}
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
                            <td style={{ padding: '9px 12px' }}>
                              {o.is_return && <Badge label="Retour" color={C.orange} bg={C.orangeL} />}
                              {o.weight_corrected && <Badge label="Corrigé" color={C.accent} bg={C.accentL} />}
                              {!o.is_return && !o.weight_corrected && o.diff_g !== null && Math.abs(o.diff_g) <= 20 && (
                                <Badge label="OK" color={C.green} bg={C.greenL} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ color: C.greyT, fontSize: 12, marginTop: 10 }}>
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
                            {['N° Facture', 'Date', 'Colis', 'Cmdés trouvées', 'Poids OK', 'Écarts', 'Total HT', 'Suppléments HT', 'Enregistrée le', ''].map(h => (
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
                            <td colSpan={5} />
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
                      <tr style={{ background: C.grey }}>
                        {['N° Facture', 'Date', 'Colis', 'Total HT', 'Suppléments HT', 'Enregistrée le', ''].map(h => (
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
          </div>
        )}
      </div>
    </AppShell>
  );
}
