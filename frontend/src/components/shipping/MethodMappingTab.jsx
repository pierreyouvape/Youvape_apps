import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { visuelTransporteur } from '../../utils/carrierVisuals';

// Même construction que le reste de l'app (cf. ShippingSettings) : le repli
// pointe le backend local, et le `.replace` couvre les configurations où la
// variable se termine par /auth.
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace('/auth', '');

/**
 * Réglages « Étiquetage » : quelle dénomination WooCommerce part chez quel
 * transporteur.
 *
 * C'est l'écran qu'un responsable ouvre quand un préparateur est bloqué devant
 * une commande dont le mode de livraison n'est pas reconnu. Il montre donc en
 * PREMIER les dénominations vues dans les commandes et jamais mappées : régler
 * le problème avant qu'un colis reste sur la table vaut mieux que le régler
 * après.
 *
 * Trois choix possibles pour une dénomination, et le troisième compte autant
 * que les autres : un transporteur, « pas d'étiquette » (retrait réglé
 * autrement, transporteur géré hors app), ou rien du tout — auquel cas le
 * packing bloque. Sans le cas « pas d'étiquette », l'alerte se déclencherait
 * tous les jours sur des modes qui n'ont rien à imprimer, et les préparateurs
 * apprendraient à l'ignorer.
 */
const VIDE = { denomination: '', carrier_code: '', account_code: '', delivery_mode: '', note: '' };

function MethodMappingTab() {
  const [data, setData] = useState({ mappings: [], unmapped: [], carriers: [] });
  const [form, setForm] = useState(VIDE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const token = localStorage.getItem('token');
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/shipments/method-map`, auth);
      setData(res.data);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Chargement impossible' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const transporteur = data.carriers.find(c => c.code === form.carrier_code);

  /** Le contrat et le mode se préremplissent : un responsable n'a pas à les deviner. */
  const choisirTransporteur = (code) => {
    const c = data.carriers.find(x => x.code === code);
    setForm(f => ({
      ...f,
      carrier_code: code,
      account_code: c ? (c.accounts.find(a => a.code === c.defaultAccountCode)?.code || c.accounts[0]?.code || '') : '',
      delivery_mode: c ? (c.defaultDeliveryMode || '') : ''
    }));
  };

  const enregistrer = async (e) => {
    e?.preventDefault();
    if (!form.denomination.trim()) {
      setMessage({ type: 'error', text: 'La dénomination est obligatoire' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await axios.post(`${API_URL}/shipments/method-map`, {
        denomination: form.denomination.trim(),
        carrier_code: form.carrier_code || null,
        account_code: form.carrier_code ? form.account_code : null,
        delivery_mode: form.delivery_mode || null,
        note: form.note || null
      }, auth);
      setMessage({ type: 'success', text: `« ${form.denomination.trim()} » enregistré` });
      setForm(VIDE);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Enregistrement impossible' });
    } finally {
      setSaving(false);
    }
  };

  const supprimer = async (m) => {
    if (!confirm(
      `Supprimer la correspondance « ${m.denomination} » ?\n\n`
      + `Le packing bloquera de nouveau sur ce mode de livraison.`
    )) return;
    try {
      await axios.delete(`${API_URL}/shipments/method-map/${m.id}`, auth);
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Suppression impossible' });
    }
  };

  const Pastille = ({ code }) => {
    const v = visuelTransporteur(code);
    return (
      <span style={{
        display: 'inline-block', padding: '3px 10px', borderRadius: '4px',
        backgroundColor: v.couleur, color: v.encre,
        fontSize: '11px', fontWeight: 700, letterSpacing: '0.4px', whiteSpace: 'nowrap'
      }}>{v.court}</span>
    );
  };

  if (loading) return <div style={{ padding: '30px' }}>Chargement…</div>;

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
        Le transporteur d'une commande n'est <strong>pas deviné</strong> : il est lu ici, à partir du
        libellé exact du mode de livraison WooCommerce. Un mode absent de cette liste bloque le
        packing avec un message demandant de vous prévenir — jamais une étiquette au hasard.
      </p>

      {/* Ce qui arrive vraiment et n'est pas encore réglé : en premier. */}
      {data.unmapped.length > 0 && (
        <div style={{
          border: '1px solid #ffc107', backgroundColor: '#fff9e6',
          borderRadius: '8px', padding: '18px', marginBottom: '25px'
        }}>
          <h4 style={{ margin: '0 0 6px', color: '#856404' }}>
            {data.unmapped.length} mode{data.unmapped.length > 1 ? 's' : ''} de livraison non associé{data.unmapped.length > 1 ? 's' : ''}
          </h4>
          <p style={{ margin: '0 0 14px', color: '#856404', fontSize: '13px' }}>
            Vus dans les commandes des 90 derniers jours. Tant qu'ils ne sont pas réglés, le packing
            bloquera dessus.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {data.unmapped.map(u => (
              <button
                key={u.denomination}
                onClick={() => { setForm({ ...VIDE, denomination: u.denomination }); setMessage(null); }}
                title="Renseigner ce mode de livraison"
                // `index.css` impose `button { color: white }` et un survol bleu à
                // TOUS les boutons : sur fond clair, le libellé serait blanc sur
                // blanc — invisible. D'où la couleur explicite et le survol repris
                // à la main, comme le fait AppShell.
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#fff3cd'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}
                style={{
                  padding: '7px 12px', border: '1px solid #ffc107', backgroundColor: 'white',
                  color: '#333',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '13px', textAlign: 'left'
                }}>
                {u.denomination}
                <span style={{ color: '#856404', marginLeft: '8px', fontSize: '12px' }}>
                  {u.orders} cmd
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ajouter / modifier */}
      <form onSubmit={enregistrer} style={{
        border: '1px solid #e9ecef', borderRadius: '8px', padding: '18px', marginBottom: '25px'
      }}>
        <h4 style={{ margin: '0 0 15px' }}>Ajouter une correspondance</h4>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 260px' }}>
            <label style={labelStyle}>Dénomination WooCommerce</label>
            <input
              value={form.denomination}
              onChange={e => setForm(f => ({ ...f, denomination: e.target.value }))}
              placeholder="Ex. Mondial Relay - Point Relais"
              style={{ ...inputStyle, width: '100%' }} />
          </div>

          <div style={{ flex: '1 1 190px' }}>
            <label style={labelStyle}>Transporteur</label>
            <select value={form.carrier_code}
              onChange={e => choisirTransporteur(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}>
              <option value="">— Pas d'étiquette —</option>
              {data.carriers.map(c => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>

          {transporteur && transporteur.requiresAccount && (
            <div style={{ flex: '1 1 170px' }}>
              <label style={labelStyle}>Contrat</label>
              <select value={form.account_code}
                onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))}
                style={{ ...inputStyle, width: '100%' }}>
                {transporteur.accounts.map(a => (
                  <option key={a.code} value={a.code}>
                    {a.label}{a.sandbox ? ' — TEST' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {transporteur && transporteur.defaultDeliveryMode && (
            <div style={{ flex: '0 1 110px' }}>
              <label style={labelStyle}>Mode</label>
              <input value={form.delivery_mode}
                onChange={e => setForm(f => ({ ...f, delivery_mode: e.target.value }))}
                style={{ ...inputStyle, width: '100%' }} />
            </div>
          )}

          <div style={{ flex: '2 1 220px' }}>
            <label style={labelStyle}>Note (facultatif)</label>
            <input value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Pourquoi ce choix"
              style={{ ...inputStyle, width: '100%' }} />
          </div>

          <button type="submit" disabled={saving} style={{
            padding: '9px 20px', backgroundColor: saving ? '#adb5bd' : '#135E84',
            color: 'white', border: 'none', borderRadius: '4px',
            cursor: saving ? 'default' : 'pointer', fontWeight: 600
          }}>{saving ? '…' : 'Enregistrer'}</button>
        </div>

        {!form.carrier_code && form.denomination && (
          <p style={{ margin: '12px 0 0', color: '#856404', fontSize: '13px' }}>
            Sans transporteur, ce mode est déclaré <strong>sans étiquette</strong> : le packing ne
            bloquera plus dessus et n'imprimera rien.
          </p>
        )}
        {transporteur?.accounts.some(a => a.code === form.account_code && a.sandbox) && (
          <p style={{ margin: '12px 0 0', color: '#721c24', fontSize: '13px' }}>
            ⚠️ Contrat de <strong>test</strong> : les étiquettes émises ne seront pas valides à
            l'expédition.
          </p>
        )}
      </form>

      {/* Correspondances existantes */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f8f9fa' }}>
            <th style={thStyle}>Dénomination WooCommerce</th>
            <th style={thStyle}>Transporteur</th>
            <th style={thStyle}>Contrat</th>
            <th style={thStyle}>Mode</th>
            <th style={thStyle}>Note</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {data.mappings.map(m => (
            <tr key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
              <td style={tdStyle}>
                {m.denomination}
                {!m.active && <span style={{ color: '#dc3545', marginLeft: '8px', fontSize: '12px' }}>désactivé</span>}
              </td>
              <td style={tdStyle}>
                {m.carrier_code
                  ? <Pastille code={m.carrier_code} />
                  : <span style={{ color: '#6c757d', fontSize: '13px' }}>Pas d'étiquette</span>}
              </td>
              <td style={tdStyle}>{m.account_code || '—'}</td>
              <td style={tdStyle}>{m.delivery_mode || '—'}</td>
              <td style={{ ...tdStyle, color: '#666', fontSize: '13px' }}>{m.note || ''}</td>
              <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button onClick={() => setForm({
                  denomination: m.denomination, carrier_code: m.carrier_code || '',
                  account_code: m.account_code || '', delivery_mode: m.delivery_mode || '',
                  note: m.note || ''
                })} style={btnSmall}>Modifier</button>
                <button onClick={() => supprimer(m)} style={{ ...btnSmall, backgroundColor: '#dc3545', marginLeft: '6px' }}>
                  Supprimer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px' };
const inputStyle = { padding: '8px', border: '1px solid #ccc', borderRadius: '4px' };
const thStyle = { padding: '9px', textAlign: 'left', border: '1px solid #dee2e6', fontSize: '13px' };
const tdStyle = { padding: '9px', border: '1px solid #dee2e6', fontSize: '14px' };
const btnSmall = {
  padding: '4px 10px', backgroundColor: '#6c757d', color: 'white',
  border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
};

export default MethodMappingTab;
