import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Promos as PromosIcon } from '../components/AppIcons';
import { STATUSES, statusInfo, toYmd } from './PromosApp';
import PromoAnalysis from '../components/promos/PromoAnalysis';
import PromoProductPicker from '../components/promos/PromoProductPicker';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  promo: '#DB2777', promoF: '#9D174D',
  vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const eur = (v, d = 2) => (v === null || v === undefined || v === '' ? '—'
  : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + ' €');
const pct = (v, d = 1) => (v === null || v === undefined ? '—'
  : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + ' %');
const int = (v) => new Intl.NumberFormat('fr-FR').format(parseInt(v, 10) || 0);

/** Couleur d'une marge : rouge sous 0, orange sous 15 %, vert au-delà. */
const marginColor = (p) => (p === null || p === undefined ? C.grisM : p < 0 ? C.rouge : p < 15 ? C.orange : C.vert);

/**
 * Retour visuel de l'enregistrement automatique. L'app n'a volontairement pas de
 * bouton « Enregistrer » : sans ce témoin, le badge de statut « Brouillon » se lit
 * à tort comme « non enregistré ».
 */
function SaveIndicator({ state, at }) {
  if (state === 'idle') {
    return (
      <span style={{ fontSize: 11, color: C.grisM, whiteSpace: 'nowrap' }}>
        Enregistrement automatique
      </span>
    );
  }
  const saving = state === 'saving';
  const hhmm = at ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      fontSize: 11, fontWeight: 700, color: saving ? C.grisM : C.vert,
      background: saving ? C.grisTL : '#ECFDF3', border: `1px solid ${saving ? C.grisCL : '#B7E4C7'}`,
      borderRadius: 20, padding: '4px 11px',
    }}>
      {saving ? 'Enregistrement…' : `✓ Enregistré${hhmm ? ` à ${hhmm}` : ''}`}
    </span>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: C.grisM, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.grisM, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const PromoDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [operation, setOperation] = useState(null);
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('prep');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkPct, setBulkPct] = useState('');
  // Tout est enregistré à la volée : cet état sert uniquement à le montrer.
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved
  const [savedAt, setSavedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({}); // saisies en cours : { [itemId]: { discount, promo } }

  /**
   * Enveloppe d'enregistrement : l'app n'a pas de bouton « Enregistrer », chaque
   * saisie part immédiatement en base. Sans retour visuel, l'utilisateur croit
   * que rien n'est sauvegardé (le badge « Brouillon » est un statut de workflow,
   * pas un état d'enregistrement).
   */
  const autosave = useCallback(async (fn) => {
    setSaveState('saving');
    try {
      await fn();
      setSavedAt(new Date());
      setSaveState('saved');
    } catch (err) {
      setSaveState('idle');
      throw err;
    }
  }, []);

  const fetchOperation = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/promos/${id}`);
      setOperation(res.data.data.operation);
      setItems(res.data.data.items || []);
      setTotals(res.data.data.totals || null);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchOperation(); }, [fetchOperation]);

  const saveOperation = async (patch) => {
    setOperation((o) => ({ ...o, ...patch }));
    try {
      await autosave(() => axios.put(`${API_URL}/promos/${id}`, patch));
      // Le taux de TVA et la base de remise changent tous les calculs de marge.
      if ('vat_rate' in patch || 'base_price_mode' in patch) fetchOperation();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à l\'enregistrement');
      fetchOperation();
    }
  };

  const saveItem = async (itemId, patch) => {
    try {
      await autosave(() => axios.put(`${API_URL}/promos/${id}/items/${itemId}`, patch));
      setDrafts((d) => { const n = { ...d }; delete n[itemId]; return n; });
      fetchOperation();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à l\'enregistrement');
    }
  };

  const removeItem = async (itemId) => {
    try {
      await autosave(() => axios.delete(`${API_URL}/promos/${id}/items/${itemId}`));
      fetchOperation();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la suppression');
    }
  };

  const applyBulk = async () => {
    const v = parseFloat(String(bulkPct).replace(',', '.'));
    if (!Number.isFinite(v)) return;
    if (!window.confirm(`Appliquer −${v} % à l'ensemble des ${items.length} produit(s) ? Les prix promo saisis à la main seront écrasés.`)) return;
    try {
      await autosave(() => axios.put(`${API_URL}/promos/${id}/items/bulk-discount`, { discount_percent: v }));
      setBulkPct('');
      fetchOperation();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur');
    }
  };

  const addProducts = async (wpIds) => {
    if (wpIds.length === 0) return;
    try {
      await autosave(() => axios.post(`${API_URL}/promos/${id}/items`, { wp_product_ids: wpIds }));
      fetchOperation();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à l\'ajout');
    }
  };

  const exportCsv = async () => {
    try {
      const res = await axios.get(`${API_URL}/promos/${id}/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `promo-${(operation?.name || 'operation').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Erreur à l\'export');
    }
  };

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      (i.display_name || '').toLowerCase().includes(q) ||
      (i.sku || '').toLowerCase().includes(q) ||
      (i.brand || '').toLowerCase().includes(q) ||
      (i.sub_brand || '').toLowerCase().includes(q));
  }, [items, search]);

  const inputStyle = {
    padding: '7px 9px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const th = { padding: '9px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.grisM, borderBottom: `2px solid ${C.grisCL}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: C.blanc, zIndex: 2 };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '9px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisCL}` };
  const tdR = { ...td, textAlign: 'right', fontFamily: 'monospace' };

  if (loading) {
    return (
      <AppShell currentPath="/promos">
        <main style={{ flex: 1, padding: 40, background: C.grisTL, height: '100vh' }}>
          <div style={{ color: C.grisM }}>Chargement…</div>
        </main>
      </AppShell>
    );
  }

  if (error || !operation) {
    return (
      <AppShell currentPath="/promos">
        <main style={{ flex: 1, padding: 40, background: C.grisTL, height: '100vh' }}>
          <div style={{ padding: 14, borderRadius: 10, background: '#FEE', color: C.rouge, fontSize: 13 }}>{error || 'Opération introuvable'}</div>
          <button onClick={() => navigate('/promos')} style={{ marginTop: 16, padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, cursor: 'pointer' }}>
            ← Retour
          </button>
        </main>
      </AppShell>
    );
  }

  const st = statusInfo(operation.status);

  return (
    <AppShell currentPath="/promos">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        {/* En-tête */}
        <section style={{ padding: '20px 40px 0', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <button onClick={() => navigate('/promos')}
            style={{ background: 'none', border: 'none', color: C.grisM, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
            ← Toutes les opérations
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.promo, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24 }}>
              <PromosIcon />
            </div>
            <input
              value={operation.name}
              onChange={(e) => setOperation({ ...operation, name: e.target.value })}
              onBlur={(e) => saveOperation({ name: e.target.value.trim() || 'Sans nom' })}
              style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive", border: 'none', outline: 'none', background: 'transparent', minWidth: 260, flex: 1 }}
            />
            <SaveIndicator state={saveState} at={savedAt} />
            <span title="Statut d'avancement de l'opération — sans rapport avec l'enregistrement, qui est automatique"
              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#fff', background: st.color }}>
              {st.label}
            </span>
          </div>

          {/* Réglages de l'opération */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 0 18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Statut</label>
              <select value={operation.status} onChange={(e) => saveOperation({ status: e.target.value })} style={inputStyle}>
                {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Début</label>
              <input type="date" value={toYmd(operation.start_date)} onChange={(e) => saveOperation({ start_date: e.target.value || null })} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Fin</label>
              <input type="date" value={toYmd(operation.end_date)} onChange={(e) => saveOperation({ end_date: e.target.value || null })} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }} title="Base sur laquelle s'applique le pourcentage de remise saisi">
                Remise appliquée sur
              </label>
              <select value={operation.base_price_mode} onChange={(e) => saveOperation({ base_price_mode: e.target.value })} style={inputStyle}>
                <option value="price">Prix de vente public</option>
                <option value="discounted">Tarif déjà remisé</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>TVA</label>
              <select value={String(parseFloat(operation.vat_rate))} onChange={(e) => saveOperation({ vat_rate: parseFloat(e.target.value) })} style={{ ...inputStyle, width: 90 }}>
                <option value="20">20 %</option>
                <option value="5.5">5,5 %</option>
                <option value="0">0 %</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Description</label>
              <input value={operation.description || ''}
                onChange={(e) => setOperation({ ...operation, description: e.target.value })}
                onBlur={(e) => saveOperation({ description: e.target.value })} style={inputStyle} />
            </div>
          </div>

          {/* Onglets */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[{ k: 'prep', label: 'Préparation' }, { k: 'analysis', label: 'Analyse des ventes' }].map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                style={{
                  padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, color: tab === t.k ? C.promo : C.grisM,
                  borderBottom: `3px solid ${tab === t.k ? C.promo : 'transparent'}`, marginBottom: -1,
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'prep' ? (
          <section style={{ padding: '20px 40px 60px' }}>
            {/* KPIs */}
            {totals && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                <StatCard label="Produits" value={int(totals.items_count)} sub={`${int(totals.sales_30d)} u. vendues sur 30 j`} />
                <StatCard label="Remise moyenne" value={totals.avg_discount ? `−${pct(totals.avg_discount)}` : '—'} accent={C.promo} />
                <StatCard label="Stock concerné" value={int(totals.stock)} sub={`valeur ${eur(totals.stock_value_ht, 0)} HT`} />
                <StatCard label="Marge si tout est vendu" value={eur(totals.stock_margin_promo, 0)}
                  sub={`sans promo : ${eur(totals.stock_margin_current, 0)}`}
                  accent={C.grisTF} />
                <StatCard label="Coût de la remise" value={eur(totals.stock_margin_delta, 0)}
                  sub="marge sacrifiée sur le stock actuel" accent={totals.stock_margin_delta < 0 ? C.rouge : C.vert} />
                {totals.below_cost > 0 && (
                  <StatCard label="À perte" value={int(totals.below_cost)} sub="produits sous le prix de revient" accent={C.rouge} />
                )}
              </div>
            )}

            {/* Barre d'actions */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <button onClick={() => setPickerOpen(true)}
                style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: C.promo, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                + Ajouter des produits
              </button>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrer la sélection…"
                style={{ ...inputStyle, minWidth: 200 }} />
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} placeholder="%" inputMode="decimal"
                  style={{ ...inputStyle, width: 70, textAlign: 'right' }} />
                <button onClick={applyBulk} disabled={!bulkPct}
                  style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, fontSize: 13, cursor: 'pointer', opacity: bulkPct ? 1 : 0.5 }}>
                  Appliquer à tous
                </button>
              </div>
              <button onClick={exportCsv}
                style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, fontSize: 13, cursor: 'pointer' }}>
                Export CSV
              </button>
            </div>

            {items.length === 0 ? (
              <div style={{ background: C.blanc, border: `1px dashed ${C.grisCL}`, borderRadius: 14, padding: 40, textAlign: 'center', color: C.grisM }}>
                Aucun produit dans cette opération. Cliquez sur « Ajouter des produits » pour composer votre sélection.
              </div>
            ) : (
              <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Produit</th>
                      <th style={thR}>Stock</th>
                      <th style={thR} title="Unités vendues sur les 30 derniers jours">Ventes 30 j</th>
                      <th style={thR} title="Prix d'achat HT (PMP FIFO, sinon coût WooCommerce)">Prix achat HT</th>
                      <th style={thR}>Prix vente TTC</th>
                      <th style={thR} title="Tarif remisé actuellement actif (Woo Discount Rules)">Tarif remisé</th>
                      <th style={thR} title="Marge au tarif actuellement appliqué">Marge actuelle</th>
                      <th style={{ ...thR, background: '#FDF2F8' }}>Remise %</th>
                      <th style={{ ...thR, background: '#FDF2F8' }}>Prix promo TTC</th>
                      <th style={{ ...thR, background: '#FDF2F8' }}
                        title="Écart total entre le prix sans remise (prix barré s'il existe, sinon prix de vente) et le prix promo TTC">
                        Remise totale
                      </th>
                      <th style={{ ...thR, background: '#FDF2F8' }}>Marge promo</th>
                      <th style={thR}>Δ marge / u.</th>
                      <th style={th}>Note</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((it) => {
                      const draft = drafts[it.id] || {};
                      // numeric pg -> '30.00' : on affiche '30' pour rester lisible à la saisie.
                      const discountVal = draft.discount !== undefined
                        ? draft.discount
                        : String(parseFloat(it.discount_percent ?? 0));
                      const promoVal = draft.promo !== undefined ? draft.promo
                        : String(it.promo_price ?? it.promo_price_ttc ?? '');
                      return (
                        <tr key={it.id} style={{ background: it.below_cost ? '#FFF5F5' : undefined }}>
                          <td style={{ ...td, minWidth: 240 }}>
                            <div style={{ fontWeight: 600 }}>{it.display_name}</div>
                            <div style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>
                              {it.sku}{it.brand ? ` · ${it.brand}` : ''}{it.sub_brand ? ` › ${it.sub_brand}` : ''}
                            </div>
                          </td>
                          <td style={{ ...tdR, color: it.stock <= 0 ? C.rouge : C.grisTF }}>{int(it.stock)}</td>
                          <td style={tdR}>{int(it.sales_30d)}</td>
                          <td style={tdR}>{eur(it.cost_price)}</td>
                          <td style={tdR}>{eur(it.price)}</td>
                          <td style={{ ...tdR, color: it.discounted_price ? C.orange : C.grisM }}>
                            {it.discounted_price ? eur(it.discounted_price) : '—'}
                          </td>
                          <td style={{ ...tdR, color: marginColor(it.current_margin_pct) }}>
                            {eur(it.current_margin_eur)}<br />
                            <span style={{ fontSize: 11 }}>{pct(it.current_margin_pct)}</span>
                          </td>
                          <td style={{ ...tdR, background: '#FDF2F8' }}>
                            <input
                              value={discountVal}
                              inputMode="decimal"
                              onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { discount: e.target.value } }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              onBlur={(e) => {
                                const v = parseFloat(String(e.target.value).replace(',', '.'));
                                const next = Number.isFinite(v) ? v : 0;
                                if (next === parseFloat(it.discount_percent) && it.promo_price === null) {
                                  setDrafts((d) => { const n = { ...d }; delete n[it.id]; return n; });
                                  return;
                                }
                                saveItem(it.id, { discount_percent: next });
                              }}
                              style={{ ...inputStyle, width: 62, textAlign: 'right', fontFamily: 'monospace' }}
                            />
                          </td>
                          <td style={{ ...tdR, background: '#FDF2F8' }}>
                            <input
                              value={promoVal}
                              inputMode="decimal"
                              title="Saisir un prix ici force ce tarif (prioritaire sur le pourcentage)"
                              onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { promo: e.target.value } }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              onBlur={(e) => {
                                if (draft.promo === undefined) return;
                                const raw = String(e.target.value).trim();
                                const v = parseFloat(raw.replace(',', '.'));
                                saveItem(it.id, { promo_price: raw === '' || !Number.isFinite(v) ? null : v });
                              }}
                              style={{ ...inputStyle, width: 80, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: C.promoF }}
                            />
                          </td>
                          <td style={{ ...tdR, background: '#FDF2F8', color: C.promoF, fontWeight: 700 }}
                            title={it.undiscounted_price !== it.price
                              ? `Prix sans remise ${it.undiscounted_price} € (le prix de vente est déjà soldé)`
                              : undefined}>
                            {it.total_discount_percent === null ? '—' : `−${pct(it.total_discount_percent)}`}
                            {it.undiscounted_price !== it.price && (
                              <div style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>
                                sur {eur(it.undiscounted_price)}
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdR, background: '#FDF2F8', color: marginColor(it.promo_margin_pct), fontWeight: 700 }}>
                            {eur(it.promo_margin_eur)}<br />
                            <span style={{ fontSize: 11 }}>{pct(it.promo_margin_pct)}</span>
                          </td>
                          <td style={{ ...tdR, color: it.margin_delta_eur < 0 ? C.rouge : C.vert }}>
                            {it.margin_delta_eur === null ? '—' : `${it.margin_delta_eur > 0 ? '+' : ''}${eur(it.margin_delta_eur)}`}
                          </td>
                          <td style={{ ...td, minWidth: 130 }}>
                            <input
                              defaultValue={it.note || ''}
                              placeholder="…"
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              onBlur={(e) => { if (e.target.value !== (it.note || '')) saveItem(it.id, { note: e.target.value }); }}
                              style={{ ...inputStyle, width: '100%', minWidth: 110 }}
                            />
                          </td>
                          <td style={td}>
                            <button onClick={() => removeItem(it.id)} title="Retirer de l'opération"
                              style={{ border: 'none', background: 'none', color: C.grisM, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p style={{ fontSize: 11, color: C.grisM, marginTop: 12, maxWidth: 900 }}>
              Marges calculées hors taxes : le prix de vente TTC est ramené en HT au taux choisi, puis comparé au prix
              d'achat HT (PMP FIFO, sinon coût WooCommerce). Les frais de port et les frais de paiement ne sont pas déduits.
              Cette opération est une simulation : aucun prix n'est envoyé vers le site.
            </p>
          </section>
        ) : (
          <PromoAnalysis operationId={id} operation={operation} />
        )}

        {pickerOpen && (
          <PromoProductPicker
            operationId={id}
            onClose={() => setPickerOpen(false)}
            onAdd={async (ids) => { await addProducts(ids); }}
          />
        )}
      </main>
    </AppShell>
  );
};

export default PromoDetail;
