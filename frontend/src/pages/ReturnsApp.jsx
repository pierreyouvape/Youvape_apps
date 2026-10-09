import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Returns as ReturnsIcon } from '../components/AppIcons';
import { C, Chip } from '../components/picking/pickingUi';
import useTicketsAccess from '../components/tickets/useTicketsAccess';
import ReturnLabelActions from '../components/returns/ReturnLabelActions';
import { formatDate, formatDateUTC } from '../utils/dateUtils';
import {
  RETURNS_API, RETURNS_COLOR, RETURNS_COLOR_L, REASONS, OUTCOMES, OUTCOME_REF_HINT, STATUS,
  StatusChip, btn, field, errorText, customerName, euro,
} from '../components/returns/returnsUi';

/**
 * Retours — /retours, droit `tickets`. Lot 1, validé avec Pierre le 09/10/2026.
 *
 *   /retours                          liste des retours
 *   /retours/:id                      fiche : validation, remise en stock, issue client
 *   /retours/fournisseurs             stock SAV par fournisseur
 *   /retours/fournisseurs/:supplierId lignes à retourner, renvoi + export
 *
 * Les retours se créent depuis un ticket ou une commande (OrderReturnsBox).
 */

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${C.greyB}`, whiteSpace: 'nowrap' };
const td = { padding: '9px 12px', fontSize: 13.5, color: C.dark, borderBottom: `1px solid ${C.greyB}`, verticalAlign: 'middle' };
const panel = { background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 14, padding: 18 };
const label = { fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 };
const link = { color: RETURNS_COLOR, fontWeight: 700, textDecoration: 'none' };

const SUPPLIER_STATUS = {
  a_retourner: { label: 'À retourner', color: C.amber, bg: C.amberL },
  envoye: { label: 'Envoyé', color: C.blue, bg: C.blueL },
  solde: { label: 'Soldé', color: C.green, bg: C.greenL },
};

const daysSince = (d) => Math.floor((Date.now() - new Date(String(d).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? '' : 'Z')).getTime()) / 86400000);

const Banner = ({ kind, children, onClose }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13.5,
    background: kind === 'error' ? C.redL : C.greenL, color: kind === 'error' ? C.red : C.green, fontWeight: 600,
  }}>
    <span style={{ flex: 1 }}>{children}</span>
    {onClose && <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>✕</button>}
  </div>
);

const ProductCell = ({ name, sku, imageUrl, indent, pack }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: indent ? 24 : 0 }}>
    {imageUrl ? <img src={imageUrl} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} /> : <span style={{ width: 34 }} />}
    <div>
      <div style={{ fontWeight: 600 }}>
        {pack && <span style={{ fontSize: 11, fontWeight: 800, color: RETURNS_COLOR, marginRight: 6 }}>PACK</span>}
        {name}
      </div>
      <div style={{ fontSize: 12, color: C.greyT }}>{sku || 'sans SKU'}</div>
    </div>
  </div>
);

// ── Liste ───────────────────────────────────────────────────────────────────

function ListView({ navigate }) {
  const [status, setStatus] = useState('attente');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      axios.get(RETURNS_API, { params: { status: status || undefined, q: q || undefined } })
        .then(({ data: d }) => { setData(d); setError(''); })
        .catch(e => setError(errorText(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [status, q]);

  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const filters = [['', 'Tous', total], ...Object.entries(STATUS).map(([k, v]) => [k, v.label, counts[k] || 0])];

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {filters.map(([k, l, n]) => (
          <button
            key={k || 'all'} type="button" onClick={() => setStatus(k)}
            style={{
              ...btn('ghost'), padding: '6px 12px', fontSize: 13,
              borderColor: status === k ? RETURNS_COLOR : C.greyB,
              background: status === k ? RETURNS_COLOR_L : C.white,
              color: status === k ? RETURNS_COLOR : C.dark,
            }}
          >{l} <span style={{ color: C.greyT, fontWeight: 600 }}>{n}</span></button>
        ))}
        <span style={{ flex: 1 }} />
        <input
          value={q} onChange={e => setQ(e.target.value)} placeholder="N° de retour, de commande, client…"
          style={{ ...field, width: 280 }}
        />
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!data && !error && <p style={{ color: C.greyT }}>Chargement…</p>}
      {data && (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>N°</th><th style={th}>Créé le</th><th style={th}>Client</th><th style={th}>Commande</th>
                <th style={th}>Motif</th><th style={{ ...th, textAlign: 'right' }}>Pièces</th><th style={th}>Issue</th><th style={th}>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.returns.length === 0 && (
                <tr><td colSpan={8} style={{ ...td, color: C.greyT, textAlign: 'center', padding: 30 }}>Aucun retour.</td></tr>
              )}
              {data.returns.map(r => {
                const age = daysSince(r.created_at);
                const late = r.status === 'attente' && age >= 15;
                return (
                  <tr key={r.id} onClick={() => navigate(`/retours/${r.id}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...td, fontWeight: 800, color: RETURNS_COLOR }}>{r.id}</td>
                    <td style={td}>
                      {formatDateUTC(r.created_at, { time: false })}
                      <div style={{ fontSize: 12, color: late ? C.red : C.greyT, fontWeight: late ? 700 : 400 }}>il y a {age} j</div>
                    </td>
                    <td style={td}>{customerName(r)}</td>
                    <td style={td}>#{r.wp_order_id}</td>
                    <td style={td}>{REASONS[r.reason]}{!r.return_required && <div style={{ fontSize: 12, color: C.greyT }}>sans retour produit</div>}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.pieces}</td>
                    <td style={td}>{r.outcome ? OUTCOMES[r.outcome] : '—'}{r.treated_at && <span style={{ color: C.green }}> ✓</span>}</td>
                    <td style={td}><StatusChip status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Fiche ───────────────────────────────────────────────────────────────────

/** Destination proposée : un défaut part chez le fournisseur, le reste revient en stock. */
const defaultDestination = (r, line) => {
  const base = { restock: 0, supplier: 0, noRestock: 0, supplierId: line.supplierCandidates?.suggested || '', problem: '' };
  if (r.reason === 'defaut' && line.product_id) return { ...base, supplier: line.qty };
  if (r.return_required && line.sku) return { ...base, restock: line.qty };
  return { ...base, noRestock: line.qty };
};

function SupplierSelect({ line, suppliers, value, onChange }) {
  const known = line.supplierCandidates?.suppliers || [];
  const others = suppliers.filter(s => !known.some(k => k.id === s.id));
  return (
    <select value={value || ''} onChange={e => onChange(Number(e.target.value) || '')} style={{ ...field, minWidth: 220 }}>
      <option value="">Fournisseur…</option>
      {known.length > 0 && (
        <optgroup label="Achetés chez">
          {known.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} — dernier lot {formatDate(s.lastReceived, { time: false })}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={known.length ? 'Autres fournisseurs' : 'Fournisseurs'}>
        {others.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </optgroup>
    </select>
  );
}

function ValidationForm({ ret, onDone, setMessage }) {
  const lines = ret.lines.filter(l => !l.is_bundle);
  const [dest, setDest] = useState(() => Object.fromEntries(lines.map(l => [l.id, defaultDestination(ret, l)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (id, k, v) => setDest(d => ({ ...d, [id]: { ...d[id], [k]: v } }));
  const num = (v) => Math.max(0, Number.parseInt(v, 10) || 0);

  const submit = async () => {
    const restock = lines.reduce((n, l) => n + dest[l.id].restock, 0);
    if (restock && !window.confirm(`${restock} pièce(s) vont être remises en stock dans BMS. C'est définitif : continuer ?`)) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`${RETURNS_API}/${ret.id}/validate`, {
        destinations: lines.map(l => ({ lineId: l.id, ...dest[l.id] })),
      });
      if (data.restockErrors?.length) {
        setMessage({ kind: 'error', text: `Retour validé, mais BMS a refusé une remise en stock : ${data.restockErrors.join(' ; ')}` });
      } else {
        setMessage({ kind: 'ok', text: 'Retour validé.' });
      }
      onDone(data);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const qtyInput = (l, k, disabled) => (
    <input
      type="number" min={0} max={l.qty} value={dest[l.id][k]} disabled={disabled}
      onChange={e => set(l.id, k, num(e.target.value))}
      style={{ ...field, width: 64, textAlign: 'right', background: disabled ? C.grey : C.white }}
    />
  );

  return (
    <div style={panel}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.dark, marginBottom: 4 }}>
        {ret.return_required ? 'Valider la réception' : 'Valider le constat'}
      </div>
      <div style={{ fontSize: 13, color: C.greyT, marginBottom: 14 }}>
        Chaque pièce reçoit une destination.
        {!ret.return_required && ' Sans retour du produit, rien ne peut être remis en stock.'}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Article</th><th style={{ ...th, textAlign: 'right' }}>Qté</th>
              <th style={{ ...th, textAlign: 'center' }}>Remettre en stock</th>
              <th style={{ ...th, textAlign: 'center' }}>SAV fournisseur</th>
              <th style={{ ...th, textAlign: 'center' }}>Ne pas remettre en stock</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const d = dest[l.id];
              const sum = d.restock + d.supplier + d.noRestock;
              return [
                <tr key={l.id}>
                  <td style={td}><ProductCell name={l.name} sku={l.sku} imageUrl={l.image_url} /></td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: sum === l.qty ? C.dark : C.red }}>
                    {l.qty}{sum !== l.qty && <div style={{ fontSize: 11.5 }}>{sum} répartie(s)</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>{qtyInput(l, 'restock', !ret.return_required || !l.sku)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{qtyInput(l, 'supplier', !l.product_id)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{qtyInput(l, 'noRestock', false)}</td>
                </tr>,
                d.supplier > 0 && (
                  <tr key={`${l.id}-sav`}>
                    <td colSpan={5} style={{ ...td, background: C.grey }}>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <SupplierSelect line={l} suppliers={ret.suppliers} value={d.supplierId} onChange={v => set(l.id, 'supplierId', v)} />
                        <input
                          value={d.problem} onChange={e => set(l.id, 'problem', e.target.value)}
                          placeholder="Problème constaté (repris dans l'export fournisseur)"
                          style={{ ...field, flex: 1, minWidth: 260 }}
                        />
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {error && <div style={{ color: C.red, fontWeight: 600, fontSize: 13.5, marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={submit} disabled={saving} style={btn('primary', saving)}>
          {saving ? 'Validation…' : ret.return_required ? 'Valider la réception' : 'Valider'}
        </button>
      </div>
    </div>
  );
}

function ReceivedLines({ ret, canWrite, onDone, setMessage }) {
  const [retrying, setRetrying] = useState(false);
  const pending = ret.lines.some(l => l.restocked_qty < l.qty_restock);

  const retry = async () => {
    setRetrying(true);
    try {
      const { data } = await axios.post(`${RETURNS_API}/${ret.id}/restock`);
      setMessage(data.restockErrors?.length
        ? { kind: 'error', text: `BMS refuse encore : ${data.restockErrors.join(' ; ')}` }
        : { kind: 'ok', text: 'Remise en stock faite dans BMS.' });
      onDone(data);
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
    setRetrying(false);
  };

  return (
    <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Article</th><th style={{ ...th, textAlign: 'right' }}>Qté</th><th style={th}>Payé / pièce</th>
            {ret.received_at && <th style={th}>Destination</th>}
          </tr>
        </thead>
        <tbody>
          {ret.lines.map(l => (
            <tr key={l.id}>
              <td style={td}><ProductCell name={l.name} sku={l.sku} imageUrl={l.image_url} indent={!!l.bundle_line_id} pack={l.is_bundle} /></td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{l.qty}</td>
              <td style={td}>{l.bundle_line_id ? <span style={{ color: C.greyT }}>dans le pack</span> : euro(l.unit_paid)}</td>
              {ret.received_at && (
                <td style={td}>
                  {l.is_bundle ? <span style={{ color: C.greyT }}>voir les composants</span> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {l.qty_restock > 0 && (
                        <span>
                          {l.qty_restock} remis en stock{' '}
                          {l.restocked_qty >= l.qty_restock
                            ? <Chip color={C.green} bg={C.greenL}>BMS{l.bms_movement_id ? ` n°${l.bms_movement_id}` : ''}</Chip>
                            : <Chip color={C.red} bg={C.redL}>pas encore dans BMS</Chip>}
                        </span>
                      )}
                      {l.qty_supplier > 0 && (
                        <span>
                          {l.qty_supplier} SAV {l.supplier_name}{' '}
                          {l.supplier_status && <Chip color={SUPPLIER_STATUS[l.supplier_status].color} bg={SUPPLIER_STATUS[l.supplier_status].bg}>{SUPPLIER_STATUS[l.supplier_status].label}</Chip>}
                          {l.problem && <div style={{ fontSize: 12, color: C.greyT }}>{l.problem}</div>}
                        </span>
                      )}
                      {l.qty_no_restock > 0 && <span>{l.qty_no_restock} non remis en stock</span>}
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {pending && canWrite && (
        <div style={{ padding: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={retry} disabled={retrying} style={btn('primary', retrying)}>
            {retrying ? 'Envoi…' : 'Relancer la remise en stock BMS'}
          </button>
        </div>
      )}
    </div>
  );
}

function ReplacementModal({ ret, onClose, onDone, setMessage }) {
  const [data, setData] = useState(null);
  const [qty, setQty] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${RETURNS_API}/${ret.id}/replacement`)
      .then(({ data: d }) => { setData(d); setQty(Object.fromEntries(d.items.map(i => [i.lineId, i.qty]))); })
      .catch(e => setError(errorText(e)));
  }, [ret.id]);

  const short = (data?.items || []).filter(i => (qty[i.lineId] || 0) > 0 && (i.available == null || i.available < qty[i.lineId]));
  const chosen = (data?.items || []).filter(i => (qty[i.lineId] || 0) > 0);
  const canSubmit = data && chosen.length && !short.length && !saving;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data: r } = await axios.post(`${RETURNS_API}/${ret.id}/replacement`, {
        items: chosen.map(i => ({ lineId: i.lineId, qty: qty[i.lineId] })),
      });
      setMessage({
        kind: r.warnings?.length ? 'error' : 'ok',
        text: `Commande de renvoi ${r.outcome_ref} créée.${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''}`,
      });
      onDone(r);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px' }}
    >
      <div style={{ background: C.white, borderRadius: 14, width: 'min(680px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.greyB}`, fontSize: 17, fontWeight: 800 }}>
          Commande de renvoi — retour n°{ret.id}
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!data && !error && <span style={{ color: C.greyT }}>Lecture du stock BMS…</span>}
          {data && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={th}>Article</th><th style={{ ...th, textAlign: 'right' }}>Dispo BMS</th><th style={{ ...th, textAlign: 'right' }}>À renvoyer</th></tr>
                </thead>
                <tbody>
                  {data.items.map(i => {
                    const q = qty[i.lineId] || 0;
                    const ko = q > 0 && (i.available == null || i.available < q);
                    return (
                      <tr key={i.lineId}>
                        <td style={td}>{i.name}<div style={{ fontSize: 12, color: C.greyT }}>{i.sku}</div></td>
                        <td style={{ ...td, textAlign: 'right', color: ko ? C.red : C.dark, fontWeight: 700 }}>
                          {i.available ?? <span title={i.stockError}>?</span>}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input
                            type="number" min={0} value={q}
                            onChange={e => setQty(s => ({ ...s, [i.lineId]: Math.max(0, Number.parseInt(e.target.value, 10) || 0) }))}
                            style={{ ...field, width: 64, textAlign: 'right' }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 13.5 }}>
                Expédition : <strong>{data.plan?.method || '—'}</strong>
                {data.plan && data.plan.method !== data.shippingMethod && <span style={{ color: C.greyT }}> (au lieu de {data.shippingMethod})</span>}
                {data.plan?.keepRelay && data.relayPoint?.id && <div style={{ fontSize: 12.5, color: C.greyT }}>Point relais repris : {data.relayPoint.name || data.relayPoint.id}</div>}
                {data.plan?.needsRelay && !data.plan.keepRelay && <div style={{ fontSize: 12.5, color: C.amber, fontWeight: 600 }}>Le point 2Shop sera à saisir dans la nouvelle commande.</div>}
              </div>
              <div style={{ fontSize: 12.5, color: C.greyT }}>
                Commande à 0 €, statut « En cours », note « SAV commande N°{ret.wp_order_id} ». WooCommerce enverra son email habituel au client.
              </div>
            </>
          )}
          {error && <div style={{ color: C.red, fontWeight: 600, fontSize: 13.5 }}>{error}</div>}
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.greyB}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={btn('ghost')}>Annuler</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn('primary', !canSubmit)}>
            {saving ? 'Création…' : 'Créer la commande'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutcomePanel({ ret, canWrite, onDone, setMessage }) {
  const [editing, setEditing] = useState(!ret.treated_at);
  const [outcome, setOutcome] = useState(ret.outcome || '');
  const [ref, setRef] = useState(ret.outcome_ref || '');
  const [withShipping, setWithShipping] = useState(false);
  const [points, setPoints] = useState(ret.suggested_points?.lines || 0);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const post = async (path, body, okText) => {
    setSaving(true);
    try {
      const { data } = await axios.post(`${RETURNS_API}/${ret.id}/${path}`, body);
      setMessage({ kind: 'ok', text: okText });
      setEditing(false);
      onDone(data);
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
    setSaving(false);
  };

  const toggleShipping = (v) => {
    setWithShipping(v);
    setPoints(v ? ret.suggested_points.withShipping : ret.suggested_points.lines);
  };

  const creditPoints = () => {
    if (!window.confirm(`Créditer ${points} points (${euro(points / 100)}) à ${ret.billing_email} ?`)) return;
    post('points', { points }, `${points} points crédités.`);
  };

  const done = ret.treated_at && !editing;

  return (
    <div style={panel}>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.dark, marginBottom: 10 }}>Issue client</div>

      {done ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Chip color={C.green} bg={C.greenL}>{OUTCOMES[ret.outcome]} ✓</Chip>
          {ret.replacement_order_id
            ? <a href={`/orders/${ret.replacement_order_id}`} target="_blank" rel="noopener noreferrer" style={link}>{ret.outcome_ref}</a>
            : ret.outcome_ref && <strong>{ret.outcome_ref}</strong>}
          <span style={{ fontSize: 12.5, color: C.greyT }}>
            {ret.treated_by_name || 'rapproché automatiquement'} · {formatDateUTC(ret.treated_at)}
          </span>
          {canWrite && !ret.replacement_order_id && !ret.loyalty_credited_at && !ret.refund_wp_id && (
            <button type="button" onClick={() => setEditing(true)} style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}>Modifier</button>
          )}
        </div>
      ) : !canWrite ? (
        <span style={{ color: C.greyT }}>Prévue : {OUTCOMES[ret.outcome] || '—'}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(OUTCOMES).map(([k, v]) => (
              <button
                key={k} type="button" onClick={() => setOutcome(k)}
                style={{
                  ...btn('ghost'), padding: '6px 12px', fontSize: 13,
                  borderColor: outcome === k ? RETURNS_COLOR : C.greyB,
                  background: outcome === k ? RETURNS_COLOR_L : C.white,
                  color: outcome === k ? RETURNS_COLOR : C.dark,
                }}
              >{v}</button>
            ))}
          </div>

          {outcome === 'renvoi' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setReplacementOpen(true)} style={btn('primary')}>Créer la commande de renvoi</button>
              <span style={{ fontSize: 12.5, color: C.greyT }}>Commande WooCommerce à 0 €, stock BMS vérifié.</span>
            </div>
          )}

          {outcome === 'points' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number" min={1} value={points}
                onChange={e => setPoints(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                style={{ ...field, width: 110, textAlign: 'right' }}
              />
              <span style={{ fontSize: 13.5 }}>points = {euro(points / 100)}</span>
              {ret.shipping_paid > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={withShipping} onChange={e => toggleShipping(e.target.checked)} />
                  + frais de port ({euro(ret.shipping_paid)})
                </label>
              )}
              <button type="button" onClick={creditPoints} disabled={!points || saving} style={btn('primary', !points || saving)}>
                Créditer les points
              </button>
            </div>
          )}

          {outcome === 'remboursement' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, color: C.greyT }}>
                Rembourser dans WooCommerce : le remboursement est rattaché tout seul (toutes les 30 min), ou ici.
              </div>
              {ret.refunds.length === 0 && <span style={{ fontSize: 13.5 }}>Aucun remboursement sur la commande pour l’instant.</span>}
              {ret.refunds.map(f => (
                <div key={f.wp_refund_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
                  <strong>{euro(f.refund_amount)}</strong>
                  <span style={{ color: C.greyT }}>{formatDate(f.refund_date)}{f.refund_reason ? ` · ${f.refund_reason}` : ''}</span>
                  {f.linked_return_id
                    ? <span style={{ color: C.greyT }}>rattaché au retour n°{f.linked_return_id}</span>
                    : (
                      <button
                        type="button" disabled={saving}
                        onClick={() => post('refund', { wpRefundId: f.wp_refund_id }, 'Remboursement rattaché.')}
                        style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12.5 }}
                      >Rattacher</button>
                    )}
                </div>
              ))}
            </div>
          )}

          {outcome === 'aucune' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={label}>{OUTCOME_REF_HINT.aucune}</div>
                <input value={ref} onChange={e => setRef(e.target.value)} style={{ ...field, width: '100%' }} />
              </div>
              <button type="button" onClick={() => post('treat', { outcome, outcomeRef: ref }, 'Issue enregistrée.')} disabled={saving} style={btn('primary', saving)}>
                Marquer comme fait
              </button>
            </div>
          )}

          {ret.treated_at && <button type="button" onClick={() => setEditing(false)} style={{ ...btn('ghost'), alignSelf: 'flex-start' }}>Annuler</button>}
        </div>
      )}

      {replacementOpen && (
        <ReplacementModal ret={ret} onClose={() => setReplacementOpen(false)} onDone={onDone} setMessage={setMessage} />
      )}
    </div>
  );
}

function DetailView({ id, navigate, canWrite }) {
  const [ret, setRet] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);

  const load = useCallback(() => {
    axios.get(`${RETURNS_API}/${id}`).then(({ data }) => setRet(data)).catch(e => setError(errorText(e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const cancel = async () => {
    if (!window.confirm(`Annuler le retour n°${id} ?`)) return;
    try {
      const { data } = await axios.post(`${RETURNS_API}/${id}/cancel`);
      setRet(data);
      setMessage({ kind: 'ok', text: 'Retour annulé.' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
  };

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!ret) return <p style={{ color: C.greyT }}>Chargement…</p>;

  const cancelled = !!ret.cancelled_at;
  const Meta = ({ k, children }) => (
    <div>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 14, color: C.dark }}>{children}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <button type="button" onClick={() => navigate('/retours')} style={{ ...btn('ghost'), padding: '6px 12px', fontSize: 13 }}>← Retours</button>
      </div>
      {message && <Banner kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Banner>}

      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.dark }}>Retour n°{ret.id}</h2>
          <StatusChip status={ret.status} />
          <Chip color={RETURNS_COLOR} bg={RETURNS_COLOR_L}>{REASONS[ret.reason]}</Chip>
          {!ret.return_required && <Chip color={C.greyT} bg={C.grey}>sans retour du produit</Chip>}
          <span style={{ flex: 1 }} />
          {canWrite && !cancelled && !ret.received_at && (
            <button type="button" onClick={cancel} style={{ ...btn('ghost'), color: C.red, borderColor: C.red, padding: '6px 12px', fontSize: 13 }}>Annuler le retour</button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 18 }}>
          <Meta k="Client">{customerName(ret)}{ret.billing_email && <div style={{ fontSize: 12, color: C.greyT }}>{ret.billing_email}</div>}</Meta>
          <Meta k="Commande">
            <a href={`/orders/${ret.wp_order_id}`} target="_blank" rel="noopener noreferrer" style={link}>#{ret.wp_order_id}</a>
            <div style={{ fontSize: 12, color: C.greyT }}>{formatDate(ret.paid_date || ret.post_date, { time: false })} · {euro(ret.order_total)}</div>
          </Meta>
          <Meta k="Ticket">
            {ret.ticket_id
              ? <a href={`/tickets/${ret.ticket_id}`} target="_blank" rel="noopener noreferrer" style={link}>#{ret.ticket_id}</a>
              : '—'}
            {ret.ticket_subject && <div style={{ fontSize: 12, color: C.greyT }}>{ret.ticket_subject}</div>}
          </Meta>
          <Meta k="Créé">{ret.created_by_name || '—'}<div style={{ fontSize: 12, color: C.greyT }}>{formatDateUTC(ret.created_at)}</div></Meta>
          {ret.received_at && <Meta k={ret.return_required ? 'Reçu' : 'Validé'}>{ret.received_by_name}<div style={{ fontSize: 12, color: C.greyT }}>{formatDateUTC(ret.received_at)}</div></Meta>}
          {cancelled && <Meta k="Annulé">{ret.cancelled_by_name}<div style={{ fontSize: 12, color: C.greyT }}>{formatDateUTC(ret.cancelled_at)}</div></Meta>}
        </div>
        {ret.note && <div style={{ marginTop: 14, padding: '8px 12px', background: C.grey, borderRadius: 8, fontSize: 13.5 }}>{ret.note}</div>}
        {canWrite && ret.return_required && !cancelled && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.greyB}` }}>
            <ReturnLabelActions ret={ret} ticketId={null} onChange={setRet} />
            {ret.has_label && (
              <div style={{ fontSize: 12, color: C.greyT, marginTop: 6 }}>
                Créée par {ret.label_created_by_name || '—'} · {formatDateUTC(ret.label_created_at)}.
                Pour l’envoyer au client, ouvrir le ticket : « Joindre à la réponse » sous la commande.
              </div>
            )}
          </div>
        )}
      </div>

      {canWrite && !cancelled && !ret.received_at
        ? <ValidationForm ret={ret} onDone={setRet} setMessage={setMessage} />
        : <ReceivedLines ret={ret} canWrite={canWrite} onDone={setRet} setMessage={setMessage} />}

      {!cancelled && <OutcomePanel key={ret.treated_at || 'open'} ret={ret} canWrite={canWrite} onDone={setRet} setMessage={setMessage} />}
    </div>
  );
}

// ── Fournisseurs ────────────────────────────────────────────────────────────

const downloadBatch = async (batchId, supplierName) => {
  const res = await axios.get(`${RETURNS_API}/batches/${batchId}/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retour_${String(supplierName).replace(/[^\w-]+/g, '_')}_n${batchId}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};

function SuppliersView({ navigate }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get(`${RETURNS_API}/suppliers`).then(({ data }) => setRows(data.suppliers)).catch(e => setError(errorText(e)));
  }, []);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!rows) return <p style={{ color: C.greyT }}>Chargement…</p>;
  return (
    <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Fournisseur</th><th style={{ ...th, textAlign: 'right' }}>Lignes à retourner</th>
            <th style={{ ...th, textAlign: 'right' }}>Pièces</th><th style={{ ...th, textAlign: 'right' }}>Valeur HT</th>
            <th style={{ ...th, textAlign: 'right' }}>Envoyées, en attente d'avoir</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} style={{ ...td, color: C.greyT, textAlign: 'center', padding: 30 }}>Aucun produit en SAV fournisseur.</td></tr>}
          {rows.map(s => (
            <tr key={s.id} onClick={() => navigate(`/retours/fournisseurs/${s.id}`)} style={{ cursor: 'pointer' }}>
              <td style={{ ...td, fontWeight: 700 }}>{s.name}</td>
              <td style={{ ...td, textAlign: 'right' }}>{s.lines}</td>
              <td style={{ ...td, textAlign: 'right' }}>{s.pieces}</td>
              <td style={{ ...td, textAlign: 'right' }}>{euro(s.value)}</td>
              <td style={{ ...td, textAlign: 'right', color: C.greyT }}>{s.sent_lines}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierView({ supplierId, navigate, canWrite }) {
  const [data, setData] = useState(null);
  const [checked, setChecked] = useState(new Set());
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    axios.get(`${RETURNS_API}/suppliers/${supplierId}`)
      .then(({ data: d }) => { setData(d); setChecked(new Set(d.items.map(i => i.id))); })
      .catch(e => setError(errorText(e)));
  }, [supplierId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setChecked(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const value = useMemo(
    () => (data?.items || []).filter(i => checked.has(i.id)).reduce((n, i) => n + i.qty * Number(i.unit_cost || 0), 0),
    [data, checked]
  );

  const send = async () => {
    if (!window.confirm(`Créer le renvoi de ${checked.size} ligne(s) à ${data.supplier.name} ? Elles passeront en « Envoyé ».`)) return;
    setSaving(true);
    try {
      const { data: b } = await axios.post(`${RETURNS_API}/suppliers/${supplierId}/batches`, { itemIds: [...checked] });
      await downloadBatch(b.batchId, data.supplier.name);
      setMessage({ kind: 'ok', text: `Renvoi n°${b.batchId} créé, export téléchargé.` });
      load();
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
    setSaving(false);
  };

  const linkCredit = async (batchId, documentId) => {
    try {
      const { data: d } = await axios.post(`${RETURNS_API}/batches/${batchId}/credits`, { documentId });
      setData(d);
      setMessage({ kind: 'ok', text: `Avoir lié : le renvoi n°${batchId} est soldé.` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
  };
  const unlinkCredit = async (batchId, documentId) => {
    if (!window.confirm('Délier cet avoir du renvoi ?')) return;
    try {
      const { data: d } = await axios.delete(`${RETURNS_API}/batches/${batchId}/credits/${documentId}`);
      setData(d);
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    }
  };

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!data) return <p style={{ color: C.greyT }}>Chargement…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => navigate('/retours/fournisseurs')} style={{ ...btn('ghost'), padding: '6px 12px', fontSize: 13 }}>← Fournisseurs</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.dark }}>{data.supplier.name}</h2>
      </div>
      {message && <Banner kind={message.kind} onClose={() => setMessage(null)}>{message.text}</Banner>}

      <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>
                <input
                  type="checkbox" checked={data.items.length > 0 && checked.size === data.items.length}
                  onChange={e => setChecked(e.target.checked ? new Set(data.items.map(i => i.id)) : new Set())}
                />
              </th>
              <th style={th}>Réf. fournisseur</th><th style={th}>Produit</th><th style={{ ...th, textAlign: 'right' }}>Qté</th>
              <th style={th}>Motif</th><th style={th}>Problème</th><th style={th}>Commande</th><th style={th}>Date</th>
              <th style={{ ...th, textAlign: 'right' }}>Coût HT</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && <tr><td colSpan={9} style={{ ...td, color: C.greyT, textAlign: 'center', padding: 30 }}>Rien à retourner.</td></tr>}
            {data.items.map(i => (
              <tr key={i.id}>
                <td style={td}><input type="checkbox" checked={checked.has(i.id)} onChange={() => toggle(i.id)} /></td>
                <td style={td}>{i.supplier_sku || <span style={{ color: C.greyT }}>—</span>}</td>
                <td style={td}>{i.name}<div style={{ fontSize: 12, color: C.greyT }}>{i.sku}</div></td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{i.qty}</td>
                <td style={td}>{REASONS[i.reason]}</td>
                <td style={{ ...td, maxWidth: 280 }}>{i.problem}</td>
                <td style={td}>
                  <a href={`/retours/${i.return_id}`} style={link}>Retour n°{i.return_id}</a>
                  <div style={{ fontSize: 12, color: C.greyT }}>#{i.wp_order_id}</div>
                </td>
                <td style={td}>{formatDateUTC(i.created_at, { time: false })}</td>
                <td style={{ ...td, textAlign: 'right' }}>{euro(i.unit_cost == null ? null : i.qty * Number(i.unit_cost))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canWrite && data.items.length > 0 && (
          <div style={{ padding: 14, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 13.5, color: C.greyT }}>{checked.size} ligne(s) · {euro(value)} HT</span>
            <button type="button" onClick={send} disabled={!checked.size || saving} style={btn('primary', !checked.size || saving)}>
              {saving ? '…' : 'Créer le renvoi et exporter'}
            </button>
          </div>
        )}
      </div>

      {data.batches.length > 0 && (
        <div style={{ ...panel, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 4px', fontSize: 15, fontWeight: 800, color: C.dark }}>Renvois</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>N°</th><th style={th}>Date</th><th style={th}>Par</th>
                <th style={{ ...th, textAlign: 'right' }}>Lignes</th><th style={{ ...th, textAlign: 'right' }}>Pièces</th>
                <th style={{ ...th, textAlign: 'right' }}>Valeur HT</th><th style={th}>Statut</th><th style={th}>Avoir</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {data.batches.map(b => (
                <tr key={b.id}>
                  <td style={{ ...td, fontWeight: 700 }}>{b.id}</td>
                  <td style={td}>{formatDateUTC(b.created_at, { time: false })}</td>
                  <td style={td}>{b.created_by_name || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{b.lines}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{b.pieces}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{euro(b.value)}</td>
                  <td style={td}>{b.status === 'solde' ? <Chip color={C.green} bg={C.greenL}>Soldé</Chip> : <Chip color={C.blue} bg={C.blueL}>Envoyé</Chip>}</td>
                  <td style={td}>
                    {b.credits.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                        Avoir <strong>{c.number}</strong> · {euro(Math.abs(c.total_ht))} HT
                        {canWrite && (
                          <button type="button" title="Délier" onClick={() => unlinkCredit(b.id, c.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.greyT }}>✕</button>
                        )}
                      </div>
                    ))}
                    {b.credits.length > 0 && (
                      <div style={{ fontSize: 12, color: b.credited < Number(b.value) ? C.red : C.green, fontWeight: 700 }}>
                        {b.credited < Number(b.value) ? `Perte : ${euro(Number(b.value) - b.credited)}` : 'Couvert'}
                      </div>
                    )}
                    {canWrite && data.availableCredits.length > 0 && (
                      <select value="" onChange={e => e.target.value && linkCredit(b.id, Number(e.target.value))} style={{ ...field, fontSize: 12.5, padding: '4px 6px', marginTop: 4 }}>
                        <option value="">{b.credits.length ? '+ autre avoir…' : 'Lier un avoir…'}</option>
                        {data.availableCredits.map(c => (
                          <option key={c.id} value={c.id}>{c.number} — {formatDate(c.doc_date, { time: false })} — {euro(Math.abs(c.total_ht))} HT</option>
                        ))}
                      </select>
                    )}
                    {canWrite && !data.availableCredits.length && !b.credits.length && (
                      <span style={{ fontSize: 12, color: C.greyT }}>Aucun avoir saisi (app Factures)</span>
                    )}
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      onClick={() => downloadBatch(b.id, data.supplier.name).catch(e => setMessage({ kind: 'error', text: errorText(e) }))}
                      style={{ ...btn('ghost'), padding: '5px 10px', fontSize: 12.5 }}
                    >Export</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

export default function ReturnsApp() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { canWrite } = useTicketsAccess();
  const [, section, sub] = pathname.split('/').filter(Boolean);
  const suppliersTab = section === 'fournisseurs';

  const tab = (active, text, to) => (
    <button
      type="button" onClick={() => navigate(to)}
      style={{
        padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 14, fontWeight: 700, color: active ? RETURNS_COLOR : C.greyT,
        borderBottom: `2px solid ${active ? RETURNS_COLOR : 'transparent'}`,
      }}
    >{text}</button>
  );

  return (
    <AppShell currentPath="/retours">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey, fontFamily: 'Lato, sans-serif' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: RETURNS_COLOR,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <ReturnsIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Retours
            </h1>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 13, color: C.greyT }}>Un retour se crée depuis un ticket ou une commande.</span>
          </div>
          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.greyB}`, marginBottom: 18 }}>
            {tab(!suppliersTab, 'Retours clients', '/retours')}
            {tab(suppliersTab, 'SAV fournisseurs', '/retours/fournisseurs')}
          </div>

          {!section && <ListView navigate={navigate} />}
          {section && !suppliersTab && <DetailView key={section} id={Number(section)} navigate={navigate} canWrite={canWrite} />}
          {suppliersTab && !sub && <SuppliersView navigate={navigate} />}
          {suppliersTab && sub && <SupplierView key={sub} supplierId={Number(sub)} navigate={navigate} canWrite={canWrite} />}
        </div>
      </main>
    </AppShell>
  );
}
