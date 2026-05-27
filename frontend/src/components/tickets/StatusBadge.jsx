import { useTicketStatuses } from './useTicketStatuses';

export default function StatusBadge({ status, size = 'md' }) {
  const { statusMap } = useTicketStatuses();
  const s = statusMap[status] || { label: status, bg: '#F0F0F0', color: '#626E85' };
  const pad = size === 'sm' ? '2px 8px' : '4px 10px';
  const fs  = size === 'sm' ? 11 : 12;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: s.bg, color: s.color,
      borderRadius: 99, padding: pad,
      fontSize: fs, fontWeight: 700,
      whiteSpace: 'nowrap', letterSpacing: 0.2,
    }}>
      {s.label}
    </span>
  );
}
