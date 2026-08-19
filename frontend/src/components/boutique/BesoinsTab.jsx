import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import '../../pages/PurchasesApp.css'; // réutilise la charte de la Gestion d'achat V2

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const fmtNum = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d }));

/* Réglages sauvegardés par boutique (période / seuil / couverture, en jours) */
const PARAM_KEY = (slug) => `yv.boutique.needs.${slug}.v2`;
const DEFAULTS = { period: 31, seuil: 15, coverage: 45 };
function loadParams(slug) {
  try {
    const raw = localStorage.getItem(PARAM_KEY(slug));
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

const TREND = {
  up: { cls: 'trend-up', s: '↑' },
  down: { cls: 'trend-down', s: '↓' },
  stable: { cls: 'trend-stable', s: '→' },
};

export default function BesoinsTab({ shop, token }) {
  const [params, setParams] = useState(() => loadParams(shop.slug));
  const [supplier, setSupplier] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'stock_will_last', dir: 'asc' });

  useEffect(() => {
    try { localStorage.setItem(PARAM_KEY(shop.slug), JSON.stringify(params)); } catch { /* ignore */ }
  }, [params, shop.slug]);

  useEffect(() => {
    let alive = true;
    axios.get(`${API_URL}/nextore/${shop.slug}/suppliers`, authHeaders(token))
      .then((r) => { if (alive) setSuppliers(r.data.suppliers || []); })
      .catch(() => { /* non bloquant */ });
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
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
  }, [load]);

  const setP = (k) => (v) => setParams((p) => ({ ...p, [k]: Math.max(0, parseInt(v, 10) || 0) }));
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const rows = useMemo(() => {
    let list = data?.items ? [...data.items] : [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q) ||
        (r.barcode || '').toLowerCase().includes(q) ||
        (r.supplier_name || '').toLowerCase().includes(q) ||
        (r.supplier_ref || '').toLowerCase().includes(q));
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

  const SortTh = ({ col, label, right, center }) => (
    <th
      className={right ? 'text-right' : center ? 'text-center' : ''}
      onClick={() => toggleSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {label}
      <span style={{ marginLeft: 4, opacity: sort.key === col ? 1 : 0.3 }}>
        {sort.key === col ? (sort.dir === 'asc' ? '▲' : '▼') : '▼'}
      </span>
    </th>
  );

  const totalCount = data?.items?.length || 0;

  return (
    <div className="needs-tab">
      {/* Barre de filtres (charte V2) */}
      <div className="purchases-card">
        <div className="filters-bar">
          <div className="filter-group">
            <label>Fournisseur</label>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Tous les fournisseurs</option>
              {suppliers.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.company || `#${sp.id}`} ({sp.product_count})</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Période d'analyse</label>
            <input type="number" min={1} value={params.period} onChange={(e) => setP('period')(e.target.value)} />
          </div>
          <div className="filter-group">
            <label>Seuil de déclenchement (j)</label>
            <input type="number" min={0} value={params.seuil} onChange={(e) => setP('seuil')(e.target.value)} />
          </div>
          <div className="filter-group">
            <label>
              Couverture visée (j)
              {params.coverage < params.seuil && (
                <span title="La couverture ne peut pas être inférieure au seuil ; elle est ramenée au seuil."
                  style={{ color: '#d97706', marginLeft: 6, cursor: 'help' }}>⚠ ajustée à {params.seuil} j</span>
              )}
            </label>
            <input type="number" min={0} value={params.coverage} onChange={(e) => setP('coverage')(e.target.value)} />
          </div>
        </div>

        {/* Ligne secondaire : recherche + compteur */}
        <div className="filters-bar" style={{ marginTop: 10, marginBottom: 0 }}>
          <input
            type="text"
            placeholder="Rechercher produit, SKU, fournisseur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 260 }}
          />
          <div style={{ marginLeft: 'auto', fontSize: 13, color: '#888' }}>
            {loading ? 'Chargement…' : `${fmtNum(rows.length)} / ${fmtNum(totalCount)} à commander`}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 8, marginBottom: 14, fontSize: 13.5 }}>{error}</div>
      )}

      {/* Table (charte V2) */}
      <div className="purchases-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="purchases-table">
          <thead>
            <tr>
              <SortTh col="name" label="Produit" />
              <SortTh col="supplier_ref" label="Réf. fournisseur" />
              <SortTh col="sku" label="SKU" />
              <SortTh col="stock" label="Stock" right />
              <SortTh col="sales_period" label="Ventes période" right />
              <SortTh col="sales_per_month" label="Ventes/mois" right />
              <SortTh col="trend_coefficient" label="Tendance" center />
              <SortTh col="to_order_theoretical" label="Prop. théo." right />
              <SortTh col="to_order" label="Prop. supp." right />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6B7280' }}>Chargement…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#8A99A4' }}>Aucun besoin avec ces réglages.</td></tr>
            ) : (
              rows.map((r) => {
                const tr = TREND[r.trend_direction] || TREND.stable;
                const stockCls = r.stock < 0 ? 'stock-critical' : r.stock === 0 ? 'stock-low' : '';
                return (
                  <tr key={r.product_id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#2a2e38' }}>{r.name || '—'}</div>
                      <div style={{ fontSize: 12, color: '#8A99A4' }}>{r.supplier_name || 'Sans fournisseur'}</div>
                    </td>
                    <td>{r.supplier_ref || '—'}</td>
                    <td>{r.sku || '—'}</td>
                    <td className="text-right">
                      <span className={stockCls}>{fmtNum(r.stock)}</span>
                      {r.stock < 0 && <span title="Stock négatif — comptage à faire" style={{ marginLeft: 5 }}>⚠</span>}
                    </td>
                    <td className="text-right">{fmtNum(r.sales_period)}</td>
                    <td className="text-right">{fmtNum(r.sales_per_month, 2)}</td>
                    <td className="text-center">
                      <span className={tr.cls}>{tr.s} ×{fmtNum(r.trend_coefficient, 2)}</span>
                    </td>
                    <td className="text-right">{fmtNum(r.to_order_theoretical)}</td>
                    <td className="text-right" style={{ fontWeight: 700, color: '#E28F00' }}>{fmtNum(r.to_order)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
