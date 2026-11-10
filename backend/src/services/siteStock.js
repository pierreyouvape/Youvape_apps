/**
 * Stock du SITE (EMC) — point unique pour en retirer des pièces.
 *
 * Aujourd'hui le stock du site fait foi dans BMS : on y crée un mouvement de
 * SORTIE (jamais une quantité absolue, pour ne pas écraser une vente web passée
 * entre-temps). À la sortie de BMS, seule cette fonction change : elle passera
 * par la route `stock/adjust` du plugin youvape-logistique (logistiqueService),
 * aujourd'hui coupée par `stock_changes_enabled`. Rien d'autre ne parle de BMS
 * dans le circuit des prélèvements.
 *
 * Renvoie { ref } (n° du mouvement, peut être null). Lève en cas d'échec ;
 * `uncertain: true` quand le mouvement a pu passer malgré l'erreur.
 */

const bmsApiModel = require('../models/bmsApiModel');
const pdaProductModel = require('../models/pdaProductModel');

const removeFromSite = async ({ sku, qty, comment }) => {
  if (!sku) throw new Error('Produit sans SKU : inconnu du stock du site.');
  const stock = await pdaProductModel.readBmsStock(sku);
  if (qty > stock.physical) {
    throw new Error(`Stock physique du site (${stock.physical}) inférieur au prélèvement (${qty}) : à vérifier.`);
  }
  const comments = String(comment).slice(0, 100);
  const bmsProductId = await pdaProductModel.findBmsProductId(sku);
  let created;
  try {
    created = await bmsApiModel.apiCall('/v2/stock-movements', 'POST', {
      product_id: bmsProductId,
      from_warehouse_id: pdaProductModel.BMS_WAREHOUSE_ID,
      qty,
      category: 'miscellaneous',
      comments,
    });
  } catch (error) {
    if (/BMS API error: 4\d\d/.test(error.message) || /Too Many Attempts/i.test(error.message)) throw error;
    throw Object.assign(
      new Error(`Réponse BMS incertaine, VÉRIFIEZ le mouvement dans BMS avant de réessayer : ${error.message}`),
      { uncertain: true }
    );
  }
  const ref = await pdaProductModel.findMovementId(created, bmsProductId, comments, qty);
  return { ref: ref == null ? null : String(ref) };
};

/**
 * Stock du site d'un produit, en direct : { available, physical, reserved }.
 * `available` = ce qui n'est pas déjà réservé par une commande internet en cours.
 */
const readSiteStock = async (sku) => {
  const s = await pdaProductModel.readBmsStock(sku);
  return { available: Number(s.available) || 0, physical: Number(s.physical) || 0, reserved: Number(s.reserved) || 0 };
};

module.exports = { removeFromSite, readSiteStock };
