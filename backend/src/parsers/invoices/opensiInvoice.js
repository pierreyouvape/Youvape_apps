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

const { numberReadings } = require('../../utils/invoiceNumbers');

const EPSILON = 0.02;

/** Un nombre du tableau : entier, ou décimal avec séparateur de milliers espace. */
const NUM = String.raw`\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
// Le `(?:^|\s)` n'est pas décoratif : sans lui, l'expression peut commencer AU
// MILIEU d'un mot. Sur l'avoir GFC, la désignation « … Melo EC2 0,30 3 0.03
// 0.09 » livrait le « 2 » de « EC2 » comme première colonne — cinq nombres au
// lieu de quatre, plus aucune lecture ne tombait juste, et la ligne disparaissait
// sans un mot. Seule la réconciliation du total l'a trahie (0,09 € manquants).
const TRAILING_NUMBERS = new RegExp(String.raw`(?:^|\s)((?:${NUM})(?:\s+(?:${NUM}))*)\s*$`);

const toNumber = (s) => parseFloat(String(s).replace(/[  ]/g, '').replace(',', '.'));
const round2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, eps = EPSILON) => Math.abs(a - b) <= eps;

/** Lignes de gabarit à ne jamais confondre avec un article. */
const NOISE = [
  /^Page\s+\d+\s*\/\s*\d+/i,
  /^Avoir N°/i,
  /^Proforma N°/i,
  /^F\s+A\s+C\s+T\s+U\s+R\s+E\b/i,
  /^A\s+V\s+O\s+I\s+R\b/i,
  /^Avoir constitué/i,
  /^Facture d['’]origine/i,
  /^Sous-total/i,
  /^Référence\s+Désignation/i,
  /^Base HT/i,
  // La ligne de VALEURS du pied de TVA : « 5 042.51 20.00 % 1 008.50 ».
  /^[\d  .,]+\s+[\d.,]+\s*%\s+[\d  .,]+$/,
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
 * Ligne d'attribut d'une déclinaison, imprimée SOUS les montants de son article.
 * Proforma GFC P26111102 :
 *
 *     Coils Bonza Pro … (10pcs) - Thunder Cloud x Vaping Bogan - 1394337100465 10 2.10 21.00
 *     Valeur : 0.23 ohm                          ← la fin de SA désignation
 *     GFC22120 Vape Band Rouge …                 ← le vrai article suivant
 *
 * Laissé au tampon, « Valeur » devenait la référence du Vape Band Rouge, qui ne
 * retrouvait plus sa ligne de commande. Liste fermée des attributs OpenSi : une
 * référence ne commence jamais par l'un d'eux suivi de « : ».
 */
const ATTRIBUT_DECLINAISON = /^(Couleur|Valeur|Taille|Nicotine|Saveurs?|Contenance|R[ée]sistance|Mod[èe]le|Format|Taux)\s*:/i;

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

  // Code-barres devant la quantité : LCA l'imprime depuis F2611423428
  // (11/11/2026) — « 3760230720792 30 1.32 1.32 39.60 », ou six nombres avec
  // la remise. Aucun gabarit ne commençait par lui : zéro ligne lue. Le
  // DERNIER nombre à 8 chiffres et plus marque le début du tableau ; ce qui le
  // suit se lit comme une ligne LCA sans code-barres (ou LVP).
  if (n >= 5) {
    let anchor = -1;
    for (let i = 0; i < n - 3; i++) {
      if (Number.isInteger(nums[i]) && String(nums[i]).length >= 8) anchor = i;
    }
    if (anchor !== -1) {
      const r = readNumbers(nums.slice(anchor + 1));
      if (r) return r;
    }
  }

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
  // GFC dont la désignation finit par un nombre isolé : « Ciseaux multi-usages
  // 1433 80000000121 3 1.10 3.30 » (F2610429600) fait 5 nombres, la lecture LCA
  // échouait, et la ligne se collait à l'article suivant (3,30 € perdus). Le
  // code-barres en 4e position avant la fin dit où commence le tableau.
  if (n >= 5 && String(Math.trunc(nums[n - 4])).length >= 8) {
    const r = check(nums[n - 3], nums[n - 2]);
    if (r) return r;
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
  // Pas de lecture à deux nombres : « quantité + montant » est une signature
  // trop faible, qui transformait le pied de page « … 20.00 % 1 008.50 » en
  // article de 1 × 8,50 €. Aucun des trois gabarits OpenSi n'en a besoin.
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
  // Un avoir s'annonce « Avoir N° … » et imprime ses montants en POSITIF. On le
  // reconnaît ici ; le signe est inversé à la sortie (cf. parseInvoice).
  const isCreditNote = /^\s*Avoir\s+N°/im.test(text) || /^A\s+V\s+O\s+I\s+R\s*$/im.test(text);
  // Une proforma (GFC, paiement par virement AVANT expédition) a le gabarit
  // d'une facture, sans « Réf. Commande ». Elle se contrôle comme une facture —
  // c'est le moment de faire corriger un tarif, avant de payer — mais n'est pas
  // une dette : la facture définitive suivra (cf. listUnpaid).
  const isProforma = !isCreditNote
    && (/^\s*Proforma\s+N°/im.test(text) || /^F\s+A\s+C\s+T\s+U\s+R\s+E\s+P\s+R\s+O\s+F\s+O\s+R\s+M\s+A\s*$/im.test(text));
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
    isCreditNote,
    isProforma,
    docType: isCreditNote ? 'credit_note' : (isProforma ? 'proforma' : 'invoice'),
    number: grab(/(?:Facture|Avoir|Proforma)\s+N°\s*:?\s*(\S+)/i),
    date: date(/(?:Facture|Avoir|Proforma)\s+N°[^\n]*?Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i)
       || date(/\bDate\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    dueDate: date(/Date d'échéance\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i),
    // « Réf. Commande » est notre référence chez LCA et LVP ; chez GFC c'est le
    // numéro interne du fournisseur, qui ne retrouve aucune commande. On le
    // remonte quand même : c'est à l'écran de dire qu'il ne matche pas.
    // Une proforma n'en a pas : son propre numéro, que l'import de commande a
    // pris comme numéro de commande (gfcParser), retrouve la commande.
    orderRefOnDoc: grab(/Réf\.\s*Commande\s*:\s*(\S+)/i)
      || (isProforma ? grab(/Proforma\s+N°\s*:?\s*(\S+)/i) : null),
    // Un avoir LCA ne porte pas de « Réf. Commande », mais la facture qu'il
    // corrige : « Facture d'origine : F2610418127 » (A2611421302). C'est par
    // elle qu'on retrouve la commande (cf. analyseInvoice), et c'est elle que
    // l'avoir éteint (cf. AVOIR_DESIGNE_SQL) — même rôle que l'« Extourne de »
    // de JoshNoa.
    correctsInvoice: isCreditNote ? grab(/Facture d['’]origine\s*:\s*([A-Z]*\d+)/i) : null,
    // Sur une page qui continue, le « Sous-total HT » suit sur la même ligne.
    statedPaymentMethod: (grab(/Mode de règlement\s*:\s*([^\n]+)/i) || '').split(/\s+Sous-total/i)[0].trim() || null,
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
  // Une désignation peut DÉBORDER APRÈS sa ligne de montants. Sur la facture LVP
  // F2609287455 :
  //
  //     0mg - Saveurs : Mango Passion 5 7.70 38.50   ← l'article est émis ici
  //     Fruit + Watermelon Mango Peach)              ← la fin de SA désignation
  //     VP Pod luxe xr DTL Cartouches Luxe X/ XR…    ← le vrai article suivant
  //
  // Le fragment orphelin se collait en tête du bloc suivant, dont il devenait la
  // référence : « Fruit » au lieu de « VP Pod luxe xr DTL ». L'article ne
  // retrouvait plus sa commande, et 26,60 € de Vaporesso échappaient à l'assiette
  // de la remise RSPV20.
  //
  // La parenthèse ouverte et non refermée le trahit : c'est un signe qui se
  // vérifie, pas une devinette sur la casse ou la ponctuation.
  let attenteFermeture = false;
  // Vrai juste après l'émission d'un article : la ligne suivante peut encore
  // lui appartenir (cf. ATTRIBUT_DECLINAISON).
  let articleEmis = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (isNoise(line)) {
      buffer = '';
      attenteFermeture = false;
      articleEmis = false;
      continue;
    }

    const suiteAttribut = articleEmis && !buffer.trim() && ATTRIBUT_DECLINAISON.test(line.trim());
    articleEmis = false;
    if (suiteAttribut && !TRAILING_NUMBERS.test(line.trim().replace(/^[^:]*:/, ''))) {
      const precedente = lines[lines.length - 1];
      precedente.label = `${precedente.label || ''} ${line.trim()}`.trim();
      continue;
    }

    if (attenteFermeture) {
      attenteFermeture = false;
      // Suite de la désignation précédente, et seulement si elle ne porte pas
      // elle-même de montants — sinon c'est un article, pas une suite.
      const ferme = line.indexOf(')');
      if (ferme !== -1 && !TRAILING_NUMBERS.test(line)) {
        const precedente = lines[lines.length - 1];
        if (precedente) {
          precedente.label = `${precedente.label || ''} ${line.slice(0, ferme + 1).trim()}`.trim();
        }
        const reste = line.slice(ferme + 1).trim();
        if (!reste) continue;
        buffer = reste;
        continue;
      }
    }

    const tail = line.match(TRAILING_NUMBERS);
    if (!tail) {
      buffer += ' ' + line;
      continue;
    }

    // Deux lectures possibles quand un nombre porte un séparateur de milliers
    // (« 1 008.50 ») : on retient celle dont l'arithmétique tombe juste.
    const tokens = tail[1].trim().split(/\s+/);
    const lectures = numberReadings(tokens);
    // Code-barres à zéros de tête : « 00002530 6 5.50 5.50 33.00 » (F2611423443).
    // Converti en nombre, il devient 2530 — 4 chiffres, plus reconnu comme
    // code-barres par readNumbers. La ligne Dictator n'était pas lue, et sa
    // désignation se collait au Macaron suivant, qui prenait sa référence.
    // C'est donc le JETON imprimé qui compte : 8 chiffres et plus, suivi d'au
    // moins trois nombres. Sa lecture passe en premier.
    let code = -1;
    for (let i = 0; i < tokens.length - 3; i++) {
      if (/^\d{8,}$/.test(tokens[i])) code = i;
    }
    if (code !== -1) lectures.unshift(...numberReadings(tokens.slice(code + 1)));
    let nums = lectures[0];
    let read = null;
    for (const candidate of lectures) {
      const r = readNumbers(candidate);
      if (r) { nums = candidate; read = r; break; }
    }
    const before = line.slice(0, tail.index);
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
    articleEmis = true;
    // Parenthèse ouverte et jamais refermée : la désignation continue à la ligne
    // suivante, au-delà des montants.
    const ouvertes = (label || '').split('(').length - 1;
    const fermees = (label || '').split(')').length - 1;
    attenteFermeture = ouvertes > fermees;
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

  // UN AVOIR EST UNE FACTURE AU SIGNE INVERSÉ. Le document imprime des montants
  // positifs (« Total HT : 278,88 € » sur un avoir LCA), mais un avoir vient en
  // déduction : il est stocké en négatif, pour que les sommes et les imputations
  // sur un règlement groupé restent de simples additions (cf. la migration
  // add_supplier_invoices.sql). On inverse ici, une fois, au plus près du document.
  if (header.isCreditNote) {
    for (const l of lines) l.lineTotalHt = -l.lineTotalHt;
    for (const k of ['totalHt', 'totalTva', 'totalTtc']) {
      if (header[k] != null) header[k] = -header[k];
    }
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
