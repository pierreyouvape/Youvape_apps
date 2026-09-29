/**
 * Factures PrestaShop — Cosmer/Revolute, Highbuy, Curieux, CigAccess,
 * e.tasty, MG Vape, Pulp (Sunny Smoker).
 *
 * Sept fournisseurs, un même gabarit, et une différence de fond avec les deux
 * autres familles : ici LE PRIX PRÉCÈDE LA QUANTITÉ. La ligne se termine par
 * « … prix qté total € », là où OpenSi et Odoo annoncent la quantité d'abord.
 * Lire les colonnes dans le mauvais ordre ne lève aucune erreur — ça donne des
 * quantités et des prix intervertis, donc des écarts inventés de toutes pièces.
 *
 * Trois choses qu'aucun des deux autres gabarits n'imposait :
 *
 * 1. UN ARTICLE PEUT CONTENIR PLUSIEURS MONTANTS EN EUROS. Pulp imprime dans la
 *    même cellule le prix net, le prix barré et l'écotaxe :
 *        0 % 1,03 €
 *        -30% 1,47 €
 *        80 82,40 €
 *    On ne peut donc pas clore un article au premier « € » rencontré. On tente
 *    la lecture à chaque fois, et on continue d'accumuler tant qu'elle ne tombe
 *    pas juste.
 *
 * 2. LE PRIX N'EST PAS TOUJOURS L'AVANT-DERNIER NOMBRE. Selon le fournisseur,
 *    la cellule contient le prix seul, un prix de base ET un prix remisé, ou
 *    encore un prix barré et une écotaxe. Plutôt que d'énumérer les gabarits,
 *    on prend la quantité (juste avant le total) puis on REMONTE à la recherche
 *    du prix qui vérifie `quantité × prix = total`. L'arithmétique tranche.
 *
 * 3. MG VAPE INTERCALE DES TITRES DE RAYON (« MPV », « Candy Shake ») entre les
 *    articles, et coupe les références longues en deux lignes. La référence est
 *    donc le premier mot du bloc QUI CONTIENT UN CHIFFRE — un titre de rayon
 *    n'en a jamais — et un fragment purement numérique qui la suit est recollé
 *    (« MPV-ACC-21 » + « 700-5000 »).
 */

const { numberReadings } = require('../../utils/invoiceNumbers');

const NUM = String.raw`-?\d{1,3}(?:[  ]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?`;
const NUM_ONLY = new RegExp(`^(?:${NUM})$`);

/**
 * Jetons traversés sans être lus. « écotaxe » et « : » en font partie : chez
 * Pulp ils s'intercalent entre le prix et la quantité, et s'arrêter là ferait
 * perdre le prix.
 */
const DECOR = /^(?:€|%|-?\d+(?:[.,]\d+)?%|écotaxe|:|TTC|HT)$/i;

const toNumber = (s) => parseFloat(String(s).replace(/[  ]/g, '').replace(',', '.'));
const round2 = (n) => Math.round(n * 100) / 100;

const NOISE = [
  /^(Numéro de facture|ID client)\b/i,
  /^Référence\s+Produit/i,
  /^Adresse de (livraison|facturation)/i,
  /^(Détail des taxes|Total|Taxe totale|Montant HT|Frais (de livraison|d'expédition))/i,
  /^(Mode|Moyen) de paiement/i,
  /^Date (de paiement|échéance)/i,
  /^Transporteur/i,
  /^Incoterm/i,
  /^Réductions?$/i,
  /^Powered by TCPDF/i,
  // Non ancré : chez Pulp la ligne est « Banque CIC - IBAN : FR76 3006 … », et
  // faute de la reconnaître elle restait dans le tampon pour se coller à
  // l'article de la page suivante. « FR76 » + « 3006 » devenaient la référence
  // « FR763006 », volant la sienne à un vrai article.
  /\b(RIB|IBAN|BIC)\b/i,
  /^Banque\b/i,
  /^Conditions générales/i,
  /^(Escompte|Loi LME|Indemnité|Intérêt de retard|RÉSERVÉ|RESERVE)/i,
  /^Pour toute assistance/i,
  /^Une version électronique/i,
  /^Vente intracommunautaire/i,
  /^Reste à régler/i,
  /^Pas de taxes/i,
  /SIRET|SIREN|TVA intracommunautaire|RCS\s/i,
];
const isNoise = (line) => NOISE.some((re) => re.test(line.trim()));

/** Nombres lus de droite à gauche, en traversant le décor. */
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
 * Quantité = le nombre juste avant le total. Prix = celui, plus à gauche, qui
 * vérifie `quantité × prix = total`. Renvoie null si aucun ne convient : c'est
 * le signal qu'il faut continuer d'accumuler (cellule Pulp sur trois lignes).
 */
function readColumns(nums) {
  if (nums.length < 3) return null;
  const total = nums[nums.length - 1];
  const qty = nums[nums.length - 2];
  if (!Number.isInteger(qty) || qty <= 0) return null;

  // Un demi-centime par unité : la borne d'un prix unitaire arrondi au centime.
  const tolerance = Math.max(0.02, qty * 0.005);
  for (let i = nums.length - 3; i >= 0; i -= 1) {
    const price = nums[i];
    if (Math.abs(round2(qty * price) - round2(total)) <= tolerance) {
      return { qty, unitPriceNet: price, total: round2(total) };
    }
  }
  // Ligne offerte : tout est à zéro, n'importe quel prix « convient ».
  if (round2(total) === 0 && nums.slice(0, -2).every((n) => n === 0)) {
    return { qty, unitPriceNet: 0, total: 0 };
  }
  return null;
}

/**
 * Référence : premier mot porteur d'un chiffre (les titres de rayon de MG Vape
 * n'en ont pas), suivi le cas échéant du fragment numérique qui la complète.
 */
function splitRef(block) {
  const tokens = block.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  // Une référence ne porte jamais de parenthèse. Sans ce garde-fou, le résidu de
  // désignation « : 00mg) » laissé par un saut de page devenait la référence de
  // la ligne suivante chez Curieux.
  const start = tokens.findIndex((t) => /\d/.test(t) && !/[()]/.test(t));
  if (start === -1) return { ref: null, label: tokens.join(' ') || null };

  let ref = tokens[start];
  let next = start + 1;
  // « MPV-ACC-21 » + « 700-5000 » : une référence coupée en fin de ligne. On ne
  // recolle QUE si le fragment commence par un chiffre et n'est fait que de
  // chiffres et de tirets, pour ne pas avaler un « --- » ou un mot.
  if (tokens[next] && /^\d[\d-]*$/.test(tokens[next]) && /\d$/.test(ref)) {
    ref += tokens[next];
    next += 1;
  }
  return { ref, label: tokens.slice(next).join(' ') || null };
}

function parseHeader(text) {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  // Ce gabarit ne savait pas reconnaître un avoir : les sept fournisseurs
  // PrestaShop auraient vu le leur rangé comme une facture, avec des montants
  // POSITIFS — donc une dette au lieu d'un crédit. Repéré à l'audit du
  // 28/09/2026, faute d'avoir un exemplaire sous la main.
  const isCreditNote = /^\s*AVOIR\b/im.test(text) || /\bAvoir\s+n°/i.test(flat);
  const amount = (re, source = text) => {
    const m = source.match(re);
    return m ? toNumber(m[1]) : null;
  };

  // La ligne de valeurs suit l'en-tête « Numéro de facture | Date de
  // facturation | Réf. de commande | … ». Son gabarit varie (MG Vape ajoute un
  // ID client en tête), mais la PREMIÈRE date y sépare toujours le numéro de
  // facture de la référence de commande. Une seule règle pour les sept.
  let number = null;
  let date = null;
  let orderRefOnDoc = null;
  const headerAt = flat.search(/Date de commande/i);
  if (headerAt !== -1) {
    // On repart APRÈS l'en-tête et on cherche la première date : ce qui la
    // précède est le numéro de facture, ce qui la suit la référence de
    // commande. MG Vape glisse un « ID client » en tête de ligne — chercher
    // par position l'aurait pris pour le numéro de facture.
    const after = flat.slice(headerAt + 'Date de commande'.length);
    const m = after.match(/(\S+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)/);
    if (m) {
      number = m[1];
      date = `${m[4]}-${m[3]}-${m[2]}`;
      orderRefOnDoc = m[5];
    }
  }

  const dueMatch = flat.match(/Date (?:d')?échéance[^:]*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);

  return {
    isCreditNote,
    docType: isCreditNote ? 'credit_note' : 'invoice',
    number,
    date,
    orderRefOnDoc,
    dueDate: dueMatch ? `${dueMatch[3]}-${dueMatch[2]}-${dueMatch[1]}` : null,
    // « Mode de paiement e-Transactions 2 046,12 € », « Moyen de paiement
    // Paiement AMEX 1 344,86 € » : le libellé est coincé entre l'étiquette et
    // le montant. Rappel : ce mode n'engage à rien, une facture marquée
    // « virement » part souvent en Amex groupé (cf. supplier_payments).
    statedPaymentMethod: (() => {
      const m = flat.match(/(?:Mode|Moyen) de paiement\s+(.+?)\s+[-\d  .,]+\s*€/i);
      return m ? m[1].trim() : null;
    })(),
    totalHt: amount(/Total \(?HT\)?\s+([-\d  .,]+)\s*€/i, flat),
    totalTva: amount(/(?:Total Taxes|Taxe totale)\s+([-\d  .,]+)\s*€/i, flat),
    totalTtc: amount(/Total \(?TTC\)?\s+([-\d  .,]+)\s*€/i, flat)
           ?? amount(/^Total\s+([-\d  .,]+)\s*€/im),
    // Remise de pied (Cosmer : « Total Réductions - 300,90 € »), stockée en
    // négatif comme toute remise globale.
    footerDiscount: (() => {
      const m = flat.match(/Total Réductions\s*-?\s*([\d  .,]+)\s*€/i);
      return m ? -Math.abs(toNumber(m[1])) : null;
    })(),
  };
}

/**
 * Retire le mobilier de saut de page, puis recolle ce qu'il séparait.
 *
 * Sur une facture Curieux de deux pages, la référence « SPE-MACA-50-00MG » est
 * coupée en « SPE- » en bas de page 1 et « MACA-50-00MG » en haut de page 2,
 * avec entre les deux : « 1 / 2 », « -- 1 of 2 -- », « FACTURE », la date et le
 * numéro de facture. Le recollage des mots coupés par un tiret (cleanPdfText)
 * ne peut rien faire tant que ces lignes s'intercalent.
 *
 * On ne retire que ce qui est certain : numérotation de page, mention « x of
 * y », et les lignes qui ne contiennent QUE la date ou le numéro déjà lus dans
 * l'en-tête. Retirer une ligne au jugé ferait disparaître un article.
 */
function stripPageFurniture(text, header) {
  const numero = header.number ? header.number.replace(/^#/, '') : null;
  const patterns = [
    /^\d{1,2}\s*\/\s*\d{1,2}$/,
    /^--\s*\d+\s+of\s+\d+\s*--$/i,
    /^(FACTURE|AVOIR)$/i,
    /^\d{2}\/\d{2}\/\d{4}$/,
  ];
  const lignes = text.split('\n').filter((raw) => {
    const l = raw.trim();
    if (!l) return true;
    if (numero && (l === numero || l === `#${numero}`)) return false;
    return !patterns.some((re) => re.test(l));
  });

  // Le mobilier retiré, les deux morceaux redeviennent voisins : on rejoue le
  // recollage sur tirets, exactement comme cleanPdfText le fait à l'ingestion.
  return rejoinRefSplitByPageBreak(
    lignes.join('\n').replace(/([A-Za-z0-9])-\n+\s*([A-Za-z0-9])/g, '$1-$2'),
  );
}

/**
 * Référence coupée en deux PAR le saut de page, à l'horizontale.
 *
 * Sur la facture Curieux #FA063171, la dernière ligne de la page 1 est :
 *
 *     SPE- SPEAKEASY - Mac Allister 50ml (Taux de nicotine 20 % 6,21 € 6 37,26 €
 *
 * et la page 2 s'ouvre par « MACA-50-00MG : 00mg) ». La référence
 * SPE-MACA-50-00MG est donc coupée, mais pas en fin de ligne : le reste de la
 * cellule (désignation ET montants) s'intercale entre ses deux moitiés, donc le
 * recollage sur tirets ci-dessus ne peut rien.
 *
 * Résultat sans réparation : deux lignes de 37,26 € portant les références
 * « 50ml » et « MACA-50-00MG », et donc quatre fausses anomalies — deux articles
 * facturés non commandés en face de deux commandés non facturés.
 *
 * On remonte donc la moitié orpheline, et on la retire de là où elle était.
 */
function rejoinRefSplitByPageBreak(text) {
  const lignes = text.split('\n');

  for (let i = 0; i < lignes.length; i += 1) {
    // Une tête de référence : majuscules, finie par un tiret, sans chiffre, et
    // suivie d'autre chose sur la même ligne (sinon ce n'est pas une coupure).
    const tete = lignes[i].trim().match(/^([A-Z][A-Z-]*-)\s+\S/);
    if (!tete) continue;

    // La moitié manquante ouvre l'une des lignes suivantes. On ne cherche pas
    // loin : au-delà, ce n'est plus la même cellule.
    for (let j = i + 1; j < Math.min(i + 4, lignes.length); j += 1) {
      const suite = lignes[j].trim().match(/^([A-Z0-9][A-Z0-9-]*)(\s|$)/);
      if (!suite) continue;

      const recollee = tete[1] + suite[1];
      // Une référence complète porte un chiffre et a du corps : sans ces deux
      // conditions on recollerait deux mots d'une désignation.
      if (!/\d/.test(recollee) || recollee.length < 6) break;

      lignes[i] = lignes[i].replace(tete[1], recollee);
      lignes[j] = lignes[j].replace(suite[1], '').trim();
      break;
    }
  }

  return lignes.join('\n');
}

function parseInvoice(rawText) {
  const header = parseHeader(rawText);
  const text = stripPageFurniture(rawText, header);
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

    const block = (buffer ? `${buffer} ${line}` : line).trim();
    let read = null;
    for (const candidate of trailingNumbers(block)) {
      read = readColumns(candidate);
      if (read) break;
    }

    if (!read) {
      // Rien de lisible pour l'instant : on GARDE le bloc. Une cellule Pulp
      // s'étale sur trois lignes, dont deux se terminent déjà par un montant.
      //
      // Mais un tampon qui enfle n'est plus une désignation : c'est du pied de
      // page qu'aucun filtre n'a reconnu, et il ira polluer l'article suivant.
      // Au-delà de 400 caractères, on repart de la dernière ligne seule.
      buffer = block.length > 400 ? line : block;
      continue;
    }

    const { ref, label } = splitRef(stripColumns(block));
    lines.push({
      ref,
      label,
      qty: read.qty,
      lineTotalHt: read.total,
      unitPriceNet: read.unitPriceNet,
      discountPercent: 0,
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

  // Un avoir vient en déduction : on le range en négatif, comme les deux autres
  // gabarits (cf. add_supplier_invoices.sql).
  if (header.isCreditNote) {
    for (const l of lines) l.lineTotalHt = -l.lineTotalHt;
    for (const k of ['totalHt', 'totalTva', 'totalTtc']) {
      if (header[k] != null) header[k] = -header[k];
    }
  }

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

module.exports = { parseInvoice, trailingNumbers, readColumns, splitRef };
