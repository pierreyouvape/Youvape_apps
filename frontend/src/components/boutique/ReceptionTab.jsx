import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import '../../pages/PurchasesApp.css'; // charte Gestion d'achat V2

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const NBSP = /[  ]/g;
const fmtInt = (v) => (parseInt(v, 10) || 0).toLocaleString('fr-FR').replace(NBSP, ' ');
// '2026-10-12T09:15:00.000Z' → '12/10/2026 11:15' (heure de Paris)
const fmtDate = (v) => (v ? new Date(v).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '-');

const MOTIFS = [
  { value: 'reliquat', label: 'Reliquat (arrivera plus tard)' },
  { value: 'solde', label: 'Soldé (remboursé par le fournisseur)' },
  { value: 'manquant', label: 'Manquant (erreur du fournisseur)' },
  { value: 'erreur_saisie', label: 'Erreur de saisie (commandé par erreur)' },
];
const MOTIF_LABEL = { reliquat: 'reliquat', solde: 'soldé', manquant: 'manquant', erreur_saisie: 'erreur de saisie' };
const STATUS = { open: { label: 'À recevoir', color: '#d97706' }, received: { label: 'Reçue', color: '#16a34a' }, cancelled: { label: 'Annulée', color: '#6b7280' } };

function Modal({ title, children, footer, onClose, width = 560 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ─── ÉCRAN 1 — LISTE ─────────────────────────────────────── */
function OrdersList({ shop, auth, onOpen }) {
  const [orders, setOrders] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/nextore/${shop.slug}/reception/orders`, auth)
      .then((res) => setOrders(res.data.orders || []))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [shop.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = orders.filter((o) => showClosed || o.status === 'open');
  return (
    <div className="purchases-card">
      <div className="filters-bar" style={{ marginBottom: 12 }}>
        <strong>{orders.filter((o) => o.status === 'open').length} commande(s) à recevoir</strong>
        <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Afficher les commandes closes
        </label>
      </div>
      {error && <div style={{ color: '#dc2626' }}>{error}</div>}
      {loading ? <div style={{ padding: 30, textAlign: 'center', color: '#6b7280' }}>Chargement…</div> : shown.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#8a99a4' }}>Aucune commande à recevoir. Elles se créent depuis Besoins ou Import commande.</div>
      ) : (
        <table className="purchases-table">
          <thead>
            <tr>
              <th>Commande</th><th>Fournisseur</th><th>Créée le</th><th>Statut</th>
              <th className="text-right">Lignes</th><th className="text-right">Pièces commandées</th>
              <th className="text-right">Reçues</th><th className="text-right">Restantes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o, i) => (
              <tr key={o.id} onClick={() => onOpen(o.id)} style={{ cursor: 'pointer', background: i % 2 ? '#f8fafc' : '#fff' }}>
                <td><strong>{o.reference}</strong><div style={{ fontSize: 11, color: '#6b7280' }}>{o.source === 'import' ? 'import' : 'besoins'}{o.created_by_name ? ` · ${o.created_by_name}` : ''}</div></td>
                <td>{o.supplier_name || '-'}</td>
                <td>{fmtDate(o.created_at)}</td>
                <td>
                  <span style={{ color: STATUS[o.status]?.color, fontWeight: 600 }}>{STATUS[o.status]?.label}</span>
                  {o.reception_open && <div style={{ fontSize: 11, color: '#2563eb' }}>réception en cours</div>}
                </td>
                <td className="text-right">{o.lines}</td>
                <td className="text-right">{fmtInt(o.pieces_ordered)}</td>
                <td className="text-right">{fmtInt(o.pieces_received)}</td>
                <td className="text-right">{fmtInt(o.pieces_remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── ÉCRAN 2 — COMMANDE (détail + comptage) ──────────────── */
function OrderScreen({ shop, auth, orderId, onBack }) {
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState('');
  const [flash, setFlash] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [typeModal, setTypeModal] = useState(null);    // { item, barcode }
  const [unknownModal, setUnknownModal] = useState(null); // { barcode }
  const [addModal, setAddModal] = useState(null);      // { barcode? }
  const [validateModal, setValidateModal] = useState(false);
  const [motifs, setMotifs] = useState({});
  const [recap, setRecap] = useState(null);
  const scanInput = useRef(null);
  // Comptage courant, lu par les scans successifs sans attendre un nouveau rendu
  // (deux scans rapprochés lisaient sinon la même valeur : une pièce perdue)
  const countsRef = useRef({});
  // Une file d'écriture par ligne : les valeurs absolues arrivent dans l'ordre
  const writes = useRef({});
  const base = `${API_URL}/nextore/${shop.slug}/reception`;

  const apply = useCallback((d) => {
    setData(d);
    const c = {};
    for (const x of d.session?.counts || []) c[x.order_item_id] = x.units_counted;
    countsRef.current = c;
    setCounts(c);
  }, []);

  const load = useCallback(async () => {
    try { apply((await axios.get(`${base}/orders/${orderId}`, auth)).data); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }, [base, orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const session = data?.session;
  const counting = session && session.status === 'counting';
  useEffect(() => { if (counting) scanInput.current?.focus(); }, [counting]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const startSession = () => run(async () => apply((await axios.post(`${base}/orders/${orderId}/session`, {}, auth)).data));
  const cancelOrder = () => window.confirm('Annuler cette commande ? Elle ne sera plus attendue.') &&
    run(async () => { await axios.post(`${base}/orders/${orderId}/cancel`, {}, auth); onBack(); });
  const abandon = () => window.confirm('Abandonner cette réception ? Le comptage sera perdu, rien ne part dans Nextore.') &&
    run(async () => { await flushWrites(); await axios.post(`${base}/sessions/${session.id}/abandon`, {}, auth); await load(); });

  // Pose une valeur absolue ; l'écran suit tout de suite, la base derrière.
  // En cas d'échec, on recharge depuis la base : c'est elle que la validation lit.
  const setCount = (itemId, value) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    countsRef.current = { ...countsRef.current, [itemId]: n };
    setCounts(countsRef.current);
    const sessionId = session.id;
    writes.current[itemId] = (writes.current[itemId] || Promise.resolve()).then(async () => {
      try {
        await axios.put(`${base}/sessions/${sessionId}/counts/${itemId}`, { units_counted: countsRef.current[itemId] || 0 }, auth);
      } catch (e) {
        setError(`Comptage non enregistré, écran rechargé : ${e.response?.data?.error || e.message}`);
        await load();
      }
    });
  };
  const flushWrites = () => Promise.all(Object.values(writes.current));
  const addPieces = (item, n, msg) => {
    setCount(item.id, (countsRef.current[item.id] || 0) + n);
    setHighlight(item.id);
    setFlash(msg || `${item.name} — +${n}`);
    setTimeout(() => setHighlight((h) => (h === item.id ? null : h)), 2000);
    document.getElementById(`rx-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const saveBarcode = (barcode, productId, kind, packQty) =>
    axios.post(`${base}/barcodes`, { barcode, product_id: productId, kind, pack_qty: packQty }, auth);

  // Douchette (code + Entrée) ou saisie manuelle dans le champ de scan
  const handleScan = (raw) => {
    const code = String(raw).trim();
    if (!code || !data) return;
    const items = data.items;
    // 1. Code rattaché ou confirmé chez nous (unité / carton)
    for (const it of items) {
      const r = (it.reception_barcodes || []).find((b) => b.barcode === code);
      if (r) {
        const n = r.kind === 'carton' ? r.pack_qty : 1;
        addPieces(it, n, `${it.name} — +${n}${r.kind === 'carton' ? ' (carton)' : ''}`);
        return;
      }
    }
    // 2. Code Nextore
    const found = items.find((it) => (it.barcodes || []).includes(code));
    if (!found) { setUnknownModal({ barcode: code }); return; }
    // Code jamais confirmé, sur une ligne commandée par pack ou un produit à
    // plusieurs codes : ce peut être le code du carton. On demande, une fois.
    if (found.pack_qty > 1 || (found.barcodes || []).length > 1) {
      setTypeModal({ item: found, barcode: code, packQty: found.pack_qty });
      return;
    }
    addPieces(found, 1);
  };

  const answerType = async (kind, packQty) => {
    const { item, barcode } = typeModal;
    setTypeModal(null);
    try {
      await saveBarcode(barcode, item.product_id, kind, packQty);
      const n = kind === 'carton' ? packQty : 1;
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id !== item.id ? x : { ...x, reception_barcodes: [...(x.reception_barcodes || []), { barcode, kind, pack_qty: n }] })) }));
      addPieces(item, n, `${item.name} — +${n}${kind === 'carton' ? ' (carton)' : ''}`);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    scanInput.current?.focus();
  };

  const attachUnknown = async (item) => {
    const { barcode } = unknownModal;
    setUnknownModal(null);
    try {
      await saveBarcode(barcode, item.product_id, 'unit', 1);
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id !== item.id ? x : { ...x, reception_barcodes: [...(x.reception_barcodes || []), { barcode, kind: 'unit', pack_qty: 1 }] })) }));
      addPieces(item, 1);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    scanInput.current?.focus();
  };

  // Article absent de la commande : ajouté à 0 commandé, le code éventuel rattaché
  const addArticle = async (product) => {
    const barcode = addModal?.barcode;
    setAddModal(null);
    await run(async () => {
      const res = await axios.post(`${base}/sessions/${session.id}/lines`, { product_id: product.product_id }, auth);
      if (barcode) await saveBarcode(barcode, product.product_id, 'unit', 1);
      const fresh = (await axios.get(`${base}/orders/${orderId}`, auth)).data;
      apply(fresh);
      const item = fresh.items.find((x) => x.id === res.data.id);
      if (item && barcode) {
        await axios.put(`${base}/sessions/${fresh.session.id}/counts/${item.id}`, { units_counted: (countsRef.current[item.id] || 0) + 1 }, auth);
        apply((await axios.get(`${base}/orders/${orderId}`, auth)).data);
        setFlash(`${item.name} ajouté — +1`);
      }
    });
    scanInput.current?.focus();
  };

  const lines = (data?.items || []).map((x) => ({ ...x, counted: counts[x.id] || 0 }));
  const missing = lines.filter((x) => x.counted < x.remaining);
  const surplus = lines.filter((x) => x.counted > x.remaining);
  const totalCounted = lines.reduce((a, x) => a + x.counted, 0);

  const validate = () => run(async () => {
    await flushWrites();
    const res = await axios.post(`${base}/sessions/${session.id}/validate`, { motifs }, auth);
    setRecap({
      reference: res.data.nextore_reference, purchaseId: res.data.nextore_purchase_id, pieces: res.data.pieces,
      missing: missing.map((x) => ({ ...x, motif: motifs[x.id] })), surplus,
      closed: res.data.order.status !== 'open',
    });
    setValidateModal(false);
    setMotifs({});
    apply(res.data);
  });

  if (!data) return <div className="purchases-card">{error ? <span style={{ color: '#dc2626' }}>{error}</span> : 'Chargement…'}</div>;
  const { order } = data;

  if (recap) {
    return (
      <div className="purchases-card">
        <h3 style={{ marginTop: 0, color: '#16a34a' }}>Réception validée</h3>
        {recap.reference
          ? <p><strong>{fmtInt(recap.pieces)} pièce(s)</strong> mises en stock dans Nextore : achat reçu « {recap.reference} » (n° {recap.purchaseId}).</p>
          : <p>Aucune pièce comptée : les lignes restantes ont été soldées selon leur motif, rien n'est parti dans Nextore.</p>}
        {recap.surplus.length > 0 && (
          <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>
            <strong>Surplus mis en stock</strong> (reçu au-delà de la commande) :
            <ul style={{ margin: '6px 0 0' }}>{recap.surplus.map((x) => <li key={x.id}>{x.name} : +{fmtInt(x.counted - x.remaining)}</li>)}</ul>
          </div>
        )}
        {recap.missing.length > 0 && (
          <div style={{ background: '#fee2e2', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>
            <strong>Manquants</strong> :
            <ul style={{ margin: '6px 0 0' }}>{recap.missing.map((x) => <li key={x.id}>{x.name} : {fmtInt(x.remaining - x.counted)} ({MOTIF_LABEL[x.motif]})</li>)}</ul>
          </div>
        )}
        <p>{recap.closed ? 'La commande est close.' : 'La commande reste ouverte pour le reliquat.'}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={onBack}>Retour aux commandes</button>
          <button className="btn btn-secondary" onClick={() => setRecap(null)}>Voir la commande</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="purchases-card">
        <div className="filters-bar" style={{ alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={onBack}>‹ Commandes</button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{order.reference}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              {order.supplier_name} · créée le {fmtDate(order.created_at)} · <span style={{ color: STATUS[order.status]?.color, fontWeight: 600 }}>{STATUS[order.status]?.label}</span>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {order.status === 'open' && !session && (
              <>
                <button className="btn btn-primary" onClick={startSession} disabled={busy}>Commencer la réception</button>
                {data.history.length === 0 && <button className="btn btn-secondary" onClick={cancelOrder} disabled={busy}>Annuler la commande</button>}
              </>
            )}
            {counting && (
              <>
                <button className="btn btn-secondary" onClick={() => setAddModal({})} disabled={busy}>+ Article absent du bon</button>
                <button className="btn btn-secondary" onClick={abandon} disabled={busy}>Abandonner</button>
                <button className="btn btn-primary" onClick={() => setValidateModal(true)} disabled={busy}>Valider la réception</button>
              </>
            )}
            {session && session.status === 'sending' && (
              <button className="btn btn-primary" onClick={startSession} disabled={busy}>Envoi interrompu : vérifier avec Nextore</button>
            )}
          </div>
        </div>
        {error && <div style={{ marginTop: 10, color: '#dc2626', fontWeight: 600, whiteSpace: 'pre-line' }}>{error}</div>}
        {counting && (
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            <form onSubmit={(e) => { e.preventDefault(); handleScan(scan); setScan(''); }} style={{ display: 'flex', gap: 8 }}>
              <input ref={scanInput} value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scanner ou saisir un code-barres puis Entrée"
                style={{ padding: '10px 12px', border: '2px solid #2563eb', borderRadius: 8, fontSize: 15, width: 360 }} />
            </form>
            {flash && <span style={{ color: '#16a34a', fontWeight: 600 }}>{flash}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#555' }}>{fmtInt(totalCounted)} pièce(s) comptée(s)</span>
          </div>
        )}
      </div>

      <div className="purchases-card">
        <table className="purchases-table">
          <thead>
            <tr>
              <th>Produit</th><th>Réf.</th><th className="text-right">Commandé</th><th className="text-right">Déjà reçu</th>
              <th className="text-right">Attendu</th>
              {counting && <><th className="text-right">Compté</th><th className="text-right">Écart</th></>}
            </tr>
          </thead>
          <tbody>
            {lines.map((x, i) => {
              const gap = x.counted - x.remaining;
              return (
                <tr key={x.id} id={`rx-${x.id}`} style={{ background: highlight === x.id ? '#dbeafe' : i % 2 ? '#f8fafc' : '#fff', transition: 'background .3s' }}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{x.name}</div>
                    <small style={{ color: '#666' }}>
                      {x.code || ''}{x.pack_qty > 1 ? ` · pack de ${x.pack_qty}` : ''}{x.added_at_reception ? ' · ajouté à la réception' : ''}
                      {x.closed_reason ? ` · soldé (${MOTIF_LABEL[x.closed_reason]})` : ''}
                    </small>
                  </td>
                  <td><code style={{ fontSize: 12 }}>{x.supplier_sku || '-'}</code></td>
                  <td className="text-right">{fmtInt(x.qty_ordered)}</td>
                  <td className="text-right">{fmtInt(x.qty_received)}</td>
                  <td className="text-right">{fmtInt(x.remaining)}</td>
                  {counting && (
                    <>
                      <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setCount(x.id, x.counted - 1)} disabled={x.counted <= 0}>−</button>
                        <input type="number" min="0" className="qty-input" style={{ margin: '0 4px' }} value={x.counted}
                          onChange={(e) => setCount(x.id, e.target.value)} />
                        <button className="btn btn-secondary btn-sm" onClick={() => addPieces(x, 1)}>+</button>
                      </td>
                      <td className="text-right" style={{ color: gap < 0 ? '#dc2626' : gap > 0 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                        {gap === 0 ? '✓' : gap > 0 ? `+${fmtInt(gap)}` : `−${fmtInt(-gap)}`}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.history.length > 0 && (
        <div className="purchases-card">
          <h4 style={{ marginTop: 0 }}>Réceptions précédentes</h4>
          {data.history.map((h) => {
            const byId = new Map(data.items.map((x) => [x.id, x]));
            const pieces = h.counts.reduce((a, c) => a + c.units_counted, 0);
            const miss = h.counts.filter((c) => c.motif);
            return (
              <div key={h.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <strong>{fmtDate(h.validated_at)}</strong>{h.validated_by_name ? ` · ${h.validated_by_name}` : ''} — {fmtInt(pieces)} pièce(s)
                {h.nextore_reference ? `, achat Nextore « ${h.nextore_reference} » (n° ${h.nextore_purchase_id})` : ', aucun envoi'}
                {miss.length > 0 && (
                  <div style={{ color: '#991b1b' }}>
                    Manquants : {miss.map((c) => `${byId.get(c.order_item_id)?.name || c.order_item_id} ${fmtInt((c.units_expected || 0) - c.units_counted)} (${MOTIF_LABEL[c.motif]})`).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {typeModal && (
        <TypeModal data={typeModal} onClose={() => { setTypeModal(null); scanInput.current?.focus(); }} onChoose={answerType} />
      )}

      {unknownModal && (
        <Modal title={`Code inconnu : ${unknownModal.barcode}`} onClose={() => { setUnknownModal(null); scanInput.current?.focus(); }}
          footer={<>
            <button className="btn btn-secondary" onClick={() => { setUnknownModal(null); scanInput.current?.focus(); }}>Ignorer</button>
            <button className="btn btn-primary" onClick={() => { setAddModal({ barcode: unknownModal.barcode }); setUnknownModal(null); }}>Article absent du bon…</button>
          </>}>
          <p style={{ marginTop: 0, fontSize: 14 }}>Ce code n'est sur aucune ligne. À quel article de la commande correspond-il ? Il sera retenu (chez nous seulement).</p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {data.items.map((x) => (
              <div key={x.id} onClick={() => attachUnknown(x)} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                <div style={{ fontWeight: 500 }}>{x.name}</div><small style={{ color: '#666' }}>{x.code || ''}</small>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {addModal && <AddArticleModal shop={shop} auth={auth} onClose={() => { setAddModal(null); scanInput.current?.focus(); }} onPick={addArticle} />}

      {validateModal && (
        <Modal title="Valider la réception" width={680} onClose={() => !busy && setValidateModal(false)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setValidateModal(false)} disabled={busy}>Reprendre le comptage</button>
            <button className="btn btn-primary" onClick={validate} disabled={busy || missing.some((x) => !motifs[x.id])}>
              {busy ? 'Envoi…' : totalCounted > 0 ? `Mettre ${fmtInt(totalCounted)} pièce(s) en stock` : 'Solder sans réception'}
            </button>
          </>}>
          <p style={{ marginTop: 0 }}>
            {totalCounted > 0
              ? <>Un achat <strong>reçu</strong> de {fmtInt(totalCounted)} pièce(s) sera créé dans Nextore : le stock monte aussitôt. <strong>Il ne pourra pas être supprimé.</strong></>
              : 'Aucune pièce comptée : rien ne part dans Nextore, les lignes sont soldées selon leur motif.'}
          </p>
          {missing.length > 0 && (
            <>
              <h4 style={{ margin: '12px 0 6px', color: '#991b1b' }}>Manquants : un motif par ligne</h4>
              {missing.map((x) => (
                <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ flex: 1, fontSize: 13 }}>{x.name} <strong>−{fmtInt(x.remaining - x.counted)}</strong></div>
                  <select value={motifs[x.id] || ''} onChange={(e) => setMotifs((m) => ({ ...m, [x.id]: e.target.value }))}
                    style={{ padding: '5px 8px', border: `1px solid ${motifs[x.id] ? '#d1d5db' : '#dc2626'}`, borderRadius: 6 }}>
                    <option value="">Motif…</option>
                    {MOTIFS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              ))}
            </>
          )}
          {surplus.length > 0 && (
            <div style={{ background: '#fef3c7', padding: '8px 12px', borderRadius: 6, marginTop: 12, fontSize: 13 }}>
              <strong>Surplus</strong>, mis en stock lui aussi : {surplus.map((x) => `${x.name} +${fmtInt(x.counted - x.remaining)}`).join(' · ')}
            </div>
          )}
          {error && <div style={{ marginTop: 10, color: '#dc2626', fontWeight: 600 }}>{error}</div>}
        </Modal>
      )}
    </>
  );
}

/* ─── POP-UP : unité ou carton ? ──────────────────────────── */
function TypeModal({ data, onClose, onChoose }) {
  const [carton, setCarton] = useState(data.packQty > 1 ? String(data.packQty) : '');
  const n = parseInt(carton, 10);
  return (
    <Modal title="Unité ou carton ?" onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={() => onChoose('unit', 1)}>Une unité</button>
        <button className="btn btn-primary" disabled={!(n > 1)} onClick={() => onChoose('carton', n)}>Un carton de {n > 1 ? n : '…'}</button>
      </>}>
      <p style={{ marginTop: 0 }}>Le code <code>{data.barcode}</code> de <strong>{data.item.name}</strong> n'a jamais été confirmé. Est-ce le code d'une unité ou celui d'un carton ?</p>
      <label style={{ fontSize: 13 }}>Pièces dans un carton :{' '}
        <input type="number" min="2" className="qty-input" value={carton} onChange={(e) => setCarton(e.target.value)} />
      </label>
      <p style={{ fontSize: 12, color: '#6b7280' }}>La réponse est retenue pour ce code : la question ne reviendra pas.</p>
    </Modal>
  );
}

/* ─── POP-UP : article absent du bon ─────────────────────── */
function AddArticleModal({ shop, auth, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const timer = useRef(null);
  const search = (v) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/nextore/${shop.slug}/products/search?q=${encodeURIComponent(v)}&limit=20`, auth);
        setResults(res.data.products || []);
      } catch { setResults([]); }
    }, 300);
  };
  return (
    <Modal title="Ajouter un article absent du bon" onClose={onClose}>
      <input autoFocus value={q} onChange={(e) => search(e.target.value)} placeholder="Nom, code ou EAN…"
        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, marginBottom: 8 }} />
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {results.map((p) => (
          <div key={p.product_id} onClick={() => onPick(p)} style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
            <div style={{ fontWeight: 500 }}>{p.name}</div>
            <small style={{ color: '#666' }}>{p.sku || ''}{p.barcode ? ` · ${p.barcode}` : ''} · stock {fmtInt(p.stock)}</small>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ─── COMPOSANT ─────────────────────────────────────────── */
export default function ReceptionTab({ shop, token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [orderId, setOrderId] = useState(null);
  return orderId
    ? <OrderScreen key={orderId} shop={shop} auth={auth} orderId={orderId} onBack={() => setOrderId(null)} />
    : <OrdersList shop={shop} auth={auth} onOpen={setOrderId} />;
}
