const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { transformCustomer, insertCustomer } = require('../transformers/customerTransformer');
const { transformOrder, transformOrderItems, insertOrder } = require('../transformers/orderTransformer');
const { insertProductWithVariations } = require('../transformers/productTransformer');

const LOGS_DIR = path.join(__dirname, '../../logs');

// Crée le dossier logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Reçoit les données clients depuis WooCommerce
 * POST /api/sync/customers
 */
const receiveCustomers = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    // Prépare l'entrée de log
    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    // Écrit dans le fichier customers.json (append)
    const logFile = path.join(LOGS_DIR, 'customers.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    // Insert/Update dans PostgreSQL
    let inserted = 0;
    let updated = 0;

    for (const customer of data) {
      const query = `
        INSERT INTO customers (
          customer_id, email, first_name, last_name, phone, username, display_name,
          roles, date_created, date_modified, total_spent, order_count, is_paying_customer,
          billing_address, shipping_address, meta_data, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        ON CONFLICT (customer_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          phone = EXCLUDED.phone,
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          roles = EXCLUDED.roles,
          date_created = EXCLUDED.date_created,
          date_modified = EXCLUDED.date_modified,
          total_spent = EXCLUDED.total_spent,
          order_count = EXCLUDED.order_count,
          is_paying_customer = EXCLUDED.is_paying_customer,
          billing_address = EXCLUDED.billing_address,
          shipping_address = EXCLUDED.shipping_address,
          meta_data = EXCLUDED.meta_data,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;

      const values = [
        customer.customer_id,
        customer.email,
        customer.first_name || null,
        customer.last_name || null,
        customer.phone || null,
        customer.username || null,
        customer.display_name || null,
        JSON.stringify(customer.roles || []),
        customer.date_created || null,
        customer.date_modified || null,
        customer.total_spent || 0,
        customer.order_count || 0,
        customer.is_paying_customer || false,
        JSON.stringify(customer.billing_address || {}),
        JSON.stringify(customer.shipping_address || {}),
        JSON.stringify(customer.meta_data || {})
      ];

      const result = await pool.query(query, values);
      if (result.rows[0].inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    console.log(`✓ Customers: ${data.length} received, ${inserted} inserted, ${updated} updated (${sync_type})`);

    res.json({
      success: true,
      message: `${data.length} customers received`,
      items_count: data.length,
      inserted: inserted,
      updated: updated
    });

  } catch (error) {
    console.error('Error receiving customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reçoit les données produits depuis WooCommerce
 * POST /api/sync/products
 */
const receiveProducts = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    const logFile = path.join(LOGS_DIR, 'products.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    // Insert/Update dans PostgreSQL
    let inserted = 0;
    let updated = 0;
    let variationsInserted = 0;
    let variationsUpdated = 0;

    for (const product of data) {
      const query = `
        INSERT INTO products (
          product_id, sku, name, description, short_description, price, regular_price, sale_price, cost_price,
          stock_quantity, stock_status, category, categories, tags, attributes, dimensions,
          meta_data, type, status, featured, date_created, date_modified, total_sales,
          image_url, gallery_images, parent_id, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW())
        ON CONFLICT (product_id)
        DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          short_description = EXCLUDED.short_description,
          price = EXCLUDED.price,
          regular_price = EXCLUDED.regular_price,
          sale_price = EXCLUDED.sale_price,
          cost_price = EXCLUDED.cost_price,
          stock_quantity = EXCLUDED.stock_quantity,
          stock_status = EXCLUDED.stock_status,
          category = EXCLUDED.category,
          categories = EXCLUDED.categories,
          tags = EXCLUDED.tags,
          attributes = EXCLUDED.attributes,
          dimensions = EXCLUDED.dimensions,
          meta_data = EXCLUDED.meta_data,
          type = EXCLUDED.type,
          status = EXCLUDED.status,
          featured = EXCLUDED.featured,
          date_created = EXCLUDED.date_created,
          date_modified = EXCLUDED.date_modified,
          total_sales = EXCLUDED.total_sales,
          image_url = EXCLUDED.image_url,
          gallery_images = EXCLUDED.gallery_images,
          parent_id = EXCLUDED.parent_id,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;

      const values = [
        product.product_id,
        product.sku || null,
        product.name,
        product.description || null,
        product.short_description || null,
        product.price || 0,
        product.regular_price || null,
        product.sale_price || null,
        product.cost_price || null,
        product.stock_quantity || null,
        product.stock_status || 'instock',
        product.category || null,
        JSON.stringify(product.categories || []),
        JSON.stringify(product.tags || []),
        JSON.stringify(product.attributes || {}),
        JSON.stringify(product.dimensions || {}),
        JSON.stringify(product.meta_data || {}),
        product.type || 'simple',
        product.status || 'publish',
        product.featured || false,
        product.date_created || null,
        product.date_modified || null,
        product.total_sales || 0,
        product.image_url || null,
        JSON.stringify(product.gallery_images || []),
        null // parent_id est NULL pour les produits parents
      ];

      const result = await pool.query(query, values);
      if (result.rows[0].inserted) {
        inserted++;
      } else {
        updated++;
      }

      // Traite les variations si présentes
      if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
        for (const variation of product.variations) {
          const variationQuery = `
            INSERT INTO products (
              product_id, sku, name, description, short_description, price, regular_price, sale_price, cost_price,
              stock_quantity, stock_status, category, categories, tags, attributes, dimensions,
              meta_data, type, status, featured, date_created, date_modified, total_sales,
              image_url, gallery_images, parent_id, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW())
            ON CONFLICT (product_id)
            DO UPDATE SET
              sku = EXCLUDED.sku,
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              short_description = EXCLUDED.short_description,
              price = EXCLUDED.price,
              regular_price = EXCLUDED.regular_price,
              sale_price = EXCLUDED.sale_price,
              cost_price = EXCLUDED.cost_price,
              stock_quantity = EXCLUDED.stock_quantity,
              stock_status = EXCLUDED.stock_status,
              attributes = EXCLUDED.attributes,
              image_url = EXCLUDED.image_url,
              parent_id = EXCLUDED.parent_id,
              date_modified = EXCLUDED.date_modified,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          `;

          const variationValues = [
            variation.variation_id,
            variation.sku || null,
            variation.name,
            variation.description || null,
            null, // short_description
            variation.price || 0,
            variation.regular_price || null,
            variation.sale_price || null,
            variation.cost_price || null,
            variation.stock_quantity || null,
            variation.stock_status || 'instock',
            product.category || null, // Hérite de la catégorie du parent
            JSON.stringify(product.categories || []), // Hérite des catégories du parent
            JSON.stringify([]), // tags vides pour variations
            JSON.stringify(variation.attributes || {}),
            JSON.stringify({ weight: variation.weight || null }), // dimensions simplifiées
            JSON.stringify({}), // meta_data vide
            'variation', // type
            'publish', // status
            false, // featured
            variation.date_created || null,
            variation.date_modified || null,
            0, // total_sales (géré au niveau parent)
            variation.image_url || null,
            JSON.stringify([]), // gallery_images vide
            product.product_id // parent_id = ID du produit parent
          ];

          const variationResult = await pool.query(variationQuery, variationValues);
          if (variationResult.rows[0].inserted) {
            variationsInserted++;
          } else {
            variationsUpdated++;
          }
        }
      }
    }

    console.log(`✓ Products: ${data.length} received, ${inserted} inserted, ${updated} updated (${sync_type})`);
    if (variationsInserted > 0 || variationsUpdated > 0) {
      console.log(`✓ Variations: ${variationsInserted} inserted, ${variationsUpdated} updated`);
    }

    res.json({
      success: true,
      message: `${data.length} products received`,
      items_count: data.length,
      inserted: inserted,
      updated: updated
    });

  } catch (error) {
    console.error('Error receiving products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reçoit les données commandes depuis WooCommerce
 * POST /api/sync/orders
 */
const receiveOrders = async (req, res) => {
  try {
    // Support à la fois 'data' (test) et 'batch' (WooCommerce module)
    const data = req.body.data || req.body.batch;
    const sync_type = req.body.sync_type || req.body.action;
    const timestamp = req.body.timestamp;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected array in "data" or "batch" field.'
      });
    }

    const logEntry = {
      received_at: new Date().toISOString(),
      sync_type: sync_type || 'unknown',
      wc_timestamp: timestamp,
      count: data.length,
      data: data
    };

    const logFile = path.join(LOGS_DIR, 'orders.json');
    let existingData = [];

    if (fs.existsSync(logFile)) {
      const fileContent = fs.readFileSync(logFile, 'utf8');
      if (fileContent.trim()) {
        existingData = JSON.parse(fileContent);
      }
    }

    existingData.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(existingData, null, 2));

    // Insert/Update dans PostgreSQL
    let inserted = 0;
    let updated = 0;
    let itemsInserted = 0;
    let couponsInserted = 0;

    for (const order of data) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Insert/Update order
        const orderQuery = `
          INSERT INTO orders (
            order_id, order_key, order_number, status, total, subtotal,
            shipping_total, discount_total, tax_total, cart_tax, shipping_tax,
            payment_method, payment_method_title, transaction_id, currency, prices_include_tax,
            date_created, date_completed, date_paid, date_modified,
            customer_id, customer_ip_address, customer_user_agent,
            shipping_method, shipping_method_title, shipping_country,
            billing_address, shipping_address, customer_note,
            shipping_lines, fee_lines, tax_lines, meta_data, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, NOW())
          ON CONFLICT (order_id)
          DO UPDATE SET
            order_key = EXCLUDED.order_key,
            order_number = EXCLUDED.order_number,
            status = EXCLUDED.status,
            total = EXCLUDED.total,
            subtotal = EXCLUDED.subtotal,
            shipping_total = EXCLUDED.shipping_total,
            discount_total = EXCLUDED.discount_total,
            tax_total = EXCLUDED.tax_total,
            cart_tax = EXCLUDED.cart_tax,
            shipping_tax = EXCLUDED.shipping_tax,
            payment_method = EXCLUDED.payment_method,
            payment_method_title = EXCLUDED.payment_method_title,
            transaction_id = EXCLUDED.transaction_id,
            currency = EXCLUDED.currency,
            prices_include_tax = EXCLUDED.prices_include_tax,
            date_created = EXCLUDED.date_created,
            date_completed = EXCLUDED.date_completed,
            date_paid = EXCLUDED.date_paid,
            date_modified = EXCLUDED.date_modified,
            customer_id = EXCLUDED.customer_id,
            customer_ip_address = EXCLUDED.customer_ip_address,
            customer_user_agent = EXCLUDED.customer_user_agent,
            shipping_method = EXCLUDED.shipping_method,
            shipping_method_title = EXCLUDED.shipping_method_title,
            shipping_country = EXCLUDED.shipping_country,
            billing_address = EXCLUDED.billing_address,
            shipping_address = EXCLUDED.shipping_address,
            customer_note = EXCLUDED.customer_note,
            shipping_lines = EXCLUDED.shipping_lines,
            fee_lines = EXCLUDED.fee_lines,
            tax_lines = EXCLUDED.tax_lines,
            meta_data = EXCLUDED.meta_data,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `;

        const orderValues = [
          order.order_id,
          order.order_key || null, // NOUVEAU
          order.order_number,
          order.status || 'pending',
          order.total || 0,
          order.subtotal || 0,
          order.shipping_total || 0,
          order.discount_total || 0,
          order.tax_total || 0,
          order.cart_tax || 0, // NOUVEAU
          order.shipping_tax || 0, // NOUVEAU
          order.payment_method || null,
          order.payment_method_title || null,
          order.transaction_id || null, // NOUVEAU
          order.currency || 'EUR',
          order.prices_include_tax || false, // NOUVEAU
          order.date_created || null,
          order.date_completed || null,
          order.date_paid || null, // NOUVEAU
          order.date_modified || null,
          order.customer_id || null,
          order.customer_ip_address || null, // NOUVEAU
          order.customer_user_agent || null, // NOUVEAU
          order.shipping_method || null,
          order.shipping_method_title || null,
          order.shipping_country || null,
          JSON.stringify(order.billing_address || {}),
          JSON.stringify(order.shipping_address || {}),
          order.customer_note || null,
          JSON.stringify(order.shipping_lines || []), // NOUVEAU
          JSON.stringify(order.fee_lines || []), // NOUVEAU
          JSON.stringify(order.tax_lines || []), // NOUVEAU
          JSON.stringify(order.meta_data || {}) // NOUVEAU
        ];

        const orderResult = await client.query(orderQuery, orderValues);
        if (orderResult.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
          // Delete existing items and coupons for update
          await client.query('DELETE FROM order_items WHERE order_id = $1', [order.order_id]);
          await client.query('DELETE FROM order_coupons WHERE order_id = $1', [order.order_id]);
        }

        // Insert order_items
        if (order.line_items && Array.isArray(order.line_items)) {
          for (const item of order.line_items) {
            const itemQuery = `
              INSERT INTO order_items (
                order_id, product_id, variation_id, product_name, sku, quantity,
                price, regular_price, subtotal, total, discount, cost_price, tax, meta_data
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `;

            const itemValues = [
              order.order_id,
              item.product_id || null,
              item.variation_id || null, // NOUVEAU
              item.product_name || '',
              item.sku || null,
              item.quantity || 0,
              item.price || 0,
              item.regular_price || null,
              item.subtotal || 0,
              item.total || 0,
              item.discount || 0,
              item.cost_price || null,
              item.tax || 0,
              JSON.stringify(item.meta_data || {}) // NOUVEAU
            ];

            await client.query(itemQuery, itemValues);
            itemsInserted++;
          }
        }

        // Insert order_coupons
        if (order.coupon_lines && Array.isArray(order.coupon_lines)) {
          for (const coupon of order.coupon_lines) {
            const couponQuery = `
              INSERT INTO order_coupons (
                order_id, code, discount, discount_type
              ) VALUES ($1, $2, $3, $4)
            `;

            const couponValues = [
              order.order_id,
              coupon.code || '',
              coupon.discount || 0,
              coupon.discount_type || null
            ];

            await client.query(couponQuery, couponValues);
            couponsInserted++;
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error processing order ${order.order_id}:`, error);
        throw error;
      } finally {
        client.release();
      }
    }

    console.log(`✓ Orders: ${data.length} received, ${inserted} inserted, ${updated} updated, ${itemsInserted} items, ${couponsInserted} coupons (${sync_type})`);

    res.json({
      success: true,
      message: `${data.length} orders received`,
      items_count: data.length,
      inserted: inserted,
      updated: updated,
      items_inserted: itemsInserted,
      coupons_inserted: couponsInserted
    });

  } catch (error) {
    console.error('Error receiving orders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Télécharge les logs d'un type spécifique
 * GET /api/sync/logs/:type
 */
const downloadLogs = async (req, res) => {
  try {
    const { type } = req.params;

    if (!['customers', 'products', 'orders'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type. Must be: customers, products, or orders'
      });
    }

    const logFile = path.join(LOGS_DIR, `${type}.json`);

    if (!fs.existsSync(logFile)) {
      return res.status(404).json({
        success: false,
        error: `No logs found for ${type}`
      });
    }

    // Envoie le fichier en téléchargement
    res.download(logFile, `${type}_logs_${Date.now()}.json`);

  } catch (error) {
    console.error('Error downloading logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats des logs (nombre d'entrées)
 * GET /api/sync/stats
 */
const getStats = async (req, res) => {
  try {
    const stats = {
      customers: 0,
      products: 0,
      orders: 0
    };

    for (const type of ['customers', 'products', 'orders']) {
      const logFile = path.join(LOGS_DIR, `${type}.json`);
      if (fs.existsSync(logFile)) {
        const fileContent = fs.readFileSync(logFile, 'utf8');
        if (fileContent.trim()) {
          const data = JSON.parse(fileContent);
          // Compte le nombre total d'items reçus
          stats[type] = data.reduce((sum, entry) => sum + (entry.count || 0), 0);
        }
      }
    }

    res.json({ success: true, stats });

  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Supprime tous les logs (pour reset)
 * DELETE /api/sync/logs
 */
const clearLogs = async (req, res) => {
  try {
    for (const type of ['customers', 'products', 'orders']) {
      const logFile = path.join(LOGS_DIR, `${type}.json`);
      if (fs.existsSync(logFile)) {
        fs.unlinkSync(logFile);
      }
    }

    console.log('✓ All logs cleared');

    res.json({
      success: true,
      message: 'All logs cleared successfully'
    });

  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Endpoint de test de connexion (ping)
 * GET /api/sync/ping
 */
const ping = async (req, res) => {
  res.json({
    success: true,
    message: 'API is reachable',
    timestamp: new Date().toISOString()
  });
};

/**
 * Récupère les offsets de test manuels
 * GET /api/sync/test-offsets
 */
const getTestOffsets = async (req, res) => {
  try {
    const query = `
      SELECT config_key, config_value FROM app_config
      WHERE config_key IN ('wc_test_customers_offset', 'wc_test_products_offset', 'wc_test_orders_offset')
    `;
    const result = await pool.query(query);

    const offsets = {
      customers: 0,
      products: 0,
      orders: 0
    };

    result.rows.forEach(row => {
      if (row.config_key === 'wc_test_customers_offset') {
        offsets.customers = parseInt(row.config_value) || 0;
      } else if (row.config_key === 'wc_test_products_offset') {
        offsets.products = parseInt(row.config_value) || 0;
      } else if (row.config_key === 'wc_test_orders_offset') {
        offsets.orders = parseInt(row.config_value) || 0;
      }
    });

    res.json({ success: true, offsets });
  } catch (error) {
    console.error('Error getting test offsets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Met à jour les offsets de test manuels
 * POST /api/sync/test-offsets
 * Body: { customers: 25, products: 50, orders: 100 }
 */
const updateTestOffsets = async (req, res) => {
  try {
    const { customers, products, orders } = req.body;

    if (customers !== undefined) {
      await pool.query(`
        INSERT INTO app_config (config_key, config_value, updated_at)
        VALUES ('wc_test_customers_offset', $1, NOW())
        ON CONFLICT (config_key)
        DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
      `, [customers.toString()]);
    }

    if (products !== undefined) {
      await pool.query(`
        INSERT INTO app_config (config_key, config_value, updated_at)
        VALUES ('wc_test_products_offset', $1, NOW())
        ON CONFLICT (config_key)
        DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
      `, [products.toString()]);
    }

    if (orders !== undefined) {
      await pool.query(`
        INSERT INTO app_config (config_key, config_value, updated_at)
        VALUES ('wc_test_orders_offset', $1, NOW())
        ON CONFLICT (config_key)
        DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
      `, [orders.toString()]);
    }

    console.log(`✓ Test offsets updated: customers=${customers}, products=${products}, orders=${orders}`);

    res.json({ success: true, message: 'Offsets updated' });
  } catch (error) {
    console.error('Error updating test offsets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Reset les offsets de test à 0
 * DELETE /api/sync/test-offsets
 */
const resetTestOffsets = async (req, res) => {
  try {
    await pool.query(`
      UPDATE app_config
      SET config_value = '0', updated_at = NOW()
      WHERE config_key IN ('wc_test_customers_offset', 'wc_test_products_offset', 'wc_test_orders_offset')
    `);

    console.log('✓ Test offsets reset to 0');

    res.json({ success: true, message: 'Offsets reset to 0' });
  } catch (error) {
    console.error('Error resetting test offsets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * NOUVEAU: Reçoit un test avec 1 item de chaque type (Phase 0 module v2)
 * POST /api/sync/test
 * Body: { customer: {type, wp_id, user, meta}, product: {type, wp_id, product_type, post, meta, variations}, order: {type, wp_id, post, meta, items} }
 */
const receiveTest = async (req, res) => {
  try {
    const { customer, product, order } = req.body;

    console.log('📋 [TEST PHASE 0] Received RAW test data');

    const results = {
      success: true,
      timestamp: new Date().toISOString(),
      customer: null,
      product: null,
      order: null,
      errors: []
    };

    // Test Customer
    if (customer && customer.type === 'customer') {
      try {
        console.log(`  → Customer: WP ID ${customer.wp_id}, Email: ${customer.user?.user_email}`);

        // Transform and insert customer
        const customerData = transformCustomer({
          user: customer.user,
          meta: customer.meta
        });

        const insertResult = await insertCustomer(pool, customerData);

        results.customer = {
          wp_user_id: insertResult.wp_user_id,
          db_id: insertResult.id,
          email: customerData.email,
          inserted: insertResult.inserted,
          message: insertResult.inserted ? 'Customer inserted successfully' : 'Customer updated successfully'
        };

        console.log(`    ✓ Customer ${insertResult.inserted ? 'inserted' : 'updated'}: DB ID ${insertResult.id}`);
      } catch (error) {
        console.error(`    ✗ Customer error: ${error.message}`);
        results.errors.push(`Customer: ${error.message}`);
        results.customer = { error: error.message };
      }
    }

    // Test Product
    if (product && product.type === 'product') {
      try {
        console.log(`  → Product: WP ID ${product.wp_id}, Type: ${product.product_type}, Title: ${product.post?.post_title}`);

        // Insert product with variations if any
        const insertResult = await insertProductWithVariations(pool, {
          product_type: product.product_type,
          post: product.post,
          meta: product.meta,
          image_url: product.image_url,
          variations: product.variations || []
        });

        results.product = {
          wp_product_id: insertResult.parent.wp_product_id,
          db_id: insertResult.parent.id,
          product_type: product.product_type,
          inserted: insertResult.parent.inserted,
          variations_count: insertResult.total_variations,
          variations: insertResult.variations,
          message: `Product ${insertResult.parent.inserted ? 'inserted' : 'updated'} with ${insertResult.total_variations} variation(s)`
        };

        console.log(`    ✓ Product ${insertResult.parent.inserted ? 'inserted' : 'updated'}: DB ID ${insertResult.parent.id}`);
        if (insertResult.total_variations > 0) {
          console.log(`    ✓ ${insertResult.total_variations} variation(s) processed`);
        }
      } catch (error) {
        console.error(`    ✗ Product error: ${error.message}`);
        results.errors.push(`Product: ${error.message}`);
        results.product = { error: error.message };
      }
    }

    // Test Order
    if (order && order.type === 'order') {
      try {
        console.log(`  → Order: WP ID ${order.wp_id}, Status: ${order.post?.post_status}, Items: ${order.items?.length || 0}`);

        // Transform order
        const orderData = transformOrder({
          post: order.post,
          meta: order.meta
        });

        // Transform order items
        const itemsData = transformOrderItems(order.items || [], orderData.wp_order_id);

        // Insert order with items
        const insertResult = await insertOrder(pool, orderData, itemsData);

        results.order = {
          wp_order_id: insertResult.wp_order_id,
          db_id: insertResult.id,
          inserted: insertResult.inserted,
          items_count: insertResult.items_inserted,
          message: `Order ${insertResult.inserted ? 'inserted' : 'updated'} with ${insertResult.items_inserted} item(s)`
        };

        console.log(`    ✓ Order ${insertResult.inserted ? 'inserted' : 'updated'}: DB ID ${insertResult.id}`);
        console.log(`    ✓ ${insertResult.items_inserted} item(s) inserted`);
      } catch (error) {
        console.error(`    ✗ Order error: ${error.message}`);
        results.errors.push(`Order: ${error.message}`);
        results.order = { error: error.message };
      }
    }

    console.log(`✅ Test completed. Success: ${results.errors.length === 0}, Errors: ${results.errors.length}`);

    res.json(results);

  } catch (error) {
    console.error('❌ Error in test endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * NOUVEAU: Reçoit un batch bulk pour sync v2 (Phase 1)
 * POST /api/sync/bulk
 * Body: { type: 'customers'|'products'|'orders', batch: [...], offset: 0, total: 1000 }
 */
const receiveBulk = async (req, res) => {
  try {
    const { type, batch, offset, total } = req.body;

    if (!type || !['customers', 'products', 'orders'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing type. Must be: customers, products, or orders'
      });
    }

    if (!batch || !Array.isArray(batch)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid batch format. Expected array.'
      });
    }

    console.log(`📦 [BULK SYNC] Receiving ${type}: ${batch.length} items (offset: ${offset}/${total})`);

    // Route vers le bon handler selon le type
    let inserted = 0;
    let updated = 0;
    let errors = [];

    // Process each item with transformers
    try {
      if (type === 'customers') {
        for (const item of batch) {
          try {
            const customerData = transformCustomer({
              user: item.user,
              meta: item.meta
            });

            const result = await insertCustomer(pool, customerData);

            if (result.inserted) {
              inserted++;
            } else {
              updated++;
            }

            console.log(`  ✓ Customer ${result.wp_user_id} ${result.inserted ? 'inserted' : 'updated'}`);
          } catch (error) {
            console.error(`  ✗ Customer ${item.wp_id} error: ${error.message}`);
            errors.push({ item_id: item.wp_id, error: error.message });
          }
        }
      } else if (type === 'products') {
        for (const item of batch) {
          try {
            // DIAGNOSTIC: Log variations received from WordPress
            const variationsReceived = (item.variations || []).length;

            const result = await insertProductWithVariations(pool, {
              product_type: item.product_type,
              post: item.post,
              meta: item.meta,
              image_url: item.image_url,
              brand: item.brand,
              sub_brand: item.sub_brand,
              category: item.category,
              sub_category: item.sub_category,
              variations: item.variations || []
            });

            if (result.parent.inserted) {
              inserted++;
            } else {
              updated++;
            }

            // Enhanced log showing variations received vs inserted
            console.log(`  ✓ Product ${result.parent.wp_product_id} ${result.parent.inserted ? 'inserted' : 'updated'} - Type: ${item.product_type}, Received: ${variationsReceived} variation(s), Inserted: ${result.total_variations} variation(s)`);
          } catch (error) {
            console.error(`  ✗ Product ${item.wp_id} error: ${error.message}`);
            errors.push({ item_id: item.wp_id, error: error.message });
          }
        }
      } else if (type === 'orders') {
        for (const item of batch) {
          try {
            const orderData = transformOrder({
              post: item.post,
              meta: item.meta
            });

            const itemsData = transformOrderItems(item.items || [], orderData.wp_order_id);

            const result = await insertOrder(pool, orderData, itemsData);

            if (result.inserted) {
              inserted++;
            } else {
              updated++;
            }

            console.log(`  ✓ Order ${result.wp_order_id} ${result.inserted ? 'inserted' : 'updated'} with ${result.items_inserted} item(s)`);
          } catch (error) {
            console.error(`  ✗ Order ${item.wp_id} error: ${error.message}`);
            errors.push({ item_id: item.wp_id, error: error.message });
          }
        }
      }
    } catch (error) {
      console.error(`❌ Bulk sync error: ${error.message}`);
      throw error;
    }

    console.log(`✅ Bulk sync completed: ${inserted} inserted, ${updated} updated, ${errors.length} errors`);

    res.json({
      success: true,
      type,
      batch_size: batch.length,
      inserted,
      updated,
      errors,
      message: 'Bulk endpoint ready. DB insertion will be implemented after table creation.'
    });

  } catch (error) {
    console.error('❌ Error in bulk endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  receiveCustomers,
  receiveProducts,
  receiveOrders,
  downloadLogs,
  getStats,
  clearLogs,
  ping,
  getTestOffsets,
  updateTestOffsets,
  resetTestOffsets,
  receiveTest,
  receiveBulk
};
