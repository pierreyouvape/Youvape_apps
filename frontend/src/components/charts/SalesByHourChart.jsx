import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * Graphique des ventes par heure de la journée
 */
const SalesByHourChart = ({ data, height = 300 }) => {
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

  // S'assurer que toutes les heures 0-23 sont représentées
  const fullData = Array.from({ length: 24 }, (_, hour) => {
    const existing = data.find(d => d.hour === hour);
    return existing || { hour, quantity_sold: 0, revenue: 0 };
  });

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
            {label}h
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ margin: '4px 0', fontSize: '13px', color: entry.color }}>
              {entry.name}: <strong>
                {entry.name.includes('Revenue')
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
      <BarChart data={fullData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 11 }}
          tickFormatter={(hour) => `${hour}h`}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={formatCurrency}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar
          dataKey="revenue"
          fill="#135E84"
          name="Revenue"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default SalesByHourChart;
