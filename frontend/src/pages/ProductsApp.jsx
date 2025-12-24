import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../components/CopyButton';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductsApp = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [stockSummary, setStockSummary] = useState({ in_stock: 0, out_of_stock: 0, low_stock: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    stockStatus: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const stockRes = await axios.get(`${API_URL}/products/stock-summary`);
      if (stockRes.data.success) setStockSummary(stockRes.data.data);

      await fetchProducts();
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const productsRes = await axios.get(`${API_URL}/products`, { params: { limit: 100 } });
      if (productsRes.data.success) setProducts(productsRes.data.data);
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const handleSearch = async (e) => {
    if (e.key === 'Enter') {
      if (searchTerm.trim()) {
        setLoading(true);
        try {
          const response = await axios.get(`${API_URL}/products/search`, {
            params: { q: searchTerm, limit: 100 }
          });

          if (response.data.success) {
            setProducts(response.data.data);
          }
        } catch (err) {
          console.error('Error searching products:', err);
        } finally {
          setLoading(false);
        }
      } else {
        fetchProducts();
      }
    }
  };

  const filteredProducts = products.filter(product => {
    if (filters.category && product.category !== filters.category) return false;
    if (filters.stockStatus === 'instock' && (product.stock_status !== 'instock' || product.stock <= 0)) return false;
    if (filters.stockStatus === 'outofstock' && product.stock_status !== 'outofstock' && product.stock > 0) return false;
    if (filters.stockStatus === 'low' && (product.stock > 10 || product.stock <= 0)) return false;
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

  const uniqueCategories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();

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
        <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>📦 Produits</h1>

        {/* Stock Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px', marginBottom: '30px' }}>
          <div
            onClick={() => setFilters({ ...filters, stockStatus: filters.stockStatus === 'instock' ? '' : 'instock' })}
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              border: filters.stockStatus === 'instock' ? '2px solid #28a745' : '2px solid transparent',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>
              En stock
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#28a745' }}>
              {stockSummary.in_stock || 0}
            </div>
            <div style={{ fontSize: '13px', color: '#999', marginTop: '5px' }}>
              Produits disponibles
            </div>
          </div>

          <div
            onClick={() => setFilters({ ...filters, stockStatus: filters.stockStatus === 'outofstock' ? '' : 'outofstock' })}
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              border: filters.stockStatus === 'outofstock' ? '2px solid #dc3545' : '2px solid transparent',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>
              En rupture
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#dc3545' }}>
              {stockSummary.out_of_stock || 0}
            </div>
            <div style={{ fontSize: '13px', color: '#999', marginTop: '5px' }}>
              Produits indisponibles
            </div>
          </div>

          <div
            onClick={() => setFilters({ ...filters, stockStatus: filters.stockStatus === 'low' ? '' : 'low' })}
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              border: filters.stockStatus === 'low' ? '2px solid #ffc107' : '2px solid transparent',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>
              Stock bas
            </div>
            <div style={{ fontSize: '28px', fontWeight: '700', color: '#ffc107' }}>
              {stockSummary.low_stock || 0}
            </div>
            <div style={{ fontSize: '13px', color: '#999', marginTop: '5px' }}>
              Moins de 10 unités
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <input
            type="text"
            placeholder="🔍 Rechercher par nom, SKU... (Appuyez sur Entrée)"
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
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
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
            {uniqueCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button
            onClick={() => {
              setSearchTerm('');
              setFilters({ category: '', stockStatus: '' });
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

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
          </div>
        )}

        {/* Products Table */}
        {!loading && filteredProducts.length > 0 && (
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
                    Marge unitaire
                  </th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>
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
                {filteredProducts.map((product) => {
                  const margin = parseFloat(product.unit_margin) || 0;
                  const marginColor = margin >= 0 ? '#28a745' : '#dc3545';

                  return (
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
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                        <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                          SKU: {product.sku || '-'}
                          {product.sku && <CopyButton text={product.sku} size={11} />}
                        </div>
                      </td>
                      <td style={{ padding: '15px', fontSize: '14px', color: '#666' }}>
                        {product.product_type || '-'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                        {formatCurrency(product.price)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', color: '#666' }}>
                        {formatCurrency(product.effective_cost_price || 0)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: marginColor }}>
                        {formatCurrency(margin)}
                      </td>
                      <td style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>
                        {product.stock !== null ? formatNumber(product.stock) : '-'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#135E84' }}>
                        {formatCurrency(product.total_revenue || 0)}
                      </td>
                      <td style={{ textAlign: 'center', padding: '15px' }}>
                        <button
                          onClick={() => navigate(`/products/${product.wp_product_id}`)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* No results */}
        {!loading && filteredProducts.length === 0 && (
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

        {/* Results count */}
        {!loading && filteredProducts.length > 0 && (
          <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
            {filteredProducts.length} produit(s) affiché(s) sur {products.length} au total
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
