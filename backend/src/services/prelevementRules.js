/**
 * Prélèvements boutique — règles pures (testées : tests/prelevement.test.js).
 */

const { boutiquePack } = require('../utils/boutiquePack');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const round4 = (n) => Math.round(Number(n) * 10000) / 10000;

/** Coût d'achat HT d'une pièce du site : même règle que la valeur de stock. */
const siteUnitCost = (p) => {
  const c = Number(p.computed_cost ?? p.wc_cog_cost);
  return Number.isFinite(c) && c > 0 ? round4(c) : null;
};

/**
 * Pièces boutique pour `qty` pièces du site. Les résistances se vendent à
 * l'unité en boutique quand le site les vend en « Pack N » (boutiquePack).
 */
const boutiqueQty = (qty, siteTitle, nxProduct) => qty * boutiquePack(1, siteTitle, nxProduct).pack;

/**
 * Fiche Nextore créée depuis un produit du site. Prix boutique = prix normal du
 * site (sans remise WDR ni promo), cost = coût d'achat HT. Une seule pièce
 * boutique = une pièce site (une résistance en pack se crée au pack).
 */
const nextoreProductPayload = (p, { categoryId, barcodes, taxRate = '4' }) => {
  const price = Number(p.regular_price) > 0 ? Number(p.regular_price) : Number(p.price);
  if (!(price > 0)) throw Object.assign(new Error('Produit sans prix de vente sur le site : impossible de le créer dans la caisse.'), { statusCode: 400 });
  if (!categoryId) throw Object.assign(new Error('Choisissez une catégorie caisse.'), { statusCode: 400 });
  const cost = siteUnitCost(p);
  return {
    name: String(p.name || '').slice(0, 255),
    price: round2(price),
    ...(cost ? { cost: round2(cost) } : {}),
    category_id: String(categoryId),
    tax_rate: taxRate,
    type: 'standard',
    ...(barcodes.length ? { barcode: barcodes.join(';') } : {}),
    ...(p.wp_product_id ? { link_code: String(p.wp_product_id) } : {}),
  };
};

/** Codes-barres Nextore d'une fiche (champ unique, séparés par « ; »). */
const splitBarcodes = (v) => String(v || '').split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);

/** Codes à ajouter à une fiche Nextore : ceux du site qu'elle n'a pas. */
const barcodesToAdd = (nxBarcode, siteBarcodes) => {
  const have = new Set(splitBarcodes(nxBarcode));
  return [...new Set(siteBarcodes)].filter((b) => b && !have.has(b));
};

/**
 * Produit caisse d'un produit du site : lien enregistré d'abord, sinon UN seul
 * produit Nextore portant un de ses codes-barres. Plusieurs : on ne choisit pas.
 */
const resolveNx = (link, eanMatches) => {
  if (link) return { nxProductId: link.nx_product_id, how: link.source };
  const ids = [...new Set(eanMatches)];
  if (ids.length === 1) return { nxProductId: ids[0], how: 'ean' };
  return { nxProductId: null, how: ids.length > 1 ? 'ambiguous' : 'none', candidates: ids };
};

/** Une erreur d'API qui n'a rien écrit (refus net) : on peut renvoyer sans risque. */
const isCleanRefusal = (msg) => /HTTP 4\d\d|BMS API error: 4\d\d|Too Many Attempts/i.test(String(msg || ''));

/**
 * SQL : le code-barres `b` n'est porté que par CE produit du site. Un code sur
 * plusieurs produits (erreur de saisie : 13 codes / 26 produits au 10/11/2026,
 * « Sweet Cream » et « Green Dragon » sous le même EAN) ne prouve rien : il ne
 * sert ni à rattacher, ni n'est envoyé à une fiche caisse.
 */
const uniqueSiteBarcodeSql = (b = 'b') => `NOT EXISTS (
  SELECT 1 FROM product_barcodes ob JOIN products op ON op.id = ob.product_id
   WHERE ob.barcode = ${b}.barcode AND ob.product_id <> ${b}.product_id AND op.wc_deleted_at IS NULL)`;

module.exports = {
  uniqueSiteBarcodeSql,
  siteUnitCost, boutiqueQty, nextoreProductPayload, splitBarcodes, barcodesToAdd, resolveNx, isCleanRefusal, round2,
};
