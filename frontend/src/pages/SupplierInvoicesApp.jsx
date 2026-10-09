import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { Purchases as InvoiceIcon } from '../components/AppIcons';
import { useIsMobile } from '../hooks/useIsMobile';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
const BASE = `${API}/supplier-invoices`;

/**
 * La référence de commande, copiable d'un clic.
 *
 * Un lien direct a été tenté puis retiré : BMS protège ses URL par une clé liée
 * à la session, impossible à produire ici, et le lien tombait sur une page
 * d'erreur. Mieux vaut donner la référence à coller dans la recherche BMS qu'un
 * lien qui n'arrive pas.
 */
const OrderLink = ({ order, children }) => {
  const [copie, setCopie] = useState(false);
  if (!order) return <>{children}</>;
  return (
    <button
      type="button"
      title="Copier la référence pour la chercher dans BMS"
      onClick={() => {
        navigator.clipboard.writeText(String(order.bms_reference || children));
        setCopie(true);
        setTimeout(() => setCopie(false), 2000);
      }}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        color: C.main, fontWeight: 700, fontSize: 'inherit',
        borderBottom: `1px dotted ${C.main}`,
      }}
    >{copie ? 'référence copiée ✓' : <>{children} ⧉</>}</button>
  );
};

const C = {
  main: '#0F766E', mainD: '#115E59', mainL: '#ECFDF5',
  red: '#DC2626', redL: '#FEF2F2', green: '#16A34A', greenL: '#F0FDF4',
  orange: '#EA580C', orangeL: '#FFF7ED', blue: '#2563EB', blueL: '#EFF6FF',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#9CA3AF',
  dark: '#111827', white: '#FFFFFF',
};

/* ─── Mise en forme ──────────────────────────────────────── */
const eur = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};
const signedEur = (v) => {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : ''}${eur(n)}`;
};
const date = (s) => (s ? new Date(s).toLocaleDateString('fr-FR') : '—');
/**
 * L'écart d'une ligne, c'est son écart RÉEL : ce qu'elle a coûté, remise de pied
 * comprise, moins ce que la commande prévoyait.
 *
 * `gap` compare le montant BRUT de la facture au montant de la commande. Chez
 * LVP, qui facture au brut et ne retire ses −20 % qu'au pied, la ligne XROS de
 * la facture F2610287890 affichait « +12,30 € » juste à côté d'un écart
 * unitaire de −0,0044 € : deux chiffres justes, contradictoires à l'œil, et
 * aucun des deux ne tombait à zéro quand on appliquait le tarif.
 *
 * `netGap` est additif — la somme de la colonne vaut l'écart global de la
 * facture — et il tombe à zéro dès que le tarif réel est inscrit sur la
 * commande.
 *
 * Les documents enregistrés avant le 01/10/2026 ne l'ont pas. On le
 * RECONSTITUE alors depuis le COÛT RÉEL de la ligne, qu'eux ont : la facture
 * e.tasty #FA082519/2026 affichait « +10,50 € » juste à côté du badge
 * « Conforme ». Ses 10 ml sont facturés 1,35 € au brut et ramenés à 1,00 € —
 * le tarif commandé — par la promotion « PACK IMP 1€ 10ML » ; ses deux
 * promotions valent exactement les 543,50 € d'écart brut de la facture. Un
 * écart déjà absorbé n'est plus un écart, et le laisser à l'écran fait
 * réclamer ce qui a été accordé.
 *
 * Seulement quand la quantité facturée est celle commandée : sinon l'écart
 * porte aussi sur des pièces manquantes, dont le coût unitaire ne dit rien.
 */
const ecartDe = (l) => {
  if (l.netGap != null) return Number(l.netGap) || 0;
  const cout = l.effectiveUnitCost == null ? null : Number(l.effectiveUnitCost);
  const prevu = l.expectedUnitPrice == null ? null : Number(l.expectedUnitPrice);
  const facturee = l.qtyInvoiced == null ? null : Number(l.qtyInvoiced);
  const commandee = l.qtyOrdered == null ? null : Number(l.qtyOrdered);
  if (cout != null && prevu != null && facturee != null && commandee != null
      && Math.abs(facturee - commandee) < 0.005) {
    return Math.round((cout - prevu) * facturee * 100) / 100;
  }
  return Number(l.gap) || 0;
};
/** L'écart BRUT, celui que le document porte avant toute remise de pied. */
const ecartBrutDe = (l) => Number(l.gap) || 0;

/**
 * Les lignes d'un document avec leur écart réel, la REMISE DE PIED COMPRISE.
 *
 * Reconstituer l'écart des lignes produit ne suffit pas : la remise, elle,
 * garderait ses −543,50 € et la colonne ne sommerait plus l'écart global de la
 * facture — qui vaut zéro sur #FA082519/2026 (1 274,00 € facturés, 1 274,00 €
 * commandés). Un tableau dont les lignes ne font pas le total ne sert plus à
 * rien.
 *
 * On impute donc à la remise ce que les lignes produit lui ont déjà pris, comme
 * le moteur impute son `allocated` : la remise qui a servi vaut zéro d'écart,
 * et seule celle qu'aucune ligne n'explique garde la sienne.
 *
 * Tout ceci ne concerne que les documents enregistrés avant le 01/10/2026. Les
 * suivants portent leur `netGap` et passent ici sans être touchés.
 */
const avecEcartReel = (lines) => {
  const prep = (lines || []).map((l) => ({
    ...l, ecart: ecartDe(l), ecartBrut: ecartBrutDe(l), impute: 0,
  }));
  // Ce que la remise de pied a déjà absorbé sur les lignes produit.
  let reste = prep.reduce(
    (t, l) => t + (l.netGap == null ? l.ecartBrut - l.ecart : 0), 0,
  );
  for (const l of prep) {
    if (l.netGap != null || l.verdict !== 'discount' || !(l.ecart < 0) || !(reste > 0.005)) continue;
    const impute = Math.min(reste, -l.ecart);
    l.impute = Math.round(impute * 100) / 100;
    l.ecart = Math.round((l.ecart + impute) * 100) / 100;
    reste = Math.round((reste - impute) * 100) / 100;
  }
  return prep;
};
const num = (v) => (v == null ? '—' : String(Math.round(Number(v) * 1000) / 1000));

/**
 * « Qté cmd / fact » quand les deux côtés ne comptent pas dans la même unité.
 * « 30 / 6 » laissait croire à 24 pièces manquantes, alors que la facture compte
 * 6 cartons de 5 (JoshNoa V3/2026/38291) : on écrit « 30 / 6 × 5 ».
 */
const qteCmdFact = (ord, inv, packFactor) => {
  if (!packFactor || ord == null || inv == null) return `${num(ord)} / ${num(inv)}`;
  return Number(inv) < Number(ord)
    ? `${num(ord)} / ${num(inv)} × ${packFactor}`
    : `${num(ord)} × ${packFactor} / ${num(inv)}`;
};

/**
 * Les familles d'écart, dans l'ordre où elles comptent. Doit rester alignée sur
 * DIFFERENCE_KINDS (backend/src/utils/invoiceCompare.js) : l'écran n'a pas le
 * droit de taire une différence que le moteur a vue.
 */
const VERDICTS = {
  qty_price: { rank: 1, label: 'Quantité et tarif', tone: 'red', action: 'Ajuster la commande et réclamer le tarif' },
  missing_in_invoice: { rank: 2, label: 'Commandé, non facturé', tone: 'orange', action: 'Reliquat ou manquant : vérifier la livraison' },
  qty: { rank: 3, label: 'Quantité', tone: 'orange', action: 'Ajuster la quantité de la commande' },
  price: { rank: 4, label: 'Tarif', tone: 'red', action: 'Réclamer un avoir, ou aligner si le prix a changé' },
  not_ordered: { rank: 5, label: 'Facturé, non commandé', tone: 'red', action: 'Article ajouté : accepter ou contester' },
  shipping: { rank: 6, label: 'Frais de port', tone: 'blue', action: 'Non prévus à la commande' },
  discount: { rank: 7, label: 'Remise de pied', tone: 'green', action: 'Répartie sur le coût réel de chaque ligne' },
  voucher: { rank: 7, label: 'Bon à valoir', tone: 'blue', action: "Bon d'une facture précédente : ne baisse pas le coût de cette commande" },
  free: { rank: 8, label: 'Offert', tone: 'green', action: 'Geste commercial, rien à faire' },
  credit: { rank: 8, label: 'Avoir', tone: 'green', action: 'Vient en déduction, rien à réclamer' },
  credited: { rank: 8, label: 'Compensé par avoir', tone: 'green', action: 'Avoir reçu du fournisseur, rien à réclamer' },
  voucher_credited: { rank: 8, label: 'Compensé par bon', tone: 'green', action: 'Bon de réduction promis par le fournisseur, rien à réclamer' },
  packaging: { rank: 9, label: 'Conditionnement', tone: 'grey', action: 'Unités contre packs : même marchandise, même montant' },
  // Complété à l'affichage par le facteur déduit (« vendu par 2 »), quand on l'a.

  rounding: { rank: 10, label: 'Arrondi de remise', tone: 'grey', action: 'Calcul du fournisseur, pas une erreur de tarif' },
  other: { rank: 11, label: 'Ligne hors produit', tone: 'grey', action: 'À qualifier' },
  ok: { rank: 99, label: 'Conforme', tone: 'green', action: null },
};
/**
 * Les verdicts qui n'appellent AUCUN geste. Même liste que le décompte
 * « Écarts » de la liste des factures (supplierDocumentModel.listDocuments) :
 * l'écran n'a pas le droit d'annoncer une différence que la liste ne compte
 * pas, ni l'inverse. Un geste suppose en plus un écart matériel — au-delà du
 * garde-fou d'arrondi.
 */
const VERDICTS_SANS_GESTE = ['ok', 'free', 'discount', 'voucher', 'rounding', 'packaging', 'shipping', 'credit', 'credited', 'voucher_credited'];
const appelleUnGeste = (l) => !!l.verdict && !VERDICTS_SANS_GESTE.includes(l.verdict) && !!l.material;

/**
 * Les lignes d'un document qu'on met à l'écran : tout ce qui est produit, et le
 * hors produit qui porte un montant ou un écart. Un port OFFERT à 0,00 € n'est
 * pas une ligne de contrôle — il figurait pourtant au décompte des différences
 * de la facture FAC/2026/04474.
 *
 * Une seule définition, parce que l'intitulé (« tant de lignes ») et le tableau
 * en dessous doivent compter la même chose.
 */
const lignesAffichables = (lines) => (lines || [])
  .filter((l) => l.verdict)
  .filter((l) => (l.kind || 'product') === 'product'
    || Math.abs(Number(l.lineTotalHt) || 0) >= 0.005
    || Math.abs(ecartDe(l)) >= 0.005);

const TONES = {
  red: { color: C.red, bg: C.redL }, orange: { color: C.orange, bg: C.orangeL },
  green: { color: C.green, bg: C.greenL }, blue: { color: C.blue, bg: C.blueL },
  grey: { color: C.greyT, bg: C.grey },
};

const STATUS_LABELS = { to_check: 'À contrôler', checked: 'Contrôlée', disputed: 'En litige', archived: 'Archivée' };
/**
 * L'état du contrôle se lit à la couleur : rouge tant que la facture n'est pas
 * contrôlée, vert quand elle l'est. Sur une liste de cent documents, le libellé
 * seul obligeait à lire chaque ligne pour trouver ce qui restait à faire.
 */
const STATUS_TONES = { to_check: 'red', checked: 'green', disputed: 'orange', archived: 'grey' };
const statusStyle = (status) => {
  const t = TONES[STATUS_TONES[status]] || TONES.grey;
  return { color: t.color, background: t.bg, borderColor: t.color, fontWeight: 700 };
};
const PAYMENT_LABELS = { paid: 'Payée', partial: 'Partielle', unpaid: 'À payer', unknown: 'Inconnu' };
const METHODS = [
  ['amex', 'Amex'], ['cb', 'Carte bancaire'], ['virement', 'Virement'],
  ['prelevement', 'Prélèvement'], ['cheque', 'Chèque'], ['especes', 'Espèces'],
  ['avoir', 'Avoir'], ['autre', 'Autre'],
];

/* ─── Petits composants ──────────────────────────────────── */
const Badge = ({ children, tone = 'grey' }) => (
  <span style={{
    display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
    whiteSpace: 'nowrap', ...TONES[tone],
  }}>{children}</span>
);

/**
 * Le pourcentage de mise en stock d'une facture : 0 % tant que rien n'est
 * arrivé, 100 % quand toute la commande rapprochée est rangée.
 *
 * null quand aucune commande n'est rapprochée : on ne sait pas, et dire « 0 % »
 * ferait croire à une livraison manquante.
 */
const storagePct = (ordered, received) => {
  const cmd = Number(ordered) || 0;
  if (cmd <= 0) return null;
  return Math.round(((Number(received) || 0) / cmd) * 100);
};
const StorageBadge = ({ ordered, received }) => {
  const pct = storagePct(ordered, received);
  if (pct === null) {
    return <span style={{ color: C.greyM }} title="Aucune commande rapprochée : réception inconnue">—</span>;
  }
  return (
    <span title={`${Number(received) || 0} pièce(s) en stock sur ${Number(ordered) || 0} commandée(s)`}>
      <Badge tone={pct >= 100 ? 'green' : (pct > 0 ? 'orange' : 'red')}>{pct} %</Badge>
    </span>
  );
};

/**
 * Le tarif facturé diffère-t-il de la commande ?
 *
 * Même lecture que le « réclamable » de l'écran de contrôle : seules les lignes
 * dont l'écart de tarif SUBSISTE après la remise de pied, au-delà du garde-fou
 * d'arrondi de 0,10 €. C'est une alerte, pas un blocage — on règle des factures
 * au tarif différent tous les mois, il faut seulement le savoir avant.
 */
/** Le plafond du serveur (`supplierInvoicesController.listDocuments`). */
const LIMITE_LISTE = 500;

const SEUIL_TARIF = 0.10;
const ecartTarifDe = (l) => {
  // Facturé AU CARTON, commandé EN PIÈCES : le résidu de tarif compare alors un
  // prix de carton à un prix de pièce et annonce six fois l'écart réel (25,96 €
  // contre 4,50 € : +21,46 € affichés pour 3,46 € de trop, V3/2026/37644). Dans
  // ce cas, l'écart réel de la ligne est le seul chiffre lisible — et c'est aussi
  // celui que le message au commercial réclame.
  if (packFactorStored(l) && l.net_gap != null) return Number(l.net_gap) || 0;
  return Number(l.residual_gap_price != null ? l.residual_gap_price : l.gap_price) || 0;
};
const lignesEcartTarif = (lines) => (lines || []).filter((l) => ['price', 'qty_price'].includes(l.verdict)
  && l.material && Math.abs(ecartTarifDe(l)) >= SEUIL_TARIF);

const Kpi = ({ label, value, tone, hint, title }) => (
  <div title={title} style={{
    flex: 1, minWidth: 140, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`,
    padding: '13px 16px',
  }}>
    <div style={{ fontSize: 21, fontWeight: 800, color: tone ? TONES[tone].color : C.dark }}>{value}</div>
    <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{label}</div>
    {/* Ce que le chiffre ne dit pas tout seul : la période qu'il couvre, ou ce
        qui manque pour qu'il soit complet. Un total de TVA sans son périmètre
        est un chiffre qu'on recopie dans une déclaration sans le savoir. */}
    {hint && <div style={{ fontSize: 10.5, color: C.greyM, marginTop: 3 }}>{hint}</div>}
  </div>
);

const Btn = ({ children, onClick, variant = 'primary', disabled, small, type = 'button' }) => {
  const styles = {
    primary: { background: C.main, color: '#fff', border: 'none' },
    ghost: { background: '#fff', color: C.main, border: `1px solid ${C.greyB}` },
    danger: { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      ...styles, padding: small ? '6px 11px' : '9px 16px', borderRadius: 8, fontWeight: 600,
      fontSize: small ? 12 : 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
    }}>{children}</button>
  );
};

const inputStyle = {
  padding: '8px 10px', border: `1px solid ${C.greyB}`, borderRadius: 8,
  fontSize: 13, color: C.dark, outline: 'none', background: C.white,
};
const Field = ({ label, children, width }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: width || 150 }}>
    <label style={{ fontSize: 11, fontWeight: 600, color: C.greyT }}>{label}</label>
    {children}
  </div>
);
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, color: C.greyT, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' };
const td = { padding: '11px 12px', fontSize: 13, color: C.dark, borderBottom: `1px solid ${C.greyB}` };

/* ─── La facture, ligne à ligne ───────────────────────────
 * Règle posée le 25/09/2026 : TOUTES les différences sont affichées, sans
 * filtre de seuil. Le seuil ne décide que de ce qui part en réclamation.
 *
 * Depuis le 02/10/2026, les lignes CONFORMES y sont aussi. « 2 différences sur
 * 13 lignes » laissait les onze autres invisibles — or contrôler une facture,
 * c'est autant voir ce qui a bien été compté que ce qui cloche. Elles passent
 * après les différences (rang 99) et portent leur badge vert.
 *
 * Une ligne HORS PRODUIT À ZÉRO, elle, n'a rien à y faire : le « Frais de
 * transport EXTRANET Livraison standard » à 0,00 € de la facture FAC/2026/04474
 * était compté comme une différence alors qu'un port offert n'est pas un écart.
 * Un port FACTURÉ reste affiché : il n'était pas prévu à la commande.
 * ──────────────────────────────────────────────────────── */
/**
 * Ce qu'il faut dire sous un écart qu'on a corrigé : ne pas afficher un écart
 * absorbé est juste, le faire disparaître sans un mot ne l'est pas.
 */
const NoteEcart = ({ l, align }) => {
  const style = {
    fontSize: 10.5, fontWeight: 600, color: C.greyM, whiteSpace: 'nowrap',
    textAlign: align || undefined,
  };
  if (l.discountShare > 0) {
    return <div style={style}>facturé {signedEur(l.ecartBrut)} − {eur(l.discountShare)} de remise</div>;
  }
  if (l.impute > 0) {
    return <div style={style}>{eur(l.impute)} imputés au coût des lignes</div>;
  }
  if (Math.abs(l.ecartBrut - l.ecart) >= 0.005) {
    return <div style={style}>facturé {signedEur(l.ecartBrut)}, absorbé par la remise</div>;
  }
  return null;
};

function DifferencesTable({ lines, mobile }) {
  const rows = useMemo(() => avecEcartReel(lignesAffichables(lines))
    .map((l) => ({ ...l, meta: VERDICTS[l.verdict] || VERDICTS.other }))
    .sort((a, b) => (a.meta.rank - b.meta.rank) || (Math.abs(b.ecart) - Math.abs(a.ecart))), [lines]);

  const gestes = rows.filter(appelleUnGeste).length;

  if (rows.length === 0) {
    return (
      <div style={{ padding: 18, background: C.grey, color: C.greyM, borderRadius: 10, fontSize: 13, textAlign: 'center' }}>
        Aucune ligne enregistrée pour ce document.
      </div>
    );
  }

  // Le verdict d'ensemble, au-dessus du détail : il disait « aucune différence »
  // À LA PLACE du tableau, et on perdait le détail de ce qui avait été compté.
  const verdict = gestes === 0 && (
    <div style={{
      padding: 13, marginBottom: 10, color: C.green, fontWeight: 600, fontSize: 13,
      background: C.greenL, borderRadius: 10,
    }}>
      Aucune différence à traiter : la facture correspond à la commande, ligne à ligne.
    </div>
  );

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {verdict}
        {rows.map((l, i) => (
          <div key={i} style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{l.ref || '—'}</div>
              <Badge tone={l.meta.tone}>{l.meta.label}</Badge>
            </div>
            <div style={{ fontSize: 12, color: C.greyT, margin: '4px 0 8px' }}>{l.label || ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span>cmd / fact {qteCmdFact(l.qtyOrdered, l.qtyInvoiced, l.packFactor)}</span>
              <span style={{ color: C.greyT }}>{eur(l.lineTotalHt)} HT</span>
              <strong style={{ color: l.ecart > 0 ? C.red : (l.ecart < 0 ? C.green : C.greyM) }}>
                {signedEur(l.ecart)}
              </strong>
            </div>
            <NoteEcart l={l} align="right" />
            {(notePiece(l) || l.meta.action) && (
              <div style={{ fontSize: 11.5, color: C.greyM, marginTop: 6 }}>{notePiece(l) || l.meta.action}</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
    {verdict}
    <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Référence</th>
            <th style={th}>Produit</th>
            <th style={th}>Type</th>
            <th style={{ ...th, textAlign: 'right' }}>Qté cmd / fact</th>
            <th style={{ ...th, textAlign: 'right' }}>Tarif commandé</th>
            <th style={{ ...th, textAlign: 'right' }}>Tarif facturé</th>
            <th style={{ ...th, textAlign: 'right' }}>Montant HT</th>
            <th style={{ ...th, textAlign: 'right' }}>Écart HT</th>
            <th style={th}>À faire</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            // Une ligne conforme se lit en gris : elle est là pour être vue, pas
            // pour disputer l'attention à ce qui cloche.
            <tr key={i} style={{ color: l.verdict === 'ok' ? C.greyT : C.dark }}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', color: 'inherit' }}>{l.ref || '—'}</td>
              <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' }}>{l.label || ''}</td>
              <td style={td}><Badge tone={l.meta.tone}>{l.meta.label}</Badge></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: 'inherit' }}>{qteCmdFact(l.qtyOrdered, l.qtyInvoiced, l.packFactor)}</td>
              <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>{l.expectedUnitPrice == null ? '—' : eur(l.expectedUnitPrice)}</td>
              <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>
                {l.invoicedUnitPrice == null ? '—' : eur(l.invoicedUnitPrice)}
                {/* Le tarif du document n'est pas toujours ce que la ligne a
                    coûté : la remise de pied passe après. Sans ce rappel, un
                    « 1,35 € facturé » en face d'un « 1,00 € commandé » et d'un
                    écart nul reste incompréhensible. */}
                {l.effectiveUnitCost != null && l.invoicedUnitPrice != null
                  && Math.abs(l.effectiveUnitCost - l.invoicedUnitPrice) >= 0.005 && (
                  <div style={{ fontSize: 10.5, color: C.greyM, whiteSpace: 'nowrap' }}>
                    {eur(l.effectiveUnitCost)} réel
                  </div>
                )}
              </td>
              <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>{eur(l.lineTotalHt)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.ecart > 0 ? C.red : (l.ecart < 0 ? C.green : C.greyM) }}>
                {signedEur(l.ecart)}
                <NoteEcart l={l} />
              </td>
              <td style={{ ...td, fontSize: 11.5, color: C.greyT }}>
                {l.verdict === 'packaging' && l.packFactor
                  ? `Vendu par ${l.packFactor} chez ce fournisseur : ${num(l.qtyInvoiced)} × ${l.packFactor} = ${num(l.qtyOrdered)} unités`
                  : (l.verdict === 'credited' && l.creditedBy
                    ? `Compensé par l'avoir ${l.creditedBy}`
                    : (notePiece(l) || l.meta.action || ''))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/**
 * Les lignes telles qu'elles ont été LUES, quand il n'y a aucune commande à
 * confronter. Un avoir de régularisation n'en a pas.
 *
 * Ce tableau remplace le bandeau vert « aucune différence » qui s'affichait
 * alors : annoncer que tout correspond quand rien n'a été comparé est la pire
 * chose qu'un contrôle puisse faire.
 */
function ReadLinesTable({ lines, mobile }) {
  const produits = (lines || []).filter((l) => (l.kind || 'product') === 'product');
  if (produits.length === 0) {
    return <div style={{ padding: 18, background: C.orangeL, color: C.orange, borderRadius: 10, fontSize: 13 }}>
      Aucune ligne lue dans ce document.
    </div>;
  }
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Référence</th>
          <th style={th}>Produit</th>
          <th style={{ ...th, textAlign: 'right' }}>Qté</th>
          <th style={{ ...th, textAlign: 'right' }}>Prix unitaire</th>
          <th style={{ ...th, textAlign: 'right' }}>Montant HT</th>
        </tr></thead>
        <tbody>
          {(lines || []).map((l, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.ref || '—'}</td>
              <td style={{ ...td, maxWidth: mobile ? 160 : 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.label || ''}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>{num(l.qty)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.unitPriceNet == null ? '—' : eur(l.unitPriceNet)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{eur(l.lineTotalHt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Règle un document isolé : un règlement, une imputation.
 *
 * Le montant est celui qui RESTE dû — négatif pour un avoir, qui vient alors en
 * déduction. C'est la même mécanique que la sélection multiple de l'onglet
 * Factures, réduite à une ligne.
 */
async function settleOne(document, { method, paid_at, reference }) {
  const reste = Number(document.remaining_amount) || 0;
  await axios.post(`${BASE}/payments`, {
    supplier_id: document.supplier_id,
    method,
    paid_at,
    amount: Math.round(reste * 100) / 100,
    reference,
    allocations: [{ document_id: document.id, amount: reste }],
  });
}

/**
 * LE MESSAGE DE RÉCLAMATION DANS LE PRESSE-PAPIERS.
 *
 * Hors de tout écran, parce qu'il se copie depuis DEUX endroits : l'écran de
 * contrôle, juste après l'enregistrement, et la facture rouverte depuis la liste.
 * Il n'existait qu'au premier — une facture quittée puis rouverte affichait bien
 * son écart de tarif, sans plus aucun moyen d'en écrire au commercial (relevé sur
 * V3/2026/37644, le 02/10/2026).
 *
 * @returns {Promise<boolean>} faux quand il n'y a rien à réclamer.
 */
async function copierReclamation(id) {
  const { data } = await axios.get(`${BASE}/${id}/claim`);
  if (!data.body) return false;

  const texte = `${data.subject}\n\n${data.body}`;
  // On met les DEUX formats dans le presse-papiers : la messagerie colle le
  // tableau HTML, un champ de texte simple colle le brut. Sans ça, le tableau
  // n'était calé qu'aux espaces et se décalait dès que la police n'était pas
  // à chasse fixe — donc dans Gmail, donc toujours.
  try {
    if (data.bodyHtml && window.ClipboardItem) {
      const html = `<p><strong>${data.subject}</strong></p>${data.bodyHtml}`;
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texte], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(texte);
    }
  } catch {
    await navigator.clipboard.writeText(texte);
  }
  return true;
}

/**
 * Le conditionnement reconstitué d'une ligne gelée : le rapport des quantités
 * quand il est ENTIER. Le moteur le calcule (`packFactor`), la base ne le garde
 * pas — et sans lui, un carton de 5 facturé 25,96 € s'affiche en face d'un tarif
 * commandé de 4,50 € sans un mot d'explication.
 */
/** Un prix à la pièce, au millième quand le centime ne suffit pas (5,192 €). */
const prixPiece = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const auMillieme = Math.abs(n * 100 - Math.round(n * 100)) >= 0.05;
  return `${n.toLocaleString('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: auMillieme ? 3 : 2,
  })} €`;
};

/**
 * Ce qu'il faut dire d'une ligne que le fournisseur facture AU CARTON quand la
 * commande compte en pièces, et qui porte en plus un écart de tarif : à quelle
 * unité cet écart se lit. Sans ça, « 4,50 € commandé » en face de
 * « 25,96 € facturé » et d'un écart de 3,46 € ne s'explique pas (V3/2026/37644,
 * ligne josh00012308 : un carton de 5).
 */
const notePiece = (l) => {
  if (!l.packFactor || l.verdict === 'packaging') return null;
  const pieces = Math.max(Number(l.qtyInvoiced), Number(l.qtyOrdered));
  if (!(pieces > 0) || l.expectedUnitPrice == null) return null;
  const facture = Number(l.lineTotalHt) / pieces;
  const commande = (Number(l.qtyOrdered) * Number(l.expectedUnitPrice)) / pieces;
  return `Vendu par ${l.packFactor} : ${prixPiece(facture)} la pièce facturée `
    + `contre ${prixPiece(commande)} commandée`;
};

const packFactorStored = (l) => {
  const inv = Number(l.qty);
  const ord = Number(l.expected_qty);
  if (!(inv > 0) || !(ord > 0) || inv === ord) return null;
  const f = inv > ord ? inv / ord : ord / inv;
  const arrondi = Math.round(f);
  return arrondi >= 2 && Math.abs(f - arrondi) < 0.01 ? arrondi : null;
};

/** Lignes gelées en base → forme attendue par le tableau. */
const fromStoredLines = (lines) => (lines || []).map((l) => ({
  ref: l.supplier_sku,
  label: l.label,
  verdict: l.verdict,
  qtyOrdered: l.expected_qty,
  qtyInvoiced: l.qty,
  expectedUnitPrice: l.expected_unit_price,
  invoicedUnitPrice: l.qty && Number(l.qty) !== 0 ? Number(l.line_total_ht) / Number(l.qty) : null,
  gap: Number(l.gap) || 0,
  netGap: l.net_gap == null ? null : Number(l.net_gap),
  discountShare: Number(l.discount_share) || 0,
  // Sans le genre ni le montant, impossible d'écarter une ligne hors produit à
  // zéro ni d'afficher ce que la ligne a coûté.
  kind: l.kind || 'product',
  lineTotalHt: Number(l.line_total_ht) || 0,
  material: !!l.material,
  // Le coût réel de la ligne, remises de pied comprises : c'est lui qui dit
  // qu'un écart brut a déjà été absorbé.
  effectiveUnitCost: l.effective_unit_cost == null ? null : Number(l.effective_unit_cost),
  packFactor: packFactorStored(l),
  // Le ou les avoirs qui ont rendu l'écart de cette ligne.
  creditedBy: l.credited_by || null,
}));

/* ═══════════════════════════════════════════════════════════
 * ONGLET 1 — Contrôle d'une facture
 * ═══════════════════════════════════════════════════════════ */
/**
 * Rapprochement manuel : désigner la commande quand la référence imprimée n'y
 * mène pas.
 *
 * La facture GFC F2601377295 porte « 548638 », le numéro interne du fournisseur ;
 * la commande correspondante est enregistrée chez nous sous « ZWMEFWKYY ». Aucun
 * rapprochement automatique n'était possible, et l'écran s'arrêtait là.
 *
 * Le champ accepte la référence, le numéro de commande, l'identifiant BMS — et
 * l'URL BMS collée telle quelle, parce que c'est ce que l'acheteur a sous les
 * yeux quand il regarde la commande dans BMS.
 */
/**
 * Les tarifs à reporter dans BMS.
 *
 * L'API BoostMyShop n'expose AUCUNE route d'écriture sur les prix fournisseur
 * (son Swagger ne déclare que treize écritures, dont une seule côté achats :
 * créer un bon de commande). Le report se fait donc à la main — le rôle de
 * l'app est de dire quoi saisir, et de le rendre copiable d'un geste.
 */
/**
 * Le tableau UNIQUE de l'écran de contrôle.
 *
 * Il y en avait deux, et une ligne dont le seul reproche était le tarif
 * figurait dans les deux — en haut avec son bouton de tarif, en bas avec
 * « Réclamer un avoir ». Chaque ligne porte maintenant son MOTIF : le prix a
 * bougé, la quantité ne correspond pas, ou les deux.
 */
function ControlTable({ rows, supplierId, orderId, orderReceived, mobile, onApplied }) {
  const [applying, setApplying] = useState(false);
  const [perLine, setPerLine] = useState({});
  // Tarif NÉGOCIÉ saisi à la main, par réf. : le prix de la commande BMS était
  // faux (Dojo LCA convenues à 3,00 €, portées à 2,50 € / 2,80 € dans BMS,
  // facturées 3,436 €). Inscrit à la place du tarif BMS, il laisse à réclamer
  // facturé − négocié, et c'est cet écart que porte le message au commercial.
  const [negocie, setNegocie] = useState({});

  const aAppliquer = (rows || []).filter((r) => r.tariff && perLine[r.ref] !== 'negotiated');

  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: 22, textAlign: 'center', color: C.green, fontWeight: 600, background: C.greenL, borderRadius: 10 }}>
        Aucune différence : la facture correspond à la commande, ligne à ligne.
      </div>
    );
  }

  const prix = (n) => (n == null ? '—'
    : `${Number(n).toFixed(4).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',')} €`);

  /**
   * Un seul geste : inscrire le prix réel chez nous ET corriger la commande qui
   * vient de le payer.
   *
   * Il y avait deux boutons, « Retenir » (le tarif de référence seul) et
   * « Appliquer » (le tarif + la commande). Retenir n'a jamais eu de cas à lui :
   * ce tableau ne s'affiche QUE lorsqu'une commande est rattachée (sans elle,
   * `comparison` est nul et c'est la liste des lignes lues qui sort), donc
   * Appliquer était toujours disponible et faisait strictement plus. Deux
   * boutons voisins dont l'un est un sous-ensemble de l'autre ne se distinguent
   * pas à l'usage — ils se choisissent au hasard.
   *
   * Fixer un tarif de référence SANS toucher à un lot reste possible, là où ça a
   * un sens : l'écran des références fournisseur (Achats → Fournisseurs).
   */
  const envoyer = async (liste, etatSucces = 'applied') => {
    const { data } = await axios.post(`${BASE}/apply-tariffs`, {
      supplier_id: supplierId,
      order_id: orderId,
      tariffs: liste.map((t) => ({ ref: t.ref, realPrice: t.realPrice, packQty: t.packQty })),
    });
    setPerLine((p) => {
      const n = { ...p };
      for (const a of data.applied || []) {
        // Un tarif inscrit chez nous mais qu'aucune ligne de la commande ne
        // porte n'est pas un succès complet : le dire, plutôt que d'afficher
        // « Appliqué » sur un FIFO resté au prix commandé.
        //
        // Même chose pour BMS : c'est LUI que l'écran relit pour « Tarif BMS » et
        // « Commande HT ». Un report refusé et tu reverras le même écart sans
        // comprendre pourquoi — alors qu'il ne reste qu'à corriger la ligne à la
        // main dans BMS.
        if (a.orderLine?.skipped) n[a.ref] = `tarif retenu, commande inchangée : ${a.orderLine.skipped}`;
        else if (a.bmsLine?.skipped) n[a.ref] = `appliqué chez nous, BMS inchangé : ${a.bmsLine.skipped}`;
        else n[a.ref] = etatSucces;
      }
      for (const k of data.skipped || []) n[k.ref] = k.reason;
      return n;
    });
    // Le tarif est inscrit : l'écart de cette ligne n'existe plus. On rejoue donc
    // l'analyse contre la commande telle qu'elle est MAINTENANT, pour que
    // l'« Écart » du haut descende de ce qu'on vient de corriger. Sans ça, l'écran
    // continuait d'afficher un écart déjà réglé, et plus rien ne disait si le
    // report chez BMS avait pris.
    if (onApplied) await onApplied();
  };

  // Réécrire le prix d'un lot DÉJÀ REÇU déplace une valeur de stock historique.
  // On le fait — le prix payé est le prix payé, même six mois après — mais
  // jamais sans l'avoir dit.
  const confirmeSiRecue = () => !orderReceived || window.confirm(
    'Cette commande a déjà été réceptionnée.\n\n'
    + 'Corriger son prix modifiera la valeur du stock à partir de sa date de réception, '
    + 'ainsi que le coût de revient des pièces déjà vendues.\n\nContinuer ?',
  );

  const appliquerUne = async (t) => {
    if (!confirmeSiRecue()) return;
    setPerLine((p) => ({ ...p, [t.ref]: 'busy' }));
    try { await envoyer([t]); }
    catch (e) { setPerLine((p) => ({ ...p, [t.ref]: e.response?.data?.error || e.message })); }
  };

  const inscrireNegocie = async (t) => {
    const saisi = Number(String(negocie[t.ref] || '').replace(',', '.'));
    if (!(saisi > 0)) { window.alert('Saisis le tarif négocié.'); return; }
    if (!window.confirm(
      `Inscrire ${prix(saisi)} comme tarif négocié pour ${t.ref} `
      + '(référence fournisseur, commande chez nous et dans BMS) ?\n\n'
      + `L'écart restant (facturé ${prix(t.realPrice)} − négocié ${prix(saisi)}) sera à réclamer.`,
    )) return;
    if (!confirmeSiRecue()) return;
    setPerLine((p) => ({ ...p, [t.ref]: 'busy' }));
    try {
      await envoyer([{ ...t, realPrice: Math.round(saisi * 10000) / 10000 }], 'negotiated');
      setNegocie((n) => { const c = { ...n }; delete c[t.ref]; return c; });
    } catch (e) { setPerLine((p) => ({ ...p, [t.ref]: e.response?.data?.error || e.message })); }
  };

  const toutAppliquer = async () => {
    if (!confirmeSiRecue()) return;
    setApplying(true);
    try { await envoyer(aAppliquer.map((r) => r.tariff)); }
    catch (e) { window.alert(e.response?.data?.error || e.message); }
    finally { setApplying(false); }
  };

  const bouton = (r) => {
    if (!r.tariff) return null;
    const etat = perLine[r.ref];
    if (etat === 'applied') return <span style={{ color: C.green, fontWeight: 600, fontSize: 12 }}>Appliqué</span>;
    if (etat === 'negotiated') {
      return <span style={{ color: C.green, fontWeight: 600, fontSize: 12 }}>Tarif négocié inscrit — reste à réclamer</span>;
    }
    if (etat && etat !== 'busy') return <span style={{ color: C.orange, fontSize: 11.5 }}>{etat}</span>;
    if (negocie[r.ref] !== undefined) {
      return (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Btn onClick={() => inscrireNegocie(r.tariff)} small disabled={etat === 'busy'}>
            {etat === 'busy' ? '…' : 'Inscrire'}
          </Btn>
          <Btn variant="ghost" small onClick={() => setNegocie((n) => { const c = { ...n }; delete c[r.ref]; return c; })}>
            Annuler
          </Btn>
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        <Btn onClick={() => appliquerUne(r.tariff)} small disabled={etat === 'busy'}>
          {etat === 'busy' ? '…' : 'Appliquer'}
        </Btn>
        <Btn variant="ghost" small disabled={etat === 'busy'}
          onClick={() => setNegocie((n) => ({ ...n, [r.ref]: String(r.tariff.currentPrice ?? '') }))}>
          Tarif négocié
        </Btn>
      </span>
    );
  };

  const entete = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.dark }}>
        À examiner ({rows.length})
      </h3>
      {aAppliquer.length > 0 && (
        <Btn onClick={toutAppliquer} disabled={applying} small>
          {applying ? 'Application…' : `Tout appliquer (${aAppliquer.length})`}
        </Btn>
      )}
      {/* Le FIFO lit le prix de la COMMANDE, jamais celui de la facture : sans
          ce geste, la marchandise entre en stock au prix qu'on croyait payer. */}
      <span style={{ fontSize: 12, color: C.greyT, flex: '1 1 320px', minWidth: 260 }}>
        <strong>Tarif négocié</strong> : quand c'est le tarif BMS qui est faux, saisis le prix convenu ;
        il est inscrit à sa place et seul l'écart facturé − négocié reste à réclamer.{' '}
        Appliquer écrit le <strong>prix réel payé</strong> dans notre référentiel — il fera autorité
        à l'import de la prochaine commande, même s'il est plus élevé, le cas d'une promotion
        terminée — et corrige <strong>le prix de cette commande</strong>, pour que le coût de revient
        FIFO de ces pièces soit celui qu'on a vraiment payé. Chaque ligne porte son écart
        <strong> réel, remise de pied comprise</strong> : la colonne somme l'« Écart » affiché plus
        haut, et l'appliquer le fait tomber à zéro.
      </span>
    </div>
  );

  if (mobile) {
    return (
      <div>
        {entete}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r, i) => {
            const meta = VERDICTS[r.verdict] || VERDICTS.other;
            return (
              <div key={i} style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{r.ref || '—'}</div>
                  <Badge tone={meta.tone}>{r.kindLabel || meta.label}</Badge>
                </div>
                <div style={{ fontSize: 12, color: C.greyT, margin: '4px 0 8px' }}>{r.label || ''}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>cmd / fact {qteCmdFact(r.qtyOrdered, r.qtyInvoiced, r.packFactor)}</span>
                  <strong style={{ color: ecartDe(r) > 0 ? C.red : C.green }}>{signedEur(ecartDe(r))}</strong>
                </div>
                {r.discountShare > 0 && (
                  <div style={{ fontSize: 11, color: C.greyM, textAlign: 'right' }}>
                    facturé {signedEur(r.gap)}, remise de pied −{eur(r.discountShare)}
                  </div>
                )}
                {r.tariff && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 12.5 }}>
                      {negocie[r.ref] !== undefined ? (
                        <input value={negocie[r.ref]} inputMode="decimal" aria-label={`Tarif négocié ${r.ref}`}
                          onChange={(e) => setNegocie((n) => ({ ...n, [r.ref]: e.target.value }))}
                          style={{ ...inputStyle, padding: '4px 6px', width: 70, textAlign: 'right' }} />
                      ) : prix(r.tariff.currentPrice)} → <strong>{prix(r.tariff.realPrice)}</strong>
                    </span>
                    {bouton(r)}
                  </div>
                )}
                {!r.tariff && meta.action && (
                  <div style={{ fontSize: 11.5, color: C.greyM, marginTop: 6 }}>{r.action || meta.action}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {entete}
      <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Référence</th>
              <th style={th}>Produit</th>
              <th style={th}>Motif</th>
              <th style={{ ...th, textAlign: 'right' }}>Qté cmd / fact</th>
              <th style={{ ...th, textAlign: 'right' }}>Tarif BMS</th>
              <th style={{ ...th, textAlign: 'right' }}>Tarif réel payé</th>
              <th style={{ ...th, textAlign: 'right' }}>Écart unitaire</th>
              <th style={{ ...th, textAlign: 'right' }}>Écart total</th>
              <th style={th}>À faire</th>
              <th style={{ ...th, textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = VERDICTS[r.verdict] || VERDICTS.other;
              const t = r.tariff;
              return (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.ref || '—'}</td>
                  <td style={{ ...td, color: C.greyT }}>{(r.label || '').slice(0, 52)}</td>
                  <td style={td}><Badge tone={meta.tone}>{r.kindLabel || meta.label}</Badge></td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {qteCmdFact(r.qtyOrdered, r.qtyInvoiced, r.packFactor)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: C.greyT }}>
                    {t && negocie[r.ref] !== undefined ? (
                      <input value={negocie[r.ref]} inputMode="decimal" autoFocus
                        aria-label={`Tarif négocié ${r.ref}`}
                        onChange={(e) => setNegocie((n) => ({ ...n, [r.ref]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') inscrireNegocie(t); }}
                        style={{ ...inputStyle, padding: '4px 6px', width: 80, textAlign: 'right' }} />
                    ) : prix(t ? t.currentPrice : r.expectedUnitPrice)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: t ? 700 : 400 }}>
                    {prix(t ? t.realPrice : r.effectiveUnitCost)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: t && t.delta > 0 ? C.red : C.green }}>
                    {t ? `${t.delta > 0 ? '+' : ''}${prix(t.delta)}` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: ecartDe(r) > 0 ? C.red : C.green }}>
                    {signedEur(ecartDe(r))}
                    {r.discountShare > 0 && (
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.greyM, whiteSpace: 'nowrap' }}>
                        facturé {signedEur(r.gap)} − {eur(r.discountShare)} de remise
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 11.5, color: C.greyM }}>{r.action || meta.action || ''}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{bouton(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderPicker({ supplierId, busy, onPick }) {
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const chercher = async (terme) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${BASE}/orders`, {
        params: { supplier_id: supplierId, q: terme || undefined },
      });
      setOrders(Array.isArray(data) ? data : []);
    } catch { setOrders([]); } finally { setLoading(false); }
  };

  const ouvrir = () => { setOpen(true); chercher(''); };

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <Btn onClick={ouvrir} variant="secondary" small>Choisir la commande…</Btn>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') chercher(q); }}
          placeholder="Référence, n° BMS, ou lien BMS collé"
          style={{ ...inputStyle, minWidth: 320, flex: 1 }}
        />
        <Btn onClick={() => chercher(q)} variant="secondary" small disabled={loading}>Chercher</Btn>
      </div>

      {loading && <div style={{ fontSize: 12, color: C.greyT }}>Recherche…</div>}
      {!loading && orders.length === 0 && (
        <div style={{ fontSize: 12, color: C.greyT }}>Aucune commande pour ce fournisseur.</div>
      )}

      <div style={{ maxHeight: 240, overflowY: 'auto', background: C.white, borderRadius: 8, border: `1px solid ${C.greyB}` }}>
        {orders.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            disabled={busy}
            style={{
              display: 'flex', width: '100%', gap: 12, alignItems: 'center', justifyContent: 'space-between',
              padding: '9px 12px', border: 'none', borderBottom: `1px solid ${C.greyB}`,
              background: 'transparent', cursor: busy ? 'default' : 'pointer', textAlign: 'left',
              fontSize: 13, color: C.dark,
            }}
          >
            <span style={{ fontWeight: 600 }}>{o.bms_reference || o.order_number}</span>
            <span style={{ color: C.greyT, fontSize: 12 }}>BMS {o.bms_po_id}</span>
            <span style={{ color: C.greyT, fontSize: 12 }}>{date(o.order_date)}</span>
            <span style={{ fontWeight: 600 }}>{eur(o.total_amount)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ControlTab({ suppliers, mobile, onSaved }) {
  const [supplierId, setSupplierId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);   // lu, PAS enregistré
  const [saved, setSaved] = useState(null);     // document en base, une fois validé
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [manualOrderId, setManualOrderId] = useState('');
  // « La marchandise est-elle arrivée ? » — la question qu'on se pose avant de
  // régler, et à laquelle il fallait changer d'application pour répondre.
  const [lifecycle, setLifecycle] = useState(null);
  const fileInput = useRef(null);

  const reset = () => {
    setResult(null); setSaved(null); setError(null); setCopied(false); setManualOrderId('');
    setLifecycle(null);
  };

  // Lecture seule : rien n'est écrit tant que l'acheteur n'a pas validé.
  // `orderId` sert au rapprochement manuel : la référence imprimée ne mène pas
  // toujours à la commande (GFC et MG Vape impriment leur propre numéro).
  const analyse = async (orderId = null) => {
    if (!supplierId || !file) return;
    setBusy(true);
    if (!orderId) reset(); else { setError(null); setCopied(false); }
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('supplier_id', supplierId);
      if (orderId) form.append('order_id', orderId);
      const { data } = await axios.post(`${BASE}/analyse`, form);
      setResult(data);
      setManualOrderId(orderId || '');
      if (data.order && data.order.id) {
        axios.get(`${BASE}/orders/${data.order.id}/lifecycle`)
          .then((r) => setLifecycle(r.data))
          .catch(() => setLifecycle(null));
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  // Le fichier repart tel quel : le document enregistré est exactement celui
  // qui a été lu, et l'analyse rangée correspond à ce qui est affiché.
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('supplier_id', supplierId);
      // Sans ça, le document serait rangé sans la commande qu'on vient de lui
      // désigner : l'analyse gelée en base ne correspondrait plus à l'écran.
      if (manualOrderId) form.append('order_id', manualOrderId);
      const { data } = await axios.post(BASE, form);
      setSaved(data.document);
      setResult((r) => ({ ...r, document: data.document }));
      onSaved();
    } catch (e) {
      const d = e.response?.data;
      setError(d?.existing ? `${d.error} (enregistrée le ${date(d.existing.doc_date)})` : (d?.error || e.message));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!saved || !window.confirm('Supprimer ce document et son fichier ? Cette action est définitive.')) return;
    await axios.delete(`${BASE}/${saved.id}`);
    reset();
    setFile(null);
    onSaved();
  };

  const copyClaim = async () => {
    if (await copierReclamation(saved.id)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const setStatus = async (status) => {
    const { data } = await axios.put(`${BASE}/${saved.id}/status`, { status });
    setSaved(data);
    onSaved();
  };

  const totals = result?.comparison?.totals;
  const summary = result?.comparison?.summary;

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fournisseur" width={230}>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={inputStyle}>
            <option value="">Choisir…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Btn onClick={analyse} disabled={!supplierId || !file || busy}>
          {busy ? 'Lecture en cours…' : 'Contrôler la facture'}
        </Btn>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        onClick={() => fileInput.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.main : C.greyB}`, borderRadius: 12, padding: mobile ? 20 : 28,
          textAlign: 'center', cursor: 'pointer', background: dragging ? C.mainL : C.white,
        }}
      >
        <input ref={fileInput} type="file" accept=".pdf,.csv,.txt" style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0] || null)} />
        <div style={{ fontWeight: 600, color: file ? C.main : C.greyT, fontSize: 14 }}>
          {file ? file.name : 'Déposer la facture ou l’avoir ici, ou cliquer pour choisir'}
        </div>
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 5 }}>
          La lecture n'enregistre rien : le document n'est rangé que si tu l'enregistres ensuite.
        </div>
      </div>

      {error && (
        <div style={{ padding: 14, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.dark }}>
                {result.invoice.docType === 'credit_note' ? 'Avoir' : 'Facture'} {result.invoice.number}
                {result.invoice.isProforma && <Badge tone="orange"> pro forma</Badge>}
              </div>
              <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 3 }}>
                {result.supplier.name} · {date(result.invoice.date)}
                {result.order ? (
                  <> · commande <OrderLink order={result.order}>{result.order.bms_reference}</OrderLink>
                    {' '}({result.matchedBy === 'manual' ? 'désignée' : 'retrouvée par sa référence'})</>
                ) : ' · aucune commande retrouvée'}
              </div>
            </div>
            <Badge tone={saved ? (saved.status === 'disputed' ? 'red' : (saved.status === 'checked' ? 'green' : 'orange')) : 'grey'}>
              {saved ? STATUS_LABELS[saved.status] : 'Non enregistrée'}
            </Badge>
          </div>

          {result.duplicate && !saved && (
            <div style={{ padding: 13, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              Ce document est <strong>déjà enregistré</strong> ({result.duplicate.number}, déposé le{' '}
              {date(result.duplicate.created_at)}, état « {STATUS_LABELS[result.duplicate.status]} »).
              L'enregistrer une seconde fois est refusé — c'est ce qui évite de le payer deux fois.
            </div>
          )}

          {result.needsManualOrder && (
            <div style={{ padding: 14, background: C.orangeL, color: C.orange, borderRadius: 10, fontSize: 13 }}>
              {result.invoice.orderRefOnDoc ? (
                <>
                  La référence <strong>{result.invoice.orderRefOnDoc}</strong> imprimée sur ce document ne correspond à
                  aucune commande. Chez GFC et MG&nbsp;Vape, c'est le numéro interne du fournisseur, jamais le nôtre.
                  Les lignes lues sont affichées ci-dessous ; désigne la commande pour lancer la comparaison.
                </>
              ) : (
                <>
                  Ce document ne porte <strong>aucune référence de commande</strong> — le cas courant d'un avoir de
                  régularisation. Le document peut être enregistré tel quel, ou rapproché d'une commande ci-dessous.
                </>
              )}
              <OrderPicker supplierId={supplierId} busy={busy} onPick={(id) => analyse(id)} />
            </div>
          )}

          {!totals && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Kpi label={result.invoice.docType === 'credit_note' ? 'Avoir HT' : 'Facture HT'} value={eur(result.invoice.totalHt)} />
              <Kpi label={result.invoice.docType === 'credit_note' ? 'Avoir TTC' : 'Facture TTC'} value={eur(result.invoice.totalTtc)} />
              <Kpi label="Lignes lues" value={result.invoice.lines.length} />
            </div>
          )}

          {totals && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Kpi label="Facture HT" value={eur(totals.invoiceParsed)} />
              {/* Le TTC est ce qui sortira de la banque : c'est lui qu'on
                  rapproche du règlement, pas le HT du contrôle de tarif. */}
              <Kpi label="Facture TTC" value={eur(result.invoice.totalTtc)} />
              <Kpi label="Commande HT" value={eur(totals.order)} />
              <Kpi label="Écart" value={signedEur(totals.gap)} tone={totals.gap > 0 ? 'red' : (totals.gap < 0 ? 'green' : 'grey')} />
              <Kpi label="Réclamable" value={eur(summary.claimable)} tone={summary.claimable > 0 ? 'red' : 'grey'} />
              <Kpi label="Manquants" value={signedEur(summary.qtyGap)} tone={summary.qtyGap < 0 ? 'orange' : 'grey'} />
            </div>
          )}

          {totals && totals.reconciles === false && (
            <div style={{ padding: 14, background: C.redL, color: C.red, borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              Les lignes lues totalisent {eur(totals.invoiceParsed)} alors que le document annonce {eur(totals.invoicePrinted)}.
              Une ligne est probablement mal lue : ne rien réclamer sur cette base.
            </div>
          )}

          {summary?.orphansLikelySame && (
            <div style={{ padding: 13, background: C.orangeL, color: C.orange, borderRadius: 10, fontSize: 13 }}>
              {summary.orphanCount} lignes n'ont pas pu être rapprochées, de part et d'autre, pour le
              même montant de <strong>{eur(summary.orphanAmount)}</strong>. Ce sont très probablement les
              mêmes articles, avec une référence que le PDF a rendue illisible — ni manquant, ni article
              ajouté. À vérifier sur le document avant toute réclamation.
            </div>
          )}

          {/* Ce que la commande a réellement reçu. Payer une facture dont la
              marchandise n'est pas arrivée, c'est le genre d'erreur qu'on ne
              découvre qu'au moment de l'inventaire. */}
          {lifecycle && (
            <div style={{
              padding: 13, borderRadius: 10, fontSize: 13,
              background: lifecycle.summary.fullyReceived ? C.greenL : C.orangeL,
              color: lifecycle.summary.fullyReceived ? C.green : C.orange,
            }}>
              {lifecycle.summary.fullyReceived ? (
                <>Marchandise <strong>entièrement reçue</strong> : {lifecycle.order.units_received} pièces
                  sur {lifecycle.order.units_ordered} commandées.</>
              ) : lifecycle.summary.partiallyReceived ? (
                <>Marchandise <strong>partiellement reçue</strong> : {lifecycle.order.units_received} pièces
                  sur {lifecycle.order.units_ordered} commandées. Il en manque{' '}
                  <strong>{lifecycle.order.units_ordered - lifecycle.order.units_received}</strong>.</>
              ) : (
                <>Cette commande n'a <strong>rien reçu</strong> à ce jour
                  ({lifecycle.order.units_ordered} pièces attendues). Vérifier la livraison avant de régler.</>
              )}
              {lifecycle.documents.filter((d) => d.number !== result.invoice.number).length > 0 && (
                <div style={{ marginTop: 6, color: C.greyM }}>
                  Autre(s) document(s) déjà rangé(s) sur cette commande :{' '}
                  {lifecycle.documents.filter((d) => d.number !== result.invoice.number)
                    .map((d) => d.number).join(', ')}
                </div>
              )}
            </div>
          )}

          <VouchersNotice result={result} />

          {summary?.hasFooterDiscount && (
            <div style={{ padding: 13, background: C.blueL, color: C.blue, borderRadius: 10, fontSize: 13 }}>
              {/* Une remise de pied n'existe JAMAIS dans la commande : BMS porte des
                  prix à la ligne, pas de remise globale. Elle est donc toujours un
                  supplément par rapport à ce qui était prévu — et c'est elle qui
                  explique l'écart favorable affiché en haut, qu'aucune ligne ne
                  justifie. Le taire laissait chercher l'erreur ailleurs. */}
              <strong>{eur(Math.abs(totals.footerDiscount))} de remise supplémentaire</strong>, non prévue
              à la commande : le fournisseur facture les lignes, puis déduit ce montant en pied.
              {/* Quand la remise est répartie, les prix de ligne ne sont plus ceux
                  payés. Quand elle ne l'est pas — faute de savoir qui elle vise —
                  ils le restent, et l'écrire évite de faire douter d'un prix juste. */}
              {(result.comparison?.lines || []).some((l) => l.verdict === 'discount' && !l.scope?.unallocated)
                ? <> Le prix payé n'est donc pas celui des lignes :</>
                : <> Les prix des lignes restent ceux payés :</>}
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {(result.comparison?.lines || []).filter((l) => l.verdict === 'discount').map((l, i) => {
                  const sc = l.scope || {};
                  return (
                    <li key={i} style={{ marginBottom: 3 }}>
                      <strong>{sc.ruleName || l.label || 'Remise'}</strong> — {eur(Math.abs(l.invoicedTotal))}
                      {/* Une règle nommée se dit en clair. Une remise répartie à
                          l'identique sur chaque pièce se dit à la pièce. Sinon on
                          se tait : « −1,20 € la pièce » sur des articles de prix
                          très différents n'apprend rien. */}
                      {sc.ruleNote && <>, soit <strong>{sc.ruleNote}</strong> ({sc.lines} lignes)</>}
                      {!sc.ruleNote && sc.targeted && sc.perUnit != null && (
                        <> sur {sc.units} pièces, soit <strong>−{eur(sc.perUnit)}</strong> la pièce
                          {sc.unitCost != null && <> → prix réel <strong>{eur(sc.unitCost)}</strong></>}
                        </>
                      )}
                      {/* Une remise que le document ne rattache à aucune ligne ne
                          PEUT pas être imputée à un produit : « Remise 20% sur
                          produits spécifiques » chez LIPS ne dit pas lesquels. On
                          l'écrit, au lieu de laisser croire qu'un article a été
                          trouvé moins cher — ou de laisser chercher lequel. */}
                      {!sc.ruleNote && !sc.targeted && sc.lines > 0 && (
                        <> — <strong>non imputable à un produit</strong> : le document ne la rattache à
                          aucune ligne. Elle est répartie au prorata sur les {sc.lines} lignes produit
                          {sc.units > 0 ? ` (${sc.units} pièces)` : ''} pour établir le coût réel.</>
                      )}
                      {/* Le taux imprimé trahit l'assiette : à 20 %, une remise de
                          5,92 € porte sur 29,60 € de marchandise, pas sur les
                          223,76 € de la facture. On le dit, et on ne répartit
                          rien — inventer une imputation fabriquait des prix que
                          personne n'a payés, sur des lignes peut-être même pas
                          visées par la promotion. */}
                      {sc.unallocated && (
                        <> — <strong>non répartie</strong> : à {Math.round(sc.rate * 100)} %, elle porte
                          sur <strong>{eur(sc.impliedBase)}</strong> de marchandise, pas sur toute la
                          facture. Le document ne dit pas sur quelles lignes, donc aucune ne la porte :
                          les tarifs affichés restent ceux des lignes.</>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Un écart qui ne correspond à aucune ligne à traiter n'est pas un
              mystère : c'est la somme des arrondis au centime. Le taire laissait
              l'écran annoncer « −0,23 € » sans rien en face. */}
          {totals && (result.rows || []).length === 0 && Math.abs(totals.gap) > 0.005 && (
            <div style={{ padding: 13, background: C.grey, color: C.greyM, borderRadius: 10, fontSize: 13 }}>
              Il reste <strong>{eur(totals.gap)}</strong> d'écart, sans aucune ligne à traiter : c'est
              l'accumulation des <strong>arrondis au centime</strong>. Chaque prix remisé est arrondi
              séparément par le fournisseur, et la somme dérive de quelques centimes. Rien à réclamer.
            </div>
          )}

          {result.comparison
            ? <ControlTable
                rows={result.rows}
                supplierId={supplierId}
                orderId={result.order?.id || null}
                orderReceived={Number(lifecycle?.order?.units_received) > 0}
                mobile={mobile}
                onApplied={result.order?.id ? () => analyse(result.order.id) : null}
              />
            : <ReadLinesTable lines={result.invoice.lines} mobile={mobile} />}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {!saved ? (
              <>
                <Btn onClick={save} disabled={busy || !!result.duplicate}>
                  {busy ? 'Enregistrement…' : `Enregistrer ${result.invoice.docType === 'credit_note' ? "l'avoir" : 'la facture'}`}
                </Btn>
                <Btn variant="ghost" onClick={() => { reset(); setFile(null); }}>Abandonner</Btn>
                <span style={{ fontSize: 12, color: C.greyM }}>
                  Rien n'est conservé tant que tu n'as pas enregistré.
                </span>
              </>
            ) : (
              <>
                <Btn onClick={copyClaim} disabled={!summary || summary.claimable <= 0}>
                  {copied ? 'Message copié ✓' : 'Copier le message de réclamation'}
                </Btn>
                <Btn variant="ghost" onClick={() => downloadFile(saved.id, result.invoice.number)}>
                  Télécharger le document
                </Btn>
                <Btn variant="ghost" onClick={() => setStatus('checked')}>Marquer contrôlée</Btn>
                <Btn variant="ghost" onClick={() => setStatus('disputed')}>Mettre en litige</Btn>
                <Btn variant="danger" onClick={remove}>Supprimer</Btn>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Téléchargement avec le jeton : l'intercepteur axios pose l'en-tête. */
async function downloadFile(id, label) {
  const res = await axios.get(`${BASE}/${id}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(label || id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/* ═══════════════════════════════════════════════════════════
 * ONGLET 2 — Factures (les documents rangés)
 *
 * C'est ici qu'on règle. Pierre l'a demandé le 28/09/2026 et il a raison :
 * on décide de payer en regardant ses factures, pas dans un écran séparé.
 * La sélection multiple sert les deux cas d'un même geste — une facture
 * isolée, ou six factures et un avoir soldés par un seul relevé Amex.
 * ═══════════════════════════════════════════════════════════ */
function FilingTab({ suppliers, mobile, reloadKey, onSaved, initialDocId }) {
  const [filters, setFilters] = useState({ supplier_id: '', status: '', payment_status: '', doc_type: '', from: '', to: '', q: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState({});
  const [pay, setPay] = useState({ method: 'amex', paid_at: new Date().toISOString().slice(0, 10), reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      // Le maximum que le serveur accepte : un total de TVA mensuel doit porter
      // sur TOUT le mois, et la valeur par défaut (100) l'aurait tronqué en
      // silence dès qu'un mois dépasse cent factures.
      const { data } = await axios.get(BASE, { params: { ...params, limit: LIMITE_LISTE } });
      setRows(data);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const openDetail = useCallback(async (id) => {
    setOpenId(id);
    const { data } = await axios.get(`${BASE}/${id}`);
    setDetail(data);
  }, []);

  // Arrivée depuis la liste des commandes fournisseur (?doc=ID) : la facture
  // s'ouvre directement.
  useEffect(() => { if (initialDocId) openDetail(initialDocId); }, [initialDocId, openDetail]);

  const closeDetail = () => { setOpenId(null); setDetail(null); };
  const [rechecking, setRechecking] = useState(null);

  /**
   * Rejouer l'analyse contre l'état ACTUEL de BMS.
   *
   * Les constats sont gelés à l'enregistrement : la commande bouge dès qu'on la
   * corrige, et une preuve qui s'efface au moment où on la corrige ne prouve
   * rien. Une fois la correction faite dans BMS, ce bouton remplace les constats
   * périmés — geste explicite, jamais automatique.
   */
  const recheck = async (row) => {
    setRechecking(row.id);
    try {
      const { data } = await axios.post(`${BASE}/${row.id}/recheck`);
      const reste = (data.document?.lines || []).filter(appelleUnGeste).length;
      window.alert(reste === 0
        ? `${row.number} : plus aucun écart à traiter.`
        : `${row.number} : ${reste} écart(s) subsistent après re-contrôle.`);
      if (openId === row.id) openDetail(row.id);
      load();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message);
    } finally { setRechecking(null); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Supprimer ${row.number} (${row.supplier_name || ''}) et son fichier ? Cette action est définitive.`)) return;
    await axios.delete(`${BASE}/${row.id}`);
    closeDetail();
    load();
    onSaved();
  };

  const setStatus = async (id, status) => {
    await axios.put(`${BASE}/${id}/status`, { status });
    if (openId === id) openDetail(id);
    load();
  };

  /* ─── Règlement d'une sélection ────────────────────────────
   * Un règlement porte sur UN fournisseur : c'est ce qui permet de solder
   * plusieurs de ses factures et ses avoirs d'un seul mouvement, et ce qui
   * interdit de mélanger deux fournisseurs dans le même paiement.
   * ──────────────────────────────────────────────────────── */
  const chosen = useMemo(
    () => rows.filter((r) => selected[r.id] && Math.abs(Number(r.remaining_amount) || 0) > 0.009),
    [rows, selected],
  );
  const suppliersOfChosen = useMemo(
    () => [...new Set(chosen.map((r) => r.supplier_name))],
    [chosen],
  );
  const chosenTotal = chosen.reduce((s, r) => s + Number(r.remaining_amount), 0);

  const settle = async () => {
    setBusy(true); setError(null);
    try {
      if (suppliersOfChosen.length > 1) {
        throw new Error('Un règlement ne peut couvrir qu’un seul fournisseur à la fois');
      }
      await axios.post(`${BASE}/payments`, {
        supplier_id: chosen[0].supplier_id,
        method: pay.method,
        paid_at: pay.paid_at,
        amount: Math.round(chosenTotal * 100) / 100,
        reference: pay.reference,
        allocations: chosen.map((r) => ({ document_id: r.id, amount: Number(r.remaining_amount) })),
      });
      setSelected({});
      setPay({ ...pay, reference: '' });
      await load();
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  const totalDu = rows.reduce((s, r) => s + (Number(r.remaining_amount) || 0), 0);
  const totalEcarts = rows.reduce((s, r) => s + (Number(r.difference_count) || 0), 0);
  /* ─── TVA déductible ───────────────────────────────────────
   * La TVA que les fournisseurs ont facturée, donc celle qu'on récupère. Elle
   * est lue sur le document lui-même (`total_tva`), jamais recalculée depuis le
   * HT : un document peut porter deux taux, et 20 % appliqués d'office
   * inventeraient des centimes à chaque ligne.
   *
   * Un AVOIR est stocké en négatif (cf. parseurs) : il se déduit tout seul,
   * comme il se déduit de la déclaration.
   *
   * Le périmètre est celui des filtres, donc un mois se lit en posant Du et Au
   * — qui portent sur la DATE DU DOCUMENT, la bonne base pour la TVA sur les
   * achats de biens. Deux réserves affichées sous le chiffre plutôt que tues :
   * un document dont la TVA n'a pas été lue, et une liste tronquée par la
   * limite du serveur.
   * ──────────────────────────────────────────────────────── */
  const totalTva = rows.reduce((s, r) => s + (Number(r.total_tva) || 0), 0);
  const sansTva = rows.filter((r) => r.total_tva == null).length;
  const tronquee = rows.length >= LIMITE_LISTE;
  const reserves = [
    sansTva > 0 ? `${sansTva} document${sansTva > 1 ? 's' : ''} sans TVA lue` : null,
    tronquee ? `liste limitée à ${LIMITE_LISTE} documents` : null,
  ].filter(Boolean).join(' · ');
  // Les factures dont le tarif n'est pas celui de la commande. Alerte, pas
  // blocage : elles se contrôlent et se règlent comme les autres, mais l'écart
  // est à réclamer au fournisseur ou à aligner dans BMS.
  const tarifs = rows.filter((r) => Number(r.price_diff_count) > 0);
  const totalTarif = tarifs.reduce((s, r) => s + (Number(r.price_gap) || 0), 0);

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fournisseur" width={190}>
          <select value={filters.supplier_id} onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Type" width={130}>
          <select value={filters.doc_type} onChange={(e) => setFilters({ ...filters, doc_type: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            <option value="invoice">Factures</option>
            <option value="credit_note">Avoirs</option>
            <option value="proforma">Pro forma</option>
          </select>
        </Field>
        <Field label="Contrôle" width={140}>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            style={{ ...inputStyle, ...(filters.status ? statusStyle(filters.status) : {}) }}>
            <option value="">Tous</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Paiement" width={130}>
          <select value={filters.payment_status} onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            <option value="unpaid">À payer</option>
            <option value="partial">Partielle</option>
            <option value="paid">Payée</option>
          </select>
        </Field>
        <Field label="Du" width={140}>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Au" width={140}>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Rechercher" width={230}>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="numéro, fournisseur, commande…" style={inputStyle} />
        </Field>
      </div>

      <OpenVouchers reloadKey={rows} onOpen={openDetail} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Documents" value={rows.length} />
        <Kpi
          label="TVA déductible"
          value={eur(totalTva)}
          tone="blue"
          hint={reserves || (filters.from || filters.to
            ? 'sur la période filtrée, avoirs déduits'
            : 'tous documents affichés — filtre Du / Au pour un mois')}
          title={"TVA facturée par les fournisseurs sur les documents affichés, telle qu'elle est imprimée dessus."
            + ' Les avoirs viennent en déduction. Les filtres Du / Au portent sur la date du document.'}
        />
        <Kpi label="Reste à payer" value={eur(totalDu)} tone={totalDu > 0 ? 'orange' : 'green'} />
        <Kpi label="Différences relevées" value={totalEcarts} tone={totalEcarts > 0 ? 'red' : 'green'} />
      </div>

      {chosen.length > 0 && (
        <div style={{
          display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
          background: C.mainL, border: `1px solid ${C.main}`, borderRadius: 12, padding: 14,
        }}>
          <div style={{ minWidth: 190 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.mainD }}>
              {chosen.length} document{chosen.length > 1 ? 's' : ''} à régler
            </div>
            <div style={{ fontSize: 11.5, color: C.greyT, marginTop: 2 }}>
              {suppliersOfChosen.join(', ')}
            </div>
          </div>
          <Field label="Moyen" width={150}>
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} style={inputStyle}>
              {METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Date du règlement" width={150}>
            <input type="date" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Référence" width={180}>
            <input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })}
              placeholder="relevé Amex, n° de virement…" style={inputStyle} />
          </Field>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: C.greyT }}>Montant</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.main }}>{eur(chosenTotal)}</div>
          </div>
          <Btn onClick={settle} disabled={busy || suppliersOfChosen.length > 1}>
            {busy ? 'Enregistrement…' : 'Enregistrer le règlement'}
          </Btn>
          <Btn variant="ghost" onClick={() => setSelected({})}>Annuler</Btn>
        </div>
      )}

      {tarifs.length > 0 && (
        <div style={{
          padding: 13, background: C.orangeL, color: C.orange, borderRadius: 10, fontSize: 13,
          border: `1px solid ${C.orange}22`,
        }}>
          ⚠️ <strong>{tarifs.length} document{tarifs.length > 1 ? 's' : ''}</strong> facturé
          {tarifs.length > 1 ? 's' : ''} à un tarif différent de la commande, pour{' '}
          <strong>{signedEur(totalTarif)}</strong> d'écart au total : {tarifs.map((r) => r.number).join(', ')}.
          <div style={{ marginTop: 4, color: C.greyT }}>
            Rien n'est bloqué : ces factures se contrôlent et se règlent normalement. L'écart est à réclamer
            au fournisseur, ou à aligner sur la commande s'il s'agit d'un nouveau tarif.
          </div>
        </div>
      )}

      {(error || suppliersOfChosen.length > 1) && (
        <div style={{ padding: 12, background: C.redL, color: C.red, borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          {error || 'Un règlement ne peut couvrir qu’un seul fournisseur à la fois : décoche les autres.'}
        </div>
      )}

      {loading ? <div style={{ color: C.greyT, fontSize: 13 }}>Chargement…</div> : (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}></th>
                <th style={th}>Commande</th>
                <th style={th}>N° commande</th>
                <th style={th}>Facture</th>
                <th style={th}>Numéro</th>
                <th style={th}>Fournisseur</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Total TTC</th>
                <th style={{ ...th, textAlign: 'right' }}>TVA</th>
                <th style={{ ...th, textAlign: 'center' }}>Écarts</th>
                <th style={{ ...th, textAlign: 'center' }}>Stockage</th>
                <th style={th}>Contrôle</th>
                <th style={th}>Échéance</th>
                <th style={th}>Payée le</th>
                <th style={th}>Paiement</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 26 }} colSpan={16}>
                  Aucun document. Dépose une facture depuis l'onglet Contrôle.
                </td></tr>
              )}
              {rows.map((r) => {
                const reste = Math.abs(Number(r.remaining_amount) || 0) > 0.009;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer', background: selected[r.id] ? C.mainL : undefined }}>
                    <td style={td} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" disabled={!reste} checked={!!selected[r.id]}
                        title={reste ? 'Inclure dans un règlement' : 'Déjà réglée'}
                        onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} />
                    </td>
                    <td style={{ ...td, color: r.order_date ? C.dark : C.greyM }} onClick={() => openDetail(r.id)}>
                      {date(r.order_date)}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: r.order_refs ? C.dark : C.greyM }} onClick={() => openDetail(r.id)}>
                      {r.order_refs || '—'}
                    </td>
                    <td style={td} onClick={() => openDetail(r.id)}>{date(r.doc_date)}</td>
                    <td style={{ ...td, fontWeight: 600 }} onClick={() => openDetail(r.id)}>{r.number}</td>
                    <td style={td} onClick={() => openDetail(r.id)}>{r.supplier_name}</td>
                    <td style={td} onClick={() => openDetail(r.id)}>
                      {r.doc_type === 'credit_note'
                        ? <Badge tone="green">Avoir</Badge>
                        : (r.doc_type === 'proforma' ? <Badge tone="orange">Pro forma</Badge> : <Badge tone="grey">Facture</Badge>)}
                    </td>
                    <td style={{
                      ...td, textAlign: 'right', fontWeight: 700,
                      color: r.doc_type === 'credit_note' ? C.blue : C.dark,
                    }} onClick={() => openDetail(r.id)}>{eur(r.total_ttc)}</td>
                    {/* La TVA telle que le fournisseur l'a imprimée, jamais
                        recalculée : un document peut porter deux taux. */}
                    <td style={{ ...td, textAlign: 'right', color: C.greyT }} onClick={() => openDetail(r.id)}>
                      {r.total_tva == null
                        ? <span title="Le document ne porte pas de total de TVA lisible" style={{ color: C.orange }}>—</span>
                        : eur(r.total_tva)}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => openDetail(r.id)}>
                      {Number(r.difference_count) > 0
                        ? <Badge tone="red">{r.difference_count}</Badge>
                        : <span style={{ color: C.green }}>✓</span>}
                      {Number(r.price_diff_count) > 0 && (
                        <div
                          title={`Le tarif facturé n'est pas celui de la commande sur ${r.price_diff_count} ligne(s). Alerte seulement : le document peut être contrôlé et réglé.`}
                          style={{ fontSize: 10.5, color: C.red, fontWeight: 700, marginTop: 3, whiteSpace: 'nowrap' }}
                        >
                          ⚠ tarif {signedEur(r.price_gap)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => openDetail(r.id)}>
                      <StorageBadge ordered={r.units_ordered} received={r.units_received} />
                    </td>
                    <td style={td}>
                      <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, ...statusStyle(r.status) }}>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td style={td} onClick={() => openDetail(r.id)}>{date(r.effective_due_date)}</td>
                    <td style={{ ...td, color: r.paid_at ? C.dark : C.greyM }} onClick={() => openDetail(r.id)}>
                      {date(r.paid_at)}
                    </td>
                    <td style={td} onClick={() => openDetail(r.id)}>
                      {r.doc_type === 'credit_note'
                        ? <Badge tone={r.payment_status === 'paid' ? 'green' : 'orange'}>
                            {r.payment_status === 'paid' ? 'Utilisé' : 'Non utilisé'}
                          </Badge>
                        : <Badge tone={r.payment_status === 'paid' ? 'green' : (r.payment_status === 'partial' ? 'orange' : 'red')}>
                            {PAYMENT_LABELS[r.payment_status] || '—'}
                          </Badge>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <Btn small variant="ghost" onClick={() => downloadFile(r.id, r.number)}>PDF</Btn>
                      {' '}
                      {r.difference_count > 0 && (
                        <>
                          <Btn
                            small
                            variant="secondary"
                            disabled={rechecking === r.id}
                            onClick={() => recheck(r)}
                          >
                            {rechecking === r.id ? '…' : 'Re-contrôler'}
                          </Btn>
                          {' '}
                        </>
                      )}
                      <Btn small variant="danger" onClick={() => remove(r)}>Suppr.</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Un règlement change le document ET sa ligne dans le tableau derrière :
          « À payer » → « Payée », le reste dû, les compteurs du haut. Ne
          rafraîchir que le panneau obligeait à recharger la page pour voir le
          règlement qu'on venait d'enregistrer — le re-contrôle, le changement de
          statut et la suppression rechargent la liste depuis toujours, le
          règlement était le seul à l'oublier. */}
      {detail && (
        <DocumentPanel
          detail={detail}
          mobile={mobile}
          onClose={closeDetail}
          onStatus={(s) => setStatus(detail.id, s)}
          onDelete={() => remove(detail)}
          onSettle={async (r) => {
            await settleOne(detail, r);
            await Promise.all([openDetail(detail.id), load()]);
            onSaved();
          }}
          onChanged={async () => { await Promise.all([openDetail(detail.id), load()]); }}
        />
      )}
    </div>
  );
}

/* ─── Où en est la marchandise ? ──────────────────────────────
 * On ne règle pas une facture dont la livraison n'est pas arrivée. La réponse
 * vivait dans l'app Réception : il fallait changer d'écran, retrouver la
 * commande, et comparer de tête. Le fil de vie de la commande la donne ici,
 * dans le document qu'on regarde.
 *
 * `units_received` de la commande fait foi pour le total — les réceptions
 * faites directement dans BMS ne laissent aucune session dans l'app, et une
 * commande peut donc être reçue sans qu'aucun comptage n'apparaisse en dessous.
 * ──────────────────────────────────────────────────────────── */
const SESSION_LABELS = { counting: 'comptage en cours', validated: 'comptage validé', abandoned: 'comptage abandonné' };

function ReceptionState({ orders }) {
  const ids = (orders || []).map((o) => o.id).join(',');
  const [fils, setFils] = useState(null);

  useEffect(() => {
    if (!ids) { setFils([]); return undefined; }
    let vivant = true;
    setFils(null);
    Promise.all(ids.split(',').map((id) => axios.get(`${BASE}/orders/${id}/lifecycle`)
      .then((r) => r.data).catch(() => null)))
      .then((r) => { if (vivant) setFils(r.filter(Boolean)); });
    return () => { vivant = false; };
  }, [ids]);

  const cadre = (children) => (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>ÉTAT DE RÉCEPTION</div>
      {children}
    </div>
  );

  if (!ids) {
    return cadre(
      <div style={{ fontSize: 13, color: C.orange }}>
        Aucune commande rapprochée : impossible de dire si la marchandise est arrivée.
      </div>,
    );
  }
  if (fils === null) return cadre(<div style={{ fontSize: 13, color: C.greyT }}>Lecture…</div>);
  if (fils.length === 0) {
    return cadre(<div style={{ fontSize: 13, color: C.greyT }}>État de réception indisponible.</div>);
  }

  return cadre(fils.map((f) => {
    const cmd = Number(f.order.units_ordered) || 0;
    const recu = Number(f.order.units_received) || 0;
    const manque = Math.max(cmd - recu, 0);
    const pct = storagePct(cmd, recu);
    const etat = f.summary.fullyReceived
      ? { tone: 'green', label: 'Entièrement reçue' }
      : (f.summary.partiallyReceived
        ? { tone: 'orange', label: 'Partiellement reçue' }
        : { tone: 'red', label: 'Rien reçu' });
    return (
      <div key={f.order.id} style={{ paddingTop: 2, paddingBottom: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Badge tone={etat.tone}>{etat.label}{pct === null ? '' : ` · ${pct} %`}</Badge>
          <span>
            <strong>{recu}</strong> pièce{recu > 1 ? 's' : ''} reçue{recu > 1 ? 's' : ''} sur {cmd} commandée{cmd > 1 ? 's' : ''}
            {manque > 0 && <> · il en manque <strong>{manque}</strong></>}
          </span>
          {f.summary.openSession && <Badge tone="blue">comptage en cours</Badge>}
          <span style={{ color: C.greyM, fontSize: 12.5 }}>
            commande {f.order.bms_reference || f.order.order_number} du {date(f.order.order_date)}
          </span>
        </div>
        {f.receptions.length > 0 ? f.receptions.map((r) => {
          const comptees = Number(r.units_counted) || 0;
          const envoyees = Number(r.units_sent) || 0;
          return (
            <div key={r.id} style={{ fontSize: 12.5, color: C.greyT, marginTop: 4 }}>
              {date(r.validated_at || r.started_at)} · {SESSION_LABELS[r.status] || r.status}
              {r.status === 'validated' && <>
                {' '}· {comptees} pièce{comptees > 1 ? 's' : ''} comptée{comptees > 1 ? 's' : ''}
                {envoyees < comptees && <> dont <strong>{comptees - envoyees}</strong> refusée{comptees - envoyees > 1 ? 's' : ''}</>}
                {r.validated_by_name ? ` · ${r.validated_by_name}` : ''}
              </>}
            </div>
          );
        }) : (
          <div style={{ fontSize: 12.5, color: C.greyM, marginTop: 4 }}>
            Aucun comptage dans l'app Réception
            {recu > 0 ? " : la marchandise a été reçue directement dans BMS." : '.'}
          </div>
        )}
      </div>
    );
  }));
}

/**
 * Le détail d'un document, en plein écran.
 *
 * C'était un tiroir de 920 px qu'il fallait faire défiler latéralement pour
 * lire le tableau des écarts — inutilisable. Une facture a une dizaine de
 * colonnes : elle a besoin de toute la largeur.
 */
function DocumentPanel({ detail, mobile, onClose, onStatus, onDelete, onSettle, onChanged }) {
  const lignes = lignesAffichables(fromStoredLines(detail.lines));
  // Ce qui APPELLE UN GESTE, même lecture que la colonne « Écarts » de la liste.
  // « 2 différences » comptait le port offert et la remise de pied de la facture
  // FAC/2026/04474, qui ne demandent rien ni l'un ni l'autre.
  const ecarts = lignes.filter(appelleUnGeste).length;
  const conformes = lignes.filter((l) => l.verdict === 'ok').length;
  const tarifs = lignesEcartTarif(detail.lines);
  const ecartTarif = tarifs.reduce((t, l) => t + ecartTarifDe(l), 0);
  const avoir = detail.doc_type === 'credit_note';
  const reste = Number(detail.remaining_amount) || 0;
  const [reglement, setReglement] = useState({
    method: avoir ? 'avoir' : 'amex',
    paid_at: new Date().toISOString().slice(0, 10),
    reference: '',
  });
  const [busy, setBusy] = useState(false);
  /**
   * Accepter le tarif facturé, une fois la facture enregistrée.
   *
   * « Appliquer » n'existait que sur l'écran d'import : une facture enregistrée
   * sans l'avoir fait gardait son bandeau à vie, et « Re-contrôler » retrouvait
   * le même écart puisque BMS restait au prix commandé (JoshNoa V3/2026/38291).
   */
  const [applying, setApplying] = useState(false);
  const appliquerTarifs = async () => {
    if (!window.confirm(
      `Inscrire le tarif facturé sur ${tarifs.length} ligne${tarifs.length > 1 ? 's' : ''} `
      + '(chez nous, sur la commande et dans BMS) ?\n\n'
      + 'Si la commande est déjà réceptionnée, la valeur du stock et le coût de revient '
      + 'des pièces déjà vendues seront corrigés à partir de la réception.',
    )) return;
    setApplying(true);
    try {
      const { data } = await axios.post(`${BASE}/${detail.id}/apply-tariffs`);
      const refus = [
        ...(data.skipped || []).map((k) => `${k.ref} : ${k.reason}`),
        ...(data.applied || []).filter((x) => x.orderLine?.skipped || x.bmsLine?.skipped)
          .map((x) => `${x.ref} : ${x.orderLine?.skipped || `BMS inchangé (${x.bmsLine.skipped})`}`),
      ];
      if (refus.length) window.alert(`Pas entièrement appliqué :\n${refus.join('\n')}`);
      if (onChanged) await onChanged();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message);
    } finally { setApplying(false); }
  };
  // Le message au commercial se copie d'ICI aussi : une facture se contrôle un
  // jour et s'écrit le lendemain, et le bouton n'existait que sur l'écran de
  // contrôle, perdu dès qu'on le quittait.
  const [copie, setCopie] = useState(false);
  const copier = async () => {
    if (await copierReclamation(detail.id)) {
      setCopie(true);
      setTimeout(() => setCopie(false), 2500);
    }
  };
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 60,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: mobile ? 0 : '3vh 2vw',
        overflowY: 'auto',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 1500, background: C.grey, borderRadius: mobile ? 0 : 14,
        minHeight: mobile ? '100%' : undefined, padding: mobile ? 16 : 26,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {detail.doc_type === 'credit_note' ? 'Avoir' : 'Facture'} {detail.number}
            </div>
            <div style={{ fontSize: 12.5, color: C.greyT, marginTop: 3 }}>
              {detail.supplier_name} · {date(detail.doc_date)} · échéance {date(detail.effective_due_date)}
              {detail.orders?.[0] && (
                <> · commande <OrderLink order={detail.orders[0]}>{detail.orders[0].bms_reference}</OrderLink></>
              )}
            </div>
          </div>
          <Btn variant="ghost" small onClick={onClose}>Fermer</Btn>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <Kpi label="Total HT" value={eur(detail.total_ht)} />
          {/* Entre le HT et le TTC, ce qui se récupère. */}
          <Kpi label="TVA" value={detail.total_tva == null ? '—' : eur(detail.total_tva)} tone="blue" />
          <Kpi label="Total TTC" value={eur(detail.total_ttc)} />
          <Kpi label="Réglé" value={eur(detail.paid_amount)} />
          <Kpi label="Reste dû" value={eur(detail.remaining_amount)} tone={Number(detail.remaining_amount) > 0 ? 'orange' : 'green'} />
        </div>

        {tarifs.length > 0 && (
          <div style={{
            padding: 13, marginBottom: 16, borderRadius: 10, fontSize: 13,
            background: C.orangeL, color: C.orange, border: `1px solid ${C.orange}33`,
          }}>
            ⚠️ Le tarif facturé <strong>ne correspond pas à la commande</strong> sur{' '}
            <strong>{tarifs.length} ligne{tarifs.length > 1 ? 's' : ''}</strong>, pour{' '}
            <strong>{signedEur(ecartTarif)}</strong>
            {ecartTarif > 0 ? ' à notre charge' : ' en notre faveur'}.
            <div style={{ marginTop: 4, color: C.greyT }}>
              Alerte seulement, rien n'est bloqué : le document peut être contrôlé et réglé. Le détail ligne
              à ligne est plus bas{ecartTarif > 0 ? ', avec le tarif à réclamer ou à aligner dans BMS' : ''}.
            </div>
            {onChanged && (
              <div style={{ marginTop: 8 }}>
                <Btn small onClick={appliquerTarifs} disabled={applying}>
                  {applying ? 'Application…' : 'Appliquer le tarif facturé'}
                </Btn>
                <span style={{ marginLeft: 8, fontSize: 11.5, color: C.greyT }}>
                  si la hausse est un vrai changement de tarif, et non une erreur à réclamer
                </span>
              </div>
            )}
          </div>
        )}

        <ReceptionState orders={detail.orders} />

        {(detail.doc_type === 'invoice' || detail.vouchers?.length > 0) && (
          <VoucherSection detail={detail} onChanged={onChanged} />
        )}

        {detail.doc_type === 'invoice' && <CorrectionTarifsBms detail={detail} onChanged={onChanged} />}

        {detail.payments?.length > 0 && (
          <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>RÈGLEMENTS IMPUTÉS</div>
            {detail.payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>{date(p.paid_at)} · {methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ''}</span>
                <strong>{eur(p.allocated)}</strong>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT, marginBottom: 8 }}>
          LA FACTURE LIGNE À LIGNE — {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
          {ecarts > 0
            ? `, dont ${ecarts} différence${ecarts > 1 ? 's' : ''} à traiter`
            : ', aucune différence à traiter'}
          {conformes > 0 && ` · ${conformes} conforme${conformes > 1 ? 's' : ''} à la commande`}
        </div>
        <DifferencesTable lines={lignes} mobile={mobile} />

        {Math.abs(reste) > 0.009 && onSettle && (
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16,
            background: avoir ? C.blueL : C.mainL, border: `1px solid ${avoir ? C.blue : C.main}`,
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ minWidth: 180, fontSize: 13, fontWeight: 700, color: avoir ? C.blue : C.mainD }}>
              {avoir ? "Marquer l'avoir comme utilisé" : 'Régler ce document'}
              <div style={{ fontSize: 11.5, fontWeight: 500, color: C.greyT, marginTop: 2 }}>
                {eur(Math.abs(reste))}
              </div>
            </div>
            <Field label="Moyen" width={150}>
              <select value={reglement.method} onChange={(e) => setReglement({ ...reglement, method: e.target.value })} style={inputStyle}>
                {METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date" width={150}>
              <input type="date" value={reglement.paid_at}
                onChange={(e) => setReglement({ ...reglement, paid_at: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Référence" width={180}>
              <input value={reglement.reference} placeholder="relevé Amex, n° de virement…"
                onChange={(e) => setReglement({ ...reglement, reference: e.target.value })} style={inputStyle} />
            </Field>
            <Btn disabled={busy} onClick={async () => {
              setBusy(true);
              try { await onSettle(reglement); } finally { setBusy(false); }
            }}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Btn>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
          <Field label="État du contrôle" width={170}>
            <select value={detail.status} onChange={(e) => onStatus(e.target.value)}
              style={{ ...inputStyle, ...statusStyle(detail.status) }}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {ecartTarif > 0 && (
              <Btn onClick={copier}>
                {copie ? 'Message copié ✓' : 'Copier le message de réclamation'}
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => downloadFile(detail.id, detail.number)}>Télécharger le document</Btn>
            <Btn variant="danger" onClick={onDelete}>Supprimer</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const methodLabel = (m) => (METHODS.find((x) => x[0] === m) || [])[1] || m;

/* ─── Bons de réduction à valoir ──────────────────────────────
 * GFC, LVP et CigAccess rendent parfois un écart de tarif sous forme de BON,
 * déduit de la commande suivante, plutôt que par un avoir. Le bon se saisit sur
 * la facture fautive (ses écarts cessent d'être à réclamer) ; la facture qui
 * imprime son code le consomme sans que le montant baisse le coût de ses
 * propres lignes (cf. backend/src/utils/invoiceVouchers.js).
 * ──────────────────────────────────────────────────────── */
const voucherErr = (e) => window.alert(e.response?.data?.error || e.message);

/** À l'import : ce que la lecture a fait des bons du fournisseur. */
function VouchersNotice({ result }) {
  const used = result?.vouchersUsed || [];
  const open = result?.vouchersOpen || [];
  const remise = (result?.comparison?.lines || result?.invoice?.lines || [])
    .some((l) => l.verdict === 'discount' || l.kind === 'discount');
  if (used.length === 0 && !(remise && open.length > 0)) return null;
  return (
    <div style={{ padding: 13, background: C.mainL, color: C.mainD, borderRadius: 10, fontSize: 13 }}>
      {used.map((v) => (
        <div key={v.id} style={{ marginBottom: 3 }}>
          <strong>Bon à valoir de {eur(v.amount)}</strong>
          {v.sourceNumber ? ` (facture ${v.sourceNumber})` : ''} reconnu
          {v.matchedBy === 'code' ? <> par son code <strong>{v.code}</strong></> : ' par son montant (aucun code saisi)'} :
          sorti de la remise, il ne baisse pas le coût des lignes de cette commande.
          {v.partial && ` Utilisé en partie seulement : le bon valait ${eur(v.voucherAmount)}.`}
        </div>
      ))}
      {used.length > 0 && (
        <div style={{ color: C.greyT, fontSize: 12 }}>Il passera à « utilisé » à l'enregistrement de la facture.</div>
      )}
      {remise && open.length > 0 && (
        <div style={{ marginTop: used.length ? 8 : 0, color: C.orange }}>
          Cette facture porte une remise et {open.length === 1 ? 'un bon reste' : `${open.length} bons restent`} à
          valoir chez ce fournisseur ({open.map((v) => `${eur(v.amount)}${v.code ? ` · ${v.code}` : ''} · facture ${v.sourceNumber}`).join(' ; ')}).
          Si la remise en est un, saisis son code sur la facture d'origine puis relis ce document.
        </div>
      )}
    </div>
  );
}

/**
 * Saisie d'un tarif par ligne de facture, dans l'unité de la ligne de commande
 * BMS (« Tarif commandé »). Partagée par « Inscrire le bon tarif » (bon de
 * réduction) et « Corriger le tarif BMS ».
 */
function GrilleTarifs({ lignes, rows, onChange, titrePrix }) {
  const factureUnit = (l) => Number(l.line_total_ht) / Number(l.qty);
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8, background: C.white }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th} />
            <th style={th}>Référence</th>
            <th style={th}>Produit</th>
            <th style={{ ...th, textAlign: 'right' }}>Qté</th>
            <th style={{ ...th, textAlign: 'right' }}>Tarif commandé</th>
            <th style={{ ...th, textAlign: 'right' }}>Facturé</th>
            <th style={{ ...th, textAlign: 'right' }}>{titrePrix}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => {
            const r = rows[l.supplier_sku] || { on: false, price: '' };
            const maj = (patch) => onChange({ ...rows, [l.supplier_sku]: { ...r, ...patch } });
            return (
              <tr key={l.id} style={{ color: r.on ? C.dark : C.greyT }}>
                <td style={td}>
                  <input type="checkbox" checked={r.on}
                    onChange={() => maj({ on: !r.on, price: r.price || String(Number(l.expected_unit_price)) })} />
                </td>
                <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', color: 'inherit' }}>{l.supplier_sku}</td>
                <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'inherit' }}>{l.label}</td>
                <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>{num(l.qty)}</td>
                <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>{eur(l.expected_unit_price)}</td>
                <td style={{ ...td, textAlign: 'right', color: 'inherit' }}>{eur(factureUnit(l))}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <input value={r.price} inputMode="decimal" disabled={!r.on}
                    onChange={(e) => maj({ price: e.target.value })}
                    style={{ ...inputStyle, padding: '5px 8px', width: 90, textAlign: 'right' }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Les lignes de produit d'une facture dont on peut corriger le tarif de commande. */
const lignesTarifables = (detail) => (detail.lines || []).filter((l) => (l.kind || 'product') === 'product'
  && l.supplier_sku && l.expected_unit_price != null && Number(l.qty) > 0);

/** Ce que l'API a refusé ou n'a fait qu'à moitié, à dire à l'écran. */
const refusDe = (data) => [
  ...(data.skipped || []).map((k) => `${k.ref} : ${k.reason}`),
  ...(data.applied || []).filter((x) => x.orderLine?.skipped || x.bmsLine?.skipped)
    .map((x) => `${x.ref} : ${x.orderLine?.skipped || `BMS inchangé (${x.bmsLine.skipped})`}`),
];

/**
 * Corriger le tarif de la commande BMS quand c'est LUI qui est faux.
 *
 * L'écart se calcule contre le prix de la ligne BMS. Quand ce prix n'est pas le
 * tarif négocié (cartouches Dojo LCA convenues à 3,00 €, portées à 2,50 € ou
 * 2,80 € dans BMS, facturées 3,436 €), l'écart affiché est faux et la
 * réclamation aussi. On saisit le tarif convenu : il est inscrit chez nous et
 * dans BMS, le contrôle est rejoué, et ne reste à réclamer que facturé − convenu.
 */
function CorrectionTarifsBms({ detail, onChanged }) {
  const lignes = lignesTarifables(detail);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!onChanged || !detail.orders?.[0] || lignes.length === 0) return null;

  const ouvrir = () => {
    const init = {};
    for (const l of lignes) init[l.supplier_sku] = { on: false, price: '' };
    setRows(init);
  };
  const inscrire = async () => {
    const prices = Object.entries(rows).filter(([, r]) => r.on)
      .map(([ref, r]) => ({ ref, price: Number(String(r.price).replace(',', '.')) }));
    if (prices.some((p) => !(p.price > 0))) {
      window.alert('Saisis un tarif pour chaque ligne cochée.');
      return;
    }
    if (!window.confirm(
      `Inscrire le tarif convenu sur ${prices.length} ligne${prices.length > 1 ? 's' : ''} `
      + '(référence fournisseur, commande chez nous et dans BMS) ?\n\n'
      + prices.map((p) => `${p.ref} → ${eur(p.price)}`).join('\n')
      + "\n\nL'écart restant (facturé − convenu) deviendra la somme à réclamer. "
      + 'Si la commande est déjà réceptionnée, la valeur du stock et le coût de revient '
      + 'des pièces déjà vendues seront corrigés à partir de la réception.',
    )) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${BASE}/${detail.id}/agreed-prices`, { prices });
      const refus = refusDe(data);
      if (refus.length) window.alert(`Pas entièrement appliqué :\n${refus.join('\n')}`);
      setRows(null);
      await onChanged();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT }}>TARIF BMS ERRONÉ</div>
        {!rows && <Btn small variant="ghost" onClick={ouvrir}>Corriger le tarif BMS</Btn>}
      </div>
      {!rows && (
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 6 }}>
          Le prix de la commande BMS n'est pas le tarif négocié ? Saisis le bon : l'écart sera recalculé
          contre lui, et c'est lui qui sera réclamé.
        </div>
      )}
      {rows && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: C.greyT }}>
            Le tarif convenu avec le fournisseur, à la pièce comme la colonne « Tarif commandé ». Il remplace le prix
            de la commande <strong>{detail.orders[0].bms_reference}</strong> chez nous et dans BMS, et sert aux
            prochaines commandes.
          </div>
          <GrilleTarifs lignes={lignes} rows={rows} onChange={setRows} titrePrix="Tarif convenu" />
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn disabled={busy || !Object.values(rows).some((r) => r.on)} onClick={inscrire}>
              {busy ? 'Inscription…' : 'Inscrire ces tarifs'}
            </Btn>
            <Btn variant="ghost" onClick={() => setRows(null)}>Annuler</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dans la fiche d'une facture : les bons qu'elle a fait naître et ceux qu'elle a consommés. */
function VoucherSection({ detail, onChanged }) {
  const nes = (detail.vouchers || []).filter((v) => v.source_document_id === detail.id);
  const consommes = (detail.vouchers || []).filter((v) => v.consumed_document_id === detail.id);
  // Les lignes dont l'écart de tarif reste à réclamer : celles qu'un bon peut rendre.
  const candidates = (detail.lines || []).filter((l) => ['price', 'qty_price'].includes(l.verdict)
    && l.material && l.supplier_sku && ecartTarifDe(l) > 0);

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState({});
  // Correction des tarifs de la commande au BON prix : { voucher, rows: { ref: { on, price } } }.
  const [prix, setPrix] = useState(null);
  const lignesProduit = lignesTarifables(detail);
  const factureUnit = (l) => Number(l.line_total_ht) / Number(l.qty);
  const ouvrirPrix = (v) => {
    const vise = (l) => (v.covered_refs?.length
      ? v.covered_refs.includes(l.supplier_sku)
      : ['price', 'qty_price', 'voucher_credited'].includes(l.verdict));
    const rows = {};
    for (const l of lignesProduit) {
      // Pré-coché sur ce que le bon rembourse, au tarif commandé quand le
      // facturé le dépasse : à ajuster quand le fournisseur reconnaît un autre
      // prix (2,90 € pour des cartouches commandées 2,88 €).
      const on = vise(l);
      const prevu = Number(l.expected_unit_price);
      rows[l.supplier_sku] = { on, price: on && factureUnit(l) > prevu ? String(prevu) : '' };
    }
    setPrix({ voucher: v, rows });
  };
  const inscrirePrix = async () => {
    const choix = Object.entries(prix.rows).filter(([, r]) => r.on);
    const prices = choix.map(([ref, r]) => ({ ref, price: Number(String(r.price).replace(',', '.')) }));
    if (prices.some((p) => !(p.price > 0))) {
      window.alert('Saisis un tarif pour chaque ligne cochée.');
      return;
    }
    if (!window.confirm(
      `Inscrire le bon tarif sur ${prices.length} ligne${prices.length > 1 ? 's' : ''} `
      + '(référence fournisseur, commande chez nous et dans BMS) ?\n\n'
      + prices.map((p) => `${p.ref} → ${eur(p.price)}`).join('\n')
      + '\n\nSi la commande est déjà réceptionnée, la valeur du stock et le coût de revient '
      + 'des pièces déjà vendues seront corrigés à partir de la réception.',
    )) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${BASE}/vouchers/${prix.voucher.id}/apply-prices`, { prices });
      const refus = refusDe(data);
      if (refus.length) window.alert(`Pas entièrement appliqué :\n${refus.join('\n')}`);
      setPrix(null);
      if (onChanged) await onChanged();
    } catch (e) { voucherErr(e); } finally { setBusy(false); }
  };

  const ouvrir = () => {
    const refs = candidates.map((l) => l.supplier_sku);
    const total = candidates.reduce((t, l) => t + ecartTarifDe(l), 0);
    setForm({ refs, amount: total > 0 ? total.toFixed(2) : '', touched: false, code: '', note: '' });
  };
  const basculer = (ref) => {
    const refs = form.refs.includes(ref) ? form.refs.filter((r) => r !== ref) : [...form.refs, ref];
    const total = candidates.filter((l) => refs.includes(l.supplier_sku)).reduce((t, l) => t + ecartTarifDe(l), 0);
    setForm({ ...form, refs, amount: form.touched ? form.amount : (total > 0 ? total.toFixed(2) : '') });
  };
  const enregistrer = async () => {
    setBusy(true);
    try {
      await axios.post(`${BASE}/${detail.id}/vouchers`, {
        amount_ht: Number(String(form.amount).replace(',', '.')),
        code: form.code,
        covered_refs: form.refs,
        note: form.note,
      });
      setForm(null);
      if (onChanged) await onChanged();
    } catch (e) { voucherErr(e); } finally { setBusy(false); }
  };
  const saisirCode = async (v) => {
    setBusy(true);
    try {
      await axios.put(`${BASE}/vouchers/${v.id}`, { code: codes[v.id] || '' });
      if (onChanged) await onChanged();
    } catch (e) { voucherErr(e); } finally { setBusy(false); }
  };
  const supprimer = async (v) => {
    if (!window.confirm(`Supprimer le bon de ${eur(v.amount_ht)} ? Les écarts qu'il compensait redeviendront à réclamer.`)) return;
    setBusy(true);
    try {
      await axios.delete(`${BASE}/vouchers/${v.id}`);
      if (onChanged) await onChanged();
    } catch (e) { voucherErr(e); } finally { setBusy(false); }
  };

  // Un bon trop petit pour ses lignes ne compense rien : il faut le dire, sinon
  // on croit l'écart rendu alors qu'il reste à réclamer.
  const nonCouverts = candidates.filter((l) => nes.some((v) => !v.covered_refs?.length
    || v.covered_refs.includes(l.supplier_sku)));

  return (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.greyT }}>BON DE RÉDUCTION À VALOIR</div>
        {detail.doc_type === 'invoice' && !form && onChanged && (
          <Btn small variant="ghost" onClick={ouvrir}>+ Bon de réduction promis</Btn>
        )}
      </div>

      {nes.length === 0 && consommes.length === 0 && !form && (
        <div style={{ fontSize: 12, color: C.greyM, marginTop: 6 }}>
          Le fournisseur rend l'écart sous forme de bon sur la prochaine commande, plutôt que par un avoir ?
          Enregistre-le ici : les écarts qu'il couvre cesseront d'être à réclamer.
        </div>
      )}

      {nes.map((v) => (
        <div key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, padding: '8px 0', borderTop: `1px solid ${C.greyB}`, marginTop: 8 }}>
          <strong>{eur(v.amount_ht)} HT</strong>
          <span style={{ color: C.greyT }}>
            {v.covered_refs?.length ? v.covered_refs.join(', ') : 'tous les écarts de la facture'}
          </span>
          {v.consumed_document_id
            ? <Badge tone="green">déduit sur la facture {v.consumed_number} du {date(v.consumed_date)}</Badge>
            : <Badge tone="orange">à valoir</Badge>}
          {v.code
            ? <span>code <strong>{v.code}</strong></span>
            : (!v.consumed_document_id && onChanged && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={codes[v.id] || ''} placeholder="code du bon"
                  onChange={(e) => setCodes({ ...codes, [v.id]: e.target.value })}
                  style={{ ...inputStyle, padding: '5px 8px', width: 190 }} />
                <Btn small disabled={busy || !(codes[v.id] || '').trim()} onClick={() => saisirCode(v)}>Enregistrer le code</Btn>
              </span>
            ))}
          {v.note && <span style={{ color: C.greyM, fontSize: 12 }}>{v.note}</span>}
          {onChanged && detail.orders?.[0] && lignesProduit.length > 0 && (
            <Btn small variant="ghost" disabled={busy} onClick={() => ouvrirPrix(v)}>Inscrire le bon tarif</Btn>
          )}
          {onChanged && <Btn small variant="danger" disabled={busy} onClick={() => supprimer(v)}>Supprimer</Btn>}
        </div>
      ))}

      {prix && (
        <div style={{ marginTop: 10, padding: 12, background: C.grey, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: C.greyT }}>
            Le tarif que le fournisseur reconnaît, tel qu'il aurait dû être facturé. Il remplace le prix de la commande
            {' '}<strong>{detail.orders[0].bms_reference}</strong> chez nous et dans BMS, et sert aux prochaines commandes.
            Le bon s'étend aux lignes corrigées.
          </div>
          <GrilleTarifs lignes={lignesProduit} rows={prix.rows} titrePrix="Bon tarif"
            onChange={(rows) => setPrix({ ...prix, rows })} />
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn disabled={busy || !Object.values(prix.rows).some((r) => r.on)} onClick={inscrirePrix}>
              {busy ? 'Inscription…' : 'Inscrire ces tarifs'}
            </Btn>
            <Btn variant="ghost" onClick={() => setPrix(null)}>Annuler</Btn>
          </div>
        </div>
      )}

      {nonCouverts.length > 0 && (
        <div style={{ fontSize: 12, color: C.orange, marginTop: 6 }}>
          {nonCouverts.length} écart{nonCouverts.length > 1 ? 's' : ''} de tarif visé{nonCouverts.length > 1 ? 's' : ''} par
          le bon reste{nonCouverts.length > 1 ? 'nt' : ''} à réclamer : le montant du bon ne{' '}
          {nonCouverts.length > 1 ? 'les' : 'le'} couvre pas en entier.
        </div>
      )}

      {consommes.map((v) => (
        <div key={v.id} style={{ fontSize: 13, padding: '8px 0', borderTop: `1px solid ${C.greyB}`, marginTop: 8 }}>
          Bon de <strong>{eur(v.amount_ht)}</strong> de la facture <strong>{v.source_number}</strong>
          {v.code ? <> (code {v.code})</> : ''} déduit sur cette facture : il ne compte pas dans le coût de ses lignes.
        </div>
      ))}

      {form && (
        <div style={{ marginTop: 10, padding: 12, background: C.grey, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {candidates.length > 0 ? (
            <div style={{ fontSize: 12.5 }}>
              <div style={{ fontWeight: 600, color: C.greyT, marginBottom: 4 }}>Écarts que le bon rembourse</div>
              {candidates.map((l) => (
                <label key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.refs.includes(l.supplier_sku)} onChange={() => basculer(l.supplier_sku)} />
                  <span style={{ fontWeight: 600 }}>{l.supplier_sku}</span>
                  <span style={{ color: C.greyT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{l.label}</span>
                  <span style={{ marginLeft: 'auto', color: C.red, fontWeight: 600 }}>{signedEur(ecartTarifDe(l))}</span>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.greyT }}>
              Aucun écart de tarif à réclamer sur cette facture : le bon couvrira tous ses écarts s'il les égale.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Montant HT du bon" width={140}>
              <input value={form.amount} inputMode="decimal"
                onChange={(e) => setForm({ ...form, amount: e.target.value, touched: true })} style={inputStyle} />
            </Field>
            <Field label="Code (si déjà reçu)" width={220}>
              <input value={form.code} placeholder="ex. V687392C8282O278763"
                onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Note" width={220}>
              <input value={form.note} placeholder="facultatif"
                onChange={(e) => setForm({ ...form, note: e.target.value })} style={inputStyle} />
            </Field>
            <Btn disabled={busy || !(Number(String(form.amount).replace(',', '.')) > 0)} onClick={enregistrer}>
              {busy ? 'Enregistrement…' : 'Enregistrer le bon'}
            </Btn>
            <Btn variant="ghost" onClick={() => setForm(null)}>Annuler</Btn>
          </div>
          <div style={{ fontSize: 11.5, color: C.greyM }}>
            Le code permet de reconnaître le bon sur la facture qui le déduira. Sans code, il n'est reconnu que si la
            remise de cette facture tombe pile sur son montant.
          </div>
        </div>
      )}
    </div>
  );
}

/** Onglet Factures : ce qu'on nous doit encore en bons. */
function OpenVouchers({ reloadKey, onOpen }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let vivant = true;
    axios.get(`${BASE}/vouchers`, { params: { status: 'open' } })
      .then(({ data }) => { if (vivant) setRows(data); })
      .catch(() => { if (vivant) setRows([]); });
    return () => { vivant = false; };
  }, [reloadKey]);
  if (rows.length === 0) return null;
  const total = rows.reduce((t, v) => t + Number(v.amount_ht), 0);
  return (
    <div style={{ background: C.white, border: `1px solid ${C.main}55`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.mainD, marginBottom: 6 }}>
        BONS DE RÉDUCTION À VALOIR — {eur(total)} HT
      </div>
      {rows.map((v) => (
        <div key={v.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
          <strong style={{ minWidth: 130 }}>{v.supplier_name}</strong>
          <span style={{ minWidth: 80 }}>{eur(v.amount_ht)}</span>
          {v.code
            ? <span style={{ color: C.greyT }}>code {v.code}</span>
            : <Badge tone="orange">code à saisir</Badge>}
          <button type="button" onClick={() => onOpen(v.source_document_id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: C.main, fontWeight: 600, fontSize: 13,
          }}>facture {v.source_number}</button>
          <span style={{ color: C.greyM, fontSize: 12 }}>depuis {v.age_days} j</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * ONGLET 3 — Règlements
 *
 * Vue seule, depuis le 28/09/2026 : on règle depuis l'onglet Factures, là où
 * on décide. Ici on regarde ce qui est parti et ce qui reste dû, par
 * fournisseur et par moyen.
 * ═══════════════════════════════════════════════════════════ */
function PaymentsTab({ mobile, reloadKey, onSaved }) {
  const [payments, setPayments] = useState([]);
  const [unpaid, setUnpaid] = useState([]);
  const [filters, setFilters] = useState({ supplier: '', method: '', statut: '', q: '' });
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([
      axios.get(`${BASE}/payments`),
      axios.get(`${BASE}/unpaid`),
    ]);
    setPayments(p.data);
    setUnpaid(u.data);
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  // Un règlement effectué et une facture qui attend son règlement sont deux
  // choses différentes ; la même liste les montre côte à côte, parce que c'est
  // ainsi qu'on se demande « qu'est-ce que je dois encore ? ».
  const items = useMemo(() => {
    // Les deux colonnes doivent dire la MÊME chose sur les deux types de ligne :
    // `documents` porte toujours les numéros de facture concernés, `reference`
    // toujours la référence du règlement — vide tant qu'il n'y en a pas.
    const faits = payments.map((p) => ({
      cle: `p${p.id}`,
      // L'identifiant du règlement lui-même : c'est ce qui se supprime. Une
      // ligne « en attente » n'en a pas — elle n'est pas un règlement, c'est une
      // facture qui en espère un.
      paymentId: p.id,
      documentCount: Number(p.document_count) || 0,
      // Un règlement qui ne solde que des avoirs n'est pas un paiement : c'est
      // un avoir consommé. L'afficher « Réglé » laisserait croire à une sortie
      // d'argent qui n'a pas eu lieu.
      statut: Number(p.credit_note_count) > 0 && Number(p.credit_note_count) === Number(p.document_count)
        ? 'avoirUtilise' : 'fait',
      date: p.paid_at, fournisseur: p.supplier_name,
      moyen: p.method, reference: p.reference, montant: Number(p.amount),
      documents: p.document_numbers, commandes: p.order_refs, nonImpute: Number(p.unallocated_amount),
      // La TVA des factures que ce règlement solde, au prorata de ce qu'il en
      // solde — et ce qu'on n'a pas su lire, qui ferait baisser le total sans
      // le dire.
      tva: Number(p.vat_amount) || 0,
      tvaInconnue: Number(p.vat_unknown_count) || 0,
    }));
    // Un avoir ne se paie pas : il s'utilise. Lui coller une échéance et un
    // retard n'a aucun sens — il attend simplement d'être imputé sur un
    // règlement. D'où un statut à lui.
    const attente = unpaid.map((d) => ({
      cle: `d${d.document_id}`,
      documentId: d.document_id,
      statut: d.doc_type === 'credit_note' ? 'avoir' : 'attente',
      date: d.doc_type === 'credit_note' ? d.doc_date : d.effective_due_date,
      fournisseur: d.supplier_name, moyen: null, reference: null,
      documents: d.number, commandes: d.order_refs,
      montant: Number(d.remaining_amount),
      retard: d.doc_type === 'credit_note' ? 0 : Number(d.days_overdue),
      // Sur une ligne en attente, la TVA est celle que porte ce qui reste dû :
      // la même colonne répond donc à la même question des deux côtés —
      // combien de TVA dans ce montant.
      tva: d.vat_remaining == null ? null : Number(d.vat_remaining),
      tvaInconnue: 0,
    }));
    return [...faits, ...attente]
      .filter((x) => (!filters.supplier || x.fournisseur === filters.supplier)
        && (!filters.method || x.moyen === filters.method)
        && (!filters.statut || x.statut === filters.statut)
        && (!filters.q || `${x.fournisseur} ${x.documents || ''} ${x.commandes || ''} ${x.reference || ''}`
              .toLowerCase().includes(filters.q.trim().toLowerCase())))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [payments, unpaid, filters]);

  // On ouvre le document depuis ici : revenir à l'onglet Factures pour changer
  // un état ou enregistrer un règlement n'avait pas de sens.
  const openDoc = async (documentId) => {
    const { data } = await axios.get(`${BASE}/${documentId}`);
    setDetail(data);
  };
  const refreshDoc = async () => { await load(); if (detail) openDoc(detail.id); };

  /**
   * Défaire un règlement.
   *
   * On annonce AVANT ce que ça entraîne : un règlement groupé solde plusieurs
   * factures, et les remettre toutes « à payer » sans l'avoir dit serait une
   * surprise désagréable un jour de rapprochement bancaire. Les règlements de
   * test du 28/09/2026, eux, ne soldent plus rien — la liste le dit aussi.
   */
  const [suppression, setSuppression] = useState(null);
  const supprimer = async (x) => {
    const concernees = x.documents
      ? `\n\nCes factures redeviendront « à payer » :\n${x.documents}`
      : "\n\nIl n'est imputé sur aucune facture : rien d'autre ne bouge.";
    if (!window.confirm(
      `Supprimer le règlement de ${eur(x.montant)} du ${date(x.date)}`
      + ` (${x.fournisseur}${x.moyen ? ` · ${methodLabel(x.moyen)}` : ''}) ?`
      + `${concernees}\n\nCette action est définitive.`,
    )) return;
    setSuppression(x.cle);
    try {
      await axios.delete(`${BASE}/payments/${x.paymentId}`);
      await load();
      if (onSaved) onSaved();
    } catch (e) {
      window.alert(e.response?.data?.error || e.message);
    } finally { setSuppression(null); }
  };

  const totalFait = items.filter((x) => x.statut === 'fait').reduce((s, x) => s + x.montant, 0);
  const totalDu = items.filter((x) => x.statut === 'attente').reduce((s, x) => s + x.montant, 0);
  // Un avoir non utilisé est de l'argent à faire valoir, pas une dette :
  // le fondre dans « en attente » masquait les deux à la fois.
  const totalAvoirs = items.filter((x) => x.statut === 'avoir').reduce((s, x) => s + x.montant, 0);
  const totalAvoirsUtilises = items.filter((x) => x.statut === 'avoirUtilise').reduce((s, x) => s + x.montant, 0);
  // La TVA que la colonne somme, par famille de ligne. Un règlement sans facture
  // imputée n'y entre pas : sa TVA est inconnue, pas nulle.
  const tvaDe = (statut) => items
    .filter((x) => x.statut === statut && x.tva != null && !(x.paymentId && x.documentCount === 0))
    .reduce((s, x) => s + x.tva, 0);
  const tvaReglee = tvaDe('fait');
  const tvaEnAttente = tvaDe('attente');
  const fournisseurs = [...new Set([...payments.map((p) => p.supplier_name), ...unpaid.map((d) => d.supplier_name)])].sort();

  return (
    <div style={{ padding: mobile ? '16px' : '22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fournisseur" width={200}>
          <select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            {fournisseurs.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Moyen" width={160}>
          <select value={filters.method} onChange={(e) => setFilters({ ...filters, method: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            {METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Statut" width={170}>
          <select value={filters.statut} onChange={(e) => setFilters({ ...filters, statut: e.target.value })} style={inputStyle}>
            <option value="">Tous</option>
            <option value="fait">Réglés</option>
            <option value="attente">En attente</option>
            <option value="avoir">Avoirs non utilisés</option>
            <option value="avoirUtilise">Avoirs utilisés</option>
          </select>
        </Field>
        <Field label="Rechercher" width={230}>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="numéro, fournisseur, référence…" style={inputStyle} />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Réglé" value={eur(totalFait)} tone="green"
          hint={`dont ${eur(tvaReglee)} de TVA`} />
        <Kpi label="En attente" value={eur(totalDu)} tone={totalDu > 0 ? 'orange' : 'green'}
          hint={`dont ${eur(tvaEnAttente)} de TVA`} />
        {totalAvoirs !== 0 && (
          <Kpi label="Avoirs non utilisés" value={eur(Math.abs(totalAvoirs))} tone="blue" />
        )}
        {totalAvoirsUtilises !== 0 && (
          <Kpi label="Avoirs utilisés" value={eur(Math.abs(totalAvoirsUtilises))} tone="green" />
        )}
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 10, background: C.white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Statut</th>
            <th style={th}>Date</th>
            <th style={th}>Fournisseur</th>
            <th style={th}>Moyen</th>
            <th style={th}>Factures concernées</th>
            <th style={th}>N° commande</th>
            <th style={th}>Référence du règlement</th>
            <th style={{ ...th, textAlign: 'right' }}>Montant TTC</th>
            <th style={{ ...th, textAlign: 'right' }}>TVA</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>
            {items.length === 0 && (
              <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 24 }} colSpan={10}>
                Rien à afficher. Les règlements s'enregistrent depuis l'onglet Factures.
              </td></tr>
            )}
            {items.map((x) => (
              <tr key={x.cle}
                  onClick={() => x.documentId && openDoc(x.documentId)}
                  style={{ cursor: x.documentId ? 'pointer' : 'default' }}>
                <td style={td}>
                  {x.statut === 'fait' && <Badge tone="green">Réglé</Badge>}
                  {x.statut === 'avoirUtilise' && <Badge tone="green">Avoir utilisé</Badge>}
                  {x.statut === 'avoir' && <Badge tone="blue">Avoir non utilisé</Badge>}
                  {x.statut === 'attente' && (
                    <Badge tone={x.retard > 0 ? 'red' : 'orange'}>
                      {x.retard > 0 ? `En retard (${x.retard} j)` : 'En attente'}
                    </Badge>
                  )}
                </td>
                <td style={td}>{date(x.date)}</td>
                <td style={td}>{x.fournisseur}</td>
                <td style={td}>{x.moyen ? <Badge tone="blue">{methodLabel(x.moyen)}</Badge> : <span style={{ color: C.greyM }}>—</span>}</td>
                <td style={{ ...td, fontWeight: 600 }}>{x.documents || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{x.commandes || <span style={{ color: C.greyM }}>—</span>}</td>
                <td style={td}>{x.reference || <span style={{ color: C.greyM }}>—</span>}</td>
                <td style={{
                  ...td, textAlign: 'right', fontWeight: 700,
                  // Un avoir est de l'argent à faire valoir : le peindre en
                  // rouge le ferait passer pour une dette.
                  color: x.statut === 'avoir' || x.statut === 'avoirUtilise'
                    ? C.blue : (x.statut === 'fait' ? C.dark : C.orange),
                }}>
                  {eur(x.montant)}
                  {x.nonImpute != null && Math.abs(x.nonImpute) > 0.009 && (
                    <div style={{ fontSize: 10.5, color: C.red, fontWeight: 600 }}>
                      {eur(x.nonImpute)} non imputé
                    </div>
                  )}
                </td>
                {/* La TVA contenue dans le montant d'à côté. Inconnue quand le
                    règlement n'est imputé sur aucune facture : sans facture, on
                    ne sait pas ce qu'il a payé — et surtout pas sa TVA. */}
                <td style={{ ...td, textAlign: 'right', color: C.greyT }}>
                  {x.tva == null || (x.paymentId && x.documentCount === 0)
                    ? <span title="Aucune facture imputée : la TVA de ce règlement est inconnue"
                        style={{ color: C.greyM }}>—</span>
                    : eur(x.tva)}
                  {x.tvaInconnue > 0 && (
                    <div style={{ fontSize: 10.5, color: C.orange, fontWeight: 600 }}>
                      {x.tvaInconnue} facture{x.tvaInconnue > 1 ? 's' : ''} sans TVA lue
                    </div>
                  )}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {x.paymentId && (
                    <Btn small variant="danger" disabled={suppression === x.cle}
                      onClick={() => supprimer(x)}>
                      {suppression === x.cle ? '…' : 'Suppr.'}
                    </Btn>
                  )}
                  {/* Une ligne « en attente » n'est pas un règlement : rien à
                      supprimer ici, la facture se supprime depuis l'onglet
                      Factures. */}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <DocumentPanel
          detail={detail}
          mobile={mobile}
          onClose={() => setDetail(null)}
          onStatus={async (st) => { await axios.put(`${BASE}/${detail.id}/status`, { status: st }); refreshDoc(); }}
          onDelete={async () => {
            if (!window.confirm(`Supprimer ${detail.number} et son fichier ? Cette action est définitive.`)) return;
            await axios.delete(`${BASE}/${detail.id}`);
            setDetail(null);
            load();
          }}
          onSettle={async (r) => { await settleOne(detail, r); refreshDoc(); }}
          onChanged={refreshDoc}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
const TABS = [
  ['control', 'Contrôle'],
  ['filing', 'Factures'],
  ['payments', 'Règlements'],
];

export default function SupplierInvoicesApp() {
  const mobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const initialDocId = Number(searchParams.get('doc')) || null;
  const [tab, setTab] = useState(initialDocId ? 'filing' : 'control');
  const [suppliers, setSuppliers] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    // Seuls les fournisseurs dont on sait lire les factures sont proposés :
    // en choisir un autre ne donnerait qu'une erreur de parseur.
    Promise.all([
      axios.get(`${API}/purchases/suppliers`),
      axios.get(`${BASE}/parsers`),
    ]).then(([s, p]) => {
      // `/purchases/suppliers` répond `{ success, data }`, pas un tableau nu —
      // contrairement à la plupart des routeurs de l'app. On accepte les deux
      // formes plutôt que de parier sur l'une d'elles.
      const list = Array.isArray(s.data) ? s.data : (s.data?.data || s.data?.suppliers || []);
      const known = new Set(p.data.suppliers || []);
      const usable = list.filter((x) => known.has(x.code)).sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(usable);
      // Une liste vide n'est pas un état normal : sans message, l'écran donne
      // un menu déroulant muet et rien n'explique pourquoi.
      setLoadError(usable.length === 0 ? 'Aucun fournisseur exploitable n’a pu être chargé.' : null);
    }).catch((e) => {
      setSuppliers([]);
      setLoadError(e.response?.data?.error || e.message || 'Chargement des fournisseurs impossible');
    });
  }, []);

  return (
    <AppShell currentPath="/factures-fournisseurs">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <section style={{ padding: mobile ? '18px 16px 0' : '26px 40px 0', background: C.white, borderBottom: `1px solid ${C.greyB}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.main, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
              <InvoiceIcon size={26} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.dark, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Factures Fournisseurs
              </h1>
              <p style={{ fontSize: 13, color: C.greyT, margin: '3px 0 0' }}>
                Contrôler une facture contre sa commande, réclamer les écarts de tarif, ranger les documents et suivre les règlements.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 16 }}>
            {TABS.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13.5, fontWeight: tab === key ? 800 : 600,
                color: tab === key ? C.main : C.greyT,
                borderBottom: `3px solid ${tab === key ? C.main : 'transparent'}`,
              }}>{label}</button>
            ))}
          </div>
        </section>

        {loadError && (
          <div style={{
            margin: mobile ? '16px' : '18px 40px 0', padding: 13, background: C.redL, color: C.red,
            borderRadius: 10, fontSize: 13, fontWeight: 600,
          }}>{loadError}</div>
        )}

        {tab === 'control' && <ControlTab suppliers={suppliers} mobile={mobile} onSaved={bump} />}
        {tab === 'filing' && <FilingTab suppliers={suppliers} mobile={mobile} reloadKey={reloadKey} onSaved={bump} initialDocId={initialDocId} />}
        {tab === 'payments' && <PaymentsTab mobile={mobile} reloadKey={reloadKey} onSaved={bump} />}
      </main>
    </AppShell>
  );
}
