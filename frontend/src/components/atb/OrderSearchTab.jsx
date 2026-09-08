import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import MultiSelect from './MultiSelect';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  atb: '#BE123C', et: '#135E84', ou: '#E28F00',
  vert: '#4AB866', rouge: '#DE2020',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);
const eur = (v) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)} €`;

/* Date locale : jamais toISOString(), qui renvoie la veille en soirée. */
const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const frDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

/* ─── STATUTS ───────────────────────────────────────────
 * ⚠️ La table équivalente d'OrdersSearchApp oublie `wc-shipped` et
 * `wc-awaiting-delivery`, deux des six statuts payés. Celle-ci les inclut.
 * ────────────────────────────────────────────────────── */
const STATUS_LABELS = {
  'wc-completed': 'Expédiée',
  'wc-delivered': 'Livrée',
  'wc-processing': 'En cours',
  'wc-shipped': 'Expédiée (transporteur)',
  'wc-awaiting-delivery': 'Retrait boutique',
  'wc-being-delivered': 'En livraison',
  'wc-on-hold': 'En attente',
  'wc-pending': 'Attente paiement',
  'wc-cancelled': 'Annulée',
  'wc-refunded': 'Remboursée',
  'wc-failed': 'Échouée',
  'wc-checkout-draft': 'Panier abandonné',
};
const STATUS_COLORS = {
  'wc-completed': '#135E84', 'wc-delivered': '#28a745', 'wc-processing': '#e6a817',
  'wc-shipped': '#0EA5A5', 'wc-awaiting-delivery': '#7C3AED', 'wc-being-delivered': '#17a2b8',
  'wc-on-hold': '#fd7e14', 'wc-pending': '#6c757d', 'wc-cancelled': '#dc3545',
  'wc-refunded': '#6f42c1', 'wc-failed': '#dc3545', 'wc-checkout-draft': '#E28F00',
};
const statusLabel = (s) => STATUS_LABELS[s] || String(s || '').replace(/^wc-/, '');

/** Les 6 statuts payés (règle projet). Sert de première règle par défaut. */
const PAID_STATUSES = [
  'wc-completed', 'wc-delivered', 'wc-processing',
  'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered',
];

/* ─── CRITÈRES ──────────────────────────────────────────── */
const FIELDS = [
  { key: 'content',  label: 'Contenu de la commande' },
  { key: 'status',   label: 'Statut' },
  { key: 'city',     label: 'Ville de livraison' },
  { key: 'postcode', label: 'Code postal' },
  { key: 'country',  label: 'Pays' },
  { key: 'carrier',  label: 'Mode de livraison' },
  { key: 'date',     label: 'Période' },
  { key: 'amount',   label: 'Montant' },
];

const CONTENT_TARGETS = [
  { key: 'product',  label: 'le produit', phrase: 'le produit' },
  { key: 'category', label: 'un produit de la catégorie', phrase: 'un produit de la catégorie' },
  { key: 'brand',    label: 'un produit de la marque', phrase: 'un produit de la marque' },
];

let ruleSeq = 0;
function newRule(field = 'content') {
  ruleSeq += 1;
  const base = { uid: `r${Date.now()}${ruleSeq}`, join: 'AND', field };
  if (field === 'content') return { ...base, op: 'includes', target: 'category', values: [] };
  if (field === 'city' || field === 'postcode') return { ...base, value: '' };
  if (field === 'date') return { ...base, from: '', to: '' };
  if (field === 'amount') return { ...base, min: '', max: '' };
  return { ...base, values: [] };
}

/**
 * Découpe la liste plate en groupes ET — miroir exact du backend.
 *
 * Le ET lie plus fort que le OU : « A ET B OU C » vaut « (A ET B) OU C ».
 * Cette priorité est invisible dans une liste plate, et c'est le piège de ce
 * genre d'outil. On la RENDS visible en encadrant chaque groupe ET.
 */
function buildGroups(rules) {
  const groups = [];
  let current = [];
  rules.forEach((rule, i) => {
    if (i > 0 && rule.join === 'OR') { groups.push(current); current = []; }
    current.push({ rule, index: i });
  });
  if (current.length) groups.push(current);
  return groups;
}

/* ─── PHRASE RÉCAPITULATIVE ─────────────────────────────── */
function describeRule(rule, ctx) {
  const list = (vals, map) => {
    const labels = (vals || []).map((v) => (map ? map(v) : v));
    if (!labels.length) return '…';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} ou ${labels[labels.length - 1]}`;
  };

  switch (rule.field) {
    case 'status':
      return `dont le statut est ${list(rule.values, statusLabel)}`;
    case 'country':
      return `livrées en ${list(rule.values)}`;
    case 'carrier':
      return `envoyées en ${list(rule.values)}`;
    case 'city':
      return `livrées dans une ville contenant « ${rule.value || '…'} »`;
    case 'postcode':
      return `dont le code postal commence par ${rule.value || '…'}`;
    case 'date': {
      if (rule.from && rule.to) return `passées entre le ${frDate(rule.from)} et le ${frDate(rule.to)}`;
      if (rule.from) return `passées à partir du ${frDate(rule.from)}`;
      if (rule.to) return `passées jusqu'au ${frDate(rule.to)}`;
      return 'sur une période à préciser';
    }
    case 'amount': {
      if (rule.min !== '' && rule.max !== '') return `d'un montant entre ${rule.min} € et ${rule.max} €`;
      if (rule.min !== '') return `d'un montant d'au moins ${rule.min} €`;
      if (rule.max !== '') return `d'un montant d'au plus ${rule.max} €`;
      return 'd\'un montant à préciser';
    }
    case 'content': {
      const verb = rule.op === 'excludes' ? 'ne comprenant pas' : 'comprenant';
      const target = CONTENT_TARGETS.find((t) => t.key === rule.target);
      const names = rule.target === 'product'
        ? list(rule.values, (v) => ctx.productNames[v] || `#${v}`)
        : list(rule.values);
      return `${verb} ${target ? target.phrase : ''} ${names}`;
    }
    default:
      return rule.field;
  }
}

function recapSentence(rules, ctx) {
  if (!rules.length) return 'Toutes les commandes, sans aucun filtre.';
  const groups = buildGroups(rules);
  const parts = groups.map((g) => g.map(({ rule }) => describeRule(rule, ctx)).join(' ET '));
  if (parts.length === 1) return `Les commandes ${parts[0]}.`;
  return `Les commandes : ${parts.map((p) => `(${p})`).join(' OU ')}.`;
}

/* ─── SAISIE VILLE (suggestions) ────────────────────────── */
function CityInput({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const fetchSuggestions = (q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setSuggestions([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/atb/search/cities`, { params: { q: q.trim() } });
        setSuggestions(res.data.cities || []);
        setOpen(true);
      } catch { setSuggestions([]); }
    }, 300);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); fetchSuggestions(e.target.value); }}
        onFocus={() => suggestions.length && setOpen(true)}
        placeholder="Montpellier…"
        style={{
          width: 240, padding: '7px 10px', border: `1px solid ${value ? C.atb : C.grisCL}`,
          borderRadius: 7, fontSize: 13, color: C.grisTF, outline: 'none',
        }}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 5, width: 280,
          maxHeight: 260, overflowY: 'auto', background: C.blanc,
          border: `1px solid ${C.grisCL}`, borderRadius: 9, boxShadow: '0 10px 30px rgba(0,0,0,0.13)',
        }}>
          <div style={{ padding: '7px 11px', fontSize: 11, color: C.grisM, borderBottom: `1px solid ${C.grisCL}` }}>
            Orthographes regroupées (casse et accents ignorés)
          </div>
          {suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => { onChange(s.label); setOpen(false); }}
              style={{
                width: '100%', display: 'flex', gap: 9, padding: '6px 11px', border: 'none',
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, fontSize: 12.5, color: C.grisTF }}>{s.label}</span>
              <span style={{ fontSize: 11, color: C.grisM }}>{fmtInt(s.orders)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── SAISIE PRODUIT (recherche acynchrone, multiple) ───── */
function ProductPicker({ values, names, onChange, onName }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const search = (text) => {
    clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/atb/search/products`, { params: { q: text.trim() } });
        setResults(res.data.products || []);
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
  };

  const add = (p) => {
    onName(p.wp_product_id, p.post_title);
    if (!values.includes(p.wp_product_id)) onChange([...values, p.wp_product_id]);
    setQ(''); setResults([]); setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth: 260 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: values.length ? 5 : 0 }}>
        {values.map((id) => (
          <span key={id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px',
            borderRadius: 999, background: `${C.atb}14`, border: `1px solid ${C.atb}44`,
            fontSize: 12, color: C.grisTF, fontWeight: 600,
          }}>
            {names[id] || `#${id}`}
            <button
              onClick={() => onChange(values.filter((v) => v !== id))}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.grisM, padding: 0, fontSize: 13 }}
            >×</button>
          </span>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
        placeholder="Nom ou SKU du produit…"
        style={{
          width: 260, padding: '7px 10px', border: `1px solid ${values.length ? C.atb : C.grisCL}`,
          borderRadius: 7, fontSize: 13, color: C.grisTF, outline: 'none',
        }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 5, width: 340,
          maxHeight: 280, overflowY: 'auto', background: C.blanc,
          border: `1px solid ${C.grisCL}`, borderRadius: 9, boxShadow: '0 10px 30px rgba(0,0,0,0.13)',
        }}>
          <div style={{ padding: '7px 11px', fontSize: 11, color: C.grisM, borderBottom: `1px solid ${C.grisCL}` }}>
            Choisir un produit parent inclut toutes ses déclinaisons
          </div>
          {results.map((p) => (
            <button
              key={p.wp_product_id}
              onClick={() => add(p)}
              style={{
                width: '100%', display: 'flex', gap: 9, alignItems: 'baseline', padding: '6px 11px',
                border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, fontSize: 12.5, color: C.grisTF }}>{p.post_title}</span>
              {p.product_type === 'variation' && (
                <span style={{ fontSize: 10, color: C.grisM, fontStyle: 'italic' }}>déclinaison</span>
              )}
              <span style={{ fontSize: 11, color: C.grisM }}>{p.sku || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── ÉDITEUR D'UNE RÈGLE ───────────────────────────────── */
const selectStyle = {
  padding: '7px 9px', border: `1px solid ${C.grisCL}`, borderRadius: 7,
  fontSize: 13, color: C.grisTF, background: C.blanc, outline: 'none', cursor: 'pointer',
};
const inputStyle = {
  padding: '7px 9px', border: `1px solid ${C.grisCL}`, borderRadius: 7,
  fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
};

function RuleEditor({ rule, onChange, onRemove, facets, statuses, countries, productNames, onProductName }) {
  const patch = (p) => onChange({ ...rule, ...p });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      <select
        value={rule.field}
        onChange={(e) => onChange({ ...newRule(e.target.value), uid: rule.uid, join: rule.join })}
        style={{ ...selectStyle, fontWeight: 600, minWidth: 190 }}
      >
        {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>

      {rule.field === 'content' && (
        <>
          <select value={rule.op} onChange={(e) => patch({ op: e.target.value })} style={selectStyle}>
            <option value="includes">comprend</option>
            <option value="excludes">ne comprend pas</option>
          </select>
          <select
            value={rule.target}
            onChange={(e) => patch({ target: e.target.value, values: [] })}
            style={selectStyle}
          >
            {CONTENT_TARGETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {rule.target === 'product' ? (
            <ProductPicker
              values={rule.values} names={productNames}
              onChange={(v) => patch({ values: v })} onName={onProductName}
            />
          ) : (
            <MultiSelect
              options={(rule.target === 'category' ? facets.categories : facets.brands)
                .map((o) => ({ value: o.label, label: o.label, count: o.products }))}
              selected={rule.values}
              onChange={(v) => patch({ values: v })}
              placeholder={rule.target === 'category' ? 'Choisir des catégories…' : 'Choisir des marques…'}
            />
          )}
        </>
      )}

      {rule.field === 'status' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>est</span>
          <MultiSelect
            options={statuses.map((s) => ({ value: s, label: statusLabel(s) }))}
            selected={rule.values} onChange={(v) => patch({ values: v })}
            placeholder="Choisir des statuts…"
          />
        </>
      )}

      {rule.field === 'country' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>est</span>
          <MultiSelect
            options={countries.map((c) => ({ value: c.code, label: c.code, count: c.orders }))}
            selected={rule.values} onChange={(v) => patch({ values: v })}
            placeholder="Choisir des pays…" width={200}
          />
        </>
      )}

      {rule.field === 'carrier' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>est</span>
          <MultiSelect
            options={facets.shippingMethods.map((m) => ({ value: m.label, label: m.label, count: m.orders }))}
            selected={rule.values} onChange={(v) => patch({ values: v })}
            placeholder="Choisir des modes…" width={280}
          />
        </>
      )}

      {rule.field === 'city' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>contient</span>
          <CityInput value={rule.value} onChange={(v) => patch({ value: v })} />
        </>
      )}

      {rule.field === 'postcode' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>commence par</span>
          <input
            value={rule.value || ''} onChange={(e) => patch({ value: e.target.value })}
            placeholder="34" style={{ ...inputStyle, width: 110 }}
          />
        </>
      )}

      {rule.field === 'date' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>du</span>
          <input type="date" value={rule.from || ''} onChange={(e) => patch({ from: e.target.value })} style={inputStyle} />
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>au</span>
          <input type="date" value={rule.to || ''} onChange={(e) => patch({ to: e.target.value })} style={inputStyle} />
        </>
      )}

      {rule.field === 'amount' && (
        <>
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>de</span>
          <input type="number" value={rule.min} onChange={(e) => patch({ min: e.target.value })}
                 placeholder="0" style={{ ...inputStyle, width: 90 }} />
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>à</span>
          <input type="number" value={rule.max} onChange={(e) => patch({ max: e.target.value })}
                 placeholder="∞" style={{ ...inputStyle, width: 90 }} />
          <span style={{ alignSelf: 'center', fontSize: 13, color: C.grisM }}>€</span>
        </>
      )}

      <button
        onClick={onRemove}
        title="Retirer ce critère"
        style={{
          marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer',
          color: C.grisM, fontSize: 17, lineHeight: 1, padding: '4px 6px', alignSelf: 'center',
        }}
      >×</button>
    </div>
  );
}

/* ─── MODULE ────────────────────────────────────────────── */
export default function OrderSearchTab() {
  const [rules, setRules] = useState(() => [{ ...newRule('status'), values: PAID_STATUSES }]);
  const [facets, setFacets] = useState({ categories: [], brands: [], shippingMethods: [] });
  const [statuses, setStatuses] = useState(Object.keys(STATUS_LABELS));
  const [countries, setCountries] = useState([]);
  const [productNames, setProductNames] = useState({});

  const [results, setResults] = useState(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const [saved, setSaved] = useState([]);
  const [saveName, setSaveName] = useState('');

  const PAGE_SIZE = 50;

  /* ── Chargement des listes ── */
  useEffect(() => {
    (async () => {
      const [f, st, co, sv] = await Promise.allSettled([
        axios.get(`${API_URL}/atb/search/facets`),
        axios.get(`${API_URL}/orders/statuses/list`),
        axios.get(`${API_URL}/atb/orders/countries`),
        axios.get(`${API_URL}/atb/search/saved`),
      ]);
      if (f.status === 'fulfilled') {
        setFacets({
          categories: f.value.data.categories || [],
          brands: f.value.data.brands || [],
          shippingMethods: f.value.data.shippingMethods || [],
        });
      }
      if (st.status === 'fulfilled') {
        const list = (st.value.data.data || [])
          .map((r) => r.post_status || r.status || r)
          .filter((v) => typeof v === 'string');
        if (list.length) setStatuses(list);
      }
      if (co.status === 'fulfilled') setCountries(co.value.data.countries || []);
      if (sv.status === 'fulfilled') setSaved(sv.value.data.searches || []);
    })();
  }, []);

  const onProductName = useCallback((id, name) => {
    setProductNames((prev) => ({ ...prev, [id]: name }));
  }, []);

  const recap = useMemo(() => recapSentence(rules, { productNames }), [rules, productNames]);
  const groups = useMemo(() => buildGroups(rules), [rules]);

  /* ── Recherche ── */
  const runSearch = useCallback(async (targetPage = 0, ruleSet = rules) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/atb/orders/search`, {
        rules: ruleSet.map(({ uid, ...r }) => r), // eslint-disable-line no-unused-vars
        limit: PAGE_SIZE,
        offset: targetPage * PAGE_SIZE,
      });
      setResults(res.data);
      setPage(targetPage);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de recherche');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [rules]);

  /* ── Export CSV ── */
  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/atb/orders/search/export`, {
        rules: rules.map(({ uid, ...r }) => r), // eslint-disable-line no-unused-vars
      });
      const rows = res.data.orders || [];
      const header = ['N° commande', 'Date', 'Statut', 'Client', 'Email', 'Ville', 'Code postal', 'Pays', 'Mode de livraison', 'Suivi', 'Montant'];
      const lines = [header.join(';')];
      for (const o of rows) {
        lines.push([
          o.wp_order_id,
          frDate(o.order_date),
          statusLabel(o.post_status),
          `${o.billing_first_name || ''} ${o.billing_last_name || ''}`.trim().replace(/;/g, ','),
          o.billing_email || '',
          (o.shipping_city || '').replace(/;/g, ','),
          o.shipping_postcode || '',
          o.shipping_country || '',
          (o.shipping_method || '').replace(/;/g, ','),
          o.tracking_number || '',
          String(o.order_total ?? '').replace('.', ','),
        ].join(';'));
      }
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `commandes_${localYmd(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      if (res.data.truncated) {
        setError(`Export limité aux ${fmtInt(res.data.exported)} premières commandes sur ${fmtInt(res.data.total)}. Affinez les critères pour tout obtenir.`);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur d\'export');
    } finally {
      setExporting(false);
    }
  };

  /* ── Recherches enregistrées ── */
  const persistSaved = async (list) => {
    setSaved(list);
    try { await axios.put(`${API_URL}/atb/search/saved`, { searches: list }); }
    catch (err) { console.error('Recherches non enregistrées:', err); }
  };

  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    persistSaved([...saved.filter((s) => s.name !== name), { id: `s${Date.now()}`, name, rules }]);
    setSaveName('');
  };

  const loadSaved = (s) => {
    const restored = (s.rules || []).map((r, i) => ({ ...r, uid: `r${Date.now()}${i}` }));
    setRules(restored);
    runSearch(0, restored);
  };

  /* ── Rendu ── */
  const total = results?.total ?? null;
  const pageCount = total != null ? Math.ceil(total / PAGE_SIZE) : 0;

  return (
    <div>
      {/* ── Constructeur ── */}
      <section style={{
        background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 14, padding: '18px 20px',
      }}>
        <h2 style={{ fontSize: 15.5, fontWeight: 700, color: C.grisTF, margin: '0 0 4px' }}>
          Critères
        </h2>
        <p style={{ fontSize: 12, color: C.grisM, margin: '0 0 16px' }}>
          Les critères reliés par ET sont regroupés dans un même cadre : ils sont évalués ensemble,
          avant les OU. « A ET B OU C » cherche donc « (A ET B) OU C ».
        </p>

        {groups.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                <span style={{
                  padding: '3px 12px', borderRadius: 999, background: C.ou, color: C.blanc,
                  fontSize: 12, fontWeight: 800, letterSpacing: 0.5,
                }}>OU</span>
                <span style={{ flex: 1, height: 1, background: C.grisCL }} />
              </div>
            )}
            <div style={{
              border: `1px solid ${group.length > 1 ? `${C.et}44` : C.grisCL}`,
              borderLeft: `3px solid ${group.length > 1 ? C.et : C.grisCL}`,
              borderRadius: 10, padding: '12px 14px',
              background: group.length > 1 ? `${C.et}06` : 'transparent',
            }}>
              {group.map(({ rule, index }, ri) => (
                <div key={rule.uid}>
                  {ri > 0 && (
                    <div style={{ margin: '9px 0', display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, background: C.et, color: C.blanc,
                        fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                      }}>ET</span>
                      <span style={{ flex: 1, height: 1, background: `${C.et}22` }} />
                    </div>
                  )}
                  <RuleEditor
                    rule={rule}
                    facets={facets} statuses={statuses} countries={countries}
                    productNames={productNames} onProductName={onProductName}
                    onChange={(r) => setRules(rules.map((x, i) => (i === index ? r : x)))}
                    onRemove={() => setRules(rules.filter((_, i) => i !== index))}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button
            onClick={() => setRules([...rules, { ...newRule('content'), join: 'AND' }])}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.et}`,
              background: C.blanc, color: C.et, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Critère lié par ET</button>
          <button
            onClick={() => setRules([...rules, { ...newRule('content'), join: 'OR' }])}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.ou}`,
              background: C.blanc, color: C.ou, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Critère lié par OU</button>
        </div>

        {/* ── Phrase récapitulative ── */}
        <div style={{
          marginTop: 16, padding: '12px 14px', borderRadius: 10,
          background: C.grisTL, border: `1px solid ${C.grisCL}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, marginBottom: 4, letterSpacing: 0.3 }}>
            CE QUI SERA CHERCHÉ
          </div>
          <div style={{ fontSize: 13.5, color: C.grisTF, lineHeight: 1.5 }}>{recap}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => runSearch(0)}
            disabled={loading || !rules.length}
            style={{
              padding: '10px 22px', borderRadius: 9, border: 'none', background: C.atb,
              color: C.blanc, fontSize: 14, fontWeight: 700,
              cursor: loading || !rules.length ? 'default' : 'pointer',
              opacity: loading || !rules.length ? 0.6 : 1,
            }}
          >{loading ? 'Recherche…' : 'Rechercher'}</button>

          <input
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            placeholder="Nommer cette recherche…"
            style={{ ...inputStyle, width: 210 }}
          />
          <button
            onClick={saveCurrent} disabled={!saveName.trim()}
            style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`,
              background: C.blanc, color: C.grisTF, fontSize: 13, fontWeight: 600,
              cursor: saveName.trim() ? 'pointer' : 'default', opacity: saveName.trim() ? 1 : 0.5,
            }}
          >Enregistrer</button>
        </div>

        {saved.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: C.grisM, fontWeight: 600 }}>Recherches enregistrées :</span>
            {saved.map((s) => (
              <span key={s.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                borderRadius: 999, border: `1px solid ${C.grisCL}`, background: C.blanc, fontSize: 12.5,
              }}>
                <button
                  onClick={() => loadSaved(s)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.et, fontWeight: 600, padding: 0 }}
                >{s.name}</button>
                <button
                  onClick={() => persistSaved(saved.filter((x) => x.id !== s.id))}
                  title="Supprimer"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.grisM, padding: 0, fontSize: 13 }}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div style={{
          marginTop: 16, background: '#FEF2F2', border: '1px solid #FECACA', color: C.rouge,
          borderRadius: 10, padding: '12px 14px', fontSize: 13.5,
        }}>{error}</div>
      )}

      {/* ── Résultats ── */}
      {results && (
        <section style={{
          marginTop: 18, background: C.blanc, border: `1px solid ${C.grisCL}`,
          borderRadius: 14, padding: '16px 20px',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap', marginBottom: 14,
          }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, color: C.grisTF, margin: 0 }}>
              {fmtInt(total)} commande{total > 1 ? 's' : ''}
            </h2>
            {total > 0 && (
              <button
                onClick={exportCsv} disabled={exporting}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`,
                  background: C.blanc, color: C.grisTF, fontSize: 13, fontWeight: 600,
                  cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1,
                }}
              >{exporting ? 'Export…' : 'Exporter en CSV'}</button>
            )}
          </div>

          {total === 0 ? (
            <p style={{ fontSize: 13.5, color: C.grisM, margin: 0 }}>
              Aucune commande ne correspond. Retirez un critère ou remplacez un ET par un OU.
            </p>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.grisCL}` }}>
                      {['N°', 'Date', 'Statut', 'Client', 'Ville', 'CP', 'Pays', 'Livraison', 'Montant'].map((h) => (
                        <th key={h} style={{
                          textAlign: h === 'Montant' ? 'right' : 'left', padding: '8px 10px',
                          fontSize: 11.5, color: C.grisM, fontWeight: 700, whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.orders.map((o) => (
                      <tr key={o.wp_order_id} style={{ borderBottom: `1px solid ${C.grisTL}` }}>
                        <td style={{ padding: '8px 10px' }}>
                          <a href={`/orders/${o.wp_order_id}`} target="_blank" rel="noreferrer"
                             style={{ color: C.et, fontWeight: 700, textDecoration: 'none' }}>
                            #{o.wp_order_id}
                          </a>
                        </td>
                        <td style={{ padding: '8px 10px', color: C.grisF, whiteSpace: 'nowrap' }}>{frDate(o.order_date)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                            color: C.blanc, background: STATUS_COLORS[o.post_status] || C.grisM,
                            whiteSpace: 'nowrap',
                          }}>{statusLabel(o.post_status)}</span>
                        </td>
                        <td style={{ padding: '8px 10px', color: C.grisTF }}>
                          {`${o.billing_first_name || ''} ${o.billing_last_name || ''}`.trim() || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: C.grisTF }}>{o.shipping_city || '—'}</td>
                        <td style={{ padding: '8px 10px', color: C.grisF }}>{o.shipping_postcode || '—'}</td>
                        <td style={{ padding: '8px 10px', color: C.grisF }}>{o.shipping_country || '—'}</td>
                        <td style={{ padding: '8px 10px', color: C.grisF, fontSize: 12 }}>{o.shipping_method || '—'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: C.grisTF, whiteSpace: 'nowrap' }}>
                          {eur(o.order_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
                  <button
                    onClick={() => runSearch(page - 1)} disabled={page === 0 || loading}
                    style={{
                      padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.grisCL}`,
                      background: C.blanc, cursor: page === 0 ? 'default' : 'pointer',
                      opacity: page === 0 ? 0.4 : 1, fontSize: 13,
                    }}
                  >‹ Précédent</button>
                  <span style={{ fontSize: 12.5, color: C.grisM }}>
                    Page {page + 1} sur {fmtInt(pageCount)}
                  </span>
                  <button
                    onClick={() => runSearch(page + 1)} disabled={page + 1 >= pageCount || loading}
                    style={{
                      padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.grisCL}`,
                      background: C.blanc, cursor: page + 1 >= pageCount ? 'default' : 'pointer',
                      opacity: page + 1 >= pageCount ? 0.4 : 1, fontSize: 13,
                    }}
                  >Suivant ›</button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
