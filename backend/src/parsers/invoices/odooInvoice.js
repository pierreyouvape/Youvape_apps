/**
 * Factures Odoo — JoshNoa, Levest, LIPS France, Cloud Vapor.
 *
 * Quatre fournisseurs, un seul moteur d'édition, mais trois pièges que le
 * gabarit OpenSi n'avait pas :
 *
 * 1. L'ÉTIQUETTE ET SA VALEUR SONT SUR DEUX LIGNES. « Origine : » puis, à la
 *    ligne, « 202508374 ». Toutes les lectures d'en-tête doivent donc tolérer
 *    un saut de ligne entre le libellé et ce qu'on cherche.
 *
 * 2. LES COLONNES D'UNE MÊME LIGNE SONT ÉCLATÉES. Chez LIPS, la quantité est
 *    seule sur sa ligne, « Unité(s) » sur la suivante, et le reste sur une
 *    troisième. On accumule donc jusqu'à rencontrer un montant en euros, qui
 *    marque la fin d'un article.
 *
 * 3. LA COLONNE TAXES S'INTERCALE AVANT LE MONTANT (« TVA 20% »), et le
 *    pourcentage de TVA ressemble à s'y méprendre à une remise. On lit donc les
 *    colonnes EN PARTANT DE LA DROITE, en traversant les jetons décoratifs
 *    (« TVA », « 20% », « Unité(s) », « € ») et en s'arrêtant au premier mot qui
 *    n'est pas un nombre. Lire par la droite rend en prime la désignation
 *    inoffensive : un nombre resté dans le libellé tombe hors des colonnes.
 *
 * Ce qui tranche reste l'arithmétique : une lecture n'est retenue que si
 * `quantité × prix = montant`. Trois interprétations sont tentées, de la plus
 * riche à la plus simple (5, 4 puis 3 colonnes), et la première qui tombe juste
 * gagne.
 *
 * TOLÉRANCE : contrairement à OpenSi, aucune reconstitution ne retombe ici au
 * centime. JoshNoa imprime un prix unitaire TTC arrondi (7,08 €) et une remise
 * arrondie (33,90 %) : 40 × 3,90 = 156,00 € quand la facture dit 156,01 €. Le
 * montant est donc le seul juge, et l'écart toléré vaut un demi-centime par
 * unité — exactement la borne d'un prix unitaire arrondi au centime.
 *
 * Bonus pour le classeur : ces factures portent leurs règlements déjà effectués
 * (« Payé le 21/10/2025 259,79 € », parfois deux fois pour une seule facture
 * chez Cloud Vapor). Ils sont remontés tels quels dans `payments`.
 */

/** Nombre : décimale à la virgule ou au point, milliers espacés, signe possible. */
const { numberReadings } = require('../../utils/invoiceNumbers');

const NUM = String.raw`-?\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?`;
const NUM_ONLY = new RegExp(`^(?:${NUM})$`);

/**
 * Jetons de décor traversés sans être lus : unité, marqueur de taxe, devise.
 * `kg` n'est pas un caprice : chez LIPS, la remise globale est facturée au kilo
 * (« Remise 20% sur produits spécifiques 1,000 kg -5,9160 0,00 TVA 20% -5,92 € »)
 * là où les articles sont en Unité(s). Sans lui, la remontée par la droite
 * s'arrêtait sur « kg », la quantité restait hors cadre et la ligne était
 * perdue — la somme des lignes dépassait alors le total imprimé du montant de
 * la remise.
 */
const DECOR = /^(?:TVA|Unité\(s\)|Unites?|kgs?|€|%|\d+(?:[.,]\d+)?%)$/i;

const toNumber = (s) => parseFloat(String(s).replace(/[  ]/g, '').replace(',', '.'));
const round2 = (n) => Math.round(n * 100) / 100;

/** Lignes de gabarit à ne jamais confondre avec un article. */
const NOISE = [
  /^Description\s+Quantité/i,
  // JoshNoa titre ses colonnes en capitales, sur plusieurs lignes :
  // « DESCRIPTION QTÉ P.U TTC REM. % P.U » / « REMISÉ » / « HT » / « TAXES MONTANT ».
  // Sans ce filtre, l'en-tête se collait au premier article et lui volait sa référence.
  /^DESCRIPTION\b/,
  /^(REMISÉ|HT|TAXES\s+MONTANT|MONTANT)$/,
  /^Montant (hors taxes|dû|HT)/i,
  /^TVA\s+[\d.,]+\s*%/i,
  /^Total\b/i,
  /^Payé le/i,
  /^Facture\b/i,
  /^Avoir\b/i,
  /^Extourne de/i,
  /^PRO FORMA/i,
  /^Date de\b/i,
  /^Date d'échéance/i,
  /^(Origine|Source|Référence)\s*:?\s*$/i,
  /^Adresse/i,
  /^Type d'opération/i,
  /^Conditions (de|générales)/i,
  /^Communication de paiement/i,
  /^sur ce compte/i,
  /^Option pour le paiement/i,
  /^(Pénalité|Pénalités) de retard/i,
  /^Escompte/i,
  /^Aucun escompte/i,
  /^Nature des opérations/i,
  /^Mode de paiement/i,
  /^À régler avant/i,
  /^Référence à rappeler/i,
  /^Coordonnées bancaires/i,
  /^(IBAN|BIC)\s*:/i,
  /^Titulaire\s*:/i,
  /^Page[:\s]/i,
  /^Scanner le code/i,
  /^Une indemnité forfaitaire/i,
  /^Nos coordonnées bancaires/i,
  /SAS au capital|SARL au capital|RCS\s|SIREN\s*:/i,
  /^Incoterm/i,
  /^Vente intracommunautaire/i,
  /^Ac[c@]on réalisée|Transac[c@]on approuvée/i,
];
const isNoise = (line) => NOISE.some((re) => re.test(line.trim()));

/**
 * Lit les colonnes en remontant depuis la droite du bloc.
 * S'arrête au premier jeton qui n'est ni un nombre ni un élément de décor.
 */
function trailingNumbers(block) {
  const tokens = block.trim().split(/\s+/);
  const retenus = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (DECOR.test(t)) continue;
    if (NUM_ONLY.test(t)) {
      retenus.unshift(t);
      continue;
    }
    break;
  }
  // Le séparateur de milliers est un espace, comme celui des colonnes :
  // « 1 008,50 » et « 20 100,00 » s'écrivent pareil. On renvoie les deux
  // lectures, c'est l'arithmétique qui tranchera (cf. utils/invoiceNumbers).
  return numberReadings(retenus);
}

/**
 * Interprète les colonnes lues. Trois gabarits, du plus riche au plus simple :
 *   5  qté, PU TTC, remise %, PU net HT, montant   (JoshNoa)
 *   4  qté, PU HT, remise %, montant               (LIPS)
 *   3  qté, PU HT, montant                         (Levest, Cloud Vapor)
 * On part toujours des k derniers nombres : un nombre resté dans la désignation
 * se retrouve ainsi hors du cadre au lieu de tout décaler.
 */
function readColumns(nums) {
  const attempt = (k) => {
    if (nums.length < k) return null;
    const c = nums.slice(nums.length - k);
    const total = c[k - 1];
    const qty = c[0];
    if (!Number.isFinite(qty) || qty <= 0) return null;
    // Un demi-centime par unité : la borne d'erreur d'un prix unitaire arrondi.
    const tolerance = Math.max(0.02, Math.abs(qty) * 0.005);
    const fits = (price) => Math.abs(round2(qty * price) - round2(total)) <= tolerance;

    if (k === 5) {
      const [, puTtc, discount, puNet] = c;
      if (fits(puNet)) return { qty, unitPriceNet: puNet, total: round2(total), discountPercent: discount };
      // Repli : le net exact, reconstitué depuis le TTC et la remise.
      const net = (puTtc / 1.2) * (1 - discount / 100);
      if (fits(net)) return { qty, unitPriceNet: puNet, total: round2(total), discountPercent: discount };
      return null;
    }
    if (k === 4) {
      const [, pu, third] = c;
      // Gabarit « qté, PU, remise %, montant » (LIPS).
      const net = pu * (1 - third / 100);
      if (fits(net)) return { qty, unitPriceNet: round2(net), total: round2(total), discountPercent: third };
      // Gabarit « qté, PU TTC, PU net HT, montant » : les avoirs JoshNoa n'ont
      // PAS la colonne remise de leurs factures. Une colonne de moins, et la
      // ligne devenait illisible.
      if (fits(third)) return { qty, unitPriceNet: third, total: round2(total), discountPercent: 0 };
      if (fits(pu)) return { qty, unitPriceNet: pu, total: round2(total), discountPercent: 0 };
      return null;
    }
    if (k === 3) {
      const [, pu] = c;
      if (fits(pu)) return { qty, unitPriceNet: pu, total: round2(total), discountPercent: 0 };
      return null;
    }
    return null;
  };

  return attempt(5) || attempt(4) || attempt(3);
}

/** Référence entre crochets en tête de désignation : `[josh00013448] Gum Bull…` */
function splitRef(block) {
  const text = block.replace(/\s+/g, ' ').trim();
  // On cherche le PREMIER groupe entre crochets où qu'il soit, pas seulement en
  // tête : un résidu de gabarit resté devant ne doit pas faire perdre la réf.
  const m = text.match(/\[([^\]]+)\]\s*(.*)$/);
  if (m) return { ref: m[1].trim(), label: m[2].trim() || null };
  return { ref: null, label: text || null };
}

/** Lignes qui ne portent pas de marchandise : port et remise globale. */
function classify(ref, label) {
  const text = `${ref || ''} ${label || ''}`.toLowerCase();
  if (/shipping|delivery|livraison|frais de transport|expédition/.test(text)) return 'shipping';
  if (/^discount|remise/.test(text.trim())) return 'discount';
  return 'product';
}

function parseHeader(text) {
  // « Avoir RV3/2026/02731 » chez JoshNoa, « Avoir RFAC/2026/07/0016 » chez
  // Levest : montants imprimés en positif, signe inversé à la sortie.
  const isCreditNote = /^\s*Avoir\s+[A-Z0-9]/im.test(text);
  // Chez Cloud Vapor, l'étiquette elle-même est coupée (« Date de » / « facturation »).
  // Les recherches d'en-tête tournent donc sur une copie à plat, où les sauts de
  // ligne deviennent des espaces. Les totaux, eux, restent ancrés en début de
  // ligne sur le texte d'origine — les aplatir les rendrait ambigus.
  const flat = text.replace(/\s*\n\s*/g, ' ');

  const grab = (re, i = 1, source = flat) => {
    const m = source.match(re);
    return m ? m[i].trim() : null;
  };
  const date = (re) => {
    const m = flat.match(re);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const amount = (re) => {
    const m = text.match(re);
    return m ? toNumber(m[1]) : null;
  };

  // « Payé le 21/10/2025 259,79 € » — parfois plusieurs fois (Cloud Vapor).
  const payments = [];
  const payRe = /Payé le\s+(\d{2})\/(\d{2})\/(\d{4})\s+([-\d  .,]+)\s*€/gi;
  let p;
  while ((p = payRe.exec(text)) !== null) {
    payments.push({ paidAt: `${p[3]}-${p[2]}-${p[1]}`, amount: toNumber(p[4]) });
  }

  return {
    isCreditNote,
    docType: isCreditNote ? 'credit_note' : 'invoice',
    number: grab(/(?:Facture|Avoir)\s+([A-Z0-9][A-Z0-9/\-.]*)/i),
    // « Extourne de : V3/2026/33473 » : la facture que cet avoir corrige.
    correctsInvoice: grab(/Extourne de\s*:?\s*([A-Z0-9][A-Z0-9/\-.]*)/i),
    isProforma: /PRO\s*FORMA/i.test(text),
    // « Date de la facture », « Date de facturation », « Date de l'avoir ».
    date: date(/Date\s+de\s+(?:la\s+|l')?(?:factur\w*|avoir)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    dueDate: date(/Date\s+d'échéance\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    // « Origine » chez JoshNoa et Levest, « Source » chez LIPS et Cloud Vapor.
    orderRefOnDoc: grab(/(?:Origine|Source)\s*:?\s+(\S+)/i),
    // Celui-ci reste sur le texte d'origine : à plat, la capture avalerait
    // l'étiquette suivante (« Transfert bancaire À régler avant le… »).
    statedPaymentMethod: grab(/Mode de paiement\s*:?\s*\n\s*([^\n]+)/i, 1, text),
    totalHt: amount(/Montant (?:hors taxes|HT)\s+([-\d  .,]+)\s*€/i),
    totalTva: amount(/^TVA\s+[\d.,]+\s*%\s+([-\d  .,]+)\s*€/im),
    totalTtc: amount(/^Total\s+([-\d  .,]+)\s*€/im),
    payments,
  };
}

function parseInvoice(text) {
  const header = parseHeader(text);
  const lines = [];
  const warnings = [];

  let buffer = '';
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (isNoise(line)) {
      buffer = '';
      continue;
    }

    // Un montant en euros ferme un article. Tant qu'il n'apparaît pas, on
    // accumule : la désignation, la quantité et le prix peuvent être répartis
    // sur trois lignes (LIPS).
    if (!/€\s*$/.test(line)) {
      buffer = buffer ? `${buffer} ${line}` : line;
      continue;
    }

    const block = (buffer ? `${buffer} ${line}` : line).replace(/€\s*$/, '').trim();
    const lectures = trailingNumbers(block);
    let nums = lectures[0];
    let read = null;
    for (const candidate of lectures) {
      const r = readColumns(candidate);
      if (r) { nums = candidate; read = r; break; }
    }

    if (!read) {
      if (nums.length >= 2) {
        warnings.push({ type: 'unreadable_row', text: block.slice(0, 200) });
      }
      buffer = '';
      continue;
    }

    // Retirer les colonnes pour ne garder que la référence et la désignation.
    const { ref, label } = splitRef(stripColumns(block));

    lines.push({
      ref,
      label,
      qty: read.qty,
      lineTotalHt: read.total,
      unitPriceNet: read.unitPriceNet,
      discountPercent: read.discountPercent || 0,
      kind: classify(ref, label),
    });
    buffer = '';
  }

  // Un avoir imprime ses montants en positif mais vient en déduction : on le
  // stocke en négatif (cf. add_supplier_invoices.sql), pour que les imputations
  // sur un règlement groupé restent de simples additions.
  if (header.isCreditNote) {
    for (const l of lines) l.lineTotalHt = -l.lineTotalHt;
    for (const k of ['totalHt', 'totalTva', 'totalTtc']) {
      if (header[k] != null) header[k] = -header[k];
    }
    for (const p of header.payments || []) p.amount = -p.amount;
  }

  // Réconciliation : la somme des lignes doit retomber sur le total imprimé.
  const sum = round2(lines.reduce((s, l) => s + l.lineTotalHt, 0));
  if (header.totalHt != null && Math.abs(sum - header.totalHt) > 0.02) {
    warnings.push({
      type: 'total_mismatch',
      message:
        `Les ${lines.length} lignes lues totalisent ${sum.toFixed(2)} € HT, ` +
        `la facture ${header.totalHt.toFixed(2)} € (écart ${(sum - header.totalHt).toFixed(2)} €).`,
    });
  }

  return { ...header, lines, warnings };
}

/** Retire de la droite les jetons de colonne, pour ne garder que le libellé. */
function stripColumns(block) {
  const tokens = block.trim().split(/\s+/);
  let i = tokens.length - 1;
  while (i >= 0 && (DECOR.test(tokens[i]) || NUM_ONLY.test(tokens[i]))) i -= 1;
  return tokens.slice(0, i + 1).join(' ');
}

module.exports = { parseInvoice, trailingNumbers, readColumns };
