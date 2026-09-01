import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Drawer from '../Drawer';
import { API_URL, C, statusInfo, prettyDateTime, initials } from './processConstants';

/**
 * Historique d'un process : une ligne par enregistrement, la plus récente en
 * haut. « Voir » affiche le contenu figé de cette version ; « Restaurer » la
 * recopie en tant que nouvelle version — l'historique n'est jamais tronqué,
 * une restauration se défait donc en restaurant la version d'avant.
 */
export default function ProcessHistory({ open, onClose, processId, currentVersionNo, canWrite, onPreview, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const fetchVersions = useCallback(async () => {
    if (!processId) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/process/${processId}/versions`);
      setVersions(res.data.data || []);
    } catch {
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => { if (open) fetchVersions(); }, [open, fetchVersions]);

  const preview = async (version) => {
    setBusyId(version.id);
    try {
      const res = await axios.get(`${API_URL}/process/${processId}/versions/${version.id}`);
      onPreview(res.data.data);
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Impossible de charger cette version');
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (version) => {
    if (!window.confirm(
      `Restaurer la version ${version.version_no} ?\n\n`
      + `Son contenu redevient la version courante, enregistré comme v${currentVersionNo + 1}. `
      + `Les versions actuelles restent dans l'historique.`
    )) return;

    setBusyId(version.id);
    try {
      await axios.post(`${API_URL}/process/${processId}/versions/${version.id}/restore`);
      await fetchVersions();
      onRestored();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'La restauration a échoué');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} side="right" width="min(92vw, 440px)">
      <div style={{
        padding: '18px 20px', borderBottom: `1px solid ${C.grisCL}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, margin: 0, flex: 1 }}>Historique</h2>
        <button onClick={onClose}
          style={{ border: 'none', background: 'none', fontSize: 20, color: C.grisM, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px' }}>
        {loading && <p style={{ fontSize: 13, color: C.grisM }}>Chargement…</p>}
        {!loading && versions.length === 0 && (
          <p style={{ fontSize: 13, color: C.grisM }}>Aucune version enregistrée.</p>
        )}

        {versions.map((v) => {
          const isCurrent = v.version_no === currentVersionNo;
          const st = statusInfo(v.status);
          return (
            <div key={v.id} style={{
              border: `1px solid ${isCurrent ? C.process : C.grisCL}`,
              background: isCurrent ? C.processL : C.blanc,
              borderRadius: 10, padding: 14, marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 800,
                  background: isCurrent ? C.process : C.grisTL,
                  color: isCurrent ? '#fff' : C.grisF,
                }}>
                  v{v.version_no}
                </span>
                {isCurrent && (
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.processF }}>version courante</span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{
                  padding: '3px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 800,
                  background: `${st.color}1A`, color: st.color,
                }}>
                  {st.label}
                </span>
              </div>

              <p style={{ fontSize: 13, color: C.grisTF, margin: '0 0 8px', fontWeight: 600, lineHeight: 1.45 }}>
                {v.change_note || <span style={{ color: C.grisM, fontWeight: 400, fontStyle: 'italic' }}>Sans note de modification</span>}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: C.grisM, marginBottom: 10 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', background: C.grisTL, color: C.grisF,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800,
                }}>
                  {initials(v.author_name, v.author_email)}
                </span>
                <span>{v.author_name || 'Auteur inconnu'} · {prettyDateTime(v.created_at)}</span>
                <span>· {v.steps_count} étape{v.steps_count > 1 ? 's' : ''}</span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => preview(v)} disabled={busyId === v.id}
                  style={{
                    padding: '6px 13px', borderRadius: 7, border: `1px solid ${C.grisCL}`,
                    background: C.blanc, color: C.grisF, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Voir
                </button>
                {!isCurrent && canWrite && (
                  <button
                    onClick={() => restore(v)} disabled={busyId === v.id}
                    style={{
                      padding: '6px 13px', borderRadius: 7, border: 'none',
                      background: C.process, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                      opacity: busyId === v.id ? 0.5 : 1,
                    }}
                  >
                    Restaurer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Drawer>
  );
}
