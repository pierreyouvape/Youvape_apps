import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CustomersApp = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    country: ''
  });

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/customers`, {
        params: { limit: 100 }
      });

      if (response.data.success) {
        setCustomers(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e) => {
    if (e.key === 'Enter') {
      if (searchTerm.trim()) {
        setLoading(true);
        try {
          const response = await axios.get(`${API_URL}/customers/search`, {
            params: { q: searchTerm, limit: 100 }
          });

          if (response.data.success) {
            setCustomers(response.data.data);
          }
        } catch (err) {
          console.error('Error searching customers:', err);
        } finally {
          setLoading(false);
        }
      } else {
        fetchCustomers();
      }
    }
  };

  const filteredCustomers = customers.filter(customer => {
    if (filters.country && customer.shipping_country !== filters.country) return false;
    return true;
  });

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

  const uniqueCountries = [...new Set(customers.map(c => c.shipping_country).filter(Boolean))].sort();

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
        <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>👥 Clients</h1>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par nom, email... (Appuyez sur Entrée)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearch}
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
          <button
            onClick={() => {
              setSearchTerm('');
              setFilters({ country: '' });
              fetchCustomers();
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

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
          </div>
        )}

        {/* Customers Table */}
        {!loading && filteredCustomers.length > 0 && (
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
                    Nom
                  </th>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Email
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Commandes
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Total dépensé
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Pays
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
                {filteredCustomers.map((customer) => (
                  <tr
                    key={customer.wp_user_id}
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
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px', color: '#666' }}>
                      {customer.email}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#135E84' }}>
                      {formatNumber(customer.actual_order_count || customer.orders_count || 0)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>
                      {formatCurrency(customer.actual_total_spent || customer.total_spent || 0)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                      {customer.shipping_country || '-'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px', fontSize: '13px', color: '#666' }}>
                      {formatDate(customer.date_last_order)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <button
                        onClick={() => navigate(`/customers/${customer.wp_user_id}`)}
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
        {!loading && filteredCustomers.length === 0 && (
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

        {/* Results count */}
        {!loading && filteredCustomers.length > 0 && (
          <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
            {filteredCustomers.length} client(s) affiché(s) sur {customers.length} au total
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
