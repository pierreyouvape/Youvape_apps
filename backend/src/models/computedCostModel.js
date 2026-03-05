const pool = require('../config/database');

const computedCostModel = {
  /**
   * Recalcule le computed_cost (PMP FIFO) pour tous les produits ayant des PO
   */
  recalculateAll: async () => {
    const startTime = Date.now();

    // 1. Tous les lots reçus, triés par date d'arrivée
    const lotsResult = await pool.query(`
      SELECT poi.product_id, poi.qty_received, poi.unit_price,
             COALESCE(po.received_date, po.order_date, po.created_at) as lot_date
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.qty_received > 0
        AND po.status NOT IN ('draft', 'cancelled')
        AND poi.unit_price IS NOT NULL
        AND poi.unit_price > 0
      ORDER BY poi.product_id, lot_date ASC, poi.id ASC
    `);

    // 2. Total vendu par produit (commandes validées uniquement)
    const salesResult = await pool.query(`
      SELECT p.id as product_id, COALESCE(SUM(oi.qty), 0)::int as total_sold
      FROM products p
      JOIN order_items oi ON (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.post_status NOT IN ('wc-cancelled','wc-refunded','wc-failed','wc-on-hold','wc-pending')
        AND p.id IN (SELECT DISTINCT product_id FROM purchase_order_items WHERE qty_received > 0)
      GROUP BY p.id
    `);

    // Indexer les ventes par product_id
    const salesMap = {};
    for (const row of salesResult.rows) {
      salesMap[row.product_id] = parseInt(row.total_sold);
    }

    // Regrouper les lots par product_id
    const lotsByProduct = {};
    for (const lot of lotsResult.rows) {
      if (!lotsByProduct[lot.product_id]) lotsByProduct[lot.product_id] = [];
      const qty = parseInt(lot.qty_received);
      const price = parseFloat(lot.unit_price);
      if (!qty || qty <= 0 || isNaN(price) || price <= 0) continue;
      lotsByProduct[lot.product_id].push({ qty, price });
    }

    // 3. Calcul FIFO pour chaque produit
    const ids = [];
    const costs = [];

    for (const [productId, lots] of Object.entries(lotsByProduct)) {
      const totalSold = salesMap[productId] || 0;
      let remaining = totalSold;

      // Consommer les lots FIFO (plus ancien d'abord)
      for (const lot of lots) {
        if (remaining <= 0) break;
        const consumed = Math.min(remaining, lot.qty);
        lot.qty -= consumed;
        remaining -= consumed;
      }

      // Calculer le PMP des lots restants
      const remainingLots = lots.filter(l => l.qty > 0);

      let computedCost;
      if (remainingLots.length > 0) {
        const totalValue = remainingLots.reduce((sum, l) => sum + l.qty * l.price, 0);
        const totalQty = remainingLots.reduce((sum, l) => sum + l.qty, 0);
        computedCost = totalValue / totalQty;
      } else {
        // Tout vendu : prendre le prix du dernier lot
        computedCost = lots[lots.length - 1].price;
      }

      const pid = parseInt(productId);
      const cost = Math.round(computedCost * 100) / 100;
      if (isNaN(pid) || isNaN(cost) || cost <= 0) continue;
      ids.push(pid);
      costs.push(cost);
    }

    // 4. Batch UPDATE
    let updatedCount = 0;
    if (ids.length > 0) {
      const result = await pool.query(`
        UPDATE products AS p
        SET computed_cost = v.cost, computed_cost_updated_at = NOW()
        FROM (SELECT unnest($1::int[]) as id, unnest($2::numeric[]) as cost) v
        WHERE p.id = v.id
      `, [ids, costs]);
      updatedCount = result.rowCount;
    }

    const elapsed = Date.now() - startTime;
    console.log(`PMP FIFO: ${updatedCount} produits mis a jour en ${elapsed}ms`);
    return { updatedCount, elapsed };
  }
};

module.exports = computedCostModel;
