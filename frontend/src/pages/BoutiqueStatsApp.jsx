import { useState, useEffect, useContext, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { BoutiqueStats as BoutiqueStatsIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';

/**
 * Stats boutiques — ventes caisse Nextore, droit `stats-boutiques`.
 *
 * Conseiller : quantités et part du CA. Responsable : + CA HT. L'écran ne
 * décide de rien : un conseiller ne REÇOIT aucun montant (le backend les
 * retire), la colonne CA HT n'apparaît que si la réponse les porte.
 */

const MAUVE = '#A21CAF';
const MAUVE_TRACK = '#FAE8FF';

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

/** Part du CA : barre fine à l'échelle de la première ligne, valeur à droite. */
function Part({ value, max }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 170 }}>
      <span style={{ flex: 1, height: 8, borderRadius: 4, background: MAUVE_TRACK, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${w}%`, height: '100%', background: MAUVE, borderRadius: 4 }} />
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

/* ─── PAGE ──────────────────────────────────────────────── */
const BoutiqueStatsApp = () => {
  const { token } = useContext(AuthContext);

  const [acces, setAcces] = useState(null); // { level, shops }
  const [shop, setShop] = useState(null);
  const [periode, setPeriode] = useState('30d');
  const [[from, to], setRange] = useState(() => PERIODES[1].range());
  const [onglet, setOnglet] = useState('products');
  const [tri, setTri] = useState('pct'); // 'pct' | 'qty'
  const [recherche, setRecherche] = useState('');
  const [limite, setLimite] = useState(PAGE);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/boutique-stats/access`, authHeaders(token))
      .then((res) => {
        setAcces(res.data);
        setShop(res.data.shops[0]?.slug || null);
      })
      .catch((err) => setErreur(err.response?.data?.error || 'Erreur de chargement'));
  }, [token]);

  useEffect(() => {
    if (!shop) return;
    let annule = false;
    setLoading(true);
    setErreur(null);
    axios.get(`${API_URL}/boutique-stats/${shop}`, { ...authHeaders(token), params: { from, to } })
      .then((res) => { if (!annule) setData(res.data); })
      .catch((err) => { if (!annule) setErreur(err.response?.data?.error || 'Erreur de chargement'); })
      .finally(() => { if (!annule) setLoading(false); });
    return () => { annule = true; };
  }, [token, shop, from, to]);

  useEffect(() => { setLimite(PAGE); }, [onglet, tri, recherche, shop, from, to]);

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

  const maxPct = Math.max(0, ...(data?.[onglet] || []).map((r) => r.pct));

  const sansBoutique = acces && acces.shops.length === 0;

  return (
    <AppShell currentPath="/stats-boutiques">
      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px 60px' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: MAUVE,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <BoutiqueStatsIcon size={24} color="#fff" />
            </span>
            <h1 style={{
              margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary,
            }}>Stats boutiques</h1>
            {acces?.level && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, background: MAUVE_TRACK, color: MAUVE,
                fontSize: 12, fontWeight: 700,
              }}>{acces.level === 'responsable' ? 'Responsable' : 'Conseiller'}</span>
            )}

            {acces?.shops.length > 1 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {acces.shops.map((s) => (
                  <Pastille key={s.slug} actif={shop === s.slug} onClick={() => setShop(s.slug)}>{s.name}</Pastille>
                ))}
              </div>
            )}
            {acces?.shops.length === 1 && (
              <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: C.dark }}>
                Boutique {acces.shops[0].name}
              </span>
            )}
          </div>

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

          {erreur && (
            <div style={{
              background: C.redL, borderLeft: `4px solid ${C.red}`, color: '#7F1D1D',
              padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13.5,
            }}>{erreur}</div>
          )}

          {sansBoutique && (
            <div style={{ ...carte, padding: 24, color: C.greyT }}>
              Aucune boutique ne vous est ouverte. Contactez un administrateur.
            </div>
          )}

          {data && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                {avecMontants && <Tuile label="CA HT" value={eur.format(data.totals.ca_ht)} />}
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
                      {o.label} <span style={{ opacity: 0.7, fontWeight: 500 }}>({nf.format(data[o.key].length)})</span>
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
                        <Th>{ONGLETS.find((o) => o.key === onglet).label.replace(/s$/, '')}</Th>
                        <Th align="right" onClick={() => setTri('qty')} active={tri === 'qty'}>Qté vendue</Th>
                        <Th onClick={() => setTri('pct')} active={tri === 'pct'}>Part du CA</Th>
                        {avecMontants && <Th align="right">CA HT</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.length === 0 ? (
                        <tr><td colSpan={avecMontants ? 5 : 4} style={{ padding: 28, textAlign: 'center', color: C.greyM }}>
                          {loading ? 'Chargement…' : 'Aucune vente sur la période.'}
                        </td></tr>
                      ) : lignes.slice(0, limite).map((r, i) => (
                        <tr key={r.id} style={{ background: i % 2 ? C.zebra : C.white }}>
                          <Td align="right" color={C.greyT}>{r.rang}</Td>
                          <Td bold>{r.name || '—'}</Td>
                          <Td align="right" color={r.qty < 0 ? C.red : C.dark}>{nf.format(r.qty)}</Td>
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
      </main>
    </AppShell>
  );
};

export default BoutiqueStatsApp;
