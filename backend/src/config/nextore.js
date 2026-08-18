/**
 * Configuration Nextore (API caisse/POS des boutiques physiques).
 *
 * Un seul code, paramétré par `warehouse_id` : 1 = Montpellier, 2 = Castelnau.
 * La clé API vit dans `.env` (NEXTORE_API_KEY) — JAMAIS commitée.
 *
 * Doc API : docs/nextore-api.md (gitignoré).
 */

const NEXTORE_API_URL = process.env.NEXTORE_API_URL || 'https://admin.nextore.fr/api';
const NEXTORE_API_KEY = process.env.NEXTORE_API_KEY || '';

/**
 * Boutiques. `id` = warehouse_id Nextore (⚠️ fiable sur les lignes VENTE/stock,
 * PAS sur les lignes ENCAISSEMENT de /accounting — voir docs/nextore-api.md).
 */
const WAREHOUSES = [
  { id: 1, slug: 'montpellier', code: 'MTP',  name: 'Montpellier', permKey: 'boutique-mtp'  },
  { id: 2, slug: 'castelnau',   code: 'CAST', name: 'Castelnau',   permKey: 'boutique-cast' },
];

const WAREHOUSE_BY_ID = Object.fromEntries(WAREHOUSES.map((w) => [w.id, w]));
const WAREHOUSE_BY_SLUG = Object.fromEntries(WAREHOUSES.map((w) => [w.slug, w]));

/** Renvoie la boutique par id (number/string) ou slug, sinon null. */
function resolveWarehouse(idOrSlug) {
  if (idOrSlug === undefined || idOrSlug === null) return null;
  const asNum = Number(idOrSlug);
  if (!Number.isNaN(asNum) && WAREHOUSE_BY_ID[asNum]) return WAREHOUSE_BY_ID[asNum];
  return WAREHOUSE_BY_SLUG[String(idOrSlug).toLowerCase()] || null;
}

module.exports = {
  NEXTORE_API_URL,
  NEXTORE_API_KEY,
  WAREHOUSES,
  WAREHOUSE_BY_ID,
  WAREHOUSE_BY_SLUG,
  resolveWarehouse,
};
