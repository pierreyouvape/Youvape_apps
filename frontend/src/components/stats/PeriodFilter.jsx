// Sélecteur de période partagé par les onglets Marques / Catégories de /stats.
// Produit { dateFrom, dateTo } au format 'YYYY-MM-DD' (bornes incluses), ou null = sans borne.

export const PERIOD_OPTIONS = [
  { value: 'all', label: "Tout l'historique" },
  { value: 'this_month', label: 'Mois en cours' },
  { value: 'last_month', label: 'Le mois dernier' },
  { value: '30d', label: '30 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
  { value: '3m', label: '3 derniers mois (+ mois en cours)' },
  { value: '6m', label: '6 derniers mois (+ mois en cours)' },
  { value: '12m', label: '12 derniers mois (+ mois en cours)' },
  { value: 'this_year', label: 'Année en cours' },
  { value: 'last_year', label: "L'année dernière" },
  { value: 'custom', label: '📅 Dates personnalisées (du… au…)' }
];

// Date locale 'YYYY-MM-DD' (pas toISOString : renverrait la veille en soirée, heure Paris)
export const localFmt = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const computeDateRange = (period, customStart, customEnd) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (period) {
    case 'custom':
      return { dateFrom: customStart || null, dateTo: customEnd || null };
    case 'this_month':
      return { dateFrom: localFmt(new Date(y, m, 1)), dateTo: localFmt(today) };
    case 'last_month':
      return { dateFrom: localFmt(new Date(y, m - 1, 1)), dateTo: localFmt(new Date(y, m, 0)) };
    case 'this_year':
      return { dateFrom: localFmt(new Date(y, 0, 1)), dateTo: localFmt(today) };
    case 'last_year':
      return { dateFrom: localFmt(new Date(y - 1, 0, 1)), dateTo: localFmt(new Date(y - 1, 11, 31)) };
    default:
      break;
  }

  if (period.endsWith('d')) {
    const start = new Date(today);
    start.setDate(start.getDate() - parseInt(period));
    return { dateFrom: localFmt(start), dateTo: localFmt(today) };
  }
  if (period.endsWith('m')) {
    return { dateFrom: localFmt(new Date(y, m - parseInt(period), 1)), dateTo: localFmt(today) };
  }
  return { dateFrom: null, dateTo: null };
};

// Paramètres axios (on n'envoie que les bornes renseignées)
export const dateParams = ({ dateFrom, dateTo }) => {
  const params = {};
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;
  return params;
};

const PeriodFilter = ({ period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label style={{ fontSize: '13px', color: '#8A99A4', whiteSpace: 'nowrap' }}>Période :</label>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
      >
        {PERIOD_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
    {period === 'custom' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: '#eef4f8', border: '1px solid #cfe0ea', borderRadius: '8px' }}>
        <label style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>du</label>
        <input
          type="date"
          value={customStart}
          onChange={(e) => setCustomStart(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
        />
        <label style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>au</label>
        <input
          type="date"
          value={customEnd}
          onChange={(e) => setCustomEnd(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
        />
      </div>
    )}
  </div>
);

export default PeriodFilter;
