import { useState } from 'react';

/**
 * Composant de filtre de période compact
 * Version condensée pour s'intégrer en haut à droite du graphique
 */
const PeriodFilter = ({ onPeriodChange, onComparisonChange, defaultPeriod = 'all' }) => {
  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [enableComparison, setEnableComparison] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState('previous');
  const [comparisonStartDate, setComparisonStartDate] = useState('');
  const [comparisonEndDate, setComparisonEndDate] = useState('');
  const [groupBy, setGroupBy] = useState('day');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Conserver les dates calculées actuellement appliquées
  const [currentStartDate, setCurrentStartDate] = useState(null);
  const [currentEndDate, setCurrentEndDate] = useState(null);

  const calculateDates = (period) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end;

    switch (period) {
      case 'all':
        // Pas de dates = depuis la création (toutes les données)
        start = null;
        end = null;
        break;
      case '7d':
        start = new Date(today);
        start.setDate(start.getDate() - 6);
        end = today;
        break;
      case '30d':
        start = new Date(today);
        start.setDate(start.getDate() - 29);
        end = today;
        break;
      case 'current_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = today;
        break;
      case 'last_month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'custom':
        if (customStartDate && customEndDate) {
          start = new Date(customStartDate);
          end = new Date(customEndDate);
        }
        break;
      default:
        // Par défaut = toutes les données
        start = null;
        end = null;
    }

    return { start, end };
  };

  const calculateComparisonDates = (mainStart, mainEnd, compType) => {
    if (compType === 'custom' && comparisonStartDate && comparisonEndDate) {
      return {
        start: new Date(comparisonStartDate),
        end: new Date(comparisonEndDate)
      };
    }

    const duration = mainEnd - mainStart;
    const compEnd = new Date(mainStart);
    compEnd.setDate(compEnd.getDate() - 1);
    const compStart = new Date(compEnd);
    compStart.setTime(compStart.getTime() - duration);

    return { start: compStart, end: compEnd };
  };

  const formatDateForInput = (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  const handlePeriodClick = (period) => {
    setSelectedPeriod(period);
    if (period !== 'custom') {
      applyFilters(period, groupBy);
    }
  };

  const handleGroupByClick = (group) => {
    setGroupBy(group);
    // Ne pas recalculer les dates, juste changer le groupBy avec les dates actuelles
    onPeriodChange({
      start: currentStartDate,
      end: currentEndDate,
      groupBy: group
    });
  };

  const applyFilters = (period = selectedPeriod, group = groupBy) => {
    const { start, end } = calculateDates(period);

    // Formater les dates
    const formattedStart = start ? formatDateForInput(start) : null;
    const formattedEnd = end ? formatDateForInput(end) : null;

    // Sauvegarder les dates actuelles pour le changement de groupBy
    setCurrentStartDate(formattedStart);
    setCurrentEndDate(formattedEnd);

    // Pour 'all', on envoie null pour les dates
    onPeriodChange({
      start: formattedStart,
      end: formattedEnd,
      groupBy: group
    });

    if (enableComparison) {
      const compDates = calculateComparisonDates(start, end, comparisonPeriod);
      onComparisonChange({
        start: formatDateForInput(compDates.start),
        end: formatDateForInput(compDates.end)
      });
    } else {
      onComparisonChange(null);
    }
  };

  const handleCustomApply = () => {
    if (!customStartDate || !customEndDate) {
      alert('Veuillez sélectionner les dates');
      return;
    }
    applyFilters('custom', groupBy);
    setShowAdvanced(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
      {/* Période rapide */}
      {[
        { value: 'all', label: 'Tout' },
        { value: '7d', label: '7j' },
        { value: '30d', label: '30j' },
        { value: 'current_month', label: 'Mois en cours' },
        { value: 'last_month', label: 'Mois dernier' }
      ].map(period => (
        <button
          key={period.value}
          onClick={() => handlePeriodClick(period.value)}
          style={{
            padding: '6px 12px',
            backgroundColor: selectedPeriod === period.value ? '#135E84' : '#f0f0f0',
            color: selectedPeriod === period.value ? 'white' : '#666',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          {period.label}
        </button>
      ))}

      {/* Séparateur vertical */}
      <div style={{ height: '24px', width: '1px', backgroundColor: '#ddd', margin: '0 5px' }}></div>

      {/* Grouper par - avec label visible */}
      {['day', 'week', 'month'].map(group => (
        <button
          key={group}
          onClick={() => handleGroupByClick(group)}
          style={{
            padding: '6px 12px',
            backgroundColor: groupBy === group ? '#135E84' : '#f0f0f0',
            color: groupBy === group ? 'white' : '#666',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          {group === 'day' ? 'Jour' : group === 'week' ? 'Semaine' : 'Mois'}
        </button>
      ))}

      {/* Bouton options avancées */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{
          padding: '6px 12px',
          backgroundColor: showAdvanced ? '#fd7e14' : '#f0f0f0',
          color: showAdvanced ? 'white' : '#666',
          border: 'none',
          borderRadius: '6px',
          fontSize: '12px',
          cursor: 'pointer',
          fontWeight: '500',
          marginLeft: 'auto'
        }}
      >
        {showAdvanced ? '✕ Fermer' : '⚙️ Options'}
      </button>

      {/* Panel avancé */}
      {showAdvanced && (
        <div style={{
          width: '100%',
          marginTop: '10px',
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Période personnalisée */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '10px' }}>
                Période personnalisée
              </div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  placeholder="Début"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  placeholder="Fin"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
              </div>
              <button
                onClick={handleCustomApply}
                style={{
                  padding: '6px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Appliquer
              </button>
            </div>

            {/* Comparaison */}
            <div>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                  <input
                    type="checkbox"
                    checked={enableComparison}
                    onChange={(e) => {
                      setEnableComparison(e.target.checked);
                      if (!e.target.checked) {
                        onComparisonChange(null);
                      } else {
                        applyFilters();
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                  Comparer avec
                </label>
              </div>

              {enableComparison && (
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                    <button
                      onClick={() => {
                        setComparisonPeriod('previous');
                        applyFilters();
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: comparisonPeriod === 'previous' ? '#fd7e14' : '#f0f0f0',
                        color: comparisonPeriod === 'previous' ? 'white' : '#666',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Période précédente
                    </button>
                    <button
                      onClick={() => setComparisonPeriod('custom')}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: comparisonPeriod === 'custom' ? '#fd7e14' : '#f0f0f0',
                        color: comparisonPeriod === 'custom' ? 'white' : '#666',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Personnalisée
                    </button>
                  </div>

                  {comparisonPeriod === 'custom' && (
                    <div>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <input
                          type="date"
                          value={comparisonStartDate}
                          onChange={(e) => setComparisonStartDate(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            fontSize: '12px'
                          }}
                        />
                        <input
                          type="date"
                          value={comparisonEndDate}
                          onChange={(e) => setComparisonEndDate(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            border: '1px solid #ddd',
                            borderRadius: '6px',
                            fontSize: '12px'
                          }}
                        />
                      </div>
                      <button
                        onClick={applyFilters}
                        style={{
                          padding: '6px 16px',
                          backgroundColor: '#fd7e14',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Appliquer
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PeriodFilter;
