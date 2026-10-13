/**
 * Audit de parsing, commun à TOUS les fournisseurs.
 *
 * Module volontairement sans dépendance (ni base, ni pdf-parse) : il doit rester
 * testable seul, cf. tests/parsers.test.js.
 */

/**
 * Détecte les lignes produit PRÉSENTES dans le document mais ABSENTES du parsing.
 *
 * Une ligne perdue au parsing ne se voit nulle part : pas d'erreur, pas de total
 * incohérent (le total de repli est la somme des lignes… parsées, donc cohérent
 * par construction). C'est exactement ce qui est arrivé à la facture Revolute
 * FA020464 (REF2665, 60,00 € HT) et à la facture e.tasty FA072725 (54,40 € HT) :
 * le mobilier de saut de page s'était collé devant le 1er article de la page 2.
 *
 * Le contrôle ici est VOLONTAIREMENT indépendant du fournisseur et du parseur :
 * il relit le texte du document à la recherche de la signature arithmétique d'une
 * ligne de facture — « PRIX € QTÉ TOTAL € » avec QTÉ × PRIX = TOTAL. Cette
 * égalité s'auto-valide : une suite de nombres qui la vérifie est une vraie ligne,
 * pas du bruit. Toute signature qui ne correspond à aucune ligne parsée est
 * remontée à l'écran d'import.
 *
 * Prudence assumée (aucune fausse alerte) :
 * - on n'alerte que si AUCUNE ligne parsée n'a ce couple (prix, quantité) ;
 * - une même signature répétée dans le document (tableau récapitulatif) ne
 *   déclenche donc rien tant qu'elle a produit au moins une ligne.
 * Le prix de cette prudence : deux lignes strictement identiques dont une seule
 * est perdue passent au travers. Le cas est marginal, le silence total ne l'est pas.
 *
 * @returns {Array<{unit_price:number, qty:number, total:number, context:string}>}
 */
function findUnparsedRows(text, parsedItems, discountItems) {
  if (!text) return [];

  // « 1,36 € 40 54,40 € » — prix, quantité entière, total. Le séparateur décimal
  // peut être une virgule ou un point, le millier un espace (déjà normalisé).
  const rowSignature = /([\d]+(?:[.,]\d{1,2})?)\s*€\s+(\d{1,5})\s+([\d]+(?:\s\d{3})*(?:[.,]\d{1,2})?)\s*€/g;

  const num = (str) => parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));

  // Couples (prix, quantité) effectivement produits par le parseur.
  const parsedKeys = new Set();
  for (const it of [...(parsedItems || []), ...(discountItems || [])]) {
    const price = Number(it.unit_price_net != null ? it.unit_price_net : it.unit_price);
    const qty = Number(it.qty_ordered != null ? it.qty_ordered : 1);
    if (Number.isFinite(price) && Number.isFinite(qty)) {
      parsedKeys.add(`${Math.abs(price).toFixed(2)}x${qty}`);
    }
  }

  const orphans = [];
  const seen = new Set();
  let m;
  while ((m = rowSignature.exec(text)) !== null) {
    const price = num(m[1]);
    const qty = parseInt(m[2], 10);
    const total = num(m[3]);
    if (!Number.isFinite(price) || !Number.isFinite(total) || !qty) continue;
    if (price <= 0 || total <= 0) continue;

    // L'égalité arithmétique fait toute la fiabilité du contrôle : sans elle, on
    // ramasserait des nombres voisins qui ne forment pas une ligne.
    if (Math.abs(qty * price - total) > 0.02) continue;

    const key = `${price.toFixed(2)}x${qty}`;
    if (parsedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);

    // Contexte : le texte qui précède la signature, pour identifier l'article.
    const before = text.slice(Math.max(0, m.index - 120), m.index)
      .split('\n').filter((l) => l.trim().length > 0).slice(-2).join(' ')
      .replace(/\s+/g, ' ').trim();

    orphans.push({ unit_price: price, qty, total: Math.round(total * 100) / 100, context: before.slice(-90) });
  }

  return orphans;
}

/**
 * Contrôle croisé : les lignes produit que le parseur de FACTURE lit dans le même
 * document, mais que le parseur d'IMPORT n'a pas reprises.
 *
 * findUnparsedRows ne voit que les gabarits qui impriment « PRIX € QTÉ TOTAL € » :
 * il était aveugle chez GFC, LCA, LVP, LIPS, JoshNoa, Levest et Cloud Vapor. Or
 * chaque fournisseur a DEUX parseurs écrits indépendamment (import et contrôle
 * de facture) : qu'ils se contredisent sur un même document, c'est qu'un des
 * deux a perdu une ligne. Cas réels : GFC F2610427525 (Tank DotAIO V4, perdu à
 * l'import, retrouvé « Facturé, non commandé » au contrôle) et Cloud Vapor
 * INV/2025/04126 (page 2 entière perdue).
 *
 * Une ligne de facture est couverte par un article importé de même référence
 * (exacte, ou l'une préfixe de l'autre : les parseurs ne tronquent pas tous au
 * même endroit), à défaut de même montant de ligne. Chaque article ne couvre
 * qu'une ligne.
 *
 * @param {Array<{ref,label,qty,lineTotalHt,kind}>} invoiceLines lignes du parseur de facture
 * @param {Array} parsedItems articles du parseur d'import
 * @returns {Array<{unit_price:number, qty:number, total:number, context:string}>}
 */
function findLinesMissedByImport(invoiceLines, parsedItems) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s#[\]]/g, '');
  const pool = (parsedItems || []).map((i) => {
    const qty = Number(i.qty_ordered);
    const price = Number(i.unit_price_net != null ? i.unit_price_net : i.unit_price);
    const total = Number.isFinite(Number(i.total_ht)) && i.total_ht != null ? Number(i.total_ht) : qty * price;
    return { ref: norm(i.supplier_sku), total, used: false };
  });

  const missed = [];
  for (const line of invoiceLines || []) {
    if ((line.kind || 'product') !== 'product') continue;
    const ref = norm(line.ref);
    const total = Number(line.lineTotalHt);
    const free = pool.filter((p) => !p.used);
    const hit =
      (ref && free.find((p) => p.ref === ref)) ||
      (ref.length >= 4 && free.find((p) => p.ref.length >= 4 && (p.ref.startsWith(ref) || ref.startsWith(p.ref)))) ||
      (Number.isFinite(total) && free.find((p) => Math.abs(p.total - total) <= 0.05));
    if (hit) { hit.used = true; continue; }

    const qty = Number(line.qty) || 1;
    missed.push({
      unit_price: Math.round((total / qty) * 10000) / 10000,
      qty,
      total: Math.round(total * 100) / 100,
      context: [line.ref, line.label].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 90),
    });
  }
  return missed;
}

module.exports = { findUnparsedRows, findLinesMissedByImport };
