import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import '../../pages/PurchasesApp.css'; // charte Gestion d'achat V2
import { trierParAvancement } from '../../utils/scanOrder';

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
// Fond d'une ligne en cours de comptage : mêmes couleurs que la réception du site
const COMPTAGE = {
  juste:   '#83EBA2',  // compte exact
  partiel: '#EBD483',  // il en manque
  surplus: '#EB8E83',  // compté plus que prévu
};
const MOTIF_LABEL = { reliquat: 'reliquat', solde: 'soldé', manquant: 'manquant', erreur_saisie: 'erreur de saisie' };
const STATUS = { open: { label: 'À recevoir', color: '#d97706' }, received: { label: 'Reçue', color: '#16a34a' }, cancelled: { label: 'Annulée', color: '#6b7280' } };

// Photo du produit du site (même présentation que l'import) ; case vide sans photo
function Thumb({ src, alt }) {
  const box = { width: 44, height: 44, borderRadius: 6, border: '1px solid #E2E2E2', background: '#F2F6F8' };
  return src
    ? <img src={src} alt={alt} style={{ ...box, objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
    : <div style={box} />;
}

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
function OrdersList({ shop, auth, onOpen, onEdit, onCreate }) {
  const [orders, setOrders] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    axios.get(`${API_URL}/nextore/${shop.slug}/reception/orders`, auth)
      .then((res) => setOrders(res.data.orders || []))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [shop.slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const remove = async (o) => {
    if (!window.confirm(`Supprimer la commande « ${o.reference} » (${o.supplier_name || 'fournisseur ?'}) ? Elle disparaît définitivement.`)) return;
    setError('');
    try {
      await axios.delete(`${API_URL}/nextore/${shop.slug}/reception/orders/${o.id}`, auth);
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const shown = orders.filter((o) => showClosed || o.status === 'open');
  return (
    <div className="purchases-card">
      <div className="filters-bar" style={{ marginBottom: 12 }}>
        <strong>{orders.filter((o) => o.status === 'open').length} commande(s) en cours</strong>
        <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Afficher les commandes closes
        </label>
        <button className="btn btn-primary" onClick={onCreate}>+ Nouvelle commande</button>
      </div>
      {error && <div style={{ color: '#dc2626' }}>{error}</div>}
      {loading ? <div style={{ padding: 30, textAlign: 'center', color: '#6b7280' }}>Chargement…</div> : shown.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#8a99a4' }}>Aucune commande en cours. Elles se créent ici (+ Nouvelle commande), depuis Besoins ou Import commande.</div>
      ) : (
        <table className="purchases-table">
          <thead>
            <tr>
              <th>Commande</th><th>Fournisseur</th><th>Créée le</th><th>Statut</th>
              <th className="text-right">Lignes</th><th className="text-right">Pièces commandées</th>
              <th className="text-right">Reçues</th><th className="text-right">Restantes</th><th />
            </tr>
          </thead>
          <tbody>
            {shown.map((o, i) => (
              <tr key={o.id} onClick={() => onOpen(o.id)} style={{ cursor: 'pointer', background: i % 2 ? '#f8fafc' : '#fff' }}>
                <td><strong>{o.reference}</strong><div style={{ fontSize: 11, color: '#6b7280' }}>{o.source}{o.created_by_name ? ` · ${o.created_by_name}` : ''}</div></td>
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
                <td className="text-right" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {o.status === 'open' ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => onOpen(o.id)}>Réceptionner</button>{' '}
                      <button className="btn btn-secondary btn-sm" onClick={() => onEdit(o.id)} disabled={o.reception_open}
                        title={o.reception_open ? 'Réception en cours : terminez-la ou abandonnez-la d\'abord' : ''}>Modifier</button>{' '}
                      <button className="btn btn-danger btn-sm" onClick={() => remove(o)} disabled={o.pieces_received > 0 || o.reception_open}
                        title={o.pieces_received > 0 ? 'Déjà réceptionnée : soldez les lignes restantes à la réception' : o.reception_open ? 'Réception en cours' : ''}>Supprimer</button>
                    </>
                  ) : (
                    <button className="btn btn-secondary btn-sm" onClick={() => onOpen(o.id)}>Voir</button>
                  )}
                </td>
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
  // Ligne scannée : la liste défile jusqu'à elle (après le tri) et la surligne 2 s
  const [scanned, setScanned] = useState(null); // { id, n } — n relance l'effet sur un même article
  useEffect(() => {
    if (!scanned) return undefined;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`rx-${scanned.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = setTimeout(() => setScanned((cur) => (cur?.n === scanned.n ? null : cur)), 2000);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [scanned]);
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
    setScanned((prev) => ({ id: item.id, n: (prev?.n || 0) + 1 }));
    setFlash(msg || `${item.name} — +${n}`);
  };

  const saveBarcode = (barcode, productId, kind, packQty, orderItemId) =>
    axios.post(`${base}/barcodes`, { barcode, product_id: productId, kind, pack_qty: packQty, order_item_id: orderItemId }, auth);

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
    // 2. Code du site (cartons compris), rapproché par réf fournisseur ou code
    //    commun et déjà traduit en pièces boutique. Il passe avant Nextore, qui
    //    range parfois un code de carton parmi ceux du produit (il vaudrait 1).
    const site = items.flatMap((it) => (it.site_barcodes || []).filter((b) => b.barcode === code).map((b) => ({ it, b })));
    if (new Set(site.map((s) => s.it.id)).size === 1) {
      const { it, b } = site[0];
      // Carton dont le site connaît le contenu, ou code confirmé par une personne au site
      if (b.type === 'pack' || b.confirmed) {
        addPieces(it, b.pieces, `${it.name} — +${b.pieces}${b.type === 'pack' ? ' (carton, code du site)' : ''}`);
        return;
      }
      // Code jamais confirmé (importé de BMS) : même prudence qu'un code Nextore
      if (b.pieces > 1 || it.pack_qty > 1 || (it.barcodes || []).length > 1) {
        setTypeModal({ item: it, barcode: code, packQty: b.pieces > 1 ? b.pieces : it.pack_qty });
        return;
      }
      addPieces(it, 1);
      return;
    }
    // 3. Code Nextore
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
      const res = await saveBarcode(barcode, item.product_id, kind, packQty, item.id);
      const n = kind === 'carton' ? packQty : 1;
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id !== item.id ? x : { ...x, reception_barcodes: [...(x.reception_barcodes || []), { barcode, kind, pack_qty: n }] })) }));
      addPieces(item, n, `${item.name} — +${n}${kind === 'carton' ? ' (carton)' : ''}${siteNote(res.data.site)}`);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    scanInput.current?.focus();
  };

  // Code inconnu rattaché à une ligne : unité ou carton, la même question
  const attachUnknown = (item) => {
    const { barcode } = unknownModal;
    setUnknownModal(null);
    setTypeModal({ item, barcode, packQty: item.pack_qty });
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

  // Pendant le comptage, comme au site : ce qui reste à compter en haut, le surplus
  // juste après (anomalie à corriger, pas à cacher), le compte juste en bas.
  const rang = (x) => (x.counted < x.remaining ? 0 : x.counted > x.remaining ? 1 : 2);
  const shown = counting ? trierParAvancement(lines, rang) : lines;
  // Le fond porte l'état du comptage ; le zébrage ne reste qu'aux lignes vierges
  const rowBackground = (x, i) => {
    if (!counting || x.counted === 0) return i % 2 ? '#f8fafc' : '#fff';
    if (x.counted > x.remaining) return COMPTAGE.surplus;
    if (x.counted === x.remaining) return COMPTAGE.juste;
    return COMPTAGE.partiel;
  };

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
              <button className="btn btn-primary" onClick={startSession} disabled={busy}>Commencer la réception</button>
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
              <th style={{ width: 60 }}>Image</th><th>Produit</th><th>Réf.</th><th className="text-right">Commandé</th><th className="text-right">Déjà reçu</th>
              <th className="text-right">Attendu</th>
              {counting && <><th className="text-right">Compté</th><th className="text-right">Écart</th></>}
            </tr>
          </thead>
          <tbody>
            {shown.map((x, i) => {
              const gap = x.counted - x.remaining;
              return (
                <tr key={x.id} id={`rx-${x.id}`} style={{ background: rowBackground(x, i), boxShadow: scanned?.id === x.id ? 'inset 0 0 0 4px #2563eb' : 'none', transition: 'box-shadow 0.3s ease' }}>
                  <td><Thumb src={x.image_url} alt={x.name} /></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{x.name}</div>
                    <small style={{ color: '#666' }}>
                      {x.code || ''}{x.pack_qty > 1 ? ` · pack de ${x.pack_qty}` : ''}{x.added_at_reception ? ' · ajouté à la réception' : ''}
                      {siteCartons(x)}
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
                      <td className="text-right" style={{ color: gap < 0 ? '#b45309' : gap > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
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

/* ─── ÉCRAN 3 — MODIFIER UNE COMMANDE ─────────────────────── */
function EditOrderScreen({ shop, auth, orderId, onBack }) {
  const [data, setData] = useState(null);
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const url = `${API_URL}/nextore/${shop.slug}/reception/orders/${orderId}`;

  useEffect(() => {
    axios.get(url, auth).then((res) => {
      const d = res.data;
      // Une ligne reçue, ou présente dans l'historique, ne se retire pas
      const inHistory = new Set(d.history.flatMap((h) => h.counts.map((c) => c.order_item_id)));
      setData(d);
      setReference(d.order.reference);
      setLines(d.items.map((x) => ({
        id: x.id, product_id: x.product_id, name: x.name, code: x.code, supplier_sku: x.supplier_sku,
        qty_ordered: x.qty_ordered, qty_received: x.qty_received, unit_cost: x.unit_cost,
        removable: x.qty_received === 0 && !inHistory.has(x.id),
      })));
    }).catch((e) => setError(e.response?.data?.error || e.message));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (i, key, value) => setLines((ls) => ls.map((l, j) => (j !== i ? l : { ...l, [key]: value })));
  const addProduct = (p) => {
    setAdding(false);
    if (lines.some((l) => l.product_id === p.product_id)) { setError(`${p.name} est déjà sur la commande`); return; }
    setLines((ls) => [...ls, { product_id: p.product_id, name: p.name, code: p.sku, qty_ordered: 1, qty_received: 0, unit_cost: null, removable: true }]);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      await axios.put(url, {
        reference,
        lines: lines.map((l) => ({ id: l.id, product_id: l.product_id, qty_ordered: parseInt(l.qty_ordered, 10) || 0, unit_cost: l.unit_cost })),
      }, auth);
      onBack();
    } catch (e) { setError(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  if (!data) return <div className="purchases-card">{error ? <span style={{ color: '#dc2626' }}>{error}</span> : 'Chargement…'}</div>;
  if (data.session) {
    return (
      <div className="purchases-card">
        <p>Une réception est en cours sur cette commande : terminez-la ou abandonnez-la avant de la modifier.</p>
        <button className="btn btn-secondary" onClick={onBack}>‹ Commandes</button>
      </div>
    );
  }
  const total = lines.reduce((a, l) => a + (parseInt(l.qty_ordered, 10) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  return (
    <div className="purchases-card">
      <div className="filters-bar" style={{ alignItems: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>‹ Commandes</button>
        <div className="filter-group">
          <label>Référence</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, width: 260 }} />
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', alignSelf: 'center' }}>{data.order.supplier_name}</div>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>+ Ajouter un produit</button>
      </div>
      {error && <div style={{ margin: '10px 0', color: '#dc2626', fontWeight: 600 }}>{error}</div>}
      <table className="purchases-table" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Produit</th><th>Réf.</th><th className="text-right">Déjà reçu</th>
            <th className="text-right">Pièces commandées</th><th className="text-right">Prix pièce HT</th><th className="text-right">Total HT</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id || `new-${l.product_id}`} style={{ background: l.id ? (i % 2 ? '#f8fafc' : '#fff') : '#f0fdf4' }}>
              <td><div style={{ fontWeight: 500 }}>{l.name}</div><small style={{ color: '#666' }}>{l.code || ''}{!l.id ? ' · ajouté' : ''}</small></td>
              <td><code style={{ fontSize: 12 }}>{l.supplier_sku || '-'}</code></td>
              <td className="text-right">{fmtInt(l.qty_received)}</td>
              <td className="text-right">
                <input type="number" className="qty-input" min={l.qty_received} value={l.qty_ordered} onChange={(e) => setLine(i, 'qty_ordered', e.target.value)} />
              </td>
              <td className="text-right">
                <input type="number" className="qty-input" min="0" step="0.0001" style={{ width: 90 }} value={l.unit_cost ?? ''}
                  placeholder={l.id ? '' : 'auto'} title={l.id ? '' : 'Vide : dernier coût payé chez ce fournisseur'}
                  onChange={(e) => setLine(i, 'unit_cost', e.target.value === '' ? null : parseFloat(e.target.value))} />
              </td>
              <td className="text-right">{l.unit_cost != null ? `${((parseInt(l.qty_ordered, 10) || 0) * l.unit_cost).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(NBSP, ' ')} €` : '-'}</td>
              <td className="text-right">
                <button className="btn btn-secondary btn-sm" disabled={!l.removable} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  title={l.removable ? 'Retirer la ligne' : 'Déjà réceptionnée : soldez-la à la réception'}>Retirer</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <strong>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(NBSP, ' ')} € HT</strong>
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !lines.length || !reference.trim()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      {adding && <AddArticleModal shop={shop} auth={auth} onClose={() => setAdding(false)} onPick={addProduct} />}
    </div>
  );
}

/* ─── ÉCRAN 4 — NOUVELLE COMMANDE (saisie manuelle) ──────── */
const fmtEur = (v) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(NBSP, ' ')} €`;

function CreateOrderScreen({ shop, auth, onBack }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  // { product_id, name, code, qty_ordered, unit_cost, edited } — edited : prix saisi, gardé au changement de fournisseur
  const [lines, setLines] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `${API_URL}/nextore/${shop.slug}`;

  useEffect(() => {
    axios.get(`${base}/suppliers`, auth)
      .then((res) => setSuppliers(res.data.suppliers || []))
      .catch((e) => setError(e.response?.data?.error || e.message));
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prix proposé (dernier coût payé chez ce fournisseur…) pour les lignes non retouchées
  const fillCosts = async (supId, ls) => {
    const ids = ls.filter((l) => !l.edited).map((l) => l.product_id);
    if (!supId || !ids.length) return;
    try {
      const res = await axios.get(`${base}/reception/costs?supplier_id=${encodeURIComponent(supId)}&ids=${encodeURIComponent(ids.join(','))}`, auth);
      const costs = res.data.costs || {};
      setLines((cur) => cur.map((l) => (l.edited || costs[l.product_id] === undefined ? l : { ...l, unit_cost: costs[l.product_id] })));
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const changeSupplier = (id) => { setSupplierId(id); fillCosts(id, lines); };
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j !== i ? l : { ...l, ...patch })));
  const addProduct = (p) => {
    setAdding(false);
    if (lines.some((l) => l.product_id === p.product_id)) { setError(`${p.name} est déjà sur la commande`); return; }
    setError('');
    const line = { product_id: p.product_id, name: p.name, code: p.sku, qty_ordered: 1, unit_cost: null, edited: false };
    setLines((ls) => [...ls, line]);
    fillCosts(supplierId, [line]);
  };

  const create = async () => {
    setBusy(true); setError('');
    try {
      await axios.post(`${base}/reception/orders`, {
        supplier_id: supplierId,
        reference,
        lines: lines.map((l) => ({ product_id: l.product_id, qty_ordered: parseInt(l.qty_ordered, 10) || 0, unit_cost: l.unit_cost })),
      }, auth);
      onBack();
    } catch (e) { setError(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const total = lines.reduce((a, l) => a + (parseInt(l.qty_ordered, 10) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  return (
    <div className="purchases-card">
      <div className="filters-bar" style={{ alignItems: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>‹ Commandes</button>
        <div className="filter-group">
          <label>Fournisseur</label>
          <select value={supplierId} onChange={(e) => changeSupplier(e.target.value)} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, minWidth: 220 }}>
            <option value="">Choisir…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Référence</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Vide : générée (APP-…)"
            style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, width: 260 }} />
        </div>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>+ Ajouter un produit</button>
      </div>
      {error && <div style={{ margin: '10px 0', color: '#dc2626', fontWeight: 600 }}>{error}</div>}
      {lines.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: '#8a99a4' }}>Aucun produit. Ajoutez-en avec « + Ajouter un produit ».</div>
      ) : (
        <table className="purchases-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Produit</th><th className="text-right">Pièces commandées</th><th className="text-right">Prix pièce HT</th><th className="text-right">Total HT</th><th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.product_id} style={{ background: i % 2 ? '#f8fafc' : '#fff' }}>
                <td><div style={{ fontWeight: 500 }}>{l.name}</div><small style={{ color: '#666' }}>{l.code || ''}</small></td>
                <td className="text-right">
                  <input type="number" className="qty-input" min="1" value={l.qty_ordered} onChange={(e) => setLine(i, { qty_ordered: e.target.value })} />
                </td>
                <td className="text-right">
                  <input type="number" className="qty-input" min="0" step="0.0001" style={{ width: 90 }} value={l.unit_cost ?? ''}
                    placeholder="auto" title="Proposé : dernier coût payé chez ce fournisseur, sinon prix de la fiche"
                    onChange={(e) => setLine(i, e.target.value === '' ? { unit_cost: null, edited: false } : { unit_cost: parseFloat(e.target.value), edited: true })} />
                </td>
                <td className="text-right">{l.unit_cost != null ? fmtEur((parseInt(l.qty_ordered, 10) || 0) * l.unit_cost) : '-'}</td>
                <td className="text-right">
                  <button className="btn btn-secondary btn-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Retirer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <strong>{fmtEur(total)} HT</strong>
        <button className="btn btn-secondary" onClick={onBack} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={create}
          disabled={busy || !supplierId || !lines.length || lines.some((l) => !((parseInt(l.qty_ordered, 10) || 0) > 0))}
          title={!supplierId ? 'Choisissez un fournisseur' : ''}>{busy ? 'Création…' : 'Créer la commande'}</button>
      </div>
      {adding && <AddArticleModal shop={shop} auth={auth} onClose={() => setAdding(false)} onPick={addProduct} />}
    </div>
  );
}

/** Suite du message de scan : ce que le carton confirmé est devenu au site. */
function siteNote(site) {
  if (!site) return '';
  if (site.written) return ` · remonté au site (« ${site.site_title} », carton de ${site.quantity})`;
  if (site.already) return ' · déjà connu au site';
  return ` · non remonté au site : ${site.reason}`;
}

/** « · carton de 10 (site) » : cartons du site que le scan reconnaîtra sur cette ligne. */
function siteCartons(item) {
  const n = [...new Set((item.site_barcodes || []).filter((b) => b.type === 'pack').map((b) => b.pieces))].sort((a, b) => a - b);
  return n.length ? ` · carton de ${n.join(' / ')} (site)` : '';
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
        const res = await axios.get(`${API_URL}/nextore/${shop.slug}/products/search?q=${encodeURIComponent(v)}&limit=20&all=1`, auth);
        setResults(res.data.products || []);
      } catch { setResults([]); }
    }, 300);
  };
  return (
    <Modal title="Ajouter un produit" onClose={onClose}>
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
export default function CommandesTab({ shop, token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [view, setView] = useState({ mode: 'list' }); // list | order | edit | create
  const back = () => setView({ mode: 'list' });
  if (view.mode === 'order') return <OrderScreen key={view.id} shop={shop} auth={auth} orderId={view.id} onBack={back} />;
  if (view.mode === 'edit') return <EditOrderScreen key={view.id} shop={shop} auth={auth} orderId={view.id} onBack={back} />;
  if (view.mode === 'create') return <CreateOrderScreen shop={shop} auth={auth} onBack={back} />;
  return <OrdersList shop={shop} auth={auth} onOpen={(id) => setView({ mode: 'order', id })} onEdit={(id) => setView({ mode: 'edit', id })}
    onCreate={() => setView({ mode: 'create' })} />;
}
