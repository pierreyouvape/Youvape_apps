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

/**
 * Tri au clic sur un en-tête : croissant, décroissant, puis retour à l'ordre
 * d'origine. Retenu dans ce navigateur, par tableau.
 */
export function useSort(key) {
  const storage = `yv.taches.sort.${key}`;
  const [sort, setSort] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storage) || 'null'); } catch { return null; }
  });
  const toggle = useCallback((col) => {
    setSort((cur) => {
      let next;
      if (!cur || cur.col !== col) next = { col, dir: 1 };
      else if (cur.dir === 1) next = { col, dir: -1 };
      else next = null;
      if (next) localStorage.setItem(storage, JSON.stringify(next)); else localStorage.removeItem(storage);
      return next;
    });
  }, [storage]);
  return { sort, toggle };
}

/** Trie `rows` selon `sort` ; `accessors[col](row)` donne la valeur (vide = toujours en dernier). */
export function sortRows(rows, sort, accessors) {
  if (!sort || !accessors[sort.col]) return rows;
  const get = accessors[sort.col];
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    const ea = va === null || va === undefined || va === '';
    const eb = vb === null || vb === undefined || vb === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' });
    return c * sort.dir;
  });
}
