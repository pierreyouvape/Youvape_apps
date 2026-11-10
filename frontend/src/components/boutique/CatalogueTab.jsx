import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { NotInCaisse } from './PrelevementsTab';

/*
 * Catalogue caisse : ce que la synchro produits du site → Nextore n'a pas pu
 * décider seule (nextoreCatalogSyncService, toutes les heures). Rattacher ou
 * créer referme la ligne ; le prix s'aligne ou se garde.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
const C = {
  primary: '#135E84', green: '#16A34A', red: '#DC2626', redL: '#FEE2E2', orange: '#C2410C', orangeL: '#FFEDD5',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4', dark: '#111827', white: '#FFFFFF',
};
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const errMsg = (e) => e?.response?.data?.error || e.message || 'Erreur';
const eur = (n) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

const REASONS = [
  { key: 'doublon', label: 'Doublons possibles', hint: 'Nouveau produit : une fiche caisse au nom proche existe déjà. Même article ? Rattachez. Sinon, créez.' },
  { key: 'categorie', label: 'Catégorie à choisir', hint: 'Nouveau produit : la catégorie caisse n\'est pas sûre. Vérifiez-la puis créez.' },
  { key: 'sans_ean', label: 'Sans code-barres', hint: 'Nouveau produit sans code-barres sur le site : ajoutez-le (réception, PDA) ou créez la fiche (le SKU servira de code).' },
  { key: 'ean_multiple', label: 'Code-barres sur plusieurs fiches', hint: 'Un code-barres du site est porté par plusieurs fiches caisse : choisissez la bonne.' },
  { key: 'ean_conflit', label: 'Code-barres en conflit', hint: 'Un code-barres du site est déjà sur une AUTRE fiche caisse. À corriger dans Nextore (doublon ou code recyclé).' },
  { key: 'prix', label: 'Prix différents', hint: 'Prix caisse ≠ prix normal du site. « Aligner » met le prix du site ; « Garder » fige le prix caisse (plus aligné ensuite).' },
  { key: 'absent', label: 'Existants absents de la caisse', hint: 'Produits en stock au site, introuvables dans la caisse. Rien n\'est créé seul : rattachez ou créez au fil de l\'eau.' },
];

function Btn({ children, onClick, disabled, bg = C.primary, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.greyB : bg, color: disabled ? C.greyM : '#fff', border: 'none', borderRadius: 8,
      padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', ...style,
    }}>{children}</button>
  );
}

/* Une ligne à traiter (hors prix) : fiches proches en un clic, sinon rattacher / créer. */
function ReviewRow({ row, call, onDone }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);

  const expand = async () => {
    setOpen((o) => !o);
    if (!product) {
      try { setProduct(await call.get(`/catalogue/products/${row.product_id}`)); } catch (e) { setError(errMsg(e)); }
    }
  };
  const linkTo = async (nx) => {
    if (!window.confirm(`Rattacher\n« ${row.name} » (site)\nà\n« ${nx.name} » (caisse) ?\n\nCe doit être exactement le même article.`)) return;
    try { await call.post(`/catalogue/products/${row.product_id}/link`, { nxProductId: nx.id }); onDone(); } catch (e) { setError(errMsg(e)); }
  };
  const ignore = async () => {
    try { await call.post(`/catalogue/reviews/${row.id}/ignore`); onDone(); } catch (e) { setError(errMsg(e)); }
  };
  const candidates = (row.candidates || []).filter((c) => c.name);

  return (
    <div style={{ borderTop: `1px solid ${C.greyB}`, padding: '10px 4px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {row.image_url && <img src={row.image_url} alt="" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6, background: C.grey }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{row.name}</div>
          <div style={{ fontSize: 12, color: C.greyT }}>
            {row.sku} · {row.brand || '—'} · {eur(row.regular_price)} · stock site {row.stock}
            {row.suggested_category && ` · catégorie proposée : ${row.suggested_category}`}
          </div>
          {row.reason === 'ean_conflit' && row.detail && (
            <div style={{ fontSize: 12, color: C.red }}>
              Code(s) {row.detail.barcodes?.join(', ')} déjà sur la fiche caisse n° {row.detail.owners?.flat().join(', ')}
              {row.nx_name ? ` (fiche liée : ${row.nx_name})` : ''}
            </div>
          )}
        </div>
        {row.reason !== 'ean_conflit' && <Btn onClick={expand}>{open ? 'Fermer' : 'Traiter'}</Btn>}
        <Btn bg={C.greyT} onClick={ignore}>Ignorer</Btn>
      </div>

      {candidates.length > 0 && (
        <div style={{ margin: '8px 0 0 54px' }}>
          {candidates.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 13 }}>
              <span style={{ flex: 1 }}>
                {c.name}{' '}
                {c.same
                  ? <span style={{ color: C.green, fontWeight: 700 }}>· nom identique</span>
                  : c.score != null && <span style={{ color: C.greyT }}>· ressemblance {Math.round(c.score * 100)} %</span>}
              </span>
              <Btn onClick={() => linkTo(c)}>C'est le même</Btn>
            </div>
          ))}
        </div>
      )}

      {open && product && (
        <div style={{ marginLeft: 54 }}>
          {product.nx
            ? <div style={{ fontSize: 13, color: C.green, marginTop: 8 }}>Déjà dans la caisse : {product.nx.name}. <Btn bg={C.greyT} onClick={ignore}>Marquer réglé</Btn></div>
            : <NotInCaisse product={product} call={call} base="/catalogue" defaultCategory={row.suggested_category_id || ''}
                defaultMode={row.reason === 'categorie' || row.reason === 'sans_ean' ? 'create' : null} onDone={onDone} />}
        </div>
      )}
      {error && <div style={{ color: C.red, fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/* Prix différents : cases à cocher, aligner ou garder. */
function PriceRows({ rows, call, onDone }) {
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const chosen = Object.keys(sel).filter((k) => sel[k]).map(Number);

  const act = async (kind, list) => {
    if (!list.length) return;
    const what = kind === 'align' ? 'Mettre le prix du site sur' : 'Garder le prix caisse (plus aligné ensuite) pour';
    if (!window.confirm(`${what} ${list.length} produit(s) ?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await call.post(`/catalogue/prices/${kind === 'align' ? 'align' : 'keep'}`, { ids: list });
      setMsg(`${r.done} fait(s)${r.errors?.length ? ` · ${r.errors.length} erreur(s) : ${r.errors.slice(0, 3).join(' ; ')}` : ''}`);
      setSel({}); onDone();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 10px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={rows.length > 0 && chosen.length === rows.length}
            onChange={(e) => setSel(e.target.checked ? Object.fromEntries(rows.map((r) => [r.id, true])) : {})} /> Tout cocher
        </label>
        <Btn disabled={busy || !chosen.length} bg={C.green} onClick={() => act('align', chosen)}>Aligner la sélection ({chosen.length})</Btn>
        <Btn disabled={busy || !chosen.length} bg={C.greyT} onClick={() => act('keep', chosen)}>Garder le prix caisse ({chosen.length})</Btn>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: C.greyT, fontSize: 12 }}>
            <th /><th style={{ padding: 6 }}>Produit du site</th><th style={{ padding: 6 }}>Fiche caisse</th>
            <th style={{ padding: 6 }}>Site</th><th style={{ padding: 6 }}>Caisse</th><th style={{ padding: 6 }}>Écart</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gap = Number(r.detail?.ecart_pct);
            const suspect = Math.abs(gap) >= 40;
            return (
              <tr key={r.id} style={{ borderTop: `1px solid ${C.greyB}` }}>
                <td style={{ padding: 6 }}><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} /></td>
                <td style={{ padding: 6 }}>{r.name}<div style={{ fontSize: 11, color: C.greyT }}>{r.sku}</div></td>
                <td style={{ padding: 6 }}>{r.nx_name}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{eur(r.regular_price)}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{eur(r.nx_price)}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap', color: suspect ? C.red : C.dark, fontWeight: suspect ? 700 : 400 }}>
                  {gap > 0 ? '+' : ''}{gap} %{suspect && <div style={{ fontSize: 11 }}>même article ?</div>}
                </td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                  <Btn bg={C.green} disabled={busy} onClick={() => act('align', [r.id])}>Aligner</Btn>{' '}
                  <Btn bg={C.greyT} disabled={busy} onClick={() => act('keep', [r.id])}>Garder</Btn>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function CatalogueTab({ shop, token }) {
  const base = `${API_URL}/nextore/${shop.slug}`;
  const call = {
    get: (p) => axios.get(`${base}${p}`, auth(token)).then((r) => r.data),
    post: (p, b) => axios.post(`${base}${p}`, b, auth(token)).then((r) => r.data),
  };
  const [reason, setReason] = useState('doublon');
  const [q, setQ] = useState('');
  const [onlySame, setOnlySame] = useState(false);
  const [data, setData] = useState({ rows: [], counts: {} });
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await call.get(`/catalogue/reviews?reason=${reason}&q=${encodeURIComponent(q)}${onlySame ? '&same=1' : ''}`));
      setError(null);
    } catch (e) { setError(errMsg(e)); }
  }, [reason, q, onlySame]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const runNow = async () => {
    setRunning(true); setReport(null);
    try {
      const r = await call.post('/catalogue/run', {});
      setReport(r.disabled ? 'La synchro automatique n\'est pas encore activée.'
        : `${r.created} fiche(s) créée(s) · ${r.barcodes} code(s)-barres ajouté(s) · ${r.prices} prix alignés · ${r.reviews} à vérifier${r.errors?.length ? ` · ${r.errors.length} erreur(s)` : ''}`);
      load();
    } catch (e) { setReport(errMsg(e)); } finally { setRunning(false); }
  };

  // Lignes dont UNE fiche caisse porte exactement le même nom : rattachables d'un coup.
  const sameRows = (reason === 'doublon' || reason === 'absent')
    ? data.rows.filter((r) => (r.candidates || []).filter((c) => c.same).length === 1) : [];
  const linkAllSame = async () => {
    const lines = sameRows.slice(0, 15).map((r) => `• ${r.name}  →  ${r.candidates.find((c) => c.same).name}`).join('\n');
    if (!window.confirm(`Rattacher ${sameRows.length} produit(s) à la fiche caisse au nom identique ?\n\n${lines}${sameRows.length > 15 ? '\n…' : ''}\n\nLes codes-barres du site seront ajoutés aux fiches.`)) return;
    setRunning(true); setReport(null);
    try {
      const r = await call.post('/catalogue/link-same', { ids: sameRows.map((x) => x.id) });
      setReport(`${r.done} rattaché(s)${r.errors?.length ? ` · ${r.errors.length} erreur(s) : ${r.errors.slice(0, 3).join(' ; ')}` : ''}`);
      load();
    } catch (e) { setReport(errMsg(e)); } finally { setRunning(false); }
  };

  const def = REASONS.find((r) => r.key === reason);
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {REASONS.map((r) => (
          <button key={r.key} onClick={() => setReason(r.key)} style={{
            border: `1px solid ${reason === r.key ? C.primary : C.greyB}`, background: reason === r.key ? C.primary : C.white,
            color: reason === r.key ? '#fff' : C.dark, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{r.label} <b>{data.counts[r.key] || 0}</b></button>
        ))}
        <Btn disabled={running} bg={C.dark} style={{ marginLeft: 'auto' }} onClick={runNow}>{running ? 'Synchro…' : 'Lancer la synchro'}</Btn>
      </div>
      {report && <div style={{ fontSize: 13, marginBottom: 10 }}>{report}</div>}

      <div style={{ background: C.white, borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 13, color: C.greyT, marginBottom: 8 }}>{def.hint}</div>
        {sameRows.length > 0 && (
          <div style={{ background: '#ECFDF5', borderRadius: 10, padding: '8px 12px', marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 13 }}>{sameRows.length} produit(s) affiché(s) ont une fiche caisse au <b>nom identique</b> (mêmes mots, hors marque).</span>
            <Btn bg={C.green} disabled={running} onClick={linkAllSame}>Rattacher les {sameRows.length}</Btn>
          </div>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer (nom, SKU, marque)…"
          style={{ width: '100%', padding: 9, borderRadius: 8, border: `1px solid ${C.greyB}`, fontSize: 14, boxSizing: 'border-box', marginBottom: 6 }} />
        {(reason === 'doublon' || reason === 'absent') && (
          <label style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
            <input type="checkbox" checked={onlySame} onChange={(e) => setOnlySame(e.target.checked)} /> Seulement ceux qui ont une fiche caisse au nom identique
          </label>
        )}
        {error && <div style={{ color: C.red }}>{error}</div>}
        {reason === 'prix'
          ? <PriceRows rows={data.rows} call={call} onDone={load} />
          : data.rows.map((row) => <ReviewRow key={row.id} row={row} call={call} onDone={load} />)}
        {!data.rows.length && <div style={{ color: C.greyT, padding: 10 }}>Rien à vérifier ici.</div>}
        {data.rows.length >= 100 && <div style={{ color: C.greyT, fontSize: 12, paddingTop: 8 }}>100 premières lignes : filtrez pour voir les autres.</div>}
      </div>
    </div>
  );
}
