const pool = require('../config/database');

// Rechercher une commande par numéro WC pour le packing
const searchOrder = async (req, res) => {
  try {
    const { orderNumber } = req.params;

    // Chercher la commande
    const orderResult = await pool.query(`
      SELECT
        o.wp_order_id,
        o.post_status,
        o.post_date,
        o.shipping_method,
        o.shipping_first_name,
        o.shipping_last_name,
        o.shipping_company,
        o.shipping_address_1,
        o.shipping_city,
        o.shipping_postcode,
        o.shipping_country,
        o.shipping_phone,
        o.billing_email,
        o.order_total
      FROM orders o
      WHERE o.wp_order_id = $1
    `, [orderNumber]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const order = orderResult.rows[0];

    // Chercher les articles de la commande
    const itemsResult = await pool.query(`
      SELECT
        oi.id,
        oi.order_item_name,
        oi.product_id,
        oi.variation_id,
        oi.qty,
        p.sku,
        p.post_title,
        p.image_url
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
      WHERE oi.wp_order_id = $1
      AND oi.order_item_type = 'line_item'
      ORDER BY oi.id
    `, [orderNumber]);

    // Pour chaque article, chercher les barcodes associés
    const items = [];
    for (const item of itemsResult.rows) {
      const productWpId = item.variation_id && item.variation_id !== 0 ? item.variation_id : item.product_id;

      const barcodesResult = await pool.query(`
        SELECT pb.barcode, pb.type, pb.quantity
        FROM product_barcodes pb
        JOIN products p ON p.id = pb.product_id
        WHERE p.wp_product_id = $1
      `, [productWpId]);

      items.push({
        id: item.id,
        name: item.order_item_name || item.post_title,
        sku: item.sku,
        qty: item.qty,
        image_url: item.image_url,
        product_id: item.product_id,
        variation_id: item.variation_id,
        barcodes: barcodesResult.rows
      });
    }

    res.json({
      order: {
        wp_order_id: order.wp_order_id,
        status: order.post_status,
        date: order.post_date,
        shipping_method: order.shipping_method,
        shipping: {
          first_name: order.shipping_first_name,
          last_name: order.shipping_last_name,
          company: order.shipping_company,
          address: order.shipping_address_1,
          city: order.shipping_city,
          postcode: order.shipping_postcode,
          country: order.shipping_country,
          phone: order.shipping_phone
        },
        email: order.billing_email,
        total: order.order_total
      },
      items
    });
  } catch (error) {
    console.error('Erreur searchOrder packing:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// Lookup un barcode pour le packing
const lookupBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;

    const result = await pool.query(`
      SELECT
        pb.barcode, pb.type, pb.quantity,
        p.wp_product_id, p.wp_parent_id, p.sku, p.post_title
      FROM product_barcodes pb
      JOIN products p ON p.id = pb.product_id
      WHERE pb.barcode = $1
    `, [barcode]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Code-barres inconnu' });
    }

    const row = result.rows[0];
    res.json({
      barcode: row.barcode,
      type: row.type,
      quantity: row.quantity || 1,
      wp_product_id: row.wp_product_id,
      wp_parent_id: row.wp_parent_id,
      sku: row.sku,
      name: row.post_title
    });
  } catch (error) {
    console.error('Erreur lookupBarcode packing:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  searchOrder,
  lookupBarcode
};
