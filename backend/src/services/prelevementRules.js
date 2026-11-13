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
const nextoreProductPayload = (p, { categoryId, barcodes, taxRate = '4', brand = null }) => {
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
    ...(brand ? { cf1: String(brand).slice(0, 100) } : {}),
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
 * Annulation d'un prélèvement (le client change d'avis, la pièce retourne au
 * site). Pour chaque étape : 'undo' = déjà faite, on envoie l'écriture inverse ;
 * 'cancel' = rien n'est parti, elle ne partira pas ; 'none' = rien à faire.
 * Refus (409) quand on ne sait pas si l'écriture est passée : envoi en cours,
 * ou erreur « VÉRIFIEZ » (réponse incertaine, serveur coupé pendant l'appel).
 * Une erreur sans « VÉRIFIEZ » est un refus net : rien n'a été écrit.
 */
const cancelPlan = (r) => {
  const refuse = (message) => { throw Object.assign(new Error(message), { statusCode: 409 }); };
  if (r.cancelled_at) refuse('Ce prélèvement est déjà annulé.');
  if (r.origin !== 'boutique') refuse('Reprise de l\'ancien « Vente boutique » : rien à annuler ici.');
  const plan = (status, error, what) => {
    if (status === 'queued' || status === 'waiting') return 'cancel';
    if (status === 'sent') return 'undo';
    if (status === 'skipped' || status === 'cancelled') return 'none';
    if (status === 'error' && !/VÉRIFIEZ/.test(String(error || ''))) return 'cancel';
    if (status === 'error') {
      return refuse(`${what} est en erreur « à vérifier ». Regardez d'abord si elle est passée : oui → « Fait à la main », non → « Réessayer » ; puis annulez.`);
    }
    return refuse(`${what} est en cours d'envoi : réessayez dans quelques secondes.`);
  };
  return {
    site: plan(r.site_status, r.site_error, 'La sortie du stock du site'),
    nx: plan(r.nx_status, r.nx_error, 'L\'entrée dans la caisse'),
  };
};

/**
 * Rapprochement prélèvements ↔ ventes de la caisse : pièces boutique VENDUES
 * de chaque prélèvement. Sert à n'autoriser l'annulation que d'un prélèvement
 * dont rien n'est passé en caisse.
 *
 * Par produit caisse, chaque vente consomme les prélèvements dans l'ordre (le
 * plus ancien d'abord), parmi ceux faits avant elle — avec une tolérance de
 * `toleranceMin` : un vendeur qui encaisse avant de scanner le prélèvement ne
 * doit pas rendre annulable une pièce vendue. Le stock que la boutique avait
 * déjà est ignoré exprès : en cas de doute, la pièce est comptée vendue (une
 * annulation à tort fausse le site ET la caisse ; un refus à tort se corrige).
 * Mesuré sur les 32 premiers prélèvements : vente 1 à 3 min après, en général.
 *
 * Dates : chaînes 'YYYY-MM-DD HH:MM:SS' heure de Paris (format Nextore).
 * prelevements : [{ id, nx_product_id, at, nx_qty }]   sales : [{ product_id, at, quantity }]
 * Renvoie Map id → pièces vendues (0 si rien).
 */
const allocateSales = (prelevements, sales, { toleranceMin = 30 } = {}) => {
  const ms = (s) => Date.parse(`${String(s).replace(' ', 'T').slice(0, 19)}Z`);
  const tol = toleranceMin * 60000;
  const sold = new Map(prelevements.map((p) => [p.id, 0]));
  const byProduct = new Map();
  for (const p of prelevements) {
    if (!p.nx_product_id) continue;
    const k = String(p.nx_product_id);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push({ id: p.id, t: ms(p.at), left: Number(p.nx_qty) || 0 });
  }
  for (const list of byProduct.values()) list.sort((a, b) => a.t - b.t || a.id - b.id);
  const ordered = sales
    .map((s) => ({ k: String(s.product_id), t: ms(s.at), q: Number(s.quantity) || 0 }))
    .filter((s) => s.q > 0 && byProduct.has(s.k))
    .sort((a, b) => a.t - b.t);
  for (const s of ordered) {
    let q = s.q;
    for (const p of byProduct.get(s.k)) {
      if (q <= 0) break;
      if (p.left <= 0 || p.t - tol > s.t) continue;
      const take = Math.min(p.left, q);
      p.left -= take;
      q -= take;
      sold.set(p.id, sold.get(p.id) + take);
    }
  }
  return sold;
};

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
  uniqueSiteBarcodeSql, cancelPlan, allocateSales,
  siteUnitCost, boutiqueQty, nextoreProductPayload, splitBarcodes, barcodesToAdd, resolveNx, isCleanRefusal, round2,
};
