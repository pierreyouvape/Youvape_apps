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
        o.shipping_address_2,
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
        COALESCE(p.image_url, p_parent.image_url) as image_url,
        p.weight
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
      LEFT JOIN products p_parent ON p.wp_parent_id = p_parent.wp_product_id
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
        weight: item.weight ? parseFloat(item.weight) : null,
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
          address_2: order.shipping_address_2,
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

// Mettre à jour l'adresse de livraison d'une commande (correction par le préparateur
// avant génération de l'étiquette). N'écrit que dans la base locale, qui est lue au
// moment de la génération de l'étiquette La Poste.
const updateShipping = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const {
      first_name, last_name, company,
      address, address_2, city, postcode, country, phone
    } = req.body || {};

    // Champs minimaux requis pour une étiquette exploitable
    if (!address || !city || !postcode) {
      return res.status(400).json({ error: 'Adresse, ville et code postal sont obligatoires' });
    }

    const result = await pool.query(`
      UPDATE orders SET
        shipping_first_name = $1,
        shipping_last_name = $2,
        shipping_company = $3,
        shipping_address_1 = $4,
        shipping_address_2 = $5,
        shipping_city = $6,
        shipping_postcode = $7,
        shipping_country = COALESCE(NULLIF($8, ''), shipping_country),
        shipping_phone = $9
      WHERE wp_order_id = $10
      RETURNING
        shipping_first_name, shipping_last_name, shipping_company,
        shipping_address_1, shipping_address_2,
        shipping_city, shipping_postcode, shipping_country, shipping_phone
    `, [
      (first_name || '').trim(),
      (last_name || '').trim(),
      (company || '').trim() || null,
      address.trim(),
      (address_2 || '').trim() || null,
      city.trim(),
      postcode.trim(),
      (country || '').trim(),
      (phone || '').trim() || null,
      orderNumber
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const row = result.rows[0];
    res.json({
      shipping: {
        first_name: row.shipping_first_name,
        last_name: row.shipping_last_name,
        company: row.shipping_company,
        address: row.shipping_address_1,
        address_2: row.shipping_address_2,
        city: row.shipping_city,
        postcode: row.shipping_postcode,
        country: row.shipping_country,
        phone: row.shipping_phone
      }
    });
  } catch (error) {
    console.error('Erreur updateShipping packing:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  searchOrder,
  lookupBarcode,
  updateShipping
};
