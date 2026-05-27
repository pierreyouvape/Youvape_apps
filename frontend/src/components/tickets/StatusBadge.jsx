import { useTicketStatuses } from './useTicketStatuses';

export default function StatusBadge({ status, size = 'md' }) {
  const { statusMap } = useTicketStatuses();
  const s = statusMap[status] || { label: status || '—', bg: '#F0F0F0', color: '#626E85' };
  const pad = size === 'sm' ? '3px 10px' : '3px 10px';
  const fs  = size === 'sm' ? 11.5 : 12;

  return (
    <span style={{
      display: 'inline-block',
      background: s.bg, color: s.color,
      padding: pad,
      borderRadius: 6,
      fontSize: fs, fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}
