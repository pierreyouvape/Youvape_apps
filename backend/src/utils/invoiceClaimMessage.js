/**
 * Message de réclamation tarifaire à envoyer au commercial.
 *
 * Produit un texte prêt à copier-coller dans la messagerie de l'acheteur — l'app
 * n'envoie rien elle-même (choix de Pierre, 25/09/2026) : le commercial doit
 * recevoir le message depuis l'adresse habituelle de son interlocuteur, pas
 * depuis un robot.
 *
 * Ne reprend QUE les hausses de tarif matérielles (`price` / `qty_price` dont le
 * résidu après remise de pied reste positif, et `material`). Sont donc
 * volontairement absents :
 *   • les arrondis de remise — le tarif unitaire est le bon, il n'y a rien à
 *     demander, et une réclamation à 0,11 € décrédibilise les autres ;
 *   • les lignes en notre faveur — on ne les signale pas, on aligne le tarif ;
 *   • les manquants et les écarts de conditionnement — ce sont des sujets de
 *     livraison, à traiter séparément, pas des demandes d'avoir.
 *
 * Deux rendus du MÊME message : `body` en texte brut, `bodyHtml` avec un vrai
 * tableau. Le tableau calé aux espaces ne tenait que dans une police à chasse
 * fixe — dans Gmail ou Outlook, les colonnes se décalaient et la réclamation
 * devenait illisible. L'écran copie les deux dans le presse-papiers : la
 * messagerie prend le HTML, un champ de texte simple prend le brut.
 *
 * Les quantités et les tarifs du tableau sont donnés À LA PIÈCE, et le message le
 * dit, ligne par ligne, quand la facture compte autrement (`aLaPiece`). Un carton
 * de 5 facturé 25,96 € en face d'une commande à 4,50 € la pièce, lu tel quel,
 * réclamait 21,46 € pour 3,46 € de trop.
 *
 * La DATE DE FACTURE ne figure pas dans le message : le numéro de facture suffit
 * à l'identifier chez le fournisseur, et l'horodatage qui traînait derrière
 * (« Fri Sep 25 2026 00:00:00 GMT+0000 ») ne faisait que salir le texte.
 */

const fmtEur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
/**
 * Un prix fournisseur se négocie au millième : ramener 5,192 € à 5,19 € ferait
 * un tableau qui ne retombe plus sur son écart. On ne sort la troisième décimale
 * que quand le centime ne suffit pas.
 */
const fmtPrix = (n) => {
  const v = Number(n);
  const auMillieme = Math.abs(v * 100 - Math.round(v * 100)) >= 0.05;
  return `${v.toFixed(auMillieme ? 3 : 2).replace('.', ',')} €`;
};
const fmtQty = (n) => String(Math.round(Number(n) * 1000) / 1000);

/**
 * LE CONDITIONNEMENT, quand la facture ne compte pas dans la même unité que la
 * commande. Le rapport des quantités doit être ENTIER (un carton contient 5 ou
 * 10 pièces, jamais 1,37) — même règle que `packFactor` du moteur, reconstituée
 * ici parce que le message se construit aussi depuis les lignes GELÉES en base,
 * qui ne portent pas ce champ.
 */
function packFactorOf(l) {
  const inv = Number(l.qtyInvoiced);
  const ord = Number(l.qtyOrdered);
  if (!(inv > 0) || !(ord > 0) || inv === ord) return null;
  const f = inv > ord ? inv / ord : ord / inv;
  const arrondi = Math.round(f);
  return arrondi >= 2 && Math.abs(f - arrondi) < 0.01 ? arrondi : null;
}

/**
 * La ligne RAMENÉE À LA PIÈCE : la seule unité que les deux côtés partagent.
 *
 * Facture JoshNoa V3/2026/37644, ligne josh00012308 : 5 pièces commandées à
 * 4,50 €, facturées « 1 × 25,96 € (5 pièces) ». Lu tel quel, le message
 * demandait un avoir de 21,46 € (25,96 − 4,50) quand le fournisseur n'a pris
 * que 3,46 € de trop. Une réclamation six fois trop grosse, et c'est nous qui
 * perdions la face.
 *
 * Quand les quantités concordent, rien ne change : on réclame le résidu de
 * l'écart de tarif, remise de pied déduite.
 */
function aLaPiece(l) {
  const facteur = packFactorOf(l);
  const residu = l.residualGapPrice == null ? l.gapPrice : l.residualGapPrice;
  if (!facteur) {
    return {
      units: l.qtyInvoiced,
      expected: l.expectedUnitPrice,
      invoiced: l.invoicedUnitPrice,
      du: residu,
      note: null,
    };
  }
  const pieces = Math.max(Number(l.qtyInvoiced), Number(l.qtyOrdered));
  const totalFacture = l.invoicedTotal == null
    ? Number(l.qtyInvoiced) * Number(l.invoicedUnitPrice)
    : Number(l.invoicedTotal);
  const totalCommande = Number(l.qtyOrdered) * Number(l.expectedUnitPrice);
  return {
    units: pieces,
    expected: totalCommande / pieces,
    invoiced: totalFacture / pieces,
    // L'écart RÉEL de la ligne, remise de pied comprise (cf. CLAUDE.md,
    // « l'écart d'une ligne est son écart réel »).
    du: l.netGap == null ? Math.round((totalFacture - totalCommande) * 100) / 100 : l.netGap,
    // Le commercial doit pouvoir retrouver sa propre ligne : on dit donc en
    // clair ce qu'on a converti.
    note: `${l.ref || 'cette ligne'} : facturée ${fmtQty(l.qtyInvoiced)} × `
      + `${fmtPrix(totalFacture / Number(l.qtyInvoiced))} pour ${fmtQty(pieces)} pièces`,
  };
}

/** Colle les colonnes d'un tableau texte, lisible même sans police fixe. */
function renderTable(rows, headers) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

/** Échappe ce qui part dans le HTML : un libellé produit peut contenir « & » ou « < ». */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tableau HTML autoportant : styles en ligne, les messageries jettent les <style>. */
function renderTableHtml(rows, headers) {
  const cell = 'padding:6px 10px;border:1px solid #d5d8dd;';
  const num = `${cell}text-align:right;white-space:nowrap;`;
  const th = `${cell}background:#f2f4f7;font-weight:600;`;

  // Les trois dernières colonnes sont des nombres : alignées à droite, comme au
  // bilan comptable — c'est ce qui rend les écarts comparables d'un coup d'œil.
  const head = headers
    .map((h, i) => `<th style="${th}text-align:${i >= 2 ? 'right' : 'left'};">${esc(h)}</th>`)
    .join('');
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="${i >= 2 ? num : cell}">${esc(c)}</td>`).join('')}</tr>`)
    .join('');

  return `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;">`
    + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
  // Ce qu'on réclame est le RÉSIDU, pas le dépassement brut : une remise de pied
  // en a déjà payé une partie, parfois la totalité. Réclamer le brut, c'est
  // demander deux fois la même chose — et sur LVP F2610287890, c'était écrire au
  // commercial pour trois lignes XROS payées exactement au prix commandé.
  //
  // Et quand les deux côtés ne comptent pas dans la même unité, ce résidu se lit à
  // la pièce : voir `aLaPiece`.
  const vu = new Map((comparison?.lines || []).map((l) => [l, aLaPiece(l)]));
  const du = (l) => vu.get(l).du;
  const claimLines = (comparison?.lines || []).filter(
    (l) => l.material && du(l) > 0 && (l.verdict === 'price' || l.verdict === 'qty_price'),
  );

  const total = Math.round(claimLines.reduce((s, l) => s + du(l), 0) * 100) / 100;

  const subject = `Facture ${invoice.number || ''} — écart de tarif sur ${claimLines.length} ligne${
    claimLines.length > 1 ? 's' : ''
  } (${fmtEur(total)} HT)`.replace(/\s+/g, ' ').trim();

  if (claimLines.length === 0) {
    return { subject, body: '', bodyHtml: '', claimable: 0, lines: [] };
  }

  const headers = ['Référence', 'Produit', 'Qté', 'Tarif commandé', 'Tarif facturé', 'Écart HT'];
  const rows = claimLines.map((l) => {
    const p = vu.get(l);
    return [
      l.ref || '',
      (l.label || '').slice(0, 44),
      fmtQty(p.units),
      fmtPrix(p.expected),
      fmtPrix(p.invoiced),
      `+${fmtEur(p.du)}`,
    ];
  });
  const table = renderTable(rows, headers);
  // Ce qu'on a converti, dit en clair : le commercial doit retrouver SA ligne,
  // telle qu'elle est imprimée sur sa facture.
  const conversions = claimLines.map((l) => vu.get(l).note).filter(Boolean);

  const hello = supplier.contactName ? `Bonjour ${supplier.contactName},` : 'Bonjour,';
  const ref = order.reference ? ` (commande ${order.reference})` : '';
  const pluriel = claimLines.length > 1 ? 's' : '';
  const intro = `En contrôlant votre facture ${invoice.number || ''}${ref}, je relève `
    + `${claimLines.length} ligne${pluriel} facturée${pluriel} au-dessus du tarif convenu `
    + 'à la commande :';
  const bilan = `Soit ${fmtEur(total)} HT de trop sur cette facture.`;
  const demande = 'Pouvez-vous établir un avoir correspondant svp ?';
  const conversion = conversions.length === 0 ? null
    : `Quantités et tarifs sont donnés à la pièce — ${conversions.join(' ; ')}.`;

  const body = [
    hello,
    '',
    intro,
    '',
    table,
    '',
    ...(conversion ? [conversion, ''] : []),
    bilan,
    '',
    demande,
    '',
    'Merci d’avance,',
    senderName || '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const p = (txt) => `<p style="margin:0 0 12px;">${esc(txt)}</p>`;
  const bodyHtml = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b1f24;">',
    p(hello),
    p(intro),
    renderTableHtml(rows, headers),
    conversion ? `<p style="margin:10px 0 12px;font-size:12.5px;color:#55606d;">${esc(conversion)}</p>` : '',
    `<p style="margin:12px 0;"><strong>${esc(bilan)}</strong></p>`,
    p(demande),
    p('Merci d’avance,'),
    senderName ? p(senderName) : '',
    '</div>',
  ].join('');

  return { subject, body, bodyHtml, claimable: total, lines: claimLines };
}

module.exports = { buildClaimMessage };
