/**
 * Les mails d'écart de réception.
 *
 * Deux raisons de prévenir, et une seule d'en faire deux mails séparés :
 *  - LES MANQUANTS partent à l'acheteur, avec leur motif. C'est lui qui
 *    relancera le fournisseur (reliquat), classera l'affaire (soldé) ou la
 *    réclamera (manquant) — le motif est le début de son travail, pas la fin
 *    du nôtre.
 *  - LE SURPLUS est une alerte : la marchandise est là, physiquement, mais
 *    rien ne dit qu'on la doit à ce bon de commande. Elle part dans le même
 *    mail lorsqu'il y en a un. Il dit, ligne par ligne, combien de pièces
 *    BMS a RÉELLEMENT mises en stock — il les prend en général toutes, sauf
 *    dépassement sur une ligne déjà réceptionnée — et qu'un responsable doit
 *    confirmer qu'elles nous sont dues.
 *  - LES ARTICLES AJOUTÉS pendant la réception (« Ajouter un article ») : livrés
 *    sans être sur le bon. La ligne est créée à la quantité saisie, donc ils ne
 *    sont ni manquants ni en surplus — le mail n'en disait rien (CGWZWKGPZ,
 *    18/11/2026). Ils ont leur propre tableau, avec le prix retenu : c'est la
 *    marchandise à retrouver sur la facture.
 *
 * Le destinataire vit dans `app_config.reception_email_to`. Vide, rien ne part
 * et c'est écrit dans les journaux : une réception ne doit jamais échouer
 * parce qu'un mail n'a pas pu être envoyé.
 */
const pool = require('../config/database');
const { sendMail } = require('./alertService');

const LIBELLE_MOTIF = {
  reliquat: 'Reliquat — le fournisseur doit encore l\'envoyer',
  solde: 'Soldé — il ne l\'enverra pas, et nous a déjà remboursés',
  manquant: 'Manquant — erreur à réclamer',
  erreur_saisie: 'Erreur de saisie de notre côté — rien à réclamer',
};

async function destinataires() {
  const { rows } = await pool.query(
    "SELECT config_value FROM app_config WHERE config_key = 'reception_email_to'",
  );
  return String((rows[0] || {}).config_value || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function entete(purchaseOrderId, sessionId) {
  const { rows } = await pool.query(
    `SELECT po.order_number, po.bms_po_id, s.name AS supplier,
            COALESCE(uo.name, uo.email) AS ouverte_par,
            COALESCE(uv.name, uv.email) AS validee_par
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN reception_sessions r ON r.id = $2
       LEFT JOIN users uo ON uo.id = r.started_by
       LEFT JOIN users uv ON uv.id = r.validated_by
      WHERE po.id = $1`,
    [purchaseOrderId, sessionId || null],
  );
  return rows[0] || {};
}

// Qui a traité la réception : celui qui l'a validée, et celui qui l'a ouverte
// quand ce n'est pas le même (comptage commencé par l'un, fini par l'autre).
function traitePar(cmd) {
  const v = cmd.validee_par;
  const o = cmd.ouverte_par;
  if (!v && !o) return '';
  if (v && o && v !== o) return `${v} (réception ouverte par ${o})`;
  return v || o;
}

const echapper = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// « Mis en stock » : ce que BMS a accepté, pas ce qui a été compté.
const enStock = (l) => (l.stocked >= l.units
  ? `Oui, ${l.stocked}`
  : `<strong style="color:#dc2626">NON pour ${l.units - l.stocked}</strong> (${l.stocked} sur ${l.units})`);

function tableau(titre, lignes, avecMotif, avecStock = false) {
  const entetes = ['Référence', 'Produit', 'Attendu', 'Reçu', 'Écart']
    .concat(avecMotif ? ['Motif'] : [])
    .concat(avecStock ? ['Mis en stock'] : []);
  const cellules = (l) => [
    echapper(l.ref || '—'),
    echapper(l.product || '—'),
    l.expected,
    l.units,
    l.ecart > 0 ? `+${l.ecart}` : l.ecart,
  ].concat(avecMotif ? [echapper(LIBELLE_MOTIF[l.motif] || l.motif || '—')] : [])
    .concat(avecStock ? [enStock(l)] : []);

  return `<h3 style="font:600 15px/1.4 Arial,sans-serif;color:#1f2937;margin:22px 0 8px">${titre}</h3>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif;width:100%">
<tr style="background:#f3f4f6">${entetes.map((h) => `<th align="left" style="border:1px solid #e5e7eb">${h}</th>`).join('')}</tr>
${lignes.map((l) => `<tr>${cellules(l).map((c) => `<td style="border:1px solid #e5e7eb">${c}</td>`).join('')}</tr>`).join('\n')}
</table>`;
}

const euros = (v) => (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0
  ? null
  : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' €');

// Les articles ajoutés : pas d'« attendu » (rien n'était commandé), le prix
// retenu à la création de la ligne et ce que BMS a mis en stock.
function tableauAjoutes(lignes) {
  const entetes = ['Référence', 'Produit', 'Reçu', 'Prix pièce HT', 'Montant HT', 'Mis en stock'];
  const cellules = (l) => {
    const prix = euros(l.unitPrice);
    return [
      echapper(l.ref || '—'),
      echapper(l.product || '—'),
      l.units,
      prix || '<strong style="color:#dc2626">inconnu</strong>',
      prix ? euros(Math.round(l.unitPrice * l.units * 100) / 100) : '—',
      enStock(l),
    ];
  };
  return `<h3 style="font:600 15px/1.4 Arial,sans-serif;color:#1f2937;margin:22px 0 8px">${lignes.length} article(s) ajouté(s) pendant la réception (absents du bon)</h3>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif;width:100%">
<tr style="background:#f3f4f6">${entetes.map((h) => `<th align="left" style="border:1px solid #e5e7eb">${h}</th>`).join('')}</tr>
${lignes.map((l) => `<tr>${cellules(l).map((c) => `<td style="border:1px solid #e5e7eb">${c}</td>`).join('')}</tr>`).join('\n')}
</table>`;
}

/**
 * Prévient des écarts d'une réception validée. Ne lève jamais : l'appelant a
 * déjà mis la marchandise en stock.
 */
async function previenirEcarts({
  purchaseOrderId, sessionId, manquants = [], surplus = [], ajoutes = [], nonEnvoyes = [],
}) {
  if (manquants.length === 0 && surplus.length === 0 && ajoutes.length === 0 && nonEnvoyes.length === 0) {
    return { sent: false, reason: 'aucun_ecart' };
  }

  const to = await destinataires();
  if (to.length === 0) {
    console.log('[reception] écart constaté mais aucun destinataire configuré (app_config.reception_email_to) — mail non envoyé.');
    return { sent: false, reason: 'aucun_destinataire' };
  }

  // Sans `stocked` (appelant ancien), on ne prétend rien : on le tient pour
  // inconnu plutôt que d'affirmer une mise en stock.
  surplus = surplus.map((l) => ({ ...l, stocked: Number.isFinite(l.stocked) ? l.stocked : 0 }));
  const surplusToutEnStock = surplus.every((l) => l.stocked >= l.units);
  ajoutes = ajoutes.map((l) => ({ ...l, stocked: Number.isFinite(l.stocked) ? l.stocked : 0 }));

  const cmd = await entete(purchaseOrderId, sessionId);
  const par = traitePar(cmd);
  const nom = cmd.order_number || `commande ${purchaseOrderId}`;
  // Le refus de BMS passe devant : c'est de la marchandise physiquement là et
  // absente du stock, donc le seul écart qui demande une action tout de suite.
  const ecarts = [
    manquants.length > 0 && 'articles manquants',
    surplus.length > 0 && 'SURPLUS reçu',
    ajoutes.length > 0 && 'articles ajoutés',
  ].filter(Boolean);
  const sujet = nonEnvoyes.length > 0
    ? `Réception ${nom} : BMS a REFUSÉ des pièces comptées`
    : `Réception ${nom} : ${ecarts.length > 1 ? `${ecarts.slice(0, -1).join(', ')} et ${ecarts[ecarts.length - 1]}` : ecarts[0]}`;

  const corps = [
    `<div style="font:14px/1.6 Arial,sans-serif;color:#1f2937">`,
    `<p>Réception de <strong>${echapper(nom)}</strong>`
      + (cmd.supplier ? ` chez <strong>${echapper(cmd.supplier)}</strong>` : '')
      + (cmd.bms_po_id ? ` (bon BMS ${cmd.bms_po_id})` : '') + '.</p>',
    par ? `<p style="margin:4px 0 0">Traitée par <strong>${echapper(par)}</strong>.</p>` : '',
    nonEnvoyes.length > 0
      ? '<div style="margin-top:14px;padding:12px;border-left:4px solid #dc2626;background:#fef2f2">'
        + '<strong>BMS a refusé une partie de ce qui a été compté.</strong> Il n\'accepte pas de '
        + 'dépassement sur une ligne déjà réceptionnée. Ces pièces sont physiquement chez nous mais '
        + '<strong>ne sont PAS en stock</strong> :<ul style="margin:8px 0 0">'
        + nonEnvoyes.map((n) => `<li>${echapper(n.ref || n.product || '—')} : ${n.envoyees} pièce(s) enregistrée(s) sur ${n.comptees} comptée(s) — <strong>${n.refusees} refusée(s)</strong></li>`).join('')
        + '</ul><p style="margin:8px 0 0">À trancher avec un responsable : soit le bon de commande '
        + 'était faux, soit la marchandise appartient à une autre commande.</p></div>'
      : '',
    manquants.length > 0 ? tableau(`${manquants.length} article(s) manquant(s)`, manquants, true) : '',
    surplus.length > 0 ? tableau(`${surplus.length} article(s) reçu(s) en trop`, surplus, false, true) : '',
    surplus.length > 0
      ? '<p style="margin-top:14px;padding:12px;border-left:4px solid #d97706;background:#fffbeb">'
        + (surplusToutEnStock
          ? '<strong>Le surplus EST en stock</strong> : BMS a accepté toutes les pièces comptées. '
          : '<strong>Une partie du surplus N\'EST PAS en stock</strong> (colonne « Mis en stock »). ')
        + 'Rien ne dit en revanche qu\'il nous est dû sur ce bon de commande : à vérifier avec un '
        + 'responsable (facture, erreur d\'expédition du fournisseur).</p>'
      : '',
    ajoutes.length > 0 ? tableauAjoutes(ajoutes) : '',
    ajoutes.length > 0
      ? '<p style="margin-top:14px;padding:12px;border-left:4px solid #2563eb;background:#eff6ff">'
        + 'Ces articles n\'étaient <strong>pas sur le bon de commande</strong> : ils y ont été ajoutés '
        + 'pendant la réception, à la quantité reçue. Le prix est celui de la référence fournisseur '
        + '(à défaut, du catalogue) : à vérifier sur la facture, et à confirmer avec un responsable '
        + 's\'ils nous sont bien dus.</p>'
      : '',
    '<p style="margin-top:18px;color:#6b7280;font-size:13px">Envoyé automatiquement par l\'app Réception.</p>',
    '</div>',
  ].filter(Boolean).join('\n');

  const texte = [
    `Réception ${nom}${cmd.supplier ? ` chez ${cmd.supplier}` : ''}.`,
    par ? `Traitée par ${par}.` : '',
    nonEnvoyes.length > 0 ? `\nREFUSÉ PAR BMS (pas en stock) :\n${nonEnvoyes.map((n) => `- ${n.ref || n.product} : ${n.envoyees}/${n.comptees} enregistrées, ${n.refusees} refusées`).join('\n')}` : '',
    manquants.length > 0 ? `\nManquants :\n${manquants.map((l) => `- ${l.ref || l.product} : ${l.units}/${l.expected} (${LIBELLE_MOTIF[l.motif] || l.motif || 'sans motif'})`).join('\n')}` : '',
    ajoutes.length > 0 ? `\nAjoutés pendant la réception (absents du bon) :\n${ajoutes.map((l) => `- ${l.ref || l.product} : ${l.units} reçu(s) — prix pièce HT ${euros(l.unitPrice) || 'inconnu'} — en stock : ${l.stocked >= l.units ? `oui, ${l.stocked}` : `NON pour ${l.units - l.stocked} (${l.stocked}/${l.units})`}`).join('\n')}` : '',
    surplus.length > 0 ? `\nSurplus :\n${surplus.map((l) => `- ${l.ref || l.product} : ${l.units}/${l.expected} (+${l.ecart}) — en stock : ${l.stocked >= l.units ? `oui, ${l.stocked}` : `NON pour ${l.units - l.stocked} (${l.stocked}/${l.units})`}`).join('\n')}\n${surplusToutEnStock ? 'Le surplus EST en stock' : 'Une partie du surplus N\'EST PAS en stock'} : vérifier avec un responsable qu'il nous est dû.` : '',
  ].filter(Boolean).join('\n');

  const r = await sendMail({ to, subject: sujet, html: corps, text: texte });
  if (!r.success) console.error('[reception] mail d\'écart non parti :', r.error);
  return {
    sent: r.success, to,
    manquants: manquants.length, surplus: surplus.length, ajoutes: ajoutes.length, nonEnvoyes: nonEnvoyes.length,
  };
}

module.exports = { previenirEcarts };
