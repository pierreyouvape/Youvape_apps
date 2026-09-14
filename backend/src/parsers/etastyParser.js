/**
 * Parseur PDF pour e.tasty — gère DEUX formats distincts.
 *
 * 1) FACTURE (TCPDF, prix HT)
 *    Colonnes : Reference | Produit | TVA | Prix unitaire HT | Quantite | Total HT
 *    Prix sur une ligne : "20 % 4,40 € 10 44,00 €", ref type "SWDCO03000".
 *
 * 2) CONFIRMATION DE COMMANDE (email Gmail exporté en PDF)
 *    Colonnes : Reference | Produit | Prix unitaire | Quantite | Prix total
 *    Réf coupée sur plusieurs lignes ("INAZU01" puis "006"), goodies à 0 €,
 *    remises en pied de tableau, lignes à cheval sur deux pages : voir
 *    parseOrderConfirmation. N° de commande type "BIBAIERBM".
 *
 * Les deux formats : prix unitaire HT, quantités exprimées en UNITÉS
 * (→ invertPackQty : conversion unités↔packs déléguée à pdfImportModel).
 */

const parseDecimal = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

/**
 * Format FACTURE TCPDF (comportement historique, inchangé).
 */
function parseInvoice(text) {
  // Extraire ref commande et date : "#FA069087/2026 18/03/2026 ERWZBDFMZ 18/03/2026"
  const orderMatch = text.match(/#FA[\w/]+\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\S+)\s+\d{2}\/\d{2}\/\d{4}/);
  const orderNumber = orderMatch ? orderMatch[4] : null;
  const orderDate = orderMatch ? `${orderMatch[3]}-${orderMatch[2]}-${orderMatch[1]}` : null;

  const items = [];

  // Restreindre le scan au tableau produits : on commence APRES l'en-tete de
  // colonnes et on s'arrete AVANT le recapitulatif ("Detail des taxes").
  //
  // L'en-tete de la derniere colonne peut s'ecrire "Total HT", "Total (HT)" ou
  // etre coupe sur deux lignes ("Total\n(HT)"). Une ancre trop stricte (/Total HT/)
  // echouait sur ces variantes : startIdx retombait a 0 et le scan capturait
  // "FACTURE" (1er mot du document) comme reference du 1er produit. La 1re
  // occurrence de "Total (HT)" est bien l'en-tete (le "Total (HT)" du pied de
  // page arrive plus loin).
  const headerMatch = text.match(/Total\s*\(?\s*HT\s*\)?/i);
  const startIdx = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
  const footerIdx = text.search(/des taxes/i);
  // Saut de page TCPDF : entre deux lignes produit s'intercalent le numero de
  // page et l'en-tete de la page suivante ("FACTURE / date / #FAxxxx"). Le scan
  // prend alors "FACTURE" pour la reference du 1er article de cette page, que le
  // garde-fou plus bas ecarte : l'article entier disparaissait en silence
  // (ex. FA072725, NAT-VERT-10-6MG a 54,40 €). On retire ce mobilier de page.
  const scanText = text
    .slice(startIdx, footerIdx >= 0 ? footerIdx : text.length)
    .replace(/FACTURE\s*\n\s*\d{2}\/\d{2}\/\d{4}\s*\n\s*#FA[\w/]+/g, '\n')
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '\n')
    .replace(/^[^\S\n]*\d+[^\S\n]*\/[^\S\n]*\d+[^\S\n]*$/gm, '');

  // Scan : chaque bloc REF Designation TAUX% PRIX_UNIT€ QTE TOTAL€
  const pricePattern = /([A-Z0-9][\w]+)([\s\S]*?)(\d+)\s*%\s+([\d,]+)\s*€\s+(\d+)\s+([\d,]+)\s*€/g;

  let m;
  while ((m = pricePattern.exec(scanText)) !== null) {
    const supplierSku = m[1];
    const designation = m[2].replace(/\s+/g, ' ').trim();
    const prixUnit = parseDecimal(m[4]);
    const qty = parseInt(m[5]);
    const totalHt = parseDecimal(m[6]);

    // Verification coherence : qty * prix ~= total (evite les faux positifs)
    if (Math.abs(qty * prixUnit - totalHt) > 0.05) continue;

    // Garde-fou : "FACTURE" (mot d'en-tete du document) n'est jamais une
    // reference produit. Si l'ancre d'en-tete a echoue malgre tout, on ignore
    // cette pseudo-ligne plutot que de creer un mauvais mapping fournisseur.
    if (/^FACTURE$/i.test(supplierSku)) continue;

    items.push({
      supplier_sku: supplierSku,
      designation: designation,
      qty_ordered: qty,
      unit_price_net: prixUnit,
      total_ht: totalHt,
    });
  }

  // Total HT produits imprime sur la facture ("Total produits 1 365,36 €").
  // Garde-fou de reconciliation : si une ligne saute au parsing, la somme des
  // lignes ne colle plus a ce total et l'ecart est signale a l'envoi BMS.
  let invoiceProductTotalHT = null;
  const totalMatch = text.match(/Total\s+produits\s+([0-9][0-9  \u202f]*,\d{2})\s*€/);
  if (totalMatch) {
    const n = parseDecimal(totalMatch[1].replace(/[  \u202f]/g, ''));
    if (Number.isFinite(n) && n > 0) invoiceProductTotalHT = n;
  }

  return { orderNumber, orderDate, items, hasPrice: true, invertPackQty: true, invoiceProductTotalHT, invoiceProductTotalIsGross: true };
}

/**
 * Format CONFIRMATION DE COMMANDE (email Gmail exporté en PDF).
 *
 * Lecture LIGNE À LIGNE. Chaque ligne du tableau est une ligne de texte qui se
 * termine par l'un de ces motifs, et qui clôt la ligne de commande en cours :
 *   - produit payant : "PRIX € QTÉ TOTAL €"         ("Français 1,35 € 30 40,50 €")
 *   - goodies gratuit : "QTÉ 0,00 €" sans prix unitaire ("Goodies 270 0,00 €")
 *   - remise de pied de tableau : "LIBELLÉ -MONTANT €" ("PACK IMP 80 PRDS 50ML - HOUSE OF MAGIC 2026 -345,60 €")
 * Tout le texte qui précède (depuis la ligne précédente) appartient à la ligne.
 *
 * Mise en page Gmail (UOPZIWQDN, 11/09/2026) :
 * - la colonne Référence est étroite : la réf. est coupée sur 2 à 5 lignes
 *   ("HOBOIS0" + "1010"), imprimées AVANT la désignation ;
 * - quand une ligne de commande est à cheval sur deux pages, la réf. et la
 *   désignation partagent parfois la même ligne de texte, de part et d'autre du
 *   saut de page : "HOMAN0 MANGPOUFFLE 50ML - Taux" / -- 2 of 6 -- / "5000 de nicotine…".
 *   L'ancien parseur retenait "HOMAN0" : mauvaise réf., produit non reconnu ;
 * - la fin d'une ligne peut aussi basculer APRÈS le prix, en tête de la page
 *   suivante ("HOM-26 Goodies") : elle revient à la ligne précédente, pas à la suivante ;
 * - les goodies (PLV à 0,00 €) ne sont pas des produits : ignorés ;
 * - les remises (offres d'implantation) sont des lignes de pied de tableau
 *   → discountItems, contrôlées contre le récapitulatif « Réductions ».
 *
 * Contrôles (alertes rouges de l'écran d'import, voir `warnings`) :
 * - convention e.tasty : la réf. se termine par le taux de nicotine sur 3 chiffres
 *   (HOBOI01006 = 6 mg, HOMAN05000 = 0 mg, HOBOIS01020 = sels 20 mg) → une réf.
 *   qui ne colle pas au taux de la désignation est signalée ;
 * - réf. sans chiffre ou trop courte (morceau de réf.) ;
 * - réf. reconstituée sur un saut de page sans taux pour la valider ;
 * - somme des remises ≠ « Réductions » ; texte laissé orphelin en fin de tableau.
 * La somme des lignes est en outre réconciliée avec « Produits » (brut HT) par
 * pdfImportModel : une ligne perdue ou mal chiffrée ne peut pas passer en silence.
 */

// Marqueur de saut de page : surtout pas un blanc (\f), que trim() effacerait.
const PAGE = '<<saut de page>>';
// Fragment de référence : majuscules, chiffres, tirets, points, sans espace
// ("HOBOIS0", "1010", "-HOM-26", "GRATTE"). Une ligne de désignation contient
// toujours des espaces ou des minuscules.
const REF_FRAGMENT = /^[A-Z0-9-][A-Z0-9.-]*$/;
const AMOUNT = '\\d{1,3}(?: \\d{3})*,\\d{2}';
const PRICED_END = new RegExp(`(?:^|\\s)(${AMOUNT})\\s*€\\s+(\\d{1,5})\\s+(${AMOUNT})\\s*€\\s*$`);
const FREE_END = new RegExp(`(?:^|\\s)(\\d{1,5})\\s+0,00\\s*€\\s*$`);
const DISCOUNT_LINE = new RegExp(`^(.*?)\\s*-\\s?(${AMOUNT})\\s*€\\s*$`);
const SUMMARY_LINE = /^(?:Produits|R[ée]ductions|Paquet cadeau|Livraison|Incluant un total|Total pay)/i;

const isFragment = (el) => el !== PAGE && REF_FRAGMENT.test(el);
// Un morceau de réf. isolé en tête d'une ligne de texte mixte ("5000 de nicotine") :
// exige un chiffre ou un tiret, sinon "NICOTINE : 10mg" passerait pour une réf.
const leadingRefToken = (el) => {
  if (el === PAGE) return null;
  const token = el.split(' ')[0];
  return token !== el && REF_FRAGMENT.test(token) && /[0-9-]/.test(token) ? token : null;
};

/**
 * Début de la ligne de commande dans un bloc qui s'ouvre sur un saut de page :
 * dernière série de fragments de réf. (avec au moins un chiffre ou tiret) suivie
 * d'une désignation. Ce qui précède est la fin de la ligne précédente.
 */
function rowStartAfterPageBreak(els) {
  let start = -1;
  for (let i = 1; i < els.length; i++) {
    if (!isFragment(els[i]) || isFragment(els[i - 1])) continue;
    let j = i;
    while (j < els.length && isFragment(els[j])) j++;
    const run = els.slice(i, j).join('');
    if (/[0-9-]/.test(run) && j < els.length && els[j] !== PAGE) start = i;
  }
  return start;
}

/** Sépare référence et désignation d'un bloc de lignes. */
function splitRefAndDesignation(els) {
  let ref = '';
  let straddled = false;
  let fromMixedLine = false;
  const designation = [];
  let i = 0;

  // Fragments purs en tête (un saut de page au milieu de la réf. est transparent).
  while (i < els.length && (els[i] === PAGE || isFragment(els[i]))) {
    if (els[i] === PAGE) {
      if (ref) straddled = true;
    } else {
      ref += els[i];
    }
    i++;
  }

  // Pas de fragment pur : ligne à cheval sur deux pages, réf. et désignation
  // sur la même ligne de texte ("HOMAN0 MANGPOUFFLE 50ML - Taux").
  if (!ref && i < els.length) {
    const token = els[i].split(' ')[0];
    if (REF_FRAGMENT.test(token)) {
      ref = token;
      designation.push(els[i].slice(token.length).trim());
      fromMixedLine = true;
      i++;
    }
  }

  for (; i < els.length; i++) {
    if (els[i] !== PAGE) {
      designation.push(els[i]);
      continue;
    }
    // Suite de la réf. en tête de page, seulement si elle a été amorcée sur une
    // ligne mixte (une réf. e.tasty ne tient jamais sur une ligne de la colonne).
    if (!fromMixedLine) continue;
    while (i + 1 < els.length && isFragment(els[i + 1])) {
      ref += els[++i];
      straddled = true;
    }
    const token = i + 1 < els.length ? leadingRefToken(els[i + 1]) : null;
    if (token) {
      ref += token;
      designation.push(els[++i].slice(token.length).trim());
      straddled = true;
    }
    fromMixedLine = false;
  }

  return { ref, designation, straddled };
}

/** Anomalie de référence, ou null. */
function refAnomaly(sku, designation, straddled) {
  if (!sku) return 'référence illisible';
  if (!/\d/.test(sku) || sku.replace(/-/g, '').length < 8) return 'référence incomplète';
  const nicotine = [...designation.matchAll(/nicotine\s*:\s*(\d{1,2})(?!\d)/gi)].pop();
  if (nicotine) {
    const code = nicotine[1].padStart(3, '0');
    return sku.endsWith(code)
      ? null
      : `la référence ne se termine pas par ${code} (taux de nicotine ${parseInt(nicotine[1], 10)} de la désignation)`;
  }
  return straddled ? 'référence reconstituée de part et d\'autre d\'un saut de page' : null;
}

const pluralS = (n) => (n > 1 ? 's' : '');

function parseOrderConfirmation(text) {
  // Ex : "Numéro de commande : BIBAIERBM"
  const numMatch = text.match(/Num[ée]ro de commande\s*:\s*([A-Z0-9]+)/i);
  const orderNumber = numMatch ? numMatch[1] : null;

  // Ex : "Date de la commande : 23/07/2026 14:33:58"
  const dateMatch = text.match(/Date de la commande\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const orderDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  // Récapitulatif : total brut HT des produits et total des remises.
  const summaryAmount = (label) => {
    const m = text.match(new RegExp(`^${label}\\s+(${AMOUNT})\\s*€`, 'm'));
    return m ? parseDecimal(m[1]) : null;
  };
  const invoiceProductTotalHT = summaryAmount('Produits');
  const printedDiscounts = summaryAmount('R[ée]ductions');

  // Tableau : après l'en-tête de colonnes, jusqu'au récapitulatif.
  const header = text.match(/Prix total/i) || text.match(/D[ée]tail de votre commande/i);
  const zone = header ? text.slice(header.index + header[0].length) : text;
  const lines = zone
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, `\n${PAGE}\n`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows = [];
  const discountItems = [];
  const warnings = [];
  let pending = [];

  for (const line of lines) {
    if (line === PAGE) {
      pending.push(PAGE);
      continue;
    }
    if (SUMMARY_LINE.test(line)) break;

    const priced = line.match(PRICED_END);
    const free = !priced && line.match(FREE_END);
    const end = priced || free;
    if (end) {
      const prefix = line.slice(0, end.index).trim();
      if (prefix) pending.push(prefix);
      rows.push(priced
        ? { free: false, els: pending, price: parseDecimal(priced[1]), qty: parseInt(priced[2], 10), total: parseDecimal(priced[3]) }
        : { free: true, els: pending });
      pending = [];
      continue;
    }

    const discount = line.match(DISCOUNT_LINE);
    if (discount && (discount[1] || pending.some((e) => e !== PAGE))) {
      const label = discount[1] || pending.filter((e) => e !== PAGE).join(' ');
      discountItems.push({
        item_type: 'discount',
        product_name: label.replace(/\s+/g, ' ').trim(),
        unit_price: -parseDecimal(discount[2]),
        qty_ordered: 1,
      });
      pending = [];
      continue;
    }

    pending.push(line);
  }

  // Fin de ligne basculée en tête de page suivante → rendue à la ligne précédente.
  for (let r = 1; r < rows.length; r++) {
    const els = rows[r].els;
    if (els[0] !== PAGE) continue;
    const start = rowStartAfterPageBreak(els);
    if (start > 1) {
      const prev = rows[r - 1];
      prev.tail = els.slice(1, start);
      rows[r].els = els.slice(start);
    }
  }

  const items = [];
  const suspects = [];
  for (const row of rows) {
    if (row.free) continue; // goodies / PLV offerts

    const { ref, designation, straddled: refStraddled } = splitRefAndDesignation(row.els);
    let supplierSku = ref;
    let straddled = refStraddled;
    const tail = row.tail || [];
    let refOpen = true;
    for (const el of tail) {
      if (refOpen && isFragment(el)) {
        supplierSku += el;
        straddled = true;
        continue;
      }
      const token = refOpen ? leadingRefToken(el) : null;
      if (token) {
        supplierSku += token;
        designation.push(el.slice(token.length).trim());
        straddled = true;
      } else {
        designation.push(el);
      }
      refOpen = false;
    }

    const item = {
      supplier_sku: supplierSku,
      designation: designation.join(' ').replace(/\s+/g, ' ').trim(),
      qty_ordered: row.qty,
      unit_price_net: row.price,
      total_ht: row.total,
    };

    const anomaly = refAnomaly(item.supplier_sku, item.designation, straddled);
    if (Math.abs(row.qty * row.price - row.total) > 0.02) {
      suspects.push({ item, reason: `quantité × prix ≠ total imprimé (${row.total.toFixed(2)} €)` });
    } else if (anomaly) {
      suspects.push({ item, reason: anomaly });
    }

    // Sans référence, la ligne ne peut être ni reconnue ni associée : elle est
    // signalée ci-dessous (et fait diverger la réconciliation avec « Produits »).
    if (item.supplier_sku) items.push(item);
  }

  if (suspects.length > 0) {
    warnings.push({
      type: 'suspect_rows',
      message:
        `${suspects.length} ligne${pluralS(suspects.length)} du document à vérifier : ` +
        `référence ou montant peut-être mal lu${pluralS(suspects.length)} ` +
        `(coupure de colonne ou saut de page). Contrôlez-la${suspects.length > 1 ? 's' : ''} avant d'envoyer.`,
      rows: suspects.map(({ item, reason }) => ({
        context: `${item.supplier_sku || '(sans réf.)'} — ${reason} — ${item.designation}`.slice(0, 200),
        qty: item.qty_ordered,
        unit_price: item.unit_price_net,
        total: item.total_ht,
      })),
    });
  }

  const discountSum = Math.round(discountItems.reduce((s, d) => s - d.unit_price, 0) * 100) / 100;
  if ((printedDiscounts || 0) !== discountSum) {
    warnings.push({
      type: 'discount_mismatch',
      message:
        `Le document annonce ${(printedDiscounts || 0).toFixed(2)} € de réductions, ` +
        `mais ${discountItems.length} ligne${pluralS(discountItems.length)} de remise ` +
        `lue${pluralS(discountItems.length)} totalise${discountItems.length > 1 ? 'nt' : ''} ${discountSum.toFixed(2)} €.`,
    });
  }

  const leftover = pending.filter((e) => e !== PAGE);
  if (leftover.length > 0) {
    warnings.push({
      type: 'unparsed_text',
      message: `Texte non interprété en fin de tableau : « ${leftover.join(' ').slice(0, 160)} ». Une ligne manque peut-être.`,
    });
  }

  return {
    orderNumber,
    orderDate,
    items,
    discountItems,
    hasPrice: true,
    invertPackQty: true,
    invoiceProductTotalHT,
    invoiceProductTotalIsGross: invoiceProductTotalHT != null,
    warnings,
  };
}

module.exports = {
  parse: (text) => {
    // Le format "confirmation de commande" (email) est reconnaissable à ses
    // libellés uniques ; sinon on retombe sur le format facture TCPDF.
    if (/D[ée]tail de votre commande|Num[ée]ro de commande/i.test(text)) {
      return parseOrderConfirmation(text);
    }
    return parseInvoice(text);
  },
};
