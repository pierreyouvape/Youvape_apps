import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée Rapport / SAV / Réception) ───────── */
const C = {
  primary: '#135E84', accent: '#E28F00',
  green: '#16A34A', red: '#DC2626', redL: '#FEE2E2', orange: '#EA580C',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF', zebra: '#F4F7F9',
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const fmtEur = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const fmtNum = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d }));

/* Réglages sauvegardés par boutique (v2 : période / seuil / couverture) */
const PARAM_KEY = (slug) => `yv.boutique.needs.${slug}.v2`;
const DEFAULTS = { period: 31, seuil: 15, coverage: 45 };
function loadParams(slug) {
  try {
    const raw = localStorage.getItem(PARAM_KEY(slug));
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

/* ─── PETITS COMPOSANTS (charte Réception) ──────────────── */
function Th({ children, align = 'left', width, onClick, active, dir }) {
  return (
    <th onClick={onClick} style={{
      padding: '12px 16px', textAlign: align, width, fontWeight: 700,
      color: active ? C.primary : C.greyT, fontSize: 11.5, textTransform: 'uppercase',
      letterSpacing: 0.3, borderBottom: `2px solid ${C.greyB}`, background: C.grey,
      whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
    }}>{children}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
  );
}
function Td({ children, align = 'left', bold, color, style }) {
  return (
    <td style={{
      padding: '11px 16px', textAlign: align, color: color || C.dark,
      fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 14, ...style,
    }}>{children}</td>
  );
}
function Kpi({ label, value, sub, color = C.primary }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, margin: '4px 0 0' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: C.greyM, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function TrendCell({ dir, coef }) {
  const map = { up: { s: '↑', c: C.green }, down: { s: '↓', c: C.red }, stable: { s: '→', c: C.greyM } };
  const t = map[dir] || map.stable;
  return <span style={{ color: t.c, fontWeight: 700 }} title={`Coefficient de tendance ×${fmtNum(coef, 2)}`}>{t.s} ×{fmtNum(coef, 2)}</span>;
}
function NumField({ label, value, onChange, suffix }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.greyT, fontWeight: 600 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number" min={0} value={value}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
          style={{ width: 74, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5 }}
        />
        <span style={{ color: C.greyM, fontWeight: 500 }}>{suffix}</span>
      </span>
    </label>
  );
}

/* ─── BESOINS TAB ───────────────────────────────────────── */
export default function BesoinsTab({ shop, token }) {
  const [params, setParams] = useState(() => loadParams(shop.slug));
  const [supplier, setSupplier] = useState('');           // filtre fournisseur (id) ou '' = tous
  const [suppliers, setSuppliers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'stock_will_last', dir: 'asc' });

  useEffect(() => {
    try { localStorage.setItem(PARAM_KEY(shop.slug), JSON.stringify(params)); } catch { /* ignore */ }
  }, [params, shop.slug]);

  // Liste des fournisseurs de la boutique (pour le filtre)
  useEffect(() => {
    let alive = true;
    axios.get(`${API_URL}/nextore/${shop.slug}/suppliers`, authHeaders(token))
      .then((r) => { if (alive) setSuppliers(r.data.suppliers || []); })
      .catch(() => { /* filtre indisponible, non bloquant */ });
    return () => { alive = false; };
  }, [shop.slug, token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period: params.period, seuil: params.seuil, coverage: params.coverage });
      if (supplier) qs.set('supplier', supplier);
      const res = await axios.get(`${API_URL}/nextore/${shop.slug}/needs?${qs}`, authHeaders(token));
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [shop.slug, token, params, supplier]);

  useEffect(() => {
    const t = setTimeout(load, 350); // debounce sur les réglages
    return () => clearTimeout(t);
  }, [load]);

  const setP = (k) => (v) => setParams((p) => ({ ...p, [k]: v }));
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const rows = useMemo(() => {
    let list = data?.items ? [...data.items] : [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.code || '').toLowerCase().includes(q) ||
        (r.barcode || '').toLowerCase().includes(q) ||
        (r.supplier_name || '').toLowerCase().includes(q));
    }
    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === 'number' || typeof vb === 'number') return ((va ?? 0) - (vb ?? 0)) * mult;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'fr') * mult;
    });
    return list;
  }, [data, search, sort]);

  const s = data?.summary;

  return (
    <div>
      {/* Réglages */}
      <div style={{
        display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap',
        background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: '14px 18px', marginBottom: 18,
      }}>
        <NumField label="Période d'analyse" value={params.period} onChange={setP('period')} suffix="jours" />
        <NumField label="Seuil de déclenchement" value={params.seuil} onChange={setP('seuil')} suffix="jours" />
        <NumField label="Couverture visée" value={params.coverage} onChange={setP('coverage')} suffix="jours" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: C.greyT, fontWeight: 600 }}>
          Fournisseur
          <select
            value={supplier} onChange={(e) => setSupplier(e.target.value)}
            style={{ padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5, minWidth: 200, background: C.white }}
          >
            <option value="">Tous les fournisseurs</option>
            {suppliers.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.company || `#${sp.id}`} ({sp.product_count})</option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12, color: C.greyM, paddingBottom: 6, maxWidth: 320 }}>
          Commande déclenchée si le stock tient moins de <strong>{params.seuil} j</strong> ; on remonte alors à <strong>{Math.max(params.coverage, params.seuil)} j</strong> de couverture.
        </div>
      </div>

      {/* KPI */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Kpi label="Produits à commander" value={s ? fmtNum(s.to_order_count) : '—'} color={C.accent} />
        <Kpi label="Unités (projeté)" value={s ? fmtNum(s.total_units) : '—'} sub="tendance incluse" color={C.dark} />
        <Kpi label="Valeur d'achat (projeté)" value={s ? fmtEur(s.total_value) : '—'} sub="au coût HT" color={C.primary} />
        <Kpi label="À compter" value={s ? fmtNum(s.negative_count) : '—'} sub="stock négatif" color={s?.negative_count > 0 ? C.red : C.greyM} />
      </div>

      {/* Recherche */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (nom, code, code-barres, fournisseur)…"
          style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 13.5, minWidth: 260, flex: 1, maxWidth: 460 }}
        />
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: C.redL, color: C.red, borderRadius: 8, marginBottom: 14, fontSize: 13.5 }}>{error}</div>
      )}

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th onClick={() => toggleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Produit</Th>
                <Th onClick={() => toggleSort('category_name')} active={sort.key === 'category_name'} dir={sort.dir}>Catégorie</Th>
                <Th align="right" onClick={() => toggleSort('stock')} active={sort.key === 'stock'} dir={sort.dir}>Stock</Th>
                <Th align="right" onClick={() => toggleSort('daily_rate')} active={sort.key === 'daily_rate'} dir={sort.dir}>Ventes/j</Th>
                <Th align="right" onClick={() => toggleSort('stock_will_last')} active={sort.key === 'stock_will_last'} dir={sort.dir}>Jours restants</Th>
                <Th align="center" onClick={() => toggleSort('trend_coefficient')} active={sort.key === 'trend_coefficient'} dir={sort.dir}>Tendance</Th>
                <Th align="right" onClick={() => toggleSort('to_order_theoretical')} active={sort.key === 'to_order_theoretical'} dir={sort.dir}>Théorique</Th>
                <Th align="right" onClick={() => toggleSort('to_order')} active={sort.key === 'to_order'} dir={sort.dir}>Projeté</Th>
                <Th align="right" onClick={() => toggleSort('order_value')} active={sort.key === 'order_value'} dir={sort.dir}>Valeur</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: C.greyT }}>Chargement…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: C.greyM }}>Aucun besoin avec ces réglages.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.product_id} style={{ background: i % 2 ? C.zebra : C.white }}>
                    <Td bold>
                      {r.name || '—'}
                      <div style={{ fontSize: 12, color: C.greyM, fontWeight: 400, marginTop: 2 }}>
                        {r.supplier_name || 'Sans fournisseur'}{r.code ? ` · #${r.code}` : ''}
                      </div>
                    </Td>
                    <Td color={C.greyT}>{r.category_name || '—'}</Td>
                    <Td align="right" bold color={r.stock < 0 ? C.red : r.stock === 0 ? C.orange : C.dark}>
                      {fmtNum(r.stock)}
                      {r.stock < 0 && <span title="Stock négatif — comptage à faire" style={{ marginLeft: 6, fontSize: 12 }}>⚠</span>}
                    </Td>
                    <Td align="right" color={C.greyT}>{fmtNum(r.daily_rate, 2)}</Td>
                    <Td align="right" bold color={r.stock_will_last <= 0 ? C.red : C.orange}>
                      {`${fmtNum(r.stock_will_last)} j`}
                    </Td>
                    <Td align="center"><TrendCell dir={r.trend_direction} coef={r.trend_coefficient} /></Td>
                    <Td align="right" color={C.greyT}>{fmtNum(r.to_order_theoretical)}</Td>
                    <Td align="right" bold color={C.accent}>{fmtNum(r.to_order)}</Td>
                    <Td align="right">{fmtEur(r.order_value)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 10, textAlign: 'right' }}>
          {fmtNum(rows.length)} produit{rows.length > 1 ? 's' : ''} à commander
        </div>
      )}
    </div>
  );
}
