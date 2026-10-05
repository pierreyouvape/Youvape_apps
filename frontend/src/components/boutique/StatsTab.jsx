import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C } from '../picking/pickingUi';

/**
 * Boutique › Statistiques — ventes caisse Nextore de LA boutique de la page,
 * droit `stats-boutiques`.
 *
 * Conseiller : quantités et part du CA. Responsable : + CA HT. L'écran ne
 * décide de rien : un conseiller ne REÇOIT aucun montant (le backend les
 * retire), la colonne CA HT n'apparaît que si la réponse les porte.
 */

const MAUVE = '#A21CAF';
const MAUVE_TRACK = '#FAE8FF';
// Part des unités : une autre teinte, pour ne pas la lire comme la part du CA.
const CYAN = '#0E7490';
const CYAN_TRACK = '#CFFAFE';

const jourParis = (d = new Date()) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);

/** Bornes d'un préréglage, recalculées à chaque choix (jamais figées). */
const PERIODES = [
  { key: '7d', label: '7 jours', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [jourParis(d), jourParis()]; } },
  { key: '30d', label: '30 jours', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [jourParis(d), jourParis()]; } },
  { key: 'month', label: 'Mois en cours', range: () => { const t = jourParis(); return [`${t.slice(0, 8)}01`, t]; } },
  { key: 'prev-month', label: 'Mois précédent', range: () => {
    const [y, m] = jourParis().split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const last = new Date(py, pm, 0).getDate();
    const mm = String(pm).padStart(2, '0');
    return [`${py}-${mm}-01`, `${py}-${mm}-${last}`];
  } },
  { key: 'year', label: 'Année en cours', range: () => { const t = jourParis(); return [`${t.slice(0, 4)}-01-01`, t]; } },
];

const ONGLETS = [
  { key: 'products', label: 'Produits' },
  { key: 'brands', label: 'Marques' },
  { key: 'categories', label: 'Catégories' },
];

const PAGE = 100;

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const pctFmt = (p) => `${p.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;

const dateHeure = (s) => (s ? new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(s)) : null);

const champ = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, fontFamily: 'inherit', color: C.dark, background: C.white,
};

const carte = {
  background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 16,
};

/**
 * Options d'une liste, triées « 10 ml, 50 ml, 100 ml » (ordre numérique), la
 * valeur « Sans… » en dernier. La sélection courante reste proposée même si
 * elle n'a plus de vente sur la nouvelle période.
 */
const avecSelection = (options = [], valeur) => {
  const liste = [...options].sort((a, b) => (a.id === '__none__') - (b.id === '__none__')
    || a.name.localeCompare(b.name, 'fr', { numeric: true }));
  if (valeur && !liste.some((o) => o.id === valeur)) liste.unshift({ id: valeur, name: 'Aucune vente sur la période' });
  return liste;
};

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Pastille({ actif, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      ...champ, cursor: 'pointer', fontWeight: 600,
      background: actif ? MAUVE : C.white, color: actif ? '#fff' : C.dark,
      borderColor: actif ? MAUVE : C.greyB,
    }}>{children}</button>
  );
}

function Tuile({ label, value, sub }) {
  return (
    <div style={{ ...carte, marginBottom: 0, flex: '1 1 170px', padding: '14px 16px' }}>
      <div style={{ fontSize: 12.5, color: C.greyT, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.dark, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Une part : barre fine à l'échelle de la plus grande ligne, valeur à droite. */
function Part({ value, max, color = MAUVE, track = MAUVE_TRACK }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
      <span style={{ flex: 1, height: 8, borderRadius: 4, background: track, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${w}%`, height: '100%', background: color, borderRadius: 4 }} />
      </span>
      <span style={{ width: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.dark }}>{pctFmt(value)}</span>
    </span>
  );
}

function Th({ children, align = 'left', onClick, active }) {
  return <th onClick={onClick} style={{
    padding: '10px 12px', textAlign: align, fontWeight: 700, color: active ? MAUVE : C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
    cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
  }}>{children}{active ? ' ▼' : ''}</th>;
}

function Td({ children, align = 'left', bold, color }) {
  return <td style={{
    padding: '9px 12px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400,
    borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, fontVariantNumeric: 'tabular-nums',
  }}>{children}</td>;
}

/* ─── STATS TAB ─────────────────────────────────────────── */
export default function StatsTab({ shop, token }) {
  const [periode, setPeriode] = useState('30d');
  const [[from, to], setRange] = useState(() => PERIODES[1].range());
  const [onglet, setOnglet] = useState('products');
  const [tri, setTri] = useState('pct'); // 'pct' (part du CA) | 'qty' (unités)
  const [recherche, setRecherche] = useState('');
  const [categorie, setCategorie] = useState('');
  const [sousCategorie, setSousCategorie] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setLoading(true);
    setErreur(null);
    axios.get(`${API_URL}/boutique-stats/${shop.slug}`, {
      ...authHeaders(token),
      params: { from, to, category: categorie || undefined, subcategory: sousCategorie || undefined },
    })
      .then((res) => { if (!annule) setData(res.data); })
      .catch((err) => { if (!annule) setErreur(err.response?.data?.error || 'Erreur de chargement'); })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [token, shop.slug, from, to, categorie, sousCategorie]);

  useEffect(() => { setLimite(PAGE); }, [onglet, tri, recherche, shop.slug, from, to, categorie, sousCategorie]);

  const choisirPeriode = (p) => {
    setPeriode(p.key);
    setRange(p.range());
  };

  const avecMontants = data?.totals?.ca_ht !== undefined;

  // Rang calculé sur la liste complète, AVANT la recherche : chercher une
  // marque montre sa vraie place, pas « 1 ».
  const lignes = useMemo(() => {
    const liste = [...(data?.[onglet] || [])];
    if (tri === 'qty') liste.sort((a, b) => b.qty - a.qty);
    const classees = liste.map((r, i) => ({ ...r, rang: i + 1 }));
    const q = recherche.trim().toLowerCase();
    return q ? classees.filter((r) => String(r.name || '').toLowerCase().includes(q)) : classees;
  }, [data, onglet, tri, recherche]);

  // Une catégorie choisie : l'onglet Catégories détaille ses sous-catégories.
  const libelleOnglet = (o) => (o.key === 'categories' && data?.categoriesAreSubcategories ? 'Sous-catégories' : o.label);

  // Une sous-catégorie n'a de sens que si la catégorie en a de vraies.
  const sousCategoriesUtiles = Boolean(categorie)
    && (data?.options.subcategories || []).some((o) => o.id !== '__none__');

  const maxPct = Math.max(0, ...(data?.[onglet] || []).map((r) => r.pct));
  const maxQtyPct = Math.max(0, ...(data?.[onglet] || []).map((r) => r.qtyPct));

  // Onglet Catégories : un clic filtre sur la ligne et montre ses produits.
  const cliquable = onglet === 'categories';
  const voirProduits = (r) => {
    if (data.categoriesAreSubcategories) setSousCategorie(r.id);
    else { setCategorie(r.id); setSousCategorie(''); }
    setRecherche('');
    setOnglet('products');
  };

  return (
    <div>
      <style>{`
        .stats-ligne-cliquable:hover td { background: #FDF4FF; }
        .stats-voir { visibility: hidden; }
        .stats-ligne-cliquable:hover .stats-voir { visibility: visible; }
      `}</style>
      {/* Période */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        {PERIODES.map((p) => (
          <Pastille key={p.key} actif={periode === p.key} onClick={() => choisirPeriode(p)}>{p.label}</Pastille>
        ))}
        <input type="date" value={from} max={to} style={champ}
          onChange={(e) => { if (e.target.value) { setRange([e.target.value, to]); setPeriode(null); } }} />
        <span style={{ color: C.greyT, fontSize: 13 }}>au</span>
        <input type="date" value={to} min={from} max={jourParis()} style={champ}
          onChange={(e) => { if (e.target.value) { setRange([from, e.target.value]); setPeriode(null); } }} />
        {data?.lastSalesSyncAt && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: C.greyT }}>
            Ventes à jour au {dateHeure(data.lastSalesSyncAt)}
          </span>
        )}
      </div>

      {/* Filtres catégorie / sous-catégorie : les parts se calculent sur la sélection */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}>Catégorie</span>
        <select
          value={categorie}
          onChange={(e) => { setCategorie(e.target.value); setSousCategorie(''); }}
          style={{ ...champ, minWidth: 200 }}
        >
          <option value="">Toutes</option>
          {avecSelection(data?.options.categories, categorie).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600, marginLeft: 8 }}>Sous-catégorie</span>
        <select
          value={sousCategorie}
          onChange={(e) => setSousCategorie(e.target.value)}
          disabled={!sousCategoriesUtiles}
          style={{ ...champ, minWidth: 180, opacity: sousCategoriesUtiles ? 1 : 0.5 }}
        >
          <option value="">Toutes</option>
          {avecSelection(data?.options.subcategories, sousCategorie).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {categorie && (
          <button
            onClick={() => { setCategorie(''); setSousCategorie(''); }}
            style={{ ...champ, cursor: 'pointer', fontWeight: 600, color: MAUVE, borderColor: 'transparent', background: 'none' }}
          >Effacer</button>
        )}
      </div>

      {erreur && (
        <div style={{
          background: C.redL, borderLeft: `4px solid ${C.red}`, color: '#7F1D1D',
          padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13.5,
        }}>{erreur}</div>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {avecMontants && <Tuile label="CA HT" value={eur.format(data.totals.ca_ht)} />}
            {categorie && <Tuile label="Part du CA de la boutique" value={pctFmt(data.totals.selectionPct)} sub="pour la sélection" />}
            {categorie && <Tuile label="Part des unités de la boutique" value={pctFmt(data.totals.selectionQtyPct)} sub="pour la sélection" />}
            <Tuile label="Unités vendues" value={nf.format(data.totals.qty)} sub="retours déduits" />
            <Tuile label="Références vendues" value={nf.format(data.products.length)} />
          </div>

          <div style={{ ...carte, opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
              borderBottom: `1px solid ${C.greyB}`, flexWrap: 'wrap',
            }}>
              {ONGLETS.map((o) => (
                <Pastille key={o.key} actif={onglet === o.key} onClick={() => setOnglet(o.key)}>
                  {libelleOnglet(o)} <span style={{ opacity: 0.7, fontWeight: 500 }}>({nf.format(data[o.key].length)})</span>
                </Pastille>
              ))}
              <input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher…"
                style={{ ...champ, marginLeft: 'auto', minWidth: 220 }}
              />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th align="right">#</Th>
                    <Th>{libelleOnglet(ONGLETS.find((o) => o.key === onglet)).replace(/s$/, '')}</Th>
                    <Th align="right" onClick={() => setTri('qty')} active={tri === 'qty'}>Qté vendue</Th>
                    <Th onClick={() => setTri('qty')} active={tri === 'qty'}>Part des unités</Th>
                    <Th onClick={() => setTri('pct')} active={tri === 'pct'}>Part du CA</Th>
                    {avecMontants && <Th align="right">CA HT</Th>}
                  </tr>
                </thead>
                <tbody>
                  {lignes.length === 0 ? (
                    <tr><td colSpan={avecMontants ? 6 : 5} style={{ padding: 28, textAlign: 'center', color: C.greyM }}>
                      {loading ? 'Chargement…' : 'Aucune vente sur la période.'}
                    </td></tr>
                  ) : lignes.slice(0, limite).map((r, i) => (
                    <tr
                      key={r.id}
                      className={cliquable ? 'stats-ligne-cliquable' : undefined}
                      onClick={cliquable ? () => voirProduits(r) : undefined}
                      title={cliquable ? 'Voir les produits' : undefined}
                      style={{ background: i % 2 ? C.zebra : C.white, cursor: cliquable ? 'pointer' : 'default' }}
                    >
                      <Td align="right" color={C.greyT}>{r.rang}</Td>
                      <Td bold>
                        {r.name || '—'}
                        {cliquable && <span className="stats-voir" style={{ color: MAUVE, fontWeight: 600, fontSize: 12, marginLeft: 8 }}>Voir les produits ›</span>}
                      </Td>
                      <Td align="right" color={r.qty < 0 ? C.red : C.dark}>{nf.format(r.qty)}</Td>
                      <Td><Part value={r.qtyPct} max={maxQtyPct} color={CYAN} track={CYAN_TRACK} /></Td>
                      <Td><Part value={r.pct} max={maxPct} /></Td>
                      {avecMontants && <Td align="right" bold>{eur.format(r.ca_ht)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lignes.length > limite && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button onClick={() => setLimite((l) => l + PAGE * 5)} style={{ ...champ, cursor: 'pointer', fontWeight: 600 }}>
                  Afficher plus ({nf.format(lignes.length - limite)} restantes)
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
