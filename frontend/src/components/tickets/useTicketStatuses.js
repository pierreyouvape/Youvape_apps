import { useState, useEffect } from 'react';

// Cache module-level pour éviter les fetch répétés
let _cache = null;
let _promise = null;

export function useTicketStatuses() {
  const [statuses, setStatuses] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setStatuses(_cache); setLoading(false); return; }
    if (!_promise) {
      _promise = fetch('/api/sav/statuses')
        .then(r => r.json())
        .then(data => {
          if (data.success) { _cache = data.statuses; return data.statuses; }
          return [];
        })
        .catch(() => []);
    }
    _promise.then(s => { setStatuses(s); setLoading(false); });
  }, []);

  // Convertit en map { value -> { label, bg_color, text_color } }
  const statusMap = Object.fromEntries(
    statuses.map(s => [s.value, { label: s.label, bg: s.bg_color, color: s.text_color }])
  );

  return { statuses, statusMap, loading };
}

// Invalider le cache (appelé après modification dans les settings)
export function invalidateStatusCache() {
  _cache = null;
  _promise = null;
}
