import { useState } from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

/**
 * Graphique avancé d'évolution des ventes
 * - Deux axes Y (€ à gauche, quantité à droite)
 * - Sélection de métriques à afficher
 * - Filtres de période avec date picker
 * - Comparaison de période
 */
const AdvancedSalesChart = ({
  data,
  comparisonData = null,
  height = 400,
  onPeriodChange
}) => {
  // États pour les métriques affichées
  const [showQuantity, setShowQuantity] = useState(true);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showProfit, setShowProfit] = useState(true);

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

  // Déterminer si les données couvrent plusieurs années
  const hasMultipleYears = data.length > 1 && (() => {
    const years = new Set(data.map(d => new Date(d.period).getFullYear()));
    return years.size > 1;
  })();

  // Déterminer si c'est un groupement par mois (dates au 1er du mois)
  const isMonthlyGrouping = data.length > 1 && data.every(d => {
    const date = new Date(d.period);
    return date.getDate() === 1;
  });

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);

    // Si groupement par mois, afficher mois + année
    if (isMonthlyGrouping) {
      return date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    }

    // Si plusieurs années, inclure l'année
    if (hasMultipleYears) {
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
    }

    // Par défaut : jour + mois
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  };

  const formatTooltipDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    // Toujours afficher le format complet dans le tooltip
    if (isMonthlyGrouping) {
      return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: 'white',
          padding: '12px 16px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: '0 0 10px 0', fontWeight: '600', color: '#333', fontSize: '14px' }}>
            {formatTooltipDate(label)}
          </p>
          {payload.map((entry, index) => (
            <p key={index} style={{ margin: '4px 0', fontSize: '13px', color: entry.color, display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <span>{entry.name}:</span>
              <strong>
                {entry.name.includes('CA') || entry.name.includes('Profit')
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

  // Combiner les données principales et de comparaison
  const chartData = comparisonData
    ? data.map((item, idx) => ({
        ...item,
        comparison_quantity: comparisonData[idx]?.quantity_sold || 0,
        comparison_revenue: comparisonData[idx]?.revenue || 0,
        comparison_profit: comparisonData[idx]?.profit || 0,
      }))
    : data;

  return (
    <div>
      {/* Contrôles de métriques */}
      <div style={{
        display: 'flex',
        gap: '20px',
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#666' }}>Afficher :</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={showQuantity}
            onChange={(e) => setShowQuantity(e.target.checked)}
            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
          />
          <span style={{ color: showQuantity ? '#28a745' : '#999' }}>Quantité vendue</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={showRevenue}
            onChange={(e) => setShowRevenue(e.target.checked)}
            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
          />
          <span style={{ color: showRevenue ? '#135E84' : '#999' }}>Chiffre d'affaires</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
          <input
            type="checkbox"
            checked={showProfit}
            onChange={(e) => setShowProfit(e.target.checked)}
            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
          />
          <span style={{ color: showProfit ? '#007bff' : '#999' }}>Profit</span>
        </label>
      </div>

      {/* Graphique */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, angle: -45, textAnchor: 'end', dy: 5 }}
            tickFormatter={formatDate}
            interval={0}
            height={80}
          />

          {/* Axe Y gauche pour les montants (€) */}
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 12 }}
            tickFormatter={formatCurrency}
            label={{
              value: 'Montant (€)',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 12, fill: '#666' }
            }}
          />

          {/* Axe Y droit pour les quantités */}
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 12 }}
            tickFormatter={formatNumber}
            label={{
              value: 'Quantité (unités)',
              angle: 90,
              position: 'insideRight',
              style: { fontSize: 12, fill: '#666' }
            }}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '13px', paddingTop: '20px' }}
            iconType="line"
          />

          {/* Chiffre d'affaires (Aires) */}
          {showRevenue && (
            <>
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="revenue"
                fill="#135E84"
                fillOpacity={0.2}
                stroke="#135E84"
                strokeWidth={2}
                name="CA"
              />
              {comparisonData && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="comparison_revenue"
                  fill="#fd7e14"
                  fillOpacity={0.1}
                  stroke="#fd7e14"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  name="CA (comparaison)"
                />
              )}
            </>
          )}

          {/* Quantité (Barres) */}
          {showQuantity && (
            <>
              <Bar
                yAxisId="right"
                dataKey="quantity_sold"
                fill="#28a745"
                fillOpacity={0.8}
                name="Quantité"
              />
              {comparisonData && (
                <Bar
                  yAxisId="right"
                  dataKey="comparison_quantity"
                  fill="#ffc107"
                  fillOpacity={0.6}
                  name="Quantité (comparaison)"
                />
              )}
            </>
          )}

          {/* Profit (Courbe) */}
          {showProfit && (
            <>
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="profit"
                stroke="#007bff"
                strokeWidth={3}
                dot={{ r: 4, fill: '#007bff' }}
                name="Profit"
              />
              {comparisonData && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="comparison_profit"
                  stroke="#dc3545"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3, fill: '#dc3545' }}
                  name="Profit (comparaison)"
                />
              )}
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AdvancedSalesChart;
