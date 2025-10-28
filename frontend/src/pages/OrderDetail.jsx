import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const OrderDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      fetchOrder();
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

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
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
    const statusColors = {
      completed: { bg: '#d4edda', color: '#155724' },
      processing: { bg: '#d1ecf1', color: '#0c5460' },
      'on-hold': { bg: '#fff3cd', color: '#856404' },
      pending: { bg: '#f8d7da', color: '#721c24' },
      cancelled: { bg: '#f8d7da', color: '#721c24' },
      refunded: { bg: '#e2e3e5', color: '#383d41' },
      failed: { bg: '#f8d7da', color: '#721c24' }
    };

    const style = statusColors[status] || { bg: '#e2e3e5', color: '#383d41' };

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
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
          <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>{error || 'Commande introuvable'}</div>
          <button
            onClick={() => navigate('/orders')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#135E84',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            ← Retour à la liste
          </button>
        </div>
      </div>
    );
  }

  const totalCost = parseFloat(order.total_cost || 0);
  const shippingCost = parseFloat(order.shipping_cost_real || order.shipping_total || 0);
  const margin = parseFloat(order.total) - totalCost - shippingCost;

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
          onClick={() => navigate('/orders')}
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
          ← Retour
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
            <h1 style={{ margin: 0, color: '#135E84' }}>Commande #{order.order_number}</h1>
            {getStatusBadge(order.status)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Date de création</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatDate(order.date_created)}</div>
            </div>
            {order.date_completed && (
              <div>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Date de complétion</div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatDate(order.date_completed)}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Méthode de paiement</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{order.payment_method_title || order.payment_method}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
          {/* Customer Info */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>👤 Client</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#333' }}>
                  {order.first_name} {order.last_name}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#999' }}>Email</div>
                <div style={{ fontSize: '14px' }}>{order.email}</div>
              </div>
              {order.phone && (
                <div>
                  <div style={{ fontSize: '12px', color: '#999' }}>Téléphone</div>
                  <div style={{ fontSize: '14px' }}>{order.phone}</div>
                </div>
              )}
              {order.customer_id && (
                <button
                  onClick={() => navigate(`/customers/${order.customer_id}`)}
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
                  Voir fiche client →
                </button>
              )}
            </div>
          </div>

          {/* Shipping Info */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>📦 Livraison</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#999' }}>Méthode</div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>{order.shipping_method_title || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#999' }}>Pays</div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>{order.shipping_country || '-'}</div>
              </div>
              {order.shipping_address && typeof order.shipping_address === 'object' && (
                <div>
                  <div style={{ fontSize: '12px', color: '#999' }}>Adresse</div>
                  <div style={{ fontSize: '14px' }}>
                    {order.shipping_address.address_1}<br />
                    {order.shipping_address.address_2 && <>{order.shipping_address.address_2}<br /></>}
                    {order.shipping_address.postcode} {order.shipping_address.city}
                  </div>
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
          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>🛍️ Articles</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Produit</th>
                <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Prix unit.</th>
                <th style={{ textAlign: 'center', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Qté</th>
                <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.line_items && order.line_items.map((item, index) => (
                <tr key={index} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px 5px' }}>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{item.product_name}</div>
                    {item.sku && <div style={{ fontSize: '12px', color: '#999' }}>{item.sku}</div>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px' }}>
                    {formatCurrency(item.price)}
                  </td>
                  <td style={{ textAlign: 'center', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                    {item.quantity}
                  </td>
                  <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                    {formatCurrency(item.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '18px' }}>💰 Totaux</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px', marginLeft: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>Sous-total :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(order.subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>Livraison :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(order.shipping_total)}</span>
            </div>
            {order.discount_total > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                <span style={{ color: '#dc3545' }}>Remise :</span>
                <span style={{ fontWeight: '600', color: '#dc3545' }}>-{formatCurrency(order.discount_total)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: '#666' }}>TVA :</span>
              <span style={{ fontWeight: '600' }}>{formatCurrency(order.tax_total)}</span>
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
              <span style={{ fontWeight: '600' }}>Total :</span>
              <span style={{ fontWeight: '700', color: '#28a745' }}>{formatCurrency(order.total)}</span>
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
                📊 Analyse de marge
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666' }}>Coût produits :</span>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(totalCost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666' }}>Coût livraison :</span>
                  <span style={{ fontWeight: '600' }}>{formatCurrency(shippingCost)}</span>
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
              </div>
            </div>
          </div>
        </div>
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
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default OrderDetail;
