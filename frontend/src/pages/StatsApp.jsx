import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const StatsApp = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('dashboard');

  // Dashboard state
  const [period, setPeriod] = useState('30d');
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Orders state
  const [orders, setOrders] = useState([]);
  const [statusStats, setStatusStats] = useState([]);
  const [orderFilters, setOrderFilters] = useState({ search: '', status: '', country: '', paymentMethod: '' });

  // Products state
  const [products, setProducts] = useState([]);
  const [stockSummary, setStockSummary] = useState({ in_stock: 0, out_of_stock: 0, low_stock: 0 });
  const [productFilters, setProductFilters] = useState({ search: '', category: '', stockStatus: '' });

  // Customers state
  const [customers, setCustomers] = useState([]);
  const [customerFilters, setCustomerFilters] = useState({ search: '', country: '' });

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchDashboard();
    } else if (activeTab === 'orders') {
      fetchOrders();
    } else if (activeTab === 'products') {
      fetchProducts();
    } else if (activeTab === 'customers') {
      fetchCustomers();
    }
  }, [activeTab, period]);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/stats/dashboard`, {
        params: { period, status: 'completed' }
      });
      if (res.data.success) setDashboardData(res.data.data);
    } catch (err) {
      console.error('Error fetching dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const [ordersRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/orders`, { params: { limit: 100000 } }),
        axios.get(`${API_URL}/orders/stats/by-status`)
      ]);
      if (ordersRes.data.success) setOrders(ordersRes.data.data);
      if (statsRes.data.success) setStatusStats(statsRes.data.data);
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const [productsRes, stockRes] = await Promise.all([
        axios.get(`${API_URL}/products`, { params: { limit: 100000 } }),
        axios.get(`${API_URL}/products/stock-summary`)
      ]);
      if (productsRes.data.success) setProducts(productsRes.data.data);
      if (stockRes.data.success) setStockSummary(stockRes.data.data);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/customers`, { params: { limit: 100000 } });
      if (res.data.success) setCustomers(res.data.data);
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const colors = {
      completed: { bg: '#d4edda', color: '#155724' },
      processing: { bg: '#d1ecf1', color: '#0c5460' },
      'on-hold': { bg: '#fff3cd', color: '#856404' },
      pending: { bg: '#f8d7da', color: '#721c24' },
      cancelled: { bg: '#f8d7da', color: '#721c24' },
      refunded: { bg: '#e2e3e5', color: '#383d41' },
      failed: { bg: '#f8d7da', color: '#721c24' }
    };
    const style = colors[status] || { bg: '#e2e3e5', color: '#383d41' };
    return (
      <span style={{ padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', backgroundColor: style.bg, color: style.color }}>
        {status}
      </span>
    );
  };

  const filteredOrders = orders.filter(order => {
    if (orderFilters.search && !order.order_number?.toLowerCase().includes(orderFilters.search.toLowerCase()) && !order.email?.toLowerCase().includes(orderFilters.search.toLowerCase())) return false;
    if (orderFilters.status && order.status !== orderFilters.status) return false;
    if (orderFilters.country && order.shipping_country !== orderFilters.country) return false;
    if (orderFilters.paymentMethod && order.payment_method !== orderFilters.paymentMethod) return false;
    return true;
  });

  const filteredProducts = products.filter(product => {
    if (productFilters.search && !product.post_title?.toLowerCase().includes(productFilters.search.toLowerCase()) && !product.sku?.toLowerCase().includes(productFilters.search.toLowerCase())) return false;
    if (productFilters.category && product.category !== productFilters.category) return false;
    if (productFilters.stockStatus === 'instock' && (product.stock_status !== 'instock' || product.stock <= 0)) return false;
    if (productFilters.stockStatus === 'outofstock' && product.stock_status !== 'outofstock' && product.stock > 0) return false;
    if (productFilters.stockStatus === 'low' && (product.stock > 10 || product.stock <= 0)) return false;
    return true;
  });

  const filteredCustomers = customers.filter(customer => {
    if (customerFilters.search && !customer.first_name?.toLowerCase().includes(customerFilters.search.toLowerCase()) && !customer.last_name?.toLowerCase().includes(customerFilters.search.toLowerCase()) && !customer.email?.toLowerCase().includes(customerFilters.search.toLowerCase())) return false;
    if (customerFilters.country && customer.shipping_country !== customerFilters.country) return false;
    return true;
  });

  const uniqueCountries = [...new Set(orders.map(o => o.shipping_country).filter(Boolean))].sort();
  const uniquePaymentMethods = [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort();
  const uniqueCategories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  const uniqueCustomerCountries = [...new Set(customers.map(c => c.shipping_country).filter(Boolean))].sort();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button onClick={() => navigate('/home')} style={{ position: 'absolute', left: '20px', padding: '10px 20px', backgroundColor: '#fff', color: '#135E84', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>
          ← Retour
        </button>
      </div>

      {/* Tabs */}
      <div style={{ backgroundColor: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ maxWidth: '1600px', margin: '0 auto', display: 'flex', gap: '0' }}>
          {[
            { key: 'dashboard', label: '📊 Dashboard', icon: '📊' },
            { key: 'orders', label: '🛒 Commandes', icon: '🛒' },
            { key: 'products', label: '📦 Produits', icon: '📦' },
            { key: 'customers', label: '👥 Clients', icon: '👥' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '20px',
                fontSize: '16px',
                fontWeight: '600',
                border: 'none',
                backgroundColor: activeTab === tab.key ? '#135E84' : 'transparent',
                color: activeTab === tab.key ? '#fff' : '#666',
                cursor: 'pointer',
                borderBottom: activeTab === tab.key ? 'none' : '2px solid #e0e0e0',
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, maxWidth: '1600px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
            <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && !loading && dashboardData && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
              <h1 style={{ color: '#135E84', margin: 0 }}>Dashboard WooCommerce</h1>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>
                <option value="7d">7 derniers jours</option>
                <option value="30d">30 derniers jours</option>
                <option value="90d">90 derniers jours</option>
                <option value="365d">1 an</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '40px' }}>
              {[
                { title: "Chiffre d'affaires", value: formatCurrency(dashboardData.total_revenue), icon: "💰", color: "#28a745" },
                { title: "Marge brute", value: formatCurrency(dashboardData.gross_margin), icon: "📈", color: "#007bff" },
                { title: "Panier moyen", value: formatCurrency(dashboardData.avg_order_value), icon: "🛒", color: "#8b5cf6" },
                { title: "Clients uniques", value: formatNumber(dashboardData.unique_customers), icon: "👥", color: "#ff6b6b" },
                { title: "Manque à gagner", value: formatCurrency(dashboardData.missed_revenue), icon: "🎟️", color: "#fd7e14" }
              ].map((kpi, i) => (
                <div key={i} style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: '40px', marginBottom: '10px' }}>{kpi.icon}</div>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '5px' }}>{kpi.title}</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && !loading && (
          <div>
            <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>🛒 Commandes</h1>
            {statusStats.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
                {statusStats.map(stat => (
                  <div key={stat.status} onClick={() => setOrderFilters({ ...orderFilters, status: orderFilters.status === stat.status ? '' : stat.status })} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer', border: orderFilters.status === stat.status ? '2px solid #135E84' : '2px solid transparent' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>{stat.status}</div>
                    <div style={{ fontSize: '28px', fontWeight: '700', color: '#135E84' }}>{stat.count}</div>
                    <div style={{ fontSize: '13px', color: '#999', marginTop: '5px' }}>{formatCurrency(stat.total_amount)}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <input type="text" placeholder="🔍 Rechercher..." value={orderFilters.search} onChange={(e) => setOrderFilters({ ...orderFilters, search: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', width: '300px' }} />
              <select value={orderFilters.country} onChange={(e) => setOrderFilters({ ...orderFilters, country: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>
                <option value="">Tous les pays</option>
                {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={orderFilters.paymentMethod} onChange={(e) => setOrderFilters({ ...orderFilters, paymentMethod: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>
                <option value="">Tous les paiements</option>
                {uniquePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => setOrderFilters({ search: '', status: '', country: '', paymentMethod: '' })} style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>🔄</button>
            </div>
            {filteredOrders.length > 0 && (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Commande</th>
                      <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Client</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Statut</th>
                      <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Date</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map(order => (
                      <tr key={order.order_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '15px' }}>
                          <div style={{ fontWeight: '600' }}>#{order.order_number}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>{order.items_count} article(s)</div>
                        </td>
                        <td style={{ padding: '15px' }}>
                          <div style={{ fontWeight: '600' }}>{order.first_name} {order.last_name}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>{order.email}</div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '15px' }}>{getStatusBadge(order.status)}</td>
                        <td style={{ textAlign: 'right', padding: '15px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(order.total)}</td>
                        <td style={{ textAlign: 'center', padding: '15px', fontSize: '13px', color: '#666' }}>{formatDate(order.date_created)}</td>
                        <td style={{ textAlign: 'center', padding: '15px' }}>
                          <button onClick={() => navigate(`/orders/${order.order_id}`)} style={{ padding: '6px 12px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Détails</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>{filteredOrders.length} commande(s) sur {orders.length}</div>
          </div>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && !loading && (
          <div>
            <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>📦 Produits</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '15px', marginBottom: '30px' }}>
              {[
                { label: 'En stock', value: stockSummary.in_stock || 0, color: '#28a745', key: 'instock' },
                { label: 'En rupture', value: stockSummary.out_of_stock || 0, color: '#dc3545', key: 'outofstock' },
                { label: 'Stock bas', value: stockSummary.low_stock || 0, color: '#ffc107', key: 'low' }
              ].map(stock => (
                <div key={stock.key} onClick={() => setProductFilters({ ...productFilters, stockStatus: productFilters.stockStatus === stock.key ? '' : stock.key })} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer', border: productFilters.stockStatus === stock.key ? `2px solid ${stock.color}` : '2px solid transparent' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px', textTransform: 'uppercase' }}>{stock.label}</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: stock.color }}>{stock.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <input type="text" placeholder="🔍 Rechercher..." value={productFilters.search} onChange={(e) => setProductFilters({ ...productFilters, search: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', width: '300px' }} />
              <select value={productFilters.category} onChange={(e) => setProductFilters({ ...productFilters, category: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>
                <option value="">Toutes les catégories</option>
                {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => setProductFilters({ search: '', category: '', stockStatus: '' })} style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>🔄</button>
            </div>
            {filteredProducts.length > 0 && (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Produit</th>
                      <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Prix</th>
                      <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Marge</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Stock</th>
                      <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>CA Total</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map(product => {
                      const margin = parseFloat(product.unit_margin) || 0;
                      return (
                        <tr key={product.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '15px' }}>
                            <div style={{ fontWeight: '600' }}>{product.post_title}</div>
                            <div style={{ fontSize: '12px', color: '#999' }}>SKU: {product.sku || '-'}</div>
                          </td>
                          <td style={{ textAlign: 'right', padding: '15px', fontWeight: '600' }}>{formatCurrency(product.price)}</td>
                          <td style={{ textAlign: 'right', padding: '15px', fontWeight: '600', color: margin >= 0 ? '#28a745' : '#dc3545' }}>{formatCurrency(margin)}</td>
                          <td style={{ textAlign: 'center', padding: '15px', fontWeight: '600' }}>{product.stock !== null ? formatNumber(product.stock) : '-'}</td>
                          <td style={{ textAlign: 'right', padding: '15px', fontWeight: '600', color: '#135E84' }}>{formatCurrency(product.total_revenue || 0)}</td>
                          <td style={{ textAlign: 'center', padding: '15px' }}>
                            <button onClick={() => navigate(`/products/${product.product_id}`)} style={{ padding: '6px 12px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Détails</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>{filteredProducts.length} produit(s) sur {products.length}</div>
          </div>
        )}

        {/* Customers Tab */}
        {activeTab === 'customers' && !loading && (
          <div>
            <h1 style={{ color: '#135E84', margin: '0 0 30px 0' }}>👥 Clients</h1>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <input type="text" placeholder="🔍 Rechercher..." value={customerFilters.search} onChange={(e) => setCustomerFilters({ ...customerFilters, search: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', width: '300px' }} />
              <select value={customerFilters.country} onChange={(e) => setCustomerFilters({ ...customerFilters, country: e.target.value })} style={{ padding: '10px 15px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer' }}>
                <option value="">Tous les pays</option>
                {uniqueCustomerCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => setCustomerFilters({ search: '', country: '' })} style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>🔄</button>
            </div>
            {filteredCustomers.length > 0 && (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e0e0' }}>
                      <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Nom</th>
                      <th style={{ textAlign: 'left', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Email</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Commandes</th>
                      <th style={{ textAlign: 'right', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Total dépensé</th>
                      <th style={{ textAlign: 'center', padding: '15px', fontSize: '14px', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(customer => (
                      <tr key={customer.customer_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '15px', fontWeight: '600' }}>{customer.first_name} {customer.last_name}</td>
                        <td style={{ padding: '15px', color: '#666' }}>{customer.email}</td>
                        <td style={{ textAlign: 'center', padding: '15px', fontWeight: '600', color: '#135E84' }}>{formatNumber(customer.actual_order_count || customer.orders_count || 0)}</td>
                        <td style={{ textAlign: 'right', padding: '15px', fontWeight: '600', color: '#28a745' }}>{formatCurrency(customer.actual_total_spent || customer.total_spent || 0)}</td>
                        <td style={{ textAlign: 'center', padding: '15px' }}>
                          <button onClick={() => navigate(`/customers/${customer.customer_id}`)} style={{ padding: '6px 12px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>Détails</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>{filteredCustomers.length} client(s) sur {customers.length}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white', marginTop: '50px' }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default StatsApp;
