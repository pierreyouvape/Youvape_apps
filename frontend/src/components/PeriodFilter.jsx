import { useState } from 'react';

/**
 * Composant de filtre de période avec sélection rapide et date picker
 * Supporte la comparaison de période
 */
const PeriodFilter = ({ onPeriodChange, onComparisonChange }) => {
  const [selectedPeriod, setSelectedPeriod] = useState('30d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [enableComparison, setEnableComparison] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState('previous');
  const [comparisonStartDate, setComparisonStartDate] = useState('');
  const [comparisonEndDate, setComparisonEndDate] = useState('');
  const [groupBy, setGroupBy] = useState('day');

  // Calculer les dates selon la période sélectionnée
  const calculateDates = (period) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end;

    switch (period) {
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
        start = new Date(today);
        start.setDate(start.getDate() - 29);
        end = today;
    }

    return { start, end };
  };

  // Calculer la période de comparaison
  const calculateComparisonDates = (mainStart, mainEnd, compType) => {
    if (compType === 'custom' && comparisonStartDate && comparisonEndDate) {
      return {
        start: new Date(comparisonStartDate),
        end: new Date(comparisonEndDate)
      };
    }

    // Période précédente de même durée
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

  const handleApply = () => {
    const { start, end } = calculateDates(selectedPeriod);

    if (!start || !end) {
      alert('Veuillez sélectionner des dates valides');
      return;
    }

    onPeriodChange({
      start: formatDateForInput(start),
      end: formatDateForInput(end),
      groupBy
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

  return (
    <div style={{
      backgroundColor: '#fff',
      padding: '20px',
      borderRadius: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      marginBottom: '20px'
    }}>
      {/* Titre */}
      <h3 style={{ margin: '0 0 20px 0', color: '#333', fontSize: '16px' }}>📅 Filtres de période</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
        {/* Colonne gauche : Période principale */}
        <div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: '#666' }}>
              Période principale
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
              {[
                { value: '7d', label: '7 derniers jours' },
                { value: '30d', label: '30 derniers jours' },
                { value: 'current_month', label: 'Mois en cours' },
                { value: 'last_month', label: 'Mois dernier' },
                { value: 'custom', label: 'Personnalisé' }
              ].map(period => (
                <button
                  key={period.value}
                  onClick={() => setSelectedPeriod(period.value)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: selectedPeriod === period.value ? '#135E84' : '#f0f0f0',
                    color: selectedPeriod === period.value ? 'white' : '#666',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    transition: 'all 0.2s'
                  }}
                >
                  {period.label}
                </button>
              ))}
            </div>

            {selectedPeriod === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '15px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#666' }}>
                    Date de début
                  </label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#666' }}>
                    Date de fin
                  </label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontSize: '13px', fontWeight: '600', color: '#666' }}>
              Grouper par
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[
                { value: 'day', label: 'Jour' },
                { value: 'week', label: 'Semaine' },
                { value: 'month', label: 'Mois' }
              ].map(group => (
                <button
                  key={group.value}
                  onClick={() => setGroupBy(group.value)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: groupBy === group.value ? '#135E84' : '#f0f0f0',
                    color: groupBy === group.value ? 'white' : '#666',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  {group.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Colonne droite : Comparaison */}
        <div style={{
          borderLeft: '1px solid #e0e0e0',
          paddingLeft: '30px'
        }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enableComparison}
                onChange={(e) => setEnableComparison(e.target.checked)}
                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#666' }}>
                Comparer avec une autre période
              </span>
            </label>
          </div>

          {enableComparison && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
                <button
                  onClick={() => setComparisonPeriod('previous')}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: comparisonPeriod === 'previous' ? '#fd7e14' : '#f0f0f0',
                    color: comparisonPeriod === 'previous' ? 'white' : '#666',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  Période précédente
                </button>
                <button
                  onClick={() => setComparisonPeriod('custom')}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: comparisonPeriod === 'custom' ? '#fd7e14' : '#f0f0f0',
                    color: comparisonPeriod === 'custom' ? 'white' : '#666',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  Personnalisée
                </button>
              </div>

              {comparisonPeriod === 'custom' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '15px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#666' }}>
                      Date de début
                    </label>
                    <input
                      type="date"
                      value={comparisonStartDate}
                      onChange={(e) => setComparisonStartDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '12px', color: '#666' }}>
                      Date de fin
                    </label>
                    <input
                      type="date"
                      value={comparisonEndDate}
                      onChange={(e) => setComparisonEndDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bouton Appliquer */}
      <div style={{ marginTop: '20px', textAlign: 'right' }}>
        <button
          onClick={handleApply}
          style={{
            padding: '10px 30px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(40, 167, 69, 0.2)'
          }}
        >
          Appliquer les filtres
        </button>
      </div>
    </div>
  );
};

export default PeriodFilter;
