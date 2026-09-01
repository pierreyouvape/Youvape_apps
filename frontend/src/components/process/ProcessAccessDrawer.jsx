import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Drawer from '../Drawer';
import ProcessAccessPanel from './ProcessAccessPanel';
import { API_URL, C } from './processConstants';

/**
 * Gestion des accès d'un process existant. Admin uniquement — le backend
 * refuse ces routes aux autres (checkAdmin).
 *
 * Chaque changement est persisté immédiatement, une entrée à la fois : il n'y a
 * pas de bouton « Enregistrer » à oublier, et une erreur réseau ne fait perdre
 * que la modification en cours.
 */
export default function ProcessAccessDrawer({ open, onClose, processId, onChanged }) {
  const [users, setUsers] = useState([]);
  const [state, setState] = useState({ visibility: 'restricted', access: [] });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!processId) return;
    setLoading(true);
    try {
      const [agentsRes, accessRes] = await Promise.all([
        axios.get(`${API_URL}/users/agents`),
        axios.get(`${API_URL}/process/${processId}/access`),
      ]);
      setUsers(agentsRes.data.users || []);
      setState({
        visibility: accessRes.data.data.visibility || 'restricted',
        access: (accessRes.data.data.users || []).map((u) => ({
          user_id: u.user_id, can_write: u.can_write,
        })),
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Impossible de charger les accès');
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => { if (open) { setDirty(false); load(); } }, [open, load]);

  // Applique le delta entre l'état courant et le suivant — une requête par
  // changement réel, plutôt qu'un remplacement global de la liste.
  const persist = async (next) => {
    setBusy(true);
    const previous = state;
    setState(next); // optimiste : l'interface répond tout de suite

    try {
      if (next.visibility !== previous.visibility) {
        await axios.put(`${API_URL}/process/${processId}/visibility`, { visibility: next.visibility });
      }

      const prevById = new Map(previous.access.map((a) => [a.user_id, a]));
      const nextById = new Map(next.access.map((a) => [a.user_id, a]));

      for (const [userId, entry] of nextById) {
        const before = prevById.get(userId);
        if (!before || before.can_write !== entry.can_write) {
          await axios.post(`${API_URL}/process/${processId}/access`, {
            user_id: userId, can_write: entry.can_write,
          });
        }
      }
      for (const userId of prevById.keys()) {
        if (!nextById.has(userId)) {
          await axios.delete(`${API_URL}/process/${processId}/access/${userId}`);
        }
      }

      setDirty(true);
    } catch (err) {
      alert(err.response?.data?.error || 'La modification des accès a échoué');
      setState(previous); // on remet l'état affiché en accord avec le serveur
      load();
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty) onChanged?.();
    onClose();
  };

  return (
    <Drawer open={open} onClose={close} side="right" width="min(94vw, 480px)">
      <div style={{
        padding: '18px 20px', borderBottom: `1px solid ${C.grisCL}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, margin: 0, flex: 1 }}>Accès</h2>
        {busy && <span style={{ fontSize: 12, color: C.grisM }}>Enregistrement…</span>}
        <button onClick={close}
          style={{ border: 'none', background: 'none', fontSize: 20, color: C.grisM, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
        {loading ? (
          <p style={{ fontSize: 13, color: C.grisM }}>Chargement…</p>
        ) : (
          <ProcessAccessPanel
            users={users}
            visibility={state.visibility}
            access={state.access}
            onChange={persist}
          />
        )}
      </div>
    </Drawer>
  );
}
