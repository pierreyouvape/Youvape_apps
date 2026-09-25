/**
 * Message de réclamation tarifaire à envoyer au commercial.
 *
 * Produit un texte prêt à copier-coller dans la messagerie de l'acheteur — l'app
 * n'envoie rien elle-même (choix de Pierre, 25/09/2026) : le commercial doit
 * recevoir le message depuis l'adresse habituelle de son interlocuteur, pas
 * depuis un robot.
 *
 * Ne reprend QUE les hausses de tarif matérielles (`price` / `qty_price` avec
 * `gapPrice > 0` et `material`). Sont donc volontairement absents :
 *   • les arrondis de remise — le tarif unitaire est le bon, il n'y a rien à
 *     demander, et une réclamation à 0,11 € décrédibilise les autres ;
 *   • les lignes en notre faveur — on ne les signale pas, on aligne le tarif ;
 *   • les manquants et les écarts de conditionnement — ce sont des sujets de
 *     livraison, à traiter séparément, pas des demandes d'avoir.
 */

const fmtEur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const fmtQty = (n) => String(n);

/** Colle les colonnes d'un tableau texte, lisible même sans police fixe. */
function renderTable(rows, headers) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/**
 * @param {Object} input
 * @param {Object} input.comparison  sortie de compareInvoiceToOrder
 * @param {Object} input.invoice     { number, date }
 * @param {Object} input.order       { reference }
 * @param {Object} [input.supplier]  { name, contactName }
 * @param {string} [input.senderName] signature
 * @returns {{ subject: string, body: string, claimable: number, lines: Array }}
 */
function buildClaimMessage({ comparison, invoice = {}, order = {}, supplier = {}, senderName } = {}) {
  const claimLines = (comparison?.lines || []).filter(
    (l) => l.material && l.gapPrice > 0 && (l.verdict === 'price' || l.verdict === 'qty_price'),
  );

  const total = Math.round(claimLines.reduce((s, l) => s + l.gapPrice, 0) * 100) / 100;

  const subject = `Facture ${invoice.number || ''} — écart de tarif sur ${claimLines.length} ligne${
    claimLines.length > 1 ? 's' : ''
  } (${fmtEur(total)} HT)`.replace(/\s+/g, ' ').trim();

  if (claimLines.length === 0) {
    return { subject, body: '', claimable: 0, lines: [] };
  }

  const table = renderTable(
    claimLines.map((l) => [
      l.ref || '',
      (l.label || '').slice(0, 44),
      fmtQty(l.qtyInvoiced),
      fmtEur(l.expectedUnitPrice),
      fmtEur(l.invoicedUnitPrice),
      `+${fmtEur(l.gapPrice)}`,
    ]),
    ['Référence', 'Produit', 'Qté', 'Tarif commandé', 'Tarif facturé', 'Écart HT'],
  );

  const hello = supplier.contactName ? `Bonjour ${supplier.contactName},` : 'Bonjour,';
  const ref = order.reference ? ` (commande ${order.reference})` : '';

  const body = [
    hello,
    '',
    `En contrôlant votre facture ${invoice.number || ''}${
      invoice.date ? ` du ${invoice.date}` : ''
    }${ref}, je relève ${claimLines.length} ligne${claimLines.length > 1 ? 's' : ''} facturée${
      claimLines.length > 1 ? 's' : ''
    } au-dessus du tarif convenu à la commande :`,
    '',
    table,
    '',
    `Soit ${fmtEur(total)} HT de trop sur cette facture.`,
    '',
    'Pouvez-vous établir un avoir correspondant, ou me confirmer le nouveau tarif',
    's’il s’agit d’une évolution de prix de votre côté ?',
    '',
    'Merci d’avance,',
    senderName || '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { subject, body, claimable: total, lines: claimLines };
}

module.exports = { buildClaimMessage };
