import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Picking as PickingIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C, CarrierLogo, carrierKey, carrierLabel } from '../components/picking/pickingUi';

/**
 * Règles de génération des vagues.
 *
 * Une règle = des modes de livraison, une taille maximale et un préfixe. Les
 * règles passent dans l'ordre de la liste : une commande prise par une règle ne
 * l'est plus par les suivantes. Elles ne prennent que les commandes « En cours »
 * libres ; les partielles se mettent en vague à la main.
 */

const EMPTY = { name: '', denominations: [], maxOrders: 10, prefix: '', active: true };

const input = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 14, boxSizing: 'border-box',
};
const btn = (primary) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : `1px solid ${C.greyB}`, background: primary ? C.violet : C.white,
  color: primary ? C.white : C.dark,
});

export default function PickingSettings() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const canWrite = isSuperAdmin || permissions?.picking?.write === true;
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await axios.get(`${API_URL}/picking/rules`, authHeaders(token));
      setData(d);
      setPrefix(d.manualPrefix);
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Modes de livraison regroupés par transporteur (2Shop à part de Chronopost).
  const groups = useMemo(() => {
    const m = new Map();
    for (const d of data?.denominations || []) {
      const carrier = { carrierCode: d.carrierCode, accountCode: d.accountCode, status: d.carrierCode ? 'mapped' : 'no_label' };
      const k = carrierKey(carrier);
      if (!m.has(k)) m.set(k, { carrier, items: [] });
      m.get(k).items.push(d.denomination);
    }
    return [...m.entries()];
  }, [data]);

  const save = async () => {
    try {
      const body = { ...editing, priority: editing.priority ?? (data.rules.length + 1) * 10 };
      if (editing.id) await axios.put(`${API_URL}/picking/rules/${editing.id}`, body, authHeaders(token));
      else await axios.post(`${API_URL}/picking/rules`, body, authHeaders(token));
      setEditing(null);
      setMessage({ kind: 'ok', text: 'Règle enregistrée.' });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Supprimer la règle « ${rule.name} » ? Les vagues déjà créées restent.`)) return;
    await axios.delete(`${API_URL}/picking/rules/${rule.id}`, authHeaders(token));
    load();
  };

  // Réordonne en réécrivant les priorités 10, 20, 30…
  const move = async (index, delta) => {
    const rules = [...data.rules];
    const [r] = rules.splice(index, 1);
    rules.splice(index + delta, 0, r);
    await Promise.all(rules.map((rule, i) =>
      axios.put(`${API_URL}/picking/rules/${rule.id}`, { ...rule, priority: (i + 1) * 10 }, authHeaders(token))));
    load();
  };

  const toggleActive = async (rule) => {
    await axios.put(`${API_URL}/picking/rules/${rule.id}`, { ...rule, active: !rule.active }, authHeaders(token));
    load();
  };

  const savePrefix = async () => {
    try {
      await axios.put(`${API_URL}/picking/settings/manual-prefix`, { prefix }, authHeaders(token));
      setMessage({ kind: 'ok', text: 'Préfixe des vagues manuelles enregistré.' });
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err.response?.data?.error || err.message });
    }
  };

  const toggleDen = (den) => setEditing(e => ({
    ...e,
    denominations: e.denominations.includes(den) ? e.denominations.filter(d => d !== den) : [...e.denominations, den],
  }));
  const toggleGroup = (items) => setEditing(e => {
    const all = items.every(d => e.denominations.includes(d));
    return {
      ...e,
      denominations: all ? e.denominations.filter(d => !items.includes(d)) : [...new Set([...e.denominations, ...items])],
    };
  });

  return (
    <AppShell currentPath="/picking/settings">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px 60px' }}>
          <Link to="/picking" style={{
            display: 'inline-block', marginBottom: 14, padding: '6px 12px', borderRadius: 8,
            border: `1px solid ${C.greyB}`, background: C.white, color: C.dark, fontSize: 13.5,
            fontWeight: 600, textDecoration: 'none',
          }}>← Retour au Picking</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: C.violet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PickingIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Règles des vagues
            </h1>
          </div>
          <p style={{ margin: '0 0 20px', color: C.greyT, fontSize: 13.5, lineHeight: 1.5 }}>
            Les règles passent <strong>dans l'ordre de la liste</strong> : une commande prise par une règle ne l'est plus
            par les suivantes. Elles ne prennent que les commandes « En cours » libres, les plus anciennement payées d'abord.
            Exemple : Mondial Relay par 10, avec 58 commandes → 5 vagues de 10 et 1 de 8.
          </p>

          {message && (
            <div style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
              background: message.kind === 'error' ? C.redL : C.greenL, color: message.kind === 'error' ? C.red : C.green,
            }}>{message.text}</div>
          )}

          {!data ? <p style={{ color: C.greyT }}>Chargement…</p> : (
            <>
              <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 20 }}>
                {data.rules.length === 0 && (
                  <p style={{ padding: 20, margin: 0, color: C.greyT }}>Aucune règle pour l'instant.</p>
                )}
                {data.rules.map((r, i) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                    borderTop: i ? `1px solid ${C.greyB}` : 'none', opacity: r.active ? 1 : 0.5,
                  }}>
                    <span style={{ width: 22, color: C.greyT, fontWeight: 700 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {r.name}{' '}
                        <span style={{ fontFamily: 'monospace', color: C.violet }}>{r.prefix}-</span>{' '}
                        <span style={{ color: C.greyT, fontWeight: 400, fontSize: 13 }}>· {r.maxOrders} commandes max</span>
                        {!r.active && <span style={{ color: C.red, fontSize: 12, marginLeft: 8 }}>inactive</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 3 }}>{r.denominations.join(' · ')}</div>
                    </div>
                    {canWrite && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button disabled={i === 0} onClick={() => move(i, -1)} style={{ ...btn(), padding: '4px 9px' }} title="Monter">↑</button>
                        <button disabled={i === data.rules.length - 1} onClick={() => move(i, 1)} style={{ ...btn(), padding: '4px 9px' }} title="Descendre">↓</button>
                        <button onClick={() => toggleActive(r)} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>{r.active ? 'Désactiver' : 'Activer'}</button>
                        <button onClick={() => setEditing({ ...r })} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>Modifier</button>
                        <button onClick={() => remove(r)} style={{ ...btn(), padding: '4px 10px', fontSize: 12, color: C.red }}>Supprimer</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {canWrite && !editing && (
                <button onClick={() => setEditing({ ...EMPTY })} style={btn(true)}>+ Nouvelle règle</button>
              )}

              {editing && (
                <div style={{ background: C.white, border: `2px solid ${C.violet}`, borderRadius: 12, padding: 18 }}>
                  <h2 style={{ margin: '0 0 14px', fontSize: 17, color: C.primary }}>{editing.id ? 'Modifier la règle' : 'Nouvelle règle'}</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 600 }}>Nom
                      <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={{ ...input, width: '100%', marginTop: 4 }} placeholder="Mondial Relay" />
                    </label>
                    <label style={{ fontSize: 12.5, fontWeight: 600 }}>Préfixe
                      <input value={editing.prefix} maxLength={10} onChange={e => setEditing({ ...editing, prefix: e.target.value.toUpperCase() })} style={{ ...input, width: '100%', marginTop: 4, fontFamily: 'monospace' }} placeholder="MR" />
                    </label>
                    <label style={{ fontSize: 12.5, fontWeight: 600 }}>Commandes max par vague
                      <input type="number" min={1} value={editing.maxOrders} onChange={e => setEditing({ ...editing, maxOrders: e.target.value })} style={{ ...input, width: '100%', marginTop: 4 }} />
                    </label>
                  </div>

                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Modes de livraison concernés</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                    {groups.map(([k, g]) => {
                      const all = g.items.every(d => editing.denominations.includes(d));
                      return (
                        <div key={k} style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                            <input type="checkbox" checked={all} onChange={() => toggleGroup(g.items)} />
                            {g.carrier.carrierCode ? <CarrierLogo carrier={g.carrier} height={20} /> : <strong>{carrierLabel(g.carrier)}</strong>}
                          </label>
                          {g.items.map(den => (
                            <label key={den} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0 3px 22px', cursor: 'pointer' }}>
                              <input type="checkbox" checked={editing.denominations.includes(den)} onChange={() => toggleDen(den)} />
                              {den}
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                    <button onClick={() => setEditing(null)} style={btn()}>Annuler</button>
                    <button onClick={save} style={btn(true)}>Enregistrer</button>
                  </div>
                </div>
              )}

              <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 18, marginTop: 24 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 16, color: C.primary }}>Vagues manuelles</h2>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: C.greyT }}>
                  Préfixe des vagues créées à la main depuis la liste des commandes.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input value={prefix} maxLength={10} disabled={!canWrite} onChange={e => setPrefix(e.target.value.toUpperCase())} style={{ ...input, width: 120, fontFamily: 'monospace' }} />
                  {canWrite && <button onClick={savePrefix} style={btn()}>Enregistrer</button>}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
