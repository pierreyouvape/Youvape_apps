import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

/**
 * Hook réutilisable pour les préférences de colonnes + mode compact.
 * @param {string} page - Identifiant de la page (ex: 'categories', 'brands', etc.)
 * @param {string} token - JWT token
 */
export function useColumnPreferences(page, token) {
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [compact, setCompact] = useState(false);
  const [showColumnPanel, setShowColumnPanel] = useState(false);

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/preferences/${page}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.success) {
          setHiddenColumns(res.data.hiddenColumns || []);
          setCompact(res.data.compact || false);
        }
      } catch (err) {
        console.error(`Erreur chargement préférences ${page}:`, err);
      }
    };
    load();
  }, [token, page]);

  const save = async (cols, cmp) => {
    if (!token) return;
    try {
      await axios.put(`${API_BASE_URL}/preferences/${page}`, { hiddenColumns: cols, compact: cmp }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error(`Erreur sauvegarde préférences ${page}:`, err);
    }
  };

  const toggleColumn = (key) => {
    const next = hiddenColumns.includes(key)
      ? hiddenColumns.filter(k => k !== key)
      : [...hiddenColumns, key];
    setHiddenColumns(next);
    save(next, compact);
  };

  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    save(hiddenColumns, next);
  };

  const isVisible = (key) => !hiddenColumns.includes(key);

  return { hiddenColumns, compact, showColumnPanel, setShowColumnPanel, toggleColumn, toggleCompact, isVisible };
}
