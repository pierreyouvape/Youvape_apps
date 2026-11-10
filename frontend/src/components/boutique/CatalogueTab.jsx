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
  { key: 'absent', label: 'Existants absents de la caisse', hint: 'Produits en stock au site, introuvables dans la caisse. Rattachez ce qui existe, puis « Créer tous » pour le reste (les résistances au pack sont laissées de côté).' },
  { key: 'labels', label: 'Étiquettes à refaire', hint: 'Prix changés dans la caisse par l\'app : refaites l\'étiquette en rayon, puis cochez « Fait ». Chaque boutique coche les siennes.' },
];

const fmtDate = (s) => new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* Tri par colonne : un clic trie, un second inverse. `get` lit la valeur d'une ligne. */
const useSort = (initial) => {
  const [sort, setSort] = useState(initial); // { key, dir: 1 | -1 }
  const toggle = (key, firstDir = 1) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: firstDir }));
  const apply = (rows, getters) => {
    const get = getters[sort.key];
    if (!get) return rows;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;   // vides toujours en bas
      if (y == null) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * sort.dir;
    });
  };
  return { sort, toggle, apply };
};

function Th({ label, k, sorter, firstDir = 1 }) {
  const on = sorter.sort.key === k;
  return (
    <th onClick={() => sorter.toggle(k, firstDir)} style={{ padding: 6, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: on ? C.primary : C.greyT }}>
      {label}{on ? (sorter.sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

/* Étiquettes de prix à refaire dans CETTE boutique. */
function LabelRows({ shop, call, onCount }) {
  const [data, setData] = useState({ rows: [], counts: {} });
  const [showAll, setShowAll] = useState(false);
  const [sel, setSel] = useState({});
  const [msg, setMsg] = useState(null);
  const col = shop.id === 1 ? 'done_mtp_at' : 'done_cast_at';

  const load = useCallback(async () => {
    try {
      const d = await call.get(`/catalogue/labels${showAll ? '?all=1' : ''}`);
      setData(d); onCount(shop.id === 1 ? d.counts.mtp : d.counts.cast);
    } catch (e) { setMsg(errMsg(e)); }
  }, [showAll]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // Par défaut : ce qui est en stock dans la boutique d'abord (les étiquettes à refaire en premier).
  const sorter = useSort({ key: 'stock', dir: -1 });
  const rows = sorter.apply(data.rows, {
    name: (r) => r.nx_name || r.name,
    category: (r) => r.category,
    old: (r) => (r.old_price == null ? null : Number(r.old_price)),
    new: (r) => Number(r.new_price),
    diff: (r) => (r.old_price == null ? null : Number(r.new_price) - Number(r.old_price)),
    stock: (r) => Number(r.shop_stock || 0),
    date: (r) => new Date(r.changed_at).getTime(),
  });
  const revert = async (r) => {
    if (!window.confirm(`Remettre « ${r.nx_name || r.name} » à ${eur(r.old_price)} dans la caisse (au lieu de ${eur(r.new_price)}) ?\n\nLe prix de ce produit ne sera plus aligné sur le site ensuite.`)) return;
    try { await call.post(`/catalogue/labels/${r.id}/revert`, {}); setMsg(null); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  const [busy, setBusy] = useState(false);
  // Plusieurs lignes cochées : retour à l'ancien prix pour chacune (celles qui le permettent).
  const revertMany = async (ids) => {
    const list = data.rows.filter((r) => ids.includes(r.id) && !r.reverted_at && r.old_price != null && r.source !== 'reverted');
    if (!list.length) { setMsg('Aucune ligne cochée ne peut revenir à son ancien prix.'); return; }
    const preview = list.slice(0, 12).map((r) => `• ${r.nx_name || r.name} : ${eur(r.new_price)} → ${eur(r.old_price)}`).join('\n');
    if (!window.confirm(`Remettre l'ancien prix dans la caisse pour ${list.length} produit(s) ?\n\n${preview}${list.length > 12 ? '\n…' : ''}\n\nLeur prix ne sera plus aligné sur le site ensuite.`)) return;
    setBusy(true); setMsg(null);
    let ok = 0;
    const errors = [];
    for (const r of list) {
      try { await call.post(`/catalogue/labels/${r.id}/revert`, {}); ok += 1; } catch (e) { errors.push(`${r.nx_name || r.name} : ${errMsg(e)}`); }
    }
    setMsg(`${ok} produit(s) revenu(s) à l'ancien prix${errors.length ? ` · ${errors.length} refusé(s) : ${errors.slice(0, 3).join(' ; ')}` : ''}`);
    setSel({}); setBusy(false); load();
  };
  const chosen = Object.keys(sel).filter((k) => sel[k]).map(Number);
  const mark = async (list, done = true) => {
    if (!list.length) return;
    try { await call.post('/catalogue/labels/done', { ids: list, done }); setSel({}); load(); } catch (e) { setMsg(errMsg(e)); }
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 10px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={data.rows.length > 0 && chosen.length === data.rows.length}
            onChange={(e) => setSel(e.target.checked ? Object.fromEntries(data.rows.map((r) => [r.id, true])) : {})} /> Tout cocher
        </label>
        <Btn bg={C.green} disabled={!chosen.length || busy} onClick={() => mark(chosen)}>Étiquettes faites ({chosen.length})</Btn>
        <Btn bg={C.orange} disabled={!chosen.length || busy} onClick={() => revertMany(chosen)}>{busy ? 'En cours…' : `Ancien prix (${chosen.length})`}</Btn>
        <Btn bg={C.greyT} onClick={() => window.print()}>Imprimer la liste</Btn>
        <label style={{ fontSize: 13, marginLeft: 'auto' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Voir aussi celles déjà faites
        </label>
        {msg && <span style={{ color: C.dark, fontSize: 13 }}>{msg}</span>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: C.greyT, fontSize: 12 }}>
            <th />
            <Th label="Produit (caisse)" k="name" sorter={sorter} />
            <Th label="Catégorie" k="category" sorter={sorter} />
            <Th label="Ancien prix" k="old" sorter={sorter} firstDir={-1} />
            <Th label="Nouveau prix" k="new" sorter={sorter} firstDir={-1} />
            <Th label="Écart" k="diff" sorter={sorter} firstDir={-1} />
            <Th label={`Stock ${shop.label}`} k="stock" sorter={sorter} firstDir={-1} />
            <Th label="Changé le" k="date" sorter={sorter} firstDir={-1} />
            <th style={{ padding: 6 }}>Étiquette</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: `1px solid ${C.greyB}` }}>
              <td style={{ padding: 6 }}><input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} /></td>
              <td style={{ padding: 6 }}>{r.nx_name || r.name}<div style={{ fontSize: 11, color: C.greyT }}>{r.sku}</div></td>
              <td style={{ padding: 6, fontSize: 12 }}>{r.category || '—'}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap', color: C.greyT, textDecoration: 'line-through' }}>{eur(r.old_price)}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap', fontWeight: 700 }}>{eur(r.new_price)}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap', fontSize: 12, color: r.old_price == null ? C.greyT : Number(r.new_price) > Number(r.old_price) ? C.red : C.green }}>
                {r.old_price == null ? '—' : `${Number(r.new_price) > Number(r.old_price) ? '+' : ''}${eur(Number(r.new_price) - Number(r.old_price))}`}
              </td>
              <td style={{ padding: 6, fontWeight: Number(r.shop_stock) > 0 ? 700 : 400, color: Number(r.shop_stock) > 0 ? C.dark : C.greyM }}>{r.shop_stock ?? 0}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(r.changed_at)}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                {r.reverted_at
                  ? <span style={{ color: C.greyT, fontSize: 12 }}>Revenu à l'ancien prix</span>
                  : r[col]
                    ? <span style={{ color: C.green, fontSize: 12 }}>Faite <Btn bg={C.greyM} onClick={() => mark([r.id], false)}>Annuler</Btn></span>
                    : <Btn bg={C.green} onClick={() => mark([r.id])}>Fait</Btn>}
                {!r.reverted_at && r.old_price != null && r.source !== 'reverted' && (
                  <>{' '}<Btn bg={C.orange} onClick={() => revert(r)} style={{ marginTop: 4 }}>Ancien prix</Btn></>
                )}
                {r.source === 'reverted' && <div style={{ fontSize: 11, color: C.orange }}>retour à l'ancien prix</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <div style={{ color: C.greyT, padding: 10 }}>Aucune étiquette à refaire.</div>}
    </>
  );
}

/* Existants sans catégorie caisse : une catégorie par groupe (sous-catégorie du site). */
function Uncategorized({ call, onDone }) {
  const [data, setData] = useState({ groups: [], categories: [] });
  const [pick, setPick] = useState({});
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    try { setData(await call.get('/catalogue/uncategorized')); } catch (e) { setMsg(errMsg(e)); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  if (!data.groups.length) return null;
  const key = (g) => `${g.cat}|${g.sub}`;
  const apply = async (g) => {
    try {
      const r = await call.post('/catalogue/uncategorized', { cat: g.cat, sub: g.sub, categoryId: pick[key(g)] });
      setMsg(`${r.updated} produit(s) classé(s) : « Créer tous » les créera.`);
      load(); onDone();
    } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div style={{ border: `1px solid ${C.greyB}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Sans catégorie caisse ({data.groups.reduce((s, g) => s + g.n, 0)})</div>
      <div style={{ fontSize: 12, color: C.greyT, marginBottom: 6 }}>
        Aucun produit de ces groupes n'est encore en caisse : la catégorie ne peut pas être devinée. Choisissez-la une fois par groupe.
      </div>
      {data.groups.map((g) => (
        <div key={key(g)} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: `1px solid ${C.greyB}`, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{g.sub || g.cat || 'Sans catégorie site'}</b> <span style={{ color: C.greyT }}>· {g.n} produit(s)</span>
            <div style={{ fontSize: 11, color: C.greyT }}>{(g.examples || []).join(' · ')}</div>
          </div>
          <select value={pick[key(g)] || ''} onChange={(e) => setPick((p) => ({ ...p, [key(g)]: e.target.value }))}
            style={{ padding: 7, borderRadius: 8, border: `1px solid ${C.greyB}` }}>
            <option value="">Catégorie caisse…</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Btn disabled={!pick[key(g)]} onClick={() => apply(g)}>Appliquer</Btn>
        </div>
      ))}
      {msg && <div style={{ fontSize: 13, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

/* « Créer tous » : création en masse des existants absents (tâche de fond). */
function CreateAll({ call, onDone }) {
  const [st, setSt] = useState(null);
  const poll = useCallback(async () => {
    try { setSt(await call.get('/catalogue/create-all')); } catch { /* rien */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    if (!st?.running) return undefined;
    const t = setTimeout(() => { poll(); onDone(); }, 5000);
    return () => clearTimeout(t);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    if (!window.confirm('Créer dans la caisse tous les produits de cette liste qui ont une catégorie proposée ?\n\nLes résistances au pack et ceux sans catégorie restent dans la liste. Une fiche est créée toutes les quelques secondes.')) return;
    try { setSt(await call.post('/catalogue/create-all', {})); } catch (e) { setSt({ errors: [errMsg(e)] }); }
  };
  return (
    <div style={{ background: C.orangeL, borderRadius: 10, padding: '8px 12px', marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1, fontSize: 13 }}>
        {st?.running
          ? <>Création en cours : <b>{st.created} / {st.total}</b>{st.errorCount ? ` · ${st.errorCount} erreur(s)` : ''}</>
          : st?.finishedAt
            ? <>Dernière création en masse : {st.created} / {st.total} fiche(s){st.errorCount ? ` · ${st.errorCount} erreur(s) : ${st.errors.slice(-3).join(' ; ')}` : ''}</>
            : 'Tout ce qui reste ici n\'est pas dans la caisse.'}
      </span>
      {!st?.running && <Btn bg={C.orange} onClick={start}>Créer tous dans la caisse</Btn>}
    </div>
  );
}

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
function PriceRows({ rows: raw, call, onDone, shop }) {
  const [sel, setSel] = useState({});
  const stockOf = (r) => Number((shop.id === 1 ? r.mtp_stock : r.cast_stock) || 0);
  const sorter = useSort({ key: 'gap', dir: -1 });
  const rows = sorter.apply(raw, {
    name: (r) => r.name,
    site: (r) => Number(r.regular_price),
    caisse: (r) => Number(r.nx_price),
    gap: (r) => Math.abs(Number(r.detail?.ecart_pct)),
    stock: stockOf,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const chosen = Object.keys(sel).filter((k) => sel[k]).map(Number);

  // Mauvais rattachement : on le défait (codes-barres retirés de la fiche caisse).
  const notSame = async (r) => {
    if (!window.confirm(`« ${r.name} » (site) n'est PAS « ${r.nx_name} » (caisse) ?\n\nLe rattachement est défait, ses codes-barres retirés de la fiche caisse, et le produit revient dans « Existants absents » pour être rattaché à la bonne fiche ou créé.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await call.post(`/catalogue/products/${r.product_id}/unlink`, {});
      setMsg(`Défait${res.removedBarcodes?.length ? ` · ${res.removedBarcodes.length} code(s)-barres retiré(s) de « ${res.nxName} »` : ''}`);
      onDone();
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

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
            <th />
            <Th label="Produit du site" k="name" sorter={sorter} />
            <th style={{ padding: 6 }}>Fiche caisse</th>
            <Th label="Site" k="site" sorter={sorter} firstDir={-1} />
            <Th label="Caisse" k="caisse" sorter={sorter} firstDir={-1} />
            <Th label="Écart" k="gap" sorter={sorter} firstDir={-1} />
            <Th label={`Stock ${shop.label}`} k="stock" sorter={sorter} firstDir={-1} />
            <th />
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
                <td style={{ padding: 6, fontWeight: stockOf(r) > 0 ? 700 : 400, color: stockOf(r) > 0 ? C.dark : C.greyM }}>{stockOf(r)}</td>
                <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                  <Btn bg={C.green} disabled={busy} onClick={() => act('align', [r.id])}>Aligner</Btn>{' '}
                  <Btn bg={C.greyT} disabled={busy} onClick={() => act('keep', [r.id])}>Garder</Btn>{' '}
                  <Btn bg={C.red} disabled={busy} onClick={() => notSame(r)}>Pas le même</Btn>
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
  const [onlyNear, setOnlyNear] = useState(false);
  const [data, setData] = useState({ rows: [], counts: {} });
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);

  const [labelCount, setLabelCount] = useState(0);
  const load = useCallback(async () => {
    if (reason === 'labels') return;
    try {
      setData(await call.get(`/catalogue/reviews?reason=${reason}&q=${encodeURIComponent(q)}${onlySame ? '&same=1' : ''}${onlyNear ? '&near=1' : ''}`));
      setError(null);
    } catch (e) { setError(errMsg(e)); }
  }, [reason, q, onlySame, onlyNear]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  // Compteur de l'onglet Étiquettes dès l'ouverture de l'écran.
  useEffect(() => {
    call.get('/catalogue/labels').then((d) => setLabelCount(shop.id === 1 ? d.counts.mtp : d.counts.cast)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          }}>{r.label} <b>{r.key === 'labels' ? labelCount : (data.counts[r.key] || 0)}</b></button>
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
        {reason === 'absent' && (
          <label style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
            <input type="checkbox" checked={onlyNear} onChange={(e) => setOnlyNear(e.target.checked)} /> Seulement ceux qui ont une fiche caisse proche (à trancher : même article ou pas), la plus ressemblante d'abord
          </label>
        )}
        {error && <div style={{ color: C.red }}>{error}</div>}
        {reason === 'absent' && <Uncategorized call={call} onDone={load} />}
        {reason === 'absent' && <CreateAll call={call} onDone={load} />}
        {reason === 'labels' && <LabelRows shop={shop} call={call} onCount={setLabelCount} />}
        {reason === 'prix' && <PriceRows rows={data.rows} call={call} onDone={load} shop={shop} />}
        {reason !== 'prix' && reason !== 'labels' && data.rows.map((row) => <ReviewRow key={row.id} row={row} call={call} onDone={load} />)}
        {reason !== 'labels' && !data.rows.length && <div style={{ color: C.greyT, padding: 10 }}>Rien à vérifier ici.</div>}
        {reason !== 'labels' && data.rows.length >= 100 && <div style={{ color: C.greyT, fontSize: 12, paddingTop: 8 }}>100 premières lignes : filtrez pour voir les autres.</div>}
      </div>
    </div>
  );
}
