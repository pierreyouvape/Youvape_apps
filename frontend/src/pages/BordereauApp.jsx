import { Fragment, useState, useEffect, useContext, useCallback } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Bordereau as BordereauIcon } from '../components/AppIcons';

/**
 * Bordereau de dépôt — groupe « Prépa de commande ».
 *
 * Le bordereau est le papier que le chauffeur signe en emportant les colis. Il
 * était produit dans BMS ; cette app le produit pour les étiquettes émises par
 * l'app depuis le lot 2.
 *
 * Trois choix d'écran, tranchés avec Pierre le 21-22/09/2026 :
 *   - **une date de départ, comme BMS** — pas « tout ce qui n'est pas déposé » :
 *     les colis d'avant la bascule ont été déposés via BMS sans que notre base
 *     le sache ;
 *   - **on prend tout ce qui est affiché** — aucune case à cocher colis par
 *     colis ;
 *   - **le nombre de bordereaux est annoncé AVANT** de générer : au-delà de la
 *     limite du transporteur, il en faut plusieurs, et une personne qui attend
 *     un papier n'en cherche pas un second.
 *
 * L'impression est manuelle (le PDF se télécharge). Le nom du fichier respecte
 * quand même la convention `bordereau_<numéro>.pdf`, pour qu'une règle AutoPrint
 * puisse être posée sur les postes sans qu'on retouche le code.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  teal: '#0E7490', tealL: '#ECFEFF',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF', zebra: '#F4F7F9',
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Date du jour à Paris (AAAA-MM-JJ). Le serveur tourne en UTC : toISOString()
 *  donnerait la veille chaque soir d'été, et l'écran s'ouvrirait trop large. */
const aujourdhuiParis = () =>
  new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const SINCE_KEY = 'yv.bordereau.since';
const CARRIER_KEY = 'yv.bordereau.carrier';

/** Pour l'historique : les lignes anciennes ne portent que le code. */
const LIBELLES_TRANSPORTEUR = {
  colissimo: 'Colissimo',
  mondial_relay: 'Mondial Relay',
  chronopost: 'Chronopost',
  laposte: 'La Poste',
};

/** Un transporteur PLUS un contrat : un bordereau ne mélange jamais les deux. */
const cleSection = (s) => `${s.carrierCode}/${s.accountCode}`;

/** Le contrat n'est nommé que s'il y en a plusieurs : sinon c'est du bruit. */
const nomSection = (s, toutes = []) =>
  toutes.filter(x => x.carrierCode === s.carrierCode).length > 1
    ? `${s.carrierLabel} — contrat ${s.accountCode}`
    : s.carrierLabel;

const fmtDateHeure = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const fmtHeure = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const fmtJour = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

/** Télécharge un PDF base64 sous le nom donné par le backend (AutoPrint lit ce nom). */
const telechargerPdf = (base64, fileName) => {
  const octets = atob(base64);
  const tableau = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) tableau[i] = octets.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([tableau], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'bordereau.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Th({ children, align = 'left', width }) {
  return <th style={{
    padding: '10px 14px', textAlign: align, width, fontWeight: 700, color: C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
  }}>{children}</th>;
}

function Td({ children, align = 'left', bold, color, style }) {
  return <td style={{
    padding: '10px 14px', textAlign: align, color: color || C.dark,
    fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, ...style,
  }}>{children}</td>;
}

function Btn({ children, onClick, variant = 'primary', disabled, small, title }) {
  const variants = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant],
      padding: small ? '6px 12px' : '10px 18px',
      borderRadius: 8, fontWeight: 600, fontSize: small ? 12.5 : 14,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
      whiteSpace: 'nowrap', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function Bandeau({ ton = 'info', children }) {
  const tons = {
    info:    { bg: C.tealL,  bd: C.teal,  fg: '#0F3F4A' },
    succes:  { bg: C.greenL, bd: C.green, fg: '#14532D' },
    alerte:  { bg: C.accentL, bd: C.accent, fg: '#7C4A03' },
    erreur:  { bg: C.redL,   bd: C.red,   fg: '#7F1D1D' },
  }[ton];
  return (
    <div style={{
      background: tons.bg, borderLeft: `4px solid ${tons.bd}`, color: tons.fg,
      padding: '12px 16px', borderRadius: 8, fontSize: 13.5, lineHeight: 1.5,
      marginBottom: 16,
    }}>{children}</div>
  );
}

/* ─── PAGE ──────────────────────────────────────────────── */
const BordereauApp = () => {
  const { token } = useContext(AuthContext);

  const [since, setSince] = useState(() => {
    try { return localStorage.getItem(SINCE_KEY) || aujourdhuiParis(); }
    catch { return aujourdhuiParis(); }
  });
  const [sections, setSections] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [choix, setChoix] = useState(() => {
    try { return localStorage.getItem(CARRIER_KEY) || null; } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [enCours, setEnCours] = useState(null);        // code transporteur en génération
  const [confirmation, setConfirmation] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [colisOuverts, setColisOuverts] = useState({}); // id bordereau -> colis
  const [reimpression, setReimpression] = useState(null);

  const chargerPending = useCallback(async (date) => {
    setLoading(true);
    setErreur(null);
    try {
      const res = await axios.get(`${API_URL}/bordereaux/pending`, {
        ...authHeaders(token), params: { since: date },
      });
      const liste = res.data.sections || [];
      setSections(liste);
      setPlanned(res.data.planned || []);
      // Le choix enregistré prime, tant qu'il existe encore. Sinon on ouvre sur
      // le transporteur qui a des colis : c'est celui qu'on vient déposer.
      setChoix(prev => {
        if (prev && liste.some(s2 => cleSection(s2) === prev)) return prev;
        const avecColis = liste.find(s2 => s2.parcels.length > 0) || liste[0];
        return avecColis ? cleSection(avecColis) : null;
      });
    } catch (err) {
      setSections([]);
      setPlanned([]);
      setErreur(err.response?.data?.userMessage || err.response?.data?.details
        || err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const chargerHistorique = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/bordereaux/history`, {
        ...authHeaders(token), params: { limit: 30 },
      });
      setHistorique(res.data || []);
    } catch {
      // L'historique n'est pas vital : son absence ne doit pas masquer la liste
      // des colis à déposer, qui est le travail du jour.
      setHistorique([]);
    }
  }, [token]);

  useEffect(() => { chargerPending(since); chargerHistorique(); }, [chargerPending, chargerHistorique, since]);

  const changerTransporteur = (valeur) => {
    if (String(valeur).startsWith('planned:')) return;
    setChoix(valeur);
    setResultat(null);
    try { localStorage.setItem(CARRIER_KEY, valeur); } catch { /* navigation privée */ }
  };

  const changerDate = (valeur) => {
    setSince(valeur);
    setResultat(null);
    try { localStorage.setItem(SINCE_KEY, valeur); } catch { /* navigation privée */ }
  };

  /** Télécharge les bordereaux produits, un fichier par bordereau. */
  const telechargerBordereaux = useCallback(async (crees) => {
    for (const b of crees) {
      try {
        const res = await axios.get(`${API_URL}/bordereaux/${b.id}/pdf`, authHeaders(token));
        telechargerPdf(res.data.pdfBase64, res.data.fileName);
      } catch {
        // Le bordereau existe et reste réimprimable depuis l'historique : on ne
        // fait pas échouer la génération pour un téléchargement raté.
      }
    }
  }, [token]);

  const genererMaintenant = useCallback(async (section) => {
    setConfirmation(null);
    setEnCours(`${section.carrierCode}/${section.accountCode}`);
    setErreur(null);
    setResultat(null);
    try {
      const res = await axios.post(`${API_URL}/bordereaux/generate`, {
        carrierCode: section.carrierCode,
        accountCode: section.accountCode,
        since,
      }, authHeaders(token));

      setResultat(res.data);
      if (res.data.created?.length) await telechargerBordereaux(res.data.created);
      await chargerPending(since);
      await chargerHistorique();
    } catch (err) {
      setErreur(err.response?.data?.userMessage || err.response?.data?.details
        || err.response?.data?.error || 'Erreur lors de la génération');
    } finally {
      setEnCours(null);
    }
  }, [since, token, telechargerBordereaux, chargerPending, chargerHistorique]);

  const voirColis = useCallback(async (bordereau) => {
    if (colisOuverts[bordereau.id]) {
      setColisOuverts(prev => { const n = { ...prev }; delete n[bordereau.id]; return n; });
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/bordereaux/${bordereau.id}/labels`, authHeaders(token));
      setColisOuverts(prev => ({ ...prev, [bordereau.id]: res.data || [] }));
    } catch {
      setColisOuverts(prev => ({ ...prev, [bordereau.id]: [] }));
    }
  }, [token, colisOuverts]);

  const reimprimer = useCallback(async (bordereau) => {
    setReimpression(bordereau.id);
    try {
      const res = await axios.get(`${API_URL}/bordereaux/${bordereau.id}/pdf`, authHeaders(token));
      telechargerPdf(res.data.pdfBase64, res.data.fileName);
    } catch (err) {
      alert(err.response?.data?.userMessage || err.response?.data?.error || 'Erreur de réimpression');
    } finally {
      setReimpression(null);
    }
  }, [token]);

  const totalADeposer = sections.reduce((n, s) => n + s.parcels.length, 0);
  const section = sections.find(s2 => cleSection(s2) === choix) || null;

  return (
    <AppShell currentPath="/bordereau">
      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey,
      }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 60px' }}>

          {/* En-tête */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: C.teal,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <BordereauIcon size={24} color="#fff" />
            </span>
            <h1 style={{
              margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26,
              fontWeight: 900, color: C.primary,
            }}>Bordereau de dépôt</h1>
          </div>
          <p style={{ margin: '0 0 22px', color: C.greyT, fontSize: 13.5, lineHeight: 1.5 }}>
            Le papier que le chauffeur signe en emportant les colis. Il porte les colis
            étiquetés <strong>par l'app</strong> depuis la date choisie et <strong>pas encore déposés</strong> —
            ceux déposés via BMS n'y figurent jamais. Colissimo émet son bordereau ;
            pour les transporteurs qui n'en produisent pas, l'app édite un récapitulatif
            de remise à faire signer.
          </p>

          {/* Date de départ */}
          <div style={{
            background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12,
            padding: '16px 18px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <label style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>
              Colis étiquetés depuis le
            </label>
            <input
              type="date"
              value={since}
              max={aujourdhuiParis()}
              onChange={e => changerDate(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
                fontSize: 14, fontFamily: 'inherit', color: C.dark,
              }}
            />
            <Btn variant="ghost" small onClick={() => chargerPending(since)} disabled={loading}>
              {loading ? 'Chargement…' : 'Actualiser'}
            </Btn>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: C.greyT }}>
              {totalADeposer} colis à déposer
            </span>
          </div>

          {erreur && <Bandeau ton="erreur">{erreur}</Bandeau>}

          {/* Résultat de la dernière génération */}
          {resultat && (
            <Bandeau ton={resultat.stopped ? 'erreur' : (resultat.failed?.length ? 'alerte' : 'succes')}>
              <div style={{ fontWeight: 700, marginBottom: resultat.created?.length ? 6 : 0 }}>
                {resultat.message}
              </div>
              {resultat.created?.map(b => (
                <div key={b.id} style={{ fontSize: 13 }}>
                  Bordereau <strong>{b.number}</strong> — {b.parcelCount} colis — fichier <code>{b.fileName}</code>
                </div>
              ))}
              {resultat.failed?.map(f => (
                <div key={f.index} style={{ fontSize: 13, marginTop: 6 }}>
                  Lot {f.index} ({f.parcelCount} colis) : {f.message}
                </div>
              ))}
            </Bandeau>
          )}

          {/* Le choix du transporteur. Un menu plutôt que des sections empilées :
              on dépose chez un transporteur à la fois, et les colis d'un autre
              au milieu de l'écran ne font que brouiller le comptage. */}
          {sections.length === 0 && !loading && (
            <Bandeau ton="info">
              Aucun transporteur ne produit de bordereau pour l'instant.
            </Bandeau>
          )}

          {sections.length > 0 && (
            <div style={{
              background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12,
              padding: '16px 18px', marginBottom: 20,
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <label style={{ fontSize: 13.5, fontWeight: 600, color: C.dark }}>Transporteur</label>
              <select
                value={choix || ''}
                onChange={e => changerTransporteur(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
                  fontSize: 14, fontFamily: 'inherit', color: C.dark, background: C.white,
                  minWidth: 260,
                }}
              >
                {sections.map(s2 => (
                  <option key={cleSection(s2)} value={cleSection(s2)}>
                    {nomSection(s2, sections)} — {s2.parcels.length} colis
                  </option>
                ))}
                {/* Annoncés, mais sans colis : dire pourquoi vaut mieux que
                    laisser chercher. */}
                {planned.map(p => (
                  <option key={p.carrierCode} value={`planned:${p.carrierCode}`} disabled>
                    {p.carrierLabel} — pas encore étiqueté par l'app
                  </option>
                ))}
              </select>
              {section && (
                <span style={{ fontSize: 12.5, color: C.greyT }}>
                  {section.kind === 'local'
                    ? "Récapitulatif produit par l'app : ce transporteur n'émet pas de bordereau."
                    : 'Bordereau émis par le transporteur.'}
                </span>
              )}
            </div>
          )}

          {planned.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.greyT, margin: '-8px 0 18px' }}>
              {planned.map(p => <div key={p.carrierCode}>{p.carrierLabel} : {p.reason}</div>)}
            </div>
          )}

          {section && (
            <section style={{
              background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12,
              marginBottom: 20, overflow: 'hidden',
            }}>
              <header style={{
                padding: '14px 18px', borderBottom: `1px solid ${C.greyB}`,
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.dark }}>
                  {nomSection(section, sections)}
                </h2>
                <span style={{
                  fontSize: 12, fontWeight: 700, color: C.teal, background: C.tealL,
                  padding: '4px 10px', borderRadius: 99,
                }}>
                  {section.parcels.length} colis
                  {section.bordereauCount > 1 && ` → ${section.bordereauCount} bordereaux`}
                </span>
                <div style={{ marginLeft: 'auto' }}>
                  <Btn
                    onClick={() => setConfirmation(section)}
                    disabled={section.parcels.length === 0 || enCours === cleSection(section)}
                  >
                    {enCours === cleSection(section)
                      ? 'Génération…'
                      : (section.kind === 'local' ? 'Générer le récapitulatif' : 'Générer le bordereau')}
                  </Btn>
                </div>
              </header>

              {section.parcels.length === 0 ? (
                <div style={{ padding: '22px 18px', color: C.greyT, fontSize: 13.5 }}>
                  Aucun colis à déposer depuis le {fmtJour(since)}.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <Th>Commande</Th>
                        <Th>N° de suivi</Th>
                        <Th>Produit</Th>
                        <Th>Étiquetée</Th>
                        <Th>Par</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.parcels.map((p, i) => (
                        <tr key={p.id} style={{ background: i % 2 ? C.zebra : C.white }}>
                          <Td bold>#{p.order_number}</Td>
                          <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{p.tracking_number}</Td>
                          <Td color={C.greyT}>{p.method_code || '—'}</Td>
                          <Td color={C.greyT}>{fmtJour(p.created_at)} {fmtHeure(p.created_at)}</Td>
                          <Td color={C.greyT}>{p.packer_name || '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Historique */}
          <h2 style={{
            margin: '32px 0 12px', fontSize: 16, fontWeight: 800, color: C.dark,
          }}>Bordereaux déjà émis</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: C.greyT }}>
            Le transporteur ne sait pas reproduire un bordereau : c'est ici qu'on réimprime
            celui que le chauffeur redemande.
          </p>

          {historique.length === 0 ? (
            <div style={{
              background: C.white, border: `1px dashed ${C.greyB}`, borderRadius: 12,
              padding: '22px 18px', color: C.greyT, fontSize: 13.5,
            }}>Aucun bordereau émis pour l'instant.</div>
          ) : (
            <div style={{
              background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <Th>N° de bordereau</Th>
                      <Th>Transporteur</Th>
                      <Th align="right">Colis</Th>
                      <Th>Généré le</Th>
                      <Th>Par</Th>
                      <Th align="right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {historique.map((b, i) => (
                      <Fragment key={b.id}>
                        <tr style={{ background: i % 2 ? C.zebra : C.white }}>
                          <Td bold>{b.bordereau_number}</Td>
                          <Td color={C.greyT}>{LIBELLES_TRANSPORTEUR[b.carrier_code] || b.carrier_code}</Td>
                          <Td align="right">{b.parcel_count}</Td>
                          <Td color={C.greyT}>{fmtDateHeure(b.created_at)}</Td>
                          <Td color={C.greyT}>{b.created_by_name || '—'}</Td>
                          <Td align="right">
                            <span style={{ display: 'inline-flex', gap: 8 }}>
                              <Btn variant="ghost" small onClick={() => voirColis(b)}>
                                {colisOuverts[b.id] ? 'Masquer' : 'Colis'}
                              </Btn>
                              <Btn
                                variant="accent" small
                                onClick={() => reimprimer(b)}
                                disabled={!b.has_pdf || reimpression === b.id}
                                title={b.has_pdf ? 'Retélécharger le PDF' : 'Aucun PDF enregistré'}
                              >
                                {reimpression === b.id ? '…' : 'Réimprimer'}
                              </Btn>
                            </span>
                          </Td>
                        </tr>
                        {colisOuverts[b.id] && (
                          <tr>
                            <td colSpan={6} style={{
                              padding: '10px 14px', background: C.grey,
                              borderBottom: `1px solid ${C.greyB}`, fontSize: 12.5, color: C.greyT,
                            }}>
                              {colisOuverts[b.id].length === 0
                                ? 'Aucun colis rattaché.'
                                : colisOuverts[b.id].map(c => (
                                  <span key={c.id} style={{ display: 'inline-block', marginRight: 14 }}>
                                    #{c.order_number} <span style={{ fontFamily: 'ui-monospace, monospace' }}>{c.tracking_number}</span>
                                    {c.status !== 'active' && <em> (annulée)</em>}
                                  </span>
                                ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Confirmation — le nombre de bordereaux est annoncé AVANT d'agir */}
      {confirmation && (
        <div
          onClick={() => setConfirmation(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: C.white, borderRadius: 16, padding: '24px 26px',
            width: 'min(520px, 100%)', boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800, color: C.dark }}>
              {confirmation.kind === 'local' ? 'Générer le récapitulatif' : 'Générer le bordereau'}
              {' '}{confirmation.carrierLabel} ?
            </h3>
            <p style={{ margin: '0 0 8px', fontSize: 14, color: C.dark, lineHeight: 1.55 }}>
              {confirmation.parcels.length} colis
              {confirmation.bordereauCount > 1
                ? ` → ${confirmation.bordereauCount} bordereaux (${confirmation.maxParcels} colis maximum par bordereau chez ${confirmation.carrierLabel}). Chacun a son numéro et s'imprime séparément.`
                : (confirmation.kind === 'local' ? ' → 1 récapitulatif.' : ' → 1 bordereau.')}
            </p>
            {confirmation.kind === 'local' && (
              <p style={{ margin: '0 0 8px', fontSize: 13, color: C.greyT, lineHeight: 1.55 }}>
                {confirmation.carrierLabel} n'émet pas de bordereau par API : le document est
                produit par l'app — la liste des colis et une case pour la signature du
                chauffeur. Il prouve la remise, il ne vient pas de chez eux.
              </p>
            )}
            <p style={{ margin: '0 0 20px', fontSize: 13, color: C.greyT, lineHeight: 1.55 }}>
              Tous les colis affichés partent sur le document. Ils n'y reviendront plus :
              un colis ne figure que dans un seul bordereau.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setConfirmation(null)}>Annuler</Btn>
              <Btn onClick={() => genererMaintenant(confirmation)}>
                Générer {confirmation.bordereauCount > 1
                  ? `les ${confirmation.bordereauCount} bordereaux`
                  : (confirmation.kind === 'local' ? 'le récapitulatif' : 'le bordereau')}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default BordereauApp;
