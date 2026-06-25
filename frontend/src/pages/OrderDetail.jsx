import { useState, useEffect, useContext } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import CopyButton from '../components/CopyButton';
import { Stats as StatsIcon } from '../components/AppIcons';
import { formatDate } from '../utils/dateUtils';
import { AuthContext } from '../context/AuthContext';
import { LinkBox } from '../utils/navHelpers';
import { getTrackingUrl } from '../utils/trackingUtils';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  gris: '#697485', grisF: '#626E85', grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

/* ─── CONSTANTES ─────────────────────────────────────────── */
// Coût moyen de l'emballage (HT), appliqué à chaque commande
const PACKAGING_COST_HT = 0.30;

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

const STATUS_MAP = {
  'wc-completed':       { bg: '#E5EEF6', fg: '#3C6E8F', dot: '#3C6E8F', label: 'Expédiée' },
  'wc-delivered':       { bg: '#E6F5EC', fg: '#2A8049', dot: '#2A8049', label: 'Livrée' },
  'wc-processing':      { bg: '#FFF4E0', fg: '#A6651B', dot: '#E8930A', label: 'En cours' },
  'wc-on-hold':         { bg: '#FFF4E0', fg: '#A6651B', dot: '#E8930A', label: 'En attente' },
  'wc-pending':         { bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF', label: 'Attente paiement' },
  'wc-cancelled':       { bg: '#FBE8EA', fg: '#C24555', dot: '#C24555', label: 'Annulée' },
  'wc-refunded':        { bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF', label: 'Remboursée' },
  'wc-failed':          { bg: '#FBE8EA', fg: '#C24555', dot: '#C24555', label: 'Échouée' },
  'wc-being-delivered': { bg: '#E0F4F8', fg: '#0C6B7A', dot: '#17A2B8', label: 'En livraison' },
  trash:                { bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF', label: 'Corbeille' },
};

const fmt = (n) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(n) || 0) + ' €';

/* ─── SOUS-COMPOSANTS ────────────────────────────────────── */

function StatusBadge({ status }) {
  const m = STATUS_MAP[status] || { bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF', label: status };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: m.bg, color: m.fg,
      padding: '5px 13px', borderRadius: 99,
      fontSize: 12.5, fontWeight: 700, flexShrink: 0,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  );
}

function MetaItem({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.grisM,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF }}>{children || '—'}</div>
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.blanc, borderRadius: 12,
      border: `1px solid ${C.grisCL}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      padding: '22px 26px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardTitle({ children }) {
  return (
    <h2 style={{
      fontSize: 16, fontWeight: 800, color: C.grisTF,
      fontFamily: "'Tilt Warp', cursive",
      letterSpacing: '-0.2px', marginBottom: 18,
    }}>{children}</h2>
  );
}

function AddressCard({ title, name, lines = [], extra }) {
  return (
    <Card>
      <h3 style={{
        fontSize: 14.5, fontWeight: 800, color: C.grisTF,
        fontFamily: "'Tilt Warp', cursive",
        letterSpacing: '-0.2px', marginBottom: 14,
      }}>{title}</h3>
      {name && <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF, marginBottom: 8 }}>{name}</div>}
      {lines.map((l, i) => l ? <div key={i} style={{ fontSize: 13, color: C.grisF, lineHeight: 1.65 }}>{l}</div> : null)}
      {extra}
    </Card>
  );
}

function TotalLine({ label, value, color, bold, separator }) {
  return (
    <>
      {separator && <div style={{ height: 1, background: C.grisCL, margin: '8px 0' }} />}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '7px 0',
        borderBottom: bold ? 'none' : `1px solid ${C.grisTL}`,
      }}>
        <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 800 : 500, color: color || (bold ? C.grisTF : C.grisF) }}>
          {label}
        </span>
        <span style={{
          fontSize: bold ? 18 : 14, fontWeight: bold ? 800 : 700,
          color: color || C.grisTF, fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </span>
      </div>
    </>
  );
}

function MarginRow({ label, value, bold, style: extraStyle }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '7px 0',
      borderTop: bold ? `1px solid ${C.grisCL}` : 'none',
      marginTop: bold ? 6 : 0,
      ...extraStyle,
    }}>
      <span style={{ fontSize: 12.5, fontWeight: bold ? 800 : 600, color: bold ? C.grisTF : C.grisF }}>{label}</span>
      <span style={{
        fontSize: bold ? 13.5 : 13, fontWeight: bold ? 800 : 700,
        color: bold ? C.grisTF : C.grisF, fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}

/* ─── COMPOSANT PRINCIPAL ────────────────────────────────── */
const OrderDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { token } = useContext(AuthContext);

  const [order, setOrder]       = useState(null);
  const [refundsDetail, setRefundsDetail] = useState(null);
  const [reviews, setReviews]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [reimporting, setReimporting] = useState(false);
  const [reimportMsg, setReimportMsg] = useState('');

  useEffect(() => {
    if (id) { fetchOrder(); fetchReviews(); }
  }, [id]);

  // Détail des remboursements (lignes produits/port) via l'API WC, seulement si la
  // commande a au moins un remboursement.
  useEffect(() => {
    if (!order?.refunds?.length) { setRefundsDetail(null); return; }
    let cancelled = false;
    axios.get(`${API_URL}/orders/${id}/refunds-detail`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => { if (!cancelled && res.data.success) setRefundsDetail(res.data.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [order?.refunds, id, token]);

  const fetchOrder = async () => {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${API_URL}/orders/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.data.success) setOrder(res.data.data);
    } catch (err) {
      setError('Erreur lors du chargement de la commande');
    } finally {
      setLoading(false);
    }
  };

  const fetchReviews = async () => {
    try {
      const res = await axios.get(`${API_URL}/orders/${id}/reviews`);
      if (res.data.success) setReviews(res.data.data);
    } catch {}
  };

  const handleReimport = async () => {
    setReimporting(true); setReimportMsg('');
    try {
      await axios.post(`${API_URL}/orders/${id}/reimport`);
      setReimportMsg('Réimportée !');
      fetchOrder();
    } catch (err) {
      setReimportMsg(err.response?.data?.error || 'Erreur');
    } finally {
      setReimporting(false);
      setTimeout(() => setReimportMsg(''), 4000);
    }
  };

  /* ── États de chargement ── */
  if (loading) {
    return (
      <AppShell currentPath="/orders">
        <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.grisTL }}>
          <div style={{ textAlign: 'center', color: C.grisM }}>
            <div style={{ fontSize: 36, marginBottom: 12, animation: 'pulse 1.4s infinite' }}>⏳</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Chargement…</div>
          </div>
        </main>
      </AppShell>
    );
  }

  if (error || !order) {
    return (
      <AppShell currentPath="/orders">
        <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.grisTL }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✕</div>
            <div style={{ fontSize: 14, color: C.grisF, marginBottom: 20 }}>{error || 'Commande introuvable'}</div>
            <button onClick={() => navigate(-1)} style={{ padding: '9px 20px', background: C.saphir, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Retour
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  /* ── Calculs ── */
  const orderTotal    = parseFloat(order.order_total) || 0;
  const orderShipping = parseFloat(order.order_shipping) || 0;
  const orderTax      = parseFloat(order.order_tax) || 0;
  const cartDiscount  = parseFloat(order.cart_discount) || 0;
  const totalCost     = parseFloat(order.order_total_cost || order.total_cost) || 0;
  const subtotal      = orderTotal - orderTax + cartDiscount; // articles + livraison, avant remise
  const subtotalItems = subtotal - orderShipping;             // articles HT seuls

  const trackingUrl = getTrackingUrl(order.shipping_carrier, order.tracking_number);

  const shippingCostCalculated = order.shipping_cost_calculated != null ? parseFloat(order.shipping_cost_calculated) : null;
  const paymentCostCalculated  = order.payment_cost_calculated  != null ? parseFloat(order.payment_cost_calculated)  : null;
  const packagingCost = PACKAGING_COST_HT;
  const hasAllCosts = shippingCostCalculated != null && paymentCostCalculated != null;
  const orderTotalHT = orderTotal - orderTax; // Total HT = TTC - TVA
  const margin = hasAllCosts ? orderTotalHT - totalCost - shippingCostCalculated - paymentCostCalculated - packagingCost : null;

  const productItems = (order.line_items || []).filter(i => i.order_item_type === 'line_item');
  const couponItems  = (order.line_items || []).filter(i => i.order_item_type === 'coupon');
  const shippingItem = (order.line_items || []).find(i => i.order_item_type === 'shipping');

  // Les poids sont stockés en kg dans la BDD
  const totalWeightKg = productItems.reduce((acc, item) => {
    const w = parseFloat(item.weight);
    const q = parseInt(item.qty) || 1;
    return w > 0 ? acc + w * q : acc;
  }, 0);
  const weightDisplay = totalWeightKg > 0
    ? totalWeightKg >= 1
      ? `${totalWeightKg.toFixed(3).replace(/\.?0+$/, '').replace('.', ',')} kg`
      : `${Math.round(totalWeightKg * 1000)} g`
    : null;

  return (
    <AppShell currentPath="/orders">
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .dt-row { transition: background 0.12s; }
        .dt-row:hover { background: #F8FBFD; }
        .reimport-btn:hover { transform: translateY(-1px); }
        .back-btn:hover { transform: translateY(-1px); }
        .print-btn:hover { background: ${C.grisTL} !important; }
      `}</style>

      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF, background: C.grisTL,
      }}>

        {/* ── Top bar ── */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 28px', minHeight: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 30, gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Bouton retour */}
            <button
              className="back-btn"
              onClick={() => navigate(-1)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: 'linear-gradient(155deg, #F59E0B, #C97F09)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '7px 13px', fontSize: 12.5, fontWeight: 800,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 6px rgba(245,158,11,0.35), 0 1px 0 rgba(255,255,255,0.4) inset',
                transition: 'transform 0.15s', flexShrink: 0,
              }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
              </svg>
              Retour
            </button>

            {/* Icône + breadcrumb */}
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(155deg, #E85A5A, #B83A3A)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(232,90,90,0.35)',
            }}>
              <StatsIcon size={18} color="#fff" />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Statistiques</span>
            <span style={{ color: C.grisCL }}>/</span>
            <span style={{ fontSize: 13, color: C.grisF, fontWeight: 600 }}>Commandes</span>
            <span style={{ color: C.grisCL }}>/</span>
            <span style={{ fontSize: 13, color: C.grisTF, fontWeight: 700 }}>#{order.wp_order_id}</span>
          </div>

          <button
            className="print-btn"
            onClick={() => window.print()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: C.blanc, color: C.grisF,
              border: `1px solid ${C.grisCL}`, borderRadius: 8,
              padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.12s',
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.grisF} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            </svg>
            Imprimer
          </button>
        </header>

        {/* ── Contenu ── */}
        <div style={{ padding: '24px 28px', flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

          {/* ── Card principale ── */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{
                  fontSize: 26, fontWeight: 900, fontFamily: "'Tilt Warp', cursive",
                  color: C.saphir, letterSpacing: '-0.5px', margin: 0,
                }}>
                  Commande #{order.wp_order_id}
                </h1>
                <CopyButton text={String(order.wp_order_id)} size={15} />
                {/* Badge WC */}
                <a
                  href={`https://www.youvape.fr/wp-admin/post.php?post=${order.wp_order_id}&action=edit`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center',
                    background: '#7A4FA8', color: '#fff',
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em',
                    textDecoration: 'none',
                  }}
                >WC</a>
                {/* Bouton réimporter */}
                <button
                  className="reimport-btn"
                  onClick={handleReimport}
                  disabled={reimporting}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: reimporting ? C.grisM : C.bleu, color: '#fff',
                    border: 'none', borderRadius: 6, padding: '5px 11px',
                    fontSize: 12, fontWeight: 700, cursor: reimporting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: reimporting ? 'none' : '0 1px 3px rgba(0,113,235,0.35)',
                    transition: 'transform 0.15s',
                  }}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 7"/><path d="M21 3v4h-4"/>
                  </svg>
                  {reimporting ? '…' : 'Réimporter'}
                </button>
                {reimportMsg && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: reimportMsg.includes('rreur') ? '#dc3545' : C.vert }}>
                    {reimportMsg}
                  </span>
                )}
              </div>
              <StatusBadge status={order.post_status} />
            </div>

            {/* Grille méta */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 22 }}>
              <MetaItem label="Date de commande">{formatDate(order.post_date)}</MetaItem>
              {order.paid_date && <MetaItem label="Date de paiement">{formatDate(order.paid_date)}</MetaItem>}
              <MetaItem label="Méthode de paiement">{order.payment_method_title}</MetaItem>
              <MetaItem label="Source">
                {order.attribution_utm_source || order.attribution_source_type || 'Direct'}
                {order.attribution_utm_medium ? ` / ${order.attribution_utm_medium}` : ''}
              </MetaItem>
              {(order.shipping_carrier || order.shipping_method || shippingItem) && (
                <MetaItem label="Transporteur">
                  {order.shipping_carrier || order.shipping_method || shippingItem?.order_item_name}
                </MetaItem>
              )}
              {order.tracking_number && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                    Suivi
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {trackingUrl ? (
                      <a
                        href={trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 14, fontWeight: 700, color: C.bleu, fontVariantNumeric: 'tabular-nums', textDecoration: 'underline' }}
                      >
                        {order.tracking_number}
                      </a>
                    ) : (
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.bleu, fontVariantNumeric: 'tabular-nums' }}>
                        {order.tracking_number}
                      </span>
                    )}
                    <CopyButton text={order.tracking_number} size={14} />
                  </div>
                </div>
              )}
              {weightDisplay && (
                <MetaItem label="Poids total">{weightDisplay}</MetaItem>
              )}
            </div>
          </Card>

          {/* ── 3 cartes adresses ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>
            <AddressCard
              title="Client"
              name={`${order.billing_first_name} ${order.billing_last_name}`}
              extra={
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Email</div>
                  <a href={`mailto:${order.billing_email}`} style={{ fontSize: 13.5, color: C.bleu, textDecoration: 'none', fontWeight: 600, display: 'block', marginBottom: 12 }}>
                    {order.billing_email}
                  </a>
                  {order.billing_phone && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Téléphone</div>
                      <a href={`tel:${order.billing_phone}`} style={{ fontSize: 13.5, color: C.grisTF, textDecoration: 'none', fontWeight: 600, display: 'block', marginBottom: 0 }}>
                        {order.billing_phone}
                      </a>
                    </>
                  )}
                  {order.wp_customer_id && (
                    <LinkBox
                      to={`/customers/${order.wp_customer_id}`}
                      style={{
                        marginTop: 16, padding: '7px 14px',
                        background: C.saphir, color: '#fff',
                        borderRadius: 7, fontSize: 12.5,
                        fontWeight: 700, fontFamily: 'inherit',
                        width: 'fit-content',
                      }}
                    >
                      Voir fiche client →
                    </LinkBox>
                  )}
                </div>
              }
            />
            <AddressCard
              title="Adresse de facturation"
              name={`${order.billing_first_name} ${order.billing_last_name}`}
              lines={[
                order.billing_address_1,
                order.billing_address_2,
                `${order.billing_postcode} ${order.billing_city}`,
                COUNTRY_NAMES[order.billing_country] || order.billing_country,
              ].filter(Boolean)}
            />
            <AddressCard
              title="Adresse de livraison"
              name={`${order.shipping_first_name || order.billing_first_name} ${order.shipping_last_name || order.billing_last_name}`}
              lines={[
                order.shipping_address_1 || order.billing_address_1,
                order.shipping_address_2,
                `${order.shipping_postcode || order.billing_postcode} ${order.shipping_city || order.billing_city}`,
                COUNTRY_NAMES[order.shipping_country || order.billing_country] || order.shipping_country || order.billing_country,
              ].filter(Boolean)}
            />
          </div>

          {/* ── Articles ── */}
          <Card style={{ marginBottom: 16 }}>
            <CardTitle>Articles ({productItems.length})</CardTitle>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr>
                    {[
                      ['Produit', 'left'],
                      ['SKU', 'left'],
                      ['Prix unit. HT', 'right'],
                      ['Qté', 'center'],
                      ['Coût HT', 'right'],
                      ['Total HT', 'right'],
                    ].map(([label, align]) => (
                      <th key={label} style={{
                        padding: '10px 14px', fontSize: 11, fontWeight: 800,
                        color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em',
                        textAlign: align, borderBottom: `1px solid ${C.grisCL}`,
                        background: '#FCFDFE',
                      }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productItems.map((item, idx) => {
                    const lineTotal  = parseFloat(item.line_total) || 0;
                    const qty        = parseInt(item.qty) || 1;
                    const unitPrice  = qty > 0 ? lineTotal / qty : 0;
                    const itemCost   = parseFloat(item.item_cost) || 0;

                    return (
                      <tr key={idx} className="dt-row">
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {item.image_url ? (
                              <img src={item.image_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.grisCL}`, flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 40, height: 40, borderRadius: 8, background: C.grisTL, border: `1px solid ${C.grisCL}`, flexShrink: 0 }} />
                            )}
                            <LinkBox
                              to={`/products/${item.variation_id || item.product_id}`}
                              display="inline"
                              style={{ color: C.bleu, fontWeight: 700, fontSize: 13.5 }}
                            >
                              {item.order_item_name || item.product_name}
                            </LinkBox>
                          </div>
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle', color: C.grisF, fontFamily: 'monospace', fontSize: 12.5 }}>
                          {(() => {
                            const sku = item.sku || (item.product_id && `${item.product_id}${item.variation_id && item.variation_id !== '0' ? '-' + item.variation_id : ''}`);
                            if (!sku) return null;
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {sku}
                                <CopyButton text={String(sku)} size={12} />
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(unitPrice)}
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle', textAlign: 'center', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                          {qty}
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle', textAlign: 'right', color: C.grisF, fontVariantNumeric: 'tabular-nums' }}>
                          {itemCost > 0 ? fmt(itemCost * qty) : '—'}
                        </td>
                        <td style={{ padding: '13px 14px', borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'middle', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Totaux + Marge ── */}
          <Card style={{ marginBottom: 16 }}>
            <CardTitle>Totaux</CardTitle>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 360px)',
              gap: 28, alignItems: 'start',
            }}>
              {/* Analyse de marge — gauche */}
              <div style={{ background: C.grisTL, borderRadius: 10, padding: '16px 18px' }}>
                <h3 style={{
                  fontSize: 12, fontWeight: 800, color: C.grisTF,
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
                }}>Analyse de marge</h3>
                <MarginRow label="Coût produits HT"  value={fmt(totalCost)} />
                <MarginRow label="Coût livraison HT" value={shippingCostCalculated != null ? fmt(shippingCostCalculated) : '—'} />
                <MarginRow label="Coût paiement"     value={paymentCostCalculated  != null ? fmt(paymentCostCalculated)  : '—'} />
                <MarginRow label="Coût emballage HT" value={fmt(packagingCost)} />
                {hasAllCosts && (
                  <MarginRow
                    label="Total coût"
                    value={fmt(totalCost + shippingCostCalculated + paymentCostCalculated + packagingCost)}
                    style={{ borderTop: '1px solid #E2E8EE', paddingTop: 6, marginTop: 2 }}
                  />
                )}
                <MarginRow label="Marge brute" value={margin != null ? fmt(margin) : '—'} bold />
                {margin != null && orderTotalHT > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, color: C.grisF }}>
                    <span>Taux de marge</span>
                    <span style={{ fontWeight: 700, color: margin > 0 ? C.vert : '#dc3545', fontVariantNumeric: 'tabular-nums' }}>
                      {((margin / orderTotalHT) * 100).toFixed(1)} %
                    </span>
                  </div>
                )}
              </div>

              {/* Totaux — droite */}
              <div>
                <TotalLine label="Sous-total articles HT" value={fmt(subtotalItems)} />
                <TotalLine label="Livraison HT"  value={fmt(orderShipping)} />
                {cartDiscount > 0 && (
                  <TotalLine label="Sous-total HT" value={fmt(subtotal)} />
                )}
                {couponItems.length > 0 && (
                  <TotalLine
                    label={`Coupon${couponItems.length > 1 ? 's' : ''} (${couponItems.map(c => c.order_item_name).join(', ')})`}
                    value=""
                    color={C.orange}
                  />
                )}
                {cartDiscount > 0 && (
                  <TotalLine label="Remise HT" value={`-${fmt(cartDiscount)}`} color={C.rouge} />
                )}
                <TotalLine label="Total HT" value={fmt(orderTotalHT)} />
                <TotalLine label="TVA" value={fmt(orderTax)} />
                <TotalLine label="Total TTC" value={fmt(orderTotal)} color={C.vert} bold separator />
              </div>
            </div>
          </Card>

          {/* ── Remboursements ── */}
          {(order.refunds && order.refunds.length > 0) && (() => {
            const localRefunds = order.refunds;
            const totalRefunded = localRefunds.reduce((s, r) => s + (parseFloat(r.refund_amount) || 0), 0);
            // Détail WC si chargé, sinon fallback sur le résumé local (total seul)
            const list = (refundsDetail && refundsDetail.length)
              ? refundsDetail
              : localRefunds.map(r => ({
                  id: r.wp_refund_id, date: r.refund_date,
                  amount: parseFloat(r.refund_amount) || 0, reason: r.refund_reason || '',
                  line_items: [], shipping_lines: [], fee_lines: [],
                }));
            return (
              <Card style={{ marginBottom: 16 }}>
                <CardTitle>Remboursements ({localRefunds.length}) · {fmt(totalRefunded)}</CardTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {list.map((rf) => {
                    const lines = [
                      ...rf.line_items.map(li => ({ label: `${li.name}${li.quantity ? ` × ${li.quantity}` : ''}`, sub: li.sku, value: li.total + li.total_tax })),
                      ...rf.shipping_lines.map(s => ({ label: `Frais de port — ${s.method_title}`, value: s.total + s.total_tax })),
                      ...rf.fee_lines.map(f => ({ label: f.name, value: f.total + f.total_tax })),
                    ];
                    return (
                      <div key={rf.id} style={{ background: C.grisTL, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.grisCL}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>
                            Remboursement #{rf.id} · {formatDate(rf.date)}
                          </span>
                          <span style={{ fontSize: 15, fontWeight: 800, color: C.rouge, fontVariantNumeric: 'tabular-nums' }}>−{fmt(rf.amount)}</span>
                        </div>
                        {rf.reason && (
                          <div style={{ fontSize: 12.5, color: C.grisF, marginTop: 4, fontStyle: 'italic' }}>« {rf.reason} »</div>
                        )}
                        {lines.length > 0 && (
                          <div style={{ marginTop: 10, borderTop: `1px solid ${C.grisCL}`, paddingTop: 4 }}>
                            {lines.map((ln, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: i < lines.length - 1 ? `1px solid ${C.grisCL}` : 'none' }}>
                                <span style={{ fontSize: 13, color: C.grisF }}>
                                  {ln.label}
                                  {ln.sub && <span style={{ fontFamily: 'monospace', fontSize: 11.5, color: C.grisM, marginLeft: 8 }}>{ln.sub}</span>}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF, fontVariantNumeric: 'tabular-nums' }}>−{fmt(ln.value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {lines.length === 0 && refundsDetail && (
                          <div style={{ fontSize: 12, color: C.grisM, marginTop: 6 }}>Remboursement sans ventilation par ligne (montant global).</div>
                        )}
                        {lines.length === 0 && !refundsDetail && (
                          <div style={{ fontSize: 12, color: C.grisM, marginTop: 6 }}>Chargement du détail…</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

          {/* ── Attribution ── */}
          {(order.attribution_utm_source || order.attribution_referrer || order.attribution_source_type) && (
            <Card style={{ marginBottom: 16 }}>
              <CardTitle>Attribution</CardTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 20 }}>
                {order.attribution_source_type && (
                  <MetaItem label="Type de source">{order.attribution_source_type}</MetaItem>
                )}
                {order.attribution_utm_source && (
                  <MetaItem label="Source UTM">{order.attribution_utm_source}</MetaItem>
                )}
                {order.attribution_utm_medium && (
                  <MetaItem label="Medium UTM">{order.attribution_utm_medium}</MetaItem>
                )}
                {order.attribution_utm_campaign && (
                  <MetaItem label="Campagne">{order.attribution_utm_campaign}</MetaItem>
                )}
                {order.attribution_device_type && (
                  <MetaItem label="Appareil">{order.attribution_device_type}</MetaItem>
                )}
                {order.attribution_session_pages && (
                  <MetaItem label="Pages visitées">{order.attribution_session_pages}</MetaItem>
                )}
              </div>
            </Card>
          )}

          {/* ── Avis ── */}
          {reviews.length > 0 && (
            <Card>
              <CardTitle>Avis laissés sur cette commande ({reviews.length})</CardTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {reviews.map((review, idx) => (
                  <div key={idx} style={{ padding: '14px 16px', background: C.grisTL, borderRadius: 10, border: `1px solid ${C.grisCL}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                      {review.product_image && (
                        <img src={review.product_image} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div>
                            <LinkBox
                              to={`/products/${review.product_id}`}
                              style={{ fontWeight: 700, color: C.bleu, fontSize: 14 }}
                            >
                              {review.product_name || 'Produit'}
                            </LinkBox>
                            <div style={{ fontSize: 12, color: C.grisF, marginTop: 2 }}>
                              {review.customer_name} · {formatDate(review.review_date)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {[1,2,3,4,5].map(s => (
                              <span key={s} style={{ color: s <= review.rating ? '#F59E0B' : C.grisCL, fontSize: 15 }}>★</span>
                            ))}
                            <span style={{ marginLeft: 5, fontSize: 12.5, fontWeight: 700, color: C.grisTF }}>{review.rating}/5</span>
                          </div>
                        </div>
                        {review.comment && (
                          <div style={{ fontSize: 13, color: C.grisTF, lineHeight: 1.55, fontStyle: 'italic' }}>
                            "{review.comment}"
                          </div>
                        )}
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <span style={{
                            padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                            background: review.review_type === 'site' ? '#D1FAE5' : '#DBEAFE',
                            color: review.review_type === 'site' ? '#065F46' : '#1E40AF',
                          }}>
                            {review.review_type === 'site' ? 'Avis site' : 'Avis produit'}
                          </span>
                          {review.rewarded && (
                            <span style={{ padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: '#FEF3C7', color: '#92400E' }}>
                              Récompensé
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>
      </main>
    </AppShell>
  );
};

export default OrderDetail;
