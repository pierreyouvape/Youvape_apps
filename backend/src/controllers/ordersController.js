const orderModel = require('../models/orderModel');
const advancedFilterService = require('../services/advancedFilterService');
const pool = require('../config/database');
const axios = require('axios');
const https = require('https');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Récupère toutes les commandes
 * GET /api/orders
 */
exports.getAll = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getAll(limit, offset);
    const total = await orderModel.count();

    res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error getting orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une commande par ID
 * GET /api/orders/:id
 */
exports.getById = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const order = await orderModel.getById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error getting order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche simple de commandes
 * GET /api/orders/search?q=12345
 */
exports.search = async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.search(searchTerm, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error searching orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche avancée avec filtres croisés
 * POST /api/orders/advanced-search
 * Body: { products: { operator: 'AND', product_ids: [123, 456] }, status: 'completed', country: 'FR', ... }
 */
exports.advancedSearch = async (req, res) => {
  try {
    const filters = req.body;
    const orders = await advancedFilterService.searchOrders(filters);

    res.json({ success: true, data: orders, count: orders.length });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Filtre commandes par statut
 * GET /api/orders/status/:status
 */
exports.getByStatus = async (req, res) => {
  try {
    const status = req.params.status;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getByStatus(status, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting orders by status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Filtre commandes par pays
 * GET /api/orders/country/:country
 */
exports.getByCountry = async (req, res) => {
  try {
    const country = req.params.country;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getByCountry(country, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting orders by country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les statuts existants
 * GET /api/orders/statuses/list
 */
exports.getStatuses = async (req, res) => {
  try {
    const statuses = await orderModel.getStatuses();
    res.json({ success: true, data: statuses });
  } catch (error) {
    console.error('Error getting statuses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les statistiques par statut
 * GET /api/orders/stats/by-status
 */
exports.getStatsByStatus = async (req, res) => {
  try {
    const stats = await orderModel.getStatsByStatus();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting stats by status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les pays existants
 * GET /api/orders/countries/list
 */
exports.getCountries = async (req, res) => {
  try {
    const countries = await orderModel.getCountries();
    res.json({ success: true, data: countries });
  } catch (error) {
    console.error('Error getting countries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les transporteurs existants
 * GET /api/orders/shipping-methods/list
 */
exports.getShippingMethods = async (req, res) => {
  try {
    const methods = await orderModel.getShippingMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    console.error('Error getting shipping methods:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère toutes les catégories pour le filtre commandes
 * GET /api/orders/categories/list
 */
exports.getCategories = async (req, res) => {
  try {
    const pool = require('../config/database');
    const query = `
      SELECT DISTINCT category, COUNT(DISTINCT wp_product_id) as product_count
      FROM products
      WHERE category IS NOT NULL AND category != ''
      AND product_type IN ('simple', 'variable', 'woosb')
      GROUP BY category
      ORDER BY category
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche avancée avec tous les filtres combinés
 * GET /api/orders/filter
 */
exports.filterOrders = async (req, res) => {
  try {
    const pool = require('../config/database');

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Recherche texte (numéro commande, nom, prénom, email)
    if (req.query.search) {
      conditions.push(`(
        CAST(o.wp_order_id AS TEXT) ILIKE $${paramIndex}
        OR o.billing_first_name ILIKE $${paramIndex}
        OR o.billing_last_name ILIKE $${paramIndex}
        OR o.billing_email ILIKE $${paramIndex}
        OR CONCAT(o.billing_first_name, ' ', o.billing_last_name) ILIKE $${paramIndex}
      )`);
      params.push(`%${req.query.search}%`);
      paramIndex++;
    }

    // Filtre par pays
    if (req.query.country) {
      conditions.push(`o.billing_country = $${paramIndex}`);
      params.push(req.query.country);
      paramIndex++;
    }

    // Filtre par statut (peut être un tableau séparé par virgules)
    if (req.query.status) {
      const statuses = req.query.status.split(',');
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    }

    // Filtre par montant minimum
    if (req.query.minAmount) {
      conditions.push(`o.order_total >= $${paramIndex}`);
      params.push(parseFloat(req.query.minAmount));
      paramIndex++;
    }

    // Filtre par montant maximum
    if (req.query.maxAmount) {
      conditions.push(`o.order_total <= $${paramIndex}`);
      params.push(parseFloat(req.query.maxAmount));
      paramIndex++;
    }

    // Filtre par date de début
    if (req.query.dateFrom) {
      conditions.push(`o.post_date >= $${paramIndex}`);
      params.push(req.query.dateFrom);
      paramIndex++;
    }

    // Filtre par date de fin
    if (req.query.dateTo) {
      conditions.push(`o.post_date <= $${paramIndex}::date + interval '1 day'`);
      params.push(req.query.dateTo);
      paramIndex++;
    }

    // Filtre par transporteur
    if (req.query.shippingMethod) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_ship
        WHERE oi_ship.wp_order_id = o.wp_order_id
        AND oi_ship.order_item_type = 'shipping'
        AND oi_ship.order_item_name = $${paramIndex}
      )`);
      params.push(req.query.shippingMethod);
      paramIndex++;
    }

    // Filtre par catégorie de produit
    if (req.query.category) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_cat
        JOIN products p_cat ON (CAST(p_cat.wp_product_id AS TEXT) = oi_cat.product_id OR CAST(p_cat.wp_product_id AS TEXT) = oi_cat.variation_id)
        WHERE oi_cat.wp_order_id = o.wp_order_id
        AND oi_cat.order_item_type = 'line_item'
        AND (p_cat.category = $${paramIndex} OR p_cat.sub_category = $${paramIndex})
      )`);
      params.push(req.query.category);
      paramIndex++;
    }

    // Filtre par produit spécifique
    if (req.query.productId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_prod
        WHERE oi_prod.wp_order_id = o.wp_order_id
        AND oi_prod.order_item_type = 'line_item'
        AND (oi_prod.product_id = $${paramIndex} OR oi_prod.variation_id = $${paramIndex})
      )`);
      params.push(req.query.productId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    // Compter le total
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Récupérer les commandes
    const query = `
      SELECT
        o.wp_order_id,
        o.post_date,
        o.post_status,
        o.billing_first_name,
        o.billing_last_name,
        o.billing_email,
        o.billing_phone,
        o.billing_country,
        o.billing_address_1,
        o.billing_city,
        o.billing_postcode,
        o.shipping_first_name,
        o.shipping_last_name,
        o.shipping_country,
        o.shipping_address_1,
        o.shipping_city,
        o.shipping_postcode,
        o.order_total,
        o.order_shipping,
        o.payment_method_title,
        o.shipping_method,
        o.shipping_carrier,
        o.tracking_number,
        (SELECT COUNT(*) FROM order_items oi_c WHERE oi_c.wp_order_id = o.wp_order_id AND oi_c.order_item_type = 'line_item') as items_count,
        (SELECT COUNT(*) > 0 FROM reviews WHERE order_id = o.wp_order_id::text) as has_review,
        (SELECT STRING_AGG(oi_cp.order_item_name, ', ') FROM order_items oi_cp WHERE oi_cp.wp_order_id = o.wp_order_id AND oi_cp.order_item_type = 'coupon') as coupons
      FROM orders o
      ${whereClause}
      ORDER BY o.post_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error filtering orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les détails d'une commande pour l'affichage dépliable
 * GET /api/orders/:id/details
 */
exports.getOrderDetails = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const details = await orderModel.getOrderDetails(orderId);
    res.json({ success: true, data: details });
  } catch (error) {
    console.error('Error getting order details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les avis associés à une commande
 * GET /api/orders/:id/reviews
 */
exports.getOrderReviews = async (req, res) => {
  try {
    const pool = require('../config/database');
    const orderId = req.params.id;

    const query = `
      SELECT
        r.*,
        p.post_title as product_name,
        p.image_url as product_image
      FROM reviews r
      LEFT JOIN products p ON p.wp_product_id::text = r.product_id
      WHERE r.order_id = $1
      ORDER BY r.review_date DESC
    `;
    const result = await pool.query(query, [orderId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getting order reviews:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Met à jour le coût réel de livraison
 * PUT /api/orders/:id/shipping-cost
 * Body: { shipping_cost_real: 8.50 }
 */
exports.updateShippingCost = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { shipping_cost_real } = req.body;

    if (shipping_cost_real === undefined || shipping_cost_real === null) {
      return res.status(400).json({
        success: false,
        error: 'shipping_cost_real is required'
      });
    }

    const order = await orderModel.updateShippingCost(orderId, shipping_cost_real);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({
      success: true,
      message: 'Shipping cost updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Error updating shipping cost:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Réimporte une commande depuis l'API REST WooCommerce
 * POST /api/orders/:id/reimport
 */
exports.reimport = async (req, res) => {
  try {
    const wpOrderId = parseInt(req.params.id);

    // Récupérer les credentials WC depuis rewards_config
    const configResult = await pool.query(
      'SELECT woocommerce_url, consumer_key, consumer_secret, htaccess_user, htaccess_password FROM rewards_config LIMIT 1'
    );

    if (!configResult.rows.length || !configResult.rows[0].consumer_key) {
      return res.status(500).json({ success: false, error: 'WooCommerce credentials not configured' });
    }

    const { woocommerce_url, consumer_key, consumer_secret, htaccess_user, htaccess_password } = configResult.rows[0];
    const baseUrl = woocommerce_url.replace(/\/$/, '');

    // Headers avec htaccess si configuré
    const headers = {};
    if (htaccess_user && htaccess_password) {
      const encoded = Buffer.from(`${htaccess_user}:${htaccess_password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    }

    // Appel API REST WooCommerce
    const wcResponse = await axios.get(`${baseUrl}/wp-json/wc/v3/orders/${wpOrderId}`, {
      params: { consumer_key, consumer_secret },
      headers,
      httpsAgent,
      timeout: 15000
    });

    const wcOrder = wcResponse.data;

    // Mapper les données WC vers notre schéma BDD
    const status = wcOrder.status.startsWith('wc-') ? wcOrder.status : `wc-${wcOrder.status}`;
    const billing = wcOrder.billing || {};
    const shipping = wcOrder.shipping || {};

    // Upsert de la commande
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO orders (
          wp_order_id, wp_customer_id, post_status, post_date, post_modified,
          payment_method_title, created_via,
          billing_first_name, billing_last_name, billing_address_1, billing_address_2,
          billing_city, billing_postcode, billing_country, billing_email, billing_phone,
          shipping_first_name, shipping_last_name, shipping_address_1,
          shipping_city, shipping_postcode, shipping_country,
          cart_discount, order_shipping, order_tax, order_total, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW())
        ON CONFLICT (wp_order_id) DO UPDATE SET
          wp_customer_id = EXCLUDED.wp_customer_id,
          post_status = EXCLUDED.post_status,
          post_date = EXCLUDED.post_date,
          post_modified = EXCLUDED.post_modified,
          payment_method_title = EXCLUDED.payment_method_title,
          billing_first_name = EXCLUDED.billing_first_name,
          billing_last_name = EXCLUDED.billing_last_name,
          billing_address_1 = EXCLUDED.billing_address_1,
          billing_address_2 = EXCLUDED.billing_address_2,
          billing_city = EXCLUDED.billing_city,
          billing_postcode = EXCLUDED.billing_postcode,
          billing_country = EXCLUDED.billing_country,
          billing_email = EXCLUDED.billing_email,
          billing_phone = EXCLUDED.billing_phone,
          shipping_first_name = EXCLUDED.shipping_first_name,
          shipping_last_name = EXCLUDED.shipping_last_name,
          shipping_address_1 = EXCLUDED.shipping_address_1,
          shipping_city = EXCLUDED.shipping_city,
          shipping_postcode = EXCLUDED.shipping_postcode,
          shipping_country = EXCLUDED.shipping_country,
          cart_discount = EXCLUDED.cart_discount,
          order_shipping = EXCLUDED.order_shipping,
          order_tax = EXCLUDED.order_tax,
          order_total = EXCLUDED.order_total,
          updated_at = NOW()
      `, [
        wpOrderId,
        wcOrder.customer_id || null,
        status,
        wcOrder.date_created_gmt ? wcOrder.date_created_gmt.replace('T', ' ') : null,
        wcOrder.date_modified_gmt ? wcOrder.date_modified_gmt.replace('T', ' ') : null,
        wcOrder.payment_method_title || null,
        wcOrder.created_via || null,
        billing.first_name || null,
        billing.last_name || null,
        billing.address_1 || null,
        billing.address_2 || null,
        billing.city || null,
        billing.postcode || null,
        billing.country || null,
        billing.email || null,
        billing.phone || null,
        shipping.first_name || null,
        shipping.last_name || null,
        shipping.address_1 || null,
        shipping.city || null,
        shipping.postcode || null,
        shipping.country || null,
        parseFloat(wcOrder.discount_total) || 0,
        parseFloat(wcOrder.shipping_total) || 0,
        parseFloat(wcOrder.total_tax) || 0,
        parseFloat(wcOrder.total) || 0
      ]);

      // Réimporter les articles
      await client.query('DELETE FROM order_items WHERE wp_order_id = $1', [wpOrderId]);

      for (const item of (wcOrder.line_items || [])) {
        await client.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            product_id, variation_id, qty, line_subtotal, line_total, line_tax
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [
          wpOrderId,
          item.id || 0,
          item.name || '',
          'line_item',
          item.product_id || null,
          item.variation_id || null,
          item.quantity || 0,
          parseFloat(item.subtotal) || 0,
          parseFloat(item.total) || 0,
          parseFloat(item.total_tax) || 0
        ]);
      }

      // Lignes de livraison
      for (const line of (wcOrder.shipping_lines || [])) {
        await client.query(`
          INSERT INTO order_items (wp_order_id, order_item_id, order_item_name, order_item_type, line_total)
          VALUES ($1,$2,$3,'shipping',$4)
        `, [wpOrderId, line.id || 0, line.method_title || '', parseFloat(line.total) || 0]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`✓ Order #${wpOrderId} reimported from WooCommerce`);
    res.json({ success: true, message: `Commande #${wpOrderId} réimportée avec succès` });

  } catch (error) {
    console.error('Error reimporting order:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.message || error.message });
  }
};
