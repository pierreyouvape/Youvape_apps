import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AuthContext } from '../../context/AuthContext';
import { ean13Svg } from '../../utils/ean13';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée Rapport / SAV / Réception) ───────── */
const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFEDD5',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF', zebra: '#F4F7F9',
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
// Dates Nextore : heure de Paris en texte, sans fuseau → découpées, jamais new Date()
const fmtDateTime = (s) => {
  if (!s) return 'jamais';
  const d = String(s);
  const date = d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const time = d.slice(11, 16);
  return time ? `${date} à ${time}` : date;
};
const fmtDay = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '—');
// Horodatages de l'app (timestamptz) : affichés en heure de Paris
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—');

const DORMANT_PERIODS = [3, 6, 12, 24]; // mois
const monthsToDays = (m) => Math.round((m * 365) / 12);

/* ─── PETITS COMPOSANTS (charte Réception) ──────────────── */
function Th({ children, align = 'left', width, onClick, active, dir }) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: '12px 16px', textAlign: align, width, fontWeight: 700,
        color: active ? C.primary : C.greyT, fontSize: 11.5, textTransform: 'uppercase',
        letterSpacing: 0.3, borderBottom: `2px solid ${C.greyB}`, background: C.grey,
        whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      {children}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}
function Td({ children, align = 'left', bold, color, style, onClick }) {
  return (
    <td onClick={onClick} style={{
      padding: '11px 16px', textAlign: align, color: color || C.dark,
      fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 14, ...style,
    }}>{children}</td>
  );
}
function Kpi({ label, value, sub, color = C.primary, onClick, active }) {
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Filtrer' : undefined}
      style={{
        flex: '1 1 150px', minWidth: 140, background: active ? '#EEF5F9' : C.white, borderRadius: 12,
        border: `${active ? 2 : 1}px solid ${active ? color : C.greyB}`,
        padding: active ? '13px 15px' : '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, margin: '4px 0 0' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: C.greyM, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Btn({ children, onClick, variant = 'primary', disabled, small, title }) {
  const variants = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    danger:  { background: C.red, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant], padding: small ? '5px 11px' : '9px 17px', borderRadius: 8,
      fontWeight: 600, fontSize: small ? 12.5 : 13.5,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}
function Badge({ children, color, bg }) {
  return (
    <span style={{
      marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color, background: bg, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}
const selectStyle = {
  padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5,
  background: C.white, maxWidth: 220,
};

/* Badge de variation de stock vs veille */
function Delta({ value }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  return (
    <span style={{
      marginLeft: 8, fontSize: 11.5, fontWeight: 700,
      color: up ? C.green : C.red,
    }}>
      {up ? '▲' : '▼'} {fmtNum(Math.abs(value))}
    </span>
  );
}

/* Code-barres : dessiné quand c'est un EAN-13, sinon le code seul */
function Barcode({ code }) {
  const svg = useMemo(() => {
    if (!/^\d{13}$/.test(code)) return null;
    // Taille d'origine en mm → mise à la largeur du cadre
    try { return ean13Svg(code).replace(/ width="[^"]+mm" height="[^"]+mm"/, ' width="100%"'); } catch { return null; }
  }, [code]);
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '8px 10px', border: `1px solid ${C.greyB}`, borderRadius: 8, background: C.white }}>
      {svg && (
        <div style={{ width: 180, lineHeight: 0 }}
             dangerouslySetInnerHTML={{ __html: svg.replace('<?xml version="1.0" encoding="UTF-8"?>\n', '') }} />
      )}
      <span style={{ fontFamily: 'monospace', fontSize: 13, color: C.dark }}>{code}</span>
    </div>
  );
}

/* ─── FICHE PRODUIT ─────────────────────────────────────── */
function ProductDetail({ shop, token, productId, canWrite, onClose, onChanged }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/nextore/${shop.slug}/products/${productId}`, authHeaders(token));
      setP(res.data.product);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
    }
  }, [shop.slug, token, productId]);

  useEffect(() => { load(); }, [load]);

  const toggleDisabled = async (disabled) => {
    setSaving(true);
    setError(null);
    try {
      await axios.post(`${API_URL}/nextore/${shop.slug}/products/disabled`,
        { product_ids: [productId], disabled }, authHeaders(token));
      await load();
      onChanged();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  // Courbe : points de changement (plus récent d'abord) → ordre chronologique + état actuel
  const here = p?.shops.find((s) => s.warehouse_id === Number(shop.id));
  const chart = useMemo(() => {
    if (!p?.history?.length) return [];
    const pts = [...p.history].reverse().map((h) => ({ t: new Date(h.captured_at).getTime(), stock: h.stock }));
    if (here?.stock != null) pts.push({ t: Date.now(), stock: here.stock });
    return pts;
  }, [p, here]);

  const disabled = !!p?.disabled_at;
  const others = p ? p.shops.filter((s) => s.warehouse_id !== Number(shop.id)) : [];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(17,24,39,0.45)',
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '40px 16px', overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 780, background: C.white, borderRadius: 14, padding: 24,
        boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.dark }}>{p?.name || (error ? 'Produit' : 'Chargement…')}</div>
            {p && (
              <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>
                {[p.code && `#${p.code}`, p.category_name, p.subcategory_name, p.brand].filter(Boolean).join(' · ') || '—'}
              </div>
            )}
          </div>
          <button onClick={onClose} title="Fermer" style={{
            border: 'none', background: 'transparent', fontSize: 22, color: C.greyT, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: C.redL, color: C.red, borderRadius: 8, margin: '12px 0', fontSize: 13.5 }}>
            {error}
          </div>
        )}

        {p && (
          <>
            {/* Désactivation */}
            <div style={{
              margin: '16px 0', padding: '12px 14px', borderRadius: 10,
              background: p.deleted || disabled ? C.grey : C.white, border: `1px solid ${C.greyB}`,
            }}>
              {p.deleted ? (
                <div style={{ fontSize: 13.5, color: C.greyT }}>
                  <b style={{ color: C.dark }}>Supprimé dans Nextore</b> — inactif dans toutes les boutiques tant qu'il l'est dans Nextore.
                </div>
              ) : (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 600,
                    color: C.dark, cursor: canWrite && !saving ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={disabled} disabled={!canWrite || saving || !p.in_shop}
                           onChange={(e) => toggleDisabled(e.target.checked)} />
                    Désactivé à {shop.label}
                  </label>
                  <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 6 }}>
                    {disabled
                      ? `Désactivé le ${fmtStamp(p.disabled_at)}${p.disabled_by ? ` par ${p.disabled_by}` : ''}. Il redevient actif tout seul s'il se vend ou s'il est reçu à ${shop.label}.`
                      : `Un produit désactivé sort de la liste, du comptage et des besoins de ${shop.label}. Les autres boutiques ne changent pas.`}
                    {others.map((o) => (
                      <div key={o.warehouse_id} style={{ marginTop: 3 }}>
                        {o.name} : {o.stock == null ? 'absent du stock' : o.disabled_at ? 'désactivé' : 'actif'}
                      </div>
                    ))}
                  </div>
                  {here?.stock != null && here.stock !== 0 && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: C.orangeL, color: C.orange, fontSize: 12.5, fontWeight: 600 }}>
                      Il reste {fmtNum(here.stock)} en stock à {shop.label}.
                      {disabled ? ' Il n\'apparaît plus dans les comptages.' : ' Désactivé, il disparaîtrait des comptages.'}
                    </div>
                  )}
                  {!canWrite && <div style={{ fontSize: 12, color: C.greyM, marginTop: 6 }}>Lecture seule : le droit d'écriture sur la boutique est nécessaire.</div>}
                </>
              )}
            </div>

            {/* Stock et ventes par boutique */}
            <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <Th>Boutique</Th><Th align="right">Stock</Th><Th>Rack</Th>
                      <Th align="right">Ventes 30 j</Th><Th align="right">90 j</Th><Th align="right">12 mois</Th>
                      <Th>Dernière vente</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.shops.map((s) => (
                      <tr key={s.warehouse_id}>
                        <Td bold>{s.name}</Td>
                        <Td align="right" bold color={s.stock < 0 ? C.red : s.stock === 0 ? C.orange : C.dark}>{fmtNum(s.stock)}</Td>
                        <Td color={C.greyT}>{s.rack || '—'}</Td>
                        <Td align="right">{fmtNum(s.qty_30)}</Td>
                        <Td align="right">{fmtNum(s.qty_90)}</Td>
                        <Td align="right">{fmtNum(s.qty_365)}</Td>
                        <Td color={C.greyT}>{s.last_sale_at ? fmtDay(s.last_sale_at) : 'jamais'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <Kpi label="Stock site" value={fmtNum(p.wc_stock)} sub={p.wc_stock == null ? 'aucun produit rapproché' : 'rapproché par code-barres'} color={C.dark} />
              <Kpi label="Dernier achat reçu"
                   value={p.last_purchase ? fmtDay(p.last_purchase.purchased_at) : 'aucun'}
                   sub={p.last_purchase
                     ? `${p.last_purchase.supplier_name || 'Fournisseur ?'} · ${fmtNum(p.last_purchase.qty)} pièce${p.last_purchase.qty > 1 ? 's' : ''}${p.last_purchase.shop ? ` · ${p.last_purchase.shop}` : ''}`
                     : null}
                   color={C.dark} />
            </div>

            {/* Codes-barres */}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>
              Codes-barres
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              {p.barcodes.length ? p.barcodes.map((b) => <Barcode key={b} code={b} />)
                : <span style={{ fontSize: 13, color: C.greyM }}>Aucun code-barres dans Nextore.</span>}
            </div>

            {/* Évolution du stock de cette boutique */}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>
              Stock {shop.label} dans le temps
            </div>
            {chart.length < 2 ? (
              <div style={{ fontSize: 13, color: C.greyM }}>Pas assez d'historique.</div>
            ) : (
              <div style={{ width: '100%', height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke={C.greyB} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                           tickFormatter={(t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })}
                           tick={{ fontSize: 11, fill: C.greyT }} stroke={C.greyB} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.greyT }} stroke={C.greyB} />
                    <Tooltip
                      labelFormatter={(t) => fmtStamp(t)}
                      formatter={(v) => [fmtNum(v), 'Stock']}
                      contentStyle={{ fontSize: 12.5, borderRadius: 8, border: `1px solid ${C.greyB}` }}
                    />
                    <Line type="stepAfter" dataKey="stock" stroke={C.primary} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── PRODUITS TAB ──────────────────────────────────────── */
export default function ProduitsTab({ shop, token }) {
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.[shop.permKey]?.write === true;

  const [data, setData] = useState(null);   // { warehouse, summary, lastSyncAt, rows }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [kpiFilter, setKpiFilter] = useState(null); // null | 'zero' | 'negative' (piloté par les KPI)
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [facets, setFacets] = useState({ categories: [], subcategories: [], brands: [] });
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [brand, setBrand] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [dormant, setDormant] = useState(false);
  const [dormantMonths, setDormantMonths] = useState('12'); // '3' | '6' | '12' | '24' | 'custom'
  const [customMonths, setCustomMonths] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const months = dormantMonths === 'custom' ? parseInt(customMonths, 10) : Number(dormantMonths);
  const dormantDays = dormant && months > 0 ? monthsToDays(months) : null;

  useEffect(() => {
    axios.get(`${API_URL}/nextore/${shop.slug}/categories`, authHeaders(token))
      .then((r) => setFacets({ categories: r.data.categories || [], subcategories: r.data.subcategories || [], brands: r.data.brands || [] }))
      .catch(() => { /* filtres indisponibles : la liste reste utilisable */ });
  }, [shop.slug, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Un filtre KPI (rupture/négatif) a besoin de tout le catalogue → on charge tout
      if (onlyInStock && !kpiFilter && !dormant) params.set('only_in_stock', '1');
      if (search.trim()) params.set('search', search.trim());
      if (category) params.set('category', category);
      if (subcategory) params.set('subcategory', subcategory);
      if (brand) params.set('brand', brand);
      if (showDisabled && !dormant) params.set('show_disabled', '1');
      if (dormantDays) params.set('dormant_days', String(dormantDays));
      const res = await axios.get(
        `${API_URL}/nextore/${shop.slug}/stock?${params.toString()}`,
        authHeaders(token),
      );
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [shop.slug, token, onlyInStock, kpiFilter, search, category, subcategory, brand, showDisabled, dormant, dormantDays]);

  // Rechargement (debounce sur la recherche)
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  // Une sélection ne survit pas à un changement de liste
  useEffect(() => { setSelected(new Set()); }, [data]);

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await axios.post(`${API_URL}/nextore/${shop.slug}/sync`, {}, authHeaders(token));
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de synchronisation');
    } finally {
      setSyncing(false);
    }
  };

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const rows = useMemo(() => {
    let list = data?.rows ? [...data.rows] : [];
    if (kpiFilter === 'negative') list = list.filter((r) => r.stock < 0);
    else if (kpiFilter === 'zero') list = list.filter((r) => r.stock === 0);
    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === 'number' || typeof vb === 'number') return ((va ?? 0) - (vb ?? 0)) * mult;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'fr') * mult;
    });
    return list;
  }, [data, sort, kpiFilter]);

  // Un produit supprimé dans Nextore suit Nextore : pas sélectionnable
  const selectable = useMemo(() => rows.filter((r) => !r.deleted), [rows]);
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.product_id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map((r) => r.product_id)));
  const toggleOne = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selRows = rows.filter((r) => selected.has(r.product_id));
  const selActive = selRows.filter((r) => !r.disabled).map((r) => r.product_id);
  const selDisabled = selRows.filter((r) => r.disabled).map((r) => r.product_id);

  const bulk = async (ids, disabled) => {
    const n = ids.length;
    const verb = disabled ? 'Désactiver' : 'Réactiver';
    if (!window.confirm(`${verb} ${n} produit${n > 1 ? 's' : ''} à ${shop.label} ?`)) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await axios.post(`${API_URL}/nextore/${shop.slug}/products/disabled`,
        { product_ids: ids, disabled }, authHeaders(token));
      const u = res.data.updated;
      setNotice(`${u} produit${u > 1 ? 's' : ''} ${disabled ? 'désactivé' : 'réactivé'}${u > 1 ? 's' : ''}.`);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur');
    } finally {
      setBulkBusy(false);
    }
  };

  const s = data?.summary;
  const otherLabel = Number(shop.id) === 1 ? 'Castelnau' : 'Montpellier';
  const subOptions = facets.subcategories.filter((sc) => !category || sc.category_id === category);
  // Cellule stock rapproché (autre boutique / WC) : "—" si non suivi, rouge si négatif
  const crossCell = (v) => (v == null ? <span style={{ color: C.greyM }}>—</span>
    : <span style={{ color: v < 0 ? C.red : v === 0 ? C.orange : C.dark, fontWeight: v ? 600 : 400 }}>{fmtNum(v)}</span>);
  const nbCols = canWrite ? 9 : 8;

  return (
    <div>
      {/* Barre KPI */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Kpi label="Références" value={s ? fmtNum(s.total_products) : '—'}
             sub={s ? `${fmtNum(s.in_stock)} en stock · actives` : null}
             active={!kpiFilter && !onlyInStock && !dormant}
             onClick={() => { setKpiFilter(null); setOnlyInStock(false); setDormant(false); }} />
        <Kpi label="Unités en stock" value={s ? fmtNum(s.total_units) : '—'} color={C.dark} />
        <Kpi label="Ruptures" value={s ? fmtNum(s.out_of_stock) : '—'} sub="stock à 0" color={C.orange}
             active={kpiFilter === 'zero'}
             onClick={() => { setDormant(false); setKpiFilter((f) => (f === 'zero' ? null : 'zero')); }} />
        <Kpi label="Stock négatif" value={s ? fmtNum(s.negative) : '—'} sub="à vérifier" color={s?.negative > 0 ? C.red : C.greyM}
             active={kpiFilter === 'negative'}
             onClick={() => { setDormant(false); setKpiFilter((f) => (f === 'negative' ? null : 'negative')); }} />
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (nom, code, code-barres)…"
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, minWidth: 240, flex: 1, maxWidth: 380,
          }}
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); }} style={selectStyle}>
          <option value="">Toutes catégories</option>
          {facets.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={subcategory} onChange={(e) => setSubcategory(e.target.value)} style={selectStyle}>
          <option value="">Toutes sous-catégories</option>
          {subOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} style={selectStyle}>
          <option value="">Toutes marques</option>
          {facets.brands.map((b) => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.greyM }}>
          Dernière synchro : {fmtDateTime(data?.lastSyncAt)}
        </span>
        <Btn onClick={runSync} disabled={syncing} variant="accent">
          {syncing ? 'Synchronisation…' : 'Synchroniser'}
        </Btn>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: dormant ? C.greyM : C.greyT, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={onlyInStock && !kpiFilter && !dormant} disabled={dormant}
                 onChange={(e) => { setKpiFilter(null); setOnlyInStock(e.target.checked); }} />
          En stock seulement
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: dormant ? C.greyM : C.greyT, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showDisabled && !dormant} disabled={dormant}
                 onChange={(e) => setShowDisabled(e.target.checked)} />
          Afficher les désactivés
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: C.greyT, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={dormant}
                 onChange={(e) => { setKpiFilter(null); setDormant(e.target.checked); }} />
          Dormants : aucune vente depuis
        </label>
        <select value={dormantMonths} onChange={(e) => setDormantMonths(e.target.value)} style={{ ...selectStyle, padding: '6px 10px' }}>
          {DORMANT_PERIODS.map((m) => <option key={m} value={String(m)}>{m} mois</option>)}
          <option value="custom">Autre…</option>
        </select>
        {dormantMonths === 'custom' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.greyT }}>
            <input type="number" min={1} value={customMonths} onChange={(e) => setCustomMonths(e.target.value)}
                   style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5 }} />
            mois
          </span>
        )}
      </div>

      {dormant && (
        <div style={{ padding: '10px 14px', background: C.accentL, color: '#7A4D00', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {months > 0
            ? <>Produits actifs sans aucune vente depuis <b>{months} mois</b> à {shop.label}, et à <b>stock 0</b> ici. L'autre boutique n'est pas concernée.
                {canWrite && ' Cochez-les puis « Désactiver la sélection ».'}</>
            : 'Indiquez une durée en mois.'}
        </div>
      )}

      {notice && (
        <div style={{ padding: '10px 14px', background: C.greenL, color: C.green, borderRadius: 8, marginBottom: 14, fontSize: 13.5, fontWeight: 600 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', background: C.redL, color: C.red, borderRadius: 8, marginBottom: 14, fontSize: 13.5 }}>
          {error}
        </div>
      )}

      {canWrite && selected.size > 0 && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12,
          padding: '10px 14px', background: '#EEF5F9', border: `1px solid ${C.primary}`, borderRadius: 10,
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.primary }}>
            {fmtNum(selected.size)} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <div style={{ flex: 1 }} />
          {selActive.length > 0 && (
            <Btn small variant="danger" disabled={bulkBusy} onClick={() => bulk(selActive, true)}>
              Désactiver la sélection ({fmtNum(selActive.length)})
            </Btn>
          )}
          {selDisabled.length > 0 && (
            <Btn small disabled={bulkBusy} onClick={() => bulk(selDisabled, false)}>
              Réactiver la sélection ({fmtNum(selDisabled.length)})
            </Btn>
          )}
          <Btn small variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Vider</Btn>
        </div>
      )}

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {canWrite && (
                  <Th width={40}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={!selectable.length}
                           title="Tout cocher (lignes affichées)" />
                  </Th>
                )}
                <Th onClick={() => toggleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Produit</Th>
                <Th onClick={() => toggleSort('category_name')} active={sort.key === 'category_name'} dir={sort.dir}>Catégorie</Th>
                <Th onClick={() => toggleSort('brand')} active={sort.key === 'brand'} dir={sort.dir}>Marque</Th>
                <Th onClick={() => toggleSort('rack')} active={sort.key === 'rack'} dir={sort.dir}>Rack</Th>
                <Th align="right" onClick={() => toggleSort('stock')} active={sort.key === 'stock'} dir={sort.dir}>Stock</Th>
                <Th align="right" onClick={() => toggleSort('other_stock')} active={sort.key === 'other_stock'} dir={sort.dir}>Stock {otherLabel}</Th>
                <Th align="right" onClick={() => toggleSort('wc_stock')} active={sort.key === 'wc_stock'} dir={sort.dir}>Stock WC</Th>
                <Th onClick={() => toggleSort('last_sale_at')} active={sort.key === 'last_sale_at'} dir={sort.dir}>Dernière vente</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={nbCols} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Chargement…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={nbCols} style={{ textAlign: 'center', padding: 32, color: C.greyM }}>Aucun produit.</td></tr>
              ) : (
                rows.map((r, i) => {
                  const inactive = r.disabled || r.deleted;
                  return (
                    <tr key={r.product_id} onClick={() => setDetailId(r.product_id)}
                        style={{ background: i % 2 ? C.zebra : C.white, cursor: 'pointer', opacity: inactive ? 0.6 : 1 }}>
                      {canWrite && (
                        <Td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.product_id)} disabled={r.deleted}
                                 onChange={() => toggleOne(r.product_id)} />
                        </Td>
                      )}
                      <Td bold>
                        {r.name || '—'}
                        {r.code && <span style={{ color: C.greyM, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>#{r.code}</span>}
                        {r.deleted ? <Badge color={C.greyT} bg={C.greyB}>Supprimé Nextore</Badge>
                          : r.disabled ? <Badge color={C.red} bg={C.redL}>Désactivé</Badge> : null}
                      </Td>
                      <Td color={C.greyT}>
                        {r.category_name || '—'}
                        {r.subcategory_name && <div style={{ fontSize: 12, color: C.greyM }}>{r.subcategory_name}</div>}
                      </Td>
                      <Td color={C.greyT}>{r.brand || '—'}</Td>
                      <Td color={C.greyT}>{r.rack || '—'}</Td>
                      <Td align="right" bold color={r.stock < 0 ? C.red : r.stock === 0 ? C.orange : C.dark}>
                        {fmtNum(r.stock)}
                        <Delta value={r.stock_delta} />
                      </Td>
                      <Td align="right">{crossCell(r.other_stock)}</Td>
                      <Td align="right">{crossCell(r.wc_stock)}</Td>
                      <Td color={C.greyT} style={{ whiteSpace: 'nowrap' }}>{r.last_sale_at ? fmtDay(r.last_sale_at) : 'jamais'}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 10, textAlign: 'right' }}>
          {fmtNum(rows.length)} ligne{rows.length > 1 ? 's' : ''} affichée{rows.length > 1 ? 's' : ''}
        </div>
      )}

      {detailId && (
        <ProductDetail shop={shop} token={token} productId={detailId} canWrite={canWrite}
                       onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
