/**
 * Client HTTP pour l'API Nextore.
 *
 * Auth : header `X-API-KEY`. Toutes les valeurs renvoyées par Nextore sont des
 * strings ; le nettoyage/typage se fait dans nextoreModel. Pas de pagination
 * côté API — chaque endpoint renvoie tout (voir docs/nextore-api.md).
 */

const { NEXTORE_API_URL, NEXTORE_API_KEY } = require('../config/nextore');

async function nextoreGet(path, params = {}) {
  if (!NEXTORE_API_KEY) {
    throw new Error('NEXTORE_API_KEY manquante (à définir dans .env)');
  }

  const url = new URL(`${NEXTORE_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-KEY': NEXTORE_API_KEY },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Nextore ${path} → HTTP ${response.status} ${body.slice(0, 200)}`);
  }

  return response.json();
}

module.exports = {
  nextoreGet,

  /** Catalogue complet (~5000 produits, 1 appel). */
  getProducts: (filters = {}) => nextoreGet('/products/', filters),

  /**
   * Stock complet d'une boutique en 1 appel : [{ product_id, stock, rack }].
   * ⚠️ `warehouse_id` obligatoire.
   */
  getWarehouseStock: (warehouseId) =>
    nextoreGet('/stocks', { warehouse_id: warehouseId }),

  getCategories: () => nextoreGet('/categories'),
  getSubcategories: () => nextoreGet('/subcategories'),

  /** Lignes de vente sur une plage (filtre par date OK). Porte warehouse_id. */
  getSaleItems: (startDate, endDate) =>
    nextoreGet('/sale_items', { start_date: startDate, end_date: endDate }),

  /** Écritures comptables (VENTE / TVA / ENCAISSEMENT) sur une plage. */
  getAccounting: (startDate, endDate) =>
    nextoreGet('/accounting', { start_date: startDate, end_date: endDate }),

  getWarehouses: () => nextoreGet('/warehouses'),
  getTaxRates: () => nextoreGet('/tax_rates'),
};
