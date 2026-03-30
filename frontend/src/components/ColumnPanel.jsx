/**
 * Bouton + panneau de sélection de colonnes réutilisable.
 * Props:
 *   columns: [{ key, label }]
 *   isVisible: (key) => bool
 *   toggleColumn: (key) => void
 *   compact: bool
 *   toggleCompact: () => void
 *   show: bool
 *   setShow: (bool) => void
 *   panelAlign: 'left' | 'right' (default: 'right')
 */
const ColumnPanel = ({ columns, isVisible, toggleColumn, compact, toggleCompact, show, setShow, panelAlign = 'right' }) => (
  <div style={{ position: 'relative' }}>
    <button
      onClick={() => setShow(v => !v)}
      style={{
        padding: '8px 14px',
        backgroundColor: show ? '#135E84' : '#fff',
        color: show ? '#fff' : '#374151',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '13px',
        cursor: 'pointer'
      }}
    >
      ⚙ Colonnes
    </button>
    {show && (
      <div style={{
        position: 'absolute',
        [panelAlign]: 0,
        top: '110%',
        zIndex: 100,
        backgroundColor: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        padding: '14px 16px',
        minWidth: '200px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)'
      }}>
        <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px', color: '#374151' }}>
          Colonnes visibles
        </div>
        {columns.map(col => (
          <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={isVisible(col.key)}
              onChange={() => toggleColumn(col.key)}
            />
            {col.label}
          </label>
        ))}
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '10px', paddingTop: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={compact}
              onChange={toggleCompact}
            />
            Vue compacte
          </label>
        </div>
      </div>
    )}
  </div>
);

export default ColumnPanel;
