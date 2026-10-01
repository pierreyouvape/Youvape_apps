import { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { trierParAvancement } from '../utils/scanOrder';
import axios from 'axios';
import { formatDateUTC } from '../utils/dateUtils';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE (alignée Rapport / SAV) ───────────────────── */
const C = {
  primary: '#135E84', accent: '#E28F00', accentL: '#FDF3E2',
  green: '#16A34A', greenL: '#DCFCE7', red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFEDD5',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF',
  zebra: '#F4F7F9', // alternance des lignes — assez marqué pour suivre une ligne
};                  // sur toute sa largeur, assez discret pour ne pas concurrencer
                    // les fonds de statut du comptage.

// Fonds de ligne du comptage, VOLONTAIREMENT plus saturés que les teintes pâles
// de la palette ci-dessus : l'opérateur lit l'état d'une ligne d'un coup d'œil,
// à un mètre, parfois debout. Les teintes pâles ne se distinguaient pas assez
// les unes des autres. Le badge « Partielle » garde la sienne (`orangeL`) : il
// est petit et lu de près.
//
// Ce sont les couleurs demandées (#1DDB55, #DBB01D, #DB311D) ramenées à 55 % sur
// fond blanc. Le rouge PLEIN tombe à 3,8 de contraste avec le texte, sous le
// seuil de lisibilité de 4,5 ; à 55 % il remonte à 8,0 tout en restant franc.
// Les badges de statut, eux, gardent leurs teintes pâles : ils sont petits et
// lus de près.
const COMPTAGE = {
  juste:   '#83EBA2',  // compte exact
  partiel: '#EBD483',  // il en manque
  surplus: '#EB8E83',  // compté plus que prévu
};

const authHeaders = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const fmtDate = (s) => {
  if (!s) return '—';
  // Les dates sont stockées en heure locale Paris : pas de new Date() sur la chaîne
  // brute, on découpe (cf. utils/dateUtils du reste de l'app).
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '—';
};

// Le montant HT de la commande. Arrondi à l'euro : on le lit pour situer un
// ordre de grandeur — 60 € ou 7 000 € de marchandise à recevoir — pas pour
// compter, et les centimes ne feraient qu'allonger la colonne.
const fmtEur = (v) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
};

const PREF_KEY = 'yv.reception.askBarcodeType';

/* ─── PETITS COMPOSANTS ─────────────────────────────────── */
// `large` : version agrandie d'un quart, réservée à l'écran de COMPTAGE — celui
// qu'on lit debout, douchette en main, à un mètre de l'écran. Les listes de bons
// et le détail d'un bon gardent la taille normale.
function Th({ children, align = 'left', width, large }) {
  return <th style={{ padding: large ? '14px 20px' : '12px 16px', textAlign: align, width, fontWeight: 700, color: C.greyT,
    fontSize: large ? 14 : 11.5, textTransform: 'uppercase', letterSpacing: 0.3,
    borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{children}</th>;
}
function Td({ children, align = 'left', bold, color, style, large }) {
  return <td style={{ padding: large ? '15px 20px' : '12px 16px', textAlign: align, color: color || C.dark,
    fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: large ? 18 : 14, ...style }}>{children}</td>;
}
function Btn({ children, onClick, variant = 'primary', disabled, small, large, title, style }) {
  const variants = {
    primary: { background: C.primary, color: '#fff', border: 'none' },
    accent:  { background: C.accent, color: '#fff', border: 'none' },
    ghost:   { background: '#fff', color: C.primary, border: `1px solid ${C.greyB}` },
    danger:  { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      ...variants[variant],
      padding: small ? (large ? '6px 14px' : '5px 11px') : (large ? '11px 21px' : '9px 17px'),
      borderRadius: 8, fontWeight: 600,
      fontSize: small ? (large ? 16 : 12.5) : (large ? 17 : 13.5),
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap', ...style,
    }}>{children}</button>
  );
}
/**
 * Vignette produit. Plus grande qu'ailleurs dans l'app (100 px contre 40) : en
 * réception, la photo sert à identifier physiquement l'article qu'on a en main.
 * D'où aussi `contain` plutôt que `cover` — à cette taille un recadrage masquerait
 * l'étiquette, donc le dosage, qui est souvent le seul écart entre deux références.
 */
function Thumb({ src, alt, size = 100 }) {
  const base = { width: size, height: size, borderRadius: 8, flexShrink: 0 };
  if (!src) {
    return <div style={{ ...base, background: C.greyB, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', color: C.greyM,
      fontSize: Math.round(size / 3) }}>?</div>;
  }
  return <img src={src} alt={alt || ''} loading="lazy"
    style={{ ...base, objectFit: 'contain', border: `1px solid ${C.greyB}`,
      background: '#fff', padding: 3 }} />;
}

/**
 * Emplacement de rangement dans l'entrepôt principal. Stocké en base et rafraîchi
 * chaque nuit depuis BMS : aucun appel réseau ici, la donnée arrive avec le détail.
 */
function Location({ value, large }) {
  if (value) {
    return <span style={{ display: 'inline-block', padding: large ? '5px 11px' : '4px 9px', borderRadius: 6,
      background: C.grey, border: `1px solid ${C.greyB}`, fontSize: large ? 16 : 13, fontWeight: 700,
      color: C.primary, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>{value}</span>;
  }
  return <span style={{ color: C.greyM, fontSize: large ? 16 : 13 }}>—</span>;
}

function Badge({ children, color, bg, title }) {
  return <span title={title} style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999,
    fontSize: 11.5, fontWeight: 700, color, background: bg, whiteSpace: 'nowrap' }}>{children}</span>;
}
function Modal({ title, children, onClose, width = 560 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, width: '100%',
        maxWidth: width, maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${C.greyB}` }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.primary }}>{title}</h3>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

const STATUS_LABEL = {
  sent:      { label: 'Envoyée',   color: '#1D4ED8', bg: '#DBEAFE' },
  // « Attendue » et non « Confirmée » : le statut traduit l'état `expected` de BMS,
  // pas un accusé de réception du fournisseur. Même libellé que l'app d'achat.
  confirmed: { label: 'Attendue', color: C.primary, bg: '#E0F2FE' },
  partial:   { label: 'Partielle', color: C.orange,  bg: C.orangeL },
};

/* ─── ÉCRAN 1 — LISTE ───────────────────────────────────── */
/**
 * Le conditionnement d'une ligne, écrit en toutes lettres.
 *
 * « 4 » tout seul ne dit pas si ce sont quatre flacons ou quatre cartons, et
 * l'opérateur qui lit l'écran debout n'a pas à faire la multiplication de tête.
 * On écrit donc les trois nombres : combien de boîtes, de quelle taille, et
 * combien de pièces au total — puisque ce sont les pièces qui entrent en stock.
 */
function Conditionnement({ packs, packSize, pieces, large }) {
  if (!(packSize > 1)) {
    // L'espace insécable colle le mot au nombre sans les souder : « 2 pièces »
    // se lisait « 2pièces ».
    return (
      <span style={{ fontSize: large ? 14 : 12, color: C.greyT, fontWeight: 500 }}>
        {'\u00a0'}pièce{pieces > 1 ? 's' : ''}
      </span>
    );
  }
  return (
    <div style={{ fontSize: large ? 14 : 12, fontWeight: 600, color: C.accent, marginTop: 3 }}>
      {packs} boîte{packs > 1 ? 's' : ''} de {packSize}
      <span style={{ color: C.greyT, fontWeight: 500 }}> = {pieces} pièce{pieces > 1 ? 's' : ''}</span>
    </div>
  );
}

/**
 * Réglages de l'app. Un seul aujourd'hui : à qui partent les mails d'écart
 * (manquants et surplus). Laissé vide, aucun mail ne part — c'est dit à
 * l'écran, parce qu'un envoi silencieusement désactivé est pire que pas d'envoi.
 */
function SettingsModal({ token, onClose }) {
  const [emailTo, setEmailTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/reception/settings`, authHeaders(token))
      .then(r => setEmailTo(r.data.email_to || ''))
      .catch(e => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const enregistrer = async () => {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const { data } = await axios.put(`${API_URL}/reception/settings`,
        { email_to: emailTo }, authHeaders(token));
      setEmailTo(data.email_to || '');
      setSaved(true);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Réglages de la réception" onClose={onClose} width={560}>
      <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.dark, marginBottom: 6 }}>
        Destinataires des mails d'écart
      </label>
      <input value={emailTo} onChange={e => { setEmailTo(e.target.value); setSaved(false); }}
        disabled={loading} placeholder="achats@youvape.fr, responsable@youvape.fr"
        style={{ width: '100%', padding: '9px 12px', borderRadius: 8,
          border: `1px solid ${err ? C.red : C.greyB}`, fontSize: 13.5, boxSizing: 'border-box' }} />
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '8px 0 0', lineHeight: 1.5 }}>
        Séparés par des virgules. Reçoivent les articles manquants avec leur motif, et
        l'alerte quand un surplus a été compté.
        {!loading && emailTo.trim() === ''
          && <strong style={{ color: C.red, display: 'block', marginTop: 6 }}>
               Vide : aucun mail ne partira.
             </strong>}
      </p>
      {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      {saved && <p style={{ color: C.green, fontSize: 13, marginTop: 10 }}>Enregistré.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <Btn variant="ghost" onClick={onClose}>Fermer</Btn>
        <Btn onClick={enregistrer} disabled={loading || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Btn>
      </div>
    </Modal>
  );
}

function OrdersList({ token, onOpen }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/reception/suppliers`, authHeaders(token))
      .then(r => setSuppliers(r.data.data || [])).catch(() => {});
  }, [token]);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (supplierId) p.set('supplier_id', supplierId);
    if (search.trim()) p.set('search', search.trim());
    const t = setTimeout(() => {
      axios.get(`${API_URL}/reception/orders?${p}`, authHeaders(token))
        .then(r => setOrders(r.data.data || []))
        .catch(() => setOrders([]))
        .finally(() => setLoading(false));
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [token, supplierId, search]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>Réception</h1>
          <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
            Commandes fournisseur en attente de réception.
          </p>
        </div>
        <Btn variant="ghost" small onClick={() => setSettingsOpen(true)}>Réglages</Btn>
      </div>

      {settingsOpen && <SettingsModal token={token} onClose={() => setSettingsOpen(false)} />}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, color: C.dark, background: '#fff', minWidth: 220 }}>
          <option value="">Tous les fournisseurs</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.nb_orders})</option>
          ))}
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un n° de commande…"
          style={{ padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.greyB}`,
            fontSize: 13.5, minWidth: 260, flex: 1, maxWidth: 380 }} />
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>N° de commande</Th>
                {/* La réf libre de BMS, juste après le numéro comme là-bas :
                    c'est elle qui dit « Précommande JNr 50ml » là où le numéro
                    ne dit rien. */}
                <Th>Réf fournisseur</Th>
                <Th>Fournisseur</Th>
                <Th>Statut</Th>
                <Th align="right">Lignes</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Reçu</Th>
                {/* Le montant donne l'ordre de grandeur de ce qui arrive. « TTC »
                    est écrit : un montant sans son régime se lit de travers. */}
                <Th align="right">Montant TTC</Th>
                <Th>Livraison prévue</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><Td align="center" style={{ padding: 40, color: C.greyT }}>Chargement…</Td></tr>
              )}
              {!loading && orders.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: C.greyT, fontSize: 14 }}>
                  Aucune commande en attente de réception.
                </td></tr>
              )}
              {!loading && orders.map((o, idx) => {
                const st = STATUS_LABEL[o.status] || { label: o.status, color: C.greyT, bg: C.grey };
                return (
                  <tr key={o.id} onClick={() => onOpen(o.id)}
                    style={{ cursor: 'pointer', background: idx % 2 === 1 ? C.zebra : C.white }}>
                    <Td bold color={C.primary}>{o.order_number}</Td>
                    <Td color={o.bms_supplier_reference ? C.dark : C.greyM}>
                      {o.bms_supplier_reference || '—'}
                    </Td>
                    <Td>{o.supplier_name}</Td>
                    <Td>
                      <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
                      {!o.bms_po_id && (
                        <span style={{ marginLeft: 6 }}>
                          <Badge color="#B45309" bg="#FEF3C7"
                            title="Cette commande n'existe pas dans BMS : elle ne peut pas être réceptionnée.">
                            ⚠ pas dans BMS
                          </Badge>
                        </span>
                      )}
                    </Td>
                    <Td align="right">{o.nb_lines}</Td>
                    <Td align="right" bold>{o.qty_expected}</Td>
                    <Td align="right" color={o.qty_received > 0 ? C.orange : C.greyM}>{o.qty_received}</Td>
                    <Td align="right">
                      {fmtEur(o.total_amount)}{o.total_amount > 0 && !o.bms_po_id ? ' HT' : ''}
                    </Td>
                    <Td>{fmtDate(o.expected_date || o.order_date)}</Td>
                    <Td align="right"><Btn small variant="ghost">Ouvrir</Btn></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── ÉCRAN 2 — DÉTAIL ──────────────────────────────────── */
function OrderDetail({ token, order, items, onBack, onStart }) {
  // Le lien inverse de celui des factures : ici on veut savoir si la facture est
  // déjà arrivée, et si quelqu'un a commencé à compter avant nous.
  const [fil, setFil] = useState(null);
  useEffect(() => {
    let vivant = true;
    axios.get(`${API_URL}/reception/orders/${order.id}/lifecycle`, authHeaders(token))
      .then((r) => { if (vivant) setFil(r.data); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [order.id, token]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Btn variant="ghost" small onClick={onBack} style={{ marginBottom: 16 }}>← Retour</Btn>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: C.primary, margin: 0 }}>
            {order.order_number}
          </h1>
          <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
            {order.supplier_name} · {items.length} ligne{items.length > 1 ? 's' : ''} ·
            {' '}livraison prévue le {fmtDate(order.expected_date || order.order_date)}
          </p>
        </div>
        {/* SANS BON DANS BMS, RIEN NE PEUT PARTIR : la route de réception exige
            l'identifiant de la ligne chez BMS. Mieux vaut le dire ici que laisser
            compter deux cents pièces pour échouer à la validation. */}
        {/* Un comptage déjà ouvert se REPREND par ce même bouton (l'ouverture rend
            la session en cours, comptage compris) : il doit le dire, sinon on croit
            en ouvrir un second. */}
        <Btn variant="accent" onClick={onStart} disabled={!order.bms_po_id}
          title={order.bms_po_id ? undefined : "Cette commande n'existe pas dans BMS"}>
          {fil?.summary.openSession ? 'Reprendre le comptage' : 'Réceptionner'}
        </Btn>
      </div>

      {!order.bms_po_id && (
        <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10,
          padding: '12px 16px', fontSize: 13.5, color: '#7C4A00', marginBottom: 14 }}>
          Cette commande <strong>n'a jamais été créée dans BMS</strong> : le fournisseur ne l'a
          pas reçue, et aucune réception ne peut être enregistrée tant qu'elle n'y est pas.
          Ouvrez-la dans <strong>Commandes fournisseurs</strong> et utilisez « Envoyer à BMS ».
        </div>
      )}

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
              {fil && (fil.summary.openSession || fil.documents.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {fil.summary.openSession && (
            <div style={{ background: C.accentL, border: `1px solid ${C.accent}`, borderRadius: 10,
              padding: '12px 16px', fontSize: 13.5, color: '#7C4A00',
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 240 }}>
                Un comptage est <strong>déjà en cours</strong> sur cette commande, commencé le
                {' '}{formatDateUTC(fil.summary.openSession.started_at)} : on le reprend là où il en est,
                rien n'est perdu.
              </span>
              <Btn variant="accent" onClick={onStart} disabled={!order.bms_po_id}>
                Reprendre le comptage ({fil.summary.openSession.units_counted} pièce{fil.summary.openSession.units_counted > 1 ? 's' : ''} comptée{fil.summary.openSession.units_counted > 1 ? 's' : ''})
              </Btn>
            </div>
          )}
          {fil.documents.length > 0 && (
            <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 10,
              padding: '12px 16px', fontSize: 13.5, color: '#14532D' }}>
              Facture déjà rangée :{' '}
              <strong>{fil.documents.map((d) => d.number).join(', ')}</strong>
              {fil.summary.settled ? ' — réglée.' : ' — pas encore réglée.'}
            </div>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={116} />
                <Th>Produit</Th>
                <Th>Réf. fournisseur</Th>
                <Th>Emplacement</Th>
                <Th align="right">Boîtes</Th>
                <Th align="right">Par boîte</Th>
                <Th align="right">Total unités</Th>
                <Th align="right">Déjà reçu</Th>
                <Th align="right">Reste</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.id} style={{ background: idx % 2 === 1 ? C.zebra : C.white }}>
                  <Td><Thumb src={it.image_url} alt={it.name} /></Td>
                  <Td>
                    {it.name}
                  </Td>
                  <Td color={C.greyT}>{it.supplier_sku || it.sku || '—'}</Td>
                  <Td><Location value={it.shelf_location} /></Td>
                  <Td align="right">
                    {it.qty_expected_packs}
                    <Conditionnement
                      packs={it.qty_expected_packs}
                      packSize={it.pack_size}
                      pieces={it.qty_expected}
                    />
                  </Td>
                  <Td align="right" color={it.pack_size > 1 ? C.accent : C.greyM}>
                    {it.pack_size > 1 ? `× ${it.pack_size}` : '—'}
                  </Td>
                  <Td align="right" bold>{it.qty_expected}</Td>
                  <Td align="right" color={it.qty_received > 0 ? C.orange : C.greyM}>{it.qty_received}</Td>
                  <Td align="right" bold color={it.qty_remaining > 0 ? C.dark : C.green}>{it.qty_remaining}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── ÉCRAN 3 — COMPTAGE ────────────────────────────────── */
/**
 * L'écran de fin d'une réception.
 *
 * Une réception ne se rejoue pas : aucune route BMS ne sait l'annuler. Ce
 * récapitulatif est donc la seule trace immédiate de ce qui est parti, et il
 * doit survivre au rechargement de la commande — c'est pourquoi il vit ici, au
 * niveau de l'app, et non dans l'écran de comptage qui, lui, se démonte.
 */
function RecapScreen({ order, result, onList, onOrder }) {
  const pieces = (result.sent || []).reduce((n, l) => n + l.units, 0);
  const bloc = (titre, couleur, fond, contenu) => (
    <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10,
      background: fond, border: `1px solid ${couleur}` }}>
      <div style={{ fontWeight: 700, color: couleur, marginBottom: 6, fontSize: 14 }}>{titre}</div>
      {contenu}
    </div>
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>
        Réception terminée
      </h1>
      <p style={{ color: C.greyT, margin: '4px 0 18px', fontSize: 13.5 }}>
        Commande {order.order_number}{order.supplier_name ? ` — ${order.supplier_name}` : ''}
      </p>

      <div style={{ background: C.greenL, border: `1px solid ${C.green}`, borderRadius: 12,
        padding: '18px 22px', fontSize: 16, color: '#14532D' }}>
        <strong>{pieces} pièce{pieces > 1 ? 's' : ''}</strong> enregistrée{pieces > 1 ? 's' : ''} en
        stock, sur {(result.sent || []).length} ligne{(result.sent || []).length > 1 ? 's' : ''}.
      </div>

      {result.notSent?.length > 0 && bloc(
        'BMS a refusé une partie du comptage', C.red, C.redL,
        <>
          <div style={{ fontSize: 13.5, color: '#7F1D1D' }}>
            Ces pièces sont physiquement chez nous et <strong>ne sont pas en stock</strong>.
            À trancher avec un responsable.
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13.5 }}>
            {result.notSent.map((n, i) => (
              <li key={i}>
                {n.ref || n.product} — {n.envoyees} sur {n.comptees} comptées,
                <strong> {n.refusees} refusée{n.refusees > 1 ? 's' : ''}</strong>
              </li>
            ))}
          </ul>
        </>,
      )}

      {result.missing?.length > 0 && bloc(
        `${result.missing.length} article(s) manquant(s)`, C.orange, '#FFFBEB',
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
          {result.missing.map((m, i) => (
            <li key={i}>
              {m.ref || m.product} — {m.units} sur {m.expected} attendues
              {m.motif ? ` · ${MOTIF_RECAP[m.motif] || m.motif}` : ''}
            </li>
          ))}
        </ul>,
      )}

      {result.over?.length > 0 && bloc(
        `${result.over.length} article(s) reçu(s) en trop`, C.red, C.redL,
        <>
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13.5 }}>
            {result.over.map((o, i) => (
              <li key={i}>{o.ref || o.product} — {o.units} pour {o.expected} attendues (+{o.ecart})</li>
            ))}
          </ul>
          <div style={{ fontSize: 13.5, color: '#7F1D1D' }}>
            <strong>Le surplus n'est pas en stock</strong> tant qu'un responsable n'a pas tranché.
          </div>
        </>,
      )}

      <p style={{ marginTop: 18, fontSize: 13, color: C.greyT }}>
        Un mail récapitulatif est parti si un écart a été constaté. Le détail reste
        consultable depuis Commandes fournisseurs.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <Btn onClick={onList}>Retour aux réceptions</Btn>
        <Btn variant="ghost" onClick={onOrder}>Revoir la commande</Btn>
      </div>
    </div>
  );
}

const MOTIF_RECAP = {
  reliquat: 'Reliquat',
  solde: 'Soldé (remboursé)',
  manquant: 'Manquant à réclamer',
};

function CountingScreen({ token, order, items, onBack, onReload, onFinished }) {
  // counts : { [itemId]: nombre d'unités comptées lors de CETTE réception }
  const [counts, setCounts] = useState(() =>
    Object.fromEntries(items.map(i => [i.id, 0])));
  const [askType, setAskType] = useState(() => localStorage.getItem(PREF_KEY) !== 'off');
  const [scanBuffer, setScanBuffer] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [typeModal, setTypeModal] = useState(null);    // { item, barcode, packQty }
  const [packQtyModal, setPackQtyModal] = useState(null); // { item, barcode, suggestion }
  const [unknownModal, setUnknownModal] = useState(null); // { barcode }
  const [diffModal, setDiffModal] = useState(false);
  const [motifs, setMotifs] = useState({});            // { [itemId]: 'reliquat'|'solde'|'manquant' }

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ─── La session de réception ────────────────────────────────────────────
  // Le comptage vivait ici et nulle part ailleurs : une tablette qui se
  // verrouille au milieu d'une commande de 1 159 articles faisait tout perdre.
  // Il est désormais enregistré à chaque scan et repris à l'ouverture.
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [sending, setSending] = useState(false);
  const [addModal, setAddModal] = useState(false);

  // Unités de comptage → PIÈCES. C'est en pièces que BMS raisonne, et lui
  // envoyer des cartons solderait la ligne avec une seule pièce en stock.

  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const { data } = await axios.post(
          `${API_URL}/reception/orders/${order.id}/session`, {}, authHeaders(token),
        );
        if (!vivant || !data.session) return;
        setSession(data.session);
        // Reprise : base et écran comptent tous deux en PIÈCES, rien à convertir.
        const repris = {};
        for (const c of data.session.counts || []) {
          repris[c.purchase_order_item_id] = c.units_counted || 0;
        }
        if (Object.values(repris).some((v) => v > 0)) {
          setCounts((prev) => ({ ...prev, ...repris }));
          flash('Comptage repris là où il s\'était arrêté');
        }
      } catch (e) {
        if (vivant) setSessionError(e.response?.data?.error || e.message);
      }
    })();
    return () => { vivant = false; };
  }, [order.id, token]);

  // Enregistrement différé : un scan doit rester instantané, la base suit.
  // 600 ms, parce qu'un opérateur enchaîne les bips d'un même carton.
  const enAttente = useRef({});
  const envoyerComptage = useCallback(async (itemId, pieces) => {
    if (!session) return;
    try {
      await axios.put(
        `${API_URL}/reception/sessions/${session.id}/counts/${itemId}`,
        { units: pieces }, authHeaders(token),
      );
    } catch {
      setSessionError('Le comptage de cette ligne n\'a pas pu être enregistré — ne fermez pas l\'écran.');
    }
  }, [session, token]);

  // Le différé retient MAINTENANT la valeur en attente, et plus seulement son
  // minuteur : sans elle, impossible de forcer l'envoi avant un rechargement.
  const persistCount = useCallback((itemId, countingUnits) => {
    if (!session) return;
    const enCours = enAttente.current[itemId];
    if (enCours) clearTimeout(enCours.minuteur);
    enAttente.current[itemId] = {
      unites: countingUnits,
      minuteur: setTimeout(() => {
        delete enAttente.current[itemId];
        envoyerComptage(itemId, countingUnits);
      }, 600),
    };
  }, [session, envoyerComptage]);

  /**
   * Envoie SANS ATTENDRE tout comptage encore en différé.
   *
   * À appeler avant tout rechargement de la commande. Le comptage part 600 ms
   * après le bip ; un `onReload()` lancé entre-temps relisait le serveur, où la
   * ligne valait encore zéro, et ÉCRASAIT l'incrément local. Ce qui donnait :
   * on rattache un code-barre inconnu, la pop-up se ferme, et l'article n'est
   * pas compté — il fallait rescanner.
   */
  const viderComptagesEnAttente = useCallback(async () => {
    const enAttenteMaintenant = Object.entries(enAttente.current);
    enAttente.current = {};
    await Promise.all(enAttenteMaintenant.map(([itemId, p]) => {
      clearTimeout(p.minuteur);
      return envoyerComptage(Number(itemId), p.unites);
    }));
  }, [envoyerComptage]);

  const toggleAsk = () => {
    setAskType(prev => {
      const next = !prev;
      localStorage.setItem(PREF_KEY, next ? 'on' : 'off');
      return next;
    });
  };

  const flash = (msg, isError) => {
    if (isError) { setError(msg); setMessage(null); setTimeout(() => setError(null), 3500); }
    else { setMessage(msg); setError(null); setTimeout(() => setMessage(null), 2000); }
  };

  // Ligne scannée : la liste défile jusqu'à elle et la surligne 2 s. Défiler
  // plutôt que la remonter en tête : des lignes qui changent de place sous les
  // yeux font perdre ses repères au magasinier.
  const [scanned, setScanned] = useState(null); // { id, n } — n relance l'effet sur un même article
  const marquerScan = useCallback((itemId) => {
    setScanned(prev => ({ id: itemId, n: (prev?.n || 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!scanned) return undefined;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`rx-ligne-${scanned.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const t = setTimeout(() => setScanned(cur => (cur?.n === scanned.n ? null : cur)), 2000);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [scanned]);

  const addCount = useCallback((itemId, delta) => {
    setCounts(prev => {
      const next = Math.max(0, (prev[itemId] || 0) + delta);
      persistCount(itemId, next);
      return { ...prev, [itemId]: next };
    });
  }, [persistCount]);

  const setCount = useCallback((itemId, value) => {
    setCounts(prev => {
      const next = Math.max(0, parseInt(value) || 0);
      persistCount(itemId, next);
      return { ...prev, [itemId]: next };
    });
  }, [persistCount]);

  /**
   * Compte ce qu'un code-barre représente, EN PIÈCES.
   *
   * LE CODE SCANNÉ FAIT AUTORITÉ, point final. `product_barcodes.quantity` dit
   * combien de pièces vaut ce code : c'est la même règle qu'au picking et au
   * packing, où un bip vaut `quantity` articles et rien d'autre.
   *
   * L'écran a compté en BOÎTES un temps, en exigeant que tout tombe sur un
   * multiple du conditionnement de la ligne. C'était doublement faux : ça
   * contredisait le commentaire juste au-dessus — le fournisseur expédie très
   * bien des cartons de 20 sur une ligne conditionnée par 10 — et ça refusait
   * de compter des marchandises pourtant bien reçues.
   */
  const compterPieces = useCallback((item, pieces) => {
    const n = parseInt(pieces, 10) || 0;
    if (n <= 0) return false;
    addCount(item.id, n);
    return true;
  }, [addCount]);


  // Résolution d'un scan, côté client : les codes-barres sont embarqués dans la
  // commande, donc un bip n'entraîne aucun aller-retour réseau.
  const handleScan = useCallback((code) => {
    const value = String(code).trim();
    if (!value) return;
    const list = itemsRef.current;

    let found = null, matched = null;
    for (const it of list) {
      const bc = (it.barcodes || []).find(b => String(b.barcode).trim() === value);
      if (bc) { found = it; matched = bc; break; }
    }

    if (!found) {
      // Code inconnu de cette commande : soit c'est un code-barres à rattacher à
      // une ligne existante, soit l'article n'est pas au bon — et il faut alors
      // l'ajouter dans BMS puis recharger, l'API ne sachant pas le faire.
      setUnknownModal({ barcode: value });
      return;
    }

    // Code de carton dont la quantité n'est pas encore connue : les codes GTIN-14
    // ingérés depuis BMS n'encodent pas le nombre d'unités. On la demande UNE fois,
    // elle est enregistrée, la question ne revient plus.
    if (matched.type === 'pack' && !matched.quantity && askType) {
      setPackQtyModal({ item: found, barcode: value, suggestion: found.pack_qty > 1 ? found.pack_qty : '' });
      return;
    }

    // Un carton dont on connaît le contenu : sa quantité l'emporte sur le
    // conditionnement de la ligne (cf. compterPieces).
    if (matched.type === 'pack' && matched.quantity) {
      const n = parseInt(matched.quantity, 10);
      compterPieces(found, n);
      marquerScan(found.id);
      flash(`${found.name} — +${n} pièce${n > 1 ? 's' : ''}`);
      return;
    }

    // Code « unité » jamais confirmé par une personne, sur un produit acheté au
    // carton OU qui a plusieurs codes : il peut être celui du carton, mal classé
    // à l'import (BMS ne dit pas lequel est lequel). On demande, la réponse est
    // enregistrée et confirmée, la question ne revient plus pour ce code.
    // (Avant le 01/10/2026 : seulement si acheté au carton — presque jamais depuis
    // la bascule en pièces du 30/09 — et la question revenait même après réponse.)
    const multiCodes = (found.barcodes || []).length > 1;
    if (askType && matched.type === 'unit' && !matched.confirmed && (found.ambiguous || multiCodes)) {
      marquerScan(found.id);
      setTypeModal({ item: found, barcode: value, packQty: found.pack_qty });
      return;
    }

    addCount(found.id, 1);
    marquerScan(found.id);
    flash(`${found.name} — +1`);
    // `compterPieces` en dépendance : sans elle, le scan garderait une version
    // figée de la fonction, donc une SESSION figée — et le comptage d'un carton
    // cesserait d'être enregistré en base sans que rien ne le signale.
  }, [addCount, askType, compterPieces, marquerScan]);

  // Capture clavier globale (douchette) — ignorée quand on saisit dans un champ
  // ou qu'une pop-up est ouverte.
  useEffect(() => {
    const blocked = () => typeModal || packQtyModal || unknownModal || diffModal;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || blocked()) return;
      if (e.key === 'Enter') {
        setScanBuffer(buf => { if (buf) handleScan(buf); return ''; });
        e.preventDefault();
      } else if (e.key.length === 1) {
        setScanBuffer(buf => buf + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleScan, typeModal, packQtyModal, unknownModal, diffModal]);

  /**
   * Ajoute un article livré mais absent du bon — dans BMS puis chez nous.
   *
   * On croyait ce chemin fermé et on renvoyait le magasinier ouvrir BMS avec un
   * carton dans les bras. L'API v2 sait créer une ligne : elle est créée en
   * pièces, conditionnement 1, comme toutes les autres.
   */
  const ajouterArticle = async (produit, qte) => {
    if (!session) { flash('Aucune session de réception ouverte', true); return false; }
    setSending(true); setSessionError(null);
    try {
      const { data } = await axios.post(
        `${API_URL}/reception/sessions/${session.id}/lines`,
        { product_id: produit.wp_product_id || produit.id, qty: qte },
        authHeaders(token),
      );
      setSession(data.session || session);
      onReload();
      flash(`${produit.post_title || produit.name} ajouté à la commande`);
      return true;
    } catch (e) {
      setSessionError(e.response?.data?.error || e.message);
      return false;
    } finally { setSending(false); }
  };

  /**
   * Recharge les lignes depuis BMS.
   *
   * L'API BMS ne sait pas ajouter une ligne à un bon de commande existant :
   * recevoir un article absent du bon passe donc par BMS, puis par ce bouton.
   * Le comptage déjà saisi n'est pas touché.
   */
  const recharger = async () => {
    if (!session) return;
    setSending(true); setSessionError(null);
    try {
      const { data } = await axios.post(
        `${API_URL}/reception/sessions/${session.id}/refresh`, {}, authHeaders(token),
      );
      setSession(data.session || session);
      onReload();
      flash(data.added > 0
        ? `${data.added} ligne(s) reprise(s) depuis BMS`
        : 'Aucune ligne nouvelle dans BMS');
    } catch (e) {
      setSessionError(e.response?.data?.error || e.message);
    } finally { setSending(false); }
  };

  /**
   * Envoie la réception à BMS. IRRÉVERSIBLE : aucune route BMS ne sait annuler
   * une réception, d'où la confirmation explicite et le message en cas d'échec
   * partiel.
   */
  const envoyer = async () => {
    if (!session) { flash('Aucune session de réception ouverte', true); return; }
    setSending(true);
    try {
      // Les motifs partent AVEC la réception : ils expliquent un manquant, et
      // n'ont de sens que rapportés à ce qui est parti. Le backend les réexige
      // de son côté — l'écran n'est pas le seul gardien.
      const { data } = await axios.post(
        `${API_URL}/reception/sessions/${session.id}/validate`,
        { motifs }, authHeaders(token),
      );
      setDiffModal(false);
      // SURTOUT PAS `onReload()` ICI. Il repasse `loading` à vrai, et cet écran
      // n'est rendu que si `!loading` : il se démontait puis se remontait, son
      // effet de montage rouvrait AUSSITÔT une session de comptage sur la même
      // commande — d'où la session fantôme abandonnée du 30/09 — et le
      // récapitulatif, qui vit dans son état local, partait avec.
      onFinished(data);
    } catch (e) {
      setSessionError(e.response?.data?.error || e.message);
    } finally { setSending(false); }
  };

  // Enregistre durablement le type d'un code-barre (requalification unité <-> pack)
  const persistBarcode = async (wpProductId, barcode, type, quantity) => {
    try {
      await axios.post(`${API_URL}/products/${wpProductId}/barcodes`,
        { barcode, type, ...(type === 'pack' ? { quantity } : {}) }, authHeaders(token));
      // Le comptage qui vient d'être fait part d'abord : le rechargement relit
      // le serveur et écraserait sinon un incrément encore en différé.
      await viderComptagesEnAttente();
      onReload();
    } catch {
      flash('Le type du code-barre n\'a pas pu être enregistré', true);
    }
  };

  // Le fond d'une ligne porte l'état de son comptage : il prime sur le zébrage, qui
  // ne s'applique donc qu'aux lignes encore vierges. Sinon l'alternance viendrait
  // concurrencer le signal orange/vert/rouge, qui est l'information utile ici.
  // Cible du comptage : en BOÎTES pour un produit conditionné (on reçoit un carton
  // scellé, pas des flacons à l'unité), en unités sinon.
  // Ce qui reste à recevoir sur la ligne, EN PIÈCES — la seule unité tenue de
  // bout en bout, du code-barre scanné jusqu'au stock BMS.
  const targetOf = (it) => it.qty_remaining;

  const rowColors = (it, idx) => {
    const counted = counts[it.id] || 0;
    const target = targetOf(it);
    if (counted === 0) return { background: idx % 2 === 1 ? C.zebra : C.white };
    if (counted > target) return { background: COMPTAGE.surplus };
    if (counted === target) return { background: COMPTAGE.juste };
    return { background: COMPTAGE.partiel };
  };

  const missing = items.filter(i => (counts[i.id] || 0) < targetOf(i));
  const surplus = items.filter(i => (counts[i.id] || 0) > targetOf(i));
  // Les totaux d'en-tête restent en UNITÉS : c'est ce qui entre en stock.
  const unitsOf = (i) => counts[i.id] || 0;
  const totalCounted = items.reduce((s, i) => s + unitsOf(i), 0);
  const totalExpected = items.reduce((s, i) => s + i.qty_remaining, 0);
  const allMotifsSet = missing.every(i => motifs[i.id]);

  // Ordre d'affichage : ce qui reste à compter en haut, ce qui est bouclé en bas.
  // Sur un bon de cinquante lignes, chercher les incomplètes entre les vertes fait
  // perdre plus de temps que le comptage lui-même ; ici la liste se vide par le
  // haut.
  //
  // Les lignes en SURPLUS ne descendent PAS avec les lignes justes : compter plus
  // que prévu est une anomalie à corriger avant de valider, la reléguer en bas de
  // page reviendrait à la cacher. Elles se rangent juste après les incomplètes.
  const rangAffichage = (it) => {
    const compte = counts[it.id] || 0;
    const cible = targetOf(it);
    if (compte < cible) return 0;   // il en manque : c'est le travail en cours
    if (compte > cible) return 1;   // surplus : anomalie, reste sous les yeux
    return 2;                       // compte juste : rangé en bas
  };

  const itemsAffiches = trierParAvancement(items, rangAffichage);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <Btn variant="ghost" small onClick={onBack} style={{ marginBottom: 16 }}>← Retour</Btn>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: C.primary, margin: 0 }}>
            Comptage — {order.order_number}
          </h1>
          <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
            {order.supplier_name} · {totalCounted} / {totalExpected} unités comptées
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5,
            color: C.greyT, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={askType} onChange={toggleAsk} />
            Demander le type au scan
          </label>
          <Btn variant="ghost" onClick={() => setAddModal(true)} disabled={sending || !session}
            title="Un article livré ne figure pas sur le bon ? Ajoutez-le ici, la ligne est créée dans BMS.">
            + Ajouter un article
          </Btn>
          <Btn variant="ghost" onClick={recharger} disabled={sending || !session}
            title="Reprendre les lignes ajoutées dans BMS depuis l'ouverture du comptage.">
            {sending ? '…' : 'Recharger'}
          </Btn>
          <Btn variant="accent" onClick={() => setDiffModal(true)} disabled={totalCounted === 0}>
            Valider
          </Btn>
        </div>
      </div>

      {sessionError && (
        <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 12,
          padding: '14px 18px', marginBottom: 16, fontSize: 13.5, color: '#7F1D1D' }}>
          {sessionError}
        </div>
      )}

      {/* Zone de scan */}
      <div style={{ background: C.primary, color: '#fff', borderRadius: 12, padding: '16px 20px',
        marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {scanBuffer ? `Scan : ${scanBuffer}` : 'Scannez un article — ou saisissez les quantités à la main'}
        </div>
        {message && <Badge color={C.green} bg="#fff">{message}</Badge>}
        {error && <Badge color={C.red} bg="#fff">{error}</Badge>}
      </div>

      <div style={{ background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th width={116} large />
                <Th large>Produit</Th>
                <Th large>Emplacement</Th>
                <Th align="right" large>Attendu</Th>
                <Th align="center" width={288} large>Compté</Th>
                <Th align="right" large>Écart</Th>
              </tr>
            </thead>
            <tbody>
              {itemsAffiches.map((it, idx) => {
                const counted = counts[it.id] || 0;
                const ecart = counted - targetOf(it);
                return (
                  <tr
                    key={it.id}
                    id={`rx-ligne-${it.id}`}
                    style={{
                      ...rowColors(it, idx),
                      boxShadow: scanned?.id === it.id ? `inset 0 0 0 4px ${C.accent}` : 'none',
                      transition: 'box-shadow 0.3s ease',
                    }}
                  >
                    <Td large><Thumb src={it.image_url} alt={it.name} /></Td>
                    <Td large>
                      {it.name}
                      <div style={{ fontSize: 14, color: C.greyT, marginTop: 3 }}>
                        {it.supplier_sku || it.sku}
                      </div>
                    </Td>
                    <Td large><Location value={it.shelf_location} large /></Td>
                    <Td align="right" bold large>
                      {targetOf(it)}
                      <Conditionnement
                        packs={it.pack_size > 1 ? it.qty_remaining / it.pack_size : it.qty_remaining}
                        packSize={it.pack_size}
                        pieces={it.qty_remaining}
                        large
                      />
                    </Td>
                    <Td align="center" large>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                        <Btn small large variant="ghost" title="Remettre à zéro"
                          onClick={() => setCount(it.id, 0)}>Rien</Btn>
                        <input type="number" min="0" value={counted}
                          onChange={e => setCount(it.id, e.target.value)}
                          style={{ width: 92, padding: '8px 10px', textAlign: 'center', fontSize: 18,
                            fontWeight: 700, borderRadius: 7, border: `1px solid ${C.greyB}` }} />
                        <Btn small large variant="ghost" title="Tout réceptionner"
                          onClick={() => setCount(it.id, targetOf(it))}>Tout</Btn>
                      </div>
                    </Td>
                    <Td align="right" bold large
                      color={ecart === 0 ? C.green : ecart > 0 ? C.red : C.orange}>
                      {ecart === 0 ? '—' : ecart > 0 ? `+${ecart}` : ecart}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pop-up : code typé unité sur un produit acheté au carton */}
      {typeModal && (
        <TypeModal
          data={typeModal}
          onClose={() => setTypeModal(null)}
          onChoose={async (type, qty) => {
            // Même règle qu'au rattachement d'un code inconnu : la quantité du
            // code-barre est un nombre de pièces, et c'est ce qu'on compte.
            compterPieces(typeModal.item, type === 'pack' ? qty : 1);
            await persistBarcode(typeModal.item.wp_product_id, typeModal.barcode, type, qty);
            setTypeModal(null);
          }}
        />
      )}

      {/* Pop-up : quantité d'un carton encore inconnue */}
      {packQtyModal && (
        <PackQtyModal
          data={packQtyModal}
          onClose={() => setPackQtyModal(null)}
          onConfirm={async (qty) => {
            // La quantité que l'opérateur vient de saisir est celle du carton qu'il
            // a en main : elle fait autorité, exactement comme au scan suivant une
            // fois enregistrée.
            compterPieces(packQtyModal.item, qty);
            marquerScan(packQtyModal.item.id);
            await persistBarcode(packQtyModal.item.wp_product_id, packQtyModal.barcode, 'pack', qty);
            flash(`${packQtyModal.item.name} — carton de ${qty} enregistré`);
            setPackQtyModal(null);
          }}
        />
      )}

      {/* Pop-up : code-barre inconnu → choix de la ligne */}
      {unknownModal && (
        <UnknownModal
          barcode={unknownModal.barcode}
          items={items.filter(i => (counts[i.id] || 0) < i.qty_remaining)}
          onClose={() => setUnknownModal(null)}
          onAttach={async (item, type, qty) => {
            // La quantité saisie est le nombre de pièces que vaut ce code, et
            // c'est exactement ce qui est compté — comme au picking et au packing.
            const compte = compterPieces(item, type === 'pack' ? qty : 1);
            if (compte) marquerScan(item.id);
            await persistBarcode(item.wp_product_id, unknownModal.barcode, type, qty);
            if (compte) flash(`${item.name} — code rattaché et compté`);
            setUnknownModal(null);
          }}
        />
      )}

      {/* Pop-up : ajouter un article absent du bon */}
      {addModal && (
        <AddLineModal
          token={token}
          supplierId={order.supplier_id}
          busy={sending}
          onClose={() => setAddModal(false)}
          onAdd={async (produit, qte) => {
            const ok = await ajouterArticle(produit, qte);
            if (ok) setAddModal(false);
          }}
        />
      )}

      {/* Pop-up : écarts */}
      {diffModal && (
        <Modal title="Des différences ont été trouvées" onClose={() => setDiffModal(false)} width={680}>
          {missing.length === 0 && surplus.length === 0 ? (
            <p style={{ fontSize: 14, color: C.dark, margin: '0 0 18px' }}>
              Aucun écart — la réception correspond exactement à la commande.
            </p>
          ) : (
            <>
              {missing.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 12, margin: '0 0 10px' }}>
                    <h4 style={{ fontSize: 13, fontWeight: 800, color: C.orange, margin: 0,
                      textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      Manquants ({missing.length})
                    </h4>
                    {/* Une livraison partielle laisse des dizaines de lignes non livrées :
                        les basculer d'un coup en reliquat évite autant de menus déroulants. */}
                    <Btn small variant="ghost"
                      onClick={() => setMotifs(m => {
                        const next = { ...m };
                        missing.forEach(i => { if (!next[i.id]) next[i.id] = 'reliquat'; });
                        return next;
                      })}>
                      Tout en reliquat
                    </Btn>
                  </div>
                  {missing.map(it => (
                    <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 0', borderBottom: `1px solid ${C.greyB}` }}>
                      <div style={{ flex: 1, fontSize: 13.5 }}>
                        {it.name}
                        <span style={{ color: C.greyT }}>
                          {' '}— {counts[it.id] || 0} / {targetOf(it)} pièce(s)
                          {it.pack_size > 1 ? ` (boîtes de ${it.pack_size})` : ''}
                          {' '}— manque {targetOf(it) - (counts[it.id] || 0)}
                        </span>
                      </div>
                      <select value={motifs[it.id] || ''}
                        onChange={e => setMotifs(m => ({ ...m, [it.id]: e.target.value }))}
                        style={{ padding: '6px 10px', borderRadius: 7, fontSize: 13,
                          border: `1px solid ${motifs[it.id] ? C.greyB : C.red}`, background: '#fff' }}>
                        <option value="">Motif…</option>
                        <option value="reliquat">Reliquat</option>
                        <option value="solde">Soldé</option>
                        <option value="manquant">Manquant</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {surplus.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 800, color: C.red, margin: '0 0 10px',
                    textTransform: 'uppercase', letterSpacing: 0.3 }}>Surplus</h4>
                  {surplus.map(it => (
                    <div key={it.id} style={{ padding: '9px 0', borderBottom: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
                      {it.name}
                      <span style={{ color: C.greyT }}>
                        {' '}— {counts[it.id]} pièce(s) reçues pour {targetOf(it)} attendues
                        {it.pack_size > 1 ? ` (boîtes de ${it.pack_size})` : ''}
                        {' '}(+{counts[it.id] - targetOf(it)})
                      </span>
                    </div>
                  ))}
                  <div style={{ marginTop: 10, padding: '11px 14px', borderRadius: 9,
                    background: '#FFFBEB', border: `1px solid ${C.orange}`, fontSize: 12.5,
                    color: '#7C2D12', lineHeight: 1.5 }}>
                    <strong>Le surplus n'est pas en stock.</strong> Il sera compté et envoyé, mais
                    rien ne dit qu'il nous est dû sur ce bon de commande — <strong>à vérifier avec
                    un responsable</strong> avant de le considérer acquis. Si des pièces ont déjà
                    été reçues sur ces lignes, BMS refusera le dépassement : ce qui ne passe pas
                    vous sera dit, et n'entrera pas en stock.
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ background: C.redL, border: `1px solid ${C.red}`, borderRadius: 9,
            padding: '11px 14px', fontSize: 12.5, color: '#7F1D1D', marginBottom: 18 }}>
            <strong>{totalCounted} pièce{totalCounted > 1 ? 's' : ''}</strong> vont entrer en stock
            dans BMS. Une réception <strong>ne s'annule pas</strong> : aucune route ne le permet,
            il faudrait corriger le stock à la main.
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setDiffModal(false)}>Recompter</Btn>
            <Btn
              variant="accent"
              onClick={envoyer}
              disabled={!allMotifsSet || sending || !session}
              title={!allMotifsSet ? 'Renseignez un motif pour chaque manquant' : undefined}
            >
              {sending ? 'Envoi…' : `Envoyer ${totalCounted} pièce${totalCounted > 1 ? 's' : ''} à BMS`}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── POP-UP : ajouter un article absent du bon ───────────── */
/**
 * Le fournisseur a livré quelque chose qui n'est pas sur le bon.
 *
 * La ligne est créée dans BMS ET chez nous, rattachée à la commande — la
 * marchandise garde donc son prix d'achat et son lien au fournisseur, là où un
 * simple ajustement de stock l'en détacherait.
 */
function AddLineModal({ token, supplierId, busy, onClose, onAdd }) {
  const [terme, setTerme] = useState('');
  const [resultats, setResultats] = useState([]);
  const [cherche, setCherche] = useState(false);
  const [choisi, setChoisi] = useState(null);
  const [qte, setQte] = useState(1);

  useEffect(() => {
    if (terme.trim().length < 2) { setResultats([]); return undefined; }
    const t = setTimeout(async () => {
      setCherche(true);
      try {
        const { data } = await axios.get(`${API_URL}/purchases/products/search`, {
          ...authHeaders(token),
          params: { q: terme.trim(), supplier_id: supplierId, all_suppliers: 1, limit: 12 },
        });
        setResultats(data.data || []);
      } catch { setResultats([]); } finally { setCherche(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [terme, supplierId, token]);

  return (
    <Modal title="Ajouter un article à la commande" onClose={onClose} width={620}>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 14px' }}>
        La ligne sera créée dans BMS et ici, rattachée à cette commande. Les quantités sont
        en <strong>pièces</strong>.
      </p>

      {!choisi ? (
        <>
          <input
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            placeholder="Nom, SKU, marque…"
            autoFocus
            style={{ width: '100%', padding: '11px 13px', fontSize: 15, borderRadius: 9,
              border: `1px solid ${C.greyB}`, marginBottom: 12 }}
          />
          <div style={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 9 }}>
            {cherche && <div style={{ padding: 16, color: C.greyT, fontSize: 13.5 }}>Recherche…</div>}
            {!cherche && terme.trim().length >= 2 && resultats.length === 0 && (
              <div style={{ padding: 16, color: C.greyT, fontSize: 13.5 }}>Aucun produit trouvé.</div>
            )}
            {resultats.map((p) => (
              <button key={p.id} type="button" onClick={() => setChoisi(p)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px',
                  border: 'none', borderBottom: `1px solid ${C.greyB}`, background: 'transparent',
                  cursor: 'pointer', fontSize: 13.5 }}>
                <strong>{p.post_title}</strong>
                <div style={{ fontSize: 12, color: C.greyT }}>{p.sku} · stock {p.stock}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div>
          <div style={{ background: C.grey, borderRadius: 9, padding: '12px 14px', marginBottom: 14 }}>
            <strong style={{ fontSize: 14 }}>{choisi.post_title}</strong>
            <div style={{ fontSize: 12.5, color: C.greyT }}>{choisi.sku}</div>
          </div>
          <label style={{ display: 'block', fontSize: 12.5, color: C.greyT, marginBottom: 6 }}>
            Quantité reçue, en pièces
          </label>
          <input type="number" min="1" value={qte} autoFocus
            onChange={(e) => setQte(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{ width: 140, padding: '11px 13px', fontSize: 17, fontWeight: 700,
              textAlign: 'center', borderRadius: 9, border: `1px solid ${C.greyB}` }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        {choisi && <Btn variant="ghost" onClick={() => setChoisi(null)} disabled={busy}>Changer</Btn>}
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Annuler</Btn>
        <Btn variant="accent" onClick={() => onAdd(choisi, qte)} disabled={!choisi || busy}>
          {busy ? 'Ajout…' : 'Ajouter à la commande'}
        </Btn>
      </div>
    </Modal>
  );
}

/* ─── POP-UP : unité ou pack ? ──────────────────────────── */
function TypeModal({ data, onClose, onChoose }) {
  const auCarton = data.packQty > 1;
  const [qty, setQty] = useState(auCarton ? data.packQty : '');
  const qtyPack = parseInt(qty, 10);
  return (
    <Modal title="Ce code-barre est celui de l'unité ou du carton ?" onClose={onClose}>
      <p style={{ fontSize: 14, color: C.dark, margin: '0 0 6px' }}>{data.item.name}</p>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 18px' }}>
        Code <strong>{data.barcode}</strong> · {auCarton
          ? `ce produit est acheté par carton de ${data.packQty}.`
          : 'ce produit a plusieurs codes-barres : l\'un d\'eux peut être celui du carton.'}
        {' '}Votre réponse est enregistrée : la question ne sera plus posée pour ce code.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={() => onChoose('unit', 1)}>Unité (+1)</Btn>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn variant="accent" disabled={!(qtyPack >= 2)} onClick={() => onChoose('pack', qtyPack)}>
            Carton de
          </Btn>
          <input type="number" min="2" value={qty} placeholder="qté" onChange={e => setQty(e.target.value)}
            style={{ width: 82, padding: '8px 10px', textAlign: 'center', fontSize: 14, fontWeight: 700,
              borderRadius: 7, border: `1px solid ${C.greyB}` }} />
        </div>
      </div>
    </Modal>
  );
}

/* ─── POP-UP : quantité d'un carton ─────────────────────── */
function PackQtyModal({ data, onClose, onConfirm }) {
  const [qty, setQty] = useState(data.suggestion || '');
  const valide = parseInt(qty) > 0;
  return (
    <Modal title="Vous scannez un carton — quelle quantité contient-il ?" onClose={onClose}>
      <p style={{ fontSize: 14, color: C.dark, margin: '0 0 6px' }}>{data.item.name}</p>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 18px' }}>
        Code <strong>{data.barcode}</strong> — reconnu comme un code de carton, mais sa
        contenance n'est pas encore connue. Elle est enregistrée définitivement :
        la question ne sera plus posée pour ce code.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="number" min="1" autoFocus value={qty} onChange={e => setQty(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && valide) onConfirm(parseInt(qty)); }}
          placeholder="ex. 10"
          style={{ width: 110, padding: '9px 11px', textAlign: 'center', fontSize: 15, fontWeight: 700,
            borderRadius: 8, border: `1px solid ${C.greyB}` }} />
        <span style={{ fontSize: 13.5, color: C.greyT }}>unités par carton</span>
        <Btn variant="accent" disabled={!valide} onClick={() => onConfirm(parseInt(qty))}
          style={{ marginLeft: 'auto' }}>Enregistrer</Btn>
      </div>
    </Modal>
  );
}

/* ─── POP-UP : code-barre inconnu ───────────────────────── */
function UnknownModal({ barcode, items, onClose, onAttach }) {
  const [selected, setSelected] = useState(null);
  const [type, setType] = useState('unit');
  const [qty, setQty] = useState(1);
  const item = items.find(i => i.id === selected);

  useEffect(() => { if (item && item.pack_qty > 1) setQty(item.pack_qty); }, [item]);

  return (
    <Modal title="Code-barre inconnu" onClose={onClose} width={640}>
      <p style={{ fontSize: 12.5, color: C.greyT, margin: '0 0 12px' }}>
        Le code <strong style={{ color: C.dark }}>{barcode}</strong> n'est associé à aucun article
        de cette commande. Choisissez l'article concerné — le code sera enregistré pour les
        prochaines réceptions.
      </p>

      {/* L'autre cas, et le plus fréquent après une livraison en plus : l'article
          n'est pas SUR le bon. L'API BMS ne sachant pas y ajouter une ligne, le
          seul chemin propre passe par BMS puis par le rechargement. */}
      <div style={{ background: C.accentL, border: `1px solid ${C.accent}`, borderRadius: 9,
        padding: '11px 14px', fontSize: 12.5, color: '#7C4A00', margin: '0 0 16px' }}>
        <strong>L'article n'est pas sur le bon de commande ?</strong> Fermez cette fenêtre et
        utilisez <strong>« Ajouter un article »</strong> : la ligne est créée dans BMS et ici,
        rattachée à la commande avec son prix d'achat.
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.greyB}`,
        borderRadius: 9, marginBottom: 16 }}>
        {items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: C.greyT, fontSize: 13.5 }}>
            Tous les articles de cette commande sont déjà comptés.
          </div>
        )}
        {items.map(it => (
          <div key={it.id} onClick={() => setSelected(it.id)} style={{
            padding: '10px 14px', cursor: 'pointer', fontSize: 13.5,
            borderBottom: `1px solid ${C.greyB}`,
            background: selected === it.id ? C.accentL : '#fff',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Thumb src={it.image_url} alt={it.name} size={90} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: selected === it.id ? 700 : 400 }}>{it.name}</div>
              <div style={{ fontSize: 11.5, color: C.greyT }}>
                {it.supplier_sku || it.sku} · reste {it.qty_remaining}
                {it.pack_size > 1 && ` · boîtes de ${it.pack_size}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ padding: '8px 11px', borderRadius: 7, border: `1px solid ${C.greyB}`, fontSize: 13.5 }}>
          <option value="unit">Code unité</option>
          <option value="pack">Code pack</option>
        </select>
        {type === 'pack' && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: C.greyT }}>
            Quantité par pack
            <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
              style={{ width: 82, padding: '7px 9px', textAlign: 'center', fontSize: 14, fontWeight: 700,
                borderRadius: 7, border: `1px solid ${C.greyB}` }} />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Annuler</Btn>
        <Btn variant="accent" disabled={!item}
          onClick={() => onAttach(item, type, Math.max(1, parseInt(qty) || 1))}>
          Rattacher
        </Btn>
      </div>
    </Modal>
  );
}

/* ─── APP ───────────────────────────────────────────────── */
export default function ReceptionApp() {
  const { token, permissions } = useContext(AuthContext);
  const [view, setView] = useState('list');       // list | detail | counting
  const [orderId, setOrderId] = useState(null);
  // `?order=123` ouvre directement la commande : c'est par là qu'on arrive
  // depuis l'écran des achats, sans avoir à la retrouver dans la liste.
  const [ouvertureDemandee] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('order');
    return p ? parseInt(p, 10) : null;
  });
  const [detail, setDetail] = useState(null);
  const [fin, setFin] = useState(null);   // récapitulatif d'une réception validée
  const [loading, setLoading] = useState(false);

  const canRead = permissions?.reception?.read === true;

  const loadDetail = useCallback((id) => {
    setLoading(true);
    return axios.get(`${API_URL}/reception/orders/${id}`, authHeaders(token))
      .then(r => setDetail(r.data.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [token]);


  const openOrder = useCallback((id) => { setOrderId(id); setView('detail'); loadDetail(id); }, [loadDetail]);

  const dejaOuverte = useRef(false);
  useEffect(() => {
    if (ouvertureDemandee && !dejaOuverte.current) {
      dejaOuverte.current = true;
      openOrder(ouvertureDemandee);
    }
  }, [ouvertureDemandee, openOrder]);

  if (permissions && !canRead) {
    return (
      <AppShell currentPath="/reception">
        <div style={{ padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à l'application Réception. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/reception">
      {view === 'list' && <OrdersList token={token} onOpen={openOrder} />}

      {view !== 'list' && loading && (
        <div style={{ padding: 40, color: C.greyT }}>Chargement…</div>
      )}

      {view === 'detail' && !loading && detail && (
        <OrderDetail
          token={token}
          order={detail.order}
          items={detail.items}
          onBack={() => { setView('list'); setDetail(null); }}
          onStart={() => setView('counting')}
        />
      )}

      {view === 'counting' && !loading && detail && (
        <CountingScreen
          token={token}
          order={detail.order}
          items={detail.items}
          onBack={() => setView('detail')}
          onReload={() => loadDetail(orderId)}
          onFinished={(resultat) => { setFin(resultat); setView('done'); }}
        />
      )}

      {/* Le récapitulatif vit ICI, pas dans l'écran de comptage : il doit
          survivre au rechargement de la commande, qui démonte celui-ci. */}
      {view === 'done' && fin && detail && (
        <RecapScreen
          order={detail.order}
          result={fin}
          onList={() => { setFin(null); setDetail(null); setView('list'); }}
          onOrder={() => { setFin(null); setView('detail'); loadDetail(orderId); }}
        />
      )}
    </AppShell>
  );
}
