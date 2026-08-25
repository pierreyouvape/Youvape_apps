import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import CameraScanner from './CameraScanner';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#135E84', accent: '#E28F00', purple: '#7C3AED',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2', orange: '#EA580C',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4', dark: '#111827', white: '#FFFFFF',
};
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

const REASON = {
  negatif: { label: 'Stock négatif', color: C.red },
  vendu_souvent: { label: 'Vendu souvent', color: C.primary },
  anormalement_bas: { label: 'Anormalement bas', color: C.orange },
  anormalement_eleve: { label: 'Anormalement élevé', color: C.purple },
};

function Btn({ children, onClick, disabled, bg = C.primary, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.greyB : bg, color: disabled ? C.greyM : '#fff', border: 'none',
      borderRadius: 10, padding: '13px 18px', fontSize: 16, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', width: '100%', ...style,
    }}>{children}</button>
  );
}

export default function ComptageTab({ shop, token }) {
  const [view, setView] = useState('list');        // 'list' | 'create' | 'session'
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  // création
  const [cats, setCats] = useState({ categories: [], subcategories: [] });
  const [newName, setNewName] = useState('');
  const [catFilter, setCatFilter] = useState(''); // "category:ID" | "subcategory:ID"

  // comptage
  const [scanVal, setScanVal] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const scanRef = useRef(null);

  // validation
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null);
  const [reviewMode, setReviewMode] = useState(false); // revue des non-scannés (type catégorie)

  const loadSessions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await axios.get(`${API_URL}/nextore/${shop.slug}/comptages`, auth(token));
      setSessions(r.data.comptages || []);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [shop.slug, token]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const openSession = async (id) => {
    setError(null); setResult(null); setReviewMode(false);
    try {
      const r = await axios.get(`${API_URL}/nextore/${shop.slug}/comptage/${id}`, auth(token));
      setSession(r.data.comptage); setView('session');
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const openCreate = async () => {
    setNewName(''); setCatFilter(''); setView('create');
    try {
      const r = await axios.get(`${API_URL}/nextore/${shop.slug}/categories`, auth(token));
      setCats({ categories: r.data.categories || [], subcategories: r.data.subcategories || [] });
    } catch { /* non bloquant */ }
  };

  const create = async (type) => {
    setError(null);
    const body = { type, name: newName || null };
    if (type === 'categorie') {
      if (!catFilter) { setError('Choisis une catégorie ou sous-catégorie'); return; }
      const [ft, fid] = catFilter.split(':');
      body.filterType = ft; body.filterId = fid;
    }
    try {
      const r = await axios.post(`${API_URL}/nextore/${shop.slug}/comptage`, body, auth(token));
      setSession(r.data.comptage); setView('session');
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  // Applique une réponse de comptage à la session locale (sans recharger)
  const applyCount = (data) => {
    setSession((s) => {
      if (!s) return s;
      const items = [...s.items];
      const idx = items.findIndex((i) => i.product_id === data.product_id);
      if (idx >= 0) items[idx] = { ...items[idx], counted_qty: data.counted_qty, s_ref: data.s_ref ?? items[idx].s_ref, name: items[idx].name || data.name, sku: items[idx].sku || data.sku };
      else items.push({ product_id: data.product_id, name: data.name, sku: data.sku, counted_qty: data.counted_qty, s_ref: data.s_ref, pushed: false });
      return { ...s, items };
    });
  };

  const doScan = async (barcode) => {
    if (!barcode || !session) return;
    try {
      const r = await axios.post(`${API_URL}/nextore/${shop.slug}/comptage/${session.id}/count`, { barcode }, auth(token));
      applyCount(r.data);
      setLastScan({ ok: true, name: r.data.name, qty: r.data.counted_qty });
    } catch (e) {
      setLastScan({ ok: false, msg: e.response?.data?.error || 'Code-barres inconnu' });
    }
  };

  const setQty = async (productId, qty) => {
    try {
      const r = await axios.post(`${API_URL}/nextore/${shop.slug}/comptage/${session.id}/count`,
        { product_id: productId, qty, mode: 'set' }, auth(token));
      applyCount(r.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const onWedgeKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = scanVal.trim();
      setScanVal('');
      if (v) doScan(v);
      if (scanRef.current) scanRef.current.focus();
    }
  };

  const validate = async (mode, zeroProductIds = []) => {
    setValidating(true); setError(null);
    try {
      const r = await axios.post(`${API_URL}/nextore/${shop.slug}/comptage/${session.id}/validate`,
        { mode, zeroProductIds }, auth(token));
      setResult(r.data);
      if (mode === 'final') { await loadSessions(); }
      else { await openSession(session.id); } // recharge l'état poussé
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setValidating(false); setReviewMode(false); }
  };

  /* ─── Rendu ─── */
  if (view === 'list') {
    return (
      <div>
        <Btn onClick={openCreate} bg={C.purple} style={{ marginBottom: 16 }}>+ Nouveau comptage</Btn>
        {error && <div style={{ background: C.redL, color: C.red, padding: 12, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
        {loading ? <div style={{ padding: 24, color: C.greyT }}>Chargement…</div> : sessions.length === 0 ? (
          <div style={{ padding: 24, color: C.greyM, textAlign: 'center' }}>Aucun comptage.</div>
        ) : sessions.map((c) => (
          <div key={c.id} onClick={() => openSession(c.id)} style={{
            background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{c.name || ({ tournant: 'Inventaire tournant', spontane: 'Spontané', categorie: 'Par catégorie' }[c.type])}</strong>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.status === 'valide' ? C.green : C.accent }}>
                {c.status === 'valide' ? 'Validé' : 'En cours'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: C.greyM, marginTop: 4 }}>
              {c.type} · {c.counted_count}/{c.items_count} compté(s) · {String(c.created_at).slice(0, 10)}
              {(c.created_by_name || c.created_by) && <> · 👤 {c.created_by_name || String(c.created_by).split('@')[0]}</>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (view === 'create') {
    return (
      <div>
        <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', color: C.primary, fontSize: 15, padding: 0, marginBottom: 14, cursor: 'pointer' }}>‹ Retour</button>
        {error && <div style={{ background: C.redL, color: C.red, padding: 12, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
        <label style={{ fontSize: 13, fontWeight: 600, color: C.greyT }}>Nom (optionnel)</label>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ex. Inventaire e-liquides"
          style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${C.greyB}`, fontSize: 16, margin: '6px 0 18px', boxSizing: 'border-box' }} />

        <Btn onClick={() => create('tournant')} bg={C.purple} style={{ marginBottom: 12 }}>🔄 Inventaire tournant (10 réfs proposées)</Btn>
        <Btn onClick={() => create('spontane')} bg={C.primary} style={{ marginBottom: 18 }}>✋ Comptage spontané (libre)</Btn>

        <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: C.greyT }}>Par catégorie / sous-catégorie</label>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
            style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${C.greyB}`, fontSize: 16, margin: '6px 0 12px', background: '#fff' }}>
            <option value="">— Choisir —</option>
            <optgroup label="Catégories">
              {cats.categories.map((c) => <option key={`c${c.id}`} value={`category:${c.id}`}>{c.name} ({c.product_count})</option>)}
            </optgroup>
            <optgroup label="Sous-catégories">
              {cats.subcategories.map((c) => <option key={`s${c.id}`} value={`subcategory:${c.id}`}>{c.name} ({c.product_count})</option>)}
            </optgroup>
          </select>
          <Btn onClick={() => create('categorie')} bg={C.accent}>📂 Démarrer le comptage catégorie</Btn>
        </div>
      </div>
    );
  }

  // view === 'session'
  const items = session?.items || [];
  const counted = items.filter((i) => i.counted_qty != null);
  const uncounted = items.filter((i) => i.counted_qty == null);
  const isCategorie = session?.type === 'categorie';
  const validated = session?.status === 'valide';

  return (
    <div>
      {cameraOpen && <CameraScanner onDetect={(code) => doScan(code)} onClose={() => setCameraOpen(false)} />}

      <button onClick={() => { setView('list'); setSession(null); loadSessions(); }} style={{ background: 'none', border: 'none', color: C.primary, fontSize: 15, padding: 0, marginBottom: 12, cursor: 'pointer' }}>‹ Comptages</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: 18 }}>{session?.name || ({ tournant: 'Tournant', spontane: 'Spontané', categorie: 'Catégorie' }[session?.type])}</strong>
        <span style={{ fontSize: 13, color: C.greyM }}>{counted.length}/{items.length || counted.length} compté(s)</span>
      </div>

      {error && <div style={{ background: C.redL, color: C.red, padding: 12, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {result && (
        <div style={{ background: C.greenL, color: '#065f46', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 14 }}>
          {result.results.filter((r) => r.ok).length} réf(s) poussée(s).
          {result.results.some((r) => r.moved) && <div style={{ color: C.orange, marginTop: 4 }}>⚠ {result.results.filter((r) => r.moved).length} réf(s) ont bougé pendant le comptage — à revérifier.</div>}
          {result.results.some((r) => !r.ok) && <div style={{ color: C.red, marginTop: 4 }}>{result.results.filter((r) => !r.ok).length} échec(s).</div>}
        </div>
      )}

      {!validated && (
        <>
          {/* Scan douchette + caméra */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input ref={scanRef} value={scanVal} inputMode="none" autoFocus
              onChange={(e) => setScanVal(e.target.value)} onKeyDown={onWedgeKey}
              placeholder="Scanner (douchette) ou saisir un code-barres"
              style={{ flex: 1, padding: 13, borderRadius: 10, border: `2px solid ${C.primary}`, fontSize: 16, boxSizing: 'border-box' }} />
            <button onClick={() => setCameraOpen(true)} style={{ background: C.dark, color: '#fff', border: 'none', borderRadius: 10, padding: '0 16px', fontSize: 20 }}>📷</button>
          </div>
          {lastScan && (
            <div style={{ fontSize: 14, marginBottom: 12, color: lastScan.ok ? C.green : C.red }}>
              {lastScan.ok ? `✓ ${lastScan.name} → ${lastScan.qty}` : `✕ ${lastScan.msg}`}
            </div>
          )}
        </>
      )}

      {/* Réfs à compter (tournant/catégorie non comptées) */}
      {uncounted.length > 0 && !validated && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', margin: '6px 0' }}>À compter ({uncounted.length})</div>
          {uncounted.map((i) => (
            <Row key={i.product_id} item={i} onSet={(q) => setQty(i.product_id, q)} muted />
          ))}
        </div>
      )}

      {/* Réfs comptées */}
      {counted.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, textTransform: 'uppercase', margin: '6px 0' }}>Compté ({counted.length})</div>
          {counted.map((i) => (
            <Row key={i.product_id} item={i} onSet={(q) => setQty(i.product_id, q)} disabled={validated} />
          ))}
        </div>
      )}

      {/* Validation */}
      {!validated && (
        <div style={{ position: 'sticky', bottom: 0, background: C.grey, padding: '10px 0', display: 'flex', gap: 10 }}>
          {isCategorie ? (
            <>
              <Btn onClick={() => validate('partial')} disabled={validating} bg={C.primary}>Valider partiel</Btn>
              <Btn onClick={() => setReviewMode(true)} disabled={validating} bg={C.green}>Valider final</Btn>
            </>
          ) : (
            <Btn onClick={() => validate('final')} disabled={validating || counted.length === 0} bg={C.green}>
              {validating ? 'Poussée en cours…' : 'Valider et pousser'}
            </Btn>
          )}
        </div>
      )}

      {/* Revue des non-scannés (catégorie, validation finale) */}
      {reviewMode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', maxHeight: '85vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 18 }}>
            <h3 style={{ margin: '0 0 8px' }}>Validation finale</h3>
            <p style={{ fontSize: 14, color: C.greyT, margin: '0 0 14px' }}>
              {uncounted.length} réf(s) non comptée(s). « Mettre à 0 » les met à zéro dans Nextore. Les autres restent inchangées (à recompter).
            </p>
            {uncounted.length === 0 && <p style={{ color: C.green }}>Tout est compté ✓</p>}
            {uncounted.map((i) => (
              <div key={i.product_id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.greyB}`, fontSize: 14 }}>{i.name}</div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn onClick={() => setReviewMode(false)} bg={C.greyM}>Annuler</Btn>
              <Btn onClick={() => validate('final', uncounted.map((i) => i.product_id))} disabled={validating} bg={C.red}>
                Mettre à 0 les non comptés + clôturer
              </Btn>
            </div>
            <div style={{ marginTop: 10 }}>
              <Btn onClick={() => validate('final', [])} disabled={validating} bg={C.green}>Clôturer sans toucher les non comptés</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Ligne produit avec quantité éditable */
function Row({ item, onSet, muted, disabled }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(item.counted_qty ?? '');
  const reason = item.reason && REASON[item.reason];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#fff',
      border: `1px solid ${C.greyB}`, borderRadius: 10, marginBottom: 6, opacity: muted ? 0.7 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{item.name || item.product_id}</div>
        <div style={{ fontSize: 12, color: C.greyM }}>
          {item.sku ? `#${item.sku}` : ''}{reason ? <span style={{ color: reason.color, marginLeft: 6 }}>· {reason.label}</span> : ''}
        </div>
      </div>
      {edit && !disabled ? (
        <input type="number" value={v} autoFocus onChange={(e) => setV(e.target.value)}
          onBlur={() => { setEdit(false); const n = parseInt(v, 10); if (!Number.isNaN(n)) onSet(n); }}
          style={{ width: 70, padding: 8, borderRadius: 8, border: `1px solid ${C.primary}`, fontSize: 16, textAlign: 'right' }} />
      ) : (
        <button onClick={() => !disabled && (setV(item.counted_qty ?? ''), setEdit(true))} disabled={disabled}
          style={{ minWidth: 56, padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`, background: item.counted_qty != null ? C.greenL : '#fff', fontSize: 16, fontWeight: 700, color: C.dark }}>
          {item.counted_qty != null ? fmt(item.counted_qty) : '—'}
        </button>
      )}
    </div>
  );
}
