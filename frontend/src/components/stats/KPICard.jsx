import PropTypes from 'prop-types';

const KPICard = ({ title, value, icon, color, subtitle, trend }) => {
  return (
    <div
      style={{
        padding: '25px',
        backgroundColor: '#fff',
        borderRadius: '12px',
        border: '2px solid #e0e0e0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        textAlign: 'center',
        position: 'relative',
        transition: 'transform 0.2s, box-shadow 0.2s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
      }}
    >
      {/* Icon */}
      {icon && (
        <div style={{ fontSize: '48px', marginBottom: '10px' }}>
          {icon}
        </div>
      )}

      {/* Value */}
      <div
        style={{
          fontSize: '32px',
          fontWeight: 'bold',
          color: color || '#135E84',
          marginBottom: '5px'
        }}
      >
        {value}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: '14px',
          color: '#6c757d',
          textTransform: 'uppercase',
          letterSpacing: '1px',
          marginBottom: subtitle ? '5px' : '0'
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            fontSize: '12px',
            color: '#999',
            marginTop: '5px'
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Trend indicator */}
      {trend !== undefined && trend !== null && (
        <div
          style={{
            position: 'absolute',
            top: '15px',
            right: '15px',
            fontSize: '12px',
            fontWeight: 'bold',
            padding: '4px 8px',
            borderRadius: '6px',
            backgroundColor: trend >= 0 ? '#d4edda' : '#f8d7da',
            color: trend >= 0 ? '#155724' : '#721c24'
          }}
        >
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
};

KPICard.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.string,
  color: PropTypes.string,
  subtitle: PropTypes.string,
  trend: PropTypes.number
};

export default KPICard;
