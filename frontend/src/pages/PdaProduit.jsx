import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import { pdaBtn as bigBtn } from '../components/pda/pdaStyles';
import { beep, useScanner } from '../components/pda/pdaScan';
import CameraScanner from '../components/boutique/CameraScanner';

/**
 * Produit au PDA — /pda/produit, ouvert depuis l'accueil PDA (/pda).
 *
 * Validé avec Pierre le 05/10/2026 : on scanne (code unité, code pack, SKU) ou
 * on cherche un produit ; sa fiche donne photo, marque, stock disponible et
 * physique lus en direct dans BMS, emplacement, codes-barres. On y change
 * l'emplacement (scan de l'étiquette du rayon, poussé dans BMS), on édite les
 * codes-barres (chez nous seulement) et on passe un mouvement de stock BMS.
 *
 * Un seul lecteur de scan pour toute la page : la fenêtre ouverte (emplacement,
 * code-barres) prend le code pour elle, sinon il ouvre un produit — ou, sur une
 * fiche, la fenêtre d'emplacement si c'est l'étiquette d'un rayon.
 *
 * Sans douchette (smartphone), le bouton caméra lit un code et le traite
 * exactement comme un scan.
 */

let onUnauthorized = null;
const unauthorized = (err) => {
  if (err.response?.status === 401) onUnauthorized?.();
  throw err;
};

const api = (token) => {
  const base = `${API_URL}/pda-produit`;
  const h = authHeaders(token);
  return {
    get: (url) => axios.get(base + url, h).then(r => r.data, unauthorized),
    post: (url, body = {}) => axios.post(base + url, body, h).then(r => r.data, unauthorized),
    put: (url, body = {}) => axios.put(base + url, body, h).then(r => r.data, unauthorized),
    del: (url) => axios.delete(base + url, h).then(r => r.data, unauthorized),
  };
};

const errorText = (err) => err.response?.data?.error || (err.response?.status === 403
  ? 'Vous n\'avez pas le droit Picking : demandez-le à un responsable.'
  : err.message);

// Même règle que le serveur : « e5-3 », « E5-3 » et « E 5-3 » désignent E 5-3.
const spaced = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const compact = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const resolveLocation = (list, raw) => {
  const exact = list.find(l => spaced(l) === spaced(raw));
  if (exact) return exact;
  const key = compact(raw);
  const candidates = key ? list.filter(l => compact(l) === key) : [];
  return candidates.length === 1 ? candidates[0] : null;
};

/** La fenêtre ouverte prend les scans pour elle, et les rend en se fermant. */
const useScanTarget = (scanTarget, fn) => {
  const handler = useRef(fn);
  handler.current = fn;
  useEffect(() => {
    const prev = scanTarget.current;
    const mine = (code) => handler.current(code);
    scanTarget.current = mine;
    return () => { if (scanTarget.current === mine) scanTarget.current = prev; };
  }, [scanTarget]);
};

const input = {
  width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 18, borderRadius: 10,
  border: `1px solid ${C.greyB}`, fontFamily: 'inherit',
};
const card = { background: C.white, borderRadius: 14, border: `1px solid ${C.greyB}`, padding: 14 };
const label = { fontSize: 12, fontWeight: 800, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.4 };
const smallBtn = { ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, fontSize: 14, padding: '9px 12px' };

/** Scanner avec l'appareil photo (smartphone sans douchette). */
const CameraButton = ({ onClick, style }) => (
  <button type="button" onClick={onClick} title="Scanner avec l'appareil photo" style={{
    ...smallBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', ...style,
  }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  </button>
);

const Photo = ({ url, size }) => (url
  ? <img src={url} alt="" loading="lazy" style={{
    width: size, height: size, objectFit: 'contain', borderRadius: 10, background: C.white, flexShrink: 0,
  }} />
  : <div style={{
    width: size, height: size, borderRadius: 10, background: C.greyB, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greyM, fontSize: size / 3,
  }}>?</div>);

const Toggle = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', gap: 8 }}>
    {options.map(o => (
      <button key={o.value} type="button" onClick={() => onChange(o.value)} style={{
        ...bigBtn(value === o.value ? (o.color || C.violet) : C.white, value === o.value ? C.white : C.dark),
        border: `2px solid ${value === o.value ? (o.color || C.violet) : C.greyB}`, flex: 1, fontSize: 16, padding: '12px 8px',
      }}>{o.label}</button>
    ))}
  </div>
);

/** Fenêtre posée sur la fiche. */
const Sheet = ({ title, onClose, children }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 30,
    display: 'flex', alignItems: 'flex-start', padding: 12, paddingTop: 64, overflowY: 'auto',
  }}>
    <div style={{ background: C.white, borderRadius: 14, padding: 16, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 900, fontSize: 19, flex: 1 }}>{title}</span>
        <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '6px 12px' }}>Fermer</button>
      </div>
      {children}
    </div>
  </div>
);

// ── Écran 1 : recherche ─────────────────────────────────────────────────────

function SearchScreen({ query, setQuery, results, searching, onSearch, onOpen, onCamera }) {
  return (
    <div style={{ padding: 14 }}>
      <p style={{ margin: '4px 2px 12px', color: C.greyT, fontSize: 14 }}>
        Scannez un produit (code unité, code pack ou SKU), ou cherchez-le par son nom.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); onSearch(query); }} style={{ display: 'flex', gap: 8 }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom, marque, SKU…"
          enterKeyHint="search" style={{ ...input, flex: 1 }}
        />
        <button type="submit" disabled={searching} style={bigBtn(C.violet)}>{searching ? '…' : 'Chercher'}</button>
        <CameraButton onClick={onCamera} />
      </form>

      {results && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, color: C.greyT, margin: '0 2px 8px' }}>
            {results.results.length === 0 ? 'Aucun produit.' : `${results.results.length} produit(s)${results.results.length === 40 ? ' — affinez la recherche' : ''}`}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {results.results.map(r => (
              <button key={r.id} onClick={() => onOpen(r.id)} style={{
                display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', width: '100%', padding: 10,
                borderRadius: 12, border: `1px solid ${C.greyB}`, background: C.white, fontFamily: 'inherit', color: C.dark,
              }}>
                <Photo url={r.imageUrl} size={56} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 15, lineHeight: 1.25 }}>{r.name}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: C.greyT, marginTop: 2 }}>
                    {[r.brand, r.sku && `SKU ${r.sku}`].filter(Boolean).join(' · ')}
                    {r.status !== 'publish' && <strong style={{ color: C.amber }}> · {r.status}</strong>}
                    {r.matched?.type === 'pack' && <strong style={{ color: C.violet }}> · code pack x{r.matched.quantity ?? '?'}</strong>}
                  </span>
                </span>
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ display: 'block', fontWeight: 900, fontSize: 16, color: r.location ? C.dark : C.greyM }}>{r.location || '—'}</span>
                  <span style={{ display: 'block', fontSize: 12, color: C.greyT }}>dispo {r.stock ?? '?'}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Écran 2 : fiche produit ─────────────────────────────────────────────────

function LocationSheet({ current, initial, locations, scanTarget, busy, onSave, onClose, onCamera }) {
  const [value, setValue] = useState(initial || '');
  useScanTarget(scanTarget, (code) => {
    setValue(code);
    beep(!!resolveLocation(locations, code));
  });

  const resolved = resolveLocation(locations, value);
  const key = compact(value);
  const suggestions = key && !resolved ? locations.filter(l => compact(l).startsWith(key)).slice(0, 12) : [];
  const canSave = locations.length === 0 ? !!value.trim() : !!resolved && resolved !== current;

  return (
    <Sheet title="Changer l'emplacement" onClose={onClose}>
      <div style={{ fontSize: 15, marginBottom: 10 }}>
        Actuel : <strong>{current || 'aucun'}</strong>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value} onChange={e => setValue(e.target.value)} placeholder="Scannez l'étiquette ou tapez (ex. E 5-3)"
          autoCapitalize="characters" style={{ ...input, flex: 1 }}
        />
        <CameraButton onClick={onCamera} />
      </div>
      {value.trim() && (
        <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: resolved ? C.green : C.amber }}>
          {resolved
            ? (resolved === current ? 'C\'est déjà son emplacement.' : `Nouvel emplacement : ${resolved}`)
            : (locations.length > 0 ? 'Emplacement inconnu de BMS.' : '')}
        </div>
      )}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {suggestions.map(l => (
            <button key={l} type="button" onClick={() => setValue(l)} style={{ ...smallBtn, padding: '8px 10px', fontWeight: 800 }}>{l}</button>
          ))}
        </div>
      )}
      <button
        disabled={busy || !canSave} onClick={() => onSave(resolved || value.trim())}
        style={{ ...bigBtn(canSave ? C.violet : C.greyB, canSave ? C.white : C.greyT), width: '100%', marginTop: 14 }}
      >
        {busy ? 'Envoi à BMS…' : 'Enregistrer dans BMS'}
      </button>
    </Sheet>
  );
}

function BarcodeSheet({ code, scanTarget, busy, onSave, onDelete, onClose, onCamera }) {
  const editing = !!code;
  const [barcode, setBarcode] = useState(code?.barcode || '');
  const [type, setType] = useState(code?.type || 'unit');
  const [quantity, setQuantity] = useState(code?.quantity ? String(code.quantity) : '');
  useScanTarget(scanTarget, (scanned) => {
    if (editing) { beep(false); return; }
    setBarcode(scanned);
    beep(true);
  });

  const qty = Number(quantity);
  const canSave = !!barcode.trim() && (type === 'unit' || (Number.isInteger(qty) && qty >= 2));

  return (
    <Sheet title={editing ? 'Modifier le code-barres' : 'Ajouter un code-barres'} onClose={onClose}>
      {editing
        ? <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, marginBottom: 12 }}>{code.barcode}</div>
        : <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Scannez le code ou tapez-le"
            inputMode="numeric" style={{ ...input, flex: 1 }}
          />
          <CameraButton onClick={onCamera} />
        </div>}
      <Toggle options={[{ value: 'unit', label: 'Unité' }, { value: 'pack', label: 'Pack' }]} value={type} onChange={setType} />
      {type === 'pack' && (
        <div style={{ marginTop: 12 }}>
          <div style={label}>Unités dans le pack</div>
          <input
            value={quantity} onChange={e => setQuantity(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            placeholder="ex. 10" style={{ ...input, marginTop: 6 }}
          />
        </div>
      )}
      <button
        disabled={busy || !canSave} onClick={() => onSave({ barcode: barcode.trim(), type, quantity: type === 'pack' ? qty : null })}
        style={{ ...bigBtn(canSave ? C.violet : C.greyB, canSave ? C.white : C.greyT), width: '100%', marginTop: 14 }}
      >
        Enregistrer
      </button>
      {editing && (
        <button
          disabled={busy}
          onClick={() => { if (window.confirm(`Supprimer le code ${code.barcode} ?`)) onDelete(); }}
          style={{ ...bigBtn(C.white, C.red), border: `1px solid ${C.red}`, width: '100%', marginTop: 10, fontSize: 15 }}
        >
          Supprimer ce code
        </button>
      )}
    </Sheet>
  );
}

function MovementSheet({ product, reasons, scanTarget, busy, onSave, onClose }) {
  const [reason, setReason] = useState(null);
  const [direction, setDirection] = useState(null);
  const [qty, setQty] = useState('1');
  const [comment, setComment] = useState('');
  useScanTarget(scanTarget, () => beep(false));

  const def = reasons.find(r => r.key === reason);
  const dir = def?.directions.length === 1 ? def.directions[0] : direction;
  const n = Number(qty);
  const physical = product.bms?.physical;
  const canSave = !!def && !!dir && Number.isInteger(n) && n >= 1 && !(dir === 'out' && physical != null && n > physical);
  const signed = dir === 'in' ? `+${n}` : `−${n}`;

  return (
    <Sheet title="Mouvement de stock" onClose={onClose}>
      <div style={label}>Raison</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
        {reasons.map(r => (
          <button key={r.key} type="button" onClick={() => { setReason(r.key); setDirection(null); }} style={{
            ...bigBtn(reason === r.key ? C.violet : C.white, reason === r.key ? C.white : C.dark),
            border: `2px solid ${reason === r.key ? C.violet : C.greyB}`, textAlign: 'left',
          }}>
            {r.label}
            <span style={{ fontWeight: 600, fontSize: 13, opacity: 0.8 }}>
              {r.directions.length === 1 ? ' — sortie' : ' — entrée ou sortie'}
            </span>
          </button>
        ))}
      </div>

      {def && def.directions.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...label, marginBottom: 6 }}>Sens</div>
          <Toggle
            options={[{ value: 'in', label: '+ Entrée', color: C.green }, { value: 'out', label: '− Sortie', color: C.red }]}
            value={direction} onChange={setDirection}
          />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ ...label, marginBottom: 6 }}>Quantité</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <button type="button" onClick={() => setQty(String(Math.max(1, (n || 1) - 1)))} style={{ ...smallBtn, fontSize: 24, padding: '4px 18px' }}>−</button>
          <input
            value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            style={{ ...input, textAlign: 'center', fontSize: 24, fontWeight: 900, flex: 1 }}
          />
          <button type="button" onClick={() => setQty(String((n || 0) + 1))} style={{ ...smallBtn, fontSize: 24, padding: '4px 18px' }}>+</button>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ ...label, marginBottom: 6 }}>Commentaire (facultatif)</div>
        <input value={comment} onChange={e => setComment(e.target.value)} maxLength={60} style={input} />
      </div>

      {dir && physical != null && Number.isInteger(n) && n >= 1 && (
        <div style={{ marginTop: 12, fontSize: 15, color: dir === 'out' && n > physical ? C.red : C.dark }}>
          Stock physique : <strong>{physical}</strong> → <strong>{dir === 'in' ? physical + n : physical - n}</strong>
          {dir === 'out' && n > physical && ' — pas assez de stock'}
        </div>
      )}

      <button
        disabled={busy || !canSave}
        onClick={() => onSave({ reason, direction: dir, qty: n, comment: comment.trim() })}
        style={{ ...bigBtn(canSave ? (dir === 'in' ? C.green : C.red) : C.greyB, canSave ? C.white : C.greyT), width: '100%', marginTop: 14 }}
      >
        {busy ? 'Envoi à BMS…' : canSave ? `Envoyer à BMS : ${signed} (${def.label})` : 'Envoyer à BMS'}
      </button>
    </Sheet>
  );
}

function ProductScreen({ token, productId, locations, reasons, scanTarget, onScanSearch, showFlash, onCamera }) {
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setP(await api(token).get(`/products/${productId}`));
    } catch (err) {
      showFlash('error', errorText(err));
    } finally {
      setLoading(false);
    }
  }, [token, productId, showFlash]);

  useEffect(() => { load(); }, [load]);

  // Sur la fiche : l'étiquette d'un rayon ouvre le changement d'emplacement,
  // tout autre code ouvre le produit qu'il désigne.
  useScanTarget(scanTarget, (code) => {
    const loc = resolveLocation(locations, code);
    if (loc) {
      beep(true);
      setModal({ kind: 'location', initial: loc });
      return;
    }
    onScanSearch(code);
  });

  const act = async (fn, okText) => {
    setBusy(true);
    try {
      setP(await fn());
      setModal(null);
      beep(true);
      showFlash('ok', okText);
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!p) return <p style={{ padding: 20, color: C.greyT }}>{loading ? 'Chargement…' : 'Produit indisponible.'}</p>;

  const call = api(token);
  const location = p.bms ? p.bms.location : p.location;
  const units = p.barcodes.filter(b => b.type === 'unit');
  const packs = p.barcodes.filter(b => b.type === 'pack');

  return (
    <div style={{ padding: 12, paddingBottom: 100, display: 'grid', gap: 10 }}>
      <div style={{ ...card, display: 'flex', gap: 12 }}>
        <Photo url={p.imageUrl} size={110} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.25 }}>{p.name}</div>
          {(p.brand || p.subBrand) && (
            <div style={{ fontSize: 14, fontWeight: 700, color: C.violet, marginTop: 4 }}>
              {[p.brand, p.subBrand].filter(Boolean).join(' › ')}
            </div>
          )}
          <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>
            SKU {p.sku || '—'}
            {p.status !== 'publish' && <strong style={{ color: C.amber }}> · {p.status}</strong>}
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ ...label, flex: 1 }}>Stock BMS</span>
          <button onClick={load} disabled={loading} style={{ ...smallBtn, padding: '5px 10px', fontSize: 13 }}>
            {loading ? '…' : 'Actualiser'}
          </button>
        </div>
        {p.bms ? (
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {[['Disponible', p.bms.available, C.green], ['Physique', p.bms.physical, C.dark]].map(([l, v, color]) => (
              <div key={l} style={{ flex: 1, background: C.grey, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 13, color: C.greyT, fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 34, fontWeight: 900, color, lineHeight: 1.1 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: C.amberL, color: C.amber, fontSize: 14 }}>
            <strong>{p.bmsError}</strong>
            <div style={{ marginTop: 4 }}>Dernier relevé (disponible) : <strong>{p.stock ?? '?'}</strong></div>
          </div>
        )}
        {p.bms && (p.bms.reserved > 0 || p.bms.toShip > 0) && (
          <div style={{ fontSize: 13, color: C.greyT, marginTop: 6 }}>
            Réservé {p.bms.reserved} · à expédier {p.bms.toShip}
          </div>
        )}
      </div>

      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={label}>Emplacement</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: location ? C.dark : C.greyM }}>
            {location || 'Aucun'}
          </div>
        </div>
        <button disabled={!p.sku} onClick={() => setModal({ kind: 'location' })} style={bigBtn(C.violet)}>Changer</button>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ ...label, flex: 1 }}>Codes-barres</span>
          <button onClick={() => setModal({ kind: 'code' })} style={{ ...smallBtn, padding: '6px 10px', fontSize: 13 }}>+ Ajouter</button>
        </div>
        {p.barcodes.length === 0 && <div style={{ color: C.amber, fontWeight: 700, fontSize: 14 }}>Aucun code-barres.</div>}
        {[...units, ...packs].map(b => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${C.greyB}` }}>
            <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, flex: 1, wordBreak: 'break-all' }}>{b.barcode}</span>
            <span style={{
              padding: '3px 9px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
              background: b.type === 'pack' ? C.violetL : C.blueL, color: b.type === 'pack' ? C.violet : C.blue,
            }}>
              {b.type === 'pack' ? `Pack x${b.quantity ?? '?'}` : 'Unité'}
            </span>
            <button onClick={() => setModal({ kind: 'code', code: b })} style={{ ...smallBtn, padding: '5px 9px', fontSize: 13 }}>Modifier</button>
          </div>
        ))}
      </div>

      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: 12, background: C.white,
        borderTop: `1px solid ${C.greyB}`, zIndex: 10, display: 'flex', gap: 10,
      }}>
        <CameraButton onClick={onCamera} />
        <button disabled={!p.sku} onClick={() => setModal({ kind: 'movement' })} style={{ ...bigBtn(C.violet), flex: 1, fontSize: 19 }}>
          Mouvement de stock
        </button>
      </div>

      {modal?.kind === 'location' && (
        <LocationSheet
          current={location} initial={modal.initial} locations={locations}
          scanTarget={scanTarget} busy={busy} onClose={() => setModal(null)} onCamera={onCamera}
          onSave={(location) => act(() => call.put(`/products/${p.id}/location`, { location }), `Emplacement : ${location}`)}
        />
      )}
      {modal?.kind === 'code' && (
        <BarcodeSheet
          code={modal.code} scanTarget={scanTarget} busy={busy} onClose={() => setModal(null)} onCamera={onCamera}
          onSave={(body) => act(
            () => (modal.code
              ? call.put(`/products/${p.id}/barcodes/${modal.code.id}`, body)
              : call.post(`/products/${p.id}/barcodes`, body)),
            modal.code ? 'Code modifié' : 'Code ajouté'
          )}
          onDelete={() => act(() => call.del(`/products/${p.id}/barcodes/${modal.code.id}`), 'Code supprimé')}
        />
      )}
      {modal?.kind === 'movement' && (
        <MovementSheet
          product={p} reasons={reasons} scanTarget={scanTarget} busy={busy} onClose={() => setModal(null)}
          onSave={(body) => act(
            () => call.post(`/products/${p.id}/movements`, body),
            `Mouvement envoyé : ${body.direction === 'in' ? '+' : '−'}${body.qty}`
          )}
        />
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function PdaProduit() {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  onUnauthorized = logout;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [productId, setProductId] = useState(null);
  const [searching, setSearching] = useState(false);
  const [locations, setLocations] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [flash, setFlash] = useState(null);
  const [camera, setCamera] = useState(false);
  const scanTarget = useRef(null);

  useEffect(() => {
    api(token).get('/locations').then(d => setLocations(d.locations)).catch(() => {});
    api(token).get('/reasons').then(d => setReasons(d.reasons)).catch(() => {});
  }, [token]);

  const showFlash = useCallback((kind, text) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(f => (f?.text === text ? null : f)), kind === 'ok' ? 1500 : 3500);
  }, []);

  const search = useCallback(async (q, fromScan = false) => {
    const value = String(q || '').trim();
    if (!value) return;
    setSearching(true);
    try {
      const data = await api(token).get(`/search?q=${encodeURIComponent(value)}`);
      setResults(data);
      // Un code désigne un produit : on l'ouvre directement.
      if (data.by !== 'text' && data.results.length === 1) {
        if (fromScan) beep(true);
        setQuery(value);
        setProductId(data.results[0].id);
        const m = data.results[0].matched;
        if (m?.type === 'pack') showFlash('ok', `Code d'un pack de ${m.quantity ?? '?'}`);
        return;
      }
      if (fromScan) beep(data.results.length > 0);
      setQuery(value);
      setProductId(null);
      if (data.results.length === 0) showFlash('error', `Aucun produit pour « ${value} ».`);
    } catch (err) {
      beep(false);
      showFlash('error', errorText(err));
    } finally {
      setSearching(false);
    }
  }, [token, showFlash]);

  const dispatchScan = (code) => {
    if (scanTarget.current) scanTarget.current(code);
    else search(code, true);
  };
  useScanner(dispatchScan, !camera);

  // Un code lu à la caméra = un scan : on referme et on le traite pareil.
  // (Rappel stable : CameraScanner relance la caméra si on le change.)
  const dispatchRef = useRef(dispatchScan);
  dispatchRef.current = dispatchScan;
  const onCameraCode = useCallback((code) => {
    setCamera(false);
    dispatchRef.current(code);
  }, []);
  const openCamera = useCallback(() => setCamera(true), []);

  // Un bouton touché garde le focus : l'Entrée du scan suivant le
  // « cliquerait » à nouveau. On le lâche aussitôt.
  const releaseButton = () => {
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
  };

  return (
    <PdaLayout
      title="Produit"
      onBack={productId ? () => setProductId(null) : () => navigate('/pda')}
      backLabel={productId ? 'Recherche' : 'Accueil'}
    >
      <div onClick={releaseButton}>
        {productId
          ? <ProductScreen
            key={productId} token={token} productId={productId} locations={locations} reasons={reasons}
            scanTarget={scanTarget} onScanSearch={(code) => search(code, true)} showFlash={showFlash}
            onCamera={openCamera}
          />
          : <SearchScreen
            query={query} setQuery={setQuery} results={results} searching={searching}
            onSearch={(q) => search(q)} onOpen={setProductId} onCamera={openCamera}
          />}
      </div>

      {camera && <CameraScanner onDetect={onCameraCode} onClose={() => setCamera(false)} />}

      {flash && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 90, zIndex: 40, padding: '14px 16px', borderRadius: 12,
          background: flash.kind === 'ok' ? C.green : C.red, color: C.white, fontWeight: 800, fontSize: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>{flash.text}</div>
      )}
    </PdaLayout>
  );
}
