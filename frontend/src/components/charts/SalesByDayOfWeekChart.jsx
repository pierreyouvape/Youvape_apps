import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/**
 * Graphique des ventes par jour de la semaine
 */
const SalesByDayOfWeekChart = ({ data, height = 350 }) => {
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

  // Mapper les jours en français
  const dayNames = {
    0: 'Dimanche',
    1: 'Lundi',
    2: 'Mardi',
    3: 'Mercredi',
    4: 'Jeudi',
    5: 'Vendredi',
    6: 'Samedi'
  };

  // Transformer les données pour afficher les noms en français
  const formattedData = data.map(item => ({
    ...item,
    day_name_fr: dayNames[item.day_of_week] || item.day_name.trim()
  })).sort((a, b) => a.day_of_week - b.day_of_week);

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
            {label}
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
      <BarChart data={formattedData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis
          dataKey="day_name_fr"
          tick={{ fontSize: 12 }}
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
        />
        <Bar
          yAxisId="left"
          dataKey="revenue"
          fill="#135E84"
          name="Revenue"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          yAxisId="right"
          dataKey="quantity_sold"
          fill="#28a745"
          name="Quantité"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default SalesByDayOfWeekChart;
