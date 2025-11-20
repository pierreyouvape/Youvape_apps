import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const CustomersStatsTab = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 50,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [avgOrders, setAvgOrders] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [countries, setCountries] = useState([]);

  // Chargement de la liste des pays
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/customers/countries`);
        if (response.data.success) {
          setCountries(response.data.data);
        }
      } catch (error) {
        console.error('Error fetching countries:', error);
      }
    };
    fetchCountries();
  }, []);

  // Chargement des données clients
  useEffect(() => {
    const fetchCustomers = async () => {
      setLoading(true);
      try {
        const offset = pagination.pageIndex * pagination.pageSize;
        const response = await axios.get(`${API_BASE_URL}/customers/stats-list`, {
          params: {
            limit: pagination.pageSize,
            offset: offset,
            search: searchTerm,
            country: countryFilter,
          },
        });

        if (response.data.success) {
          setData(response.data.data);
          setTotalCount(response.data.pagination.total);

          // Calcul des statistiques
          const total = response.data.data.reduce((sum, customer) => sum + parseFloat(customer.total_spent || 0), 0);
          const avgOrderCount = response.data.data.length > 0
            ? response.data.data.reduce((sum, customer) => sum + parseInt(customer.order_count || 0), 0) / response.data.data.length
            : 0;

          setTotalSpent(total);
          setAvgOrders(avgOrderCount);
        }
      } catch (error) {
        console.error('Error fetching customers:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomers();
  }, [pagination.pageIndex, pagination.pageSize, searchTerm, countryFilter]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleCountryChange = (e) => {
    setCountryFilter(e.target.value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleExport = async () => {
    try {
      const url = searchTerm || countryFilter
        ? `${API_BASE_URL}/customers/stats-list?search=${searchTerm}&country=${countryFilter}&limit=10000`
        : `${API_BASE_URL}/customers/stats-list?limit=10000`;

      const response = await axios.get(url);

      if (response.data.success) {
        const customers = response.data.data;
        const csv = [
          ['ID', 'Prénom', 'Nom', 'Email', 'Commandes', 'Total dépensé', 'Pays'],
          ...customers.map(c => [
            c.id,
            c.first_name || '',
            c.last_name || '',
            c.email || '',
            c.order_count || 0,
            parseFloat(c.total_spent || 0).toFixed(2),
            c.country || ''
          ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `clients_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      console.error('Error exporting:', error);
      alert('Erreur lors de l\'export des données');
    }
  };

  const goToPage = (page) => {
    setPagination((prev) => ({ ...prev, pageIndex: page }));
  };

  const nextPage = () => {
    if (pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex + 1 }));
    }
  };

  const previousPage = () => {
    if (pagination.pageIndex > 0) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex - 1 }));
    }
  };

  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1;
  const pageCount = Math.ceil(totalCount / pagination.pageSize);

  return (
    <div>
      {/* Header avec filtres */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Liste des clients</h2>
        <div style={{ display: 'flex', gap: '15px' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Rechercher..."
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              minWidth: '250px'
            }}
          />
          <select
            value={countryFilter}
            onChange={handleCountryChange}
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              minWidth: '150px'
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
            onClick={handleExport}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.3s ease'
            }}
          >
            📥 Exporter CSV
          </button>
        </div>
      </div>

      {/* Cards de statistiques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total clients</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{totalCount}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total dépensé (page)</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#007bff', margin: 0 }}>{totalSpent.toFixed(2)} €</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Moy. commandes (page)</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', margin: 0 }}>{avgOrders.toFixed(1)}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>ID</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Nom Prénom</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Total dépensé</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Pays</th>
                </tr>
              </thead>
              <tbody>
                {data.map((customer) => (
                  <tr key={customer.id} style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#007bff' }}>{customer.id}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      {`${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'N/A'}
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{customer.email || 'N/A'}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        backgroundColor: '#d1e7dd',
                        color: '#0f5132'
                      }}>
                        {customer.order_count || 0} commandes
                      </span>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>
                      {parseFloat(customer.total_spent || 0).toFixed(2)} €
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{customer.country || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun client trouvé
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && data.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', backgroundColor: 'white', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => goToPage(0)}
              disabled={!canPreviousPage}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                backgroundColor: canPreviousPage ? 'white' : '#f8f9fa',
                cursor: canPreviousPage ? 'pointer' : 'not-allowed',
                fontSize: '14px'
              }}
            >
              {'<<'}
            </button>
            <button
              onClick={previousPage}
              disabled={!canPreviousPage}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                backgroundColor: canPreviousPage ? 'white' : '#f8f9fa',
                cursor: canPreviousPage ? 'pointer' : 'not-allowed',
                fontSize: '14px'
              }}
            >
              {'<'}
            </button>
            <button
              onClick={nextPage}
              disabled={!canNextPage}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                backgroundColor: canNextPage ? 'white' : '#f8f9fa',
                cursor: canNextPage ? 'pointer' : 'not-allowed',
                fontSize: '14px'
              }}
            >
              {'>'}
            </button>
            <button
              onClick={() => goToPage(pageCount - 1)}
              disabled={!canNextPage}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                backgroundColor: canNextPage ? 'white' : '#f8f9fa',
                cursor: canNextPage ? 'pointer' : 'not-allowed',
                fontSize: '14px'
              }}
            >
              {'>>'}
            </button>
          </div>
          <div style={{ fontSize: '14px', color: '#6c757d' }}>
            Page <strong>{pagination.pageIndex + 1}</strong> sur <strong>{pageCount}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: '#6c757d' }}>Afficher:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination((prev) => ({ ...prev, pageSize: Number(e.target.value), pageIndex: 0 }))}
              style={{
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersStatsTab;
