import { useState, useEffect, useContext, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { ShipmentHistory as ShipmentHistoryIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C, CarrierLogo, CountryFlag, Chip } from '../components/picking/pickingUi';
import { codesTransporteurs, visuelTransporteur } from '../utils/carrierVisuals';

/**
 * Historique d'expédition — groupe « Prépa de commande ».
 *
 * Un colis par ligne (une étiquette), avec qui l'a pické, qui l'a packé, ce
 * qui s'est mal passé, et s'il est parti sur un bordereau. Le clic sur une
 * ligne ouvre son parcours complet.
 *
 * Les colis emballés dans BMS (`source = 'bms'`) sont listés aussi, mention
 * « BMS », sans aucune action : leur étiquette est chez BMS.
 *
 * Les actions passent par les routes `/laposte/labels/:id/*`, communes à tous
 * les transporteurs, celles du packing : la réimpression télécharge le même
 * nom de fichier qu'au packing, donc AutoPrint l'envoie sur la bonne imprimante.
 */

const TEAL = '#0F766E';

/** Date du jour à Paris (AAAA-MM-JJ) : toISOString() donnerait la veille le soir. */
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

const STATUTS = [
  { value: '', label: 'Tous les colis' },
  { value: 'incident', label: 'Avec incident' },
  { value: 'bms_pending', label: 'BMS non confirmé' },
  { value: 'not_deposited', label: 'Pas encore déposé' },
  { value: 'cancelled', label: 'Annulées' },
  { value: 'bms', label: 'Emballés dans BMS' },
];

/** Les clés de l'API : 2Shop se distingue de Chronopost par son contrat. */
const TRANSPORTEURS = [
  ...codesTransporteurs().map(code => ({ key: code, carrierCode: code })),
  { key: 'chronopost_2shop', carrierCode: 'chronopost', accountCode: '2shop' },
].map(t => ({ ...t, label: visuelTransporteur(t.carrierCode, t.accountCode).label }));

const fmtDateHeure = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

const telechargerPdf = (base64, fileName) => {
  const octets = atob(base64);
  const tableau = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) tableau[i] = octets.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([tableau], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'etiquette.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const erreurApi = (err, repli) =>
  err.response?.data?.details || err.response?.data?.error || repli;

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
function Th({ children, align = 'left' }) {
  return <th style={{
    padding: '10px 12px', textAlign: align, fontWeight: 700, color: C.greyT,
    fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap',
  }}>{children}</th>;
}

function Td({ children, align = 'left', bold, color, style }) {
  return <td style={{
    padding: '9px 12px', textAlign: align, color: color || C.dark,
    fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5, ...style,
  }}>{children}</td>;
}

function Btn({ children, onClick, variant = 'primary', disabled, small, title }) {
  const variants = {
    primary: { background: TEAL, color: '#fff', border: 'none' },
    danger:  { background: C.red, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.dark, border: `1px solid ${C.greyB}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant],
      padding: small ? '5px 10px' : '8px 16px',
      borderRadius: 8, fontWeight: 600, fontSize: small ? 12.5 : 13.5,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

const champ = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.greyB}`,
  fontSize: 13.5, fontFamily: 'inherit', color: C.dark, background: C.white,
};

function Kpi({ label, value, color, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      flex: '1 1 150px', textAlign: 'left', background: C.white, cursor: onClick ? 'pointer' : 'default',
      border: `1px solid ${active ? color : C.greyB}`, boxShadow: active ? `0 0 0 1px ${color}` : 'none',
      borderRadius: 12, padding: '12px 16px', fontFamily: 'inherit',
    }}>
      <div style={{ fontSize: 12, color: C.greyT, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: value ? color : C.greyM }}>{value ?? '—'}</div>
    </button>
  );
}

/** Les pastilles d'état d'un colis. */
function Etats({ row, vide = null }) {
  const chips = [];
  if (row.source === 'bms') {
    chips.push(<Chip key="bms" color={C.greyT} bg={C.greyB} title="Emballé et expédié dans BMS">BMS</Chip>);
  }
  if (row.status === 'cancelled') chips.push(<Chip key="c" color={C.red} bg={C.redL}>Annulée</Chip>);
  if (row.status === 'active' && row.bms_ship_status === 'pending') {
    chips.push(<Chip key="b" color={C.amber} bg={C.amberL}
      title={`${row.bms_attempts || 0} tentative(s). Dernière erreur : ${row.bms_last_error || 'aucune'}`}>BMS non confirmé</Chip>);
  }
  (row.incidents || []).forEach(a => chips.push(
    <Chip key={a} color={C.red} bg={C.redL}>{a === 'set_aside' ? 'Mise de côté' : 'Incomplète'}</Chip>
  ));
  if (row.bordereau_number) {
    chips.push(<Chip key="d" color={C.green} bg={C.greenL} title={`Bordereau ${row.bordereau_number}`}>Déposée</Chip>);
  }
  if (row.method_code && String(row.method_code).endsWith('-SAMEDI')) {
    chips.push(<Chip key="s" color="#1f2937" bg="#FFCC00">Samedi</Chip>);
  }
  if (chips.length === 0) return vide;
  return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{chips}</span>;
}

const COULEURS_ETAPE = {
  order: C.primary, wave: C.violet, pick: C.violet, incident: C.red,
  label: TEAL, bms: C.green, deposit: C.green, cancel: C.red,
};

/* ─── PANNEAU « PARCOURS » ──────────────────────────────── */
function Parcours({ id, source, token, onClose, onChanged, reimprimer, reimpression }) {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [action, setAction] = useState(null);
  const [confirmAnnul, setConfirmAnnul] = useState(false);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const chemin = source === 'bms' ? `bms/${id}` : id;
      const res = await axios.get(`${API_URL}/shipment-history/${chemin}`, authHeaders(token));
      setData(res.data);
    } catch (err) {
      setErreur(erreurApi(err, 'Erreur de chargement'));
    }
  }, [id, source, token]);

  useEffect(() => { setData(null); setConfirmAnnul(false); charger(); }, [charger]);

  const confirmerBms = async () => {
    setAction('bms');
    try {
      await axios.post(`${API_URL}/laposte/labels/${id}/confirm-bms`, {}, authHeaders(token));
      await charger();
      onChanged();
    } catch (err) {
      alert(erreurApi(err, 'Confirmation BMS impossible'));
    } finally {
      setAction(null);
    }
  };

  const annuler = async () => {
    setAction('cancel');
    try {
      await axios.post(`${API_URL}/laposte/labels/${id}/cancel`, {}, authHeaders(token));
      setConfirmAnnul(false);
      await charger();
      onChanged();
    } catch (err) {
      alert(erreurApi(err, "Annulation de l'étiquette impossible"));
    } finally {
      setAction(null);
    }
  };

  const l = data?.label;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(15,23,42,0.35)' }}>
      <aside onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(480px, 100%)',
        background: C.white, boxShadow: '-12px 0 40px rgba(0,0,0,0.18)', overflowY: 'auto',
        padding: '22px 24px 40px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.dark }}>
            {l ? `Commande #${l.order_number}` : 'Colis'}
          </h2>
          <button onClick={onClose} aria-label="Fermer" style={{
            marginLeft: 'auto', border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: C.greyT,
          }}>×</button>
        </div>

        {erreur && <div style={{ color: C.red, fontSize: 13.5 }}>{erreur}</div>}
        {!data && !erreur && <div style={{ color: C.greyT, fontSize: 13.5 }}>Chargement…</div>}

        {l && (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13.5,
              background: C.grey, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14,
            }}>
              <span style={{ color: C.greyT }}>Client</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <CountryFlag code={l.country} size={14} /> {l.customer_name || '—'}
              </span>
              <span style={{ color: C.greyT }}>Transporteur</span>
              <span><CarrierLogo carrier={{ carrierCode: l.carrier_code, accountCode: l.account_code }} height={18} /></span>
              <span style={{ color: C.greyT }}>Mode</span>
              <span>{l.shipping_method || l.method_code || '—'}</span>
              <span style={{ color: C.greyT }}>N° de suivi</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{l.tracking_number || '—'}</span>
              <span style={{ color: C.greyT }}>État</span>
              <span><Etats row={l} vide="—" /></span>
            </div>

            {l.source === 'bms' && (
              <p style={{ margin: '0 0 12px', fontSize: 13, color: C.greyT, lineHeight: 1.5 }}>
                Colis emballé et expédié dans BMS : l'étiquette, sa réimpression et son
                annulation se gèrent dans BMS.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {l.source !== 'bms' && (
              <Btn onClick={() => reimprimer(l)} disabled={l.status === 'cancelled' || reimpression === l.id}>
                {reimpression === l.id ? 'Téléchargement…' : `Réimprimer${l.has_cn23 ? ' (+ CN23)' : ''}`}
              </Btn>
              )}
              {l.status === 'active' && l.bms_ship_status === 'pending' && (
                <Btn variant="accent" onClick={confirmerBms} disabled={action === 'bms'}
                  title="Rejouer la confirmation d'expédition dans BMS">
                  {action === 'bms' ? '…' : 'Confirmer BMS'}
                </Btn>
              )}
              {l.source !== 'bms' && l.status === 'active' && (
                <Btn variant="ghost" onClick={() => setConfirmAnnul(true)} disabled={!l.cancellable}
                  title={l.cancellable ? "Annuler l'étiquette chez le transporteur" : l.cancel_reason}>
                  Annuler l'étiquette
                </Btn>
              )}
              <Link to={`/orders/${l.order_number}`} style={{
                ...champ, textDecoration: 'none', fontWeight: 600, padding: '8px 14px',
              }}>Fiche commande</Link>
            </div>

            {confirmAnnul && (
              <div style={{
                background: C.redL, border: `1px solid ${C.red}`, borderRadius: 10,
                padding: '12px 14px', marginBottom: 20, fontSize: 13.5, color: '#7F1D1D',
              }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  Annuler l'étiquette de la commande #{l.order_number} ? C'est définitif.
                </div>
                {/* Annuler l'étiquette ne défait pas l'expédition déjà enregistrée dans BMS. */}
                {l.bms_ship_status === 'confirmed' && (
                  <div style={{ fontWeight: 700, color: C.red, marginBottom: 8 }}>
                    L'expédition est confirmée dans BMS : il faut aussi l'annuler à la main dans BMS.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="ghost" small onClick={() => setConfirmAnnul(false)}>Non</Btn>
                  <Btn variant="danger" small onClick={annuler} disabled={action === 'cancel'}>
                    {action === 'cancel' ? 'Annulation…' : "Oui, annuler l'étiquette"}
                  </Btn>
                </div>
              </div>
            )}

            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: C.dark }}>Parcours</h3>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.timeline.map((e, i) => (
                <li key={i} style={{ display: 'flex', gap: 12, paddingBottom: 14, position: 'relative' }}>
                  {i < data.timeline.length - 1 && (
                    <span style={{ position: 'absolute', left: 5, top: 14, bottom: 0, width: 2, background: C.greyB }} />
                  )}
                  <span style={{
                    width: 12, height: 12, borderRadius: 99, marginTop: 3, flexShrink: 0,
                    background: COULEURS_ETAPE[e.kind] || C.greyM, position: 'relative',
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.dark }}>{e.title}</div>
                    <div style={{ fontSize: 12.5, color: C.greyT }}>
                      {fmtDateHeure(e.at)}{e.by && <> · <strong style={{ color: C.dark }}>{e.by}</strong></>}
                    </div>
                    {e.detail && <div style={{ fontSize: 12.5, color: C.dark, marginTop: 2 }}>{e.detail}</div>}
                  </div>
                </li>
              ))}
            </ol>
            {!data.wave && (
              <p style={{ fontSize: 12.5, color: C.greyT, margin: '4px 0 0' }}>
                {l.source === 'bms'
                  ? 'Préparé dans BMS : la vague et le picking ne sont pas connus de l\'app.'
                  : 'Aucune vague de l\'app pour ce colis : il a été préparé hors de l\'app Picking.'}
              </p>
            )}

            {data.otherLabels.length > 0 && (
              <>
                <h3 style={{ margin: '22px 0 8px', fontSize: 14, fontWeight: 800, color: C.dark }}>
                  Autres étiquettes de cette commande
                </h3>
                {data.otherLabels.map(o => (
                  <div key={`${o.source}-${o.id}`} style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5,
                    padding: '6px 0', borderBottom: `1px solid ${C.greyB}`,
                  }}>
                    <span style={{ color: C.greyT, width: 90 }}>{fmtDateHeure(o.created_at)}</span>
                    <CarrierLogo carrier={{ carrierCode: o.carrier_code, accountCode: o.account_code }} height={14} />
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{o.tracking_number || '—'}</span>
                    {o.source === 'bms' && <Chip color={C.greyT} bg={C.greyB}>BMS</Chip>}
                    {o.status === 'cancelled' && <Chip color={C.red} bg={C.redL}>Annulée</Chip>}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/* ─── PAGE ──────────────────────────────────────────────── */
const ShipmentHistoryApp = () => {
  const { token } = useContext(AuthContext);

  const [periode, setPeriode] = useState('7d');
  const [from, setFrom] = useState(() => jourParis(-6));
  const [to, setTo] = useState(() => jourParis());
  const [carrier, setCarrier] = useState('');
  const [user, setUser] = useState('');
  const [status, setStatus] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const [reimpression, setReimpression] = useState(null);

  // La recherche part après la frappe, pas à chaque touche.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const charger = useCallback(async () => {
    setLoading(true);
    setErreur(null);
    try {
      const res = await axios.get(`${API_URL}/shipment-history`, {
        ...authHeaders(token),
        params: { from, to, carrier: carrier || undefined, user: user || undefined, status: status || undefined, q: q || undefined, page },
      });
      setData(res.data);
    } catch (err) {
      setErreur(erreurApi(err, 'Erreur de chargement'));
    } finally {
      setLoading(false);
    }
  }, [token, from, to, carrier, user, status, q, page]);

  useEffect(() => { charger(); }, [charger]);

  const choisirPeriode = (p) => {
    setPeriode(p.key);
    setFrom(jourParis(p.from));
    setTo(jourParis(p.to ?? 0));
    setPage(1);
  };

  const filtre = (setter) => (valeur) => { setter(valeur); setPage(1); };

  const reimprimer = useCallback(async (label) => {
    setReimpression(label.id);
    try {
      const res = await axios.get(`${API_URL}/laposte/labels/${label.id}/pdf`, authHeaders(token));
      telechargerPdf(res.data.pdfBase64, res.data.fileName);
      // Un colis outre-mer ne part pas sans sa CN23 : elle se réimprime avec.
      if (res.data.cn23Base64) telechargerPdf(res.data.cn23Base64, res.data.cn23FileName);
    } catch (err) {
      alert(erreurApi(err, 'Erreur de récupération du PDF'));
    } finally {
      setReimpression(null);
    }
  }, [token]);

  const totals = data?.totals;
  const pages = data ? Math.max(1, Math.ceil(totals.total / data.pageSize)) : 1;
  const users = data?.users || [];

  return (
    <AppShell currentPath="/expeditions">
      <main className="main-scroll" style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey,
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px 60px' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: TEAL,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <ShipmentHistoryIcon size={24} color="#fff" />
            </span>
            <h1 style={{
              margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary,
            }}>Historique d'expédition</h1>
          </div>

          {/* Filtres */}
          <div style={{
            background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12,
            padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {PERIODES.map(p => (
                <button key={p.key} onClick={() => choisirPeriode(p)} disabled={!!q} style={{
                  ...champ, cursor: q ? 'not-allowed' : 'pointer', fontWeight: 600,
                  background: periode === p.key && !q ? TEAL : C.white,
                  color: periode === p.key && !q ? '#fff' : C.dark,
                  borderColor: periode === p.key && !q ? TEAL : C.greyB, opacity: q ? 0.5 : 1,
                }}>{p.label}</button>
              ))}
            </span>
            <input type="date" value={from} max={to} disabled={!!q} style={champ}
              onChange={e => { setFrom(e.target.value); setPeriode(null); setPage(1); }} />
            <span style={{ color: C.greyT, fontSize: 13 }}>au</span>
            <input type="date" value={to} min={from} max={jourParis()} disabled={!!q} style={champ}
              onChange={e => { setTo(e.target.value); setPeriode(null); setPage(1); }} />

            <select value={carrier} onChange={e => filtre(setCarrier)(e.target.value)} style={champ}>
              <option value="">Tous les transporteurs</option>
              {TRANSPORTEURS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>

            <select value={user} onChange={e => filtre(setUser)(e.target.value)} style={champ}>
              <option value="">Tous les préparateurs</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            <select value={status} onChange={e => filtre(setStatus)(e.target.value)} style={champ}>
              {STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>

            <input
              type="search" value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="N° de commande, de suivi, client…"
              style={{ ...champ, flex: '1 1 220px', minWidth: 200 }}
            />
          </div>

          {q && (
            <div style={{ fontSize: 12.5, color: C.greyT, margin: '-6px 0 12px' }}>
              Recherche sur tout l'historique : la période est ignorée.
            </div>
          )}

          {/* Compteurs */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Kpi label="Colis expédiés" value={totals?.active} color={TEAL}
              onClick={() => filtre(setStatus)('')} active={status === ''} />
            <Kpi label="Avec incident" value={totals?.incidents} color={C.red}
              onClick={() => filtre(setStatus)('incident')} active={status === 'incident'} />
            <Kpi label="BMS non confirmé" value={totals?.bms_pending} color={C.amber}
              onClick={() => filtre(setStatus)('bms_pending')} active={status === 'bms_pending'} />
            <Kpi label="Annulées" value={totals?.cancelled} color={C.red}
              onClick={() => filtre(setStatus)('cancelled')} active={status === 'cancelled'} />
          </div>

          {data && (data.byCarrier.length > 0 || users.length > 0) && (
            <div style={{
              display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16, fontSize: 13,
              background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: C.greyT, fontWeight: 600 }}>Par transporteur</span>
                {data.byCarrier.map(c => (
                  <button key={c.carrier_key} onClick={() => filtre(setCarrier)(carrier === c.carrier_key ? '' : c.carrier_key)}
                    title={carrier === c.carrier_key ? 'Retirer le filtre' : 'Filtrer sur ce transporteur'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      border: `1px solid ${carrier === c.carrier_key ? TEAL : 'transparent'}`,
                      background: 'none', borderRadius: 8, padding: '2px 6px', fontFamily: 'inherit',
                    }}>
                    <CarrierLogo carrier={{ carrierCode: c.carrier_code, accountCode: c.account_code }} height={16} />
                    <strong style={{ fontSize: 13.5 }}>{c.n}</strong>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: C.greyT, fontWeight: 600 }}>Par préparateur</span>
                {users.map(u => (
                  <button key={u.id} onClick={() => filtre(setUser)(String(user) === String(u.id) ? '' : String(u.id))}
                    title={`${u.packed} packé(s), ${u.picked} pické(s)`}
                    style={{
                      cursor: 'pointer', background: 'none', fontFamily: 'inherit', fontSize: 13,
                      border: `1px solid ${String(user) === String(u.id) ? TEAL : 'transparent'}`,
                      borderRadius: 8, padding: '2px 6px', color: C.dark,
                    }}>
                    {u.name} <strong>{u.packed}</strong>
                    {u.picked > 0 && <span style={{ color: C.violet }}> · {u.picked} pické(s)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {erreur && (
            <div style={{
              background: C.redL, borderLeft: `4px solid ${C.red}`, color: '#7F1D1D',
              padding: '12px 16px', borderRadius: 8, fontSize: 13.5, marginBottom: 16,
            }}>{erreur}</div>
          )}

          {/* Liste */}
          <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Commande</Th>
                    <Th>Client</Th>
                    <Th>Transporteur</Th>
                    <Th>N° de suivi</Th>
                    <Th align="right">Poids</Th>
                    <Th>Pické par</Th>
                    <Th>Packé par</Th>
                    <Th>État</Th>
                    <Th align="right"> </Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: '28px 16px', textAlign: 'center', color: C.greyT, fontSize: 13.5 }}>
                      {loading ? 'Chargement…' : 'Aucun colis pour ces critères.'}
                    </td></tr>
                  )}
                  {!data && loading && (
                    <tr><td colSpan={10} style={{ padding: '28px 16px', textAlign: 'center', color: C.greyT, fontSize: 13.5 }}>
                      Chargement…
                    </td></tr>
                  )}
                  {data?.rows.map((r, i) => (
                    <tr key={r.uid} onClick={() => setOuvert(r)} style={{
                      cursor: 'pointer', background: ouvert?.uid === r.uid ? C.rowSel : (i % 2 ? C.zebra : C.white),
                      opacity: r.status === 'cancelled' ? 0.6 : 1,
                    }}>
                      <Td color={C.greyT} style={{ whiteSpace: 'nowrap' }}>{fmtDateHeure(r.created_at)}</Td>
                      <Td bold>#{r.order_number}</Td>
                      <Td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <CountryFlag code={r.country} size={13} />
                          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.customer_name || '—'}
                          </span>
                        </span>
                      </Td>
                      <Td><CarrierLogo carrier={{ carrierCode: r.carrier_code, accountCode: r.account_code }} height={16} /></Td>
                      <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{r.tracking_number || '—'}</Td>
                      <Td align="right" color={C.greyT}>{r.weight_g ? `${r.weight_g} g` : '—'}</Td>
                      <Td color={r.picker_name ? C.dark : C.greyM}>
                        {r.picker_name || '—'}
                        {r.wave_number && <div style={{ fontSize: 11.5, color: C.greyT }}>{r.wave_number}</div>}
                      </Td>
                      <Td color={r.packer_name ? C.dark : C.greyM}>{r.packer_name || '—'}</Td>
                      <Td><Etats row={r} /></Td>
                      <Td align="right">
                        <span onClick={e => e.stopPropagation()}>
                          <Btn small variant="ghost" onClick={() => reimprimer(r)}
                            disabled={r.source === 'bms' || r.status === 'cancelled' || reimpression === r.id}
                            title={r.source === 'bms' ? "Étiquette BMS : à réimprimer dans BMS"
                              : r.has_cn23 ? "Retélécharger l'étiquette et la CN23" : "Retélécharger l'étiquette"}>
                            {reimpression === r.id ? '…' : 'Réimprimer'}
                          </Btn>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data && totals.total > data.pageSize && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
                padding: '10px 14px', borderTop: `1px solid ${C.greyB}`, fontSize: 13, color: C.greyT,
              }}>
                <span>{totals.total} colis — page {page} / {pages}</span>
                <Btn small variant="ghost" onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading}>← Précédente</Btn>
                <Btn small variant="ghost" onClick={() => setPage(p => p + 1)} disabled={page >= pages || loading}>Suivante →</Btn>
              </div>
            )}
          </div>
        </div>
      </main>

      {ouvert && (
        <Parcours
          id={ouvert.id}
          source={ouvert.source}
          token={token}
          onClose={() => setOuvert(null)}
          onChanged={charger}
          reimprimer={reimprimer}
          reimpression={reimpression}
        />
      )}
    </AppShell>
  );
};

export default ShipmentHistoryApp;
