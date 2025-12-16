import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const SubCategoryDetail = () => {
  const { subCategoryName } = useParams();
  const navigate = useNavigate();
  const [subCategory, setSubCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubCategoryData();
  }, [subCategoryName]);

  const fetchSubCategoryData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/categories/sub-categories/${encodeURIComponent(subCategoryName)}`);
      if (response.data.success) {
        setSubCategory(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching sub-category:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(value || 0);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value || 0);
  };

  const formatPercent = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format((value || 0) / 100);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
        <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (!subCategory) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
        <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: '18px', color: '#666' }}>Sous-categorie non trouvee</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button
          onClick={() => navigate(-1)}
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
      <div style={{ flex: 1, maxWidth: '1600px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Sub-category Header */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px' }}>
            {subCategory.category && (
              <span
                onClick={() => navigate(`/categories/${encodeURIComponent(subCategory.category)}`)}
                style={{ fontSize: '14px', color: '#135E84', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {subCategory.category}
              </span>
            )}
            {subCategory.category && <span style={{ color: '#999' }}>/</span>}
            <h1 style={{ margin: 0, color: '#135E84', fontSize: '28px' }}>{subCategory.sub_category}</h1>
          </div>

          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Produits</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{formatNumber(subCategory.stats.product_count)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Quantite vendue</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#333' }}>{formatNumber(subCategory.stats.qty_sold)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>CA TTC</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(subCategory.stats.ca_ttc)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>CA HT</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#333' }}>{formatCurrency(subCategory.stats.ca_ht)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Marge HT</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: subCategory.stats.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(subCategory.stats.margin_ht)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>% Marge</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: subCategory.stats.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(subCategory.stats.margin_percent)}</div>
            </div>
          </div>
        </div>

        {/* Products Table */}
        <div>
          <h2 style={{ color: '#333', marginBottom: '15px' }}>Produits ({subCategory.products?.length || 0})</h2>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Produit</th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Type</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Prix</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Stock</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Qte vendue</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>CA TTC</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Marge HT</th>
                  <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>% Marge</th>
                  <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#333' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subCategory.products?.map((product) => (
                  <tr
                    key={product.wp_product_id}
                    style={{ borderBottom: '1px solid #f0f0f0', transition: 'background-color 0.2s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ padding: '15px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {product.image_url && (
                          <img
                            src={product.image_url}
                            alt={product.post_title}
                            style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e0e0e0' }}
                          />
                        )}
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>SKU: {product.sku || '-'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: product.product_type === 'variable' ? '#e3f2fd' : product.product_type === 'woosb' ? '#fff3e0' : '#e8f5e9',
                        color: product.product_type === 'variable' ? '#1976d2' : product.product_type === 'woosb' ? '#f57c00' : '#388e3c'
                      }}>
                        {product.product_type === 'variable' ? 'Variable' : product.product_type === 'woosb' ? 'Bundle' : 'Simple'}
                        {product.variations_count > 0 && ` (${product.variations_count})`}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>{formatCurrency(product.price)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px' }}>{formatNumber(product.stock)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>{formatNumber(product.qty_sold)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(product.ca_ttc)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: product.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(product.margin_ht)}</td>
                    <td style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600', color: product.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(product.margin_percent)}</td>
                    <td style={{ textAlign: 'center', padding: '15px' }}>
                      <button
                        onClick={() => navigate(`/products/${product.wp_product_id}`)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#135E84',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        Voir details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Empty state */}
        {(!subCategory.products || subCategory.products.length === 0) && (
          <div style={{ textAlign: 'center', padding: '50px', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '18px', color: '#666' }}>Aucun produit dans cette sous-categorie</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white', marginTop: '50px' }}>
        <p style={{ margin: 0 }}>2024 YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default SubCategoryDetail;
