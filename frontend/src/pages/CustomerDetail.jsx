import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Stats as StatsIcon } from '../components/AppIcons';
import { getCountryLabel, getCountryFlag, getCountryName } from '../utils/countries';
import { formatDate } from '../utils/dateUtils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import CopyButton from '../components/CopyButton';
import { formatPriceEur } from '../utils/formatNumber';

const API_BASE_URL = '/api';

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const AVATAR_PALETTE = ['#135E84', '#E28F00', '#4AB866', '#0071EB', '#8B5CF6', '#E85A5A', '#22A06B', '#6366F1'];
function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Statuts commandes — mêmes tons que OrderDetail */
const STATUS_MAP = {
  'wc-completed':  { bg: '#E5EEF6', fg: '#3C6E8F', label: 'Expédiée' },
  'wc-delivered':  { bg: '#E6F5EC', fg: '#2A8049', label: 'Livrée' },
  'wc-shipped':    { bg: '#E5EEF6', fg: '#3C6E8F', label: 'Expédiée' },
  'wc-processing': { bg: '#FFF4E0', fg: '#A6651B', label: 'En cours' },
  'wc-on-hold':    { bg: '#FFF4E0', fg: '#A6651B', label: 'En attente' },
  'wc-pending':    { bg: '#F3F4F6', fg: '#6B7280', label: 'Attente paiement' },
  'wc-cancelled':  { bg: '#FBE8EA', fg: '#C24555', label: 'Annulée' },
  'wc-refunded':   { bg: '#F3F4F6', fg: '#6B7280', label: 'Remboursée' },
  'wc-failed':     { bg: '#FBE8EA', fg: '#C24555', label: 'Échouée' },
};
const statusInfo = (s) => STATUS_MAP[s] || { bg: '#F3F4F6', fg: '#6B7280', label: s };

const fmtPrice = (v) => formatPriceEur(v);

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
function monthLabel(monthString) {
  const [year, month] = (monthString || '').split('-');
  return `${MONTHS[parseInt(month) - 1] || ''} ${year || ''}`.trim();
}
function customerSince(firstOrderDate) {
  if (!firstOrderDate) return 'N/A';
  const first = new Date(firstOrderDate), now = new Date();
  const diffDays = Math.ceil(Math.abs(now - first) / (1000 * 60 * 60 * 24));
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffMonths / 12);
  const remMonths = diffMonths % 12;
  if (diffDays === 0) return "Aujourd'hui";
  if (diffMonths < 1) return "< 1 mois";
  if (diffYears === 0) return `${diffMonths} mois`;
  if (remMonths === 0) return diffYears === 1 ? '1 an' : `${diffYears} ans`;
  return `${diffYears} an${diffYears > 1 ? 's' : ''} ${remMonths} mois`;
}

/* ─── Carte de stat ──────────────────────────────────────── */
function StatBox({ label, value, color = C.saphir }) {
  return (
    <div style={{
      background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: '16px 18px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Tilt Warp', cursive", color, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

const cardStyle = {
  background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const CustomerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState(null);
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersByMonth, setOrdersByMonth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});

  useEffect(() => {
    fetchCustomerDetail();
    fetchOrdersByMonth();
  }, [id]);

  const fetchCustomerDetail = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/customers/${id}/detail`);
      if (res.data.success) {
        setCustomer(res.data.data.customer);
        setStats(res.data.data.stats);
        setOrders(res.data.data.orders);
      }
    } catch (error) {
      console.error('Error fetching customer detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersByMonth = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/customers/${id}/orders-by-month`);
      if (res.data.success) {
        setOrdersByMonth(res.data.data.map(item => ({ month: monthLabel(item.month), orders: item.order_count })));
      }
    } catch (error) {
      console.error('Error fetching orders by month:', error);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    if (orderDetails[orderId]) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/customers/orders/${orderId}/details`);
      if (res.data.success) setOrderDetails(prev => ({ ...prev, [orderId]: res.data.data }));
    } catch (error) {
      console.error('Error fetching order details:', error);
    }
  };

  const handleOrderRowClick = (orderId) => {
    if (expandedOrderId === orderId) { setExpandedOrderId(null); }
    else { setExpandedOrderId(orderId); fetchOrderDetails(orderId); }
  };

  /* ─── Top bar partagée ─── */
  const TopBar = ({ trailing }) => (
    <header style={{
      background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
      padding: '0 28px', minHeight: 58,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 20, gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button onClick={() => navigate(-1)} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: `linear-gradient(155deg, #E85A5A, ${shade('#E85A5A', -0.2)})`,
          color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px',
          fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 2px 6px rgba(232,90,90,0.35), 0 1px 0 rgba(255,255,255,0.4) inset', flexShrink: 0,
        }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
          Retour
        </button>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: `linear-gradient(155deg, #E85A5A, ${shade('#E85A5A', -0.2)})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(232,90,90,0.35)',
        }}><StatsIcon size={18} color="#fff" /></div>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Statistiques</span>
        <span style={{ color: C.grisCL }}>/</span>
        <button onClick={() => navigate('/customers')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: C.grisF, fontWeight: 600, fontFamily: 'inherit' }}>Clients</button>
        {trailing && (<><span style={{ color: C.grisCL }}>/</span><span style={{ fontSize: 13, color: C.grisTF, fontWeight: 700 }}>{trailing}</span></>)}
      </div>
    </header>
  );

  if (loading) {
    return (
      <AppShell currentPath="/stats">
        <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL, fontFamily: 'Lato, sans-serif' }}>
          <TopBar />
          <div style={{ padding: 48, textAlign: 'center', color: C.grisM }}>Chargement…</div>
        </main>
      </AppShell>
    );
  }

  if (!customer) {
    return (
      <AppShell currentPath="/stats">
        <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL, fontFamily: 'Lato, sans-serif' }}>
          <TopBar />
          <div style={{ padding: 48, textAlign: 'center', color: C.grisM }}>Client non trouvé.</div>
        </main>
      </AppShell>
    );
  }

  const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || '(sans nom)';
  const billing = customer.billing_address;

  return (
    <AppShell currentPath="/stats">
      <style>{`
        .dt-row { transition: background 0.12s; }
        .dt-row:hover { background: #F8FBFD; }
      `}</style>

      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF, background: C.grisTL,
      }}>
        <TopBar trailing={name} />

        <div style={{ padding: '24px 28px', flex: 1 }}>
          {/* En-tête fiche : avatar + nom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <span style={{
              width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(140deg, ${avatarColor(name)}, ${shade(avatarColor(name), -0.18)})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 20, fontWeight: 800,
              boxShadow: '0 1px 0 rgba(255,255,255,0.3) inset',
            }}>{initials(name)}</span>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 900, fontFamily: "'Tilt Warp', cursive", color: C.saphir, letterSpacing: '-0.5px', margin: 0 }}>{name}</h1>
              <div style={{ fontSize: 13, color: C.grisF, marginTop: 2 }}>Client #{id}</div>
            </div>
          </div>

          {/* Infos + stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 2fr', gap: 20, marginBottom: 20, alignItems: 'start' }}>
            {/* Infos client */}
            <div style={{ ...cardStyle, padding: '20px 22px' }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px 0' }}>Coordonnées</h3>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.grisM, marginBottom: 3, fontWeight: 600 }}>Email</div>
                <div style={{ fontSize: 13.5, color: C.grisTF, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <a href={`mailto:${customer.email}`} style={{ color: C.bleu, textDecoration: 'none', fontWeight: 600 }}>{customer.email}</a>
                  {customer.email && <CopyButton text={customer.email} size={12} />}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.grisM, marginBottom: 3, fontWeight: 600 }}>Pays</div>
                <div style={{ fontSize: 13.5, color: C.grisTF, fontWeight: 600 }}>
                  {billing?.country ? `${getCountryFlag(billing.country)} ${getCountryName(billing.country)}` : 'N/A'}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: C.grisM, marginBottom: 3, fontWeight: 600 }}>Inscrit le</div>
                <div style={{ fontSize: 13.5, color: C.grisTF }}>{customer.user_registered ? new Date(customer.user_registered).toLocaleDateString('fr-FR') : 'N/A'}</div>
              </div>

              {billing && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.grisM, marginBottom: 3, fontWeight: 600 }}>Adresse de facturation</div>
                  <div style={{ fontSize: 13.5, color: C.grisTF, lineHeight: 1.5 }}>
                    {billing.address_1}<br />
                    {billing.postcode} {billing.city}<br />
                    {getCountryLabel(billing.country)}
                  </div>
                </div>
              )}

              {billing?.phone && (
                <div>
                  <div style={{ fontSize: 11, color: C.grisM, marginBottom: 3, fontWeight: 600 }}>Téléphone</div>
                  <div style={{ fontSize: 13.5, color: C.grisTF }}>{billing.phone}</div>
                </div>
              )}
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <StatBox label="Total dépensé TTC" value={fmtPrice(stats?.total_spent)} color={C.bleu} />
              <StatBox label="Commande moyenne" value={fmtPrice(stats?.avg_order)} color={C.grisTF} />
              <StatBox label="Commandes" value={stats?.order_count || 0} color={C.saphir} />
              <StatBox label="Produits différents" value={stats?.unique_products || 0} color={C.grisTF} />
              <StatBox label="Coût HT" value={fmtPrice(stats?.total_cost)} color={C.rouge} />
              <StatBox label="Bénéfice" value={fmtPrice(stats?.profit)} color={C.vert} />
              <StatBox label="Marge" value={`${stats?.margin?.toFixed(1) || 0}%`} color={C.vert} />
              <StatBox label="Avis laissés" value={stats?.reviews_count || 0} color={C.orange} />
              <StatBox label="Client depuis" value={customerSince(stats?.first_order_date)} color={C.saphir} />
            </div>
          </div>

          {/* Graphe commandes par mois */}
          {ordersByMonth.length > 0 && (
            <div style={{ ...cardStyle, padding: '20px 22px', marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px 0' }}>Commandes par mois</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={ordersByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grisCL} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.grisF }} angle={-45} textAnchor="end" height={70} />
                  <YAxis tick={{ fontSize: 12, fill: C.grisF }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="orders" stroke={C.saphir} fill={C.saphir} fillOpacity={0.18} name="Commandes" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Historique commandes */}
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.grisCL}`, background: '#FCFDFE' }}>
              <h3 style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Commandes</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Commande', 'Date', 'Statut', 'Total TTC', 'Articles', 'Coupon', 'Avis'].map((h, i) => (
                      <th key={i} style={{
                        padding: '11px 16px', textAlign: i === 3 ? 'right' : 'left',
                        fontSize: 11, fontWeight: 800, color: C.grisM, textTransform: 'uppercase',
                        letterSpacing: '0.06em', background: '#FCFDFE', borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const st = statusInfo(order.post_status);
                    const isExpanded = expandedOrderId === order.wp_order_id;
                    const details = orderDetails[order.wp_order_id];
                    return (
                      <>
                        <tr key={order.wp_order_id} className="dt-row" onClick={() => handleOrderRowClick(order.wp_order_id)}
                          style={{ borderBottom: `1px solid ${C.grisTL}`, cursor: 'pointer', background: isExpanded ? '#F8FBFD' : 'transparent' }}>
                          <td style={{ padding: '13px 16px', fontSize: 13.5 }}>
                            <span onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.wp_order_id}`); }}
                              style={{ fontWeight: 700, color: C.saphir, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>#{order.wp_order_id}</span>
                            <CopyButton text={String(order.wp_order_id)} size={12} />
                          </td>
                          <td style={{ padding: '13px 16px', fontSize: 13, color: C.grisF }}>{formatDate(order.post_date)}</td>
                          <td style={{ padding: '13px 16px' }}>
                            <span style={{ padding: '3px 11px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: st.bg, color: st.fg }}>{st.label}</span>
                          </td>
                          <td style={{ padding: '13px 16px', fontSize: 13.5, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(order.order_total)}</td>
                          <td style={{ padding: '13px 16px', fontSize: 13, color: C.grisF }}>{order.items_count} article{order.items_count > 1 ? 's' : ''}</td>
                          <td style={{ padding: '13px 16px', fontSize: 13 }}>
                            {order.coupons ? (
                              <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#FFF4E0', color: C.orange }}>{order.coupons}</span>
                            ) : <span style={{ color: C.grisM }}>—</span>}
                          </td>
                          <td style={{ padding: '13px 16px', fontSize: 16 }}>{order.has_review ? '⭐' : ''}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${order.wp_order_id}-d`}>
                            <td colSpan={7} style={{ padding: 0, background: '#F8FBFD' }}>
                              <div style={{ padding: '18px 24px' }}>
                                {!details ? (
                                  <p style={{ color: C.grisM, margin: 0 }}>Chargement…</p>
                                ) : (
                                  <>
                                    <h4 style={{ fontSize: 12, fontWeight: 800, color: C.grisF, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>Articles commandés</h4>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', background: C.blanc, borderRadius: 8, overflow: 'hidden', marginBottom: 16, border: `1px solid ${C.grisCL}` }}>
                                      <thead>
                                        <tr style={{ background: '#FCFDFE' }}>
                                          {['Produit', 'SKU', 'Qté', 'Prix unit. HT', 'Total HT'].map((h, i) => (
                                            <th key={i} style={{ padding: '9px 12px', textAlign: i >= 2 ? (i === 2 ? 'center' : 'right') : 'left', fontSize: 11, fontWeight: 700, color: C.grisM, borderBottom: `1px solid ${C.grisCL}` }}>{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {details.items.map((item, idx) => (
                                          <tr key={idx} style={{ borderTop: `1px solid ${C.grisTL}` }}>
                                            <td style={{ padding: '9px 12px', fontSize: 13 }}>{item.product_name || item.order_item_name}</td>
                                            <td style={{ padding: '9px 12px', fontSize: 13, color: C.grisF }}>
                                              {item.sku || '—'}{item.sku && <CopyButton text={item.sku} size={11} />}
                                            </td>
                                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'center' }}>{item.qty}</td>
                                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(item.line_total / item.qty)}</td>
                                            <td style={{ padding: '9px 12px', fontSize: 13, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(item.line_total)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    <h4 style={{ fontSize: 12, fontWeight: 800, color: C.grisF, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>Expédition</h4>
                                    <div style={{ background: C.blanc, padding: 14, borderRadius: 8, border: `1px solid ${C.grisCL}` }}>
                                      <p style={{ fontSize: 13, margin: '0 0 5px 0' }}><strong>Méthode :</strong> {details.shipping_method || 'N/A'}</p>
                                      {details.order && <p style={{ fontSize: 13, margin: 0 }}><strong>Frais HT :</strong> {fmtPrice(details.order.order_shipping)}</p>}
                                    </div>
                                  </>
                                )}
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
            {orders.length === 0 && (
              <div style={{ textAlign: 'center', padding: 48, color: C.grisM, fontSize: 13.5 }}>Aucune commande</div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
};

export default CustomerDetail;
