import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TRACKING_STATES } from '../../utils/trackingStates';
import { formatDateUTC } from '../../utils/dateUtils';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace('/auth', '');

/**
 * Réglages « Suivi des colis » : ce que veut dire chaque code transporteur.
 *
 * Chaque évènement reçu d'un transporteur porte un code (DI1 chez La Poste, D
 * chez Chronopost) ou, chez Mondial Relay, un simple libellé. On le range ici
 * dans un état commun : « Livré », « En point relais », « Retour vers nous »…
 * C'est cet état qu'affichent l'historique d'expédition et les commandes.
 *
 * Un code jamais vu arrive « à classer », en tête de liste : il ne change rien
 * tant qu'il ne l'est pas. Changer un classement recalcule aussitôt les colis
 * qui l'ont reçu. « Information » = vu, sans effet (SMS envoyé au client…).
 */
function TrackingMapTab() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(null);

  const token = localStorage.getItem('token');
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/shipments/tracking-map`, auth);
      setData(res.data);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Chargement impossible' });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const classer = async (row, state) => {
    const cle = `${row.source}|${row.event_key}`;
    setSaving(cle);
    setMessage(null);
    try {
      const res = await axios.put(`${API_URL}/shipments/tracking-map`,
        { source: row.source, event_key: row.event_key, state: state || null }, auth);
      setMessage({
        type: 'ok',
        text: `« ${row.event_key} » : ${state ? data.states[state] : 'à classer'} — ${res.data.recomputed} colis recalculé(s).`,
      });
      await load();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Enregistrement impossible' });
    } finally {
      setSaving(null);
    }
  };

  if (!data) {
    return <div style={{ padding: '30px' }}>{message ? message.text : 'Chargement…'}</div>;
  }

  const aClasser = data.rows.filter(r => !r.state).length;

  return (
    <div style={{ padding: '25px' }}>
      {message && (
        <div style={{
          padding: '10px 15px', marginBottom: '20px', borderRadius: '4px',
          backgroundColor: message.type === 'error' ? '#f8d7da' : '#d4edda',
          color: message.type === 'error' ? '#721c24' : '#155724'
        }}>{message.text}</div>
      )}

      <p style={{ color: '#666', marginTop: 0, fontSize: '14px', lineHeight: 1.6 }}>
        Ce que veut dire chaque code des transporteurs. Les colis sont interrogés toutes les
        30 minutes ; l'état affiché dans l'historique d'expédition et dans les commandes vient
        de ce classement. Un code jamais vu arrive <strong>à classer</strong> et ne change rien
        tant qu'il ne l'est pas. Un « livré » qui suit un retour compte comme
        « Revenu chez nous ».
      </p>
      {aClasser > 0 && (
        <p style={{ color: '#b54708', fontWeight: 600, fontSize: '14px' }}>
          {aClasser} code(s) à classer.
        </p>
      )}

      {Object.entries(data.sources).map(([source, titre]) => {
        const rows = data.rows.filter(r => r.source === source);
        return (
          <div key={source} style={{ marginBottom: '28px' }}>
            <h4 style={{ margin: '0 0 10px' }}>{titre}</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ background: '#f8f9fa', textAlign: 'left' }}>
                  <th style={th}>{source === 'mondial_relay' ? 'Libellé' : 'Code'}</th>
                  <th style={th}>Exemple</th>
                  <th style={{ ...th, textAlign: 'right' }}>Vu</th>
                  <th style={th}>Dernière fois</th>
                  <th style={th}>État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const cle = `${r.source}|${r.event_key}`;
                  const couleur = TRACKING_STATES[r.state]?.color;
                  return (
                    <tr key={cle} style={{ background: r.state ? 'white' : '#fff4e5', borderBottom: '1px solid #eee' }}>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{r.event_key}</td>
                      <td style={{ ...td, color: '#666' }}>
                        {r.example_label && r.example_label !== r.event_key ? r.example_label : ''}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.seen_count}</td>
                      <td style={{ ...td, color: '#888', whiteSpace: 'nowrap' }}>
                        {r.last_seen_at ? formatDateUTC(r.last_seen_at) : '—'}
                      </td>
                      <td style={td}>
                        <select value={r.state || ''} disabled={saving === cle}
                          onChange={e => classer(r, e.target.value)}
                          style={{
                            padding: '5px 8px', borderRadius: '6px', fontSize: '13px',
                            border: `2px solid ${couleur || (r.state ? '#ccc' : '#f0ad4e')}`,
                          }}>
                          <option value="">— à classer —</option>
                          {Object.entries(data.states).map(([code, libelle]) => (
                            <option key={code} value={code}>{libelle}</option>
                          ))}
                        </select>
                        {r.updated_by_name && (
                          <div style={{ fontSize: '11px', color: '#999', marginTop: 2 }}>par {r.updated_by_name}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: '12px', color: '#555', borderBottom: '2px solid #eee' };
const td = { padding: '7px 10px', verticalAlign: 'top' };

export default TrackingMapTab;
