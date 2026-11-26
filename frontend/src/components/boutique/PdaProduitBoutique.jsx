import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import CameraScanner from './CameraScanner';
import { useScanner, beep } from '../pda/pdaScan';

/**
 * PDA › Boutiques › <boutique> › Produit (26/11/2026, lot 3).
 * Scanner ou chercher un produit de la boutique, voir son stock (lu en direct
 * dans Nextore), ses ventes (30 j, 90 j, 365 j, total), ses arrivages (nos
 * commandes ouvertes + achats « en attente » Nextore), et passer un mouvement
 * de stock Nextore : motifs du PDA du site (Ajustement entrée/sortie, Défectueux
 * sortie) + « Pour site » et « DLUO » (sortie), lus dans la réponse du serveur ;
 * sortie refusée au-delà du stock.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
const C = {
  primary: '#135E84', green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2', orange: '#C2410C',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4', dark: '#111827', white: '#FFFFFF', violet: '#7C3AED',
};
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const NBSP = /[\u00a0\u202f]/g;
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(NBSP, ' '));
// '2026-11-25 19:04:05' ou '2026-10-20 16:26:45+00' → '25/11/2026'
const fmtDay = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};
const fmtWhen = (v) => (v ? new Date(v).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '—');
const looksLikeBarcode = (v) => /^\d{8,}$/.test(String(v).trim());

const card = { background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 12, marginBottom: 10 };
const title = { fontSize: 12, fontWeight: 800, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 };
const big = (bg, color = C.white) => ({
  background: bg, color, border: 'none', borderRadius: 12, padding: '14px 16px', fontSize: 17, fontWeight: 800,
  cursor: 'pointer', fontFamily: 'inherit',
});
const input = { width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, border: `2px solid ${C.primary}`, fontSize: 16 };

function Stat({ label, value, strong }) {
  return (
    <div style={{ flex: '1 1 70px', textAlign: 'center', padding: '6px 4px' }}>
      <div style={{ fontSize: 11, color: C.greyM, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: strong ? 22 : 18, fontWeight: 800, color: C.dark }}>{value}</div>
    </div>
  );
}

/* ─── Mouvement de stock ─────────────────────────────────── */
function MoveSheet({ product, stock, busy, error, onSave, onClose }) {
  const reasons = product.reasons || [];
  const [reason, setReason] = useState(null);
  const [direction, setDirection] = useState(null);
  const [qty, setQty] = useState('1');
  const [comment, setComment] = useState('');
  const def = reasons.find((r) => r.key === reason);
  const dir = def?.directions.length === 1 ? def.directions[0] : direction;
  const n = Number(qty);
  const tooMuch = dir === 'out' && stock != null && n > stock;
  const canSave = !!def && !!dir && Number.isInteger(n) && n >= 1 && !tooMuch;
  const signed = dir === 'in' ? `+${n}` : `−${n}`;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: C.white, width: '100%', maxHeight: '92vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 18, flex: 1 }}>Mouvement de stock</strong>
          <button onClick={onClose} disabled={busy} style={{ ...big(C.greyB, C.dark), padding: '8px 12px', fontSize: 15 }}>Fermer</button>
        </div>
        <div style={{ fontSize: 14, color: C.greyT, marginBottom: 10, overflowWrap: 'anywhere' }}>{product.name}</div>

        <div style={title}>Motif</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {reasons.map((r) => (
            <button key={r.key} type="button" onClick={() => { setReason(r.key); setDirection(null); }} style={{
              ...big(reason === r.key ? C.violet : C.white, reason === r.key ? C.white : C.dark),
              border: `2px solid ${reason === r.key ? C.violet : C.greyB}`, textAlign: 'left',
            }}>
              {r.label}
              <span style={{ fontWeight: 600, fontSize: 13, opacity: 0.8 }}>{r.directions.length === 1 ? ' — sortie' : ' — entrée ou sortie'}</span>
            </button>
          ))}
        </div>

        {def && def.directions.length > 1 && (
          <>
            <div style={{ ...title, marginTop: 14 }}>Sens</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['in', '+ Entrée', C.green], ['out', '− Sortie', C.red]].map(([v, l, col]) => (
                <button key={v} type="button" onClick={() => setDirection(v)} style={{
                  ...big(direction === v ? col : C.white, direction === v ? C.white : C.dark),
                  border: `2px solid ${direction === v ? col : C.greyB}`, flex: 1,
                }}>{l}</button>
              ))}
            </div>
          </>
        )}

        <div style={{ ...title, marginTop: 14 }}>Quantité</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setQty(String(Math.max(1, (n || 1) - 1)))} style={{ ...big(C.greyB, C.dark), fontSize: 24, padding: '6px 18px' }}>−</button>
          <input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            style={{ ...input, textAlign: 'center', fontSize: 24, fontWeight: 900, flex: 1, border: `1px solid ${C.greyB}` }} />
          <button type="button" onClick={() => setQty(String((n || 0) + 1))} style={{ ...big(C.greyB, C.dark), fontSize: 24, padding: '6px 18px' }}>+</button>
        </div>

        <div style={{ ...title, marginTop: 14 }}>Commentaire (facultatif)</div>
        <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={60}
          style={{ ...input, border: `1px solid ${C.greyB}` }} />

        {dir && stock != null && Number.isInteger(n) && n >= 1 && (
          <div style={{ marginTop: 12, fontSize: 15, color: tooMuch ? C.red : C.dark }}>
            Stock boutique : <strong>{fmt(stock)}</strong> → <strong>{fmt(dir === 'in' ? stock + n : stock - n)}</strong>
            {tooMuch && ' — pas assez de stock'}
          </div>
        )}
        {error && <div style={{ marginTop: 10, background: C.redL, color: C.red, padding: 10, borderRadius: 8, fontWeight: 600 }}>{error}</div>}

        <button disabled={busy || !canSave} onClick={() => onSave({ reason, direction: dir, qty: n, comment: comment.trim() })}
          style={{ ...big(canSave ? (dir === 'in' ? C.green : C.red) : C.greyB, canSave ? C.white : C.greyT), width: '100%', marginTop: 14 }}>
          {busy ? 'Envoi à Nextore…' : canSave ? `Envoyer à Nextore : ${signed} (${def.label})` : 'Envoyer à Nextore'}
        </button>
      </div>
    </div>
  );
}

/* ─── Fiche produit ──────────────────────────────────────── */
function ProductView({ shop, product, onMove, onBack }) {
  const here = (product.shops || []).find((s) => s.warehouse_id === shop.id) || {};
  const other = (product.shops || []).filter((s) => s.warehouse_id !== shop.id);
  const stock = product.live_stock ?? here.stock;
  const disabled = !!here.disabled_at || product.deleted;
  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.primary, fontSize: 15, padding: 0, marginBottom: 10, cursor: 'pointer' }}>‹ Autre produit</button>

      <div style={card}>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{product.name}</div>
        <div style={{ fontSize: 13, color: C.greyT, marginTop: 2 }}>
          {[product.code && `#${product.code}`, product.brand, product.category_name].filter(Boolean).join(' · ')}
        </div>
        {disabled && (
          <div style={{ marginTop: 6, color: C.orange, fontWeight: 700, fontSize: 13 }}>
            {product.deleted ? 'Supprimé dans Nextore' : 'Désactivé dans cette boutique'}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={title}>Stock</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: stock < 0 ? C.red : C.dark }}>{fmt(stock)}</span>
          <span style={{ fontSize: 14, color: C.greyT }}>en boutique {shop.label}</span>
        </div>
        <div style={{ fontSize: 12, color: C.greyM }}>
          {product.live_stock != null ? 'Lu en direct dans Nextore' : 'Nextore illisible : copie de la dernière synchro'}
          {here.rack ? ` · rayon ${here.rack}` : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 8, borderTop: `1px solid ${C.greyB}`, paddingTop: 6 }}>
          {other.map((s) => <Stat key={s.warehouse_id} label={s.name} value={fmt(s.stock)} />)}
          <Stat label="Site" value={fmt(product.wc_stock)} />
        </div>
      </div>

      <div style={card}>
        <div style={title}>Ventes en boutique {shop.label}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <Stat label="30 j" value={fmt(here.qty_30)} />
          <Stat label="90 j" value={fmt(here.qty_90)} />
          <Stat label="1 an" value={fmt(here.qty_365)} />
          <Stat label="Total" value={fmt(product.sales_total?.qty)} strong />
        </div>
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 4 }}>
          Total depuis le {fmtDay(product.sales_total?.since)} (début de l'historique des ventes)
          {product.sales_total?.last_sale_at ? ` · dernière vente le ${fmtDay(product.sales_total.last_sale_at)}` : ' · jamais vendu'}
        </div>
      </div>

      <div style={card}>
        <div style={title}>Arrivages{product.incoming_total > 0 ? ` · ${fmt(product.incoming_total)} pièce(s) attendue(s)` : ''}</div>
        {(product.incoming || []).length === 0 ? (
          <div style={{ fontSize: 14, color: C.greyM }}>Aucun arrivage attendu.</div>
        ) : product.incoming.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: i ? `1px solid ${C.greyB}` : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>{r.reference || (r.source === 'nextore' ? 'Achat Nextore' : 'Commande')}</div>
              <div style={{ fontSize: 12, color: C.greyT }}>
                {r.supplier_name || '—'} · {r.source === 'nextore' ? 'achat en attente Nextore' : 'commande'} du {fmtDay(r.ordered_at)}
                {r.qty_received > 0 ? ` · ${fmt(r.qty_received)} déjà reçue(s)` : ''}
                {r.reception_open && <span style={{ color: '#2563eb', fontWeight: 700 }}> · réception en cours</span>}
              </div>
            </div>
            <strong style={{ fontSize: 18, alignSelf: 'center' }}>{fmt(r.remaining)}</strong>
          </div>
        ))}
        {product.last_purchase && (
          <div style={{ fontSize: 12, color: C.greyM, marginTop: 6 }}>
            Dernier achat reçu : {fmt(product.last_purchase.qty)} le {fmtDay(product.last_purchase.purchased_at)}
            {product.last_purchase.supplier_name ? ` chez ${product.last_purchase.supplier_name}` : ''}
            {product.last_purchase.shop && product.last_purchase.shop !== shop.label ? ` (${product.last_purchase.shop})` : ''}
          </div>
        )}
      </div>

      <button onClick={onMove} disabled={product.deleted} style={{ ...big(C.violet), width: '100%', marginBottom: 10, fontSize: 19 }}>
        Mouvement de stock
      </button>

      {(product.moves || []).length > 0 && (
        <div style={card}>
          <div style={title}>Derniers mouvements PDA</div>
          {product.moves.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderTop: `1px solid ${C.greyB}`, fontSize: 13 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <strong>{(product.reasons || []).find((r) => r.key === m.reason)?.label || m.reason}</strong>
                  {m.comment ? ` — ${m.comment}` : ''}
                </div>
                <div style={{ color: C.greyT }}>
                  {fmtWhen(m.created_at)} · {m.created_by_name || '—'}
                  {m.status === 'error' && <span style={{ color: C.red, fontWeight: 700 }}> · refusé par Nextore</span>}
                  {m.status === 'uncertain' && <span style={{ color: C.red, fontWeight: 700 }}> · VÉRIFIEZ dans Nextore</span>}
                  {m.status === 'sending' && <span style={{ color: C.orange, fontWeight: 700 }}> · envoi en cours</span>}
                </div>
              </div>
              <strong style={{ alignSelf: 'center', color: m.delta > 0 ? C.green : C.red, fontSize: 16 }}>
                {m.delta > 0 ? `+${m.delta}` : `−${-m.delta}`}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Écran ──────────────────────────────────────────────── */
export default function PdaProduitBoutique({ shop, token }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState(null); // { msg, ok }
  const [cameraOpen, setCameraOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState(null);
  const inputRef = useRef(null);
  const base = `${API_URL}/nextore/${shop.slug}`;

  const say = (msg, ok = true) => { setFlash({ msg, ok }); beep(ok); };

  const openProduct = useCallback(async (productId) => {
    setLoading(true); setFlash(null); setResults([]);
    try {
      const r = await axios.get(`${base}/pda/products/${encodeURIComponent(productId)}`, auth(token));
      setProduct(r.data.product);
    } catch (e) {
      say(e.response?.data?.error || e.message, false);
    } finally { setLoading(false); }
  }, [base, token]);

  // Scan (douchette, caméra, ou code saisi + Entrée) : un seul article porte ce code → on l'ouvre
  const lookup = async (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    setCameraOpen(false);
    setSearching(true); setFlash(null);
    try {
      const r = await axios.get(`${base}/products/search?q=${encodeURIComponent(code)}&limit=20&all=1`, auth(token));
      const list = r.data.products || [];
      const hits = list.filter((p) => p.barcode_match);
      if (hits.length === 1) { setQ(''); beep(true); await openProduct(hits[0].product_id); return; }
      setProduct(null);
      if (hits.length > 1) { setResults(hits); say(`Ce code correspond à ${hits.length} articles : choisissez`, false); return; }
      if (looksLikeBarcode(code)) { setResults([]); say(`Code-barres inconnu en boutique : ${code}`, false); return; }
      setResults(list);
      if (!list.length) say('Aucun produit trouvé', false);
    } catch (e) {
      say(e.response?.data?.error || e.message, false);
    } finally { setSearching(false); }
  };

  // Recherche au fil de la frappe (nom, code, marque) ; un code-barres attend l'Entrée
  useEffect(() => {
    const v = q.trim();
    if (v.length < 3 || looksLikeBarcode(v)) return undefined;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await axios.get(`${base}/products/search?q=${encodeURIComponent(v)}&limit=30&all=1`, auth(token));
        setResults(r.data.products || []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, base, token]);

  // Douchette lue partout sur l'écran (hors fenêtre de mouvement)
  useScanner((code) => lookup(code), !moveOpen && !cameraOpen);

  const saveMove = async (body) => {
    setMoveBusy(true); setMoveError(null);
    try {
      const r = await axios.post(`${base}/pda/products/${encodeURIComponent(product.product_id)}/moves`, body, auth(token));
      setProduct(r.data.product);
      setMoveOpen(false);
      say(`Mouvement envoyé : ${r.data.move.delta > 0 ? '+' : '−'}${Math.abs(r.data.move.delta)} · stock ${fmt(r.data.move.stock_after)}`);
    } catch (e) {
      setMoveError(e.response?.data?.error || e.message);
      beep(false);
      // Le mouvement a pu laisser une trace (refusé, incertain) : la fiche la montre
      openProduct(product.product_id);
    } finally { setMoveBusy(false); }
  };

  const stock = product ? (product.live_stock ?? (product.shops || []).find((s) => s.warehouse_id === shop.id)?.stock ?? null) : null;

  return (
    <div>
      {cameraOpen && <CameraScanner onDetect={(code) => lookup(code)} onClose={() => setCameraOpen(false)} />}

      <form onSubmit={(e) => { e.preventDefault(); lookup(q); }} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scanner ou chercher (nom, code, marque)"
          style={input} />
        <button type="button" onClick={() => setCameraOpen(true)} style={{ ...big(C.dark), padding: '0 16px', fontSize: 20 }}>📷</button>
      </form>
      {flash && <div style={{ marginBottom: 10, fontWeight: 700, color: flash.ok ? C.green : C.red }}>{flash.msg}</div>}
      {(searching || loading) && <div style={{ color: C.greyT, fontSize: 14, marginBottom: 8 }}>{loading ? 'Ouverture…' : 'Recherche…'}</div>}

      {!product && results.map((p) => (
        <button key={p.product_id} onClick={() => openProduct(p.product_id)} style={{
          display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6, cursor: 'pointer',
          background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, fontFamily: 'inherit',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, overflowWrap: 'anywhere', color: C.dark }}>{p.name}</div>
          <div style={{ fontSize: 12, color: C.greyM }}>
            {[p.sku && `#${p.sku}`, p.brand, p.category_name].filter(Boolean).join(' · ')} · stock {fmt(p.stock)}
            {p.disabled ? ' · désactivé' : ''}
          </div>
        </button>
      ))}

      {!product && !results.length && !searching && !loading && (
        <div style={{ padding: 30, textAlign: 'center', color: C.greyM }}>Scannez un produit, ou tapez son nom.</div>
      )}

      {product && (
        <ProductView shop={shop} product={product} onBack={() => { setProduct(null); setFlash(null); inputRef.current?.focus(); }}
          onMove={() => { setMoveError(null); setMoveOpen(true); }} />
      )}

      {moveOpen && product && (
        <MoveSheet product={product} stock={stock} busy={moveBusy} error={moveError}
          onSave={saveMove} onClose={() => !moveBusy && setMoveOpen(false)} />
      )}
    </div>
  );
}
