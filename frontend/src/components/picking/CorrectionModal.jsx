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

  // « Adresse vérifiée, garder telle quelle » : une adresse juste que la base
  // La Poste ne connaît pas (code CEDEX, commune nouvelle). Ce qui a été
  // retouché dans le formulaire est enregistré d'abord, puis validé.
  const confirmAsIs = async () => {
    setSaving(true);
    setError(null);
    try {
      const champs = ['first_name', 'last_name', 'company', 'address', 'address_2', 'city', 'postcode', 'country', 'phone'];
      if (champs.some(k => (address[k] || '') !== (data.shipping[k] || ''))) {
        await axios.put(`${API_URL}/picking/orders/${order.orderNumber}/shipping`, address, authHeaders(token));
      }
      await axios.post(`${API_URL}/picking/orders/${order.orderNumber}/postcode-city-confirm`, {}, authHeaders(token));
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  const setA = (k) => (e) => setAddress(a => ({ ...a, [k]: e.target.value }));

  // Les deux tags se corrigent dans le même formulaire d'adresse.
  const addressTag = tag === 'adresse_incomplete' || tag === 'cp_ville_incoherents';
  const check = data?.postcodeCheck;
  const chip = {
    padding: '4px 10px', borderRadius: 999, border: `1px solid ${C.greyB}`, background: C.white, color: C.dark,
    fontSize: 12.5, cursor: 'pointer',
  };

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

        {data && addressTag && address && (
          <div style={{ display: 'grid', gap: 12 }}>
            {tag === 'cp_ville_incoherents' && check && (
              <div style={{ padding: '10px 12px', borderRadius: 8, background: C.redL, fontSize: 13, lineHeight: 1.5 }}>
                {check.status === 'cp_inconnu'
                  ? <>Le code postal {data.shipping.postcode} n'existe pas dans la base La Poste.</>
                  : <>« {data.shipping.city} » n'est pas une commune du {data.shipping.postcode}.</>}
                {' '}Colissimo facture 3 € HT une commune qui ne correspond pas au code postal.
                {check.otherPostcodes?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    Cette ville existe au :{' '}
                    {check.otherPostcodes.slice(0, 6).map(cp => (
                      <button key={cp} type="button" style={{ ...chip, marginRight: 6 }}
                        onClick={() => setAddress(a => ({ ...a, postcode: cp }))}>{cp}</button>
                    ))}
                  </div>
                )}
                {check.suggestions?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    Communes du {data.shipping.postcode} :{' '}
                    {check.suggestions.slice(0, 12).map(v => (
                      <button key={v} type="button" style={{ ...chip, margin: '0 6px 6px 0' }}
                        onClick={() => setAddress(a => ({ ...a, city: v }))}>{v}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
            padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.greyB}`, background: C.white, color: C.dark, cursor: 'pointer',
          }}>Fermer</button>
          {data && tag === 'cp_ville_incoherents' && address && (
            <button onClick={confirmAsIs} disabled={saving}
              title="L'adresse est juste malgré la base La Poste (code CEDEX, commune nouvelle) : la commande redevient sélectionnable."
              style={{
                padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.violet}`, background: C.white, color: C.violet,
                fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
              }}>Adresse vérifiée, garder telle quelle</button>
          )}
          {data && (tag === 'point_relais_manquant' || addressTag) && (
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
