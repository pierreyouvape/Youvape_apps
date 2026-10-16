import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { C, carrierLabel } from '../picking/pickingUi';
import { formatDateUTC } from '../../utils/dateUtils';
import { RETURNS_API, RETURNS_COLOR, btn, field, errorText } from './returnsUi';

/**
 * Pop-up « Déclarer colis perdu » (Pierre, 16/10/2026) — à côté de « Créer un
 * retour ». Toute la commande est cochée d'office (un colis sur deux perdu :
 * décocher). Rien ne revient : le constat est validé à la déclaration, et
 * l'issue prévue est la commande de renvoi, créée ensuite depuis la fiche.
 */
export default function DeclareLostModal({ wpOrderId, ticketId, onClose, onCreated }) {
  const [ctx, setCtx] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [qty, setQty] = useState({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${RETURNS_API}/order/${wpOrderId}`)
      .then(({ data }) => {
        setCtx(data);
        setQty(Object.fromEntries(data.lines.filter(l => !l.bundleOf && l.returnable).map(l => [l.orderItemId, l.returnable])));
      })
      .catch(e => setLoadError(errorText(e)));
  }, [wpOrderId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setLineQty = (line, value) => {
    const n = Math.max(0, Math.min(line.returnable, Number.parseInt(value, 10) || 0));
    setQty(q => ({ ...q, [line.orderItemId]: n }));
  };

  const selection = Object.entries(qty).filter(([, n]) => n > 0).map(([orderItemId, n]) => ({ orderItemId, qty: n }));
  const canSubmit = selection.length && !saving;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`${RETURNS_API}/lost`, { wpOrderId, ticketId: ticketId || null, note, selection });
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
            Déclarer colis perdu — commande #{wpOrderId}
            {ticketId && <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}> · ticket #{ticketId}</span>}
          </div>
          <button type="button" onClick={onClose} style={{ ...btn('ghost'), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loadError && <div style={{ color: C.red, fontWeight: 600 }}>{loadError}</div>}
          {!ctx && !loadError && <div style={{ color: C.greyT }}>Chargement…</div>}

          {ctx && (
            <>
              <div>
                <div style={label}>Colis</div>
                {ctx.shipments.length === 0
                  ? <span style={{ fontSize: 13.5, color: C.greyT }}>Aucune étiquette connue pour cette commande.</span>
                  : ctx.shipments.map((s, i) => (
                    <div key={i} style={{ fontSize: 13.5 }}>
                      <strong>{carrierLabel({ carrierCode: s.carrier_code, accountCode: s.account_code })}</strong>
                      {s.tracking_number && <> · n°{s.tracking_number}</>}
                      <span style={{ color: C.greyT }}> · {formatDateUTC(s.created_at)}</span>
                    </div>
                  ))}
              </div>

              <div>
                <div style={label}>Articles perdus</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <tbody>
                    {ctx.lines.map(l => {
                      const parentQty = l.bundleOf ? qty[l.bundleOf] : 0;
                      return (
                        <tr key={l.orderItemId} style={{ borderBottom: `1px solid ${C.greyB}` }}>
                          <td style={{ padding: '7px 6px', width: 40 }}>
                            {l.imageUrl && <img src={l.imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6 }} />}
                          </td>
                          <td style={{ padding: '7px 6px', paddingLeft: l.bundleOf ? 26 : 6 }}>
                            <div style={{ fontWeight: 600, color: C.dark }}>
                              {l.productType === 'woosb' && <span style={{ fontSize: 11, fontWeight: 800, color: RETURNS_COLOR, marginRight: 6 }}>PACK</span>}
                              {l.name}
                            </div>
                            <div style={{ fontSize: 12, color: C.greyT }}>
                              {l.sku || 'sans SKU'} · commandé {l.qty}
                              {l.returnable < l.qty && ` · ${l.qty - l.returnable} déjà dans un retour`}
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
                              <span style={{ fontSize: 12, color: C.greyT }}>déjà dans un retour</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <div style={label}>Note (facultatif)</div>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Réclamation, échange avec le transporteur…" style={{ ...field, width: '100%' }} />
              </div>

              <div style={{ fontSize: 12.5, color: C.greyT }}>
                Rien n’est remis en stock. La commande de renvoi (même méthode d’expédition, articles à 0 €) se crée ensuite depuis la fiche du retour.
                Colis retrouvé : annuler la déclaration.
              </div>

              {error && <div style={{ color: C.red, fontWeight: 600, fontSize: 13.5 }}>{error}</div>}
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.greyB}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={btn('ghost')}>Annuler</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn('danger', !canSubmit)}>
            {saving ? 'Enregistrement…' : 'Déclarer perdu'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
