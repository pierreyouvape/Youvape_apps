import { useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { ShipmentStats as ShipmentStatsIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C, CarrierLogo, Chip } from '../components/picking/pickingUi';

/**
 * Stats d'expédition — groupe « Prépa de commande », droit `stats-expedition`.
 *
 * Colis de l'app ET colis emballés dans BMS (tant que la préparation se fait en
 * partie là-bas) ; « Correspondance BMS » rattache un nom BMS à un compte.
 *
 * Les règles de calcul (colis, articles, temps par colis) sont dans
 * backend/src/models/shipmentStatsModel.js. L'écran ne recalcule rien : il
 * divise, c'est tout — le temps moyen par colis se divise par le nombre
 * d'INTERVALLES, jamais par le nombre de colis.
 */

const TEAL = '#0F766E';
const TEAL_TRACK = '#CCFBF1';

const jourParis = (decalage = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
};

const PERIODES = [
  { key: 'today', label: "Aujourd'hui", from: 0 },
  { key: 'yesterday', label: 'Hier', from: -1, to: -1 },
  { key: '7d', label: '7 jours', from: -6 },
  { key: '30d', label: '30 jours', from: -29 },
];

const nf = new Intl.NumberFormat('fr-FR');
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** 78 → « 1 min 18 » ; 57 → « 57 s ». */
const duree = (s) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const r = Math.round(s);
  if (r < 60) return `${r} s`;
  const m = Math.floor(r / 60);
  return `${m} min ${String(r % 60).padStart(2, '0')}`;
};

/** 41053 → « 11 h 24 ». */
const dureeLongue = (s) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(h / 24)} j`;
};

const champ = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, fontFamily: 'inherit', color: C.dark, background: C.white,
};

const carte = {
  background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, marginBottom: 16,
};

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Tuile({ label, value, sub }) {
  return (
    <div style={{ ...carte, marginBottom: 0, flex: '1 1 170px', padding: '14px 16px' }}>
      <div style={{ fontSize: 12.5, color: C.greyT, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.dark, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** Part d'un total : une barre fine, piste claire de la même teinte. */
function Part({ value, total }) {
  const p = pct(value, total);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
      <span style={{ flex: 1, height: 8, borderRadius: 4, background: TEAL_TRACK, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${p}%`, height: '100%', background: TEAL, borderRadius: 4 }} />
      </span>
      <span style={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: C.dark }}>{p} %</span>
    </span>
  );
}

function Th({ children, align = 'left' }) {
  return <th style={{
    padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
  }}>{children}</th>;
}

function Td({ children, align = 'left', bold, color, style }) {
  return <td style={{
    padding: '9px 12px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400,
    borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', ...style,
  }}>{children}</td>;
}

function Titre({ children, sub }) {
  return (
    <div style={{ padding: '14px 16px 10px' }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.dark }}>{children}</h2>
      {sub && <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/**
 * Colis par heure — une seule série : pas de légende, le titre la nomme.
 * Colonnes fines arrondies en tête, valeur au survol, seul le pic est étiqueté.
 */
function ColisParHeure({ hours }) {
  const [survol, setSurvol] = useState(null);
  if (!hours.length) return <div style={{ padding: '8px 16px 18px', color: C.greyT, fontSize: 13.5 }}>Aucun colis.</div>;

  const parHeure = new Map(hours.map(h => [h.hour, h.parcels]));
  const debut = Math.min(8, ...hours.map(h => h.hour));
  const fin = Math.max(19, ...hours.map(h => h.hour));
  const barres = [];
  for (let h = debut; h <= fin; h++) barres.push({ hour: h, parcels: parHeure.get(h) || 0 });

  const max = Math.max(...barres.map(b => b.parcels));
  const pas = max <= 10 ? 5 : max <= 50 ? 10 : max <= 100 ? 25 : 50;
  const haut = Math.ceil(max / pas) * pas || pas;
  const graduations = [];
  for (let v = 0; v <= haut; v += pas) graduations.push(v);
  const pic = barres.find(b => b.parcels === max);

  const H = 180;
  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Axe des valeurs */}
        <div style={{ position: 'relative', width: 28, height: H, flexShrink: 0 }}>
          {graduations.map(v => (
            <span key={v} style={{
              position: 'absolute', right: 0, bottom: (v / haut) * H - 7,
              fontSize: 11, color: C.greyT, fontVariantNumeric: 'tabular-nums',
            }}>{v}</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: 'relative', height: H, display: 'flex', alignItems: 'flex-end' }}>
            {graduations.map(v => (
              <span key={v} style={{
                position: 'absolute', left: 0, right: 0, bottom: (v / haut) * H,
                borderTop: `1px solid ${v === 0 ? C.greyB : '#F1F3F5'}`,
              }} />
            ))}
            {barres.map(b => (
              <div
                key={b.hour}
                onMouseEnter={() => setSurvol(b.hour)}
                onMouseLeave={() => setSurvol(null)}
                aria-label={`${b.hour} h – ${b.hour + 1} h : ${b.parcels} colis`}
                style={{
                  position: 'relative', flex: 1, height: '100%', display: 'flex',
                  alignItems: 'flex-end', justifyContent: 'center',
                  background: survol === b.hour ? 'rgba(15,118,110,0.06)' : 'transparent',
                }}
              >
                {b.parcels > 0 && (
                  <span style={{
                    width: '100%', maxWidth: 24, margin: '0 1px', height: (b.parcels / haut) * H,
                    background: TEAL, borderRadius: '4px 4px 0 0', position: 'relative',
                  }}>
                    {b === pic && survol == null && (
                      <span style={{
                        position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                        marginBottom: 3, fontSize: 11.5, fontWeight: 700, color: C.dark, whiteSpace: 'nowrap',
                      }}>{b.parcels}</span>
                    )}
                  </span>
                )}
                {survol === b.hour && (
                  <span style={{
                    position: 'absolute', bottom: Math.min((b.parcels / haut) * H + 8, H - 34), left: '50%',
                    transform: 'translateX(-50%)', zIndex: 2, pointerEvents: 'none',
                    background: C.dark, color: '#fff', borderRadius: 6, padding: '5px 8px',
                    fontSize: 12, whiteSpace: 'nowrap', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}>
                    {b.hour} h – {b.hour + 1} h : <strong>{b.parcels} colis</strong>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex' }}>
            {barres.map(b => (
              <span key={b.hour} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: C.greyT, paddingTop: 4 }}>
                {b.hour}h
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── CORRESPONDANCE BMS ────────────────────────────────── */
/**
 * BMS signe ses colis du nom complet (« Celine Pialat »), l'app a ses comptes
 * (« Celyne ») : rien ne permet de les rapprocher tout seul. Un nom non
 * rattaché s'affiche tel quel dans les stats.
 */
function CorrespondanceBms({ token, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(null);

  const charger = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/shipment-stats/packers`, authHeaders(token));
      setData(res.data);
    } catch (err) {
      setErreur(err.response?.data?.error || 'Erreur de chargement');
    }
  }, [token]);

  useEffect(() => { charger(); }, [charger]);

  const rattacher = async (packerName, userId) => {
    setEnCours(packerName);
    setErreur(null);
    try {
      await axios.put(`${API_URL}/shipment-stats/packers`, { packerName, userId: userId || null }, authHeaders(token));
      await charger();
      onChanged();
    } catch (err) {
      setErreur(err.response?.data?.error || 'Enregistrement impossible');
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.white, borderRadius: 16, padding: '22px 24px', width: 'min(620px, 100%)',
        maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.dark }}>Correspondance BMS</h3>
          <button onClick={onClose} aria-label="Fermer" style={{
            marginLeft: 'auto', border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: C.greyT,
          }}>×</button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: C.greyT, lineHeight: 1.5 }}>
          Le nom qui signe les colis emballés dans BMS, et le compte de l'app à qui les compter.
        </p>
        {erreur && <div style={{ color: C.red, fontSize: 13.5, marginBottom: 10 }}>{erreur}</div>}
        {!data && !erreur && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}
        {data && data.packers.length === 0 && (
          <div style={{ color: C.greyT, fontSize: 13.5 }}>Aucun colis BMS récupéré pour l'instant.</div>
        )}
        {data && data.packers.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><Th>Nom dans BMS</Th><Th align="right">Colis</Th><Th>Compte de l'app</Th></tr>
            </thead>
            <tbody>
              {data.packers.map(p => (
                <tr key={p.packer_name}>
                  <Td bold>
                    {p.packer_name}
                    {!p.user_id && <span style={{ marginLeft: 8 }}><Chip color={C.amber} bg={C.amberL}>Non rattaché</Chip></span>}
                  </Td>
                  <Td align="right">{nf.format(p.parcels)}</Td>
                  <Td>
                    <select
                      value={p.user_id || ''}
                      disabled={enCours === p.packer_name}
                      onChange={e => rattacher(p.packer_name, e.target.value)}
                      style={champ}
                    >
                      <option value="">— Aucun —</option>
                      {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ─── PAGE ──────────────────────────────────────────────── */
const ShipmentStatsApp = () => {
  const { token } = useContext(AuthContext);

  const [periode, setPeriode] = useState('today');
  const [from, setFrom] = useState(() => jourParis());
  const [to, setTo] = useState(() => jourParis());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [reglage, setReglage] = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    setErreur(null);
    try {
      const res = await axios.get(`${API_URL}/shipment-stats`, { ...authHeaders(token), params: { from, to } });
      setData(res.data);
    } catch (err) {
      setErreur(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  useEffect(() => { charger(); }, [charger]);

  const choisirPeriode = (p) => {
    setPeriode(p.key);
    setFrom(jourParis(p.from));
    setTo(jourParis(p.to ?? 0));
  };

  const t = data?.totals;
  const unJour = from === to;
  const pauseMin = data ? Math.round(data.pauseSeconds / 60) : 4;
  const moyenne = (seconds, intervals) => (intervals ? seconds / intervals : null);

  return (
    <AppShell currentPath="/stats-expedition">
      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px 60px' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: TEAL,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <ShipmentStatsIcon size={24} color="#fff" />
            </span>
            <h1 style={{
              margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary,
            }}>Stats d'expédition</h1>

            {/* Filtres : une seule rangée, au-dessus de tout */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {PERIODES.map(p => (
                <button key={p.key} onClick={() => choisirPeriode(p)} style={{
                  ...champ, cursor: 'pointer', fontWeight: 600,
                  background: periode === p.key ? TEAL : C.white,
                  color: periode === p.key ? '#fff' : C.dark,
                  borderColor: periode === p.key ? TEAL : C.greyB,
                }}>{p.label}</button>
              ))}
              <input type="date" value={from} max={to} style={champ}
                onChange={e => { setFrom(e.target.value); setPeriode(null); }} />
              <span style={{ color: C.greyT, fontSize: 13 }}>au</span>
              <input type="date" value={to} min={from} max={jourParis()} style={champ}
                onChange={e => { setTo(e.target.value); setPeriode(null); }} />
              <button onClick={() => setReglage(true)} style={{ ...champ, cursor: 'pointer', fontWeight: 600 }}>
                Correspondance BMS
              </button>
            </div>
          </div>

          {erreur && (
            <div style={{
              background: C.redL, borderLeft: `4px solid ${C.red}`, color: '#7F1D1D',
              padding: '12px 16px', borderRadius: 8, fontSize: 13.5, marginBottom: 16,
            }}>{erreur}</div>
          )}

          {!data && loading && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}

          {data && (
            <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
              {/* Chiffres clés */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <Tuile label="Colis expédiés" value={nf.format(t.parcels)}
                  sub={t.bms_parcels ? `dont ${nf.format(t.bms_parcels)} emballé${t.bms_parcels > 1 ? 's' : ''} dans BMS` : null} />
                <Tuile label="Articles emballés" value={nf.format(t.articles)} />
                <Tuile label="Articles par colis"
                  value={t.parcels ? (t.articles / t.parcels).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—'} />
                <Tuile label="Temps moyen par colis" value={duree(moyenne(t.seconds, t.intervals))}
                  sub={`sur ${nf.format(t.intervals)} intervalle${t.intervals > 1 ? 's' : ''} · pauses > ${pauseMin} min écartées`} />
                <Tuile label="Délai paiement → étiquette" value={dureeLongue(t.delay_median_s)}
                  sub={t.delay_orders ? `médiane sur ${nf.format(t.delay_orders)} commande${t.delay_orders > 1 ? 's' : ''}` : null} />
              </div>

              {/* Par personne */}
              <section style={carte}>
                <Titre sub={`Temps moyen = somme des écarts entre deux colis successifs d'une même vague ÷ nombre d'écarts (10 colis → 9 écarts). Le changement de vague n'est pas compté ; un écart de plus de ${pauseMin} min est une pause, écartée. Picking = temps actif des vagues terminées ÷ articles pickés (sans les manquants), même règle de pause.`}>
                  Par personne
                </Titre>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <Th>Personne</Th>
                        <Th align="right">Colis</Th>
                        <Th align="right">Dont BMS</Th>
                        <Th>Part des colis</Th>
                        <Th align="right">Articles</Th>
                        <Th>Part des articles</Th>
                        <Th align="right">Art./colis</Th>
                        <Th align="right">Temps moyen / colis</Th>
                        <Th align="right">Colis / heure</Th>
                        <Th align="right">Picking / article</Th>
                        {unJour && <Th align="right">1ʳᵉ étiquette</Th>}
                        {unJour && <Th align="right">Dernière</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.people.length === 0 && (
                        <tr><td colSpan={12} style={{ padding: '22px 16px', textAlign: 'center', color: C.greyT, fontSize: 13.5 }}>
                          Aucun colis sur la période.
                        </td></tr>
                      )}
                      {data.people.map((p, i) => {
                        const moy = moyenne(p.seconds, p.intervals);
                        return (
                          <tr key={p.who} style={{ background: i % 2 ? C.zebra : C.white }}>
                            <Td bold>
                              {p.name}
                              {p.unmapped && (
                                <div><Chip color={C.amber} bg={C.amberL}
                                  title="Nom BMS rattaché à aucun compte : voir « Correspondance BMS »">Nom BMS non rattaché</Chip></div>
                              )}
                            </Td>
                            <Td align="right" bold>{nf.format(p.parcels)}</Td>
                            <Td align="right" color={p.bms_parcels ? C.dark : C.greyM}>{p.bms_parcels ? nf.format(p.bms_parcels) : '—'}</Td>
                            <Td><Part value={p.parcels} total={t.parcels} /></Td>
                            <Td align="right">{nf.format(p.articles)}</Td>
                            <Td><Part value={p.articles} total={t.articles} /></Td>
                            <Td align="right">{p.parcels ? (p.articles / p.parcels).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—'}</Td>
                            <Td align="right">
                              <span title={`${p.intervals} écart(s) retenu(s), ${p.pauses} pause(s) écartée(s)`}>
                                {duree(moy)}
                              </span>
                              <div style={{ fontSize: 11.5, color: C.greyT }}>
                                {p.intervals} écart{p.intervals > 1 ? 's' : ''}{p.pauses ? ` · ${p.pauses} pause${p.pauses > 1 ? 's' : ''}` : ''}
                              </div>
                            </Td>
                            <Td align="right">{moy ? Math.round(3600 / moy) : '—'}</Td>
                            <Td align="right" color={p.picking?.articles ? C.dark : C.greyM}>
                              {p.picking?.articles ? (
                                <span title={`${p.picking.pauses} pause(s) écartée(s)`}>
                                  {(p.picking.seconds / p.picking.articles).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s
                                  <div style={{ fontSize: 11.5, color: C.greyT }}>
                                    {nf.format(p.picking.articles)} art. · {p.picking.waves} vague{p.picking.waves > 1 ? 's' : ''}
                                  </div>
                                </span>
                              ) : '—'}
                            </Td>
                            {unJour && <Td align="right" color={C.greyT}>{p.first_at || '—'}</Td>}
                            {unJour && <Td align="right" color={C.greyT}>{p.last_at || '—'}</Td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                {/* Colis par heure */}
                <section style={{ ...carte, marginBottom: 0 }}>
                  <Titre sub={unJour ? 'Heure de l’étiquette, heure de Paris' : 'Heure de l’étiquette, tous les jours de la période cumulés'}>
                    Colis par heure
                  </Titre>
                  <ColisParHeure hours={data.hours} />
                </section>

                {/* Par transporteur */}
                <section style={{ ...carte, marginBottom: 0 }}>
                  <Titre>Par transporteur</Titre>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {data.carriers.length === 0 && (
                        <tr><td style={{ padding: '8px 16px 18px', color: C.greyT, fontSize: 13.5 }}>Aucun colis.</td></tr>
                      )}
                      {data.carriers.map(c => (
                        <tr key={c.carrier_key}>
                          <Td><CarrierLogo carrier={{ carrierCode: c.carrier_code, accountCode: c.account_code, status: 'unknown' }} height={18} /></Td>
                          <Td align="right" bold>{nf.format(c.parcels)}</Td>
                          <Td><Part value={c.parcels} total={t.parcels} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {/* Incidents */}
                <section style={{ ...carte, marginBottom: 0 }}>
                  <Titre sub="Déclarés au Packing de l'app sur la période : BMS ne les transmet pas">Incidents</Titre>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {[
                        ['Commandes envoyées incomplètes', data.incidents.incomplete],
                        ['Commandes mises de côté', data.incidents.setAside],
                        ['Étiquettes annulées', data.incidents.cancelled],
                      ].map(([label, n]) => (
                        <tr key={label}>
                          <Td>{label}</Td>
                          <Td align="right" bold color={n ? C.dark : C.greyM}>{nf.format(n)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            </div>
          )}
        </div>
      </main>

      {reglage && <CorrespondanceBms token={token} onClose={() => setReglage(false)} onChanged={charger} />}
    </AppShell>
  );
};

export default ShipmentStatsApp;
