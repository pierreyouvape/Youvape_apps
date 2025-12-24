import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../components/CopyButton';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const BrandDetail = () => {
  const { brandName } = useParams();
  const navigate = useNavigate();
  const [brand, setBrand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedSubBrands, setExpandedSubBrands] = useState({});
  const [subBrandProducts, setSubBrandProducts] = useState({});

  useEffect(() => {
    fetchBrandData();
  }, [brandName]);

  const fetchBrandData = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/brands/${encodeURIComponent(brandName)}`);
      if (response.data.success) {
        setBrand(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching brand:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubBrandProducts = async (subBrandName) => {
    if (subBrandProducts[subBrandName]) return;

    try {
      const response = await axios.get(`${API_URL}/brands/sub-brands/${encodeURIComponent(subBrandName)}`);
      if (response.data.success) {
        setSubBrandProducts(prev => ({
          ...prev,
          [subBrandName]: response.data.data.products
        }));
      }
    } catch (err) {
      console.error('Error fetching sub-brand products:', err);
    }
  };

  const toggleSubBrand = async (subBrandName) => {
    const isExpanding = !expandedSubBrands[subBrandName];
    setExpandedSubBrands(prev => ({
      ...prev,
      [subBrandName]: isExpanding
    }));

    if (isExpanding) {
      await fetchSubBrandProducts(subBrandName);
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
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!brand) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
        <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: '18px', color: '#666' }}>Marque non trouvee</div>
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
        {/* Brand Header */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <h1 style={{ margin: '0 0 20px 0', color: '#135E84', fontSize: '28px' }}>{brand.brand}</h1>

          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '15px' }}>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Produits</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{formatNumber(brand.stats.product_count)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Sous-marques</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{formatNumber(brand.stats.sub_brand_count)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Quantite vendue</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#333' }}>{formatNumber(brand.stats.qty_sold)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>CA TTC</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(brand.stats.ca_ttc)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>Marge HT</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: brand.stats.margin_ht >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(brand.stats.margin_ht)}</div>
            </div>
            <div style={{ backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px' }}>
              <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase' }}>% Marge</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: brand.stats.margin_percent >= 0 ? '#28a745' : '#dc3545' }}>{formatPercent(brand.stats.margin_percent)}</div>
            </div>
          </div>
        </div>

        {/* Sub-brands Accordions */}
        {brand.sub_brands && brand.sub_brands.length > 0 && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ color: '#333', marginBottom: '15px' }}>Sous-marques ({brand.sub_brands.length})</h2>
            {brand.sub_brands.map((subBrand) => (
              <div key={subBrand.sub_brand} style={{ marginBottom: '10px' }}>
                {/* Accordion Header */}
                <div
                  onClick={() => toggleSubBrand(subBrand.sub_brand)}
                  style={{
                    backgroundColor: '#fff',
                    padding: '15px 20px',
                    borderRadius: expandedSubBrands[subBrand.sub_brand] ? '12px 12px 0 0' : '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontSize: '18px', fontWeight: '600', color: '#135E84' }}>{subBrand.sub_brand}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); navigate(`/sub-brands/${encodeURIComponent(subBrand.sub_brand)}`); }}
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
                      <div style={{ fontSize: '12px', color: '#666' }}>{formatNumber(subBrand.product_count)} produits</div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(subBrand.ca_ttc)}</div>
                    </div>
                    <div style={{ fontSize: '20px', color: '#666', transition: 'transform 0.2s', transform: expandedSubBrands[subBrand.sub_brand] ? 'rotate(180deg)' : 'rotate(0)' }}>
                      v
                    </div>
                  </div>
                </div>

                {/* Accordion Content */}
                {expandedSubBrands[subBrand.sub_brand] && (
                  <div style={{
                    backgroundColor: '#fff',
                    borderRadius: '0 0 12px 12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    borderTop: '1px solid #e0e0e0',
                    overflow: 'hidden'
                  }}>
                    {!subBrandProducts[subBrand.sub_brand] ? (
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
                          {subBrandProducts[subBrand.sub_brand].map((product) => (
                            <tr key={product.wp_product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '12px 15px' }}>
                                <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                                <div style={{ fontSize: '12px', color: '#999' }}>
                                  SKU: {product.sku || '-'}
                                  {product.sku && <CopyButton text={product.sku} size={11} />}
                                </div>
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

        {/* Products without sub-brand */}
        {brand.products_without_sub_brand && brand.products_without_sub_brand.length > 0 && (
          <div>
            <h2 style={{ color: '#333', marginBottom: '15px' }}>Produits sans sous-marque ({brand.products_without_sub_brand.length})</h2>
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
                  {brand.products_without_sub_brand.map((product) => (
                    <tr key={product.wp_product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 15px' }}>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#333' }}>{product.post_title}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>
                          SKU: {product.sku || '-'}
                          {product.sku && <CopyButton text={product.sku} size={11} />}
                        </div>
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

export default BrandDetail;
