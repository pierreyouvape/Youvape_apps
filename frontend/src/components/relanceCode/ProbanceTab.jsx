import { useState } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  rouge: '#DE2020', vert: '#4AB866', saphir: '#135E84', accent: '#0D9488', orange: '#E28F00',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};
const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n) || 0);

/* « maintenant » au format d'un <input type="datetime-local">, heure locale. */
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Stat({ label, value, accent, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 140, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, padding: '12px 16px' }}>
      <div style={{ fontSize: 11.5, color: C.grisM, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.grisF, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/**
 * Onglet « Fichier Probance » : on envoie l'export Probance (déjà filtré sur les
 * abonnés), l'app retire ceux qui ont utilisé le code et rend le même fichier, allégé.
 */
export default function ProbanceTab({ code, onSaved }) {
  const [file, setFile] = useState(null);
  const [save, setSave] = useState(true);
  const [sentAt, setSentAt] = useState(nowLocal());
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setStats(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('code', code.trim());
      if (save) {
        form.append('save', '1');
        form.append('sentAt', sentAt);
        form.append('label', label.trim() || file.name);
      }
      const res = await axios.post(`${API_URL}/relance-code/clean`, form, { responseType: 'blob' });
      const s = JSON.parse(decodeURIComponent(res.headers['x-relance-stats'] || '%7B%7D'));
      setStats(s);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name.replace(/\.(csv|txt)$/i, '')}_sans-${code.trim().toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (s.campaignId) onSaved?.();
    } catch (err) {
      let msg = err.message;
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* réponse non JSON */ }
      setError(msg || 'Erreur pendant le tri du fichier');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = { padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8, fontSize: 13, color: C.grisTF, background: C.blanc };
  const removed = stats ? stats.used + stats.dishonest + stats.duplicates + stats.noEmail : 0;

  return (
    <section style={{ padding: '18px 40px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12, padding: '16px 18px', fontSize: 13, color: C.grisF, lineHeight: 1.6 }}>
        <strong style={{ color: C.grisTF }}>1.</strong> Exporte de Probance la liste des contacts, déjà filtrée comme tu le souhaites (abonnés, segment…).
        <br />
        <strong style={{ color: C.grisTF }}>2.</strong> Envoie-la ici : l'app retire les adresses qui ont déjà utilisé <strong>{code || '—'}</strong>
        {' '}(adresse ou compte), les clients signalés malhonnêtes et les doublons.
        <br />
        <strong style={{ color: C.grisTF }}>3.</strong> Le fichier nettoyé se télécharge : mêmes colonnes, même format, prêt à réimporter dans Probance.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Fichier exporté de Probance (.csv)</label>
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setStats(null); setError(null); }} style={{ ...inputStyle, padding: 6 }} />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!file || busy || !code.trim()}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', fontSize: 13.5, fontWeight: 800,
            cursor: !file || busy ? 'not-allowed' : 'pointer',
            background: !file || busy ? C.grisCL : C.saphir, color: '#fff',
          }}
        >
          {busy ? 'Tri en cours…' : 'Nettoyer et télécharger'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 13, color: C.grisTF }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Ajouter cet envoi au suivi des clients fidélisés
        </label>
        {save && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              envoyé le
              <input type="datetime-local" value={sentAt} onChange={(e) => setSentAt(e.target.value)} style={inputStyle} />
            </span>
            <input type="text" value={label} placeholder="Nom de l'envoi (facultatif)" onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, minWidth: 220 }} />
          </>
        )}
      </div>
      {save && (
        <div style={{ fontSize: 12, color: C.grisF }}>
          Mets la date et l'heure où la campagne part réellement : seules les commandes passées après comptent.
        </div>
      )}

      {error && (
        <div style={{ padding: 16, color: C.rouge, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}` }}>{error}</div>
      )}

      {stats && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Stat label="Lignes du fichier" value={fmtInt(stats.lines)} sub={`Colonne e-mail : ${stats.emailColumn}`} />
            <Stat label="Retirées : code déjà utilisé" value={fmtInt(stats.used)} accent={C.rouge} />
            <Stat label="Autres retraits" value={fmtInt(stats.dishonest + stats.duplicates + stats.noEmail)}
              sub={`${fmtInt(stats.dishonest)} malhonnête(s) · ${fmtInt(stats.duplicates)} doublon(s) · ${fmtInt(stats.noEmail)} sans e-mail`} />
            <Stat label="Gardées (fichier téléchargé)" value={fmtInt(stats.kept)} accent={C.vert}
              sub={stats.unknown ? `dont ${fmtInt(stats.unknown)} sans commande payée chez nous` : null} />
          </div>
          <div style={{ fontSize: 12.5, color: C.grisF }}>
            {fmtInt(removed)} ligne(s) retirée(s) sur {fmtInt(stats.lines)}.
            {stats.campaignId ? ' Envoi ajouté au suivi (onglet « Clients fidélisés »).' : ''}
          </div>
        </>
      )}
    </section>
  );
}
