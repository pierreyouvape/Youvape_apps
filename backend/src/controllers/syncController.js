const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

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
          customer_id, email, first_name, last_name, phone, username,
          date_created, total_spent, order_count,
          billing_address, shipping_address, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (customer_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          phone = EXCLUDED.phone,
          username = EXCLUDED.username,
          date_created = EXCLUDED.date_created,
          total_spent = EXCLUDED.total_spent,
          order_count = EXCLUDED.order_count,
          billing_address = EXCLUDED.billing_address,
          shipping_address = EXCLUDED.shipping_address,
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
        customer.date_created || null,
        customer.total_spent || 0,
        customer.order_count || 0,
        JSON.stringify(customer.billing_address || {}),
        JSON.stringify(customer.shipping_address || {})
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

    for (const product of data) {
      const query = `
        INSERT INTO products (
          product_id, sku, name, price, regular_price, sale_price, cost_price,
          stock_quantity, stock_status, category, categories,
          date_created, date_modified, total_sales, image_url, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (product_id)
        DO UPDATE SET
          sku = EXCLUDED.sku,
          name = EXCLUDED.name,
          price = EXCLUDED.price,
          regular_price = EXCLUDED.regular_price,
          sale_price = EXCLUDED.sale_price,
          cost_price = EXCLUDED.cost_price,
          stock_quantity = EXCLUDED.stock_quantity,
          stock_status = EXCLUDED.stock_status,
          category = EXCLUDED.category,
          categories = EXCLUDED.categories,
          date_created = EXCLUDED.date_created,
          date_modified = EXCLUDED.date_modified,
          total_sales = EXCLUDED.total_sales,
          image_url = EXCLUDED.image_url,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `;

      const values = [
        product.product_id,
        product.sku || null,
        product.name,
        product.price || 0,
        product.regular_price || null,
        product.sale_price || null,
        product.cost_price || null,
        product.stock_quantity || null,
        product.stock_status || 'instock',
        product.category || null,
        JSON.stringify(product.categories || []),
        product.date_created || null,
        product.date_modified || null,
        product.total_sales || 0,
        product.image_url || null
      ];

      const result = await pool.query(query, values);
      if (result.rows[0].inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    console.log(`✓ Products: ${data.length} received, ${inserted} inserted, ${updated} updated (${sync_type})`);

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
            order_id, order_number, status, total, subtotal,
            shipping_total, discount_total, tax_total,
            payment_method, payment_method_title, currency,
            date_created, date_completed, date_modified,
            customer_id, shipping_method, shipping_method_title, shipping_country,
            billing_address, shipping_address, customer_note, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
          ON CONFLICT (order_id)
          DO UPDATE SET
            order_number = EXCLUDED.order_number,
            status = EXCLUDED.status,
            total = EXCLUDED.total,
            subtotal = EXCLUDED.subtotal,
            shipping_total = EXCLUDED.shipping_total,
            discount_total = EXCLUDED.discount_total,
            tax_total = EXCLUDED.tax_total,
            payment_method = EXCLUDED.payment_method,
            payment_method_title = EXCLUDED.payment_method_title,
            currency = EXCLUDED.currency,
            date_created = EXCLUDED.date_created,
            date_completed = EXCLUDED.date_completed,
            date_modified = EXCLUDED.date_modified,
            customer_id = EXCLUDED.customer_id,
            shipping_method = EXCLUDED.shipping_method,
            shipping_method_title = EXCLUDED.shipping_method_title,
            shipping_country = EXCLUDED.shipping_country,
            billing_address = EXCLUDED.billing_address,
            shipping_address = EXCLUDED.shipping_address,
            customer_note = EXCLUDED.customer_note,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `;

        const orderValues = [
          order.order_id,
          order.order_number,
          order.status || 'pending',
          order.total || 0,
          order.subtotal || 0,
          order.shipping_total || 0,
          order.discount_total || 0,
          order.tax_total || 0,
          order.payment_method || null,
          order.payment_method_title || null,
          order.currency || 'EUR',
          order.date_created || null,
          order.date_completed || null,
          order.date_modified || null,
          order.customer_id || null,
          order.shipping_method || null,
          order.shipping_method_title || null,
          order.shipping_country || null,
          JSON.stringify(order.billing_address || {}),
          JSON.stringify(order.shipping_address || {}),
          order.customer_note || null
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
                order_id, product_id, product_name, sku, quantity,
                price, regular_price, subtotal, total, discount, cost_price, tax
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;

            const itemValues = [
              order.order_id,
              item.product_id || null,
              item.product_name || '',
              item.sku || null,
              item.quantity || 0,
              item.price || 0,
              item.regular_price || null,
              item.subtotal || 0,
              item.total || 0,
              item.discount || 0,
              item.cost_price || null,
              item.tax || 0
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

module.exports = {
  receiveCustomers,
  receiveProducts,
  receiveOrders,
  downloadLogs,
  getStats,
  clearLogs,
  ping
};
