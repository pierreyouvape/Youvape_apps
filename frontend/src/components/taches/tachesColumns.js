import { useCallback, useState } from 'react';

/**
 * Largeurs de colonnes réglables (façon Monday), retenues dans ce navigateur.
 * `key` distingue les tableaux (« mine », « table », « steps ») ; `defaults`
 * en pixels. Si le nombre de colonnes change (nouvelle version), on repart des
 * largeurs par défaut plutôt que de décaler tout le tableau.
 */
export function useColumnWidths(key, defaults) {
  const storage = `yv.taches.cols.${key}`;
  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storage) || 'null');
      if (Array.isArray(saved) && saved.length === defaults.length && saved.every((n) => Number.isFinite(n))) return saved;
    } catch { /* valeur illisible : défaut */ }
    return defaults;
  });

  const setWidth = useCallback((i, w) => {
    setWidths((cur) => {
      const next = cur.map((x, j) => (j === i ? Math.max(40, Math.round(w)) : x));
      localStorage.setItem(storage, JSON.stringify(next));
      return next;
    });
  }, [storage]);

  const resetWidth = useCallback((i) => setWidth(i, defaults[i]), [setWidth, defaults]);

  return { widths, setWidth, resetWidth, total: widths.reduce((a, b) => a + b, 0) };
}
