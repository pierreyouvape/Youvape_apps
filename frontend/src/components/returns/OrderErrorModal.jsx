import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { C } from '../picking/pickingUi';
import { formatDate } from '../../utils/dateUtils';
import {
  RETURNS_API, RETURNS_COLOR, RETURNS_COLOR_L, SHOPS, ORDER_ERROR_KINDS, btn, field, errorText,
} from './returnsUi';

/**
 * Pop-up « Ajouter une erreur de commande » (Pierre, 23/11/2026).
 *
 * Des produits NEUFS qu'on rend au fournisseur : commandés par erreur, ou reçus
 * sans avoir été commandés. Du site : on choisit la commande fournisseur dans
 * la liste ; d'une boutique : sa référence se saisit, facultative. Aucun stock
 * n'est touché (ni BMS, ni Nextore).
 *
 * Plafond (site) : commandé par erreur = pas plus que la commande n'en a
 * apporté, moins ce qui est déjà en SAV dessus ; reçu sans être commandé = le
 * même plafond si la réception l'a ajouté à la commande, aucun sinon. Le
 * serveur refait le contrôle sous verrou.
 *
 * @param {number} [supplierId]  fournisseur pré-choisi (fiche fournisseur)
 */
export default function OrderErrorModal({ supplierId: initialSupplier = null, onClose, onCreated }) {
  const [origin, setOrigin] = useState(null); // 'site' | warehouse Nextore
  const [kind, setKind] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [supplierId, setSupplierId] = useState(initialSupplier ? Number(initialSupplier) : '');
  const [orders, setOrders] = useState(null);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [poLines, setPoLines] = useState(null);
  const [orderRef, setOrderRef] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const site = origin === 'site';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    axios.get(`${RETURNS_API}/order-errors/options`)
      .then(({ data }) => setSuppliers(data.suppliers))
      .catch(e => setError(errorText(e)));
  }, []);

  // Commandes du fournisseur, pour le site seulement.
  useEffect(() => {
    setOrders(null);
    if (!site || !supplierId) return;
    axios.get(`${RETURNS_API}/order-errors/options`, { params: { supplierId } })
      .then(({ data }) => setOrders(data.orders))
      .catch(e => setError(errorText(e)));
  }, [site, supplierId]);

  useEffect(() => {
    setPoLines(null);
    if (!site || !purchaseOrderId) return;
    axios.get(`${RETURNS_API}/order-errors/orders/${purchaseOrderId}`)
      .then(({ data }) => setPoLines(data.lines))
      .catch(e => setError(errorText(e)));
  }, [site, purchaseOrderId]);

  useEffect(() => {
    if (product || q.trim().length < 2) { setResults(null); return undefined; }
    const timer = setTimeout(() => {
      axios.get(`${RETURNS_API}/products/search`, { params: { q } })
        .then(({ data }) => setResults(data.products))
        .catch(e => setError(errorText(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, product]);

  const chooseOrigin = (o) => {
    setOrigin(o);
    setPurchaseOrderId('');
    setProduct(null);
  };
  const chooseSupplier = (sid) => {
    setSupplierId(sid);
    setPurchaseOrderId('');
    setProduct(null);
  };
  const chooseOrder = (id) => {
    setPurchaseOrderId(id);
    setProduct(null);
  };
  const pickProduct = (p) => { setProduct(p); setQ(''); setResults(null); setError(''); };

  /** La ligne de la commande choisie pour ce produit, s'il y figure. */
  const line = useMemo(
    () => (site && product ? (poLines || []).find(l => l.id === product.id) || null : null),
    [site, product, poLines]
  );
  const onOrder = line && line.received > 0;

  // Ce que le serveur refusera, dit avant d'envoyer.
  let blocker = '';
  if (site && product && poLines) {
    if (onOrder && qty > line.remaining) {
      blocker = `Cette commande en a apporté ${line.received}, ${line.received - line.remaining} déjà en SAV : ${line.remaining} renvoyable(s) au plus.`;
    } else if (!onOrder && kind === 'commande_erreur') {
      blocker = "Ce produit n'a pas été reçu sur cette commande : s'il est arrivé sans être commandé, choisir « Reçu sans être commandé ».";
    }
  }

  const ready = origin && kind && supplierId && product && qty >= 1 && (!site || (purchaseOrderId && poLines));
  const canSubmit = ready && !blocker && !saving;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`${RETURNS_API}/order-errors`, {
        origin, kind, supplierId, purchaseOrderId: site ? purchaseOrderId : null,
        orderRef: site ? '' : orderRef, productId: product.id, qty, note,
      });
      onCreated?.(data);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const label = { fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 };
  const choice = (active) => ({
    ...btn('ghost'),
    borderColor: active ? RETURNS_COLOR : C.greyB,
    background: active ? RETURNS_COLOR_L : C.white,
    color: active ? RETURNS_COLOR : C.dark,
  });
  const rowBtn = {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', textAlign: 'left',
    border: 'none', borderBottom: `1px solid ${C.greyB}`, background: C.white, cursor: 'pointer', fontFamily: 'inherit',
  };
  const thumb = (url) => (url
    ? <img src={url} alt="" style={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 5 }} />
    : <span style={{ width: 30 }} />);

  const searchBox = (placeholder) => (
    <>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} style={{ ...field, width: '100%' }} />
      {results && (
        <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 8, marginTop: 6, maxHeight: 240, overflowY: 'auto' }}>
          {results.length === 0 && <div style={{ padding: 12, color: C.greyT, fontSize: 13 }}>Aucun produit.</div>}
          {results.map(p => (
            <button key={p.id} type="button" onClick={() => pickProduct(p)} style={rowBtn}>
              {thumb(p.image_url)}
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>{p.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: C.greyT }}>{p.sku || 'sans SKU'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto',
        fontFamily: 'Lato, sans-serif',
      }}
    >
      <div style={{ background: C.white, borderRadius: 14, width: 'min(720px, 100%)', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.greyB}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.dark, flex: 1 }}>Ajouter une erreur de commande</div>
          <button type="button" onClick={onClose} style={{ ...btn('ghost'), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ padding: '8px 12px', borderRadius: 8, background: C.greenL, color: C.green, fontSize: 13, fontWeight: 700 }}>
            Produit NEUF, renvoyé au fournisseur tel quel. Aucun stock n’est modifié.
          </div>

          <div>
            <div style={label}>Provenance</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => chooseOrigin('site')} style={choice(site)}>Site</button>
              {SHOPS.map(s => (
                <button key={s.id} type="button" onClick={() => chooseOrigin(s.id)} style={choice(origin === s.id)}>Boutique {s.name}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={label}>Erreur</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(ORDER_ERROR_KINDS).map(([k, text]) => (
                <button key={k} type="button" onClick={() => setKind(k)} style={choice(kind === k)}>{text}</button>
              ))}
            </div>
          </div>

          {origin && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={label}>Fournisseur</div>
                <select value={supplierId} onChange={e => chooseSupplier(Number(e.target.value) || '')} style={{ ...field, minWidth: 220 }}>
                  <option value="">{suppliers ? 'Fournisseur…' : 'Chargement…'}</option>
                  {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {site ? (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={label}>Commande fournisseur</div>
                  <select
                    value={purchaseOrderId} disabled={!supplierId}
                    onChange={e => chooseOrder(Number(e.target.value) || '')}
                    style={{ ...field, width: '100%' }}
                  >
                    <option value="">
                      {!supplierId ? 'Choisir le fournisseur d’abord' : !orders ? 'Chargement…' : orders.length ? 'Commande…' : 'Aucune commande chez ce fournisseur'}
                    </option>
                    {(orders || []).map(o => (
                      <option key={o.id} value={o.id}>
                        {o.order_number} — {o.received_date ? `reçue ${formatDate(o.received_date, { time: false })}` : `passée ${formatDate(o.order_date, { time: false })}`} — {o.lines} ligne(s)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={label}>N° de commande (facultatif)</div>
                  <input
                    value={orderRef} onChange={e => setOrderRef(e.target.value)}
                    placeholder="Référence de la commande de la boutique"
                    style={{ ...field, width: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

          {origin && supplierId && (!site || purchaseOrderId) && (
            <div>
              <div style={label}>Produit</div>
              {product ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                  {product.image_url && <img src={product.image_url} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: C.dark }}>{product.name}</div>
                    <div style={{ fontSize: 12, color: C.greyT }}>
                      {product.sku || 'sans SKU'}
                      {site && poLines && (onOrder
                        ? ` · ${line.received} reçue(s) sur la commande, ${line.remaining} renvoyable(s)`
                        : ' · absent de cette commande')}
                    </div>
                  </div>
                  <button type="button" onClick={() => setProduct(null)} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12.5 }}>Changer</button>
                </div>
              ) : site ? (
                <>
                  <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 8, maxHeight: 260, overflowY: 'auto' }}>
                    {!poLines && <div style={{ padding: 12, color: C.greyT, fontSize: 13 }}>Chargement…</div>}
                    {poLines && poLines.length === 0 && <div style={{ padding: 12, color: C.greyT, fontSize: 13 }}>Aucune ligne sur cette commande.</div>}
                    {(poLines || []).map(l => (
                      <button
                        key={l.id} type="button" onClick={() => pickProduct(l)}
                        disabled={l.remaining < 1}
                        style={{ ...rowBtn, cursor: l.remaining < 1 ? 'not-allowed' : 'pointer', opacity: l.remaining < 1 ? 0.5 : 1 }}
                      >
                        {thumb(l.image_url)}
                        <span style={{ flex: 1 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>{l.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: C.greyT }}>{l.sku || 'sans SKU'}</span>
                        </span>
                        <span style={{ fontSize: 12, color: C.greyT, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {l.ordered} commandée(s) · {l.received} reçue(s)
                          <span style={{ display: 'block', fontWeight: 700, color: l.remaining ? C.dark : C.greyT }}>{l.remaining} renvoyable(s)</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {kind === 'non_commande' && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12.5, color: C.greyT, marginBottom: 6 }}>Produit absent de la commande :</div>
                      {searchBox('Nom, SKU ou code-barres')}
                    </div>
                  )}
                </>
              ) : searchBox('Nom, SKU ou code-barres')}
            </div>
          )}

          {product && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <div style={label}>Quantité</div>
                <input
                  type="number" min={1} value={qty}
                  onChange={e => setQty(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                  style={{ ...field, width: 80, textAlign: 'right' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={label}>Remarque (facultatif)</div>
                <input
                  value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Reprise dans l'export fournisseur"
                  style={{ ...field, width: '100%' }}
                />
              </div>
            </div>
          )}

          {blocker && <div style={{ color: C.red, fontSize: 13, fontWeight: 600 }}>{blocker}</div>}
          {error && <div style={{ color: C.red, fontWeight: 600, fontSize: 13.5 }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.greyB}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={btn('ghost')}>Annuler</button>
          <button type="button" onClick={submit} disabled={!canSubmit} style={btn('primary', !canSubmit)}>
            {saving ? 'Enregistrement…' : 'Ajouter au SAV fournisseur'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
