import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import AdvancedSalesChart from '../components/charts/AdvancedSalesChart';
import { formatDate as formatDateUtil } from '../utils/dateUtils';
import SalesByDayOfWeekChart from '../components/charts/SalesByDayOfWeekChart';
import SalesByHourChart from '../components/charts/SalesByHourChart';
import SalesByCountryPieChart from '../components/charts/SalesByCountryPieChart';
import PeriodFilter from '../components/PeriodFilter';
import CopyButton from '../components/CopyButton';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  // State
  const [product, setProduct] = useState(null);
  const [family, setFamily] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [variantsStats, setVariantsStats] = useState([]);
  const [salesEvolution, setSalesEvolution] = useState([]);
  const [comparisonEvolution, setComparisonEvolution] = useState(null);
  const [salesByDayOfWeek, setSalesByDayOfWeek] = useState([]);
  const [salesByHour, setSalesByHour] = useState([]);
  const [frequentlyBought, setFrequentlyBought] = useState([]);
  const [salesByCountry, setSalesByCountry] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCost, setEditingCost] = useState(false);
  const [newCost, setNewCost] = useState('');
  const [periodParams, setPeriodParams] = useState({
    start: null,
    end: null,
    groupBy: 'day'
  });
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [variantsPeriodStats, setVariantsPeriodStats] = useState([]);

  useEffect(() => {
    if (id) {
      fetchProductData();
      // Par défaut : "Tout" (depuis la création) - pas de dates
      const defaultParams = {
        start: null,
        end: null,
        groupBy: 'day'
      };
      setPeriodParams(defaultParams);
      fetchSalesEvolution(defaultParams);
      fetchVariantsPeriodStats(defaultParams);
    }
  }, [id]);

  const fetchProductData = async () => {
    setLoading(true);
    try {
      // Requête critique - doit réussir
      const productRes = await axios.get(`${API_URL}/products/${id}`);
      const productData = productRes.data.data;
      // Ajouter le champ effective_cost_price calculé
      productData.effective_cost_price = productData.cost_price_custom || productData.cost_price || productData.wc_cog_cost || 0;
      setProduct(productData);
      setNewCost(productData.cost_price_custom || productData.cost_price || productData.wc_cog_cost || '');

      // Requêtes optionnelles - peuvent échouer sans bloquer l'affichage
      try {
        const [
          familyRes,
          kpisRes,
          variantsStatsRes,
          dayOfWeekRes,
          hourRes,
          boughtWithRes,
          countryRes,
          customersRes,
          ordersRes
        ] = await Promise.all([
          axios.get(`${API_URL}/products/${id}/family`).catch(() => ({ data: { data: null } })),
          axios.get(`${API_URL}/products/${id}/stats/kpis`).catch(() => ({ data: { data: null } })),
          axios.get(`${API_URL}/products/${id}/stats/all-variants`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-day-of-week`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-hour`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/frequently-bought-with`, { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-country`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/top-customers`, { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/recent-orders`, { params: { limit: 20 } }).catch(() => ({ data: { data: [] } }))
        ]);

        setFamily(familyRes.data.data);
        setKpis(kpisRes.data.data);
        setVariantsStats(variantsStatsRes.data.data || []);
        setSalesByDayOfWeek(dayOfWeekRes.data.data || []);
        setSalesByHour(hourRes.data.data || []);
        setFrequentlyBought(boughtWithRes.data.data || []);
        setSalesByCountry(countryRes.data.data || []);
        setTopCustomers(customersRes.data.data || []);
        setRecentOrders(ordersRes.data.data || []);
      } catch (err) {
        console.error('Error fetching optional product data:', err);
      }
    } catch (err) {
      console.error('Error fetching product:', err);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchSalesEvolution = async (params, variantId = null) => {
    try {
      const queryParams = {
        groupBy: params.groupBy
      };
      // Ajouter les dates seulement si elles sont définies
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;
      if (variantId) queryParams.variantId = variantId;

      const response = await axios.get(`${API_URL}/products/${id}/stats/evolution`, {
        params: queryParams
      });
      if (response.data.success) {
        setSalesEvolution(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching sales evolution:', err);
      setSalesEvolution([]);
    }
  };

  const fetchVariantsPeriodStats = async (params) => {
    try {
      const queryParams = {};
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;

      const response = await axios.get(`${API_URL}/products/${id}/stats/variants-by-period`, {
        params: queryParams
      });
      if (response.data.success) {
        setVariantsPeriodStats(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching variants period stats:', err);
      setVariantsPeriodStats([]);
    }
  };

  const fetchComparisonEvolution = async (params) => {
    if (!params) {
      setComparisonEvolution(null);
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/products/${id}/stats/evolution`, {
        params: {
          groupBy: periodParams.groupBy,
          startDate: params.start,
          endDate: params.end
        }
      });
      if (response.data.success) {
        // Le profit est maintenant calculé côté backend avec la logique bundle
        setComparisonEvolution(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching comparison evolution:', err);
      setComparisonEvolution(null);
    }
  };

  const handlePeriodChange = (params) => {
    setPeriodParams(params);
    fetchSalesEvolution(params, selectedVariantId);
    fetchVariantsPeriodStats(params);
    fetchVariantsStats(params);
  };

  const fetchVariantsStats = async (params) => {
    try {
      const queryParams = {};
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;

      const response = await axios.get(`${API_URL}/products/${id}/stats/all-variants`, {
        params: queryParams
      });
      if (response.data.success) {
        setVariantsStats(response.data.data || []);
      }
    } catch (err) {
      console.error('Error fetching variants stats:', err);
    }
  };

  const handleComparisonChange = (params) => {
    fetchComparisonEvolution(params);
  };

  const handleVariantSelect = (variantId) => {
    setSelectedVariantId(variantId);
    fetchSalesEvolution(periodParams, variantId);
  };

  const handleSaveCost = async () => {
    if (!newCost || isNaN(newCost)) {
      alert('Veuillez entrer un coût valide');
      return;
    }

    try {
      await axios.put(`${API_URL}/products/${id}/cost`, {
        cost_price_custom: parseFloat(newCost)
      });
      alert('Coût mis à jour avec succès !');
      setEditingCost(false);
      fetchProductData();
    } catch (err) {
      console.error('Error updating cost:', err);
      alert('Erreur lors de la mise à jour du coût');
    }
  };

  const formatCurrency = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const formatNumber = (value) => new Intl.NumberFormat('fr-FR').format(value);
  const formatDate = (dateString) => formatDateUtil(dateString, { time: false });

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
          <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>Produit introuvable</div>
          <button onClick={() => navigate('/stats')} style={{ padding: '10px 20px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            ← Retour
          </button>
        </div>
      </div>
    );
  }

  const hasVariants = family && family.variants && family.variants.length > 0;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button onClick={() => navigate('/stats')} style={{ position: 'absolute', left: '20px', padding: '10px 20px', backgroundColor: '#fff', color: '#135E84', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>
          ← Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1600px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Product Info Header */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px', display: 'grid', gridTemplateColumns: '150px 1fr', gap: '30px' }}>
          <div>
            {product.image_url && <img src={product.image_url} alt={product.post_title} style={{ width: '100%', borderRadius: '8px', border: '1px solid #e0e0e0' }} />}
          </div>
          <div>
            <h1 style={{ margin: '0 0 10px 0', color: '#135E84' }}>{product.post_title}</h1>
            {(product.brand || product.sub_brand) && (
              <div style={{ fontSize: '14px', color: '#888', marginBottom: '8px' }}>
                {product.brand && (
                  <span
                    onClick={() => navigate(`/brands/${encodeURIComponent(product.brand)}`)}
                    style={{ fontWeight: '600', cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}
                  >
                    {product.brand}
                  </span>
                )}
                {product.sub_brand && (
                  <>
                    <span style={{ color: '#888' }}> / </span>
                    <span
                      onClick={() => navigate(`/sub-brands/${encodeURIComponent(product.sub_brand)}`)}
                      style={{ cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}
                    >
                      {product.sub_brand}
                    </span>
                  </>
                )}
              </div>
            )}
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
              SKU:{' '}
              {product.sku ? (
                <>
                  <a
                    href={`https://www.youvape.fr/wp-admin/post.php?post=${id}&action=edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#135E84', textDecoration: 'none' }}
                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                  >
                    {product.sku}
                  </a>
                  <CopyButton text={product.sku} />
                </>
              ) : '-'}
            </div>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#666' }}>Prix de vente</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(product.price)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#666' }}>Coût</div>
                {editingCost ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input type="number" step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} style={{ padding: '5px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', width: '100px' }} />
                    <button onClick={handleSaveCost} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>✓</button>
                    <button onClick={() => setEditingCost(false)} style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#fd7e14' }}>{formatCurrency(product.effective_cost_price || 0)}</div>
                    <button onClick={() => setEditingCost(true)} style={{ padding: '5px 10px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Modifier</button>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#666' }}>Stock</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: (product.stock || 0) > 0 ? '#28a745' : '#dc3545' }}>{formatNumber(product.stock || 0)}</div>
              </div>
            </div>
            {(product.category || product.sub_category) && (
              <div style={{ fontSize: '14px', color: '#666' }}>
                Categorie:{' '}
                {product.category && (
                  <span
                    onClick={() => navigate(`/categories/${encodeURIComponent(product.category)}`)}
                    style={{ fontWeight: '600', cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}
                  >
                    {product.category}
                  </span>
                )}
                {product.sub_category && (
                  <>
                    <span style={{ color: '#888' }}> / </span>
                    <span
                      onClick={() => navigate(`/sub-categories/${encodeURIComponent(product.sub_category)}`)}
                      style={{ cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}
                    >
                      {product.sub_category}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        {kpis && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
            {[
              { label: 'Quantité vendue', value: formatNumber(kpis.net_sold || 0), color: '#135E84' },
              { label: 'Chiffre d\'affaires', value: formatCurrency(kpis.net_revenue || 0), color: '#28a745' },
              { label: 'Nombre de commandes', value: formatNumber(kpis.net_orders || 0), color: '#8b5cf6' },
              { label: 'Coût', value: formatCurrency(kpis.total_cost || 0), color: '#fd7e14' },
              { label: 'Profit', value: formatCurrency(kpis.profit || 0), color: '#007bff' },
              { label: 'Marge', value: `${(kpis.margin_percent || 0).toFixed(1)}%`, color: '#ff6b6b' }
            ].map((kpi, i) => (
              <div key={i} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>{kpi.label}</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: kpi.color }}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Stats text */}
        {kpis && (
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px', fontSize: '14px', color: '#666', textAlign: 'center' }}>
            À partir de <strong>{formatNumber(kpis.net_orders || 0)} commandes</strong>. En moyenne, les clients commandent <strong>{parseFloat(kpis.avg_quantity_per_order || 0).toFixed(1)}</strong> unités de ce produit par commande.
          </div>
        )}

        {/* Graphique d'évolution des ventes */}
        <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '20px' }}>
            <h2 style={{ margin: 0, color: '#333', fontSize: '18px' }}>📈 Évolution des ventes</h2>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <PeriodFilter
                onPeriodChange={handlePeriodChange}
                onComparisonChange={handleComparisonChange}
                defaultPeriod="all"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: variantsPeriodStats.length > 0 ? '250px 1fr' : '1fr', gap: '20px' }}>
            {/* Panneau des variations à gauche */}
            {variantsPeriodStats.length > 0 && (
              <div style={{ borderRight: '1px solid #e0e0e0', paddingRight: '20px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#666', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Variations ({variantsPeriodStats.length})</span>
                </div>

                {/* Option "Toutes" */}
                <div
                  onClick={() => handleVariantSelect(null)}
                  style={{
                    padding: '10px 12px',
                    marginBottom: '4px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: selectedVariantId === null ? '#135E84' : '#f8f9fa',
                    color: selectedVariantId === null ? 'white' : '#333',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontWeight: '600', fontSize: '13px' }}>Toutes les variations</div>
                  <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.8 }}>
                    {variantsPeriodStats.reduce((sum, v) => sum + (v.quantity_sold || 0), 0)} vendues
                  </div>
                </div>

                {/* Liste des variations */}
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                  {variantsPeriodStats.map((variant) => (
                    <div
                      key={variant.wp_product_id}
                      onClick={() => handleVariantSelect(variant.wp_product_id)}
                      style={{
                        padding: '10px 12px',
                        marginBottom: '4px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        backgroundColor: selectedVariantId === variant.wp_product_id ? '#135E84' : 'transparent',
                        color: selectedVariantId === variant.wp_product_id ? 'white' : '#333',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedVariantId !== variant.wp_product_id) {
                          e.currentTarget.style.backgroundColor = '#f0f0f0';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedVariantId !== variant.wp_product_id) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <div style={{ fontWeight: '500', fontSize: '13px', marginBottom: '4px' }}>
                        {variant.post_title?.replace(product?.post_title + ' - ', '').replace(product?.post_title + ' – ', '') || variant.sku}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', opacity: 0.8 }}>
                        <span>{variant.quantity_sold || 0} vendues</span>
                        <span style={{ color: selectedVariantId === variant.wp_product_id ? 'white' : (variant.stock > 0 ? '#28a745' : '#dc3545') }}>
                          Stock: {variant.stock || 0}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Graphique */}
            <div>
              {salesEvolution.length > 0 ? (
                <AdvancedSalesChart
                  data={salesEvolution}
                  comparisonData={comparisonEvolution}
                  height={450}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                  Aucune donnée disponible pour cette période
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Variations */}
        {variantsStats.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📦 Variations ({variantsStats.length})</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Variante</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>SKU</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Prix</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Stock</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Qté vendue</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Chiffre d'affaires</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Commandes</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Profit</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {variantsStats.map((variant) => (
                    <tr key={variant.wp_product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px' }}>{variant.post_title}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontSize: '13px', color: '#666' }}>
                        {variant.sku}
                        {variant.sku && <CopyButton text={variant.sku} size={12} />}
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(variant.price)}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: variant.stock > 0 ? '#28a745' : '#dc3545' }}>{formatNumber(variant.stock || 0)}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: '#135E84' }}>{formatNumber(variant.net_sold || 0)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(variant.net_revenue || 0)}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600' }}>{formatNumber(variant.net_orders || 0)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600', color: '#007bff' }}>{formatCurrency(variant.profit || 0)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600', color: '#ff6b6b' }}>{parseFloat(variant.margin_percent || 0).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sales by Day & Hour */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Sales by Day of Week */}
          {salesByDayOfWeek.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📅 Ventes par jour de la semaine</h2>
              <SalesByDayOfWeekChart data={salesByDayOfWeek} height={350} />
            </div>
          )}

          {/* Sales by Hour */}
          {salesByHour.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🕐 Ventes par heure</h2>
              <SalesByHourChart data={salesByHour} height={300} />
            </div>
          )}
        </div>

        {/* Sales by Country */}
        {salesByCountry.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🌍 Ventes par pays</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
              {/* Pie Chart */}
              <div>
                <SalesByCountryPieChart data={salesByCountry} height={350} />
              </div>
              {/* Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Pays</th>
                      <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Qté vendue</th>
                      <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>CA</th>
                      <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesByCountry.slice(0, 8).map((country) => (
                      <tr key={country.shipping_country} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '12px', fontWeight: '600' }}>{country.shipping_country}</td>
                        <td style={{ textAlign: 'center', padding: '12px' }}>{formatNumber(country.net_sold)}</td>
                        <td style={{ textAlign: 'right', padding: '12px', color: '#28a745', fontWeight: '600' }}>{formatCurrency(country.net_revenue)}</td>
                        <td style={{ textAlign: 'right', padding: '12px', color: '#007bff', fontWeight: '600' }}>{formatCurrency(country.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Frequently Bought With */}
        {frequentlyBought.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🛍️ Fréquemment acheté avec</h2>
            <div>
              {frequentlyBought.slice(0, 5).map((item) => (
                <div key={item.wp_product_id} onClick={() => navigate(`/products/${item.wp_product_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div style={{ fontWeight: '600' }}>{item.post_title}</div>
                  <div style={{ fontSize: '13px', color: '#999' }}>{item.times_bought_together} fois</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Product Metadata & Attributes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Attributes */}
          {product.attributes && Object.keys(product.attributes).length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🔧 Attributs techniques</h2>
              <div>
                {Object.entries(product.attributes).map(([key, values]) => (
                  <div key={key} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>{key.replace('pa_', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{Array.isArray(values) ? values.join(', ') : values}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {product.meta_data && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📋 Informations produit</h2>
              <div>
                {product.meta_data.total_sales && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Ventes totales (WooCommerce)</div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#135E84' }}>{formatNumber(product.meta_data.total_sales)}</div>
                  </div>
                )}
                {product.meta_data.doofinder_discount_percentage && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Réduction</div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#dc3545' }}>{product.meta_data.doofinder_discount_percentage}%</div>
                  </div>
                )}
                {product.meta_data.cwg_total_subscribers && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Abonnés</div>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{product.meta_data.cwg_total_subscribers}</div>
                  </div>
                )}
                {product.meta_data.product_with_nicotine !== undefined && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Contient de la nicotine</div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: product.meta_data.product_with_nicotine === '1' ? '#dc3545' : '#28a745' }}>
                      {product.meta_data.product_with_nicotine === '1' ? 'Oui' : 'Non'}
                    </div>
                  </div>
                )}
                {product.dimensions && product.dimensions.weight && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Poids</div>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{product.dimensions.weight} kg</div>
                  </div>
                )}
                {product.type && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Type</div>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{product.type}</div>
                  </div>
                )}
                {product.status && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Statut</div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: product.status === 'publish' ? '#28a745' : '#ffc107' }}>{product.status}</div>
                  </div>
                )}
                {product.featured !== undefined && (
                  <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#666', fontSize: '14px' }}>Produit vedette</div>
                    <div style={{ fontWeight: '600', fontSize: '14px' }}>{product.featured ? '⭐ Oui' : 'Non'}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Product Tip */}
        {product.meta_data && product.meta_data.product_tip && (
          <div style={{ backgroundColor: '#fff3cd', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px', borderLeft: '4px solid #ffc107' }}>
            <h3 style={{ marginTop: 0, color: '#856404', fontSize: '16px' }}>💡 Conseil produit</h3>
            <p style={{ margin: 0, color: '#856404', fontSize: '14px' }}>{product.meta_data.product_tip}</p>
          </div>
        )}

        {/* Short Description */}
        {product.short_description && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📝 Description</h2>
            <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.6' }} dangerouslySetInnerHTML={{ __html: product.short_description }} />
          </div>
        )}

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🏷️ Tags</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {product.tags.map((tag) => (
                <span key={tag.id} style={{ padding: '6px 12px', backgroundColor: '#f0f0f0', borderRadius: '20px', fontSize: '13px', color: '#666' }}>
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Top Customers */}
          {topCustomers.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>👥 Meilleurs clients</h2>
              {topCustomers.slice(0, 5).map((customer) => (
                <div key={customer.wp_user_id} onClick={() => navigate(`/customers/${customer.wp_user_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div>
                    <div style={{ fontWeight: '600' }}>{customer.first_name} {customer.last_name}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{customer.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#135E84' }}>{formatNumber(customer.quantity_bought)} unités</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{formatCurrency(customer.total_spent)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Orders */}
          {recentOrders.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📋 Commandes récentes</h2>
              {recentOrders.slice(0, 5).map((order) => (
                <div key={order.wp_order_id} onClick={() => navigate(`/orders/${order.wp_order_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div>
                    <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      #{order.order_number}
                      <CopyButton text={String(order.order_number)} size={12} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{order.first_name} {order.last_name} • {order.shipping_country}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#28a745' }}>{formatCurrency(order.order_total)}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{formatDate(order.post_date)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white' }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default ProductDetail;
