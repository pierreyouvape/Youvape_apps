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
 *    mail lorsqu'il y en a un, avec la phrase qui compte : le surplus n'est
 *    pas en stock tant qu'un responsable ne l'a pas tranché.
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

async function entete(purchaseOrderId) {
  const { rows } = await pool.query(
    `SELECT po.order_number, po.bms_po_id, s.name AS supplier
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.id = $1`,
    [purchaseOrderId],
  );
  return rows[0] || {};
}

const echapper = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tableau(titre, lignes, avecMotif) {
  const entetes = ['Référence', 'Produit', 'Attendu', 'Reçu', 'Écart']
    .concat(avecMotif ? ['Motif'] : []);
  const cellules = (l) => [
    echapper(l.ref || '—'),
    echapper(l.product || '—'),
    l.expected,
    l.units,
    l.ecart > 0 ? `+${l.ecart}` : l.ecart,
  ].concat(avecMotif ? [echapper(LIBELLE_MOTIF[l.motif] || l.motif || '—')] : []);

  return `<h3 style="font:600 15px/1.4 Arial,sans-serif;color:#1f2937;margin:22px 0 8px">${titre}</h3>
<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif;width:100%">
<tr style="background:#f3f4f6">${entetes.map((h) => `<th align="left" style="border:1px solid #e5e7eb">${h}</th>`).join('')}</tr>
${lignes.map((l) => `<tr>${cellules(l).map((c) => `<td style="border:1px solid #e5e7eb">${c}</td>`).join('')}</tr>`).join('\n')}
</table>`;
}

/**
 * Prévient des écarts d'une réception validée. Ne lève jamais : l'appelant a
 * déjà mis la marchandise en stock.
 */
async function previenirEcarts({ purchaseOrderId, manquants = [], surplus = [] }) {
  if (manquants.length === 0 && surplus.length === 0) return { sent: false, reason: 'aucun_ecart' };

  const to = await destinataires();
  if (to.length === 0) {
    console.log('[reception] écart constaté mais aucun destinataire configuré (app_config.reception_email_to) — mail non envoyé.');
    return { sent: false, reason: 'aucun_destinataire' };
  }

  const cmd = await entete(purchaseOrderId);
  const nom = cmd.order_number || `commande ${purchaseOrderId}`;
  const sujet = surplus.length > 0 && manquants.length > 0
    ? `Réception ${nom} : manquants et surplus`
    : surplus.length > 0
      ? `Réception ${nom} : SURPLUS reçu`
      : `Réception ${nom} : articles manquants`;

  const corps = [
    `<div style="font:14px/1.6 Arial,sans-serif;color:#1f2937">`,
    `<p>Réception de <strong>${echapper(nom)}</strong>`
      + (cmd.supplier ? ` chez <strong>${echapper(cmd.supplier)}</strong>` : '')
      + (cmd.bms_po_id ? ` (bon BMS ${cmd.bms_po_id})` : '') + '.</p>',
    manquants.length > 0 ? tableau(`${manquants.length} article(s) manquant(s)`, manquants, true) : '',
    surplus.length > 0 ? tableau(`${surplus.length} article(s) reçu(s) en trop`, surplus, false) : '',
    surplus.length > 0
      ? '<p style="margin-top:14px;padding:12px;border-left:4px solid #d97706;background:#fffbeb">'
        + '<strong>Le surplus n\'est pas en stock.</strong> Il a bien été compté et envoyé, mais rien ne dit '
        + 'qu\'il nous est dû sur ce bon de commande : à vérifier avec un responsable avant de le considérer acquis.</p>'
      : '',
    '<p style="margin-top:18px;color:#6b7280;font-size:13px">Envoyé automatiquement par l\'app Réception.</p>',
    '</div>',
  ].filter(Boolean).join('\n');

  const texte = [
    `Réception ${nom}${cmd.supplier ? ` chez ${cmd.supplier}` : ''}.`,
    manquants.length > 0 ? `\nManquants :\n${manquants.map((l) => `- ${l.ref || l.product} : ${l.units}/${l.expected} (${LIBELLE_MOTIF[l.motif] || l.motif || 'sans motif'})`).join('\n')}` : '',
    surplus.length > 0 ? `\nSurplus :\n${surplus.map((l) => `- ${l.ref || l.product} : ${l.units}/${l.expected} (+${l.ecart})`).join('\n')}\nLe surplus n'est pas en stock : vérifier avec un responsable.` : '',
  ].filter(Boolean).join('\n');

  const r = await sendMail({ to, subject: sujet, html: corps, text: texte });
  if (!r.success) console.error('[reception] mail d\'écart non parti :', r.error);
  return { sent: r.success, to, manquants: manquants.length, surplus: surplus.length };
}

module.exports = { previenirEcarts };
