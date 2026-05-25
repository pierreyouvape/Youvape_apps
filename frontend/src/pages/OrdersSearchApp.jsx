import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import CopyButton from '../components/CopyButton';
import { OrdersSearch as OrdersIcon } from '../components/AppIcons';
import { formatDate } from '../utils/dateUtils';
import { formatPriceEur } from '../utils/formatNumber';
import { AuthContext } from '../context/AuthContext';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  violet: '#5B21B6', violetL: '#7C3AED', violetTL: '#EDE9FE',
  saphir: '#135E84', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38',
  blanc: '#FFFFFF', vert: '#28a745', rouge: '#dc3545',
};

/* ─── CONSTANTES ─────────────────────────────────────────── */
const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', DE: 'Allemagne', ES: 'Espagne',
  IT: 'Italie', NL: 'Pays-Bas', PT: 'Portugal', GB: 'Royaume-Uni', LU: 'Luxembourg',
  AT: 'Autriche', IE: 'Irlande', PL: 'Pologne', CZ: 'Tchequie', DK: 'Danemark',
  SE: 'Suede', NO: 'Norvege', FI: 'Finlande', GR: 'Grece', HU: 'Hongrie',
  RO: 'Roumanie', BG: 'Bulgarie', HR: 'Croatie', SK: 'Slovaquie', SI: 'Slovenie',
  EE: 'Estonie', LV: 'Lettonie', LT: 'Lituanie', MT: 'Malte', CY: 'Chypre',
  US: 'Etats-Unis', CA: 'Canada', AU: 'Australie', JP: 'Japon', CN: 'Chine',
  GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', RE: 'Reunion', YT: 'Mayotte',
  NC: 'Nouvelle-Caledonie', PF: 'Polynesie', MC: 'Monaco', MA: 'Maroc', TN: 'Tunisie',
  DZ: 'Algerie', SN: 'Senegal', CI: "Cote d'Ivoire",
};

const STATUS_LABELS = {
  'wc-completed': 'Expédiée',
  'wc-delivered': 'Livrée',
  'wc-processing': 'En cours',
  'wc-on-hold': 'En attente',
  'wc-pending': 'Attente paiement',
  'wc-cancelled': 'Annulée',
  'wc-refunded': 'Remboursée',
  'wc-failed': 'Échouée',
  'wc-being-delivered': 'En livraison',
  trash: 'Corbeille',
};

const STATUS_COLORS = {
  'wc-completed': '#135E84',
  'wc-delivered': '#28a745',
  'wc-processing': '#e6a817',
  'wc-on-hold': '#fd7e14',
  'wc-pending': '#6c757d',
  'wc-cancelled': '#dc3545',
  'wc-refunded': '#6f42c1',
  'wc-failed': '#dc3545',
  'wc-being-delivered': '#17a2b8',
  trash: '#6c757d',
};

const PERIODS = [
  { key: '', label: 'Toutes périodes' },
  { key: '7',  label: '7 derniers jours' },
  { key: '30', label: '30 derniers jours' },
  { key: '90', label: '90 derniers jours' },
  { key: 'custom', label: 'Personnalisé' },
];

function getPeriodDates(key) {
  if (!key || key === 'custom') return null;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(now);
  from.setDate(now.getDate() - (parseInt(key) - 1));
  return { dateFrom: fmt(from), dateTo: fmt(now) };
}

/* ─── COMPOSANT PRINCIPAL ────────────────────────────────── */
const OrdersSearchApp = () => {
  const navigate = useNavigate();
  const { token } = useContext(AuthContext);

  const [orders, setOrders]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);

  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [carrier, setCarrier]   = useState('');
  const [period, setPeriod]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  const [statuses, setStatuses]   = useState([]);
  const [carriers, setCarriers]   = useState([]);

  const [expandedId, setExpandedId]       = useState(null);
  const [orderDetails, setOrderDetails]   = useState({});

  const debounceRef = useRef(null);

  /* ── Chargement listes filtres ── */
  useEffect(() => {
    axios.get(`${API_URL}/orders/statuses/list`)
      .then(r => { if (r.data.success) setStatuses(r.data.data); })
      .catch(() => {});
    axios.get(`${API_URL}/orders/carriers/list`)
      .then(r => { if (r.data.success) setCarriers(r.data.data); })
      .catch(() => {});
  }, []);

  /* ── Requête filtrée ── */
  const fetchOrders = useCallback(async (params) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/orders/filter`, {
        params: { ...params, limit: 200 },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) {
        setOrders(res.data.data);
        setTotal(res.data.pagination?.total ?? res.data.data.length);
      }
    } catch (e) {
      console.error('Erreur chargement commandes', e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  /* ── Debounce recherche texte ── */
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const dates = period && period !== 'custom' ? getPeriodDates(period) : {};
      const customDates = period === 'custom' ? { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : {};
      fetchOrders({
        search: search || undefined,
        status: status || undefined,
        carrier: carrier || undefined,
        ...(dates || {}),
        ...customDates,
      });
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [search, status, carrier, period, dateFrom, dateTo, fetchOrders]);

  /* ── Expand ligne ── */
  const toggleExpand = async (orderId) => {
    if (expandedId === orderId) { setExpandedId(null); return; }
    setExpandedId(orderId);
    if (!orderDetails[orderId]) {
      try {
        const res = await axios.get(`${API_URL}/orders/${orderId}/details`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data.success) {
          setOrderDetails(prev => ({ ...prev, [orderId]: res.data.data }));
        }
      } catch (e) {
        console.error('Erreur details commande', e);
      }
    }
  };

  const resetFilters = () => {
    setSearch(''); setStatus(''); setCarrier('');
    setPeriod(''); setDateFrom(''); setDateTo('');
  };

  const hasActiveFilter = search || status || carrier || period;

  /* ─── RENDU ─────────────────────────────────────────────── */
  return (
    <AppShell currentPath="/commandes">
      <style>{`
        .cmd-row:hover { background: #f8f9fb !important; }
        .cmd-row-expanded { background: #f4f1fb !important; }
        select.cmd-select {
          padding: 8px 32px 8px 12px; font-size: 13px;
          border: 1px solid ${C.grisCL}; border-radius: 8px;
          background: ${C.blanc}; color: ${C.grisTF}; cursor: pointer;
          appearance: none; outline: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A99A4' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center;
        }
        select.cmd-select:focus { border-color: ${C.violet}; box-shadow: 0 0 0 3px ${C.violetTL}; }
        input.cmd-input {
          padding: 8px 14px; font-size: 13px;
          border: 1px solid ${C.grisCL}; border-radius: 8px;
          background: ${C.blanc}; color: ${C.grisTF}; outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        input.cmd-input:focus { border-color: ${C.violet}; box-shadow: 0 0 0 3px ${C.violetTL}; }
        .badge-status {
          display: inline-block; padding: 3px 9px; border-radius: 4px;
          font-size: 11px; font-weight: 700; color: white;
        }
        .badge-coupon {
          display: inline-block; padding: 3px 8px; border-radius: 4px;
          font-size: 11px; font-weight: 600;
          background: #ff730020; color: #ff7300;
        }
      `}</style>

      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF, background: C.grisTL,
      }}>

        {/* ── Top bar ── */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 24px', height: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 30, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(155deg, ${C.violet} 0%, #3B0764 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${C.violet}55`,
            }}>
              <OrdersIcon size={18} color="#fff" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>
              Commandes
            </span>
            {!loading && (
              <>
                <span style={{ color: C.grisCL }}>/</span>
                <span style={{ fontSize: 13, color: C.grisF, fontWeight: 600 }}>
                  {total.toLocaleString('fr-FR')} résultat{total !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.grisM, fontWeight: 500 }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </header>

        {/* ── Filtres ── */}
        <div style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '14px 24px', display: 'flex', alignItems: 'center',
          gap: 10, flexWrap: 'wrap',
        }}>
          {/* Recherche */}
          <div style={{ position: 'relative', flexGrow: 1, minWidth: 260, maxWidth: 420 }}>
            <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth="2">
              <circle cx={11} cy={11} r={8} /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="cmd-input"
              style={{ paddingLeft: 34, width: '100%', boxSizing: 'border-box' }}
              placeholder="Nom, prénom, n° commande, n° suivi…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Statut */}
          <select className="cmd-select" value={status} onChange={e => setStatus(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous les statuts</option>
            {statuses.map(s => (
              <option key={s.status || s} value={s.status || s}>
                {STATUS_LABELS[s.status || s] || s.status || s}
              </option>
            ))}
          </select>

          {/* Transporteur */}
          <select className="cmd-select" value={carrier} onChange={e => setCarrier(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Tous les transporteurs</option>
            {carriers.map(c => (
              <option key={c.carrier} value={c.carrier}>{c.carrier}</option>
            ))}
          </select>

          {/* Période */}
          <select className="cmd-select" value={period} onChange={e => { setPeriod(e.target.value); setDateFrom(''); setDateTo(''); }} style={{ minWidth: 160 }}>
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          {/* Dates personnalisées */}
          {period === 'custom' && (
            <>
              <input className="cmd-input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 140 }} />
              <span style={{ fontSize: 12, color: C.grisM }}>→</span>
              <input className="cmd-input" type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={{ width: 140 }} />
            </>
          )}

          {/* Reset */}
          {hasActiveFilter && (
            <button onClick={resetFilters} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600,
              background: C.grisTL, color: C.grisF,
              border: `1px solid ${C.grisCL}`, borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Réinitialiser
            </button>
          )}
        </div>

        {/* ── Tableau ── */}
        <div style={{ flex: 1, padding: '20px 24px' }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.grisM, fontSize: 14 }}>
              <div style={{ fontSize: 32, marginBottom: 12, animation: 'pulse 1.4s infinite' }}>⏳</div>
              Chargement…
            </div>
          )}

          {!loading && orders.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '60px 0', background: C.blanc,
              borderRadius: 12, border: `1px solid ${C.grisCL}`, color: C.grisM,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Aucune commande trouvée</div>
            </div>
          )}

          {!loading && orders.length > 0 && (
            <div style={{
              background: C.blanc, borderRadius: 12,
              border: `1px solid ${C.grisCL}`,
              overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: C.grisTL, borderBottom: `2px solid ${C.grisCL}` }}>
                      {['Commande', 'Date', 'Client', 'Pays', 'Montant TTC', 'Statut', 'Transporteur', 'Articles', 'Avis', 'Coupon'].map(h => (
                        <th key={h} style={{
                          padding: '10px 12px', fontSize: 11, fontWeight: 700,
                          color: C.grisF, textTransform: 'uppercase', letterSpacing: '0.5px',
                          textAlign: h === 'Montant TTC' || h === 'Articles' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => {
                      const isExpanded = expandedId === order.wp_order_id;
                      const details    = orderDetails[order.wp_order_id];
                      return (
                        <>
                          <tr
                            key={order.wp_order_id}
                            className={`cmd-row${isExpanded ? ' cmd-row-expanded' : ''}`}
                            style={{ borderBottom: `1px solid ${C.grisCL}`, cursor: 'pointer', transition: 'background .15s' }}
                            onClick={() => toggleExpand(order.wp_order_id)}
                          >
                            {/* Commande */}
                            <td style={{ padding: '11px 12px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: C.grisM, fontSize: 11, width: 12, display: 'inline-block', textAlign: 'center' }}>
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                                <span
                                  style={{ fontWeight: 700, color: C.violet, cursor: 'pointer', fontSize: 13 }}
                                  onClick={e => { e.stopPropagation(); navigate(`/orders/${order.wp_order_id}`); }}
                                >
                                  #{order.wp_order_id}
                                </span>
                                <CopyButton text={String(order.wp_order_id)} size={12} />
                                <a
                                  href={`https://www.youvape.fr/wp-admin/post.php?post=${order.wp_order_id}&action=edit`}
                                  target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  style={{
                                    padding: '2px 6px', background: '#96588a', color: '#fff',
                                    borderRadius: 3, fontSize: 10, fontWeight: 700, textDecoration: 'none',
                                  }}
                                >WC</a>
                              </div>
                            </td>

                            {/* Date */}
                            <td style={{ padding: '11px 12px', fontSize: 12, color: C.grisF, whiteSpace: 'nowrap' }}>
                              {formatDate(order.post_date)}
                            </td>

                            {/* Client */}
                            <td style={{ padding: '11px 12px', fontSize: 13 }}>
                              <div style={{ fontWeight: 600 }}>{order.billing_first_name} {order.billing_last_name}</div>
                              <div style={{ fontSize: 11, color: C.grisM }}>{order.billing_email}</div>
                            </td>

                            {/* Pays */}
                            <td style={{ padding: '11px 12px', fontSize: 13 }}>
                              {COUNTRY_NAMES[order.billing_country] || order.billing_country || '-'}
                            </td>

                            {/* Montant TTC */}
                            <td style={{ padding: '11px 12px', fontSize: 13, fontWeight: 700, color: C.vert, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {formatPriceEur(order.order_total)}
                            </td>

                            {/* Statut */}
                            <td style={{ padding: '11px 12px' }}>
                              <span className="badge-status" style={{ background: STATUS_COLORS[order.post_status] || '#6c757d' }}>
                                {STATUS_LABELS[order.post_status] || order.post_status}
                              </span>
                            </td>

                            {/* Transporteur */}
                            <td style={{ padding: '11px 12px', fontSize: 12, color: C.grisF }}>
                              {order.shipping_carrier || order.shipping_method || '-'}
                            </td>

                            {/* Articles */}
                            <td style={{ padding: '11px 12px', fontSize: 13, textAlign: 'right', fontWeight: 600 }}>
                              {order.items_count}
                            </td>

                            {/* Avis */}
                            <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                              {order.has_review && <span title="Avis laissé" style={{ fontSize: 14 }}>⭐</span>}
                            </td>

                            {/* Coupon */}
                            <td style={{ padding: '11px 12px' }}>
                              {order.coupons
                                ? <span className="badge-coupon">{order.coupons}</span>
                                : <span style={{ color: C.grisCL }}>—</span>
                              }
                            </td>
                          </tr>

                          {/* ── Ligne dépliée ── */}
                          {isExpanded && (
                            <tr key={`${order.wp_order_id}-details`}>
                              <td colSpan={10} style={{ padding: 0, background: '#f4f1fb' }}>
                                <div style={{ padding: '20px 24px', borderTop: `2px solid ${C.violetTL}` }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>

                                    {/* Infos client */}
                                    <InfoCard title="Client">
                                      <div style={{ fontWeight: 600 }}>{order.billing_first_name} {order.billing_last_name}</div>
                                      <div>{order.billing_email}</div>
                                      <div>{order.billing_phone}</div>
                                    </InfoCard>

                                    {/* Adresse facturation */}
                                    <InfoCard title="Facturation">
                                      <div>{order.billing_address_1}</div>
                                      <div>{order.billing_postcode} {order.billing_city}</div>
                                      <div>{COUNTRY_NAMES[order.billing_country] || order.billing_country}</div>
                                    </InfoCard>

                                    {/* Adresse livraison */}
                                    <InfoCard title="Livraison">
                                      <div>{order.shipping_first_name} {order.shipping_last_name}</div>
                                      <div>{order.shipping_address_1}</div>
                                      <div>{order.shipping_postcode} {order.shipping_city}</div>
                                      <div>{COUNTRY_NAMES[order.shipping_country] || order.shipping_country}</div>
                                    </InfoCard>

                                    {/* Détails commande */}
                                    <InfoCard title="Détails commande">
                                      <div>Paiement : {order.payment_method_title || '-'}</div>
                                      <div>Frais de port : {formatPriceEur(order.order_shipping)}</div>
                                      <div>Transporteur : {details?.shipping_carrier || order.shipping_carrier || order.shipping_method || '-'}</div>
                                      {(details?.tracking_number || order.tracking_number) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <span>Suivi :</span>
                                          <span style={{ fontWeight: 700 }}>{details?.tracking_number || order.tracking_number}</span>
                                          <CopyButton text={details?.tracking_number || order.tracking_number} size={12} />
                                        </div>
                                      )}
                                    </InfoCard>
                                  </div>

                                  {/* Produits */}
                                  <div style={{ background: C.blanc, borderRadius: 8, border: `1px solid ${C.grisCL}`, padding: 16 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: C.saphir, marginBottom: 12 }}>Produits commandés</div>
                                    {!details ? (
                                      <div style={{ textAlign: 'center', padding: '20px 0', color: C.grisM, fontSize: 13 }}>Chargement…</div>
                                    ) : (
                                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                          <tr style={{ background: C.grisTL }}>
                                            {['Produit', 'SKU', 'Qté', 'Prix unit. HT', 'Total HT'].map((h, i) => (
                                              <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: C.grisF, textTransform: 'uppercase', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {details.items?.filter(i => i.order_item_type === 'line_item' || !i.order_item_type).map((item, idx) => (
                                            <tr key={idx} style={{ borderTop: `1px solid ${C.grisCL}` }}>
                                              <td style={{ padding: '10px', fontSize: 13 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                  {item.image_url && <img src={item.image_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }} />}
                                                  <div>
                                                    <div
                                                      style={{ fontWeight: 600, color: C.violet, cursor: 'pointer' }}
                                                      onClick={() => navigate(`/products/${item.product_id || item.variation_id}`)}
                                                    >
                                                      {item.product_title || item.order_item_name}
                                                    </div>
                                                    {item.brand && <div style={{ fontSize: 11, color: C.grisM }}>{item.brand}</div>}
                                                  </div>
                                                </div>
                                              </td>
                                              <td style={{ padding: '10px', fontSize: 12, color: C.grisF }}>
                                                {item.sku ? (
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <a href={`https://www.youvape.fr/wp-admin/post.php?post=${item.variation_id || item.product_id}&action=edit`}
                                                      target="_blank" rel="noopener noreferrer"
                                                      style={{ color: C.saphir, textDecoration: 'none' }}
                                                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                                      onMouseLeave={e => e.target.style.textDecoration = 'none'}
                                                    >{item.sku}</a>
                                                    <CopyButton text={item.sku} size={11} />
                                                  </div>
                                                ) : '-'}
                                              </td>
                                              <td style={{ padding: '10px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{item.qty}</td>
                                              <td style={{ padding: '10px', fontSize: 13, textAlign: 'right' }}>{item.qty ? formatPriceEur(item.line_subtotal / item.qty) : '-'}</td>
                                              <td style={{ padding: '10px', fontSize: 13, textAlign: 'right', fontWeight: 700, color: C.vert }}>{formatPriceEur(item.line_total)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>

                                  {/* Bouton fiche complète */}
                                  <div style={{ marginTop: 14, textAlign: 'right' }}>
                                    <button
                                      onClick={e => { e.stopPropagation(); navigate(`/orders/${order.wp_order_id}`); }}
                                      style={{
                                        padding: '9px 18px', background: C.violet, color: '#fff',
                                        border: 'none', borderRadius: 7, fontSize: 13,
                                        cursor: 'pointer', fontWeight: 700,
                                      }}
                                    >
                                      Voir la fiche complète →
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && orders.length > 0 && total > orders.length && (
            <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: C.grisM }}>
              Affichage des {orders.length} premières commandes sur {total.toLocaleString('fr-FR')} — affinez vos filtres pour réduire les résultats.
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
};

/* ─── COMPOSANT CARTE INFO ────────────────────────────────── */
function InfoCard({ title, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 8,
      border: `1px solid #E2E2E2`, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#135E84', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: '#2a2e38' }}>{children}</div>
    </div>
  );
}

export default OrdersSearchApp;
