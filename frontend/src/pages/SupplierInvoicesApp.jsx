import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
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
const num = (v) => (v == null ? '—' : String(Math.round(Number(v) * 1000) / 1000));

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
  free: { rank: 8, label: 'Offert', tone: 'green', action: 'Geste commercial, rien à faire' },
  packaging: { rank: 9, label: 'Conditionnement', tone: 'grey', action: 'Unités contre packs : même marchandise, même montant' },
  // Complété à l'affichage par le facteur déduit (« vendu par 2 »), quand on l'a.

  rounding: { rank: 10, label: 'Arrondi de remise', tone: 'grey', action: 'Calcul du fournisseur, pas une erreur de tarif' },
  other: { rank: 11, label: 'Ligne hors produit', tone: 'grey', action: 'À qualifier' },
  ok: { rank: 99, label: 'Conforme', tone: 'green', action: null },
};
const TONES = {
  red: { color: C.red, bg: C.redL }, orange: { color: C.orange, bg: C.orangeL },
  green: { color: C.green, bg: C.greenL }, blue: { color: C.blue, bg: C.blueL },
  grey: { color: C.greyT, bg: C.grey },
};

const STATUS_LABELS = { to_check: 'À contrôler', checked: 'Contrôlée', disputed: 'En litige', archived: 'Archivée' };
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

const Kpi = ({ label, value, tone }) => (
  <div style={{
    flex: 1, minWidth: 140, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`,
    padding: '13px 16px',
  }}>
    <div style={{ fontSize: 21, fontWeight: 800, color: tone ? TONES[tone].color : C.dark }}>{value}</div>
    <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{label}</div>
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

/* ─── Tableau des différences ─────────────────────────────
 * Règle posée le 25/09/2026 : TOUTES les différences sont affichées, sans
 * filtre de seuil. Le seuil ne décide que de ce qui part en réclamation.
 * ──────────────────────────────────────────────────────── */
function DifferencesTable({ lines, mobile }) {
  const rows = useMemo(() => (lines || [])
    .filter((l) => l.verdict && l.verdict !== 'ok')
    .map((l) => ({ ...l, meta: VERDICTS[l.verdict] || VERDICTS.other }))
    .sort((a, b) => (a.meta.rank - b.meta.rank) || (Math.abs(b.gap) - Math.abs(a.gap))), [lines]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 22, textAlign: 'center', color: C.green, fontWeight: 600, background: C.greenL, borderRadius: 10 }}>
        Aucune différence : la facture correspond à la commande, ligne à ligne.
      </div>
    );
  }

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((l, i) => (
          <div key={i} style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{l.ref || '—'}</div>
              <Badge tone={l.meta.tone}>{l.meta.label}</Badge>
            </div>
            <div style={{ fontSize: 12, color: C.greyT, margin: '4px 0 8px' }}>{l.label || ''}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span>cmd {num(l.qtyOrdered)} → fact {num(l.qtyInvoiced)}</span>
              <strong style={{ color: l.gap > 0 ? C.red : C.green }}>{signedEur(l.gap)}</strong>
            </div>
            {l.meta.action && <div style={{ fontSize: 11.5, color: C.greyM, marginTop: 6 }}>{l.meta.action}</div>}
          </div>
        ))}
      </div>
    );
  }

  return (
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
            <th style={{ ...th, textAlign: 'right' }}>Écart HT</th>
            <th style={th}>À faire</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.ref || '—'}</td>
              <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label || ''}</td>
              <td style={td}><Badge tone={l.meta.tone}>{l.meta.label}</Badge></td>
              <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{num(l.qtyOrdered)} / {num(l.qtyInvoiced)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.expectedUnitPrice == null ? '—' : eur(l.expectedUnitPrice)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.invoicedUnitPrice == null ? '—' : eur(l.invoicedUnitPrice)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.gap > 0 ? C.red : (l.gap < 0 ? C.green : C.greyT) }}>
                {signedEur(l.gap)}
                {l.explainedByDiscount > 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: C.greyM, whiteSpace: 'nowrap' }}>
                    dont {eur(l.explainedByDiscount)} de remise
                  </div>
                )}
              </td>
              <td style={{ ...td, fontSize: 11.5, color: C.greyT }}>
                {l.verdict === 'packaging' && l.packFactor
                  ? `Vendu par ${l.packFactor} chez ce fournisseur : ${num(l.qtyInvoiced)} × ${l.packFactor} = ${num(l.qtyOrdered)} unités`
                  : (l.meta.action || '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
 * figurait dans les deux — en haut avec son bouton « Retenir », en bas avec
 * « Réclamer un avoir ». Chaque ligne porte maintenant son MOTIF : le prix a
 * bougé, la quantité ne correspond pas, ou les deux.
 */
function ControlTable({ rows, supplierId, orderId, orderReceived, mobile }) {
  const [aligning, setAligning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [perLine, setPerLine] = useState({});

  const aRetenir = (rows || []).filter((r) => r.tariff);

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
   * `align-tariffs` n'inscrit que le tarif de référence ; `apply-tariffs` corrige
   * EN PLUS la commande qui vient d'être payée, donc le FIFO. Deux routes, parce
   * que ce sont deux décisions : noter un prix pour la prochaine fois, ou
   * réécrire la valeur d'un lot déjà en stock.
   */
  const envoyer = async (liste, surLaCommande) => {
    const { data } = await axios.post(`${BASE}/${surLaCommande ? 'apply' : 'align'}-tariffs`, {
      supplier_id: supplierId,
      ...(surLaCommande ? { order_id: orderId } : {}),
      tariffs: liste.map((t) => ({ ref: t.ref, realPrice: t.realPrice, packQty: t.packQty })),
    });
    setPerLine((p) => {
      const n = { ...p };
      for (const a of data.applied || []) {
        // Un tarif inscrit chez nous mais qu'aucune ligne de la commande ne
        // porte n'est pas un succès complet : le dire, plutôt que d'afficher
        // « Appliqué » sur un FIFO resté au prix commandé.
        n[a.ref] = surLaCommande && a.orderLine?.skipped
          ? `tarif retenu, commande inchangée : ${a.orderLine.skipped}`
          : (surLaCommande ? 'applied' : 'done');
      }
      for (const k of data.skipped || []) n[k.ref] = k.reason;
      return n;
    });
  };

  // Réécrire le prix d'un lot DÉJÀ REÇU déplace une valeur de stock historique.
  // On le fait — le prix payé est le prix payé, même six mois après — mais
  // jamais sans l'avoir dit.
  const confirmeSiRecue = () => !orderReceived || window.confirm(
    'Cette commande a déjà été réceptionnée.\n\n'
    + 'Corriger son prix modifiera la valeur du stock à partir de sa date de réception, '
    + 'ainsi que le coût de revient des pièces déjà vendues.\n\nContinuer ?',
  );

  const retenirUne = async (t, surLaCommande) => {
    if (surLaCommande && !confirmeSiRecue()) return;
    setPerLine((p) => ({ ...p, [t.ref]: 'busy' }));
    try { await envoyer([t], surLaCommande); }
    catch (e) { setPerLine((p) => ({ ...p, [t.ref]: e.response?.data?.error || e.message })); }
  };

  const tout = async (surLaCommande) => {
    if (surLaCommande && !confirmeSiRecue()) return;
    const setBusy = surLaCommande ? setApplying : setAligning;
    setBusy(true);
    try { await envoyer(aRetenir.map((r) => r.tariff), surLaCommande); }
    catch (e) { window.alert(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  const bouton = (r) => {
    if (!r.tariff) return null;
    const etat = perLine[r.ref];
    if (etat === 'done') return <span style={{ color: C.green, fontWeight: 600, fontSize: 12 }}>Retenu</span>;
    if (etat === 'applied') return <span style={{ color: C.green, fontWeight: 600, fontSize: 12 }}>Appliqué</span>;
    if (etat && etat !== 'busy') return <span style={{ color: C.orange, fontSize: 11.5 }}>{etat}</span>;
    return (
      // Le geste complet porte le bouton plein, le partiel le bouton blanc :
      // deux actions voisines dont l'une réécrit une compta ne peuvent pas se
      // ressembler. (« secondary » n'est pas un variant de Btn et retombait sur
      // le bleu du CSS global ; on ne le propage pas ici.)
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Btn onClick={() => retenirUne(r.tariff, false)} variant="ghost" small disabled={etat === 'busy'}>
          {etat === 'busy' ? '…' : 'Retenir'}
        </Btn>
        {orderId && (
          <Btn onClick={() => retenirUne(r.tariff, true)} small disabled={etat === 'busy'}>
            Appliquer
          </Btn>
        )}
      </div>
    );
  };

  const entete = (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.dark }}>
        À examiner ({rows.length})
      </h3>
      {aRetenir.length > 0 && (
        <Btn onClick={() => tout(false)} variant="ghost" disabled={aligning || applying} small>
          {aligning ? 'Enregistrement…' : `Tout retenir (${aRetenir.length})`}
        </Btn>
      )}
      {aRetenir.length > 0 && orderId && (
        <Btn onClick={() => tout(true)} disabled={aligning || applying} small>
          {applying ? 'Application…' : `Tout appliquer (${aRetenir.length})`}
        </Btn>
      )}
      {/* Deux gestes, deux portées. « Retenir » ne parle qu'à l'avenir ;
          « Appliquer » corrige aussi ce que ce lot a coûté, et c'est la seule
          façon que le FIFO voie le prix réellement payé — il lit le prix de la
          commande, jamais celui de la facture. */}
      <span style={{ fontSize: 12, color: C.greyT, flex: '1 1 320px', minWidth: 260 }}>
        <strong>Retenir</strong> écrit le <strong>prix réel payé</strong> dans notre référentiel : il
        fera autorité à l'import de la prochaine commande, même s'il est plus élevé — le cas d'une
        promotion terminée.{orderId && <> <strong>Appliquer</strong> fait la même chose et corrige{' '}
        <strong>en plus le prix de cette commande</strong>, pour que le coût de revient FIFO de ces
        pièces soit celui qu'on a vraiment payé.</>}
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
                  <span>cmd {num(r.qtyOrdered)} → fact {num(r.qtyInvoiced)}</span>
                  <strong style={{ color: r.gap > 0 ? C.red : C.green }}>{signedEur(r.gap)}</strong>
                </div>
                {r.tariff && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 12.5 }}>
                      {prix(r.tariff.currentPrice)} → <strong>{prix(r.tariff.realPrice)}</strong>
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
                    {num(r.qtyOrdered)} / {num(r.qtyInvoiced)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: C.greyT }}>
                    {prix(t ? t.currentPrice : r.expectedUnitPrice)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: t ? 700 : 400 }}>
                    {prix(t ? t.realPrice : r.effectiveUnitCost)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: t && t.delta > 0 ? C.red : C.green }}>
                    {t ? `${t.delta > 0 ? '+' : ''}${prix(t.delta)}` : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: r.gap > 0 ? C.red : C.green }}>
                    {signedEur(r.gap)}
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
    const { data } = await axios.get(`${BASE}/${saved.id}/claim`);
    if (!data.body) return;

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

    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
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

          {summary?.hasFooterDiscount && (
            <div style={{ padding: 13, background: C.blueL, color: C.blue, borderRadius: 10, fontSize: 13 }}>
              {/* Une remise de pied n'existe JAMAIS dans la commande : BMS porte des
                  prix à la ligne, pas de remise globale. Elle est donc toujours un
                  supplément par rapport à ce qui était prévu — et c'est elle qui
                  explique l'écart favorable affiché en haut, qu'aucune ligne ne
                  justifie. Le taire laissait chercher l'erreur ailleurs. */}
              <strong>{eur(Math.abs(totals.footerDiscount))} de remise supplémentaire</strong>, non prévue
              à la commande : le fournisseur facture les lignes, puis déduit ce montant en pied. Le prix
              payé n'est donc pas celui des lignes :
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
function FilingTab({ suppliers, mobile, reloadKey, onSaved }) {
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
      const { data } = await axios.get(BASE, { params });
      setRows(data);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const openDetail = useCallback(async (id) => {
    setOpenId(id);
    const { data } = await axios.get(`${BASE}/${id}`);
    setDetail(data);
  }, []);

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
      const reste = (data.document?.lines || []).filter(
        (l) => l.verdict && !['ok', 'free', 'discount', 'rounding', 'packaging', 'shipping'].includes(l.verdict) && l.material,
      ).length;
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
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={inputStyle}>
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Kpi label="Documents" value={rows.length} />
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
                <th style={th}>Facture</th>
                <th style={th}>Numéro</th>
                <th style={th}>Fournisseur</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Total TTC</th>
                <th style={{ ...th, textAlign: 'center' }}>Écarts</th>
                <th style={th}>Contrôle</th>
                <th style={th}>Échéance</th>
                <th style={th}>Payée le</th>
                <th style={th}>Paiement</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 26 }} colSpan={13}>
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
                    <td style={{ ...td, textAlign: 'center' }} onClick={() => openDetail(r.id)}>
                      {Number(r.difference_count) > 0
                        ? <Badge tone="red">{r.difference_count}</Badge>
                        : <span style={{ color: C.green }}>✓</span>}
                    </td>
                    <td style={td}>
                      <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }}>
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

      {detail && (
        <DocumentPanel
          detail={detail}
          mobile={mobile}
          onClose={closeDetail}
          onStatus={(s) => setStatus(detail.id, s)}
          onDelete={() => remove(detail)}
          onSettle={async (r) => { await settleOne(detail, r); openDetail(detail.id); }}
        />
      )}
    </div>
  );
}

/**
 * Le détail d'un document, en plein écran.
 *
 * C'était un tiroir de 920 px qu'il fallait faire défiler latéralement pour
 * lire le tableau des écarts — inutilisable. Une facture a une dizaine de
 * colonnes : elle a besoin de toute la largeur.
 */
function DocumentPanel({ detail, mobile, onClose, onStatus, onDelete, onSettle }) {
  const ecarts = detail.lines.filter((l) => l.verdict && l.verdict !== 'ok').length;
  const avoir = detail.doc_type === 'credit_note';
  const reste = Number(detail.remaining_amount) || 0;
  const [reglement, setReglement] = useState({
    method: avoir ? 'avoir' : 'amex',
    paid_at: new Date().toISOString().slice(0, 10),
    reference: '',
  });
  const [busy, setBusy] = useState(false);
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
          <Kpi label="Total TTC" value={eur(detail.total_ttc)} />
          <Kpi label="Réglé" value={eur(detail.paid_amount)} />
          <Kpi label="Reste dû" value={eur(detail.remaining_amount)} tone={Number(detail.remaining_amount) > 0 ? 'orange' : 'green'} />
        </div>

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
          DIFFÉRENCES CONSTATÉES AU CONTRÔLE ({ecarts} sur {detail.lines.length} lignes)
        </div>
        <DifferencesTable lines={fromStoredLines(detail.lines)} mobile={mobile} />

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
            <select value={detail.status} onChange={(e) => onStatus(e.target.value)} style={inputStyle}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => downloadFile(detail.id, detail.number)}>Télécharger le document</Btn>
            <Btn variant="danger" onClick={onDelete}>Supprimer</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const methodLabel = (m) => (METHODS.find((x) => x[0] === m) || [])[1] || m;

/* ═══════════════════════════════════════════════════════════
 * ONGLET 3 — Règlements
 *
 * Vue seule, depuis le 28/09/2026 : on règle depuis l'onglet Factures, là où
 * on décide. Ici on regarde ce qui est parti et ce qui reste dû, par
 * fournisseur et par moyen.
 * ═══════════════════════════════════════════════════════════ */
function PaymentsTab({ mobile, reloadKey }) {
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
      // Un règlement qui ne solde que des avoirs n'est pas un paiement : c'est
      // un avoir consommé. L'afficher « Réglé » laisserait croire à une sortie
      // d'argent qui n'a pas eu lieu.
      statut: Number(p.credit_note_count) > 0 && Number(p.credit_note_count) === Number(p.document_count)
        ? 'avoirUtilise' : 'fait',
      date: p.paid_at, fournisseur: p.supplier_name,
      moyen: p.method, reference: p.reference, montant: Number(p.amount),
      documents: p.document_numbers, nonImpute: Number(p.unallocated_amount),
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
      documents: d.number,
      montant: Number(d.remaining_amount),
      retard: d.doc_type === 'credit_note' ? 0 : Number(d.days_overdue),
    }));
    return [...faits, ...attente]
      .filter((x) => (!filters.supplier || x.fournisseur === filters.supplier)
        && (!filters.method || x.moyen === filters.method)
        && (!filters.statut || x.statut === filters.statut)
        && (!filters.q || `${x.fournisseur} ${x.documents || ''} ${x.reference || ''}`
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

  const totalFait = items.filter((x) => x.statut === 'fait').reduce((s, x) => s + x.montant, 0);
  const totalDu = items.filter((x) => x.statut === 'attente').reduce((s, x) => s + x.montant, 0);
  // Un avoir non utilisé est de l'argent à faire valoir, pas une dette :
  // le fondre dans « en attente » masquait les deux à la fois.
  const totalAvoirs = items.filter((x) => x.statut === 'avoir').reduce((s, x) => s + x.montant, 0);
  const totalAvoirsUtilises = items.filter((x) => x.statut === 'avoirUtilise').reduce((s, x) => s + x.montant, 0);
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
        <Kpi label="Réglé" value={eur(totalFait)} tone="green" />
        <Kpi label="En attente" value={eur(totalDu)} tone={totalDu > 0 ? 'orange' : 'green'} />
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
            <th style={th}>Référence du règlement</th>
            <th style={{ ...th, textAlign: 'right' }}>Montant TTC</th>
          </tr></thead>
          <tbody>
            {items.length === 0 && (
              <tr><td style={{ ...td, textAlign: 'center', color: C.greyM, padding: 24 }} colSpan={7}>
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
  const [tab, setTab] = useState('control');
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
        {tab === 'filing' && <FilingTab suppliers={suppliers} mobile={mobile} reloadKey={reloadKey} onSaved={bump} />}
        {tab === 'payments' && <PaymentsTab mobile={mobile} reloadKey={reloadKey} />}
      </main>
    </AppShell>
  );
}
