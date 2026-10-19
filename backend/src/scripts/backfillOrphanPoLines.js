/**
 * Rattache à leur produit les lignes d'achat restées sans produit.
 *
 * Jusqu'à eb83e65 (19/10/2026), `syncFromBMS` ne retrouvait le produit d'une
 * ligne que parmi les produits PUBLIÉS : un produit passé en privé ou en
 * brouillon perdait ses lignes à chaque passage. 654 lignes reçues sur 260
 * commandes en étaient là, environ 30 650 € d'achats sortis du PMP — dont le Pod
 * Argus Spring Green de la commande LCA 361181.
 *
 * Pourquoi pas une resynchro de ces commandes : rejouée sur une copie de la
 * base, elle rattachait bien 641 lignes, mais relisait aussi les quantités de
 * vieux bons avec les conditionnements d'aujourd'hui (LCA 301672 : 20 pièces
 * reçues devenues 2 ; Highbuy DJEVOZIZF : Tornado ×1 devenu ×5). Ici, on ne
 * touche QU'À `product_id`, et seulement là où il est vide.
 *
 * Le produit est celui que BMS désigne par son SKU, comme le fait la synchro.
 * La ligne BMS se retrouve par la réf. que la synchro a recopiée
 * (`supplier_sku || sku`) ET par son libellé (`name`) : la réf. seule ne suffit
 * pas. Dans la commande LCA 296112, BMS porte #REF10502-32909 sur le Druginbus
 * Freeze 6 mg ET sur un Kiwi Pen à 13,99 € — rattachée à la réf. seule, la ligne
 * du Kiwi Pen passait sur le Druginbus, dont le PMP sautait de 1,10 € à 13,99 €.
 *
 *   node src/scripts/backfillOrphanPoLines.js           → simulation
 *   node src/scripts/backfillOrphanPoLines.js --apply   → écrit
 */
const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

const APPLIQUER = process.argv.includes('--apply');

(async () => {
  console.log(APPLIQUER ? 'Mode ÉCRITURE' : 'Mode SIMULATION (ajouter --apply pour écrire)');

  const { rows: orphelines } = await pool.query(`
    SELECT poi.id, poi.supplier_sku, poi.product_name, po.bms_po_id
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
     WHERE poi.product_id IS NULL
       AND poi.item_type IS DISTINCT FROM 'discount'
       AND po.bms_po_id IS NOT NULL
     ORDER BY poi.id`);
  const parBon = new Map();
  for (const l of orphelines) {
    const file = parBon.get(Number(l.bms_po_id)) || [];
    file.push(l);
    parBon.set(Number(l.bms_po_id), file);
  }
  console.log(`${orphelines.length} lignes sans produit sur ${parBon.size} commandes.`);

  // Même règle que la synchro : tous statuts, le publié puis le non supprimé d'abord.
  const { rows: produits } = await pool.query(`
    SELECT id, sku FROM products
     WHERE sku IS NOT NULL AND sku <> ''
     ORDER BY (post_status = 'publish') DESC, (wc_deleted_at IS NULL) DESC, id DESC`);
  const produitParSku = new Map();
  for (const p of produits) if (!produitParSku.has(p.sku)) produitParSku.set(p.sku, p.id);

  const bons = await bmsApiModel.getPurchaseOrders();
  const affectations = [];
  let skuInconnu = 0;
  for (const bon of bons) {
    const file = parBon.get(parseInt(bon.id, 10));
    if (!file) continue;
    for (const item of bon.items || []) {
      const ref = item.supplier_sku || item.sku || null;
      const i = file.findIndex((l) => !l.pris && l.supplier_sku === ref
        && (l.product_name || null) === (item.name || null));
      if (i < 0) continue;
      const productId = produitParSku.get(item.sku);
      if (!productId) { skuInconnu++; continue; }
      file[i].pris = true;
      affectations.push({ id: file[i].id, productId });
    }
  }
  console.log(`${affectations.length} lignes rattachables, ${skuInconnu} dont le SKU BMS n'existe pas chez nous.`);

  if (APPLIQUER && affectations.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let ecrites = 0;
      for (const a of affectations) {
        const r = await client.query(
          `UPDATE purchase_order_items SET product_id = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND product_id IS NULL`,
          [a.id, a.productId],
        );
        ecrites += r.rowCount;
      }
      await client.query('COMMIT');
      console.log(`${ecrites} lignes rattachées.`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
