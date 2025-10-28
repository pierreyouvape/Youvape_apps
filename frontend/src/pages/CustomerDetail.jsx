import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CustomerDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [orders, setOrders] = useState([]);
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      fetchCustomerData();
    }
  }, [id]);

  const fetchCustomerData = async () => {
    setLoading(true);
    setError('');

    try {
      const [customerRes, ordersRes, favoritesRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/customers/${id}`),
        axios.get(`${API_URL}/customers/${id}/orders`, { params: { limit: 20 } }),
        axios.get(`${API_URL}/customers/${id}/favorite-products`, { params: { limit: 10 } }),
        axios.get(`${API_URL}/customers/${id}/stats`)
      ]);

      setCustomer(customerRes.data.data);
      setOrders(ordersRes.data.data);
      setFavoriteProducts(favoritesRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error('Error fetching customer data:', err);
      setError('Erreur lors du chargement des données');
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

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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

  if (error || !customer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>{error || 'Client introuvable'}</div>
          <button
            onClick={() => navigate('/customers')}
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
          onClick={() => navigate('/customers')}
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
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Customer Info */}
        <div
          style={{
            backgroundColor: '#fff',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            marginBottom: '30px'
          }}
        >
          <h1 style={{ margin: '0 0 20px 0', color: '#135E84' }}>
            {customer.first_name} {customer.last_name}
          </h1>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Email</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{customer.email}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Téléphone</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{customer.phone || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Inscrit le</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatDate(customer.date_created)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>ID Client</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{customer.customer_id}</div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '20px',
              marginBottom: '30px'
            }}
          >
            <div
              style={{
                backgroundColor: '#fff',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>🛒</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', marginBottom: '5px' }}>
                {formatNumber(stats.total_orders)}
              </div>
              <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Commandes</div>
            </div>

            <div
              style={{
                backgroundColor: '#fff',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>💰</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', marginBottom: '5px' }}>
                {formatCurrency(stats.total_spent)}
              </div>
              <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Total dépensé</div>
            </div>

            <div
              style={{
                backgroundColor: '#fff',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>📊</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#8b5cf6', marginBottom: '5px' }}>
                {formatCurrency(stats.avg_order_value)}
              </div>
              <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Panier moyen</div>
            </div>

            <div
              style={{
                backgroundColor: '#fff',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>📦</div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#ff6b6b', marginBottom: '5px' }}>
                {formatNumber(stats.unique_products_bought)}
              </div>
              <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Produits différents</div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px' }}>
          {/* Orders History */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              📋 Historique des commandes
            </h2>
            {orders.length > 0 ? (
              <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {orders.map((order) => (
                  <div
                    key={order.order_id}
                    style={{
                      padding: '15px',
                      marginBottom: '10px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onClick={() => navigate(`/orders/${order.order_id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>Commande #{order.order_number}</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#28a745' }}>
                        {formatCurrency(order.total)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#999' }}>
                      <div>{formatDate(order.date_created)}</div>
                      <div>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: order.status === 'completed' ? '#d4edda' : '#fff3cd',
                            color: order.status === 'completed' ? '#155724' : '#856404'
                          }}
                        >
                          {order.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Aucune commande</div>
            )}
          </div>

          {/* Favorite Products */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>❤️ Produits favoris</h2>
            {favoriteProducts.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                      Produit
                    </th>
                    <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Qté</th>
                    <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {favoriteProducts.map((product) => (
                    <tr key={product.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td
                        style={{ padding: '12px 5px', fontSize: '14px', cursor: 'pointer' }}
                        onClick={() => navigate(`/products/${product.product_id}`)}
                      >
                        <div style={{ fontWeight: '600' }}>{product.name}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{product.sku}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                        {formatNumber(product.total_quantity)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                        {formatCurrency(product.total_spent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Aucun produit acheté</div>
            )}
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

export default CustomerDetail;
