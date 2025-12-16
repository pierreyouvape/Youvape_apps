import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CategoryDetail = () => {
  const { categoryName } = useParams();
  const navigate = useNavigate();
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedSubCategories, setExpandedSubCategories] = useState({});
  const [subCategoryProducts, setSubCategoryProducts] = useState({});

  useEffect(() => {
    fetchCategoryData();
  }, [categoryName]);

  const fetchCategoryData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/categories/${encodeURIComponent(categoryName)}`);
      if (response.data.success) {
        setCategory(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching category:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubCategoryProducts = async (subCategoryName) => {
    if (subCategoryProducts[subCategoryName]) return;

    try {
      const response = await axios.get(`${API_URL}/categories/sub-categories/${encodeURIComponent(subCategoryName)}`);
      if (response.data.success) {
        setSubCategoryProducts(prev => ({
          ...prev,
          [subCategoryName]: response.data.data.products
        }));
      }
    } catch (err) {
      console.error('Error fetching sub-category products:', err);
    }
  };

  const toggleSubCategory = async (subCategoryName) => {
    const isExpanding = !expandedSubCategories[subCategoryName];
    setExpandedSubCategories(prev => ({
      ...prev,
      [subCategoryName]: isExpanding
    }));

    if (isExpanding) {
      await fetchSubCategoryProducts(subCategoryName);
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

  if (!category) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
        <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: '18px', color: '#666' }}>Categorie non trouvee</div>
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
        {/* Category Header */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <h1 style={{ margin: '0 0 20px 0', color: '#135E84', fontSize: '28px' }}>{category.category}</h1>

          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Produits</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{formatNumber(category.stats.product_count)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Sous-categories</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{formatNumber(category.stats.sub_category_count)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Quantite vendue</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#333' }}>{formatNumber(category.stats.qty_sold)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>CA TTC</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(category.stats.ca_ttc)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Marge HT</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: category.stats.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(category.stats.margin_ht)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>% Marge</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: category.stats.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(category.stats.margin_percent)}</div>
            </div>
          </div>
        </div>

        {/* Sub-categories Accordions */}
        {category.sub_categories && category.sub_categories.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ color: '#333', marginBottom: '15px' }}>Sous-categories ({category.sub_categories.length})</h2>
            {category.sub_categories.map((subCategory) => (
              <div key={subCategory.sub_category} style={{ marginBottom: '10px' }}>
                {/* Accordion Header */}
                <div
                  onClick={() => toggleSubCategory(subCategory.sub_category)}
                  style={{
                    backgroundColor: '#fff',
                    padding: '15px 20px',
                    borderRadius: expandedSubCategories[subCategory.sub_category] ? '12px 12px 0 0' : '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontSize: '18px', fontWeight: '600', color: '#135E84' }}>{subCategory.sub_category}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); navigate(`/sub-categories/${encodeURIComponent(subCategory.sub_category)}`); }}
                      style={{
                        fontSize: '12px',
                        color: '#fff',
                        backgroundColor: '#135E84',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Voir page
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '12px', color: '#666' }}>{formatNumber(subCategory.product_count)} produits</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(subCategory.ca_ttc)}</div>
                    </div>
                    <div style={{ fontSize: '20px', color: '#666', transition: 'transform 0.2s', transform: expandedSubCategories[subCategory.sub_category] ? 'rotate(180deg)' : 'rotate(0)' }}>
                      v
                    </div>
                  </div>
                </div>

                {/* Accordion Content */}
                {expandedSubCategories[subCategory.sub_category] && (
                  <div style={{
                    backgroundColor: '#fff',
                    borderRadius: '0 0 12px 12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    borderTop: '1px solid #e0e0e0',
                    overflow: 'hidden'
                  }}>
                    {!subCategoryProducts[subCategory.sub_category] ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Chargement...</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
                            <th style={{ textAlign: 'left', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Produit</th>
                            <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Stock</th>
                            <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Qte vendue</th>
                            <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>CA TTC</th>
                            <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Marge HT</th>
                            <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>% Marge</th>
                            <th style={{ textAlign: 'center', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subCategoryProducts[subCategory.sub_category].map((product) => (
                            <tr key={product.wp_product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '12px 15px' }}>
                                <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                                <div style={{ fontSize: '12px', color: '#999' }}>SKU: {product.sku || '-'}</div>
                              </td>
                              <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px' }}>{formatNumber(product.stock)}</td>
                              <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600' }}>{formatNumber(product.qty_sold)}</td>
                              <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(product.ca_ttc)}</td>
                              <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: product.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(product.margin_ht)}</td>
                              <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: product.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(product.margin_percent)}</td>
                              <td style={{ textAlign: 'center', padding: '12px 15px' }}>
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
                                  Voir
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Products without sub-category */}
        {category.products_without_sub_category && category.products_without_sub_category.length > 0 && (
          <div>
            <h2 style={{ color: '#333', marginBottom: '15px' }}>Produits sans sous-categorie ({category.products_without_sub_category.length})</h2>
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Produit</th>
                    <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Stock</th>
                    <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Qte vendue</th>
                    <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>CA TTC</th>
                    <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Marge HT</th>
                    <th style={{ textAlign: 'right', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>% Marge</th>
                    <th style={{ textAlign: 'center', padding: '12px 15px', fontSize: '13px', fontWeight: '600', color: '#333' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {category.products_without_sub_category.map((product) => (
                    <tr key={product.wp_product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 15px' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>SKU: {product.sku || '-'}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px' }}>{formatNumber(product.stock)}</td>
                      <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600' }}>{formatNumber(product.qty_sold)}</td>
                      <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(product.ca_ttc)}</td>
                      <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: product.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(product.margin_ht)}</td>
                      <td style={{ textAlign: 'right', padding: '12px 15px', fontSize: '14px', fontWeight: '600', color: product.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(product.margin_percent)}</td>
                      <td style={{ textAlign: 'center', padding: '12px 15px' }}>
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
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

export default CategoryDetail;
