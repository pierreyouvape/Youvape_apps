import { useState, useEffect, useContext, useCallback } from 'react';
import { TICKETS_COLOR } from './ticketConstants';
// created_at / last_hit_at sont écrits par CURRENT_TIMESTAMP sur une BDD en UTC
// (comme les timestamps SAV) → formatDateUTC, pas formatDate.
import { formatDateUTC } from '../../utils/dateUtils';
import { AuthContext } from '../../context/AuthContext';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff', rouge: '#DC2626',
};

const API = '/api/sav/blocklist';

const TYPE_LABELS = {
  email:    { label: 'Adresse',  hint: 'Adresse exacte, ex. spammeur@gmail.com' },
  domain:   { label: 'Domaine',  hint: 'Tout ce qui suit le @, sous-domaines inclus, ex. promodoc.ru' },
  local:    { label: 'Identifiant', hint: 'Partie avant le @, tous domaines confondus, ex. syitaspidiz' },
  contains: { label: 'Contient', hint: 'Texte présent dans le nom ou le message, ex. casino' },
};

/**
 * Réglage de la liste de blocage du formulaire public.
 *
 * Ces motifs ne rejettent rien : une demande qui matche est créée, classée en
 * spam et privée d'accusé de réception. Un faux positif reste donc récupérable
 * depuis la vue Spam — c'est la raison pour laquelle on peut se permettre des
 * motifs larges comme « contient ».
 */
export default function BlocklistSettings() {
  const { token } = useContext(AuthContext);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [type, setType] = useState('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch(API, { headers: auth });
      const data = await res.json();
      if (data.success) setRules(data.rules);
      else setError(data.error || 'Erreur de chargement');
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setFormError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ type, value, reason }),
      });
      const data = await res.json();
      if (!data.success) { setFormError(data.error || 'Erreur'); return; }
      setRules(prev => [data.rule, ...prev]);
      setValue('');
      setReason('');
    } finally { setBusy(false); }
  };

  const toggle = async (rule) => {
    const res = await fetch(`${API}/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ is_active: !rule.is_active }),
    });
    const data = await res.json();
    if (data.success) setRules(prev => prev.map(r => r.id === rule.id ? data.rule : r));
  };

  const remove = async (rule) => {
    if (!window.confirm(`Supprimer le motif « ${rule.value} » ?`)) return;
    await fetch(`${API}/${rule.id}`, { method: 'DELETE', headers: auth });
    setRules(prev => prev.filter(r => r.id !== rule.id));
  };

  const inputStyle = {
    border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '8px 11px',
    fontSize: 13, fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none',
  };

  return (
    <>
      <div style={{
        background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`,
        border: `1px solid ${TICKETS_COLOR}30`, borderRadius: 10, padding: '14px 18px',
        marginBottom: 24, fontSize: 13, color: C.grisF, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.grisTF }}>Liste de blocage du formulaire public</strong> — Une
        demande envoyée depuis le formulaire « Nous contacter » qui correspond à l'un de ces motifs
        est <strong>classée en spam d'emblée</strong>, sans accusé de réception au visiteur ni
        notification aux agents.
        <div style={{ marginTop: 6 }}>
          Rien n'est jeté : la demande reste consultable dans la vue <strong>Spam</strong>, et la
          déclasser retire du même geste le motif qui visait son expéditeur. C'est ce qui permet
          des motifs larges sans risquer de perdre le message d'un vrai client.
        </div>
        <div style={{ marginTop: 6 }}>
          Ne concerne <strong>que</strong> le formulaire public : les demandes d'un client connecté
          et les emails entrants ne sont jamais filtrés.
        </div>
      </div>

      {/* Formulaire d'ajout */}
      <form onSubmit={create} style={{
        background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
        padding: '14px 16px', marginBottom: 18,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={TYPE_LABELS[type].hint}
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Motif (facultatif)"
            style={{ ...inputStyle, width: 180 }}
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            style={{
              background: value.trim() ? TICKETS_COLOR : C.grisCL, border: 'none', borderRadius: 8,
              padding: '9px 16px', fontSize: 13, fontWeight: 800, color: '#fff',
              cursor: value.trim() && !busy ? 'pointer' : 'not-allowed', fontFamily: 'Lato, sans-serif',
            }}
          >{busy ? 'Ajout…' : 'Ajouter'}</button>
        </div>
        <div style={{ fontSize: 11.5, color: C.grisM, marginTop: 8 }}>{TYPE_LABELS[type].hint}</div>
        {formError && (
          <div style={{ fontSize: 12.5, color: C.rouge, fontWeight: 700, marginTop: 8 }}>{formError}</div>
        )}
      </form>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM }}>Chargement…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.rouge }}>{error}</div>
      ) : rules.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM, fontSize: 13 }}>
          Aucun motif de blocage. Ils s'ajoutent aussi depuis un ticket, au moment de le classer en spam.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
              padding: '11px 14px', opacity: r.is_active ? 1 : 0.55,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 800, color: C.grisF, background: C.grisTL,
                border: `1px solid ${C.grisCL}`, borderRadius: 6, padding: '3px 8px',
                flexShrink: 0, minWidth: 74, textAlign: 'center',
              }}>{TYPE_LABELS[r.type]?.label || r.type}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.grisTF, wordBreak: 'break-all' }}>
                  {r.value}
                </div>
                <div style={{ fontSize: 11.5, color: C.grisM, marginTop: 2 }}>
                  {r.reason || 'Sans motif'}
                  {r.created_by_name ? ` · ${r.created_by_name}` : ''}
                  {r.created_at ? ` · ${formatDateUTC(r.created_at)}` : ''}
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: r.hits > 0 ? C.grisF : C.grisM, textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 800 }}>{r.hits} bloqué{r.hits > 1 ? 's' : ''}</div>
                {r.last_hit_at && <div style={{ fontSize: 10.5 }}>dernier : {formatDateUTC(r.last_hit_at)}</div>}
              </div>

              <button
                onClick={() => toggle(r)}
                title={r.is_active ? 'Désactiver ce motif' : 'Réactiver ce motif'}
                style={{
                  background: C.grisTL, border: `1px solid ${C.grisCL}`, borderRadius: 7,
                  padding: '6px 11px', fontSize: 12, fontWeight: 700, color: C.grisF,
                  cursor: 'pointer', fontFamily: 'Lato, sans-serif', flexShrink: 0,
                }}
              >{r.is_active ? 'Désactiver' : 'Activer'}</button>

              <button
                onClick={() => remove(r)}
                title="Supprimer ce motif"
                style={{
                  background: 'transparent', border: `1px solid ${C.grisCL}`, borderRadius: 7,
                  padding: '6px 10px', fontSize: 12, fontWeight: 700, color: C.rouge,
                  cursor: 'pointer', fontFamily: 'Lato, sans-serif', flexShrink: 0,
                }}
              >Supprimer</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
