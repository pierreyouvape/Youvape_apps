import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  // State
  const [product, setProduct] = useState(null);
  const [family, setFamily] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [frequentlyBought, setFrequentlyBought] = useState([]);
  const [salesByCountry, setSalesByCountry] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCost, setEditingCost] = useState(false);
  const [newCost, setNewCost] = useState('');

  useEffect(() => {
    if (id) fetchProductData();
  }, [id]);

  const fetchProductData = async () => {
    setLoading(true);
    try {
      const [
        productRes,
        familyRes,
        kpisRes,
        boughtWithRes,
        countryRes,
        customersRes,
        ordersRes
      ] = await Promise.all([
        axios.get(`${API_URL}/products/${id}`),
        axios.get(`${API_URL}/products/${id}/family`),
        axios.get(`${API_URL}/products/${id}/stats/kpis`),
        axios.get(`${API_URL}/products/${id}/stats/frequently-bought-with`, { params: { limit: 10 } }),
        axios.get(`${API_URL}/products/${id}/stats/by-country`),
        axios.get(`${API_URL}/products/${id}/stats/top-customers`, { params: { limit: 10 } }),
        axios.get(`${API_URL}/products/${id}/stats/recent-orders`, { params: { limit: 20 } })
      ]);

      setProduct(productRes.data.data);
      setFamily(familyRes.data.data);
      setKpis(kpisRes.data.data);
      setFrequentlyBought(boughtWithRes.data.data);
      setSalesByCountry(countryRes.data.data);
      setTopCustomers(customersRes.data.data);
      setRecentOrders(ordersRes.data.data);
      setNewCost(productRes.data.data.cost_price_custom || productRes.data.data.cost_price || '');
    } catch (err) {
      console.error('Error fetching product data:', err);
    } finally {
      setLoading(false);
    }
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
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
  };

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
            {product.image_url && <img src={product.image_url} alt={product.name} style={{ width: '100%', borderRadius: '8px', border: '1px solid #e0e0e0' }} />}
          </div>
          <div>
            <h1 style={{ margin: '0 0 10px 0', color: '#135E84' }}>{product.name}</h1>
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>SKU: {product.sku || '-'}</div>
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
                <div style={{ fontSize: '24px', fontWeight: '700', color: product.stock_quantity > 0 ? '#28a745' : '#dc3545' }}>{formatNumber(product.stock_quantity || 0)}</div>
              </div>
            </div>
            {product.category && <div style={{ fontSize: '14px', color: '#666' }}>Catégorie: {product.category}</div>}
          </div>
        </div>

        {/* Variations */}
        {hasVariants && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📦 Variations ({family.variants.length})</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Variante</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>SKU</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Prix</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {family.variants.map((variant) => (
                    <tr key={variant.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px' }}>{variant.name}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontSize: '13px', color: '#666' }}>{variant.sku}</td>
                      <td style={{ textAlign: 'right', padding: '12px', fontWeight: '600' }}>{formatCurrency(variant.price)}</td>
                      <td style={{ textAlign: 'center', padding: '12px', fontWeight: '600', color: variant.stock_quantity > 0 ? '#28a745' : '#dc3545' }}>{formatNumber(variant.stock_quantity || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* KPIs */}
        {kpis && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
            {[
              { label: 'Net Sold', value: formatNumber(kpis.net_sold || 0), color: '#135E84' },
              { label: 'Net Revenue', value: formatCurrency(kpis.net_revenue || 0), color: '#28a745' },
              { label: 'Net Orders', value: formatNumber(kpis.net_orders || 0), color: '#8b5cf6' },
              { label: 'Cost', value: formatCurrency(kpis.total_cost || 0), color: '#fd7e14' },
              { label: 'Profit', value: formatCurrency(kpis.profit || 0), color: '#007bff' },
              { label: 'Margin', value: `${(kpis.margin_percent || 0).toFixed(1)}%`, color: '#ff6b6b' }
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
            From <strong>{formatNumber(kpis.net_orders || 0)} net orders</strong>. On average, customers order <strong>{(kpis.avg_quantity_per_order || 0).toFixed(1)}</strong> of this product per order.
          </div>
        )}

        {/* Frequently Bought With */}
        {frequentlyBought.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🛍️ Frequently bought with</h2>
            <div>
              {frequentlyBought.slice(0, 5).map((item) => (
                <div key={item.product_id} onClick={() => navigate(`/products/${item.product_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div style={{ fontWeight: '600' }}>{item.name}</div>
                  <div style={{ fontSize: '13px', color: '#999' }}>{item.times_bought_together} times</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sales by Country */}
        {salesByCountry.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🌍 Sales by Country</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                    <th style={{ textAlign: 'left', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Country</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Net Sold</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Net Revenue</th>
                    <th style={{ textAlign: 'center', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Net Orders</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Cost</th>
                    <th style={{ textAlign: 'right', padding: '12px', fontSize: '14px', fontWeight: '600' }}>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {salesByCountry.map((country) => (
                    <tr key={country.shipping_country} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px', fontWeight: '600' }}>{country.shipping_country}</td>
                      <td style={{ textAlign: 'center', padding: '12px' }}>{formatNumber(country.net_sold)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', color: '#28a745', fontWeight: '600' }}>{formatCurrency(country.net_revenue)}</td>
                      <td style={{ textAlign: 'center', padding: '12px' }}>{formatNumber(country.net_orders)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', color: '#fd7e14' }}>{formatCurrency(country.cost)}</td>
                      <td style={{ textAlign: 'right', padding: '12px', color: '#007bff', fontWeight: '600' }}>{formatCurrency(country.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Top Customers */}
          {topCustomers.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>👥 Top Customers</h2>
              {topCustomers.slice(0, 5).map((customer) => (
                <div key={customer.customer_id} onClick={() => navigate(`/customers/${customer.customer_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div>
                    <div style={{ fontWeight: '600' }}>{customer.first_name} {customer.last_name}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{customer.email}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#135E84' }}>{formatNumber(customer.quantity_bought)} units</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{formatCurrency(customer.total_spent)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Orders */}
          {recentOrders.length > 0 && (
            <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📋 Recent Orders</h2>
              {recentOrders.slice(0, 5).map((order) => (
                <div key={order.order_id} onClick={() => navigate(`/orders/${order.order_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div>
                    <div style={{ fontWeight: '600' }}>#{order.order_number}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{order.first_name} {order.last_name} • {order.shipping_country}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '600', color: '#28a745' }}>{formatCurrency(order.total)}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{formatDate(order.date_created)}</div>
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
