import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const OrdersApp = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchFilters();
    fetchOrders();
  }, []);

  const fetchFilters = async () => {
    try {
      const [statusesRes, countriesRes] = await Promise.all([
        axios.get(`${API_URL}/orders/statuses/list`),
        axios.get(`${API_URL}/orders/countries/list`)
      ]);

      if (statusesRes.data.success) setStatuses(statusesRes.data.data);
      if (countriesRes.data.success) setCountries(countriesRes.data.data);
    } catch (err) {
      console.error('Error fetching filters:', err);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${API_URL}/orders`, {
        params: { limit: 100 }
      });

      if (response.data.success) {
        setOrders(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError('Erreur lors du chargement des commandes');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim() && !selectedStatus && !selectedCountry) {
      fetchOrders();
      return;
    }

    setLoading(true);
    setError('');

    try {
      let response;

      if (searchTerm.trim()) {
        response = await axios.get(`${API_URL}/orders/search`, {
          params: { q: searchTerm, limit: 100 }
        });
      } else if (selectedStatus) {
        response = await axios.get(`${API_URL}/orders/status/${selectedStatus}`, {
          params: { limit: 100 }
        });
      } else if (selectedCountry) {
        response = await axios.get(`${API_URL}/orders/country/${selectedCountry}`, {
          params: { limit: 100 }
        });
      }

      if (response && response.data.success) {
        setOrders(response.data.data);
      }
    } catch (err) {
      console.error('Error searching orders:', err);
      setError('Erreur lors de la recherche');
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
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Title & Search */}
        <div style={{ marginBottom: '30px' }}>
          <h1 style={{ color: '#135E84', margin: '0 0 20px 0' }}>🛒 Commandes</h1>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Rechercher par n° commande, email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
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
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setSearchTerm('');
                setSelectedCountry('');
              }}
              style={{
                padding: '10px 15px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '6px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="">Tous les statuts</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={selectedCountry}
              onChange={(e) => {
                setSelectedCountry(e.target.value);
                setSearchTerm('');
                setSelectedStatus('');
              }}
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
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
            <button
              onClick={handleSearch}
              style={{
                padding: '10px 20px',
                backgroundColor: '#135E84',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              🔍 Rechercher
            </button>
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedStatus('');
                setSelectedCountry('');
                fetchOrders();
              }}
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
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '15px',
              marginBottom: '20px',
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '6px',
              color: '#721c24'
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
          </div>
        )}

        {/* Orders Table */}
        {!loading && orders.length > 0 && (
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              overflow: 'hidden'
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
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
        {!loading && orders.length === 0 && (
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
