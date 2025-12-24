import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../components/CopyButton';

const API_URL = import.meta.env.VITE_API_URL || 'http://54.37.156.233:3000/api';

// Mapping des codes pays vers noms
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
  DZ: 'Algerie', SN: 'Senegal', CI: "Cote d'Ivoire"
};

// Mapping des statuts
const STATUS_LABELS = {
  'wc-completed': 'Terminee',
  'wc-delivered': 'Livree',
  'wc-processing': 'En cours',
  'wc-on-hold': 'En attente',
  'wc-pending': 'En attente paiement',
  'wc-cancelled': 'Annulee',
  'wc-refunded': 'Remboursee',
  'wc-failed': 'Echouee',
  'wc-being-delivered': 'En livraison',
  'trash': 'Corbeille'
};

const STATUS_COLORS = {
  'wc-completed': { bg: '#d4edda', color: '#155724' },
  'wc-delivered': { bg: '#d4edda', color: '#155724' },
  'wc-processing': { bg: '#fff3cd', color: '#856404' },
  'wc-on-hold': { bg: '#ffeeba', color: '#856404' },
  'wc-pending': { bg: '#f8d7da', color: '#721c24' },
  'wc-cancelled': { bg: '#f8d7da', color: '#721c24' },
  'wc-refunded': { bg: '#e2e3e5', color: '#383d41' },
  'wc-failed': { bg: '#f8d7da', color: '#721c24' },
  'wc-being-delivered': { bg: '#d1ecf1', color: '#0c5460' },
  'trash': { bg: '#e2e3e5', color: '#383d41' }
};

const OrderDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      fetchOrder();
      fetchReviews();
    }
  }, [id]);

  const fetchOrder = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${API_URL}/orders/${id}`);
      if (response.data.success) {
        setOrder(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Erreur lors du chargement de la commande');
    } finally {
      setLoading(false);
    }
  };

  const fetchReviews = async () => {
    try {
      const response = await axios.get(`${API_URL}/orders/${id}/reviews`);
      if (response.data.success) {
        setReviews(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching reviews:', err);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(parseFloat(value) || 0);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const style = STATUS_COLORS[status] || { bg: '#e2e3e5', color: '#383d41' };
    return (
      <span
        style={{
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '600',
          backgroundColor: style.bg,
          color: style.color
        }}
      >
        {STATUS_LABELS[status] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>...</div>
          <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>X</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>{error || 'Commande introuvable'}</div>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#135E84',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Retour
          </button>
        </div>
      </div>
    );
  }

  // Calculs des totaux
  const orderTotal = parseFloat(order.order_total) || 0;
  const orderShipping = parseFloat(order.order_shipping) || 0;
  const orderTax = parseFloat(order.order_tax) || 0;
  const cartDiscount = parseFloat(order.cart_discount) || 0;
  const totalCost = parseFloat(order.order_total_cost || order.total_cost) || 0;
  const subtotal = orderTotal - orderTax + cartDiscount;
  const margin = orderTotal - totalCost - orderShipping;

  // Filtrer les line_items pour n'avoir que les produits (pas shipping, fees, etc.)
  const productItems = (order.line_items || []).filter(item => item.order_item_type === 'line_item');
  const shippingItem = (order.line_items || []).find(item => item.order_item_type === 'shipping');
  const couponItems = (order.line_items || []).filter(item => item.order_item_type === 'coupon');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div
        style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
      >
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute',
            left: '20px',
            padding: '10px 20px',
            backgroundColor: '#fff',
            color: '#135E84',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: '600'
          }}
        >
          Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1200px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Order Header */}
        <div
          style={{
            backgroundColor: '#fff',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            marginBottom: '30px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h1 style={{ margin: 0, color: '#135E84', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Commande #{order.wp_order_id}
              <CopyButton text={String(order.wp_order_id)} size={16} />
            </h1>
            {getStatusBadge(order.post_status)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Date de commande</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatDate(order.post_date)}</div>
            </div>
            {order.paid_date && (
              <div>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Date de paiement</div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatDate(order.paid_date)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Methode de paiement</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{order.payment_method_title || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Source</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>
                {order.attribution_utm_source || order.attribution_source_type || 'Direct'}
                {order.attribution_utm_medium && ` / ${order.attribution_utm_medium}`}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Customer Info */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Client</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>
                  {order.billing_first_name} {order.billing_last_name}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#999' }}>Email</div>
                <div style={{ fontSize: '14px' }}>{order.billing_email}</div>
              </div>
              {order.billing_phone && (
                <div>
                  <div style={{ fontSize: '12px', color: '#999' }}>Telephone</div>
                  <div style={{ fontSize: '14px' }}>{order.billing_phone}</div>
                </div>
              )}
              {order.wp_customer_id && (
                <button
                  onClick={() => navigate(`/customers/${order.wp_customer_id}`)}
                  style={{
                    marginTop: '10px',
                    padding: '8px 15px',
                    backgroundColor: '#135E84',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    alignSelf: 'flex-start'
                  }}
                >
                  Voir fiche client
                </button>
              )}
            </div>
          </div>

          {/* Billing Address */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Adresse de facturation</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '14px', lineHeight: '1.5' }}>
              <div style={{ fontWeight: '600' }}>{order.billing_first_name} {order.billing_last_name}</div>
              <div>{order.billing_address_1}</div>
              {order.billing_address_2 && <div>{order.billing_address_2}</div>}
              <div>{order.billing_postcode} {order.billing_city}</div>
              <div style={{ fontWeight: '600' }}>{COUNTRY_NAMES[order.billing_country] || order.billing_country}</div>
            </div>
          </div>

          {/* Shipping Address */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Adresse de livraison</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '14px', lineHeight: '1.5' }}>
              <div style={{ fontWeight: '600' }}>{order.shipping_first_name} {order.shipping_last_name}</div>
              {order.shipping_company && <div>{order.shipping_company}</div>}
              <div>{order.shipping_address_1}</div>
              <div>{order.shipping_postcode} {order.shipping_city}</div>
              <div style={{ fontWeight: '600' }}>{COUNTRY_NAMES[order.shipping_country] || order.shipping_country}</div>
              {shippingItem && (
                <div style={{ marginTop: '10px', padding: '8px 12px', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#666' }}>Transporteur: </span>
                  <span style={{ fontWeight: '600' }}>{shippingItem.order_item_name}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div
          style={{
            backgroundColor: '#fff',
            padding: '25px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            marginBottom: '30px'
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Articles ({productItems.length})</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Produit</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>SKU</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Prix unit.</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Qte</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Cout</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {productItems.map((item, index) => {
                  const lineTotal = parseFloat(item.line_total) || 0;
                  const qty = parseInt(item.qty) || 1;
                  const unitPrice = lineTotal / qty;
                  const itemCost = parseFloat(item.item_cost) || 0;

                  return (
                    <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <div
                          style={{ fontWeight: '600', fontSize: '14px', color: '#007bff', cursor: 'pointer' }}
                          onClick={() => navigate(`/products/${item.variation_id || item.product_id}`)}
                        >
                          {item.order_item_name || item.product_name}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: '13px', color: '#666' }}>
                        {item.product_id}{item.variation_id && item.variation_id !== '0' && ` / ${item.variation_id}`}
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 8px', fontSize: '14px' }}>
                        {formatCurrency(unitPrice)}
                      </td>
                      <td style={{ textAlign: 'center', padding: '12px 8px', fontSize: '14px', fontWeight: '600' }}>
                        {qty}
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 8px', fontSize: '13px', color: '#666' }}>
                        {itemCost > 0 ? formatCurrency(itemCost * qty) : '-'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 8px', fontSize: '14px', fontWeight: '600' }}>
                        {formatCurrency(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div
          style={{
            backgroundColor: '#fff',
            padding: '25px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Totaux</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px', marginLeft: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>Sous-total HT :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>Livraison :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(orderShipping)}</span>
            </div>
            {couponItems.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', alignItems: 'flex-start' }}>
                <span style={{ color: '#ff7300' }}>Coupon{couponItems.length > 1 ? 's' : ''} :</span>
                <div style={{ textAlign: 'right' }}>
                  {couponItems.map((coupon, idx) => (
                    <div key={idx} style={{ fontWeight: '600', color: '#ff7300' }}>
                      {coupon.order_item_name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {cartDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                <span style={{ color: '#dc3545' }}>Remise :</span>
                <span style={{ fontWeight: '600', color: '#dc3545' }}>-{formatCurrency(cartDiscount)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>TVA :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(orderTax)}</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '18px',
                paddingTop: '12px',
                borderTop: '2px solid #e0e0e0'
              }}
            >
              <span style={{ fontWeight: '600' }}>Total TTC :</span>
              <span style={{ fontWeight: '700', color: '#28a745' }}>{formatCurrency(orderTotal)}</span>
            </div>

            {/* Margin Calculation */}
            <div
              style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #e0e0e0'
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: '#333' }}>
                Analyse de marge
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666' }}>Cout produits :</span>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(totalCost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666' }}>Cout livraison :</span>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(orderShipping)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: '8px',
                    borderTop: '1px solid #dee2e6',
                    fontWeight: '600'
                  }}
                >
                  <span>Marge brute :</span>
                  <span style={{ color: margin > 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(margin)}</span>
                </div>
                {orderTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: '#666' }}>Taux de marge :</span>
                    <span style={{ fontWeight: '600', color: margin > 0 ? '#28a745' : '#dc3545' }}>
                      {((margin / orderTotal) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Attribution info */}
        {(order.attribution_utm_source || order.attribution_referrer) && (
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              marginTop: '30px'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>Attribution</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', fontSize: '13px' }}>
              {order.attribution_source_type && (
                <div>
                  <div style={{ color: '#999', marginBottom: '4px' }}>Type de source</div>
                  <div style={{ fontWeight: '600' }}>{order.attribution_source_type}</div>
                </div>
              )}
              {order.attribution_utm_source && (
                <div>
                  <div style={{ color: '#999', marginBottom: '4px' }}>Source UTM</div>
                  <div style={{ fontWeight: '600' }}>{order.attribution_utm_source}</div>
                </div>
              )}
              {order.attribution_utm_medium && (
                <div>
                  <div style={{ color: '#999', marginBottom: '4px' }}>Medium UTM</div>
                  <div style={{ fontWeight: '600' }}>{order.attribution_utm_medium}</div>
                </div>
              )}
              {order.attribution_device_type && (
                <div>
                  <div style={{ color: '#999', marginBottom: '4px' }}>Appareil</div>
                  <div style={{ fontWeight: '600' }}>{order.attribution_device_type}</div>
                </div>
              )}
              {order.attribution_session_pages && (
                <div>
                  <div style={{ color: '#999', marginBottom: '4px' }}>Pages visitees</div>
                  <div style={{ fontWeight: '600' }}>{order.attribution_session_pages}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Avis clients */}
        {reviews.length > 0 && (
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              marginTop: '30px'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>
              Avis laisses sur cette commande ({reviews.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {reviews.map((review, index) => (
                <div
                  key={index}
                  style={{
                    padding: '15px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '15px' }}>
                    {review.product_image && (
                      <img
                        src={review.product_image}
                        alt=""
                        style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px' }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <div
                            style={{ fontWeight: '600', color: '#007bff', cursor: 'pointer', fontSize: '14px' }}
                            onClick={() => navigate(`/products/${review.product_id}`)}
                          >
                            {review.product_name || 'Produit'}
                          </div>
                          <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                            {review.customer_name} - {formatDate(review.review_date)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span
                              key={star}
                              style={{
                                color: star <= review.rating ? '#ffc107' : '#e0e0e0',
                                fontSize: '16px'
                              }}
                            >
                              ★
                            </span>
                          ))}
                          <span style={{ marginLeft: '5px', fontSize: '13px', fontWeight: '600' }}>
                            {review.rating}/5
                          </span>
                        </div>
                      </div>
                      {review.comment && (
                        <div style={{ fontSize: '13px', color: '#333', lineHeight: '1.5', marginTop: '8px' }}>
                          "{review.comment}"
                        </div>
                      )}
                      <div style={{ marginTop: '8px', display: 'flex', gap: '10px', fontSize: '11px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: review.review_type === 'site' ? '#d4edda' : '#d1ecf1',
                          color: review.review_type === 'site' ? '#155724' : '#0c5460'
                        }}>
                          {review.review_type === 'site' ? 'Avis site' : 'Avis produit'}
                        </span>
                        {review.rewarded && (
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '4px',
                            backgroundColor: '#fff3cd',
                            color: '#856404'
                          }}>
                            Recompense
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          textAlign: 'center',
          color: 'white',
          marginTop: '50px'
        }}
      >
        <p style={{ margin: 0 }}>YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default OrderDetail;
