import { useState, useEffect, useContext } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import AdvancedSalesChart from '../components/charts/AdvancedSalesChart';
import { formatDate as formatDateUtil } from '../utils/dateUtils';
import SalesByDayOfWeekChart from '../components/charts/SalesByDayOfWeekChart';
import SalesByHourChart from '../components/charts/SalesByHourChart';
import SalesByCountryPieChart from '../components/charts/SalesByCountryPieChart';
import PeriodFilter from '../components/PeriodFilter';
import CopyButton from '../components/CopyButton';
import { formatPrice } from '../utils/formatNumber';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductDetail = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const { id } = useParams();
  const headers = { Authorization: `Bearer ${token}` };

  // Active tab
  const [activeTab, setActiveTab] = useState('stats');

  // Product
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingCost, setEditingCost] = useState(false);
  const [newCost, setNewCost] = useState('');

  // Stats tab
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
  const [periodParams, setPeriodParams] = useState({ start: null, end: null, groupBy: 'day' });
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [variantsPeriodStats, setVariantsPeriodStats] = useState([]);

  // Needs tab
  const [needs, setNeeds] = useState(null);
  const [needsLoaded, setNeedsLoaded] = useState(false);
  const [variationsNeeds, setVariationsNeeds] = useState([]);

  // Barcodes tab
  const [barcodes, setBarcodes] = useState([]);
  const [barcodesLoaded, setBarcodesLoaded] = useState(false);
  const [newBarcode, setNewBarcode] = useState({ unit: '', pack: '' });
  const [newPackQty, setNewPackQty] = useState('');
  const [variationsBarcodes, setVariationsBarcodes] = useState([]);
  const [newVarBarcode, setNewVarBarcode] = useState({});
  const [newVarPackQty, setNewVarPackQty] = useState({});

  // Suppliers tab
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [expandedSupplier, setExpandedSupplier] = useState(null);
  const [supplierHistory, setSupplierHistory] = useState({});
  const [editingSupplier, setEditingSupplier] = useState({});
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState('');
  const [saving, setSaving] = useState(false);

  // ==================== FETCH FUNCTIONS ====================

  useEffect(() => {
    if (id) {
      const now = new Date();
      const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const defaultParams = { start: startOfMonth, end: today, groupBy: 'day' };
      setPeriodParams(defaultParams);
      fetchProductData(defaultParams);
      fetchSalesEvolution(defaultParams);
      fetchVariantsPeriodStats(defaultParams);
    }
  }, [id]);

  const fetchProductData = async (dateParams = null) => {
    setLoading(true);
    try {
      const productRes = await axios.get(`${API_URL}/products/${id}`);
      const productData = productRes.data.data;

      // Redirect variation to parent
      if (productData.product_type === 'variation' && productData.wp_parent_id) {
        navigate(`/products/${productData.wp_parent_id}`, { replace: true });
        return;
      }

      productData.effective_cost_price = productData.cost_price_custom || productData.cost_price || productData.wc_cog_cost || 0;
      setProduct(productData);
      setNewCost(productData.cost_price_custom || productData.cost_price || productData.wc_cog_cost || '');

      const kpiParams = {};
      if (dateParams?.start) kpiParams.startDate = dateParams.start;
      if (dateParams?.end) kpiParams.endDate = dateParams.end;

      try {
        const [kpisRes, variantsStatsRes, dayOfWeekRes, hourRes, boughtWithRes, countryRes, customersRes, ordersRes] = await Promise.all([
          axios.get(`${API_URL}/products/${id}/stats/kpis`, { params: kpiParams }).catch(() => ({ data: { data: null } })),
          axios.get(`${API_URL}/products/${id}/stats/all-variants`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-day-of-week`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-hour`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/frequently-bought-with`, { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/by-country`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/top-customers`, { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/products/${id}/stats/recent-orders`, { params: { limit: 20 } }).catch(() => ({ data: { data: [] } }))
        ]);
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
      const queryParams = { groupBy: params.groupBy };
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;
      if (variantId) queryParams.variantId = variantId;
      const response = await axios.get(`${API_URL}/products/${id}/stats/evolution`, { params: queryParams });
      if (response.data.success) setSalesEvolution(response.data.data);
    } catch (err) {
      setSalesEvolution([]);
    }
  };

  const fetchVariantsPeriodStats = async (params) => {
    try {
      const queryParams = {};
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;
      const response = await axios.get(`${API_URL}/products/${id}/stats/variants-by-period`, { params: queryParams });
      if (response.data.success) setVariantsPeriodStats(response.data.data);
    } catch (err) {
      setVariantsPeriodStats([]);
    }
  };

  const fetchComparisonEvolution = async (params) => {
    if (!params) { setComparisonEvolution(null); return; }
    try {
      const response = await axios.get(`${API_URL}/products/${id}/stats/evolution`, {
        params: { groupBy: periodParams.groupBy, startDate: params.start, endDate: params.end }
      });
      if (response.data.success) setComparisonEvolution(response.data.data);
    } catch (err) {
      setComparisonEvolution(null);
    }
  };

  const fetchVariantsStats = async (params) => {
    try {
      const queryParams = {};
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;
      const response = await axios.get(`${API_URL}/products/${id}/stats/all-variants`, { params: queryParams });
      if (response.data.success) setVariantsStats(response.data.data || []);
    } catch (err) {}
  };

  // Lazy fetch for Needs tab
  const fetchNeeds = async () => {
    if (needsLoaded || !product) return;
    try {
      if (product.product_type === 'variable') {
        const res = await axios.get(`${API_URL}/products/${id}/variations-needs`, { headers });
        if (res.data.success) setVariationsNeeds(res.data.data || []);
      } else {
        const res = await axios.get(`${API_URL}/purchases/needs/${product.wp_product_id}`, { headers });
        if (res.data?.data) setNeeds(res.data.data);
      }
    } catch (e) {}
    setNeedsLoaded(true);
  };

  // Lazy fetch for Barcodes tab
  const fetchBarcodes = async () => {
    if (barcodesLoaded) return;
    try {
      if (product?.product_type === 'variable') {
        const res = await axios.get(`${API_URL}/products/${id}/variations-barcodes`, { headers });
        if (res.data.success) setVariationsBarcodes(res.data.data || []);
      } else {
        const res = await axios.get(`${API_URL}/products/${id}/barcodes`, { headers });
        if (res.data.success) setBarcodes(res.data.data || []);
      }
    } catch (e) {}
    setBarcodesLoaded(true);
  };

  // Lazy fetch for Suppliers tab
  const fetchSuppliers = async () => {
    if (suppliersLoaded) return;
    try {
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (e) {}
    setSuppliersLoaded(true);
  };

  const fetchAllSuppliers = async () => {
    try {
      const res = await axios.get(`${API_URL}/purchases/suppliers`, { headers });
      if (res.data.success) setAllSuppliers(res.data.data);
    } catch (err) {}
  };

  const fetchSupplierHistory = async (supplierId) => {
    try {
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers/${supplierId}/history`, { headers });
      if (res.data.success) setSupplierHistory(prev => ({ ...prev, [supplierId]: res.data.data }));
    } catch (err) {}
  };

  // ==================== HANDLERS ====================

  const fetchKpis = async (params) => {
    try {
      const queryParams = {};
      if (params.start) queryParams.startDate = params.start;
      if (params.end) queryParams.endDate = params.end;
      const res = await axios.get(`${API_URL}/products/${id}/stats/kpis`, { params: queryParams });
      if (res.data.success) setKpis(res.data.data);
    } catch (err) {}
  };

  const handlePeriodChange = (params) => {
    setPeriodParams(params);
    fetchKpis(params);
    fetchSalesEvolution(params, selectedVariantId);
    fetchVariantsPeriodStats(params);
    fetchVariantsStats(params);
  };

  const handleComparisonChange = (params) => fetchComparisonEvolution(params);

  const handleVariantSelect = (variantId) => {
    setSelectedVariantId(variantId);
    fetchSalesEvolution(periodParams, variantId);
  };

  const handleSaveCost = async () => {
    if (!newCost || isNaN(newCost)) { alert('Veuillez entrer un cout valide'); return; }
    try {
      await axios.put(`${API_URL}/products/${id}/cost`, { cost_price_custom: parseFloat(newCost) });
      alert('Cout mis a jour avec succes !');
      setEditingCost(false);
      fetchProductData();
    } catch (err) {
      alert('Erreur lors de la mise a jour du cout');
    }
  };

  // Barcodes handlers
  const handleAddBarcode = async (type) => {
    const value = newBarcode[type]?.trim();
    if (!value) return;
    try {
      const body = { barcode: value, type };
      if (type === 'pack' && newPackQty) body.quantity = parseInt(newPackQty);
      const res = await axios.post(`${API_URL}/products/${id}/barcodes`, body, { headers });
      if (res.data.success) {
        setBarcodes(prev => [...prev, res.data.data]);
        setNewBarcode(prev => ({ ...prev, [type]: '' }));
        if (type === 'pack') setNewPackQty('');
      }
    } catch (err) {
      if (err.response?.status === 409) alert('Ce code-barre existe deja pour ce produit');
      else alert('Erreur lors de l\'ajout');
    }
  };

  const handleDeleteBarcode = async (barcodeId) => {
    try {
      await axios.delete(`${API_URL}/products/${id}/barcodes/${barcodeId}`, { headers });
      setBarcodes(prev => prev.filter(b => b.id !== barcodeId));
    } catch (err) {}
  };

  // Variation barcode handlers
  const handleAddVarBarcode = async (varWpId, type) => {
    const key = `${varWpId}_${type}`;
    const value = newVarBarcode[key]?.trim();
    if (!value) return;
    try {
      const body = { barcode: value, type };
      if (type === 'pack' && newVarPackQty[varWpId]) body.quantity = parseInt(newVarPackQty[varWpId]);
      const res = await axios.post(`${API_URL}/products/${varWpId}/barcodes`, body, { headers });
      if (res.data.success) {
        setVariationsBarcodes(prev => prev.map(v =>
          v.wp_product_id === varWpId ? { ...v, barcodes: [...v.barcodes, res.data.data] } : v
        ));
        setNewVarBarcode(prev => ({ ...prev, [key]: '' }));
        if (type === 'pack') setNewVarPackQty(prev => ({ ...prev, [varWpId]: '' }));
      }
    } catch (err) {
      if (err.response?.status === 409) alert('Ce code-barre existe deja pour ce produit');
      else alert('Erreur lors de l\'ajout');
    }
  };

  const handleDeleteVarBarcode = async (varWpId, barcodeId) => {
    try {
      await axios.delete(`${API_URL}/products/${varWpId}/barcodes/${barcodeId}`, { headers });
      setVariationsBarcodes(prev => prev.map(v =>
        v.wp_product_id === varWpId ? { ...v, barcodes: v.barcodes.filter(b => b.id !== barcodeId) } : v
      ));
    } catch (err) {}
  };

  const handleFetchVarBms = async (varWpId) => {
    try {
      const res = await axios.post(`${API_URL}/products/${varWpId}/barcodes/fetch-bms`, {}, { headers });
      if (res.data.data) {
        setVariationsBarcodes(prev => prev.map(v =>
          v.wp_product_id === varWpId ? { ...v, barcodes: [...v.barcodes, res.data.data] } : v
        ));
        alert(res.data.message);
      } else {
        alert(res.data.message || 'Aucun code-barre trouve dans BMS');
      }
    } catch (err) {
      alert('Erreur lors de la recuperation BMS');
    }
  };

  // Suppliers handlers
  const handleToggleExpand = (supplierId) => {
    if (expandedSupplier === supplierId) { setExpandedSupplier(null); return; }
    setExpandedSupplier(supplierId);
    if (!supplierHistory[supplierId]) fetchSupplierHistory(supplierId);
  };

  const handleEditChange = (supplierId, field, value) => {
    setEditingSupplier(prev => ({ ...prev, [supplierId]: { ...(prev[supplierId] || {}), [field]: value } }));
  };

  const handleSaveSupplier = async (supplierId) => {
    const data = editingSupplier[supplierId];
    if (!data) return;
    setSaving(true);
    try {
      await axios.put(`${API_URL}/purchases/suppliers/${supplierId}/products/${id}`, data, { headers });
      setEditingSupplier(prev => { const n = { ...prev }; delete n[supplierId]; return n; });
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSupplier = async (supplierId, supplierName) => {
    if (!confirm(`Retirer ${supplierName} de ce produit ?`)) return;
    try {
      await axios.delete(`${API_URL}/purchases/suppliers/${supplierId}/products/${id}`, { headers });
      setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    } catch (err) {
      alert('Erreur lors de la suppression');
    }
  };

  const handleSetPrimary = async (supplierId) => {
    try {
      await axios.put(`${API_URL}/purchases/products/${id}/primary-supplier`, { supplier_id: supplierId }, { headers });
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {}
  };

  const handleAddSupplier = async () => {
    if (!newSupplierId) return;
    try {
      await axios.post(`${API_URL}/purchases/suppliers/${newSupplierId}/products`, {
        product_id: parseInt(id), is_primary: suppliers.length === 0
      }, { headers });
      setAddingSupplier(false);
      setNewSupplierId('');
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {
      alert('Erreur lors de l\'ajout');
    }
  };

  const getEditValue = (supplier, field) => {
    if (editingSupplier[supplier.id] && editingSupplier[supplier.id][field] !== undefined) return editingSupplier[supplier.id][field];
    return supplier[field] ?? '';
  };

  // Tab switching with lazy load
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'needs') fetchNeeds();
    if (tab === 'barcodes') fetchBarcodes();
    if (tab === 'suppliers') { fetchSuppliers(); if (allSuppliers.length === 0) fetchAllSuppliers(); }
  };

  // ==================== FORMATTERS ====================

  const formatCurrency = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const formatNumber = (value) => new Intl.NumberFormat('fr-FR').format(value);
  const formatDate = (dateString) => formatDateUtil(dateString, { time: false });
  const formatDateSimple = (dateStr) => {
    if (!dateStr) return '-';
    const d = dateStr.substring(0, 10).split('-');
    return `${d[2]}/${d[1]}/${d[0]}`;
  };

  const statusLabels = {
    draft: 'Brouillon', sent: 'Envoyee', confirmed: 'Attendu',
    shipped: 'Expediee', partial: 'Partielle', received: 'Recue', cancelled: 'Annulee'
  };

  // Metorik URL builder
  const getMetorikUrl = () => {
    if (!product?.sku) return null;
    if (product.product_type === 'variation' && product.sku.includes('-')) {
      const [parentSku, varSku] = product.sku.split('-');
      return `https://app.metorik.com/products/${parentSku}?variation=${varSku}`;
    }
    return `https://app.metorik.com/products/${product.sku}`;
  };

  // ==================== STYLES ====================

  const tabStyle = (tab) => ({
    padding: '10px 24px',
    border: 'none',
    borderBottom: activeTab === tab ? '3px solid #135E84' : '3px solid transparent',
    backgroundColor: 'transparent',
    color: activeTab === tab ? '#135E84' : '#6b7280',
    fontWeight: activeTab === tab ? '600' : '400',
    fontSize: '15px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  });

  const cardStyle = {
    backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    padding: '25px', marginBottom: '30px'
  };

  // ==================== LOADING / ERROR ====================

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
    </div>
  );

  if (!product) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>Produit introuvable</div>
        <button onClick={() => navigate(-1)} style={{ padding: '10px 20px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Retour</button>
      </div>
    </div>
  );


  const metorikUrl = getMetorikUrl();

  // ==================== RENDER ====================

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button onClick={() => navigate(-1)} style={{ position: 'absolute', left: '20px', padding: '10px 20px', backgroundColor: '#fff', color: '#135E84', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>
          Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1600px', margin: '30px auto', padding: '0 20px', width: '100%' }}>

        {/* ==================== PRODUCT HEADER ==================== */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '20px', display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: '30px' }}>
          <div>
            {product.image_url ? (
              <img src={product.image_url} alt={product.post_title} style={{ width: '100%', borderRadius: '8px', border: '1px solid #e0e0e0' }} />
            ) : (
              <div style={{ width: '150px', height: '150px', backgroundColor: '#e5e7eb', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '32px' }}>?</div>
            )}
          </div>
          <div>
            <h1 style={{ margin: '0 0 10px 0', color: '#135E84' }}>{product.post_title}</h1>
            {(product.brand || product.sub_brand) && (
              <div style={{ fontSize: '14px', color: '#888', marginBottom: '8px' }}>
                {product.brand && (
                  <span onClick={() => navigate(`/brands/${encodeURIComponent(product.brand)}`)} style={{ fontWeight: '600', cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}>
                    {product.brand}
                  </span>
                )}
                {product.sub_brand && (
                  <>
                    <span style={{ color: '#888' }}> / </span>
                    <span onClick={() => navigate(`/sub-brands/${encodeURIComponent(product.sub_brand)}`)} style={{ cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}>
                      {product.sub_brand}
                    </span>
                  </>
                )}
              </div>
            )}
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              SKU:{' '}
              {product.sku ? (
                <>
                  <a href={`https://www.youvape.fr/wp-admin/post.php?post=${id}&action=edit`} target="_blank" rel="noopener noreferrer" style={{ color: '#135E84', textDecoration: 'none' }} onMouseEnter={(e) => e.target.style.textDecoration = 'underline'} onMouseLeave={(e) => e.target.style.textDecoration = 'none'}>
                    {product.sku}
                  </a>
                  <CopyButton text={product.sku} />
                  {metorikUrl && (
                    <a href={metorikUrl} target="_blank" rel="noopener noreferrer" title="Voir sur Metorik" style={{ display: 'inline-flex', opacity: 0.7 }} onMouseOver={e => e.currentTarget.style.opacity = 1} onMouseOut={e => e.currentTarget.style.opacity = 0.7}>
                      <img src="https://metorik.com/img/brand/logo-icon.png" alt="Metorik" style={{ width: '18px', height: '18px' }} />
                    </a>
                  )}
                </>
              ) : '-'}
            </div>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#666' }}>Prix de vente</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(product.price)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#666' }}>Cout</div>
                {editingCost ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input type="number" step="0.01" value={newCost} onChange={(e) => setNewCost(e.target.value)} style={{ padding: '5px', fontSize: '16px', border: '1px solid #ccc', borderRadius: '4px', width: '100px' }} />
                    <button onClick={handleSaveCost} style={{ padding: '5px 10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>OK</button>
                    <button onClick={() => setEditingCost(false)} style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>X</button>
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
                  <span onClick={() => navigate(`/categories/${encodeURIComponent(product.category)}`)} style={{ fontWeight: '600', cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}>
                    {product.category}
                  </span>
                )}
                {product.sub_category && (
                  <>
                    <span style={{ color: '#888' }}> / </span>
                    <span onClick={() => navigate(`/sub-categories/${encodeURIComponent(product.sub_category)}`)} style={{ cursor: 'pointer', color: '#135E84', textDecoration: 'underline' }}>
                      {product.sub_category}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <button
              onClick={async () => {
                try {
                  const res = await axios.patch(`${API_URL}/products/${id}/exclude-reorder`);
                  const newVal = res.data.data.exclude_from_reorder;
                  setProduct(prev => ({ ...prev, exclude_from_reorder: newVal }));
                  if (res.data.data.product_type === 'variable') {
                    setVariantsPeriodStats(prev => prev.map(v => ({ ...v, exclude_from_reorder: newVal })));
                  }
                } catch (err) {}
              }}
              style={{
                padding: '8px 16px', border: '1px solid',
                borderColor: product.exclude_from_reorder ? '#dc3545' : '#28a745',
                backgroundColor: product.exclude_from_reorder ? '#fff5f5' : '#f0fff4',
                color: product.exclude_from_reorder ? '#dc3545' : '#28a745',
                borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap'
              }}
            >
              {product.exclude_from_reorder ? 'Exclu du reassort' : 'Propose au reassort'}
            </button>
          </div>
        </div>

        {/* ==================== TABS ==================== */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '20px', backgroundColor: '#fff', borderRadius: '8px 8px 0 0', paddingLeft: '10px' }}>
          <button style={tabStyle('stats')} onClick={() => handleTabChange('stats')}>Stats</button>
          <button style={tabStyle('needs')} onClick={() => handleTabChange('needs')}>Besoins</button>
          <button style={tabStyle('barcodes')} onClick={() => handleTabChange('barcodes')}>Codes-barres</button>
          <button style={tabStyle('suppliers')} onClick={() => handleTabChange('suppliers')}>Fournisseurs</button>
        </div>

        {/* ==================== TAB: STATS ==================== */}
        {activeTab === 'stats' && (
          <div>
            {/* Period Filter */}
            <div style={{ marginBottom: '20px' }}>
              <PeriodFilter onPeriodChange={handlePeriodChange} onComparisonChange={handleComparisonChange} defaultPeriod="current_month" />
            </div>

            {/* KPIs */}
            {kpis && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
                {[
                  { label: 'Quantite vendue', value: formatNumber(kpis.net_sold || 0) },
                  { label: 'Chiffre d\'affaires', value: formatCurrency(kpis.net_revenue || 0) },
                  { label: 'Nombre de commandes', value: formatNumber(kpis.net_orders || 0) },
                  { label: 'Cout', value: formatCurrency(kpis.total_cost || 0) },
                  { label: 'Profit', value: formatCurrency(kpis.profit || 0) },
                  { label: 'Marge', value: `${(kpis.margin_percent || 0).toFixed(1)}%` }
                ].map((kpi, i) => (
                  <div key={i} style={{ ...cardStyle, padding: '20px', marginBottom: 0 }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>{kpi.label}</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#111827' }}>{kpi.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats text */}
            {kpis && (
              <div style={{ ...cardStyle, fontSize: '14px', color: '#666', textAlign: 'center' }}>
                A partir de <strong>{formatNumber(kpis.net_orders || 0)} commandes</strong>. En moyenne, les clients commandent <strong>{parseFloat(kpis.avg_quantity_per_order || 0).toFixed(1)}</strong> unites par commande.
              </div>
            )}

            {/* Sales Evolution Chart */}
            <div style={cardStyle}>
              <h2 style={{ margin: '0 0 20px 0', color: '#333', fontSize: '18px' }}>Evolution des ventes</h2>
              <div style={{ display: 'grid', gridTemplateColumns: variantsPeriodStats.length > 0 ? '250px 1fr' : '1fr', gap: '20px' }}>
                {variantsPeriodStats.length > 0 && (
                  <div style={{ borderRight: '1px solid #e0e0e0', paddingRight: '20px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#666', marginBottom: '12px' }}>
                      <span>Variations ({variantsPeriodStats.length})</span>
                    </div>
                    <div onClick={() => handleVariantSelect(null)} style={{ padding: '10px 12px', marginBottom: '4px', borderRadius: '6px', cursor: 'pointer', backgroundColor: selectedVariantId === null ? '#135E84' : '#f8f9fa', color: selectedVariantId === null ? 'white' : '#333', transition: 'all 0.2s' }}>
                      <div style={{ fontWeight: '600', fontSize: '13px' }}>Toutes les variations</div>
                      <div style={{ fontSize: '11px', marginTop: '2px', opacity: 0.8 }}>{variantsPeriodStats.reduce((sum, v) => sum + (v.quantity_sold || 0), 0)} vendues</div>
                    </div>
                    <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                      {variantsPeriodStats.map((variant) => (
                        <div key={variant.wp_product_id} onClick={() => handleVariantSelect(variant.wp_product_id)}
                          style={{ padding: '10px 12px', marginBottom: '4px', borderRadius: '6px', cursor: 'pointer', backgroundColor: selectedVariantId === variant.wp_product_id ? '#135E84' : 'transparent', color: selectedVariantId === variant.wp_product_id ? 'white' : '#333', transition: 'all 0.2s' }}
                          onMouseEnter={(e) => { if (selectedVariantId !== variant.wp_product_id) e.currentTarget.style.backgroundColor = '#f0f0f0'; }}
                          onMouseLeave={(e) => { if (selectedVariantId !== variant.wp_product_id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <div style={{ fontWeight: '500', fontSize: '13px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{variant.post_title?.replace(product?.post_title + ' - ', '').replace(product?.post_title + ' – ', '') || variant.sku}</span>
                            <span
                              title={variant.exclude_from_reorder ? 'Exclu du reassort (cliquer pour inclure)' : 'Propose au reassort (cliquer pour exclure)'}
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await axios.patch(`${API_URL}/products/${variant.wp_product_id}/exclude-reorder`);
                                  setVariantsPeriodStats(prev => prev.map(v => v.wp_product_id === variant.wp_product_id ? { ...v, exclude_from_reorder: res.data.data.exclude_from_reorder } : v));
                                } catch (err) {}
                              }}
                              style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: variant.exclude_from_reorder ? '#dc3545' : '#28a745', cursor: 'pointer', flexShrink: 0, marginLeft: '8px' }}
                            />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', opacity: 0.8 }}>
                            <span>{variant.quantity_sold || 0} vendues</span>
                            <span style={{ color: selectedVariantId === variant.wp_product_id ? 'white' : '#111827' }}>Stock: {variant.stock || 0}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  {salesEvolution.length > 0 ? (
                    <AdvancedSalesChart data={salesEvolution} comparisonData={comparisonEvolution} height={450} />
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>Aucune donnee disponible pour cette periode</div>
                  )}
                </div>
              </div>
            </div>

            {/* Variants Table */}
            {variantsStats.length > 0 && (
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Variations ({variantsStats.length})</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                        <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Variante</th>
                        <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>SKU</th>
                        <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Prix</th>
                        <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Stock</th>
                        <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Qte vendue</th>
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
                          <td style={{ textAlign: 'center', padding: '12px', fontSize: '13px', color: '#666' }}>{variant.sku}{variant.sku && <CopyButton text={variant.sku} size={12} />}</td>
                          <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(variant.price)}</td>
                          <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600' }}>{formatNumber(variant.stock || 0)}</td>
                          <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600' }}>{formatNumber(variant.net_sold || 0)}</td>
                          <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(variant.net_revenue || 0)}</td>
                          <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600' }}>{formatNumber(variant.net_orders || 0)}</td>
                          <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(variant.profit || 0)}</td>
                          <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{parseFloat(variant.margin_percent || 0).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sales by Day & Hour */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
              {salesByDayOfWeek.length > 0 && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Ventes par jour de la semaine</h2>
                  <SalesByDayOfWeekChart data={salesByDayOfWeek} height={350} />
                </div>
              )}
              {salesByHour.length > 0 && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Ventes par heure</h2>
                  <SalesByHourChart data={salesByHour} height={300} />
                </div>
              )}
            </div>

            {/* Sales by Country */}
            {salesByCountry.length > 0 && (
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Ventes par pays</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                  <div><SalesByCountryPieChart data={salesByCountry} height={350} /></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                          <th style={{ textAlign: 'left', padding: '12px' }}>Pays</th>
                          <th style={{ textAlign: 'center', padding: '12px' }}>Qte vendue</th>
                          <th style={{ textAlign: 'right', padding: '12px' }}>CA</th>
                          <th style={{ textAlign: 'right', padding: '12px' }}>Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesByCountry.slice(0, 8).map((country) => (
                          <tr key={country.shipping_country} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '12px', fontWeight: '600' }}>{country.shipping_country}</td>
                            <td style={{ textAlign: 'center', padding: '12px' }}>{formatNumber(country.net_sold)}</td>
                            <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(country.net_revenue)}</td>
                            <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(country.profit)}</td>
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
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Frequemment achete avec</h2>
                {frequentlyBought.slice(0, 5).map((item) => (
                  <div key={item.wp_product_id} onClick={() => navigate(`/products/${item.wp_product_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <div style={{ fontWeight: '600' }}>{item.post_title}</div>
                    <div style={{ fontSize: '13px', color: '#999' }}>{item.times_bought_together} fois</div>
                  </div>
                ))}
              </div>
            )}

            {/* Attributes & Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
              {product.attributes && Object.keys(product.attributes).length > 0 && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Attributs techniques</h2>
                  {Object.entries(product.attributes).map(([key, values]) => (
                    <div key={key} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666', fontSize: '14px' }}>{key.replace('pa_', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                      <div style={{ fontWeight: '600', fontSize: '14px' }}>{Array.isArray(values) ? values.join(', ') : values}</div>
                    </div>
                  ))}
                </div>
              )}
              {product.meta_data && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Informations produit</h2>
                  {product.meta_data.total_sales && (
                    <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666' }}>Ventes totales (WooCommerce)</div>
                      <div style={{ fontWeight: '600' }}>{formatNumber(product.meta_data.total_sales)}</div>
                    </div>
                  )}
                  {product.dimensions && product.dimensions.weight && (
                    <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666' }}>Poids</div>
                      <div style={{ fontWeight: '600' }}>{product.dimensions.weight} kg</div>
                    </div>
                  )}
                  {product.type && (
                    <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666' }}>Type</div>
                      <div style={{ fontWeight: '600' }}>{product.type}</div>
                    </div>
                  )}
                  {product.status && (
                    <div style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666' }}>Statut</div>
                      <div style={{ fontWeight: '600', color: product.status === 'publish' ? '#28a745' : '#ffc107' }}>{product.status}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Short Description */}
            {product.short_description && (
              <div style={cardStyle}>
                <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Description</h2>
                <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.6' }} dangerouslySetInnerHTML={{ __html: product.short_description }} />
              </div>
            )}

            {/* Top Customers & Recent Orders */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
              {topCustomers.length > 0 && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Meilleurs clients</h2>
                  {topCustomers.slice(0, 5).map((customer) => (
                    <div key={customer.wp_user_id} onClick={() => navigate(`/customers/${customer.wp_user_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <div>
                        <div style={{ fontWeight: '600' }}>{customer.first_name} {customer.last_name}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{customer.email}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '600' }}>{formatNumber(customer.quantity_bought)} unites</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{formatCurrency(customer.total_spent)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {recentOrders.length > 0 && (
                <div style={cardStyle}>
                  <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>Commandes recentes</h2>
                  {recentOrders.slice(0, 5).map((order) => (
                    <div key={order.wp_order_id} onClick={() => navigate(`/orders/${order.wp_order_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <div>
                        <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>#{order.order_number}<CopyButton text={String(order.order_number)} size={12} /></div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{order.first_name} {order.last_name} - {order.shipping_country}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '600' }}>{formatCurrency(order.order_total)}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{formatDate(order.post_date)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB: NEEDS ==================== */}
        {activeTab === 'needs' && (
          <div style={cardStyle}>
            {product.product_type === 'variable' ? (
              /* === VARIABLE: needs per variation === */
              <div>
                {variationsNeeds.length === 0 && needsLoaded && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>Aucune variation trouvee</div>
                )}
                {variationsNeeds.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Variation</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Stock</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Arrivages</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Ventes/mois</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Tendance</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Besoin theo.</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#6b7280', fontWeight: '600' }}>Besoin sup.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variationsNeeds.map(v => (
                        <tr key={v.wp_product_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: '500' }}>{v.post_title}</div>
                            <div style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'monospace' }}>{v.sku}</div>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '600', color: parseInt(v.stock) <= 0 ? '#ef4444' : '#111827' }}>
                            {parseInt(v.stock) || 0}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '600', color: v.incoming_qty > 0 ? '#059669' : '#6b7280' }}>
                            {v.incoming_qty || 0}
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>{v.avg_monthly_sales}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <span style={{ color: v.trend_direction === 'up' ? '#059669' : v.trend_direction === 'down' ? '#ef4444' : '#6b7280' }}>
                              {v.trend_coefficient}x {v.trend_direction === 'up' ? '↑' : v.trend_direction === 'down' ? '↓' : '→'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '600' }}>{v.theoretical_need}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: '600' }}>{v.supposed_need}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              /* === SIMPLE: existing needs layout === */
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Stock</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Arrivages prevus</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Besoin theorique</th>
                      <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Besoin suppose</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: parseInt(product.stock) <= 0 ? '#ef4444' : '#111827' }}>
                        {parseInt(product.stock) || 0}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: needs?.incoming_qty > 0 ? '#059669' : '#6b7280' }}>
                        {needs?.incoming_qty || 0}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
                        {needs?.theoretical_need ?? '-'}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
                        {needs?.supposed_need ?? '-'}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {needs && (
                  <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: '6px', fontSize: '13px', color: '#6b7280' }}>
                    Ventes moyennes/mois : <strong>{needs.avg_monthly_sales}</strong> |
                    Tendance : <strong>{needs.trend_coefficient}x</strong> ({needs.trend_direction === 'up' ? 'hausse' : needs.trend_direction === 'down' ? 'baisse' : 'stable'}) |
                    Max commande : <strong>{needs.max_order_qty_12m}</strong>
                  </div>
                )}
                {!needs && needsLoaded && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>Aucune donnee de besoin disponible</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB: BARCODES ==================== */}
        {activeTab === 'barcodes' && (
          <div style={cardStyle}>
            {product.product_type === 'variable' ? (
              /* === VARIABLE: barcodes per variation === */
              <div>
                {variationsBarcodes.length === 0 && barcodesLoaded && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280' }}>Aucune variation trouvee</div>
                )}
                {variationsBarcodes.map(v => {
                  const unitBarcodes = v.barcodes.filter(b => b.type === 'unit');
                  const packBarcodes = v.barcodes.filter(b => b.type === 'pack');
                  return (
                    <div key={v.wp_product_id} style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div>
                          <span style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{v.post_title}</span>
                          <span style={{ marginLeft: '10px', fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{v.sku}</span>
                        </div>
                        <button
                          onClick={() => handleFetchVarBms(v.wp_product_id)}
                          style={{ padding: '4px 10px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
                        >BMS</button>
                      </div>
                      <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                        {/* Unit */}
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '600' }}>Unite</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                            {unitBarcodes.map(b => (
                              <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', backgroundColor: '#f3f4f6', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}>
                                {b.barcode}
                                <button onClick={() => handleDeleteVarBarcode(v.wp_product_id, b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px', padding: '0 1px', lineHeight: 1 }}>&times;</button>
                              </span>
                            ))}
                            {unitBarcodes.length === 0 && <span style={{ fontSize: '12px', color: '#d1d5db' }}>-</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input type="text" value={newVarBarcode[`${v.wp_product_id}_unit`] || ''} onChange={(e) => setNewVarBarcode(prev => ({ ...prev, [`${v.wp_product_id}_unit`]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && handleAddVarBarcode(v.wp_product_id, 'unit')} placeholder="EAN..." style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', flex: 1 }} />
                            <button onClick={() => handleAddVarBarcode(v.wp_product_id, 'unit')} disabled={!newVarBarcode[`${v.wp_product_id}_unit`]?.trim()} style={{ padding: '4px 8px', backgroundColor: newVarBarcode[`${v.wp_product_id}_unit`]?.trim() ? '#135E84' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: newVarBarcode[`${v.wp_product_id}_unit`]?.trim() ? 'pointer' : 'not-allowed' }}>+</button>
                          </div>
                        </div>
                        {/* Pack */}
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: '600' }}>Pack</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                            {packBarcodes.map(b => (
                              <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', backgroundColor: '#fef3c7', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace', color: '#92400e' }}>
                                {b.barcode}{b.quantity ? ` (x${b.quantity})` : ''}
                                <button onClick={() => handleDeleteVarBarcode(v.wp_product_id, b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontSize: '13px', padding: '0 1px', lineHeight: 1 }}>&times;</button>
                              </span>
                            ))}
                            {packBarcodes.length === 0 && <span style={{ fontSize: '12px', color: '#d1d5db' }}>-</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input type="text" value={newVarBarcode[`${v.wp_product_id}_pack`] || ''} onChange={(e) => setNewVarBarcode(prev => ({ ...prev, [`${v.wp_product_id}_pack`]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && handleAddVarBarcode(v.wp_product_id, 'pack')} placeholder="EAN pack..." style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', flex: 1 }} />
                            <input type="number" value={newVarPackQty[v.wp_product_id] || ''} onChange={(e) => setNewVarPackQty(prev => ({ ...prev, [v.wp_product_id]: e.target.value }))} placeholder="Qte" min="1" style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', width: '55px' }} />
                            <button onClick={() => handleAddVarBarcode(v.wp_product_id, 'pack')} disabled={!newVarBarcode[`${v.wp_product_id}_pack`]?.trim()} style={{ padding: '4px 8px', backgroundColor: newVarBarcode[`${v.wp_product_id}_pack`]?.trim() ? '#f59e0b' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: newVarBarcode[`${v.wp_product_id}_pack`]?.trim() ? 'pointer' : 'not-allowed' }}>+</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* === SIMPLE: existing barcode layout === */
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                  <button
                    onClick={async () => {
                      try {
                        const res = await axios.post(`${API_URL}/products/${id}/barcodes/fetch-bms`, {}, { headers });
                        if (res.data.data) {
                          setBarcodes(prev => [...prev, res.data.data]);
                          alert(res.data.message);
                        } else {
                          alert(res.data.message || 'Aucun code-barre trouve dans BMS');
                        }
                      } catch (err) {
                        alert('Erreur lors de la recuperation BMS');
                      }
                    }}
                    style={{ padding: '6px 14px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}
                  >
                    Recuperer code-barre BMS
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '250px' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#374151' }}>Codes-barres unite</h4>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {barcodes.filter(b => b.type === 'unit').map(b => (
                        <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', backgroundColor: '#f3f4f6', borderRadius: '4px', fontSize: '13px', fontFamily: 'monospace', color: '#111827' }}>
                          {b.barcode}
                          <button onClick={() => handleDeleteBarcode(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '14px', padding: '0 2px', lineHeight: 1 }} title="Supprimer">&times;</button>
                        </span>
                      ))}
                      {barcodes.filter(b => b.type === 'unit').length === 0 && <span style={{ fontSize: '13px', color: '#9ca3af' }}>Aucun</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input type="text" value={newBarcode.unit} onChange={(e) => setNewBarcode(prev => ({ ...prev, unit: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && handleAddBarcode('unit')} placeholder="Ajouter un EAN..." style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', flex: 1 }} />
                      <button onClick={() => handleAddBarcode('unit')} disabled={!newBarcode.unit?.trim()} style={{ padding: '6px 12px', backgroundColor: newBarcode.unit?.trim() ? '#135E84' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: newBarcode.unit?.trim() ? 'pointer' : 'not-allowed' }}>+ Ajouter</button>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: '250px' }}>
                    <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#374151' }}>Codes-barres pack</h4>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {barcodes.filter(b => b.type === 'pack').map(b => (
                        <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', backgroundColor: '#fef3c7', borderRadius: '4px', fontSize: '13px', fontFamily: 'monospace', color: '#92400e' }}>
                          {b.barcode}{b.quantity ? ` (x${b.quantity})` : ''}
                          <button onClick={() => handleDeleteBarcode(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontSize: '14px', padding: '0 2px', lineHeight: 1 }} title="Supprimer">&times;</button>
                        </span>
                      ))}
                      {barcodes.filter(b => b.type === 'pack').length === 0 && <span style={{ fontSize: '13px', color: '#9ca3af' }}>Aucun</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input type="text" value={newBarcode.pack} onChange={(e) => setNewBarcode(prev => ({ ...prev, pack: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && handleAddBarcode('pack')} placeholder="EAN pack..." style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', flex: 1 }} />
                      <input type="number" value={newPackQty} onChange={(e) => setNewPackQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddBarcode('pack')} placeholder="Qte" min="1" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '70px' }} />
                      <button onClick={() => handleAddBarcode('pack')} disabled={!newBarcode.pack?.trim()} style={{ padding: '6px 12px', backgroundColor: newBarcode.pack?.trim() ? '#f59e0b' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: newBarcode.pack?.trim() ? 'pointer' : 'not-allowed' }}>+ Ajouter</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB: SUPPLIERS ==================== */}
        {activeTab === 'suppliers' && (
          <div>
            {!addingSupplier ? (
              <button onClick={() => { setAddingSupplier(true); if (allSuppliers.length === 0) fetchAllSuppliers(); }} style={{ padding: '8px 16px', backgroundColor: '#135E84', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '16px' }}>
                + Ajouter un fournisseur
              </button>
            ) : (
              <div style={{ ...cardStyle, display: 'flex', gap: '12px', alignItems: 'center' }}>
                <select value={newSupplierId} onChange={(e) => setNewSupplierId(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', flex: 1 }}>
                  <option value="">Selectionner un fournisseur...</option>
                  {allSuppliers.filter(s => !suppliers.find(ps => ps.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={handleAddSupplier} disabled={!newSupplierId} style={{ padding: '8px 16px', backgroundColor: newSupplierId ? '#135E84' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: newSupplierId ? 'pointer' : 'not-allowed' }}>Ajouter</button>
                <button onClick={() => { setAddingSupplier(false); setNewSupplierId(''); }} style={{ padding: '8px 16px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Annuler</button>
              </div>
            )}

            {suppliers.length === 0 && !addingSupplier && suppliersLoaded && (
              <div style={{ ...cardStyle, textAlign: 'center', color: '#6b7280' }}>Aucun fournisseur associe a ce produit</div>
            )}

            {suppliers.map(supplier => (
              <div key={supplier.id} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: '160px' }}>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
                      {supplier.name}
                      {supplier.is_primary && <span style={{ marginLeft: '8px', padding: '2px 8px', backgroundColor: '#dbeafe', color: '#1d4ed8', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>Principal</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Ref fournisseur
                      <input type="text" value={getEditValue(supplier, 'supplier_sku')} onChange={(e) => handleEditChange(supplier.id, 'supplier_sku', e.target.value)} style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '130px', marginTop: '2px' }} />
                    </label>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Pack qty
                      <input type="number" min="1" value={getEditValue(supplier, 'pack_qty')} onChange={(e) => handleEditChange(supplier.id, 'pack_qty', parseInt(e.target.value) || 1)} style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '80px', marginTop: '2px' }} />
                    </label>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Prix HT
                      <input type="number" step="0.01" min="0" value={getEditValue(supplier, 'supplier_price')} onChange={(e) => handleEditChange(supplier.id, 'supplier_price', e.target.value)} style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '100px', marginTop: '2px' }} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button onClick={() => handleSaveSupplier(supplier.id)} disabled={saving || !editingSupplier[supplier.id]} style={{ padding: '6px 12px', backgroundColor: editingSupplier[supplier.id] ? '#135E84' : '#d1d5db', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: editingSupplier[supplier.id] ? 'pointer' : 'not-allowed' }}>Sauvegarder</button>
                    {!supplier.is_primary && (
                      <button onClick={() => handleSetPrimary(supplier.id)} title="Definir comme principal" style={{ padding: '6px 12px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Principal</button>
                    )}
                    <button onClick={() => handleToggleExpand(supplier.id)} style={{ padding: '6px 12px', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>{expandedSupplier === supplier.id ? 'Replier' : 'Historique'}</button>
                    <button onClick={() => handleRemoveSupplier(supplier.id, supplier.name)} style={{ padding: '6px 12px', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>Retirer</button>
                  </div>
                </div>

                {expandedSupplier === supplier.id && (
                  <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 20px', backgroundColor: '#f9fafb' }}>
                    {!supplierHistory[supplier.id] ? (
                      <p style={{ color: '#6b7280', fontSize: '13px' }}>Chargement...</p>
                    ) : supplierHistory[supplier.id].length === 0 ? (
                      <p style={{ color: '#6b7280', fontSize: '13px' }}>Aucun historique de commande</p>
                    ) : (
                      <>
                        <div style={{ marginBottom: '16px' }}>
                          <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#374151' }}>Evolution du prix d'achat</h4>
                          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            {supplierHistory[supplier.id].filter(h => h.unit_price).slice(0, 10).reverse().map((h, i) => (
                              <div key={i} style={{ textAlign: 'center', fontSize: '11px', color: '#6b7280' }}>
                                <div style={{ fontWeight: '600', color: '#111827', fontSize: '13px' }}>{formatPrice(h.unit_price)} EUR</div>
                                <div>{formatDateSimple(h.order_date)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Date</th>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Reference</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Cmd</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Recu</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Prix unit.</th>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Statut</th>
                            </tr>
                          </thead>
                          <tbody>
                            {supplierHistory[supplier.id].map((h, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '8px 10px' }}>{formatDateSimple(h.order_date)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{h.order_number || h.bms_reference || '-'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.qty_ordered}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.qty_received}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.unit_price ? `${formatPrice(h.unit_price)} EUR` : '-'}</td>
                                <td style={{ padding: '8px 10px' }}>
                                  <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', backgroundColor: h.status === 'received' ? '#dcfce7' : h.status === 'partial' ? '#fef3c7' : '#f3f4f6', color: h.status === 'received' ? '#166534' : h.status === 'partial' ? '#92400e' : '#374151' }}>
                                    {statusLabels[h.status] || h.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white' }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default ProductDetail;
