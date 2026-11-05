import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  rouge: '#DE2020', vert: '#4AB866', saphir: '#135E84', accent: '#0D9488',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};
const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n) || 0);
const fmtEur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const pct = (a, b) => (b ? `${(100 * a / b).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—');
const fmtDateTime = (s) => {
  if (!s) return '—';
  const [d, t] = s.split('T');
  return `${d.split('-').reverse().join('/')}${t && t !== '00:00' ? ` ${t}` : ''}`;
};

function Stat({ label, value, accent, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.grisM, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.grisF, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/**
 * Onglet « Clients fidélisés » : pour chaque envoi enregistré, les destinataires qui
 * ont recommandé APRÈS l'envoi, dont ceux qui ont utilisé le code. Mis à jour à
 * chaque ouverture, au fil des commandes.
 */
export default function SuiviTab({ refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { id, sentAt }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/relance-code/campaigns`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const saveDate = async () => {
    try {
      await axios.put(`${API_URL}/relance-code/campaigns/${editing.id}`, { sentAt: editing.sentAt });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Retirer l'envoi « ${c.label || fmtDateTime(c.sent_at)} » du suivi ? (${fmtInt(c.recipients)} destinataires)`)) return;
    try {
      await axios.delete(`${API_URL}/relance-code/campaigns/${c.id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const t = data?.total;
  const th = { padding: '10px 14px', fontWeight: 700, whiteSpace: 'nowrap' };
  const td = { padding: '10px 14px', whiteSpace: 'nowrap', color: C.grisF };

  return (
    <section style={{ padding: '18px 40px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ padding: 16, color: C.rouge, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}` }}>{error}</div>}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="Clients relancés" value={loading && !t ? '…' : fmtInt(t?.recipients)} sub={t ? `${fmtInt(t.campaigns)} envoi(s)` : null} />
        <Stat label="Ont recommandé depuis" value={loading && !t ? '…' : fmtInt(t?.reordered)} accent={C.accent}
          sub={t ? `${pct(t.reordered, t.recipients)} des relancés · ${fmtInt(t.orders)} commande(s)` : null} />
        <Stat label="Avec le code" value={loading && !t ? '…' : fmtInt(t?.withCode)} accent={C.vert}
          sub={t ? `${pct(t.withCode, t.recipients)} des relancés` : null} />
        <Stat label="CA TTC des commandes" value={loading && !t ? '…' : fmtEur(t?.revenue)} accent={C.saphir}
          sub={t ? `dont ${fmtEur(t.revenueWithCode)} avec le code` : null} />
      </div>

      <div style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, color: C.grisF, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>Ont recommandé</strong> = au moins une commande payée après la date d'envoi, avec ou sans le code.
        <strong> Avec le code</strong> = commande passée avec le code de l'envoi : c'est l'effet direct de la relance.
        Une partie des clients aurait recommandé sans e-mail : sur 2025-2026, un tiers des clients qui reviennent le font avant J+20.
        Le total compte chaque client une fois, à partir de son premier envoi.
        Une liste exportée de l'app contient aussi des non-abonnés que Probance n'a pas relancés : pour des taux justes, préfère le fichier Probance nettoyé.
      </div>

      {!data?.campaigns?.length ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.grisF, background: C.blanc, borderRadius: 12, border: `1px dashed ${C.grisCL}` }}>
          {loading ? 'Chargement…' : "Aucun envoi enregistré. Coche « Ajouter au suivi » quand tu nettoies un fichier Probance ou quand tu exportes une liste."}
        </div>
      ) : (
        <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, overflowX: 'auto', opacity: loading ? 0.6 : 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: C.grisM, textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                <th style={th}>Envoyé le</th>
                <th style={th}>Envoi</th>
                <th style={th}>Code</th>
                <th style={{ ...th, textAlign: 'right' }}>Relancés</th>
                <th style={{ ...th, textAlign: 'right' }}>Ont recommandé</th>
                <th style={{ ...th, textAlign: 'right' }}>Avec le code</th>
                <th style={{ ...th, textAlign: 'right' }}>Commandes</th>
                <th style={{ ...th, textAlign: 'right' }}>CA TTC</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.grisCL}` }}>
                  <td style={td}>
                    {editing?.id === c.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input type="datetime-local" value={editing.sentAt} onChange={(e) => setEditing({ ...editing, sentAt: e.target.value })}
                          style={{ padding: '4px 6px', border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5 }} />
                        <button type="button" onClick={saveDate} style={{ border: 'none', background: C.saphir, color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>OK</button>
                        <button type="button" onClick={() => setEditing(null)} style={{ border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>Annuler</button>
                      </span>
                    ) : (
                      <button type="button" title="Modifier la date d'envoi" onClick={() => setEditing({ id: c.id, sentAt: c.sent_at })}
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: C.grisTF, fontWeight: 700, fontSize: 13 }}>
                        {fmtDateTime(c.sent_at)} ✎
                      </button>
                    )}
                  </td>
                  <td style={{ ...td, color: C.grisTF, whiteSpace: 'normal', minWidth: 180 }}>
                    {c.label || '—'}
                    <div style={{ fontSize: 11.5, color: C.grisM }}>{c.source === 'probance' ? 'Fichier Probance nettoyé' : "Liste de l'app"}{c.created_by ? ` · ${c.created_by}` : ''}</div>
                  </td>
                  <td style={{ ...td, fontWeight: 700 }}>{c.code}</td>
                  <td style={{ ...td, textAlign: 'right', color: C.grisTF, fontWeight: 700 }}>{fmtInt(c.recipients)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <strong style={{ color: C.accent }}>{fmtInt(c.reordered)}</strong> <span style={{ fontSize: 12 }}>({pct(c.reordered, c.recipients)})</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <strong style={{ color: C.vert }}>{fmtInt(c.with_code)}</strong> <span style={{ fontSize: 12 }}>({pct(c.with_code, c.recipients)})</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtInt(c.orders)}</td>
                  <td style={{ ...td, textAlign: 'right', color: C.grisTF }}>
                    {fmtEur(c.revenue)}
                    <div style={{ fontSize: 11.5, color: C.grisM }}>dont {fmtEur(c.revenue_with_code)} code</div>
                  </td>
                  <td style={td}>
                    <button type="button" onClick={() => remove(c)} title="Retirer du suivi (envoi annulé, doublon…)"
                      style={{ border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.rouge, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
