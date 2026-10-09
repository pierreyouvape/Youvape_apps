import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { C } from '../picking/pickingUi';
import {
  RETURNS_API, RETURNS_COLOR, RETURNS_COLOR_L, REASONS, OUTCOMES, DEFAULT_OUTCOME,
  btn, field, errorText, euro,
} from './returnsUi';

/**
 * Pop-up « Créer un retour » — depuis un ticket (ticketId, produits concernés
 * pré-cochés) ou depuis le détail d'une commande.
 *
 * Cocher un pack emporte ses composants : c'est sur eux que se fera la remise
 * en stock (le serveur fait la même règle, returnRules.expandSelection).
 */
export default function CreateReturnModal({ wpOrderId, ticketId, concernedProducts, onClose, onCreated }) {
  const [ctx, setCtx] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reason, setReason] = useState('');
  const [returnRequired, setReturnRequired] = useState(true);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Figés à l'ouverture : le ticket se rafraîchit en direct, la saisie ne doit pas sauter.
  const [initialConcerned] = useState(concernedProducts);

  useEffect(() => {
    axios.get(`${RETURNS_API}/order/${wpOrderId}`)
      .then(({ data }) => {
        setCtx(data);
        // Produits signalés dans le ticket : pré-cochés.
        const pre = {};
        for (const cp of Array.isArray(initialConcerned) ? initialConcerned : []) {
          const line = data.lines.find(l => l.sku && l.sku === cp.sku);
          if (line && line.returnable) pre[line.orderItemId] = Math.min(line.returnable, Number(cp.qty) || 1);
        }
        setQty(pre);
      })
      .catch(e => setLoadError(errorText(e)));
  }, [wpOrderId, initialConcerned]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lines = useMemo(() => ctx?.lines || [], [ctx]);

  const chooseReason = (r) => {
    setReason(r);
    setOutcome(DEFAULT_OUTCOME[r]);
    // Commande non récupérée : c'est toute la commande qui revient.
    if (r === 'non_recupere') {
      setReturnRequired(true);
      setQty(Object.fromEntries(lines.filter(l => !l.bundleOf && l.returnable).map(l => [l.orderItemId, l.returnable])));
    }
  };

  const setLineQty = (line, value) => {
    const n = Math.max(0, Math.min(line.returnable, Number.parseInt(value, 10) || 0));
    setQty(q => ({ ...q, [line.orderItemId]: n }));
  };

  const selection = Object.entries(qty).filter(([, n]) => n > 0).map(([orderItemId, n]) => ({ orderItemId, qty: n }));
  const canSubmit = reason && outcome && selection.length && !saving;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(RETURNS_API, {
        wpOrderId, ticketId: ticketId || null, reason, returnRequired, outcome, note, selection,
      });
      onCreated?.(data);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const label = { fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 };

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto',
        fontFamily: 'Lato, sans-serif',
      }}
    >
      <div style={{ background: C.white, borderRadius: 14, width: 'min(760px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.greyB}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.dark, flex: 1 }}>
            Créer un retour — commande #{wpOrderId}
            {ticketId && <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}> · ticket #{ticketId}</span>}
          </div>
          <button type="button" onClick={onClose} style={{ ...btn('ghost'), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loadError && <div style={{ color: C.red, fontWeight: 600 }}>{loadError}</div>}
          {!ctx && !loadError && <div style={{ color: C.greyT }}>Chargement…</div>}

          {ctx && (
            <>
              {ctx.returns.some(r => r.status !== 'annule') && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: C.amberL, color: C.amber, fontSize: 13, fontWeight: 600 }}>
                  Cette commande a déjà {ctx.returns.filter(r => r.status !== 'annule').length} retour(s) :
                  les quantités proposées en tiennent compte.
                </div>
              )}

              <div>
                <div style={label}>Motif</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.entries(REASONS).map(([k, v]) => (
                    <button
                      key={k} type="button" onClick={() => chooseReason(k)}
                      style={{
                        ...btn('ghost'),
                        borderColor: reason === k ? RETURNS_COLOR : C.greyB,
                        background: reason === k ? RETURNS_COLOR_L : C.white,
                        color: reason === k ? RETURNS_COLOR : C.dark,
                      }}
                    >{v}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={label}>Articles retournés</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <tbody>
                    {lines.map(l => {
                      const parentQty = l.bundleOf ? qty[l.bundleOf] : 0;
                      const isBundle = l.productType === 'woosb';
                      return (
                        <tr key={l.orderItemId} style={{ borderBottom: `1px solid ${C.greyB}` }}>
                          <td style={{ padding: '7px 6px', width: 40 }}>
                            {l.imageUrl && <img src={l.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6 }} />}
                          </td>
                          <td style={{ padding: '7px 6px', paddingLeft: l.bundleOf ? 26 : 6 }}>
                            <div style={{ fontWeight: 600, color: C.dark }}>
                              {isBundle && <span style={{ fontSize: 11, fontWeight: 800, color: RETURNS_COLOR, marginRight: 6 }}>PACK</span>}
                              {l.name}
                            </div>
                            <div style={{ fontSize: 12, color: C.greyT }}>
                              {l.sku || 'sans SKU'} · commandé {l.qty} · {l.bundleOf ? 'dans le pack' : `${euro(l.unitPaid)} / pièce`}
                              {l.returnable < l.qty && ` · ${l.qty - l.returnable} déjà retourné(s)`}
                            </div>
                          </td>
                          <td style={{ padding: '7px 6px', width: 130, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {l.bundleOf && parentQty ? (
                              <span style={{ fontSize: 12, color: C.greyT }}>avec le pack</span>
                            ) : l.returnable ? (
                              <>
                                <input
                                  type="number" min={0} max={l.returnable} value={qty[l.orderItemId] || 0}
                                  onChange={e => setLineQty(l, e.target.value)}
                                  style={{ ...field, width: 70, textAlign: 'right' }}
                                />
                                <span style={{ marginLeft: 8, fontSize: 13.5, color: C.greyT, fontWeight: 600 }}>/ {l.returnable}</span>
                              </>
                            ) : (
                              <span style={{ fontSize: 12, color: C.greyT }}>déjà retourné</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={returnRequired} onChange={e => setReturnRequired(e.target.checked)} />
                Le client renvoie le produit
                {!returnRequired && <span style={{ fontSize: 12.5, color: C.greyT }}>— il le garde : rien ne sera remis en stock</span>}
              </label>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={label}>Issue prévue</div>
                  <select value={outcome} onChange={e => setOutcome(e.target.value)} style={{ ...field, minWidth: 200 }}>
                    <option value="">—</option>
                    {Object.entries(OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={label}>Note (facultatif)</div>
                  <input value={note} onChange={e => setNote(e.target.value)} style={{ ...field, width: '100%' }} />
                </div>
              </div>

              {error && <div style={{ color: C.red, fontWeight: 600, fontSize: 13.5 }}>{error}</div>}
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.greyB}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={btn('ghost')}>Annuler</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn('primary', !canSubmit)}>
            {saving ? 'Création…' : 'Créer le retour'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
