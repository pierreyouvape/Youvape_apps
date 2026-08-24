import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

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
const fmtEur = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const fmtDateTime = (s) => {
  if (!s) return 'jamais';
  const d = String(s);
  const date = d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const time = d.slice(11, 16);
  return time ? `${date} à ${time}` : date;
};

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
function Td({ children, align = 'left', bold, color, style }) {
  return (
    <td style={{
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

/* ─── STOCK TAB ─────────────────────────────────────────── */
export default function StockTab({ shop, token }) {
  const [data, setData] = useState(null);   // { warehouse, summary, lastSyncAt, rows }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [kpiFilter, setKpiFilter] = useState(null); // null | 'zero' | 'negative' (piloté par les KPI)
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Un filtre KPI (rupture/négatif) a besoin de tout le catalogue → on charge tout
      if (onlyInStock && !kpiFilter) params.set('only_in_stock', '1');
      if (search.trim()) params.set('search', search.trim());
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
  }, [shop.slug, token, onlyInStock, kpiFilter, search]);

  // Rechargement (debounce sur la recherche)
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

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

  const s = data?.summary;
  const otherLabel = Number(shop.id) === 1 ? 'Castelnau' : 'Montpellier';
  // Cellule stock rapproché (autre boutique / WC) : "—" si non suivi, rouge si négatif
  // Coût dérivé du site : « — » tant que le lien n'est pas validé dans l'onglet
  // Rapprochement. L'écart affiché mesure la dérive du tarif caisse.
  const alignedCell = (r) => {
    if (r.aligned_cost == null) return <span style={{ color: C.greyM }}>—</span>;
    const delta = r.cost ? (r.aligned_cost - r.cost) / r.cost : null;
    return (
      <span title={r.link_pack_qty > 1 ? `Prix du site ÷ ${r.link_pack_qty} (pack)` : 'Prix du site'}>
        <span style={{ fontWeight: 600 }}>{fmtEur(r.aligned_cost)}</span>
        {r.link_pack_qty > 1 && <span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}> ×{r.link_pack_qty}</span>}
        {delta != null && Math.abs(delta) >= 0.05 && (
          <div style={{ fontSize: 11, fontWeight: 700, color: delta > 0 ? C.green : C.red }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}%
          </div>
        )}
      </span>
    );
  };
  const crossCell = (v) => (v == null ? <span style={{ color: C.greyM }}>—</span>
    : <span style={{ color: v < 0 ? C.red : v === 0 ? C.orange : C.dark, fontWeight: v ? 600 : 400 }}>{fmtNum(v)}</span>);

  return (
    <div>
      {/* Barre KPI */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Kpi label="Références" value={s ? fmtNum(s.total_products) : '—'}
             sub={s ? `${fmtNum(s.in_stock)} en stock` : null}
             active={!kpiFilter && !onlyInStock}
             onClick={() => { setKpiFilter(null); setOnlyInStock(false); }} />
        <Kpi label="Unités en stock" value={s ? fmtNum(s.total_units) : '—'} color={C.dark} />
        <Kpi label="Valeur du stock" value={s ? fmtEur(s.total_value) : '—'} sub="aux prix d'achat caisse" color={C.primary} />
        <Kpi label="Valeur alignée" value={s ? fmtEur(s.total_value_aligned) : '—'}
             sub={s ? `${fmtNum(s.aligned_products)} réf. sur prix du site` : null}
             color={s && s.total_value_aligned < s.total_value ? C.red : C.green} />
        <Kpi label="Ruptures" value={s ? fmtNum(s.out_of_stock) : '—'} sub="stock à 0" color={C.orange}
             active={kpiFilter === 'zero'}
             onClick={() => setKpiFilter((f) => (f === 'zero' ? null : 'zero'))} />
        <Kpi label="Stock négatif" value={s ? fmtNum(s.negative) : '—'} sub="à vérifier" color={s?.negative > 0 ? C.red : C.greyM}
             active={kpiFilter === 'negative'}
             onClick={() => setKpiFilter((f) => (f === 'negative' ? null : 'negative'))} />
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (nom, code, code-barres)…"
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, minWidth: 260, flex: 1, maxWidth: 420,
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, color: C.greyT, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={onlyInStock && !kpiFilter}
                 onChange={(e) => { setKpiFilter(null); setOnlyInStock(e.target.checked); }} />
          En stock seulement
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.greyM }}>
          Dernière synchro : {fmtDateTime(data?.lastSyncAt)}
        </span>
        <Btn onClick={runSync} disabled={syncing} variant="accent">
          {syncing ? 'Synchronisation…' : 'Synchroniser'}
        </Btn>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: C.redL, color: C.red, borderRadius: 8, marginBottom: 14, fontSize: 13.5 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th onClick={() => toggleSort('name')} active={sort.key === 'name'} dir={sort.dir}>Produit</Th>
                <Th onClick={() => toggleSort('category_name')} active={sort.key === 'category_name'} dir={sort.dir}>Catégorie</Th>
                <Th onClick={() => toggleSort('rack')} active={sort.key === 'rack'} dir={sort.dir}>Rack</Th>
                <Th align="right" onClick={() => toggleSort('stock')} active={sort.key === 'stock'} dir={sort.dir}>Stock</Th>
                <Th align="right" onClick={() => toggleSort('cost')} active={sort.key === 'cost'} dir={sort.dir}>Coût HT</Th>
                <Th align="right" onClick={() => toggleSort('price')} active={sort.key === 'price'} dir={sort.dir}>Prix TTC</Th>
                <Th align="right" onClick={() => toggleSort('aligned_cost')} active={sort.key === 'aligned_cost'} dir={sort.dir}>Coût aligné</Th>
                <Th align="right" onClick={() => toggleSort('stock_value')} active={sort.key === 'stock_value'} dir={sort.dir}>Valeur</Th>
                <Th align="right" onClick={() => toggleSort('aligned_value')} active={sort.key === 'aligned_value'} dir={sort.dir}>Valeur alignée</Th>
                <Th align="right" onClick={() => toggleSort('other_stock')} active={sort.key === 'other_stock'} dir={sort.dir}>Stock {otherLabel}</Th>
                <Th align="right" onClick={() => toggleSort('wc_stock')} active={sort.key === 'wc_stock'} dir={sort.dir}>Stock WC</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><Td style={{ textAlign: 'center', padding: 32, color: C.greyT }} align="center">Chargement…</Td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: C.greyM }}>Aucun produit.</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={r.product_id} style={{ background: i % 2 ? C.zebra : C.white }}>
                    <Td bold>
                      {r.name || '—'}
                      {r.code && <span style={{ color: C.greyM, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>#{r.code}</span>}
                    </Td>
                    <Td color={C.greyT}>{r.category_name || '—'}</Td>
                    <Td color={C.greyT}>{r.rack || '—'}</Td>
                    <Td align="right" bold color={r.stock < 0 ? C.red : r.stock === 0 ? C.orange : C.dark}>
                      {fmtNum(r.stock)}
                      <Delta value={r.stock_delta} />
                    </Td>
                    <Td align="right" color={C.greyT}>{r.cost == null ? '—' : fmtEur(r.cost)}</Td>
                    <Td align="right" color={C.greyT}>{r.price == null ? '—' : fmtEur(r.price)}</Td>
                    <Td align="right">{alignedCell(r)}</Td>
                    <Td align="right" bold>{fmtEur(r.stock_value)}</Td>
                    <Td align="right" bold color={r.aligned_value == null ? C.greyM : C.primary}>
                      {r.aligned_value == null ? '—' : fmtEur(r.aligned_value)}
                    </Td>
                    <Td align="right">{crossCell(r.other_stock)}</Td>
                    <Td align="right">{crossCell(r.wc_stock)}</Td>
                  </tr>
                ))
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
    </div>
  );
}
