#!/usr/bin/env node
/**
 * Rattrapage de purchase_order_items.units_per_qty à partir de BMS.
 *
 * units_per_qty = nombre d'unités de stock représentées par 1 qty_ordered.
 * Il vaut 1 quand la ligne est déjà comptée en unités, et qty_pack quand elle
 * est comptée en PACKS (fournisseurs « à l'unité » : LCA, Highbuy, Levest,
 * MG Vape — et lignes BMS où la désambiguïsation a retenu « prix unitaire »).
 *
 * On ne DÉDUIT rien du catalogue (product_suppliers.pack_qty est le
 * conditionnement courant, pas celui de la commande passée) : on compare la
 * quantité locale à celle de BMS, qui tranche sans ambiguïté —
 *   qty_ordered == qty BMS              → ligne en packs   → units_per_qty = qty_pack
 *   qty_ordered == qty BMS × qty_pack   → ligne en unités  → units_per_qty = 1
 *   sinon (ligne éditée à la main)      → laissée telle quelle, signalée
 *
 * Seuls units_per_qty est écrit : ni les prix, ni les quantités ne bougent.
 *
 * Par défaut, seules les commandes EN COURS sont traitées (ce sont les seules
 * qui alimentent les arrivages). --all pour reprendre tout l'historique.
 *
 * Usage : node backend/scripts/backfillUnitsPerQty.js [--all] [--apply]
 *         (sans --apply : simulation, aucune écriture)
 */

const pool = require('../src/config/database');
const bmsApiModel = require('../src/models/bmsApiModel');

const PENDING_STATUSES = ['sent', 'confirmed', 'shipped', 'partial'];

async function main() {
  const apply = process.argv.includes('--apply');
  const all = process.argv.includes('--all');

  const ordersResult = await pool.query(
    `SELECT id, bms_po_id
     FROM purchase_orders
     WHERE bms_po_id IS NOT NULL
       ${all ? '' : `AND status = ANY($1)`}`,
    all ? [] : [PENDING_STATUSES]
  );
  const orderByBmsId = new Map(ordersResult.rows.map(r => [parseInt(r.bms_po_id), r.id]));
  console.log(`${orderByBmsId.size} commande(s) BMS à examiner${all ? ' (historique complet)' : ' (en cours)'}`);

  const bmsOrders = await bmsApiModel.getPurchaseOrders();

  let updated = 0;
  let unchanged = 0;
  const ambiguous = [];

  for (const bmsOrder of bmsOrders) {
    const poId = orderByBmsId.get(parseInt(bmsOrder.id));
    if (!poId) continue;

    const itemsResult = await pool.query(
      `SELECT id, supplier_sku, qty_ordered, units_per_qty
       FROM purchase_order_items
       WHERE purchase_order_id = $1 AND item_type IS DISTINCT FROM 'discount'`,
      [poId]
    );
    // Index local par référence fournisseur (clé utilisée à l'insertion en synchro)
    const localByRef = new Map();
    for (const row of itemsResult.rows) {
      if (row.supplier_sku) localByRef.set(row.supplier_sku, row);
    }

    for (const bmsItem of bmsOrder.items || []) {
      const ref = bmsItem.supplier_sku || bmsItem.sku;
      const local = localByRef.get(ref);
      if (!local) continue;

      const qtyPack = Math.max(parseInt(bmsItem.qty_pack) || 1, 1);
      const bmsQty = parseInt(bmsItem.qty) || 0;
      const localQty = parseInt(local.qty_ordered) || 0;

      let target;
      if (qtyPack === 1) {
        target = 1;
      } else if (localQty === bmsQty * qtyPack) {
        target = 1;              // quantité déjà convertie en unités
      } else if (localQty === bmsQty) {
        target = qtyPack;        // quantité comptée en packs
      } else {
        ambiguous.push(`PO ${bmsOrder.id} / ${ref} : local ${localQty} vs BMS ${bmsQty} × ${qtyPack}`);
        continue;
      }

      if (target === (parseInt(local.units_per_qty) || 1)) {
        unchanged++;
        continue;
      }

      console.log(`PO ${bmsOrder.id} / ${ref} : units_per_qty ${local.units_per_qty} → ${target} (qty ${localQty})`);
      if (apply) {
        await pool.query(
          'UPDATE purchase_order_items SET units_per_qty = $1 WHERE id = $2',
          [target, local.id]
        );
      }
      updated++;
    }
  }

  console.log(`\n${updated} ligne(s) ${apply ? 'mises à jour' : 'à mettre à jour (simulation)'}, ${unchanged} déjà correcte(s)`);
  if (ambiguous.length > 0) {
    console.log(`\n${ambiguous.length} ligne(s) ambiguë(s), laissées inchangées :`);
    ambiguous.forEach(l => console.log(`  ${l}`));
  }
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
