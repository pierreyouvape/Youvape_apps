import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C, CORRECTION_TAGS } from './pickingUi';

/**
 * « Corriger » une commande taguée, sans quitter le Picking.
 *
 * Appelle exactement les mêmes endpoints que le packing : la saisie du point
 * relais est contrôlée par le transporteur (comme au moment d'étiqueter), et
 * l'adresse est écrite dans notre base, lue à la génération de l'étiquette.
 */
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 14,
  border: `1px solid ${C.greyB}`, borderRadius: 8,
};

const Field = ({ label, children }) => (
  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.dark }}>
    {label}
    <div style={{ marginTop: 4 }}>{children}</div>
  </label>
);

export default function CorrectionModal({ order, token, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [relay, setRelay] = useState({ network: '', id: '', country: '' });
  const [address, setAddress] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/picking/orders/${order.orderNumber}/correction`, authHeaders(token))
      .then(({ data: d }) => {
        setData(d);
        setAddress(d.shipping);
        setRelay({
          network: d.relayExpected?.code || d.relayNetworks[0]?.code || '',
          id: d.relayPoint?.id || '',
          country: d.relayPoint?.country || d.shipping.country || 'FR',
        });
      })
      .catch(err => setError(err.response?.data?.error || err.message));
  }, [order.orderNumber, token]);

  const tag = order.tags[0];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tag === 'point_relais_manquant') {
        await axios.put(`${API_URL}/orders/${order.orderNumber}/relay-point`, relay, authHeaders(token));
      } else {
        await axios.put(`${API_URL}/picking/orders/${order.orderNumber}/shipping`, address, authHeaders(token));
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  const setA = (k) => (e) => setAddress(a => ({ ...a, [k]: e.target.value }));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: C.white, borderRadius: 14, width: '100%', maxWidth: 520, padding: 22, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: C.primary }}>
          Commande {order.orderNumber}
        </h2>
        <p style={{ margin: '0 0 16px', color: C.greyT, fontSize: 13.5 }}>
          {CORRECTION_TAGS[tag]} — {order.shippingMethod || 'mode de livraison inconnu'}
        </p>

        {!data && !error && <p style={{ color: C.greyT }}>Chargement…</p>}

        {data && tag === 'transporteur_inconnu' && (
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            Le mode de livraison « {data.shippingMethod} » n'est rattaché à aucun transporteur.
            Il se règle dans <a href="/packing/settings">Packing → Réglages</a> (droit Transporteurs) :
            une fois mappé, la commande redevient sélectionnable à la prochaine actualisation.
          </p>
        )}

        {data && tag === 'point_relais_manquant' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Réseau">
              <select value={relay.network} onChange={e => setRelay(r => ({ ...r, network: e.target.value }))} style={inputStyle}>
                {data.relayNetworks.map(n => <option key={n.code} value={n.code}>{n.label}</option>)}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <Field label="N° du point relais">
                <input value={relay.id} onChange={e => setRelay(r => ({ ...r, id: e.target.value }))} style={inputStyle} autoFocus />
              </Field>
              <Field label="Pays">
                <input value={relay.country} maxLength={2} onChange={e => setRelay(r => ({ ...r, country: e.target.value.toUpperCase() }))} style={inputStyle} />
              </Field>
            </div>
          </div>
        )}

        {data && tag === 'adresse_incomplete' && address && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Prénom"><input value={address.first_name || ''} onChange={setA('first_name')} style={inputStyle} /></Field>
              <Field label="Nom"><input value={address.last_name || ''} onChange={setA('last_name')} style={inputStyle} /></Field>
            </div>
            <Field label="Société"><input value={address.company || ''} onChange={setA('company')} style={inputStyle} /></Field>
            <Field label="Adresse"><input value={address.address || ''} onChange={setA('address')} style={inputStyle} /></Field>
            <Field label="Complément"><input value={address.address_2 || ''} onChange={setA('address_2')} style={inputStyle} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
              <Field label="Code postal"><input value={address.postcode || ''} onChange={setA('postcode')} style={inputStyle} /></Field>
              <Field label="Ville"><input value={address.city || ''} onChange={setA('city')} style={inputStyle} /></Field>
              <Field label="Pays"><input value={address.country || ''} maxLength={2} onChange={e => setAddress(a => ({ ...a, country: e.target.value.toUpperCase() }))} style={inputStyle} /></Field>
            </div>
            <Field label="Téléphone"><input value={address.phone || ''} onChange={setA('phone')} style={inputStyle} /></Field>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: C.redL, color: C.red, fontSize: 13.5 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{
            padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.greyB}`, background: C.white, cursor: 'pointer',
          }}>Fermer</button>
          {data && (tag === 'point_relais_manquant' || tag === 'adresse_incomplete') && (
            <button onClick={save} disabled={saving} style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', background: C.violet, color: C.white,
              fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
