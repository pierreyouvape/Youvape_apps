import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CatalogApp = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0, hasMore: false });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProducts = async (offset = 0, search = searchTerm) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/products/catalog`, {
        params: { limit: 50, offset, search },
        headers
      });
      if (res.data.success) {
        setProducts(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(0, '');
  }, []);

  const handleSearch = (e) => {
    const value = e.target.value;
    setSearchTerm(value);
    // Debounce
    clearTimeout(window._catalogSearchTimeout);
    window._catalogSearchTimeout = setTimeout(() => {
      fetchProducts(0, value);
    }, 300);
  };

  const handlePageChange = (newOffset) => {
    fetchProducts(newOffset);
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
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
          Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1200px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        <h1 style={{ color: '#135E84', marginBottom: '20px' }}>Catalogue Produits</h1>

        {/* Search */}
        <div style={{ marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="Rechercher par nom ou SKU..."
            value={searchTerm}
            onChange={handleSearch}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '10px 14px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              outline: 'none'
            }}
          />
          <span style={{ marginLeft: '12px', color: '#6b7280', fontSize: '14px' }}>
            {pagination.total} produit{pagination.total > 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>Chargement...</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', width: '50px' }}></th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Produit</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>SKU</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Stock</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Prix</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/catalog/${p.id}`)}
                      style={{
                        borderBottom: '1px solid #e5e7eb',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <td style={{ padding: '8px 12px' }}>
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                        ) : (
                          <div style={{
                            width: '40px',
                            height: '40px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#9ca3af',
                            fontSize: '16px'
                          }}>?</div>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: '500' }}>{p.post_title}</td>
                      <td style={{ padding: '8px 12px', color: '#6b7280', fontFamily: 'monospace' }}>{p.sku}</td>
                      <td style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: parseInt(p.stock) <= 0 ? '#ef4444' : 'inherit'
                      }}>
                        {parseInt(p.stock) || 0}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {p.regular_price ? `${parseFloat(p.regular_price).toFixed(2)} \u20AC` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                <button
                  onClick={() => handlePageChange(pagination.offset - pagination.limit)}
                  disabled={pagination.offset === 0}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: pagination.offset === 0 ? '#f3f4f6' : '#fff',
                    cursor: pagination.offset === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Precedent
                </button>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                  disabled={!pagination.hasMore}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: !pagination.hasMore ? '#f3f4f6' : '#fff',
                    cursor: !pagination.hasMore ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        textAlign: 'center',
        color: 'white'
      }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default CatalogApp;
