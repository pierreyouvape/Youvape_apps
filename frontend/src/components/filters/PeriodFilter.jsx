import { useState } from 'react';
import PropTypes from 'prop-types';

const PeriodFilter = ({ onChange, defaultPeriod = '30d' }) => {
  const [period, setPeriod] = useState(defaultPeriod);

  const periods = [
    { value: '24h', label: "Aujourd'hui" },
    { value: '7d', label: '7 derniers jours' },
    { value: '30d', label: '30 derniers jours' },
    { value: '90d', label: '90 derniers jours' },
    { value: '1y', label: 'Cette année' },
    { value: 'all', label: 'Tout' }
  ];

  const handleChange = (e) => {
    const newPeriod = e.target.value;
    setPeriod(newPeriod);
    onChange(newPeriod);
  };

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      <label
        htmlFor="period-select"
        style={{
          fontSize: '14px',
          fontWeight: '600',
          color: '#333'
        }}
      >
        Période :
      </label>
      <select
        id="period-select"
        value={period}
        onChange={handleChange}
        style={{
          padding: '8px 12px',
          fontSize: '14px',
          border: '1px solid #ccc',
          borderRadius: '6px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          outline: 'none'
        }}
      >
        {periods.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
};

PeriodFilter.propTypes = {
  onChange: PropTypes.func.isRequired,
  defaultPeriod: PropTypes.string
};

export default PeriodFilter;
