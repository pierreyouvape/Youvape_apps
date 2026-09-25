/**
 * Factures OpenSi — LCA Distribution, LVP Distribution, GFC Provap.
 *
 * Les trois éditent depuis le même logiciel : même en-tête (« Facture N° »,
 * « Réf. Commande »), même pied (« Total HT / TVA / TTC », « Mode de règlement »),
 * mais PAS les mêmes colonnes :
 *
 *   LCA  Référence | Désignation | Quantité | PU HT | Rist. % | PU Net HT | Montant HT
 *   LVP  Référence | Désignation | Quantité | PU HT | Montant HT
 *   GFC  Référence | Désignation | Code barre | Quantité | PU HT | Montant HT
 *
 * Et surtout, le texte extrait du PDF ne respecte pas les lignes du tableau : une
 * désignation longue passe à la ligne, et les chiffres se retrouvent seuls sur la
 * suivante. Le parseur de l'import (`lcaParser.parseFacture`) exigeait tout sur
 * une seule ligne — il ne lisait donc AUCUNE ligne de la facture F2609412942.
 *
 * D'où la méthode retenue, indépendante du nombre de colonnes : on accumule le
 * texte, et dès qu'une fin de ligne porte une suite de nombres, on essaie de la
 * lire comme un article. Ce qui tranche, c'est l'ARITHMÉTIQUE — une combinaison
 * n'est retenue que si `quantité × prix = montant`. L'égalité s'auto-valide, donc
 * le gabarit n'a pas besoin d'être connu à l'avance (même principe que
 * `findUnparsedRows`, qui garde l'import depuis le 31/08/2026).
 *
 * Ce qui échoue à cette vérification n'est pas avalé : il part dans `warnings`.
 *
 * La référence renvoyée est le PREMIER mot du bloc. Chez LVP elle contient
 * parfois des espaces (« NV cartouche feelin 2 3ml ») : on ne devine pas où elle
 * s'arrête, c'est `resolveCompleteSkus()` (pdfImportModel) qui la reconstitue
 * ensuite à partir des réfs connues du fournisseur. Ne pas dupliquer ici.
 */

const EPSILON = 0.02;

/** Un nombre du tableau : entier, ou décimal avec séparateur de milliers espace. */
const NUM = String.raw`\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const TRAILING_NUMBERS = new RegExp(String.raw`((?:${NUM})(?:\s+(?:${NUM}))*)\s*$`);

const toNumber = (s) => parseFloat(String(s).replace(/[  ]/g, '').replace(',', '.'));
const round2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, eps = EPSILON) => Math.abs(a - b) <= eps;

/** Lignes de gabarit à ne jamais confondre avec un article. */
const NOISE = [
  /^Page\s+\d+\s*\/\s*\d+/i,
  /^Sous-total/i,
  /^Référence\s+Désignation/i,
  /^Base HT/i,
  /^Total\s+(HT|TVA|TTC)/i,
  /^Montant HT/i,
  /^Remise\s*:/i,
  /^Date d'échéance/i,
  /^Mode de règlement/i,
  /^N°\s*(TVA|SIREN)/i,
  /^Facture N°/i,
  /^Client N°/i,
  /^Réf\.\s/i,
  /^N° Commande/i,
  /^Interlocuteur/i,
  /^Code\(s\) promo/i,
  /^INCOTERM/i,
  /RCS\s|SARL au capital|SAS au capital|Code NAF/i,
  /^IBAN|^BIC/i,
  /réserve de propriété|intérêt de retard|escompte/i,
  /^Facture acquittée/i,
  /^Option pour le paiement/i,
  /^Aucun (escompte|SAV)/i,
];
const isNoise = (line) => NOISE.some((re) => re.test(line.trim()));

/**
 * Interprète une suite de nombres comme (quantité, prix unitaire net, montant).
 * Renvoie null si aucune lecture ne vérifie `quantité × prix = montant`.
 *
 * Les gabarits possibles, du plus précis au plus général :
 *   5 nombres  qté, PU, rist %, PU net, montant        (LCA remisé)
 *   4 nombres  qté, PU, PU net, montant                (LCA sans remise)
 *   4 nombres  code-barres, qté, PU, montant           (GFC)
 *   3 nombres  qté, PU, montant                        (LVP)
 */
function readNumbers(nums) {
  const n = nums.length;
  const last = nums[n - 1];

  const check = (qty, price, discountPercent = 0) =>
    Number.isInteger(qty) && qty > 0 && near(round2(qty * price), round2(last))
      ? { qty, unitPriceNet: price, total: round2(last), discountPercent }
      : null;

  if (n === 5) {
    // qté, PU brut, remise %, PU net, montant.
    // Deux lectures à tenter, et la seconde n'est pas un luxe : LCA imprime le PU
    // net ARRONDI (5,43 €) mais facture le net exact (6,46 − 16 % = 5,42640 €).
    // Sur 30 pièces, 30 × 5,43 = 162,90 € alors que la facture dit 162,79 €.
    // N'essayer que le PU imprimé ferait échouer la lecture de toute ligne
    // remisée — et la ligne perdue irait se coller à l'article suivant.
    const r = check(nums[0], nums[3], nums[2]);
    if (r) return r;
    const net = nums[1] * (1 - nums[2] / 100);
    const viaDiscount = check(nums[0], net, nums[2]);
    if (viaDiscount) return { ...viaDiscount, unitPriceNet: nums[3] };
  }
  if (n === 4) {
    // LCA sans remise : le PU est répété (PU HT puis PU Net HT)
    if (near(nums[1], nums[2])) {
      const r = check(nums[0], nums[2]);
      if (r) return r;
    }
    // GFC : le premier nombre est un code-barres (8 chiffres et plus)
    if (String(Math.trunc(nums[0])).length >= 8) {
      const r = check(nums[1], nums[2]);
      if (r) return r;
    }
    // Repli : les trois derniers nombres
    const r = check(nums[1], nums[2]);
    if (r) return r;
  }
  if (n === 3) {
    const r = check(nums[0], nums[1]);
    if (r) return r;
  }
  if (n === 2) {
    // Quantité et montant seuls (prix unitaire absent du gabarit)
    const qty = nums[0];
    if (Number.isInteger(qty) && qty > 0) {
      return { qty, unitPriceNet: round2(last / qty), total: round2(last), discountPercent: 0 };
    }
  }
  return null;
}

/** Sépare « réf reste-de-la-désignation » sur le premier blanc. */
function splitRef(buffer) {
  const text = buffer.replace(/\s+/g, ' ').trim();
  if (!text) return { ref: null, label: null };
  const space = text.indexOf(' ');
  if (space === -1) return { ref: text, label: null };
  return { ref: text.slice(0, space), label: text.slice(space + 1).trim() || null };
}

function parseHeader(text) {
  const grab = (re, i = 1) => {
    const m = text.match(re);
    return m ? m[i].trim() : null;
  };
  const date = (re) => {
    const m = text.match(re);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const amount = (re) => {
    const m = text.match(re);
    return m ? toNumber(m[1]) : null;
  };

  return {
    number: grab(/Facture\s+N°\s*:?\s*(\S+)/i),
    date: date(/Facture\s+N°[^\n]*?Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i)
       || date(/\bDate\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    dueDate: date(/Date d'échéance\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    // « Réf. Commande » est notre référence chez LCA et LVP ; chez GFC c'est le
    // numéro interne du fournisseur, qui ne retrouve aucune commande. On le
    // remonte quand même : c'est à l'écran de dire qu'il ne matche pas.
    orderRefOnDoc: grab(/Réf\.\s*Commande\s*:\s*(\S+)/i),
    statedPaymentMethod: grab(/Mode de règlement\s*:\s*([^\n]+)/i),
    totalHt: amount(/Total HT\s*:\s*([\d  .,]+)\s*€/i),
    totalTva: amount(/Total TVA\s*:\s*([\d  .,]+)\s*€/i),
    totalTtc: amount(/Total TTC\s*:\s*([\d  .,]+)\s*€/i),
    // Remise de pied (GFC : « Remise : 42.00 € »). Stockée en NÉGATIF, comme
    // toute ligne de remise (cf. invoiceCompare, règle 6).
    footerDiscount: (() => {
      const m = text.match(/^\s*Remise\s*:\s*([\d  .,]+)\s*€/im);
      return m ? -Math.abs(toNumber(m[1])) : null;
    })(),
  };
}

function parseInvoice(text) {
  const header = parseHeader(text);
  const lines = [];
  const warnings = [];

  let buffer = '';
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (isNoise(line)) {
      buffer = '';
      continue;
    }

    const tail = line.match(TRAILING_NUMBERS);
    if (!tail) {
      buffer += ' ' + line;
      continue;
    }

    const nums = tail[1].trim().split(/\s+/).map(toNumber).filter(Number.isFinite);
    const read = readNumbers(nums);
    const before = line.slice(0, line.length - tail[0].length);
    const block = (buffer + ' ' + before).trim();

    if (!read) {
      // Des chiffres en fin de ligne qui ne forment pas un article : soit du
      // texte qui en contient (une désignation « 10ml par 10 »), soit une ligne
      // de tableau qu'on ne sait pas lire.
      const numbersOnly = before.trim() === '';
      if (nums.length >= 3 && numbersOnly && buffer.trim()) {
        // Une ligne de chiffres SEULE qui ne se lit pas est une ligne d'article
        // perdue. On la signale, et surtout on repart à zéro : la laisser dans le
        // tampon collerait sa désignation — et donc SA référence — à l'article
        // suivant, qui repartirait avec la mauvaise réf et la mauvaise quantité.
        warnings.push({ type: 'unreadable_row', text: `${buffer.trim()} ${line.trim()}`.trim() });
        buffer = '';
        continue;
      }
      buffer += ' ' + line;
      continue;
    }

    const { ref, label } = splitRef(block);
    if (!ref) {
      buffer = '';
      continue;
    }

    lines.push({
      ref,
      label,
      qty: read.qty,
      lineTotalHt: read.total,
      unitPriceNet: read.unitPriceNet,
      discountPercent: read.discountPercent || 0,
      kind: 'product',
    });
    buffer = '';
  }

  if (header.footerDiscount) {
    lines.push({
      ref: null,
      label: 'Remise',
      qty: 1,
      lineTotalHt: header.footerDiscount,
      kind: 'discount',
    });
  }

  // Réconciliation : la somme des lignes doit retomber sur le total imprimé.
  // C'est le seul contrôle qui prouve qu'aucune ligne n'a été perdue.
  const sum = round2(lines.reduce((s, l) => s + l.lineTotalHt, 0));
  if (header.totalHt != null && !near(sum, header.totalHt, 0.02)) {
    warnings.push({
      type: 'total_mismatch',
      message:
        `Les ${lines.length} lignes lues totalisent ${sum.toFixed(2)} € HT, ` +
        `la facture ${header.totalHt.toFixed(2)} € (écart ${(sum - header.totalHt).toFixed(2)} €).`,
    });
  }

  return { ...header, lines, warnings };
}

module.exports = { parseInvoice, readNumbers };
