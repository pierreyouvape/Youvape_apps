import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import CameraScanner from './CameraScanner';
import { useScanner, beep } from '../pda/pdaScan';

/*
 * Prélèvements au stock du site (Castelnau, EMC → EMC2).
 * On scanne le produit qu'on prend au site, on valide : il sort du stock du site,
 * entre dans le stock de la boutique dans la caisse, et compte pour la
 * refacturation de fin d'année. Rien ne bloque : si le produit n'est pas dans la
 * caisse, le prélèvement s'enregistre quand même et l'entrée en caisse attend
 * qu'on le rattache ou qu'on le crée.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#135E84', accent: '#E28F00', green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  orange: '#C2410C', orangeL: '#FFEDD5', grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF',
};
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const errMsg = (e) => e?.response?.data?.error || e.message || 'Erreur';
const eur = (n) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthStart = () => `${today().slice(0, 8)}01`;
const fmtDate = (s) => new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const STEP = {
  queued: { label: 'En file', color: C.greyT, bg: C.grey },
  sending: { label: 'En cours', color: C.greyT, bg: C.grey },
  sent: { label: 'Fait', color: C.green, bg: C.greenL },
  error: { label: 'Erreur', color: C.red, bg: C.redL },
  waiting: { label: 'Produit absent de la caisse', color: C.orange, bg: C.orangeL },
  skipped: { label: 'Reprise (déjà vendu)', color: C.greyT, bg: C.grey },
};

function Btn({ children, onClick, disabled, bg = C.primary, small, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.greyB : bg, color: disabled ? C.greyM : '#fff', border: 'none', borderRadius: 10,
      padding: small ? '7px 12px' : '13px 18px', fontSize: small ? 13 : 16, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', ...style,
    }}>{children}</button>
  );
}

function Chip({ status }) {
  const s = STEP[status] || STEP.queued;
  return <span style={{ background: s.bg, color: s.color, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

/* Produit absent de la caisse : le rattacher à une fiche existante, ou la créer. */
export function NotInCaisse({ product, call, onDone, base = '/prelevements', defaultCategory = '', defaultMode = null }) {
  const [mode, setMode] = useState(defaultMode); // 'link' | 'create'
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState(defaultCategory || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mode === 'create' && !cats.length) call.get(`${base}/categories`).then((r) => setCats(r.categories || [])).catch(() => {});
    if (mode === 'link' && !q) setQ(product.name.split(/\s+/).slice(0, 3).join(' '));
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'link' || q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      call.get(`${base}/nextore-search?q=${encodeURIComponent(q)}`).then(setResults).catch((e) => setError(errMsg(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un mauvais rattachement fausse le stock de la caisse : on fait relire les deux noms.
  const linkTo = (nx) => {
    if (!window.confirm(`Rattacher\n« ${product.name} » (site)\nà\n« ${nx.name} » (caisse) ?\n\nCe doit être exactement le même article.`)) return;
    run(() => call.post(`${base}/products/${product.id}/link`, { nxProductId: nx.id }));
  };

  const run = async (fn) => {
    setBusy(true); setError(null);
    try { onDone(await fn()); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.orangeL, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ fontWeight: 700, color: C.orange }}>
        {product.nxHow === 'ambiguous' ? 'Plusieurs produits de la caisse portent ce code-barres' : 'Ce produit n\'est pas dans la caisse'}
      </div>
      <div style={{ fontSize: 13, color: C.dark, margin: '4px 0 10px' }}>
        Vous pouvez valider le prélèvement tout de suite : il sort du stock du site, et entrera dans la caisse dès que le produit y sera.
      </div>
      {product.candidates?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {product.candidates.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ flex: 1 }}>{c.name} <span style={{ color: C.greyT }}>· stock {c.stock ?? 0}</span></span>
              <Btn small disabled={busy} onClick={() => linkTo(c)}>C'est celui-ci</Btn>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn small bg={mode === 'link' ? C.dark : C.primary} onClick={() => setMode('link')}>Il existe sous un autre nom</Btn>
        <Btn small bg={mode === 'create' ? C.dark : C.orange} onClick={() => setMode('create')}>Créer dans la caisse</Btn>
      </div>

      {mode === 'link' && (
        <div style={{ marginTop: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher dans la caisse…"
            style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 15, boxSizing: 'border-box' }} />
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 6 }}>
            {results.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: `1px solid ${C.greyB}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: C.greyT }}>{r.category_name || '—'} · {eur(r.price)} · stock {r.stock ?? 0}</div>
                </div>
                <Btn small disabled={busy} onClick={() => linkTo(r)}>Rattacher</Btn>
              </div>
            ))}
            {q.trim().length >= 2 && !results.length && <div style={{ color: C.greyT, fontSize: 13, padding: 6 }}>Aucun produit trouvé.</div>}
          </div>
          <div style={{ fontSize: 12, color: C.greyT, marginTop: 6 }}>Les codes-barres du site sont ajoutés à la fiche de la caisse : elle reconnaîtra le produit au scan.</div>
        </div>
      )}

      {mode === 'create' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            Fiche créée avec le nom du site, le prix {eur(product.sitePrice)} TTC (prix du site, sans remise), le coût {eur(product.unitCost)} HT
            et {product.barcodes.length ? `ses ${product.barcodes.length} code(s)-barres` : 'le SKU comme code-barres'}.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 15 }}>
              <option value="">Catégorie de la caisse…</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Btn small disabled={!cat || busy} bg={C.orange}
              onClick={() => run(() => call.post(`${base}/products/${product.id}/create-nextore`, { categoryId: cat }))}>
              {busy ? 'Création…' : 'Créer'}
            </Btn>
          </div>
        </div>
      )}
      {error && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

export default function PrelevementsTab({ shop, token }) {
  const base = `${API_URL}/nextore/${shop.slug}`;
  const call = {
    get: (p) => axios.get(`${base}${p}`, auth(token)).then((r) => r.data),
    post: (p, b) => axios.post(`${base}${p}`, b, auth(token)).then((r) => r.data),
  };

  const [scanVal, setScanVal] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [product, setProduct] = useState(null);
  const [choices, setChoices] = useState(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [problems, setProblems] = useState(false);
  const [data, setData] = useState({ rows: [], counts: {} });
  const scanRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await call.get(`/prelevements?from=${from}&to=${to}${problems ? '&problems=1' : ''}`));
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }, [from, to, problems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  // Les écritures partent en arrière-plan : on rafraîchit l'état tant qu'il en reste.
  useEffect(() => {
    const pending = data.rows.some((r) => ['queued', 'sending'].includes(r.site_status) || ['queued', 'sending'].includes(r.nx_status));
    if (!pending) return undefined;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [data, load]);

  const doLookup = async (code) => {
    const q = String(code || '').trim();
    if (!q) return;
    setMsg(null); setChoices(null);
    try {
      const r = await call.get(`/prelevements/lookup?q=${encodeURIComponent(q)}`);
      if (r.product) { setProduct(r.product); setQty(r.qty || 1); beep(true); }
      else if (r.results.length) { setProduct(null); setChoices(r.results); }
      else { setProduct(null); beep(false); setMsg({ ok: false, text: `Aucun produit du site pour « ${q} ».` }); }
    } catch (e) { beep(false); setMsg({ ok: false, text: errMsg(e) }); }
  };

  const pick = async (id) => {
    setChoices(null);
    try {
      setProduct(await call.get(`/prelevements/products/${id}`)); setQty(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  useScanner((code) => doLookup(code), !cameraOpen);

  const submit = async () => {
    setBusy(true);
    try {
      await call.post('/prelevements', { productId: product.id, qty });
      setMsg({ ok: true, text: `${qty} × ${product.name} prélevé${qty > 1 ? 's' : ''}.` });
      setProduct(null); setQty(1);
      load();
      scanRef.current?.blur();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };

  const resolve = async (row, step, action) => {
    const what = step === 'site' ? 'la sortie du stock du site' : 'l\'entrée dans la caisse';
    const question = action === 'retry'
      ? `Renvoyer ${what} ?${/VÉRIFIEZ/.test(row[`${step}_error`] || '') ? '\n\nVérifiez d\'abord qu\'elle n\'est pas déjà passée.' : ''}`
      : `Déclarer ${what} comme faite à la main ?`;
    if (!window.confirm(question)) return;
    try { await call.post(`/prelevements/${row.id}/resolve`, { step, action }); load(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  const exportCsv = async () => {
    try {
      const r = await axios.get(`${base}/prelevements/export?from=${from}&to=${to}`, { ...auth(token), responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `prelevements-emc-emc2-${from}-${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  // Stock illisible (panne BMS) : on ne bloque pas.
  const unavailable = !!product?.siteStock && !product.siteStock.error && product.siteStock.free < qty;
  const { counts = {} } = data;
  const totalHt = data.rows.reduce((s, r) => s + r.qty * Number(r.unit_cost_ht || 0), 0);
  const missingCost = data.rows.filter((r) => r.unit_cost_ht == null).length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {cameraOpen && <CameraScanner onDetect={(code) => { setCameraOpen(false); doLookup(code); }} onClose={() => setCameraOpen(false)} />}

      {/* ── Scan ── */}
      <div style={{ background: C.white, borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Pas d'autoFocus : sur le PDA il ouvre le clavier tactile. La douchette
              est écoutée sur toute la page (useScanner), le champ sert à chercher. */}
          <input ref={scanRef} value={scanVal} onChange={(e) => setScanVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(scanVal); setScanVal(''); } }}
            placeholder="Scannez le produit pris au site, ou cherchez-le…"
            style={{ flex: 1, padding: 13, fontSize: 16, borderRadius: 10, border: `1px solid ${C.greyB}`, minWidth: 0 }} />
          <Btn bg={C.dark} onClick={() => setCameraOpen(true)}>Caméra</Btn>
        </div>
        {msg && <div style={{ marginTop: 10, color: msg.ok ? C.green : C.red, fontWeight: 600 }}>{msg.text}</div>}

        {choices && (
          <div style={{ marginTop: 10 }}>
            {choices.map((c) => (
              <div key={c.id} onClick={() => pick(c.id)} style={{ padding: '9px 6px', borderBottom: `1px solid ${C.greyB}`, cursor: 'pointer' }}>
                <b>{c.name}</b> <span style={{ color: C.greyT, fontSize: 13 }}>· {c.sku}</span>
              </div>
            ))}
          </div>
        )}

        {product && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {product.imageUrl && <img src={product.imageUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 8, background: C.grey }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{product.name}</div>
                <div style={{ fontSize: 13, color: C.greyT }}>SKU {product.sku} · coût site {eur(product.unitCost)} HT</div>
                {product.siteStock && !product.siteStock.error && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Stock du site : <b style={{ color: product.siteStock.free > 0 ? C.green : C.red }}>{product.siteStock.free} disponible{product.siteStock.free > 1 ? 's' : ''}</b>
                    <span style={{ color: C.greyT }}>
                      {' '}· {product.siteStock.physical} en rayon
                      {product.siteStock.reserved > 0 && ` · ${product.siteStock.reserved} réservé${product.siteStock.reserved > 1 ? 's' : ''} commandes internet`}
                      {product.siteStock.pending > 0 && ` · ${product.siteStock.pending} déjà prélevé${product.siteStock.pending > 1 ? 's' : ''} (en cours)`}
                    </span>
                  </div>
                )}
                {product.siteStock?.error && (
                  <div style={{ fontSize: 13, marginTop: 4, color: C.greyT }}>Stock du site illisible pour l'instant : le prélèvement reste possible.</div>
                )}
                {product.nx && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Caisse Castelnau : <b>{product.nx.name}</b> · stock {product.nx.stock ?? 0}
                    {product.nx.perSiteUnit > 1 && <span style={{ color: C.orange }}> · 1 pièce site = {product.nx.perSiteUnit} pièces boutique</span>}
                    {product.nx.how === 'manual' && (
                      <button onClick={async () => {
                        if (!window.confirm(`« ${product.name} » n'est PAS « ${product.nx.name} » ?\n\nLe rattachement est défait et ses codes-barres retirés de la fiche caisse.`)) return;
                        try { await call.post(`/prelevements/products/${product.id}/unlink`, {}); pick(product.id); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
                      }} style={{ marginLeft: 8, background: 'none', border: 'none', color: C.red, textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>
                        Pas le bon produit caisse
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {product.recent?.length > 0 && (
              <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: 12, padding: '10px 14px', marginTop: 12, fontSize: 14 }}>
                <b>Déjà sorti du site par quelqu'un d'autre dans les 2 dernières heures :</b>{' '}
                {product.recent.map((r) => `${r.qty} pièce${r.qty > 1 ? 's' : ''} par ${r.user_name || '—'} le ${fmtDate(r.created_at)}`).join(' · ')}.
                {' '}Vérifiez que ce n'est pas la même pièce avant de valider.
              </div>
            )}
            {!product.nx && <NotInCaisse product={product} call={call} onDone={(r) => { setProduct(r.product); load(); }} />}
            {unavailable && (
              <div style={{ background: C.redL, color: C.red, borderRadius: 12, padding: '10px 14px', marginTop: 12, fontWeight: 700 }}>
                Non disponible : {product.siteStock.free > 0
                  ? `seulement ${product.siteStock.free} pièce${product.siteStock.free > 1 ? 's' : ''} libre${product.siteStock.free > 1 ? 's' : ''} au site.`
                  : 'plus aucune pièce libre au site.'}
                {product.siteStock.reserved > 0 && ' Le reste est réservé pour des commandes internet en cours : ne le prenez pas.'}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <Btn bg={C.greyT} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Btn>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ width: 70, textAlign: 'center', fontSize: 20, fontWeight: 700, padding: 10, borderRadius: 10, border: `1px solid ${C.greyB}` }} />
              <Btn bg={C.greyT} onClick={() => setQty((q) => q + 1)}>+</Btn>
              <Btn disabled={busy || unavailable} bg={C.green} onClick={submit} style={{ flex: 1 }}>
                {busy ? 'Enregistrement…' : unavailable ? 'Non disponible' : 'Valider le prélèvement'}
              </Btn>
              <Btn bg={C.greyM} onClick={() => setProduct(null)}>Annuler</Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── À traiter ── */}
      {(counts.site_errors > 0 || counts.nx_errors > 0 || counts.nx_waiting > 0) && (
        <div style={{ background: C.orangeL, color: C.orange, borderRadius: 12, padding: '10px 14px', marginTop: 16, fontWeight: 600, cursor: 'pointer' }}
          onClick={() => setProblems(true)}>
          À traiter : {[
            counts.nx_waiting > 0 && `${counts.nx_waiting} prélèvement(s) de ${counts.nx_waiting_products} produit(s) absent(s) de la caisse`,
            counts.site_errors > 0 && `${counts.site_errors} sortie(s) du site en erreur`,
            counts.nx_errors > 0 && `${counts.nx_errors} entrée(s) en caisse en erreur`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* ── Historique ── */}
      <div style={{ background: C.white, borderRadius: 14, padding: 16, marginTop: 16, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <b style={{ marginRight: 'auto' }}>Prélèvements</b>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} /> À traiter seulement</label>
          <Btn small onClick={exportCsv}>Export refacturation</Btn>
        </div>
        <div style={{ fontSize: 13, color: C.greyT, marginBottom: 8 }}>
          {data.rows.length} ligne(s) · {data.rows.reduce((s, r) => s + r.qty, 0)} pièce(s) · {eur(totalHt)} HT au coût du site
          {missingCost > 0 && <span style={{ color: C.red }}> · {missingCost} sans coût d'achat</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.greyT, fontSize: 12 }}>
                <th style={{ padding: 6 }}>Date</th><th style={{ padding: 6 }}>Produit</th><th style={{ padding: 6 }}>Qté</th>
                <th style={{ padding: 6 }}>Coût HT</th><th style={{ padding: 6 }}>Sortie site</th><th style={{ padding: 6 }}>Entrée caisse</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.greyB}`, verticalAlign: 'top' }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}<div style={{ fontSize: 11, color: C.greyT }}>{r.origin === 'pda' ? 'Ancien « Vente boutique »' : 'Prélèvement'} · {r.user_name || '—'}</div></td>
                  <td style={{ padding: 6 }}>{r.name}<div style={{ fontSize: 11, color: C.greyT }}>{r.sku}{r.nx_name ? ` → ${r.nx_name}` : ''}</div></td>
                  <td style={{ padding: 6 }}>{r.qty}{r.nx_qty && Number(r.nx_qty) !== r.qty ? <div style={{ fontSize: 11, color: C.orange }}>{Number(r.nx_qty)} en caisse</div> : null}</td>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{r.unit_cost_ht == null ? <span style={{ color: C.red }}>inconnu</span> : eur(r.qty * Number(r.unit_cost_ht))}</td>
                  {['site', 'nx'].map((step) => (
                    <td key={step} style={{ padding: 6, maxWidth: 240 }}>
                      <Chip status={r[`${step}_status`]} />
                      {r[`${step}_error`] && <div style={{ fontSize: 11, color: C.red, marginTop: 3 }}>{r[`${step}_error`]}</div>}
                      {r[`${step}_status`] === 'error' && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <Btn small onClick={() => resolve(r, step, 'retry')}>Réessayer</Btn>
                          <Btn small bg={C.greyT} onClick={() => resolve(r, step, 'done')}>Fait à la main</Btn>
                        </div>
                      )}
                      {step === 'nx' && r.nx_status === 'waiting' && (
                        <div style={{ marginTop: 4 }}><Btn small bg={C.orange} onClick={() => pick(r.product_id)}>Mettre en caisse</Btn></div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
