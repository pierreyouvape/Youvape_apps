import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import '../../pages/PurchasesApp.css'; // charte Gestion d'achat V2

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── Options (identiques à la V2) ─────────────────────── */
const ANALYSIS_PERIOD_OPTIONS = [
  { value: 7, unit: 'days', label: '7 derniers jours' },
  { value: 15, unit: 'days', label: '15 derniers jours' },
  { value: 31, unit: 'days', label: '31 derniers jours' },
  { value: 60, unit: 'days', label: '60 derniers jours' },
  { value: 1, unit: 'months', label: 'Le mois dernier' },
  { value: 3, unit: 'months', label: 'Les 3 derniers mois' },
  { value: 'custom', unit: null, label: 'Période personnalisée' },
];
const COVERAGE_OPTIONS = [
  { value: 0.25, label: '7 jours' }, { value: 0.5, label: '15 jours' },
  { value: 1, label: '1 mois' }, { value: 1.5, label: '1.5 mois' },
  { value: 2, label: '2 mois' }, { value: 3, label: '3 mois' },
];
const ALERT_OPTIONS = [
  { value: 0.25, label: '7 jours' }, { value: 0.5, label: '15 jours' },
  { value: 1, label: '1 mois' }, { value: 1.5, label: '1.5 mois' }, { value: 2, label: '2 mois' },
];

const NEEDS_COLUMNS = [
  { key: 'stock', label: 'Stock' },
  { key: 'on_order', label: 'En commande' },
  { key: 'sales_in_period', label: 'Ventes période' },
  { key: 'avg_monthly_sales', label: 'Ventes/mois' },
  { key: 'shelf_days', label: 'Jours en rayon' },
  { key: 'tendance', label: 'Tendance' },
  { key: 'stock_will_last', label: 'Stock j.' },
  { key: 'theoretical_need', label: 'Besoin théo.' },
  { key: 'supposed_need', label: 'Besoin supp.' },
  { key: 'theoretical_proposal', label: 'Prop. théo.' },
  { key: 'supposed_proposal', label: 'Prop. supp.' },
  { key: 'last_purchase_at', label: 'Dernier achat' },
];

/* ─── localStorage par boutique ────────────────────────── */
const FKEY = (slug) => `yv.boutique.needsv2.${slug}.filters`;
const CKEY = (slug) => `yv.boutique.needsv2.${slug}.cols`;
const loadJSON = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/* ─── Calculs (portés de la V2), délai de réappro = 0 ──── */
const linReg = (sales) => {
  const n = sales.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += sales[i]; sxy += i * sales[i]; sx2 += i * i; }
  const ax = sx / n, ay = sy / n, den = sx2 - n * ax * ax;
  if (den === 0 || ay === 0) return { coefficient: 1, rSquared: 0 };
  const slope = (sxy - n * ax * ay) / den, inter = ay - slope * ax;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { ssRes += (sales[i] - (slope * i + inter)) ** 2; ssTot += (sales[i] - ay) ** 2; }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const proj = ay + slope * (n - ax);
  let c = ay === 0 ? (proj > 0 ? 2 : 1) : proj / ay;
  return { coefficient: Math.max(0.1, Math.min(5, c)), rSquared: Math.max(0, r2) };
};
const wma = (sales) => {
  const n = sales.length;
  if (n < 2) return 1;
  let ws = 0, tw = 0;
  for (let i = 0; i < n; i++) { ws += sales[i] * (i + 1); tw += i + 1; }
  const wAvg = ws / tw, sAvg = sales.reduce((a, b) => a + b, 0) / n;
  if (sAvg === 0) return wAvg > 0 ? 1.5 : 1;
  return Math.max(0.1, Math.min(5, wAvg / sAvg));
};
const trendCoef = (weekly) => {
  if (!weekly || weekly.length < 2) return 1;
  const vals = weekly.map((m) => parseInt(m.total_qty, 10) || 0);
  const reg = linReg(vals);
  return reg.rSquared >= 0.7 ? reg.coefficient : wma(vals);
};

// Besoin d'un produit : mêmes formules que NeedsTabV2, sans délai (boutique)
// Date locale → 'YYYY-MM-DD' (les jours hors rayon arrivent en heure de Paris)
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const LOW_HINDSIGHT_DAYS = 14; // en rayon depuis moins que ça : rythme peu fiable
const MIN_SHELF_DAYS = 30;     // jours en rayon minimum pour juger d'un rythme
const LOADED_DAYS = 124;       // ventes et jours hors rayon chargés (125 j côté serveur)

function computeProductNeeds(product, periodDays, coverageMonths, isCustom, startDate, endDate, unit, alertMonths) {
  const { daily_sales = [], off_shelf_days = [], stock = 0, on_order = 0 } = product;
  const safeAlert = alertMonths != null ? alertMonths : coverageMonths;
  const effCoverage = Math.max(coverageMonths, safeAlert);

  let sales; let actualDays = periodDays; let from; let to; // [from, to] en 'YYYY-MM-DD'
  const now = new Date();
  if (isCustom && startDate && endDate) {
    const s = new Date(startDate + 'T00:00:00'), e = new Date(endDate + 'T23:59:59');
    sales = daily_sales.filter((m) => { const d = new Date(m.date); return d >= s && d <= e; });
    actualDays = Math.max(Math.ceil((e - s) / 86400000), 1);
    from = startDate; to = endDate;
  } else if (unit === 'months') {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const start = new Date(now.getFullYear(), now.getMonth() - Math.round(periodDays / 30), 1);
    sales = daily_sales.filter((m) => { const d = new Date(m.date); return d >= start && d < tomorrow; });
    actualDays = Math.max(Math.ceil((tomorrow - start) / 86400000), 1);
    from = ymd(start); to = ymd(now);
  } else {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - periodDays);
    sales = daily_sales.filter((m) => { const d = new Date(m.date); return d >= start && d < tomorrow; });
    actualDays = periodDays;
    from = ymd(start); to = ymd(now);
  }

  // Ventes ÷ jours EN RAYON, pas ÷ toute la période : une rupture ou une
  // arrivée récente ne fait plus passer le produit pour lent.
  const offInPeriod = off_shelf_days.filter((d) => d >= from && d <= to).length;
  const salesInPeriod = sales.reduce((a, m) => a + (parseInt(m.total_qty, 10) || 0), 0);

  // Trop peu de jours en rayon pour juger (longue rupture) : on remonte AVANT la
  // période jusqu'à MIN_SHELF_DAYS jours en rayon. Sinon 2 ventes les 2 derniers
  // jours avant une rupture de 2 mois font « 30 par mois » (Z Nano 3 Black).
  // Faute d'historique suffisant, on divise quand même par ce minimum.
  // Absent TOUTE la période : on ne remonte pas, la période ne dit rien de lui
  // (on irait chercher une vente en gros d'avant, ou un produit arrêté).
  const minShelf = Math.min(MIN_SHELF_DAYS, actualDays);
  const periodShelfDays = Math.min(Math.max(actualDays - offInPeriod, 0), actualDays);
  let shelfDays = periodShelfDays; // + les jours repris avant la période
  let rateSales = salesInPeriod; let extendedFrom = null;
  if (periodShelfDays > 0 && shelfDays < minShelf) {
    const off = new Set(off_shelf_days);
    const qtyByDay = new Map(daily_sales.map((m) => [m.date, parseInt(m.total_qty, 10) || 0]));
    const oldest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - LOADED_DAYS));
    const d = new Date(from + 'T00:00:00');
    while (shelfDays < minShelf) {
      d.setDate(d.getDate() - 1);
      const k = ymd(d);
      if (k < oldest) break;
      if (off.has(k)) continue;
      shelfDays += 1; rateSales += qtyByDay.get(k) || 0; extendedFrom = k;
    }
  }
  const rateDays = Math.max(shelfDays, minShelf, 1);

  const weeklyMap = new Map();
  for (const d of sales) {
    const dt = new Date(d.date);
    const dow = (dt.getDay() + 6) % 7;
    const monday = new Date(dt); monday.setDate(dt.getDate() - dow);
    const key = monday.toISOString().slice(0, 10);
    weeklyMap.set(key, (weeklyMap.get(key) || 0) + (parseInt(d.total_qty, 10) || 0));
  }
  const weekly = [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, q]) => ({ total_qty: q }));
  const coef = trendCoef(weekly);

  const leadTimeDays = 0; // boutiques : pas de délai
  const dailyRate = rateSales / rateDays;
  const avgMonthly = dailyRate * 30;
  const effectiveStock = stock + on_order; // comme la V2 : le stock en commande compte
  const stockWillLast = dailyRate > 0 ? effectiveStock / dailyRate : Infinity;
  const alertDays = leadTimeDays + safeAlert * 30;
  const targetDays = leadTimeDays + effCoverage * 30;
  const shouldReorder = dailyRate > 0 && stockWillLast < alertDays;
  const theoNeed = dailyRate > 0 ? dailyRate * targetDays : 0;
  const theoProp = shouldReorder ? Math.max(0, Math.ceil(theoNeed) - effectiveStock) : 0;
  const projRate = dailyRate * coef;
  const suppNeed = projRate > 0 ? projRate * targetDays : 0;
  const suppProp = shouldReorder ? Math.max(0, Math.ceil(suppNeed) - effectiveStock) : 0;

  return {
    sales_in_period: salesInPeriod,
    shelf_days: periodShelfDays,
    period_days: actualDays,
    rate_sales: rateSales,
    rate_days: rateDays,
    extended_from: extendedFrom,
    low_hindsight: rateSales > 0 && shelfDays < Math.min(LOW_HINDSIGHT_DAYS, actualDays),
    avg_monthly_sales: Math.round(avgMonthly * 100) / 100,
    trend_coefficient: Math.round(coef * 100) / 100,
    trend_direction: coef > 1.1 ? 'up' : coef < 0.9 ? 'down' : 'stable',
    daily_rate: Math.round(dailyRate * 1000) / 1000,
    stock_will_last: dailyRate > 0 ? Math.round(stockWillLast) : null,
    theoretical_need: Math.ceil(theoNeed),
    supposed_need: Math.ceil(suppNeed),
    theoretical_proposal: theoProp,
    supposed_proposal: suppProp,
  };
}

/* ─── Formatage ─────────────────────────────────────────── */
const NBSP = /[  ]/g;
const fmtInt = (v) => (parseInt(v, 10) || 0).toLocaleString('fr-FR').replace(NBSP, ' ');
const fmtNum = (v) => (parseFloat(v) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(NBSP, ' ');
// '2026-10-08' → '08/10/2026' (sans passer par Date : pas de décalage de fuseau)
const fmtDay = (d) => (d ? d.split('-').reverse().join('/') : '-');
// Provenance du fournisseur affiché (cf. getNeedsData) : rien si acheté par cette boutique
const SOURCE_NOTE = { autre: "acheté par l'autre boutique", fiche: 'jamais acheté, fiche Nextore' };
const normalize = (str) => (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-_.,;:!?()[\]]/g, ' ').replace(/\s+/g, ' ').trim();

const cycleTri = (v) => (v === null ? true : v === true ? false : null);
function TriState({ value, onChange, label }) {
  const bg = value === true ? '#dcfce7' : value === false ? '#fee2e2' : '#f3f4f6';
  const col = value === true ? '#16a34a' : value === false ? '#dc2626' : '#6b7280';
  return (
    <button type="button" onClick={() => onChange(cycleTri(value))}
      title={value === null ? 'Tout afficher' : value === true ? 'Oui seulement' : 'Non seulement'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1px solid ${col}`, background: bg, color: col, borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 16, textAlign: 'center' }}>{value === true ? '✓' : value === false ? '✕' : '•'}</span>
      {label}
    </button>
  );
}

/* ─── COMPOSANT ─────────────────────────────────────────── */
export default function BesoinsTab({ shop, token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const saved = loadJSON(FKEY(shop.slug), {});

  const [allProducts, setAllProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [supplierId, setSupplierId] = useState(saved.supplierId || '');
  const [categoryId, setCategoryId] = useState(saved.categoryId || '');
  const [search, setSearch] = useState('');
  const [analysisPeriodType, setAnalysisPeriodType] = useState(saved.analysisPeriodType || 'preset');
  const [analysisPeriod, setAnalysisPeriod] = useState(saved.analysisPeriod || 31);
  const [analysisPeriodUnit, setAnalysisPeriodUnit] = useState(saved.analysisPeriodUnit || 'days');
  const [analysisStartDate, setAnalysisStartDate] = useState(saved.analysisStartDate || '');
  const [analysisEndDate, setAnalysisEndDate] = useState(saved.analysisEndDate || '');
  const [alertMonths, setAlertMonths] = useState(saved.alertMonths ?? 1);
  const [coverageMonths, setCoverageMonths] = useState(saved.coverageMonths || 2);
  const [withSalesOnly, setWithSalesOnly] = useState(saved.withSalesOnly ?? null);
  const [zeroStockState, setZeroStockState] = useState(saved.zeroStockState ?? null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortColumn, setSortColumn] = useState('theoretical_proposal');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selected, setSelected] = useState({});
  const [hiddenCols, setHiddenCols] = useState(() => loadJSON(CKEY(shop.slug), ['theoretical_need', 'supposed_need']));
  const [showColPanel, setShowColPanel] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [sending, setSending] = useState(false);
  const [orderResults, setOrderResults] = useState(null);
  const searchTimeout = useRef(null);

  useEffect(() => {
    saveJSON(FKEY(shop.slug), { supplierId, categoryId, analysisPeriodType, analysisPeriod, analysisPeriodUnit, analysisStartDate, analysisEndDate, alertMonths, coverageMonths, withSalesOnly, zeroStockState });
  }, [shop.slug, supplierId, categoryId, analysisPeriodType, analysisPeriod, analysisPeriodUnit, analysisStartDate, analysisEndDate, alertMonths, coverageMonths, withSalesOnly, zeroStockState]);

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_URL}/nextore/${shop.slug}/needs-data`, auth);
      setAllProducts(res.data.products || []);
      setSuppliers(res.data.suppliers || []);
      setCategories(res.data.categories || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur de chargement');
    } finally { setLoading(false); }
  }, [shop.slug, token]);
  useEffect(() => { loadData(); }, [loadData]);

  const isVisible = (k) => !hiddenCols.includes(k);
  const toggleColumn = (k) => setHiddenCols((prev) => {
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    saveJSON(CKEY(shop.slug), next); return next;
  });

  const effectivePeriodDays = useMemo(() => {
    if (analysisPeriodType === 'custom' && analysisStartDate && analysisEndDate) {
      return Math.max(Math.ceil((new Date(analysisEndDate) - new Date(analysisStartDate)) / 86400000), 1);
    }
    if (analysisPeriodUnit === 'months') return Math.round(analysisPeriod * 30);
    return analysisPeriod;
  }, [analysisPeriodType, analysisPeriod, analysisPeriodUnit, analysisStartDate, analysisEndDate]);
  const isCustomPeriod = analysisPeriodType === 'custom';

  const computed = useMemo(() => allProducts.map((p) => ({
    ...p,
    ...computeProductNeeds(p, effectivePeriodDays, coverageMonths, isCustomPeriod, analysisStartDate, analysisEndDate, analysisPeriodUnit, alertMonths),
  })), [allProducts, effectivePeriodDays, coverageMonths, alertMonths, isCustomPeriod, analysisStartDate, analysisEndDate, analysisPeriodUnit]);

  const getSupplierRef = (row) =>
    (supplierId && row.supplier_refs && row.supplier_refs[String(supplierId)]?.ref) || (row.supplier_refs && row.supplier_refs[String(row.supplier_id)]?.ref) || '';
  const supplierName = (row) => (supplierId ? (suppliers.find((s) => s.id === supplierId)?.company) : row.supplier_name) || row.supplier_name;

  const filtered = useMemo(() => {
    const words = normalize(search).length >= 2 ? normalize(search).split(' ').filter(Boolean) : [];
    return computed.filter((p) => {
      if (supplierId && !(p.supplier_ids || []).map(String).includes(String(supplierId))) return false;
      if (categoryId && String(p.category_id) !== String(categoryId)) return false;
      if (words.length) {
        const hay = normalize(`${p.name} ${p.sku} ${p.supplier_name} ${p.category_name}`);
        return words.every((w) => hay.includes(w));
      }
      if (withSalesOnly === true && p.avg_monthly_sales <= 0) return false;
      if (withSalesOnly === false && p.avg_monthly_sales > 0) return false;
      if (zeroStockState === true && p.stock > 0) return false;
      if (zeroStockState === false && p.stock <= 0) return false;
      return p.theoretical_proposal > 0 || p.supposed_proposal > 0;
    });
  }, [computed, search, supplierId, categoryId, withSalesOnly, zeroStockState]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const va = a[sortColumn], vb = b[sortColumn];
      if (typeof va === 'string' || typeof vb === 'string') {
        return (sortDirection === 'asc' ? 1 : -1) * String(va ?? '').localeCompare(String(vb ?? ''), 'fr');
      }
      return (sortDirection === 'asc' ? 1 : -1) * ((va ?? 0) - (vb ?? 0));
    });
    return list;
  }, [filtered, sortColumn, sortDirection]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(() => (pageSize === 0 ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize)), [sorted, page, pageSize]);
  useEffect(() => { setPage(1); }, [supplierId, categoryId, withSalesOnly, zeroStockState, effectivePeriodDays, alertMonths, coverageMonths, pageSize]);

  const handleSort = (c) => {
    if (sortColumn === c) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortColumn(c); setSortDirection('desc'); }
  };
  const SortTh = ({ column, label }) => (
    <th className="text-right sortable-header" onClick={() => handleSort(column)} style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label}<span style={{ marginLeft: 4, opacity: sortColumn === column ? 1 : 0.3 }}>{sortColumn === column ? (sortDirection === 'asc' ? '▲' : '▼') : '▼'}</span>
    </th>
  );

  const setQty = (id, qty) => setSelected((prev) => { const n = { ...prev }; if (qty > 0) n[id] = qty; else delete n[id]; return n; });
  const fillProps = (key) => setSelected((prev) => { const n = { ...prev }; filtered.forEach((p) => { if (p[key] > 0) n[p.id] = p[key]; }); return n; });
  const productById = useMemo(() => new Map(computed.map((p) => [p.id, p])), [computed]);
  // Une commande par fournisseur : celui du filtre, sinon celui de la ligne
  const orderGroups = useMemo(() => {
    const groups = new Map();
    for (const [id, qty] of Object.entries(selected)) {
      const p = productById.get(id);
      if (!p) continue;
      const sid = supplierId || p.supplier_id || '';
      if (!groups.has(sid)) {
        const name = sid ? (suppliers.find((s) => s.id === sid)?.company || p.supplier_name || `#${sid}`) : 'Sans fournisseur';
        groups.set(sid, { supplierId: sid, name, lines: [] });
      }
      groups.get(sid).lines.push({ product_id: id, name: p.name, sku: p.sku, quantity: qty });
    }
    return [...groups.values()].sort((a, b) => (!a.supplierId) - (!b.supplierId) || a.name.localeCompare(b.name, 'fr'));
  }, [selected, productById, supplierId, suppliers]);

  const sendOrders = async () => {
    setSending(true);
    const results = [];
    const sent = [];
    for (const g of orderGroups.filter((x) => x.supplierId)) {
      try {
        const res = await axios.post(`${API_URL}/nextore/${shop.slug}/purchases`, {
          supplier_id: g.supplierId,
          items: g.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        }, auth);
        results.push({ name: g.name, ok: true, ref: res.data.reference, count: g.lines.length });
        sent.push(...g.lines.map((l) => l.product_id));
      } catch (e) {
        results.push({ name: g.name, ok: false, error: e.response?.data?.error || e.message });
      }
    }
    setSelected((prev) => { const n = { ...prev }; sent.forEach((id) => delete n[id]); return n; });
    setOrderResults(results);
    setSending(false);
    if (sent.length) loadData();
  };
  const closeOrder = () => { setShowOrder(false); setOrderResults(null); };

  const selCount = Object.keys(selected).length;
  const selTotal = Object.values(selected).reduce((a, b) => a + b, 0);

  const changePeriod = (value) => {
    if (value === 'custom') {
      setAnalysisPeriodType('custom');
      if (!analysisEndDate) {
        const e = new Date(), s = new Date(); s.setMonth(s.getMonth() - 1);
        setAnalysisEndDate(e.toISOString().split('T')[0]); setAnalysisStartDate(s.toISOString().split('T')[0]);
      }
    } else {
      setAnalysisPeriodType('preset');
      const opt = ANALYSIS_PERIOD_OPTIONS.find((o) => String(o.value) === value);
      setAnalysisPeriod(parseFloat(value)); setAnalysisPeriodUnit(opt?.unit || 'days');
    }
  };
  const renderTrend = (dir, coef) => dir === 'up' ? <span className="trend-up">↗ ×{coef}</span> : dir === 'down' ? <span className="trend-down">↘ ×{coef}</span> : <span className="trend-stable">→</span>;
  const periodSelectValue = analysisPeriodType === 'custom' ? 'custom' : analysisPeriod;
  const visCount = NEEDS_COLUMNS.filter((c) => isVisible(c.key)).length;

  return (
    <div className="needs-tab" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 150px)', minHeight: 420 }}>
      <div className="purchases-card">
        {/* Filtres */}
        <div className="filters-bar">
          <div className="filter-group">
            <label>Fournisseur</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Tous les fournisseurs</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company || `#${s.id}`} ({s.product_count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label>Catégorie</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name || `#${c.id}`} ({c.product_count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label>Période d'analyse</label>
            <select value={periodSelectValue} onChange={(e) => changePeriod(e.target.value)}>
              {ANALYSIS_PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {analysisPeriodType === 'custom' && (
            <>
              <div className="filter-group"><label>Date début</label><input type="date" value={analysisStartDate} onChange={(e) => setAnalysisStartDate(e.target.value)} /></div>
              <div className="filter-group"><label>Date fin</label><input type="date" value={analysisEndDate} onChange={(e) => setAnalysisEndDate(e.target.value)} /></div>
            </>
          )}
          <div className="filter-group">
            <label>Seuil de déclenchement</label>
            <select value={alertMonths} onChange={(e) => setAlertMonths(parseFloat(e.target.value))}>
              {ALERT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label>Couverture cible{coverageMonths < alertMonths && <span title="Ramenée au seuil" style={{ color: '#d97706', marginLeft: 6 }}>⚠</span>}</label>
            <select value={coverageMonths} onChange={(e) => setCoverageMonths(parseFloat(e.target.value))}>
              {COVERAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="filter-group" style={{ marginLeft: 'auto', position: 'relative' }}>
            <label>&nbsp;</label>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowColPanel((p) => !p)}>⚙ Colonnes</button>
            {showColPanel && (
              <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 100, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: '14px 16px', minWidth: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: '#374151' }}>Colonnes visibles</div>
                {NEEDS_COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={isVisible(col.key)} onChange={() => toggleColumn(col.key)} />{col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="filters-bar" style={{ marginTop: 10, marginBottom: 0 }}>
          <TriState value={withSalesOnly} onChange={setWithSalesOnly} label="Avec ventes" />
          <TriState value={zeroStockState} onChange={setZeroStockState} label="Stock nul/négatif" />
          <input type="text" placeholder="Rechercher produit, SKU, fournisseur…" value={search}
            onChange={(e) => { setSearch(e.target.value); if (searchTimeout.current) clearTimeout(searchTimeout.current); searchTimeout.current = setTimeout(() => setPage(1), 300); }}
            style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, width: 240 }} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }} style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}>
              <option value={50}>50</option><option value={100}>100</option><option value={200}>200</option><option value={0}>Tout</option>
            </select>
            {allProducts.length > 0 && <span style={{ fontSize: 13, color: '#888' }}>{filtered.length} / {allProducts.length} produits</span>}
            <button className="btn btn-secondary btn-sm" onClick={() => fillProps('theoretical_proposal')}>📥 Théorique</button>
            <button className="btn btn-secondary btn-sm" onClick={() => fillProps('supposed_proposal')}>📥 Supposé</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected({})}>🗑️ Vider</button>
          </div>
        </div>

        {selCount > 0 && (
          <div style={{ background: '#fef3c7', padding: '10px 15px', borderRadius: 6, marginTop: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>{fmtInt(selCount)}</strong> produit(s) — <strong>{fmtInt(selTotal)}</strong> unités au total</span>
            <button className="btn btn-primary" onClick={() => setShowOrder(true)}>📦 Créer la commande</button>
          </div>
        )}
      </div>

      {/* Table — conteneur de défilement (vertical + horizontal) : l'en-tête
          sticky s'accroche à ce scrollport et reste visible au défilement. */}
      <div className="purchases-card" style={{ padding: 0, flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Chargement des produits…</div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#8a99a4' }}>Aucun produit à commander avec ces réglages.</div>
        ) : (
          <>
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Réf. fournisseur</th>
                  <th>SKU</th>
                  {isVisible('stock') && <SortTh column="stock" label="Stock" />}
                  {isVisible('on_order') && <SortTh column="on_order" label="En commande" />}
                  {isVisible('sales_in_period') && <SortTh column="sales_in_period" label="Ventes période" />}
                  {isVisible('avg_monthly_sales') && <SortTh column="avg_monthly_sales" label="Ventes/mois" />}
                  {isVisible('shelf_days') && <SortTh column="shelf_days" label="Jours en rayon" />}
                  {isVisible('tendance') && <th className="text-center">Tendance</th>}
                  {isVisible('stock_will_last') && <SortTh column="stock_will_last" label="Stock j." />}
                  {isVisible('theoretical_need') && <SortTh column="theoretical_need" label="Besoin théo." />}
                  {isVisible('supposed_need') && <SortTh column="supposed_need" label="Besoin supp." />}
                  {isVisible('theoretical_proposal') && <SortTh column="theoretical_proposal" label="Prop. théo." />}
                  {isVisible('supposed_proposal') && <SortTh column="supposed_proposal" label="Prop. supp." />}
                  {isVisible('last_purchase_at') && <SortTh column="last_purchase_at" label="Dernier achat" />}
                  <th className="text-right">À commander</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row, i) => (
                  <tr key={row.id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{row.name || '—'}</div>
                      <small style={{ color: '#666' }}>
                        {supplierName(row) || 'Sans fournisseur'}
                        {!supplierId && SOURCE_NOTE[row.supplier_source] && <span style={{ color: '#d97706' }}> ({SOURCE_NOTE[row.supplier_source]})</span>}
                        {row.category_name ? ` · ${row.category_name}` : ''}
                      </small>
                    </td>
                    <td><code style={{ fontSize: 12 }}>{getSupplierRef(row) || '-'}</code></td>
                    <td><code style={{ fontSize: 12 }}>{row.sku || '-'}</code></td>
                    {isVisible('stock') && <td className="text-right"><span className={row.stock < 0 ? 'stock-critical' : row.stock === 0 ? 'stock-low' : ''}>{fmtInt(row.stock)}</span></td>}
                    {isVisible('on_order') && <td className="text-right">{row.on_order > 0 ? fmtInt(row.on_order) : '-'}</td>}
                    {isVisible('sales_in_period') && <td className="text-right">{fmtInt(row.sales_in_period)}</td>}
                    {isVisible('avg_monthly_sales') && <td className="text-right">{fmtNum(row.avg_monthly_sales)}</td>}
                    {isVisible('shelf_days') && (
                      <td className="text-right" title={row.extended_from
                        ? `Trop peu de jours en rayon sur la période : Ventes/mois calculées sur ${row.rate_sales} vente(s) en ${row.rate_days} jours en rayon depuis le ${fmtDay(row.extended_from)}`
                        : `Ventes/mois calculées sur ${row.rate_sales} vente(s) en ${row.rate_days} jours en rayon (stock > 0 ou vente) sur ${row.period_days}`}>
                        <span style={{ color: row.shelf_days < row.period_days ? '#d97706' : undefined }}>{fmtInt(row.shelf_days)}</span>
                        <span style={{ color: '#9ca3af' }}> / {fmtInt(row.period_days)}</span>
                        {row.extended_from && <div style={{ fontSize: 11, color: '#d97706' }}>rythme sur {fmtInt(row.rate_days)} j depuis le {fmtDay(row.extended_from)}</div>}
                        {row.low_hindsight && <div style={{ fontSize: 11, color: '#d97706' }}>peu de recul</div>}
                      </td>
                    )}
                    {isVisible('tendance') && <td className="text-center">{renderTrend(row.trend_direction, row.trend_coefficient)}</td>}
                    {isVisible('stock_will_last') && <td className="text-right">{row.stock_will_last == null ? '∞' : fmtInt(row.stock_will_last)}</td>}
                    {isVisible('theoretical_need') && <td className="text-right">{fmtInt(row.theoretical_need)}</td>}
                    {isVisible('supposed_need') && <td className="text-right">{fmtInt(row.supposed_need)}</td>}
                    {isVisible('theoretical_proposal') && <td className="text-right">{row.theoretical_proposal > 0 ? fmtInt(row.theoretical_proposal) : '-'}</td>}
                    {isVisible('supposed_proposal') && <td className="text-right">{row.supposed_proposal > 0 ? fmtInt(row.supposed_proposal) : '-'}</td>}
                    {isVisible('last_purchase_at') && <td className="text-right">{fmtDay(row.last_purchase_at)}</td>}
                    <td className="text-right">
                      <input type="number" className="qty-input" min="0" placeholder="0"
                        value={selected[row.id] || ''} onChange={(e) => setQty(row.id, parseInt(e.target.value, 10) || 0)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pageSize > 0 && totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← Précédent</button>
                <span className="pagination-info">Page {page} / {totalPages} ({filtered.length} produits)</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Suivant →</button>
              </div>
            )}
          </>
        )}
      </div>

      {showOrder && (
        <div className="modal-overlay" onClick={() => !sending && closeOrder()}>
          <div className="modal-content" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Créer la commande — {shop.label}</h3>
              <button className="modal-close" onClick={closeOrder} disabled={sending}>×</button>
            </div>
            <div className="modal-body">
              {orderResults ? (
                orderResults.map((r) => (
                  <div key={r.name} style={{ padding: '8px 0', color: r.ok ? '#16a34a' : '#dc2626' }}>
                    <strong>{r.name}</strong> — {r.ok ? `commande ${r.ref} créée (${r.count} produit(s)), à réceptionner dans Achat › Commandes` : `échec : ${r.error}`}
                  </div>
                ))
              ) : (
                <>
                  <p style={{ marginTop: 0, color: '#555', fontSize: 14 }}>
                    Une commande sera créée par fournisseur. À l'arrivée, elle se réceptionne dans <strong>Achat › Commandes</strong>, qui met le stock Nextore à jour.
                  </p>
                  {orderGroups.map((g) => (
                    <div key={g.supplierId || 'none'} style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 600, color: g.supplierId ? '#111' : '#dc2626' }}>
                        {g.name} — {g.lines.length} produit(s), {fmtInt(g.lines.reduce((a, l) => a + l.quantity, 0))} unités
                        {!g.supplierId && ' : non envoyés (choisir un fournisseur dans le filtre)'}
                      </div>
                      <table className="purchases-table" style={{ marginTop: 6 }}>
                        <tbody>
                          {g.lines.map((l) => (
                            <tr key={l.product_id}>
                              <td>{l.name}</td>
                              <td><code style={{ fontSize: 12 }}>{l.sku || '-'}</code></td>
                              <td className="text-right">{fmtInt(l.quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="modal-footer">
              {orderResults ? (
                <button className="btn btn-primary" onClick={closeOrder}>Fermer</button>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={closeOrder} disabled={sending}>Annuler</button>
                  <button className="btn btn-primary" onClick={sendOrders} disabled={sending || !orderGroups.some((g) => g.supplierId)}>
                    {sending ? 'Création…' : `Créer ${orderGroups.filter((g) => g.supplierId).length} commande(s)`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
