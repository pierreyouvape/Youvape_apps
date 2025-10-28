import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import KPICard from '../components/stats/KPICard';
import PeriodFilter from '../components/filters/PeriodFilter';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const StatsApp = () => {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [statsByCountry, setStatsByCountry] = useState([]);
  const [topCoupons, setTopCoupons] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAllStats();
  }, [period]);

  const fetchAllStats = async () => {
    setLoading(true);
    setError('');

    try {
      // Fetch dashboard KPIs
      const dashboardRes = await axios.get(`${API_URL}/stats/dashboard`, {
        params: { period, status: 'completed' }
      });

      // Fetch top products
      const productsRes = await axios.get(`${API_URL}/stats/top-products`, {
        params: { period, status: 'completed', limit: 5, sortBy: 'revenue' }
      });

      // Fetch top customers
      const customersRes = await axios.get(`${API_URL}/stats/top-customers`, {
        params: { period, status: 'completed', limit: 5 }
      });

      // Fetch stats by country
      const countryRes = await axios.get(`${API_URL}/stats/by-country`, {
        params: { period, status: 'completed' }
      });

      // Fetch top coupons
      const couponsRes = await axios.get(`${API_URL}/stats/top-coupons`, {
        params: { period, status: 'completed', limit: 5 }
      });

      setDashboardData(dashboardRes.data.data);
      setTopProducts(productsRes.data.data);
      setTopCustomers(customersRes.data.data);
      setStatsByCountry(countryRes.data.data);
      setTopCoupons(couponsRes.data.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError('Erreur lors du chargement des statistiques');
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

  if (loading && !dashboardData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
          <div style={{ fontSize: '18px', color: '#666' }}>Chargement des statistiques...</div>
        </div>
      </div>
    );
  }

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
        {/* Title & Filters */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '30px',
            flexWrap: 'wrap',
            gap: '15px'
          }}
        >
          <h1 style={{ color: '#135E84', margin: 0 }}>📊 Dashboard WooCommerce</h1>
          <PeriodFilter onChange={setPeriod} defaultPeriod={period} />
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

        {/* KPI Cards */}
        {dashboardData && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '20px',
              marginBottom: '40px'
            }}
          >
            <KPICard
              title="Chiffre d'affaires"
              value={formatCurrency(dashboardData.total_revenue)}
              icon="💰"
              color="#28a745"
              subtitle={`${formatNumber(dashboardData.total_orders)} commandes`}
            />
            <KPICard
              title="Marge brute"
              value={formatCurrency(dashboardData.gross_margin)}
              icon="📈"
              color="#007bff"
              subtitle={`${parseFloat(dashboardData.gross_margin_percent).toFixed(1)}% de marge`}
            />
            <KPICard
              title="Panier moyen"
              value={formatCurrency(dashboardData.avg_order_value)}
              icon="🛒"
              color="#8b5cf6"
            />
            <KPICard
              title="Clients uniques"
              value={formatNumber(dashboardData.unique_customers)}
              icon="👥"
              color="#ff6b6b"
            />
            <KPICard
              title="Manque à gagner"
              value={formatCurrency(dashboardData.missed_revenue)}
              icon="🎟️"
              color="#fd7e14"
              subtitle="Total remises"
            />
          </div>
        )}

        {/* Grid Layout for Tables */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px' }}>
          {/* Top Products */}
          <div
            style={{
              padding: '25px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              🏆 Top 5 Produits (CA)
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                    Produit
                  </th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>CA</th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Qté</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product, index) => (
                  <tr key={product.product_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 5px', fontSize: '14px' }}>
                      <div style={{ fontWeight: '600' }}>{product.name}</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>{product.sku}</div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(product.total_revenue)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px' }}>
                      {formatNumber(product.total_quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Top Customers */}
          <div
            style={{
              padding: '25px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              👑 Top 5 Clients
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                    Client
                  </th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                    Total dépensé
                  </th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Cmd</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((customer) => (
                  <tr key={customer.customer_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 5px', fontSize: '14px' }}>
                      <div style={{ fontWeight: '600' }}>
                        {customer.first_name} {customer.last_name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#999' }}>{customer.email}</div>
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(customer.total_spent)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px' }}>
                      {formatNumber(customer.orders_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stats by Country */}
          <div
            style={{
              padding: '25px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>🌍 Par Pays</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Pays</th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>CA</th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Cmd</th>
                </tr>
              </thead>
              <tbody>
                {statsByCountry.slice(0, 5).map((country) => (
                  <tr key={country.country} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>{country.country}</td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(country.revenue)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px' }}>
                      {formatNumber(country.orders_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Top Coupons */}
          <div
            style={{
              padding: '25px',
              backgroundColor: '#fff',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              🎟️ Top 5 Coupons
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                  <th style={{ textAlign: 'left', padding: '10px 5px', fontSize: '13px', color: '#666' }}>Code</th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                    Utilisation
                  </th>
                  <th style={{ textAlign: 'right', padding: '10px 5px', fontSize: '13px', color: '#666' }}>
                    Remise totale
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCoupons.map((coupon) => (
                  <tr key={coupon.code} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>{coupon.code}</td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px' }}>
                      {formatNumber(coupon.usage_count)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(coupon.total_discount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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

export default StatsApp;
