import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/**
 * Graphique d'évolution des ventes dans le temps
 * Combine barres (revenue) et lignes (quantity, profit)
 */
const SalesTimelineChart = ({ data, height = 400 }) => {
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: 'white',
          padding: '12px',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#333' }}>
            {formatDate(label)}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ margin: '4px 0', fontSize: '13px', color: entry.color }}>
              {entry.name}: <strong>
                {entry.name.includes('Revenue') || entry.name.includes('Profit')
                  ? formatCurrency(entry.value)
                  : formatNumber(entry.value)}
              </strong>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 12 }}
          tickFormatter={formatDate}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 12 }}
          tickFormatter={formatCurrency}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 12 }}
          tickFormatter={formatNumber}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: '13px' }}
          iconType="line"
        />
        <Bar
          yAxisId="left"
          dataKey="revenue"
          fill="#135E84"
          fillOpacity={0.8}
          name="Revenue"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="quantity_sold"
          stroke="#28a745"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Quantité vendue"
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="profit"
          stroke="#007bff"
          strokeWidth={2}
          dot={{ r: 3 }}
          name="Profit"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default SalesTimelineChart;
