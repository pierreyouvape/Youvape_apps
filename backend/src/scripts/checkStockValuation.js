/**
 * Contrôle de la valeur de stock HT : le rapport /stats/reports doit donner
 * exactement le même chiffre que le catalogue (/catalog), qui fait référence.
 *
 * Affiche aussi les lignes d'achat comptées en packs (units_per_qty > 1) : c'est
 * la source d'écart historique (prix du pack appliqué à chaque unité).
 *
 * Usage (sur le VPS, depuis le container backend) :
 *   docker exec youvape_backend node src/scripts/checkStockValuation.js
 *
 * Sortie : code 0 si aligné, 1 sinon (utilisable en contrôle automatisé).
 */

'use strict';

const pool = require('../config/database');
const stockValuationModel = require('../models/stockValuationModel');

const eur = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

async function main() {
  const { report, catalog, delta, aligned } = await stockValuationModel.checkAlignmentWithCatalog();

  console.log('=== Valeur de stock HT au ' + new Date().toLocaleDateString('fr-FR') + ' ===');
  console.log('Catalogue (référence) :', eur(catalog));
  console.log('Rapport stats         :', eur(report));
  console.log('Écart                 :', eur(delta), aligned ? '✅ aligné' : '❌ DÉSALIGNÉ');

  // Ampleur du piège units_per_qty : lignes reçues comptées en packs.
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int                                            AS lignes,
           COUNT(DISTINCT poi.product_id)::int                      AS produits,
           COALESCE(SUM(poi.qty_received), 0)::int                  AS qty_packs,
           COALESCE(SUM(poi.qty_received * poi.units_per_qty), 0)::int AS qty_unites
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.qty_received > 0
      AND COALESCE(poi.units_per_qty, 1) > 1
      AND po.status NOT IN ('draft', 'cancelled')
  `);
  const r = rows[0];
  console.log('');
  console.log('Lignes d\'achat comptées en PACKS (units_per_qty > 1) :');
  console.log(`  ${r.lignes} lignes / ${r.produits} produits — ${r.qty_packs} packs = ${r.qty_unites} unités de stock`);
  console.log('  (sans le facteur units_per_qty, ces unités seraient valorisées au prix du PACK)');

  await pool.end();
  process.exit(aligned ? 0 : 1);
}

main().catch((err) => {
  console.error('[checkStockValuation][FATAL]', err.message);
  process.exit(1);
});
