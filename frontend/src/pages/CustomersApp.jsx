import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CustomersApp = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${API_URL}/customers`, {
        params: { limit: 100 }
      });

      if (response.data.success) {
        setCustomers(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
      setError('Erreur lors du chargement des clients');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      fetchCustomers();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${API_URL}/customers/search`, {
        params: { q: searchTerm, limit: 100 }
      });

      if (response.data.success) {
        setCustomers(response.data.data);
      }
    } catch (err) {
      console.error('Error searching customers:', err);
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

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR');
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px'
          }}
        >
          <h1 style={{ color: '#135E84', margin: 0 }}>👥 Clients</h1>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              placeholder="Rechercher par nom, email..."
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
              onClick={fetchCustomers}
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

        {/* Customers Table */}
        {!loading && customers.length > 0 && (
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
                    Client
                  </th>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Email
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Commandes
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Total dépensé
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Dernière commande
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr
                    key={customer.customer_id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '15px' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>
                        {customer.first_name} {customer.last_name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                        ID: {customer.customer_id}
                      </div>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px', color: '#666' }}>{customer.email}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                      {formatNumber(customer.actual_order_count || customer.order_count || 0)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>
                      {formatCurrency(customer.actual_total_spent || customer.total_spent || 0)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '14px', color: '#666' }}>
                      {formatDate(customer.last_order_date)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <button
                        onClick={() => navigate(`/customers/${customer.customer_id}`)}
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
        {!loading && customers.length === 0 && (
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
            <div style={{ fontSize: '18px', color: '#666' }}>Aucun client trouvé</div>
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

export default CustomersApp;
