import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_URL, authHeaders, C } from '../picking/pickingUi';
import { jourParis, nf, eur, champ, carte } from './statsShared';
import MultiSelect from './MultiSelect';
import { Pastille, Tuile, Th, Td } from './StatsTab';

/**
 * Boutique › Produits dormants — le catalogue actif de LA boutique de la page
 * qui n'a fait aucune vente caisse depuis N jours (droit `stats-boutiques`).
 * Un produit sans stock au début de la période (reçu depuis) est écarté : il
 * n'a pas pu se vendre. Le backend le décide et donne le nombre d'écartés.
 *
 * Conseiller : stock et date de dernière vente. Responsable : + coût HT et
 * valeur du stock immobilisé — le backend ne les envoie qu'à lui, les colonnes
 * n'apparaissent que si la réponse les porte.
 */

const INDIGO = '#4338CA';

/** Critère de temps : « aucune vente depuis N jours », aujourd'hui compris. */
const DUREES = [
  { key: 30, label: '30 jours' },
  { key: 60, label: '60 jours' },
  { key: 90, label: '90 jours' },
  { key: 180, label: '6 mois' },
  { key: 365, label: '1 an' },
];

const depuisJours = (n) => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); return jourParis(d); };

const PAGE = 100;

const NONE = '__none__';

/**
 * Options d'une liste à cocher : « 10 ml, 50 ml, 100 ml » en ordre numérique,
 * « Sans… » en dernier ; une valeur cochée qui n'a plus de produit reste
 * proposée, pour pouvoir la décocher.
 */
const optionsCochables = (options = [], valeurs, libelle = (o) => o.name) => {
  const liste = [...options]
    .sort((a, b) => (a.id === NONE) - (b.id === NONE) || libelle(a).localeCompare(libelle(b), 'fr', { numeric: true }))
    .map((o) => ({ id: o.id, label: libelle(o) }));
  for (const v of valeurs) if (!liste.some((o) => o.id === v)) liste.unshift({ id: v, label: 'Aucun produit dormant' });
  return liste;
};

const dateFr = (s) => (s ? s.split('-').reverse().join('/') : '');

/** Jours écoulés entre deux dates AAAA-MM-JJ. */
const ecart = (de, a) => Math.round((Date.parse(a) - Date.parse(de)) / 86400000);

const ilYa = (jours) => {
  if (jours < 60) return `il y a ${jours} j`;
  if (jours < 730) return `il y a ${Math.round(jours / 30.4)} mois`;
  return `il y a ${(jours / 365).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ans`;
};

/** Tri d'une colonne ; « Jamais vendu » passe avant toute date (le plus dormant). */
const TRIS = {
  name: (r) => String(r.name || ''),
  brand: (r) => String(r.brand || ''),
  stock: (r) => r.stock,
  lastSoldAt: (r) => r.lastSoldAt || '',
  stockValue: (r) => r.stockValue || 0,
};
const SENS_PAR_DEFAUT = { name: 'asc', brand: 'asc', stock: 'desc', lastSoldAt: 'asc', stockValue: 'desc' };

export default function DormantsTab({ shop, token }) {
  const [duree, setDuree] = useState(90);
  const [since, setSince] = useState(() => depuisJours(90));
  const [recherche, setRecherche] = useState('');
  const [rechercheEnvoyee, setRechercheEnvoyee] = useState('');
  const [categories, setCategories] = useState([]);
  const [sousCategories, setSousCategories] = useState([]);
  const [enStock, setEnStock] = useState(false);
  const [tri, setTri] = useState('stock');
  const [sens, setSens] = useState('desc');
  const [limite, setLimite] = useState(PAGE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [export_, setExport] = useState(false);

  // Mêmes paramètres pour l'écran et pour l'export : le fichier est le tableau affiché.
  const params = {
    since,
    category: categories.join(',') || undefined,
    subcategory: sousCategories.join(',') || undefined,
    search: rechercheEnvoyee || undefined,
    in_stock: enStock ? 1 : undefined,
  };

  useEffect(() => {
    let annule = false;
    setLoading(true);
    setErreur(null);
    axios.get(`${API_URL}/boutique-stats/${shop.slug}/dormants`, {
      ...authHeaders(token),
      params: {
        since,
        category: categories.join(',') || undefined,
        subcategory: sousCategories.join(',') || undefined,
        search: rechercheEnvoyee || undefined,
        in_stock: enStock ? 1 : undefined,
      },
    })
      .then((res) => { if (!annule) setData(res.data); })
      .catch((err) => { if (!annule) setErreur(err.response?.data?.error || 'Erreur de chargement'); })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [token, shop.slug, since, categories, sousCategories, rechercheEnvoyee, enStock]);

  // La recherche part au serveur quand la frappe s'arrête.
  useEffect(() => {
    const t = setTimeout(() => setRechercheEnvoyee(recherche.trim()), 300);
    return () => clearTimeout(t);
  }, [recherche]);

  useEffect(() => { setLimite(PAGE); }, [tri, sens, shop.slug, since, categories, sousCategories, rechercheEnvoyee, enStock]);

  const avecMontants = data?.totals?.stockValue !== undefined;
  const aujourdhui = jourParis();

  const lignes = useMemo(() => {
    const cle = TRIS[tri];
    const dir = sens === 'asc' ? 1 : -1;
    return [...(data?.products || [])].sort((a, b) => {
      const va = cle(a);
      const vb = cle(b);
      const c = typeof va === 'string' ? va.localeCompare(vb, 'fr', { numeric: true }) : va - vb;
      return dir * c || String(a.name).localeCompare(String(b.name), 'fr', { numeric: true });
    });
  }, [data, tri, sens]);

  // Un clic sur la colonne de tri en cours l'inverse.
  const trierPar = (cle) => {
    if (cle === tri) setSens((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setTri(cle); setSens(SENS_PAR_DEFAUT[cle]); }
  };
  const thTri = (cle) => ({ onClick: () => trierPar(cle), active: tri === cle, dir: sens, color: INDIGO });

  /** Le tableau affiché (filtres + tri) en .xlsx — s'ouvre dans Excel, s'importe dans Google Sheets. */
  const exporter = async () => {
    setExport(true);
    try {
      const res = await axios.get(`${API_URL}/boutique-stats/${shop.slug}/dormants/export`, {
        ...authHeaders(token),
        params: { ...params, sort: tri, dir: sens },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = `produits_dormants_${shop.slug}_depuis_${since}.xlsx`;
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Réponse d'erreur en Blob (responseType) : la relire pour en tirer le message.
      let message = "Erreur lors de l'export";
      try { message = JSON.parse(await err.response.data.text()).error || message; } catch { /* message par défaut */ }
      setErreur(message);
    } finally {
      setExport(false);
    }
  };

  const sousCategoriesUtiles = categories.length > 0
    && (data?.options.subcategories || []).some((o) => o.id !== NONE);

  // Une catégorie décochée emporte ses sous-catégories cochées.
  const choisirCategories = (ids) => {
    const noms = new Set((data?.options.categories || []).filter((o) => ids.includes(o.id)).map((o) => o.name));
    setCategories(ids);
    setSousCategories((subs) => (ids.length === 0 ? [] : subs.filter((id) => {
      const o = (data?.options.subcategories || []).find((x) => x.id === id);
      return id === NONE || !o || noms.has(o.category);
    })));
  };

  // « 10 ml » existe en Arômes et en E-liquides : préfixé dès que plusieurs catégories sont cochées.
  const libelleSousCategorie = (o) => (categories.length > 1 && o.category ? `${o.category} › ${o.name}` : o.name);

  const colonnes = avecMontants ? 7 : 5;

  return (
    <div>
      {/* Critère de temps */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600 }}>Aucune vente depuis</span>
        {DUREES.map((d) => (
          <Pastille key={d.key} color={INDIGO} actif={duree === d.key}
            onClick={() => { setDuree(d.key); setSince(depuisJours(d.key)); }}>{d.label}</Pastille>
        ))}
        <span style={{ color: C.greyT, fontSize: 13 }}>ou depuis le</span>
        <input type="date" value={since} max={aujourdhui} style={champ}
          onChange={(e) => { if (e.target.value) { setSince(e.target.value); setDuree(null); } }} />
      </div>

      {/* Recherche, catégorie, stock */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Produit, marque, catégorie, code-barres…"
          style={{ ...champ, flex: '1 1 300px', maxWidth: 380, padding: '8px 12px' }}
        />
        <span style={{ fontSize: 13, color: C.greyT, fontWeight: 600, marginLeft: 8 }}>Catégories</span>
        <MultiSelect
          options={optionsCochables(data?.options.categories, categories)}
          value={categories}
          onChange={choisirCategories}
          noun={['catégorie', 'catégories']}
          color={INDIGO}
        />
        <span
          style={{ fontSize: 13, color: C.greyT, fontWeight: 600, marginLeft: 8 }}
          title="Une catégorie dont aucune sous-catégorie n'est cochée reste entière"
        >Sous-catégories</span>
        <MultiSelect
          options={optionsCochables(data?.options.subcategories, sousCategories, libelleSousCategorie)}
          value={sousCategories}
          onChange={setSousCategories}
          noun={['sous-catégorie', 'sous-catégories']}
          disabled={!sousCategoriesUtiles && sousCategories.length === 0}
          color={INDIGO}
          minWidth={180}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.dark, marginLeft: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={enStock} onChange={(e) => setEnStock(e.target.checked)} />
          En stock seulement
        </label>
        {(categories.length > 0 || recherche) && (
          <button
            onClick={() => { setCategories([]); setSousCategories([]); setRecherche(''); }}
            style={{ ...champ, cursor: 'pointer', fontWeight: 600, color: INDIGO, borderColor: 'transparent', background: 'none' }}
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
            <Tuile label="Produits dormants" value={nf.format(data.totals.products)} sub={`sans vente depuis le ${dateFr(data.since)}`} />
            <Tuile label="Dont en stock" value={nf.format(data.totals.inStock)} />
            <Tuile label="Unités en stock" value={nf.format(data.totals.units)} />
            {avecMontants && <Tuile label="Stock immobilisé HT" value={eur.format(data.totals.stockValue)} sub="au prix d'achat" />}
            <button
              onClick={exporter}
              disabled={export_ || loading || lignes.length === 0}
              title="Le tableau tel qu'affiché (filtres et tri) — fichier .xlsx, s'ouvre dans Excel et s'importe dans Google Sheets"
              style={{
                ...champ, alignSelf: 'center', marginLeft: 'auto', cursor: 'pointer', fontWeight: 600,
                background: INDIGO, color: '#fff', borderColor: INDIGO, padding: '9px 16px',
                opacity: export_ || loading || lignes.length === 0 ? 0.5 : 1,
              }}
            >{export_ ? 'Export…' : `Exporter (${nf.format(lignes.length)}) · Excel / Google Sheets`}</button>
          </div>

          {data.totals.excludedNoStock > 0 && (
            <div style={{ fontSize: 12.5, color: C.greyT, margin: '-4px 0 14px' }}>
              {nf.format(data.totals.excludedNoStock)} produit{data.totals.excludedNoStock > 1 ? 's' : ''} écarté{data.totals.excludedNoStock > 1 ? 's' : ''} :
              aucun stock au {dateFr(data.since)} (jamais reçus, ou reçus depuis), ils n'ont pas pu se vendre.
              {data.stockCheck === 'rebuilt' && data.stockHistoryStart && (
                <> Stock au {dateFr(data.since)} reconstitué depuis le relevé du {dateFr(data.stockHistoryStart)} (achats reçus et ventes entre-temps).</>
              )}
            </div>
          )}

          <div style={{ ...carte, opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th {...thTri('name')}>Produit</Th>
                    <Th {...thTri('brand')}>Marque</Th>
                    <Th>Catégorie</Th>
                    <Th align="right" {...thTri('stock')}>Stock</Th>
                    <Th {...thTri('lastSoldAt')}>Dernière vente</Th>
                    {avecMontants && <Th align="right">Coût HT</Th>}
                    {avecMontants && <Th align="right" {...thTri('stockValue')}>Valeur stock</Th>}
                  </tr>
                </thead>
                <tbody>
                  {lignes.length === 0 ? (
                    <tr><td colSpan={colonnes} style={{ padding: 28, textAlign: 'center', color: C.greyM }}>
                      {loading ? 'Chargement…' : 'Aucun produit dormant ne correspond.'}
                    </td></tr>
                  ) : lignes.slice(0, limite).map((r, i) => (
                    <tr key={r.id} style={{ background: i % 2 ? C.zebra : C.white }}>
                      <Td bold>
                        {r.name || '—'}
                        {r.code && <span style={{ color: C.greyM, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>{r.code}</span>}
                      </Td>
                      <Td>{r.brand}</Td>
                      <Td color={C.greyT}>{r.category}{r.subcategory ? ` › ${r.subcategory}` : ''}</Td>
                      <Td align="right" bold color={r.stock > 0 ? C.dark : r.stock < 0 ? C.red : C.greyM}>{nf.format(r.stock)}</Td>
                      <Td color={r.lastSoldAt ? C.dark : C.greyT}>
                        {r.lastSoldAt ? (
                          <>
                            {dateFr(r.lastSoldAt)}
                            <span style={{ color: C.greyM, fontSize: 12, marginLeft: 8 }}>{ilYa(ecart(r.lastSoldAt, aujourdhui))}</span>
                          </>
                        ) : (
                          <span title={data.historyStart ? `Aucune vente dans cette boutique depuis le début de l'historique (${dateFr(data.historyStart)})` : undefined}>
                            Jamais vendu
                          </span>
                        )}
                      </Td>
                      {avecMontants && <Td align="right" color={C.greyT}>{r.cost != null ? eur.format(r.cost) : '—'}</Td>}
                      {avecMontants && <Td align="right" bold>{r.stockValue ? eur.format(r.stockValue) : '—'}</Td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lignes.length > limite && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button onClick={() => setLimite((l) => l + PAGE * 5)} style={{ ...champ, cursor: 'pointer', fontWeight: 600 }}>
                  Afficher plus ({nf.format(lignes.length - limite)} restants)
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
