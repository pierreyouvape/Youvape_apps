import { useState, useEffect } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar, Line, BarChart, LineChart } from 'recharts';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

// Menu latéral des sous-rapports
const REPORT_SECTIONS = [
  { id: 'revenue', label: 'Chiffre d\'affaires', icon: '💰' },
  { id: 'profit', label: 'Profit', icon: '📈' },
  { id: 'orders', label: 'Commandes', icon: '📦' },
  { id: 'refunds', label: 'Remboursements', icon: '↩️' },
  { id: 'by-country', label: 'Par Pays', icon: '🌍' },
  { id: 'by-tax', label: 'Par TVA', icon: '🧾', disabled: true },
];

const ReportsTab = () => {
  const [activeSection, setActiveSection] = useState('revenue');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [profitData, setProfitData] = useState(null);
  const [transactionCosts, setTransactionCosts] = useState([]);
  const [shippingCosts, setShippingCosts] = useState([]);
  const [ordersData, setOrdersData] = useState(null);
  const [refundsData, setRefundsData] = useState(null);
  const [byCountryData, setByCountryData] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Période par défaut: mois en cours
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth.toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);

  useEffect(() => {
    if (activeSection === 'revenue') {
      fetchRevenueReport();
    } else if (activeSection === 'profit') {
      fetchProfitReport();
    } else if (activeSection === 'orders') {
      fetchOrdersReport();
    } else if (activeSection === 'refunds') {
      fetchRefundsReport();
    } else if (activeSection === 'by-country') {
      fetchByCountryReport();
    }
  }, [activeSection, dateFrom, dateTo]);

  const fetchRevenueReport = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/reports/revenue`, {
        dateFrom,
        dateTo
      });
      if (response.data.success) {
        setData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching revenue report:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProfitReport = async () => {
    setLoading(true);
    try {
      const [profitRes, transactionRes, shippingRes] = await Promise.all([
        axios.post(`${API_BASE_URL}/reports/profit`, { dateFrom, dateTo }),
        axios.post(`${API_BASE_URL}/reports/profit/transaction-costs`, { dateFrom, dateTo }),
        axios.post(`${API_BASE_URL}/reports/profit/shipping-costs`, { dateFrom, dateTo })
      ]);

      if (profitRes.data.success) {
        setProfitData(profitRes.data.data);
      }
      if (transactionRes.data.success) {
        setTransactionCosts(transactionRes.data.data);
      }
      if (shippingRes.data.success) {
        setShippingCosts(shippingRes.data.data);
      }
    } catch (error) {
      console.error('Error fetching profit report:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersReport = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/reports/orders`, {
        dateFrom,
        dateTo
      });
      if (response.data.success) {
        setOrdersData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching orders report:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRefundsReport = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/reports/refunds`, {
        dateFrom,
        dateTo
      });
      if (response.data.success) {
        setRefundsData(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching refunds report:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchByCountryReport = async (country = null) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/reports/by-country`, {
        dateFrom,
        dateTo,
        country
      });
      if (response.data.success) {
        setByCountryData(response.data.data);
        if (country) {
          setSelectedCountry(country);
        }
      }
    } catch (error) {
      console.error('Error fetching by-country report:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCountrySelect = (country) => {
    setSelectedCountry(country);
    fetchByCountryReport(country);
  };

  const formatPrice = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(value);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  };

  const formatFullDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  // Préparer les données pour le graphique Revenue
  const chartData = data?.breakdown?.map(item => ({
    date: formatDate(item.date),
    fullDate: formatFullDate(item.date),
    ca: parseFloat(item.gross_sales),
    net: parseFloat(item.net)
  })) || [];

  // Préparer les données pour le graphique Profit
  const profitChartData = profitData?.breakdown?.map(item => ({
    date: formatDate(item.date),
    fullDate: formatFullDate(item.date),
    netRevenue: parseFloat(item.net_revenue),
    cost: parseFloat(item.cost),
    profit: parseFloat(item.profit)
  })) || [];

  // Calculer les totaux du tableau Revenue
  const totals = data?.breakdown?.reduce((acc, item) => ({
    orders: acc.orders + item.orders_count,
    gross: acc.gross + parseFloat(item.gross_sales),
    taxes: acc.taxes + parseFloat(item.taxes),
    shipping: acc.shipping + parseFloat(item.shipping),
    fees: acc.fees + parseFloat(item.fees),
    refunds: acc.refunds + parseFloat(item.refunds),
    net: acc.net + parseFloat(item.net)
  }), { orders: 0, gross: 0, taxes: 0, shipping: 0, fees: 0, refunds: 0, net: 0 });

  // Calculer les totaux du tableau Profit
  const profitTotals = profitData?.breakdown?.reduce((acc, item) => ({
    orders: acc.orders + item.orders_count,
    gross: acc.gross + parseFloat(item.gross_sales),
    taxes: acc.taxes + parseFloat(item.taxes),
    refunds: acc.refunds + parseFloat(item.refunds),
    netRevenue: acc.netRevenue + parseFloat(item.net_revenue),
    cost: acc.cost + parseFloat(item.cost),
    profit: acc.profit + parseFloat(item.profit)
  }), { orders: 0, gross: 0, taxes: 0, refunds: 0, netRevenue: 0, cost: 0, profit: 0 });

  const renderRevenueSection = () => (
    <div>
      {/* Header avec titre et période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#333', fontSize: '24px' }}>Chiffre d'affaires</h2>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: '13px' }}>
            Du {formatFullDate(dateFrom)} au {formatFullDate(dateTo)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <span style={{ color: '#666' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#666' }}>Chargement...</div>
      ) : data ? (
        <>
          {/* Section Graphique + KPIs */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            {/* Graphique */}
            <div style={{
              flex: 1,
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #e9ecef'
            }}>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorCa" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#007bff" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#007bff" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px' }}
                    labelStyle={{ color: '#333' }}
                    formatter={(value) => [formatPrice(value), 'CA TTC']}
                    labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                  />
                  <Area
                    type="monotone"
                    dataKey="ca"
                    stroke="#007bff"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorCa)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* KPIs */}
            <div style={{
              width: '280px',
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #e9ecef'
            }}>
              <h3 style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px' }}>
                Sur la période
              </h3>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>CA TTC</span>
                  <span style={{ color: '#333', fontSize: '18px', fontWeight: '700' }}>{formatPrice(data.kpis.ca_ttc)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>CA HT</span>
                  <span style={{ color: '#28a745', fontSize: '16px', fontWeight: '600' }}>{formatPrice(data.kpis.ca_ht)}</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '15px', marginBottom: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Total Remboursements</span>
                  <span style={{ color: '#dc3545', fontSize: '14px' }}>{formatPrice(data.kpis.refunds)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Total TVA</span>
                  <span style={{ color: '#666', fontSize: '14px' }}>{formatPrice(data.kpis.taxes)}</span>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #e9ecef', paddingTop: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Nombre de commandes</span>
                  <span style={{ color: '#333', fontSize: '16px', fontWeight: '600' }}>{data.kpis.orders_count.toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Panier moyen HT</span>
                  <span style={{ color: '#333', fontSize: '14px', fontWeight: '600' }}>{formatPrice(data.kpis.avg_order_ht)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tableau détaillé jour par jour */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e9ecef'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Détail par jour</h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Date</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>CA TTC</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>TVA</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>CA HT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                      <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px' }}>{formatFullDate(row.date)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders_count}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.taxes)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px', fontWeight: '600' }}>{formatPrice(parseFloat(row.gross_sales) - parseFloat(row.taxes))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ position: 'sticky', bottom: 0, backgroundColor: '#f8f9fa' }}>
                  {totals && (
                    <tr style={{ fontWeight: '700' }}>
                      <td style={{ padding: '15px', color: '#333', fontSize: '14px' }}>Totaux</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#007bff', fontSize: '14px' }}>{totals.orders.toLocaleString('fr-FR')}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#333', fontSize: '14px' }}>{formatPrice(totals.gross)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#666', fontSize: '14px' }}>{formatPrice(totals.taxes)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#28a745', fontSize: '14px' }}>{formatPrice(totals.gross - totals.taxes)}</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  const renderProfitSection = () => (
    <div>
      {/* Header avec titre et période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#333', fontSize: '24px' }}>Profit</h2>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: '13px' }}>
            Du {formatFullDate(dateFrom)} au {formatFullDate(dateTo)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <span style={{ color: '#666' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#666' }}>Chargement...</div>
      ) : profitData ? (
        <>
          {/* Section Graphique + KPIs */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            {/* Graphique */}
            <div style={{
              flex: 1,
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '20px',
              border: '1px solid #e9ecef'
            }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '14px' }}>Net Profit</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={profitChartData}>
                  <defs>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#28a745" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#28a745" stopOpacity={0.1}/>
                    </linearGradient>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#007bff" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#007bff" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px' }}
                    labelStyle={{ color: '#333' }}
                    formatter={(value, name) => {
                      const labels = { netRevenue: 'Net Revenue', cost: 'Coûts', profit: 'Profit' };
                      return [formatPrice(value), labels[name] || name];
                    }}
                    labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                  />
                  <Area type="monotone" dataKey="netRevenue" stroke="#007bff" strokeWidth={1} fill="url(#colorRevenue)" />
                  <Area type="monotone" dataKey="profit" stroke="#28a745" strokeWidth={2} fill="url(#colorProfit)" />
                  <Line type="monotone" dataKey="cost" stroke="#dc3545" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* KPIs + Cost Breakdown */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {/* KPIs */}
              <div style={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #e9ecef'
              }}>
                <h3 style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px' }}>
                  Sur la période
                </h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Commandes</span>
                  <span style={{ color: '#333', fontSize: '16px', fontWeight: '700' }}>{profitData.kpis.orders_count.toLocaleString('fr-FR')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Net Revenue</span>
                  <span style={{ color: '#007bff', fontSize: '16px', fontWeight: '700' }}>{formatPrice(profitData.kpis.net_revenue)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Total Cost</span>
                  <span style={{ color: '#dc3545', fontSize: '16px', fontWeight: '700' }}>{formatPrice(profitData.kpis.total_cost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Profit</span>
                  <span style={{ color: '#28a745', fontSize: '18px', fontWeight: '700' }}>{formatPrice(profitData.kpis.profit)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Profit Margin</span>
                  <span style={{ color: '#333', fontSize: '14px', fontWeight: '600' }}>{parseFloat(profitData.kpis.margin).toFixed(1)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Avg Profit</span>
                  <span style={{ color: '#333', fontSize: '14px', fontWeight: '600' }}>{formatPrice(profitData.kpis.avg_profit)}</span>
                </div>
              </div>

              {/* Cost Breakdown */}
              <div style={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #e9ecef'
              }}>
                <h3 style={{ color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '15px' }}>
                  Cost Breakdown
                </h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Net Revenue</span>
                  <span style={{ color: '#007bff', fontSize: '14px' }}>{formatPrice(profitData.cost_breakdown.net_revenue)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Shipping Costs</span>
                  <span style={{ color: '#dc3545', fontSize: '14px' }}>{formatPrice(profitData.cost_breakdown.shipping_cost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Transaction Costs</span>
                  <span style={{ color: '#dc3545', fontSize: '14px' }}>{formatPrice(profitData.cost_breakdown.transaction_cost)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#666', fontSize: '13px' }}>Core Cost</span>
                  <span style={{ color: '#dc3545', fontSize: '14px' }}>{formatPrice(profitData.cost_breakdown.core_cost)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tableau Profit par jour */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e9ecef',
            marginBottom: '30px'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Profit by Date</h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Date</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Orders</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Gross Sales</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Taxes</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Refunds</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Net Revenue</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Cost</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Profit</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {profitData.breakdown.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                      <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px' }}>{formatFullDate(row.date)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders_count}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.taxes)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.refunds)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px' }}>{formatPrice(row.net_revenue)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.cost)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px', fontWeight: '600' }}>{formatPrice(row.profit)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{parseFloat(row.margin).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ position: 'sticky', bottom: 0, backgroundColor: '#f8f9fa' }}>
                  {profitTotals && (
                    <tr style={{ fontWeight: '700' }}>
                      <td style={{ padding: '15px', color: '#333', fontSize: '14px' }}>Totaux</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#007bff', fontSize: '14px' }}>{profitTotals.orders.toLocaleString('fr-FR')}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#333', fontSize: '14px' }}>{formatPrice(profitTotals.gross)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#666', fontSize: '14px' }}>{formatPrice(profitTotals.taxes)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#dc3545', fontSize: '14px' }}>{formatPrice(profitTotals.refunds)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#007bff', fontSize: '14px' }}>{formatPrice(profitTotals.netRevenue)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#dc3545', fontSize: '14px' }}>{formatPrice(profitTotals.cost)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#28a745', fontSize: '14px' }}>{formatPrice(profitTotals.profit)}</td>
                      <td style={{ padding: '15px', textAlign: 'right', color: '#333', fontSize: '14px' }}>{profitTotals.netRevenue > 0 ? ((profitTotals.profit / profitTotals.netRevenue) * 100).toFixed(1) : 0}%</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>

          {/* Transaction Costs by Payment Method */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e9ecef',
            marginBottom: '30px'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Transaction Costs by Payment Method</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Payment Method</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Orders</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Transaction Cost</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Average Percent</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionCosts.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                      <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px' }}>{row.payment_method}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders_count.toLocaleString('fr-FR')}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.transaction_cost)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.avg_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Shipping Costs by Method */}
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e9ecef'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Shipping Costs by Shipping Method</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Shipping Method</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Orders</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Shipping Cost</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Average Cost</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Shipping Charged</th>
                    <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Average Charged</th>
                  </tr>
                </thead>
                <tbody>
                  {shippingCosts.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                      <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px' }}>{row.shipping_method}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders_count.toLocaleString('fr-FR')}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.shipping_cost)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.avg_cost)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.shipping_charged)}</td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.avg_charged)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  // Préparer les données pour les graphiques Commandes
  const ordersChartData = ordersData?.breakdown?.map(item => ({
    date: formatDate(item.date),
    fullDate: formatFullDate(item.date),
    orders: item.orders_count,
    netSales: parseFloat(item.net_sales)
  })) || [];

  const avgOrderChartData = ordersData?.avgOrderByDay?.map(item => ({
    date: formatDate(item.date),
    fullDate: formatFullDate(item.date),
    avgGross: parseFloat(item.avg_gross),
    avgItems: parseFloat(item.avg_items)
  })) || [];

  // Pays avec drapeaux
  const countryFlags = {
    FR: '🇫🇷', BE: '🇧🇪', CH: '🇨🇭', DE: '🇩🇪', ES: '🇪🇸', IT: '🇮🇹', NL: '🇳🇱', PT: '🇵🇹',
    AT: '🇦🇹', GB: '🇬🇧', IE: '🇮🇪', DK: '🇩🇰', SE: '🇸🇪', FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱',
    CZ: '🇨🇿', SK: '🇸🇰', HU: '🇭🇺', RO: '🇷🇴', BG: '🇧🇬', GR: '🇬🇷', HR: '🇭🇷', SI: '🇸🇮',
    LU: '🇱🇺', MC: '🇲🇨', AD: '🇦🇩', US: '🇺🇸', CA: '🇨🇦', AU: '🇦🇺', JP: '🇯🇵', CN: '🇨🇳'
  };

  const renderOrdersSection = () => (
    <div>
      {/* Header avec titre et période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#333', fontSize: '24px' }}>Commandes</h2>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: '13px' }}>
            Du {formatFullDate(dateFrom)} au {formatFullDate(dateTo)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <span style={{ color: '#666' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#666' }}>Chargement...</div>
      ) : ordersData ? (
        <>
          {/* KPIs principaux */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '15px', marginBottom: '20px' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Ventes Brutes</div>
              <div style={{ color: '#333', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.gross_sales)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Remboursements</div>
              <div style={{ color: '#dc3545', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.refunds)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Remises</div>
              <div style={{ color: '#f0ad4e', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.discounts)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>TVA</div>
              <div style={{ color: '#666', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.taxes)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Livraison</div>
              <div style={{ color: '#666', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.shipping)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Ventes Nettes</div>
              <div style={{ color: '#28a745', fontSize: '20px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.net_sales)}</div>
            </div>
          </div>

          {/* Ligne 2: Moyennes journalières */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '30px' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Net journalier</div>
              <div style={{ color: '#28a745', fontSize: '18px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.daily_net)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Commandes/jour</div>
              <div style={{ color: '#007bff', fontSize: '18px', fontWeight: '700' }}>{ordersData.kpis.daily_orders}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Articles/jour</div>
              <div style={{ color: '#6f42c1', fontSize: '18px', fontWeight: '700' }}>{ordersData.kpis.daily_items}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '15px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '5px' }}>Panier moyen</div>
              <div style={{ color: '#333', fontSize: '18px', fontWeight: '700' }}>{formatPrice(ordersData.kpis.avg_order_gross)}</div>
            </div>
          </div>

          {/* Graphique principal */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Commandes et ventes nettes</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={ordersChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="date" stroke="#666" fontSize={11} />
                <YAxis yAxisId="left" stroke="#007bff" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="#28a745" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px' }}
                  formatter={(value, name) => {
                    if (name === 'orders') return [value, 'Commandes'];
                    return [formatPrice(value), 'Ventes nettes'];
                  }}
                  labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                />
                <Bar yAxisId="left" dataKey="orders" fill="#007bff" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="netSales" stroke="#28a745" strokeWidth={2} dot={{ fill: '#28a745', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* New vs Returning */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Nouveaux vs Clients fidèles</h3>
              <span style={{ color: '#666', fontSize: '13px' }}>{ordersData.kpis.customers_count.toLocaleString('fr-FR')} clients</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Type</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes nettes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes brutes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. net</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. brut</th>
                </tr>
              </thead>
              <tbody>
                {ordersData.newVsReturning.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.type}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px' }}>{row.customers.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px' }}>{row.orders.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_net)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Statut */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par statut</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes nettes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes brutes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. brut</th>
                </tr>
              </thead>
              <tbody>
                {ordersData.byStatus.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.status}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.items.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.customers.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Méthode de paiement */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par méthode de paiement</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Méthode</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes nettes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes brutes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. brut</th>
                </tr>
              </thead>
              <tbody>
                {ordersData.byPayment.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.payment_method}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.items.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.customers.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Méthode de livraison */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par méthode de livraison</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Méthode</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes nettes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes brutes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. brut</th>
                </tr>
              </thead>
              <tbody>
                {ordersData.byShipping.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.shipping_method}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.items.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.customers.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Pays */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par pays de facturation</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Pays</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes nettes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Ventes brutes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moy. brut</th>
                </tr>
              </thead>
              <tbody>
                {ordersData.byCountry.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>
                      {countryFlags[row.country] || '🏳️'} {row.country}
                    </td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.items.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.customers.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Distributions et graphiques */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            {/* Distribution articles par commande */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Distribution nb articles</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersData.itemDistribution.slice(0, 20)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="item_count" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip formatter={(v) => [v, 'Commandes']} />
                  <Bar dataKey="orders_count" fill="#007bff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Distribution valeur commande */}
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Distribution valeur commande</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersData.valueDistribution.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="range" stroke="#666" fontSize={9} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip formatter={(v) => [v, 'Commandes']} />
                  <Bar dataKey="orders_count" fill="#28a745" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Panier moyen et articles moyens par jour */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Panier moyen par jour</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={avgOrderChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip formatter={(v) => [formatPrice(v), 'Panier moyen']} labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label} />
                  <Line type="monotone" dataKey="avgGross" stroke="#007bff" strokeWidth={2} dot={{ fill: '#007bff', r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Articles moyens par commande</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={avgOrderChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="date" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip formatter={(v) => [v, 'Articles']} labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label} />
                  <Line type="monotone" dataKey="avgItems" stroke="#6f42c1" strokeWidth={2} dot={{ fill: '#6f42c1', r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Dépenses par jour de semaine et par heure */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Ventes par jour de la semaine</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersData.spendByDayOfWeek}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="day" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [formatPrice(v), 'Ventes']} />
                  <Bar dataKey="total_sales" fill="#17a2b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Ventes par heure</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersData.spendByHour}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="hour_label" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [formatPrice(v), 'Ventes']} />
                  <Bar dataKey="total_sales" fill="#fd7e14" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Délai de traitement */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Délai entre création et complétion</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ordersData.fulfillmentTime.filter(f => f.range !== 'Non terminé')}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="range" stroke="#666" fontSize={11} />
                <YAxis stroke="#666" fontSize={11} />
                <Tooltip formatter={(v) => [v, 'Commandes']} />
                <Bar dataKey="orders_count" fill="#20c997" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : null}
    </div>
  );

  // Render Refunds Section
  const renderRefundsSection = () => (
    <div>
      {/* Header avec titre et période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#333', fontSize: '24px' }}>Remboursements</h2>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: '13px' }}>
            Du {formatFullDate(dateFrom)} au {formatFullDate(dateTo)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <span style={{ color: '#666' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>⏳</div>
          <div style={{ color: '#666' }}>Chargement...</div>
        </div>
      ) : refundsData ? (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '15px', marginBottom: '30px' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Montant remboursé</div>
              <div style={{ color: '#dc3545', fontSize: '24px', fontWeight: '700' }}>{formatPrice(refundsData.kpis.total_refunded)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Remboursements</div>
              <div style={{ color: '#dc3545', fontSize: '24px', fontWeight: '700' }}>{refundsData.kpis.refunds_count}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Remboursement moyen</div>
              <div style={{ color: '#333', fontSize: '24px', fontWeight: '700' }}>{formatPrice(refundsData.kpis.avg_refund)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Taux de remboursement</div>
              <div style={{ color: '#fd7e14', fontSize: '24px', fontWeight: '700' }}>{refundsData.kpis.refund_rate}%</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>% des ventes</div>
              <div style={{ color: '#fd7e14', fontSize: '24px', fontWeight: '700' }}>{refundsData.kpis.percent_of_sales}%</div>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef' }}>
              <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>Moy. / jour</div>
              <div style={{ color: '#6f42c1', fontSize: '24px', fontWeight: '700' }}>{formatPrice(refundsData.kpis.daily_amount)}</div>
            </div>
          </div>

          {/* Graphique par jour */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Remboursements par jour</h3>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={refundsData.breakdown.map(d => ({
                date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
                fullDate: new Date(d.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
                refunds: d.refunds_count,
                amount: parseFloat(d.refund_amount)
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="date" stroke="#666" fontSize={11} />
                <YAxis yAxisId="left" stroke="#dc3545" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="#fd7e14" fontSize={11} tickFormatter={(v) => `${v}€`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '8px' }}
                  formatter={(value, name) => {
                    if (name === 'refunds') return [value, 'Remboursements'];
                    return [formatPrice(value), 'Montant'];
                  }}
                  labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                />
                <Bar yAxisId="left" dataKey="refunds" fill="#dc3545" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="amount" stroke="#fd7e14" strokeWidth={2} dot={{ fill: '#fd7e14', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Délai commande → remboursement */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '20px', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <h3 style={{ margin: '0 0 15px', color: '#333', fontSize: '16px' }}>Délai entre commande et remboursement</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={refundsData.delayDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="range" stroke="#666" fontSize={11} />
                <YAxis stroke="#666" fontSize={11} />
                <Tooltip formatter={(v) => [v, 'Remboursements']} />
                <Bar dataKey="refunds_count" fill="#6f42c1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Par Raison */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par raison</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Raison</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Remboursements</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Montant</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {refundsData.byReason.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.reason}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px', fontWeight: '600' }}>{row.refunds_count}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.refunded_amount)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_refund)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Pays de facturation */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par pays de facturation</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Pays</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Remboursements</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Montant</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {refundsData.byBillingCountry.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.country}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px', fontWeight: '600' }}>{row.refunds_count}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.refunded_amount)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_refund)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Par Pays de livraison */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Par pays de livraison</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Pays</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Remboursements</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Montant</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Moyenne</th>
                </tr>
              </thead>
              <tbody>
                {refundsData.byShippingCountry.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.country}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px', fontWeight: '600' }}>{row.refunds_count}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.refunded_amount)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_refund)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );

  // Render By Country Section
  const renderByCountrySection = () => (
    <div>
      {/* Header avec titre et période */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#333', fontSize: '24px' }}>Rapport par Pays</h2>
          <p style={{ margin: '5px 0 0', color: '#666', fontSize: '13px' }}>
            Du {formatFullDate(dateFrom)} au {formatFullDate(dateTo)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <span style={{ color: '#666' }}>→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <div style={{ fontSize: '24px', marginBottom: '10px' }}>⏳</div>
          <div style={{ color: '#666' }}>Chargement...</div>
        </div>
      ) : byCountryData ? (
        <>
          {/* KPIs par pays */}
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef', marginBottom: '30px' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef' }}>
              <h3 style={{ margin: 0, color: '#333', fontSize: '16px' }}>Performance par pays</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Pays</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>CA Brut</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>CA Net</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Panier moy.</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Clients</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Remb.</th>
                  <th style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Montant remb.</th>
                  <th style={{ padding: '12px 15px', textAlign: 'center', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Détails</th>
                </tr>
              </thead>
              <tbody>
                {byCountryData.kpisByCountry.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e9ecef', backgroundColor: selectedCountry === row.country ? '#e3f2fd' : 'transparent' }}>
                    <td style={{ padding: '12px 15px', color: '#333', fontSize: '13px', fontWeight: '600' }}>{row.country}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#007bff', fontSize: '13px', fontWeight: '600' }}>{row.orders_count.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#333', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#28a745', fontSize: '13px' }}>{formatPrice(row.net_sales)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{formatPrice(row.avg_order)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#666', fontSize: '13px' }}>{row.customers_count.toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{row.refunds_count}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'right', color: '#dc3545', fontSize: '13px' }}>{formatPrice(row.refunds_amount)}</td>
                    <td style={{ padding: '12px 15px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleCountrySelect(row.country)}
                        style={{
                          padding: '5px 12px',
                          backgroundColor: selectedCountry === row.country ? '#007bff' : '#f8f9fa',
                          color: selectedCountry === row.country ? '#fff' : '#333',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        {selectedCountry === row.country ? '✓ Sélectionné' : 'Voir'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Détails du pays sélectionné */}
          {byCountryData.countryDetails && (
            <>
              <h3 style={{ color: '#333', fontSize: '18px', marginBottom: '20px' }}>
                Détails pour : <span style={{ color: '#007bff' }}>{byCountryData.countryDetails.country}</span>
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '30px' }}>
                {/* Top 5 Produits */}
                <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef' }}>
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef', backgroundColor: '#f8f9fa' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>🏆 Top 5 Produits</h4>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '10px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600' }}>Produit</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>Qté</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCountryData.countryDetails.topProducts.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 15px', color: '#333', fontSize: '12px' }}>{item.product_name}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#007bff', fontSize: '12px', fontWeight: '600' }}>{item.quantity_sold}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#28a745', fontSize: '12px' }}>{formatPrice(item.total_sales)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Top 3 Catégories */}
                <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef' }}>
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef', backgroundColor: '#f8f9fa' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>📂 Top 3 Catégories</h4>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '10px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600' }}>Catégorie</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>Qté</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>CA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCountryData.countryDetails.topCategories.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 15px', color: '#333', fontSize: '12px' }}>{item.category}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#007bff', fontSize: '12px', fontWeight: '600' }}>{item.quantity_sold}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#28a745', fontSize: '12px' }}>{formatPrice(item.total_sales)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Top 3 Transporteurs */}
                <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef' }}>
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef', backgroundColor: '#f8f9fa' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>🚚 Top 3 Transporteurs</h4>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '10px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600' }}>Transporteur</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>Commandes</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCountryData.countryDetails.topShipping.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 15px', color: '#333', fontSize: '12px' }}>{item.shipping_method}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#007bff', fontSize: '12px', fontWeight: '600' }}>{item.orders_count}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#6f42c1', fontSize: '12px' }}>{item.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Top 3 Paiements */}
                <div style={{ backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e9ecef' }}>
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid #e9ecef', backgroundColor: '#f8f9fa' }}>
                    <h4 style={{ margin: 0, color: '#333', fontSize: '14px' }}>💳 Top 3 Paiements</h4>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '10px 15px', textAlign: 'left', color: '#666', fontSize: '11px', fontWeight: '600' }}>Méthode</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>Commandes</th>
                        <th style={{ padding: '10px 15px', textAlign: 'right', color: '#666', fontSize: '11px', fontWeight: '600' }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCountryData.countryDetails.topPayment.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 15px', color: '#333', fontSize: '12px' }}>{item.payment_method}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#007bff', fontSize: '12px', fontWeight: '600' }}>{item.orders_count}</td>
                          <td style={{ padding: '10px 15px', textAlign: 'right', color: '#6f42c1', fontSize: '12px' }}>{item.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!byCountryData.countryDetails && (
            <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8f9fa', borderRadius: '8px', color: '#666' }}>
              <p style={{ fontSize: '16px', marginBottom: '10px' }}>👆 Cliquez sur "Voir" pour afficher les détails d'un pays</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: '20px', minHeight: '700px' }}>
      {/* Sidebar gauche */}
      <div style={{
        width: '220px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        padding: '15px 0',
        flexShrink: 0,
        border: '1px solid #e9ecef'
      }}>
        <div style={{ padding: '10px 20px', color: '#666', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Rapports
        </div>
        {REPORT_SECTIONS.map(section => (
          <div
            key={section.id}
            onClick={() => !section.disabled && setActiveSection(section.id)}
            style={{
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: section.disabled ? 'not-allowed' : 'pointer',
              backgroundColor: activeSection === section.id ? '#e3f2fd' : 'transparent',
              borderLeft: activeSection === section.id ? '3px solid #007bff' : '3px solid transparent',
              color: section.disabled ? '#aaa' : (activeSection === section.id ? '#007bff' : '#333'),
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            <span>{section.icon}</span>
            <span>{section.label}</span>
            {section.disabled && <span style={{ fontSize: '10px', color: '#999' }}>(bientôt)</span>}
          </div>
        ))}
      </div>

      {/* Contenu principal */}
      <div style={{ flex: 1 }}>
        {activeSection === 'revenue' && renderRevenueSection()}
        {activeSection === 'profit' && renderProfitSection()}
        {activeSection === 'orders' && renderOrdersSection()}
        {activeSection === 'refunds' && renderRefundsSection()}
        {activeSection === 'by-country' && renderByCountrySection()}

        {activeSection !== 'revenue' && activeSection !== 'profit' && activeSection !== 'orders' && activeSection !== 'refunds' && activeSection !== 'by-country' && (
          <div style={{ textAlign: 'center', padding: '100px', color: '#666' }}>
            <p style={{ fontSize: '48px', marginBottom: '20px' }}>🚧</p>
            <p>Cette section sera disponible prochainement</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportsTab;
