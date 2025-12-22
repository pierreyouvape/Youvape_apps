import { useState, useEffect } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

// Menu latéral des sous-rapports
const REPORT_SECTIONS = [
  { id: 'revenue', label: 'Chiffre d\'affaires', icon: '💰' },
  { id: 'profit', label: 'Profit', icon: '📈', disabled: true },
  { id: 'orders', label: 'Commandes', icon: '📦', disabled: true },
  { id: 'refunds', label: 'Remboursements', icon: '↩️', disabled: true },
  { id: 'by-country', label: 'Par Pays', icon: '🌍', disabled: true },
  { id: 'by-tax', label: 'Par TVA', icon: '🧾', disabled: true },
];

const ReportsTab = () => {
  const [activeSection, setActiveSection] = useState('revenue');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  // Période par défaut: mois en cours
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth.toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);

  useEffect(() => {
    if (activeSection === 'revenue') {
      fetchRevenueReport();
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

  // Préparer les données pour le graphique
  const chartData = data?.breakdown?.map(item => ({
    date: formatDate(item.date),
    fullDate: formatFullDate(item.date),
    ca: parseFloat(item.gross_sales),
    net: parseFloat(item.net)
  })) || [];

  // Calculer les totaux du tableau
  const totals = data?.breakdown?.reduce((acc, item) => ({
    orders: acc.orders + item.orders_count,
    gross: acc.gross + parseFloat(item.gross_sales),
    taxes: acc.taxes + parseFloat(item.taxes),
    shipping: acc.shipping + parseFloat(item.shipping),
    fees: acc.fees + parseFloat(item.fees),
    refunds: acc.refunds + parseFloat(item.refunds),
    net: acc.net + parseFloat(item.net)
  }), { orders: 0, gross: 0, taxes: 0, shipping: 0, fees: 0, refunds: 0, net: 0 });

  return (
    <div style={{ display: 'flex', gap: '20px', minHeight: '700px' }}>
      {/* Sidebar gauche */}
      <div style={{
        width: '220px',
        backgroundColor: '#1a1a2e',
        borderRadius: '8px',
        padding: '15px 0',
        flexShrink: 0
      }}>
        <div style={{ padding: '10px 20px', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
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
              backgroundColor: activeSection === section.id ? '#2d2d44' : 'transparent',
              borderLeft: activeSection === section.id ? '3px solid #007bff' : '3px solid transparent',
              color: section.disabled ? '#555' : (activeSection === section.id ? '#fff' : '#aaa'),
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            <span>{section.icon}</span>
            <span>{section.label}</span>
            {section.disabled && <span style={{ fontSize: '10px', color: '#666' }}>(bientôt)</span>}
          </div>
        ))}
      </div>

      {/* Contenu principal */}
      <div style={{ flex: 1 }}>
        {activeSection === 'revenue' && (
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
                    backgroundColor: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '20px'
                  }}>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="colorCa" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis dataKey="date" stroke="#666" fontSize={11} />
                        <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#2d2d44', border: 'none', borderRadius: '8px' }}
                          labelStyle={{ color: '#fff' }}
                          formatter={(value) => [formatPrice(value), 'CA Brut']}
                          labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
                        />
                        <Area
                          type="monotone"
                          dataKey="ca"
                          stroke="#6366f1"
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
                    backgroundColor: '#1a1a2e',
                    borderRadius: '8px',
                    padding: '20px'
                  }}>
                    <h3 style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '20px' }}>
                      Sur la période
                    </h3>

                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ color: '#aaa', fontSize: '13px' }}>CA Net</span>
                        <span style={{ color: '#fff', fontSize: '18px', fontWeight: '700' }}>{formatPrice(data.kpis.net_revenue)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ color: '#aaa', fontSize: '13px' }}>CA Brut</span>
                        <span style={{ color: '#10b981', fontSize: '14px', fontWeight: '600' }}>{formatPrice(data.kpis.gross_sales)}</span>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginBottom: '15px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#888', fontSize: '12px' }}>Remboursements</span>
                        <span style={{ color: '#ef4444', fontSize: '13px' }}>({formatPrice(data.kpis.refunds)})</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#888', fontSize: '12px' }}>Taxes</span>
                        <span style={{ color: '#ef4444', fontSize: '13px' }}>({formatPrice(data.kpis.taxes)})</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#888', fontSize: '12px' }}>Livraison</span>
                        <span style={{ color: '#ef4444', fontSize: '13px' }}>({formatPrice(data.kpis.shipping)})</span>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid #333', paddingTop: '15px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#aaa', fontSize: '13px' }}>Commandes</span>
                        <span style={{ color: '#fff', fontSize: '16px', fontWeight: '600' }}>{data.kpis.orders_count.toLocaleString('fr-FR')}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#aaa', fontSize: '13px' }}>Panier moyen net</span>
                        <span style={{ color: '#fff', fontSize: '14px', fontWeight: '600' }}>{formatPrice(data.kpis.avg_order_net)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tableau détaillé jour par jour */}
                <div style={{
                  backgroundColor: '#1a1a2e',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}>
                  <div style={{ padding: '15px 20px', borderBottom: '1px solid #333' }}>
                    <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>Détail par jour</h3>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#2d2d44' }}>
                          <th style={{ padding: '12px 15px', textAlign: 'left', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Date</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Commandes</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>CA Brut</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Taxes</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Livraison</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Frais</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Remboursements</th>
                          <th style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.breakdown.map((row, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #2d2d44' }}>
                            <td style={{ padding: '12px 15px', color: '#fff', fontSize: '13px' }}>{formatFullDate(row.date)}</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#6366f1', fontSize: '13px', fontWeight: '600' }}>{row.orders_count}</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#10b981', fontSize: '13px' }}>{formatPrice(row.gross_sales)}</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#ef4444', fontSize: '13px' }}>({formatPrice(row.taxes)})</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#ef4444', fontSize: '13px' }}>({formatPrice(row.shipping)})</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '13px' }}>{formatPrice(row.fees)}</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#888', fontSize: '13px' }}>{formatPrice(row.refunds)}</td>
                            <td style={{ padding: '12px 15px', textAlign: 'right', color: '#fff', fontSize: '13px', fontWeight: '600' }}>{formatPrice(row.net)}</td>
                          </tr>
                        ))}
                        {/* Ligne des totaux */}
                        {totals && (
                          <tr style={{ backgroundColor: '#2d2d44', fontWeight: '700' }}>
                            <td style={{ padding: '15px', color: '#fff', fontSize: '14px' }}>Totaux</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#6366f1', fontSize: '14px' }}>{totals.orders.toLocaleString('fr-FR')}</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#10b981', fontSize: '14px' }}>{formatPrice(totals.gross)}</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#ef4444', fontSize: '14px' }}>({formatPrice(totals.taxes)})</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#ef4444', fontSize: '14px' }}>({formatPrice(totals.shipping)})</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#888', fontSize: '14px' }}>{formatPrice(totals.fees)}</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#888', fontSize: '14px' }}>{formatPrice(totals.refunds)}</td>
                            <td style={{ padding: '15px', textAlign: 'right', color: '#fff', fontSize: '14px' }}>{formatPrice(totals.net)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {activeSection !== 'revenue' && (
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
