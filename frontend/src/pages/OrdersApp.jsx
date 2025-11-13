import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const OrdersApp = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [statusStats, setStatusStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    country: '',
    paymentMethod: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/orders`, { params: { limit: 100000 } }),
        axios.get(`${API_URL}/orders/stats/by-status`)
      ]);

      if (ordersRes.data.success) setOrders(ordersRes.data.data);
      if (statsRes.data.success) setStatusStats(statsRes.data.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter(order => {
    if (filters.search && !order.order_number?.toLowerCase().includes(filters.search.toLowerCase())
        && !order.email?.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters.status && order.status !== filters.status) return false;
    if (filters.country && order.shipping_country !== filters.country) return false;
    if (filters.paymentMethod && order.payment_method !== filters.paymentMethod) return false;
    return true;
  });

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
      month: 'short',
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
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          fontWeight: '600',
          backgroundColor: style.bg,
          color: style.color
        }}
      >
        {status}
      </span>
    );
  };

  const uniqueCountries = [...new Set(orders.map(o => o.shipping_country).filter(Boolean))].sort();
  const uniquePaymentMethods = [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort();

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
          onClick={() => navigate('/home')}
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
      <div style={{ flex: 1, maxWidth: '1600px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>🛒 Commandes</h1>

        {/* Status Summary Cards */}
        {statusStats.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
            {statusStats.map((stat) => (
              <div
                key={stat.status}
                onClick={() => setFilters({ ...filters, status: filters.status === stat.status ? '' : stat.status })}
                style={{
                  backgroundColor: '#fff',
                  padding: '20px',
                  borderRadius: '12px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  cursor: 'pointer',
                  border: filters.status === stat.status ? '2px solid #135E84' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>
                  {stat.status}
                </div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#135E84' }}>
                  {stat.count}
                </div>
                <div style={{ fontSize: '13px', color: '#999', marginTop: '5px' }}>
                  {formatCurrency(stat.total_amount)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par n° ou email..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            style={{
              padding: '10px 15px',
              fontSize: '14px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              width: '300px',
              outline: 'none'
            }}
          />
          <select
            value={filters.country}
            onChange={(e) => setFilters({ ...filters, country: e.target.value })}
            style={{
              padding: '10px 15px',
              fontSize: '14px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">Tous les pays</option>
            {uniqueCountries.map((country) => (
              <option key={country} value={country}>{country}</option>
            ))}
          </select>
          <select
            value={filters.paymentMethod}
            onChange={(e) => setFilters({ ...filters, paymentMethod: e.target.value })}
            style={{
              padding: '10px 15px',
              fontSize: '14px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">Tous les paiements</option>
            {uniquePaymentMethods.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
          <button
            onClick={() => setFilters({ search: '', status: '', country: '', paymentMethod: '' })}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            🔄 Réinitialiser
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
          </div>
        )}

        {/* Orders Table */}
        {!loading && filteredOrders.length > 0 && (
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              overflow: 'auto'
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Commande
                  </th>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Client
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Statut
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Total
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Date
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Pays
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Paiement
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr
                    key={order.order_id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '15px' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>#{order.order_number}</div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                        {order.items_count} article(s)
                      </div>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      <div style={{ fontWeight: '600', color: '#333' }}>
                        {order.first_name} {order.last_name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#999' }}>{order.email}</div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>{getStatusBadge(order.status)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>
                      {formatCurrency(order.total)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '13px', color: '#666' }}>
                      {formatDate(order.date_created)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                      {order.shipping_country || '-'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '12px', color: '#666' }}>
                      {order.payment_method_title || order.payment_method || '-'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <button
                        onClick={() => navigate(`/orders/${order.order_id}`)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#135E84',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        Voir détails
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* No results */}
        {!loading && filteredOrders.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '50px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔍</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Aucune commande trouvée</div>
          </div>
        )}

        {/* Results count */}
        {!loading && filteredOrders.length > 0 && (
          <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
            {filteredOrders.length} commande(s) affichée(s) sur {orders.length} au total
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
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default OrdersApp;
