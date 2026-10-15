import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { C } from '../picking/pickingUi';
import {
  RETURNS_API, RETURNS_COLOR, RETURNS_COLOR_L, SHOPS, LotSelect, btn, field, errorText,
} from './returnsUi';

/**
 * Pop-up « Ajouter un SAV boutique » (Pierre, 15/10/2026).
 *
 * L'échange est fait en caisse ; la pièce défectueuse part chez le fournisseur
 * avec celles du site. On l'impute à une commande fournisseur du site qui a
 * apporté ce produit — pas forcément celle d'où vient la pièce — sans dépasser
 * les pièces qu'elle a apportées (le serveur refait le contrôle sous verrou).
 * Le stock Nextore n'est pas touché.
 *
 * @param {number} [supplierId]  fournisseur pré-choisi (fiche fournisseur)
 */
export default function BoutiqueSavModal({ supplierId: initialSupplier = null, onClose, onCreated }) {
  const [shop, setShop] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [product, setProduct] = useState(null);
  const [lots, setLots] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [qty, setQty] = useState(1);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (product || q.trim().length < 2) { setResults(null); return undefined; }
    const timer = setTimeout(() => {
      axios.get(`${RETURNS_API}/products/search`, { params: { q } })
        .then(({ data }) => setResults(data.products))
        .catch(e => setError(errorText(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, product]);

  const suppliers = useMemo(() => {
    const out = [];
    for (const l of lots || []) {
      if (!out.some(s => s.id === l.supplier_id)) out.push({ id: l.supplier_id, name: l.supplier_name });
    }
    return out;
  }, [lots]);

  /** La commande la plus récente qui couvre encore `n` pièces. */
  const firstLot = (all, sid, n) => all.find(l => l.supplier_id === Number(sid) && l.remaining >= n)?.purchase_order_id || '';

  const pickProduct = async (p) => {
    setProduct(p);
    setLots(null);
    setError('');
    try {
      const { data } = await axios.get(`${RETURNS_API}/purchase-lots`, { params: { productId: p.id } });
      setLots(data.lots);
      const ids = [...new Set(data.lots.map(l => l.supplier_id))];
      const sid = ids.includes(Number(initialSupplier)) ? Number(initialSupplier) : ids.length === 1 ? ids[0] : '';
      setSupplierId(sid);
      setPurchaseOrderId(sid ? firstLot(data.lots, sid, qty) : '');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const resetProduct = () => {
    setProduct(null);
    setLots(null);
    setSupplierId('');
    setPurchaseOrderId('');
  };

  const chooseSupplier = (sid) => {
    setSupplierId(sid);
    setPurchaseOrderId(sid ? firstLot(lots, sid, qty) : '');
  };

  const changeQty = (v) => {
    const n = Math.max(1, Number.parseInt(v, 10) || 1);
    setQty(n);
    // La commande choisie ne couvre plus : on passe à la suivante qui le peut.
    const current = (lots || []).find(l => l.purchase_order_id === Number(purchaseOrderId));
    if (current && current.remaining < n) setPurchaseOrderId(firstLot(lots, supplierId, n));
  };

  const lot = (lots || []).find(l => l.purchase_order_id === Number(purchaseOrderId));
  const canSubmit = shop && product && supplierId && lot && qty <= lot.remaining && problem.trim() && !saving;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await axios.post(`${RETURNS_API}/supplier-items`, {
        shop, productId: product.id, supplierId, purchaseOrderId, qty, problem, note,
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
          <div style={{ fontSize: 17, fontWeight: 800, color: C.dark, flex: 1 }}>Ajouter un SAV boutique</div>
          <button type="button" onClick={onClose} style={{ ...btn('ghost'), padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={label}>Boutique</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {SHOPS.map(s => (
                <button key={s.id} type="button" onClick={() => setShop(s.id)} style={choice(shop === s.id)}>{s.name}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={label}>Produit</div>
            {product ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                {product.image_url && <img src={product.image_url} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: C.dark }}>{product.name}</div>
                  <div style={{ fontSize: 12, color: C.greyT }}>{product.sku || 'sans SKU'}</div>
                </div>
                <button type="button" onClick={resetProduct} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12.5 }}>Changer</button>
              </div>
            ) : (
              <>
                <input
                  autoFocus value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Nom, SKU ou code-barres"
                  style={{ ...field, width: '100%' }}
                />
                {results && (
                  <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 8, marginTop: 6, maxHeight: 280, overflowY: 'auto' }}>
                    {results.length === 0 && <div style={{ padding: 12, color: C.greyT, fontSize: 13 }}>Aucun produit.</div>}
                    {results.map(p => (
                      <button
                        key={p.id} type="button" onClick={() => pickProduct(p)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', textAlign: 'left',
                          border: 'none', borderBottom: `1px solid ${C.greyB}`, background: C.white, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        {p.image_url
                          ? <img src={p.image_url} alt="" style={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 5 }} />
                          : <span style={{ width: 30 }} />}
                        <span style={{ flex: 1 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>{p.name}</span>
                          <span style={{ display: 'block', fontSize: 12, color: C.greyT }}>
                            {p.sku || 'sans SKU'}{!p.bought && ' · jamais reçu sur une commande fournisseur'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {product && lots && lots.length === 0 && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: C.amberL, color: C.amber, fontSize: 13, fontWeight: 600 }}>
              Ce produit n’a jamais été reçu sur une commande fournisseur : il ne peut pas être imputé à l’une d’elles.
            </div>
          )}

          {product && lots && lots.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={label}>Fournisseur</div>
                  <select value={supplierId} onChange={e => chooseSupplier(Number(e.target.value) || '')} style={{ ...field, minWidth: 200 }}>
                    <option value="">Fournisseur…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Quantité</div>
                  <input
                    type="number" min={1} value={qty} onChange={e => changeQty(e.target.value)}
                    style={{ ...field, width: 80, textAlign: 'right' }}
                  />
                </div>
              </div>
              {supplierId && (
                <div>
                  <div style={label}>Commande fournisseur</div>
                  <LotSelect lots={lots} supplierId={supplierId} qty={qty} value={purchaseOrderId} onChange={setPurchaseOrderId} style={{ width: '100%' }} />
                  {!lots.some(l => l.supplier_id === Number(supplierId) && l.remaining >= qty) && (
                    <div style={{ color: C.red, fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>
                      Aucune commande de ce fournisseur ne couvre {qty} pièce(s) : saisir moins de pièces, ou en plusieurs fois.
                    </div>
                  )}
                </div>
              )}
              <div>
                <div style={label}>Problème constaté</div>
                <input
                  value={problem} onChange={e => setProblem(e.target.value)}
                  placeholder="Repris dans l'export fournisseur"
                  style={{ ...field, width: '100%' }}
                />
              </div>
              <div>
                <div style={label}>Référence (facultatif)</div>
                <input
                  value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Client, ticket de caisse…"
                  style={{ ...field, width: '100%' }}
                />
              </div>
            </>
          )}

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
