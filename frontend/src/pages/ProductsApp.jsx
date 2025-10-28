import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductsApp = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories();
    fetchProducts();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await axios.get(`${API_URL}/products/categories/list`);
      if (response.data.success) {
        setCategories(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`${API_URL}/products`, {
        params: { limit: 100 }
      });

      if (response.data.success) {
        setProducts(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Erreur lors du chargement des produits');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTerm.trim() && !selectedCategory) {
      fetchProducts();
      return;
    }

    setLoading(true);
    setError('');

    try {
      let response;
      if (selectedCategory) {
        response = await axios.get(`${API_URL}/products/category/${selectedCategory}`, {
          params: { limit: 100 }
        });
      } else {
        response = await axios.get(`${API_URL}/products/search`, {
          params: { q: searchTerm, limit: 100 }
        });
      }

      if (response.data.success) {
        setProducts(response.data.data);
      }
    } catch (err) {
      console.error('Error searching products:', err);
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
          <h1 style={{ color: '#135E84', margin: '0 0 20px 0' }}>📦 Produits</h1>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Rechercher par nom, SKU..."
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
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setSearchTerm('');
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
              <option value="">Toutes les catégories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
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
                setSelectedCategory('');
                fetchProducts();
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

        {/* Products Table */}
        {!loading && products.length > 0 && (
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
                    Produit
                  </th>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Catégorie
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Prix
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Coût
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Marge unit.
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Stock
                  </th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    CA Total
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.product_id}
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '15px' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.name}</div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{product.sku}</div>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px', color: '#666' }}>{product.category || '-'}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(product.price)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px' }}>
                      {formatCurrency(product.effective_cost_price || 0)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: '15px',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: product.unit_margin > 0 ? '#28a745' : '#dc3545'
                      }}
                    >
                      {formatCurrency(product.unit_margin || 0)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px' }}>
                      {formatNumber(product.stock_quantity || 0)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#135E84' }}>
                      {formatCurrency(product.total_revenue || 0)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <button
                        onClick={() => navigate(`/products/${product.product_id}`)}
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
        {!loading && products.length === 0 && (
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
            <div style={{ fontSize: '18px', color: '#666' }}>Aucun produit trouvé</div>
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

export default ProductsApp;
