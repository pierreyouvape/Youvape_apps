import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/**
 * Graphique circulaire des ventes par pays
 */
const SalesByCountryPieChart = ({ data, height = 350 }) => {
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0
    }).format(value);
  };

  // Couleurs pour les pays (palette cohérente)
  const COLORS = [
    '#135E84', '#28a745', '#007bff', '#fd7e14',
    '#8b5cf6', '#ff6b6b', '#ffc107', '#17a2b8',
    '#6c757d', '#e83e8c'
  ];

  // Préparer les données pour le pie chart (top 5 pays + "Autres")
  let chartData = [...data].sort((a, b) => parseFloat(b.net_revenue) - parseFloat(a.net_revenue));

  if (chartData.length > 5) {
    const top5 = chartData.slice(0, 5);
    const others = chartData.slice(5);
    const othersTotal = others.reduce((sum, item) => sum + parseFloat(item.net_revenue), 0);

    chartData = [
      ...top5,
      {
        shipping_country: 'Autres',
        net_revenue: othersTotal.toFixed(2),
        net_sold: others.reduce((sum, item) => sum + parseInt(item.net_sold), 0),
        net_orders: others.reduce((sum, item) => sum + parseInt(item.net_orders), 0)
      }
    ];
  }

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: 'white',
          padding: '12px',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#333' }}>
            {data.shipping_country}
          </p>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#28a745' }}>
            Revenue: <strong>{formatCurrency(data.net_revenue)}</strong>
          </p>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
            Commandes: <strong>{data.net_orders}</strong>
          </p>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
            Quantité: <strong>{data.net_sold}</strong>
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null; // Ne pas afficher si < 5%

    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize="13px"
        fontWeight="600"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={renderCustomLabel}
          outerRadius={120}
          fill="#8884d8"
          dataKey="net_revenue"
          nameKey="shipping_country"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          verticalAlign="bottom"
          height={36}
          wrapperStyle={{ fontSize: '13px' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default SalesByCountryPieChart;
