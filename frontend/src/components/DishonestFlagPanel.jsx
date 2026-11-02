import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

/**
 * Fiche client : signaler un client ayant été malhonnête (colis volé, fausse
 * déclaration de non-réception…). Ses commandes futures, même sous un autre
 * compte (même email, téléphone ou nom et prénom), sortent des règles de vague
 * du Picking et ouvrent un ticket SAV. Signaler et retirer : droit tickets en
 * écriture ; tout le monde voit le bandeau.
 */

const RED = '#DC2626';
const RED_DARK = '#7F1D1D';
const RED_LIGHT = '#FEE2E2';

const MATCH_LABELS = { email: 'même email', telephone: 'même téléphone', nom: 'même nom et prénom' };

const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const signedBy = (f) => `Signalé${f.flaggedBy ? ` par ${f.flaggedBy}` : ''} le ${frDate(f.flaggedAt)}`;

const btn = (filled) => ({
  border: `1.5px solid ${RED}`, borderRadius: 8, padding: '7px 14px',
  background: filled ? RED : '#fff', color: filled ? '#fff' : RED,
  fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
});

const banner = {
  background: RED_LIGHT, borderLeft: `6px solid ${RED}`, borderRadius: 10,
  padding: '12px 18px', color: RED_DARK, fontSize: 13.5, lineHeight: 1.5, marginBottom: 12,
};

export default function DishonestFlagPanel({ wpUserId }) {
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.tickets?.write === true;

  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setEditing(false);
    setError(null);
    axios.get(`/api/customers/${wpUserId}/dishonest-flag`)
      .then((res) => { if (!cancelled) setData(res.data.data); })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.error || e.message); });
    return () => { cancelled = true; };
  }, [wpUserId]);

  const send = async (method, body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await axios({ method, url: `/api/customers/${wpUserId}/dishonest-flag`, data: body });
      setData(res.data.data);
      setEditing(false);
      setReason('');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (window.confirm('Retirer le signalement ? Ses commandes repasseront dans les règles de vague du Picking.')) {
      send('delete');
    }
  };

  if (!data) {
    return error ? <div style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>Signalement illisible : {error}</div> : null;
  }

  const { flag, related } = data;

  return (
    <div style={{ marginBottom: 8 }}>
      {flag && (
        <div style={{ ...banner, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <strong style={{ fontSize: 14.5 }}>Client ayant été malhonnête</strong>
            <div>Motif : « {flag.reason} »</div>
            <div style={{ fontSize: 12.5, opacity: 0.85 }}>
              {signedBy(flag)} — ses nouvelles commandes, même sous un autre compte, ne partent qu'en vague manuelle
              et ouvrent un ticket SAV.
            </div>
          </div>
          {canWrite && (
            <button onClick={remove} disabled={busy} style={{ ...btn(false), flexShrink: 0 }}>
              Retirer le signalement
            </button>
          )}
        </div>
      )}

      {related.map(r => (
        <div key={r.wpUserId} style={banner}>
          <strong>Peut-être un autre compte d'un client signalé</strong> :{' '}
          {MATCH_LABELS[r.matchedBy] || r.matchedBy}{r.matchedValue ? ` (${r.matchedValue})` : ''} que{' '}
          <Link to={`/customers/${r.wpUserId}`} style={{ color: RED, fontWeight: 800 }}>
            {r.customerName} (#{r.wpUserId})
          </Link>
          .
          <div>Motif : « {r.reason} »</div>
          <div style={{ fontSize: 12.5, opacity: 0.85 }}>
            {signedBy(r)} — les nouvelles commandes de ce compte ne partent qu'en vague manuelle.
          </div>
        </div>
      ))}

      {!flag && canWrite && !editing && (
        <button onClick={() => setEditing(true)} style={{ ...btn(false), marginBottom: 12 }}>
          Signaler comme malhonnête
        </button>
      )}

      {!flag && editing && (
        <div style={{ ...banner, background: '#fff', border: `1.5px solid ${RED}`, borderLeft: `6px solid ${RED}` }}>
          <label style={{ display: 'block', fontWeight: 800, marginBottom: 6 }}>
            Motif (colis volé, fausse déclaration de non-réception…)
          </label>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={1000} autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid #E2E2E2',
              padding: '8px 10px', fontFamily: 'inherit', fontSize: 13.5, resize: 'vertical',
            }}
          />
          <div style={{ fontSize: 12, color: '#626E85', margin: '6px 0 10px' }}>
            Ses commandes à venir, sous ce compte ou un autre (même email, téléphone ou nom et prénom), sortiront
            des règles de vague du Picking et ouvriront un ticket SAV.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => send('post', { reason })} disabled={busy || !reason.trim()} style={btn(true)}>
              Signaler
            </button>
            <button onClick={() => { setEditing(false); setReason(''); setError(null); }} disabled={busy} style={btn(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ color: RED, fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
    </div>
  );
}
