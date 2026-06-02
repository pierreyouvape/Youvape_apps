import { useState, useRef, useContext } from 'react';
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
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState('poids');
  const [search, setSearch] = useState('');
  const [filterPoids, setFilterPoids] = useState('all');
  const [currentFile, setCurrentFile] = useState(null);

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') { setError('Fichier PDF requis.'); return; }
    setCurrentFile(file); setError(null); setResult(null); setLoading(true);
    try {
      const fd = new FormData(); fd.append('pdf', file);
      const { data } = await axios.post(`${API_URL}/colissimo/analyze`, fd, { headers: { Authorization: `Bearer ${token}` } });
      if (!data.success) throw new Error(data.error || 'Erreur analyse');
      setResult(data); setTab('poids');
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
              </div>
              <button onClick={handleExport} disabled={exporting} style={{ background: C.accent, color: C.white, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? .7 : 1 }}>
                {exporting ? '⏳ Export…' : '⬇️ Télécharger Excel'}
              </button>
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
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
