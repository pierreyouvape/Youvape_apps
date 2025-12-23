/**
 * Webhook Controller - Gère les webhooks temps réel depuis YouSync
 */

const pool = require('../config/database');

// Token d'authentification (à configurer dans .env)
const YOUSYNC_TOKEN = process.env.YOUSYNC_TOKEN || '';

/**
 * Middleware de vérification du token
 */
const verifyToken = (req, res, next) => {
  const token = req.headers['x-yousync-token'] || req.body.token;

  if (!YOUSYNC_TOKEN) {
    console.warn('⚠️ YOUSYNC_TOKEN not configured in .env');
    return res.status(500).json({
      success: false,
      error: 'Webhook token not configured on server'
    });
  }

  if (!token || token !== YOUSYNC_TOKEN) {
    console.warn('⚠️ Invalid YouSync token received');
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing authentication token'
    });
  }

  next();
};

/**
 * Reçoit les événements de sync depuis YouSync
 * POST /api/webhook/sync
 *
 * Body: {
 *   token: "xxx",
 *   events: [
 *     { type: "order", action: "create|update|delete", wp_id: 123, data: {...} }
 *   ],
 *   timestamp: "2024-12-23T10:30:00Z",
 *   source: "yousync"
 * }
 */
const receiveSync = async (req, res) => {
  try {
    const { events, timestamp, source } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Expected events array.'
      });
    }

    console.log(`📥 [YouSync] Received ${events.length} event(s) from ${source || 'unknown'}`);

    const results = {
      success: true,
      processed: 0,
      errors: [],
      details: {
        orders: { created: 0, updated: 0, deleted: 0 },
        products: { created: 0, updated: 0, deleted: 0 },
        customers: { created: 0, updated: 0, deleted: 0 },
        refunds: { created: 0, updated: 0, deleted: 0 }
      }
    };

    for (const event of events) {
      try {
        const { type, action, wp_id, data } = event;

        if (!type || !action || !wp_id) {
          results.errors.push({ wp_id, error: 'Missing type, action or wp_id' });
          continue;
        }

        // Route vers le bon handler
        switch (type) {
          case 'order':
            await processOrderEvent(action, wp_id, data, results);
            break;
          case 'product':
            await processProductEvent(action, wp_id, data, results);
            break;
          case 'customer':
            await processCustomerEvent(action, wp_id, data, results);
            break;
          case 'refund':
            await processRefundEvent(action, wp_id, data, results);
            break;
          default:
            results.errors.push({ wp_id, error: `Unknown type: ${type}` });
        }

        results.processed++;

      } catch (error) {
        console.error(`  ✗ Event error:`, error.message);
        results.errors.push({
          wp_id: event.wp_id,
          type: event.type,
          error: error.message
        });
      }
    }

    console.log(`✅ [YouSync] Processed ${results.processed}/${events.length} events, ${results.errors.length} error(s)`);

    res.json(results);

  } catch (error) {
    console.error('❌ [YouSync] Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/* ============================================
 * ORDER HANDLERS
 * ============================================ */

async function processOrderEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    // Soft delete or mark as deleted
    await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2',
      ['deleted', wp_id]
    );
    results.details.orders.deleted++;
    console.log(`  ✓ Order #${wp_id} marked as deleted`);
    return;
  }

  if (action === 'update' && data.status && Object.keys(data).length <= 3) {
    // Light update - just status change
    await pool.query(
      'UPDATE orders SET status = $1, date_modified = $2, updated_at = NOW() WHERE order_id = $3',
      [data.status, data.date_modified || new Date(), wp_id]
    );
    results.details.orders.updated++;
    console.log(`  ✓ Order #${wp_id} status updated to ${data.status}`);
    return;
  }

  // Full create/update
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderQuery = `
      INSERT INTO orders (
        order_id, order_number, status, total, subtotal,
        shipping_total, discount_total, tax_total,
        payment_method, payment_method_title, currency,
        date_created, date_completed, date_paid, date_modified,
        customer_id, billing_address, shipping_address, customer_note,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
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
        date_completed = EXCLUDED.date_completed,
        date_paid = EXCLUDED.date_paid,
        date_modified = EXCLUDED.date_modified,
        customer_id = EXCLUDED.customer_id,
        billing_address = EXCLUDED.billing_address,
        shipping_address = EXCLUDED.shipping_address,
        customer_note = EXCLUDED.customer_note,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;

    const billingAddress = {
      first_name: data.billing_first_name,
      last_name: data.billing_last_name,
      company: data.billing_company,
      address_1: data.billing_address_1,
      address_2: data.billing_address_2,
      city: data.billing_city,
      postcode: data.billing_postcode,
      country: data.billing_country,
      phone: data.billing_phone,
      email: data.customer_email
    };

    const shippingAddress = {
      first_name: data.shipping_first_name,
      last_name: data.shipping_last_name,
      address_1: data.shipping_address_1,
      address_2: data.shipping_address_2,
      city: data.shipping_city,
      postcode: data.shipping_postcode,
      country: data.shipping_country
    };

    const values = [
      data.wp_order_id || wp_id,
      data.order_number || wp_id.toString(),
      data.status || 'pending',
      data.total || 0,
      data.subtotal || 0,
      data.shipping_total || 0,
      data.discount_total || 0,
      data.total_tax || 0,
      data.payment_method || null,
      data.payment_method_title || null,
      data.currency || 'EUR',
      data.date_created || null,
      data.date_completed || null,
      data.date_paid || null,
      data.date_modified || new Date(),
      data.customer_id || null,
      JSON.stringify(billingAddress),
      JSON.stringify(shippingAddress),
      data.customer_note || null
    ];

    const result = await client.query(orderQuery, values);
    const isInsert = result.rows[0].inserted;

    // Handle order items
    if (data.items && Array.isArray(data.items)) {
      // Delete existing items for updates
      if (!isInsert) {
        await client.query('DELETE FROM order_items WHERE order_id = $1', [wp_id]);
      }

      for (const item of data.items) {
        await client.query(`
          INSERT INTO order_items (
            order_id, product_id, variation_id, product_name, sku,
            quantity, price, subtotal, total, tax
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          wp_id,
          item.product_id || null,
          item.variation_id || null,
          item.name || '',
          item.sku || null,
          item.quantity || 0,
          item.total / (item.quantity || 1),
          item.subtotal || 0,
          item.total || 0,
          item.tax || 0
        ]);
      }
    }

    await client.query('COMMIT');

    if (isInsert) {
      results.details.orders.created++;
      console.log(`  ✓ Order #${wp_id} created`);
    } else {
      results.details.orders.updated++;
      console.log(`  ✓ Order #${wp_id} updated`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/* ============================================
 * PRODUCT HANDLERS
 * ============================================ */

async function processProductEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    await pool.query(
      'UPDATE products SET status = $1, updated_at = NOW() WHERE product_id = $2',
      ['deleted', wp_id]
    );
    results.details.products.deleted++;
    console.log(`  ✓ Product #${wp_id} marked as deleted`);
    return;
  }

  if (action === 'update' && data.stock_quantity !== undefined && Object.keys(data).length <= 3) {
    // Light update - just stock change
    await pool.query(
      'UPDATE products SET stock_quantity = $1, stock_status = $2, date_modified = NOW(), updated_at = NOW() WHERE product_id = $3',
      [data.stock_quantity, data.stock_status || 'instock', wp_id]
    );
    results.details.products.updated++;
    console.log(`  ✓ Product #${wp_id} stock updated to ${data.stock_quantity}`);
    return;
  }

  // Full create/update
  const query = `
    INSERT INTO products (
      product_id, parent_id, sku, name, description, short_description,
      price, regular_price, sale_price, stock_quantity, stock_status,
      type, status, category, sub_category, brand, sub_brand,
      image_url, date_created, date_modified, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
    ON CONFLICT (product_id)
    DO UPDATE SET
      parent_id = EXCLUDED.parent_id,
      sku = EXCLUDED.sku,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      short_description = EXCLUDED.short_description,
      price = EXCLUDED.price,
      regular_price = EXCLUDED.regular_price,
      sale_price = EXCLUDED.sale_price,
      stock_quantity = EXCLUDED.stock_quantity,
      stock_status = EXCLUDED.stock_status,
      type = EXCLUDED.type,
      status = EXCLUDED.status,
      category = EXCLUDED.category,
      sub_category = EXCLUDED.sub_category,
      brand = EXCLUDED.brand,
      sub_brand = EXCLUDED.sub_brand,
      image_url = EXCLUDED.image_url,
      date_modified = EXCLUDED.date_modified,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted
  `;

  const values = [
    data.wp_product_id || wp_id,
    data.parent_id || null,
    data.sku || null,
    data.name || '',
    data.description || null,
    data.short_description || null,
    data.price || 0,
    data.regular_price || null,
    data.sale_price || null,
    data.stock_quantity || null,
    data.stock_status || 'instock',
    data.type || 'simple',
    data.status || 'publish',
    data.category || null,
    data.sub_category || null,
    data.brand || null,
    data.sub_brand || null,
    data.image_url || null,
    data.date_created || null,
    data.date_modified || new Date()
  ];

  const result = await pool.query(query, values);

  if (result.rows[0].inserted) {
    results.details.products.created++;
    console.log(`  ✓ Product #${wp_id} created`);
  } else {
    results.details.products.updated++;
    console.log(`  ✓ Product #${wp_id} updated`);
  }
}

/* ============================================
 * CUSTOMER HANDLERS
 * ============================================ */

async function processCustomerEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    // Soft delete - on ne supprime pas vraiment les clients
    console.log(`  ⚠️ Customer #${wp_id} delete ignored (soft delete not implemented)`);
    return;
  }

  const query = `
    INSERT INTO customers (
      customer_id, email, first_name, last_name, phone, username, display_name,
      billing_address, shipping_address, date_created, date_modified,
      total_spent, order_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (customer_id)
    DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      phone = EXCLUDED.phone,
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      billing_address = EXCLUDED.billing_address,
      shipping_address = EXCLUDED.shipping_address,
      date_modified = EXCLUDED.date_modified,
      total_spent = EXCLUDED.total_spent,
      order_count = EXCLUDED.order_count,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted
  `;

  const billingAddress = {
    first_name: data.billing_first_name,
    last_name: data.billing_last_name,
    company: data.billing_company,
    address_1: data.billing_address_1,
    address_2: data.billing_address_2,
    city: data.billing_city,
    postcode: data.billing_postcode,
    country: data.billing_country,
    phone: data.billing_phone,
    email: data.billing_email
  };

  const shippingAddress = {
    first_name: data.shipping_first_name,
    last_name: data.shipping_last_name,
    company: data.shipping_company,
    address_1: data.shipping_address_1,
    address_2: data.shipping_address_2,
    city: data.shipping_city,
    postcode: data.shipping_postcode,
    country: data.shipping_country
  };

  const values = [
    data.wp_customer_id || wp_id,
    data.email || '',
    data.first_name || null,
    data.last_name || null,
    billingAddress.phone || null,
    data.username || null,
    data.display_name || null,
    JSON.stringify(billingAddress),
    JSON.stringify(shippingAddress),
    data.date_created || null,
    data.date_modified || new Date(),
    data.total_spent || 0,
    data.orders_count || 0
  ];

  const result = await pool.query(query, values);

  if (result.rows[0].inserted) {
    results.details.customers.created++;
    console.log(`  ✓ Customer #${wp_id} created`);
  } else {
    results.details.customers.updated++;
    console.log(`  ✓ Customer #${wp_id} updated`);
  }
}

/* ============================================
 * REFUND HANDLERS
 * ============================================ */

async function processRefundEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    await pool.query('DELETE FROM refunds WHERE wp_refund_id = $1', [wp_id]);
    results.details.refunds.deleted++;
    console.log(`  ✓ Refund #${wp_id} deleted`);
    return;
  }

  const query = `
    INSERT INTO refunds (
      wp_refund_id, wp_order_id, refund_amount, refund_reason, refund_date, refunded_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (wp_refund_id)
    DO UPDATE SET
      wp_order_id = EXCLUDED.wp_order_id,
      refund_amount = EXCLUDED.refund_amount,
      refund_reason = EXCLUDED.refund_reason,
      refund_date = EXCLUDED.refund_date,
      refunded_by = EXCLUDED.refunded_by
    RETURNING (xmax = 0) AS inserted
  `;

  const values = [
    data.wp_refund_id || wp_id,
    data.wp_order_id,
    data.refund_amount || 0,
    data.refund_reason || null,
    data.refund_date || new Date(),
    data.refunded_by || null
  ];

  const result = await pool.query(query, values);

  if (result.rows[0].inserted) {
    results.details.refunds.created++;
    console.log(`  ✓ Refund #${wp_id} created (Order: ${data.wp_order_id}, Amount: ${data.refund_amount}€)`);
  } else {
    results.details.refunds.updated++;
    console.log(`  ✓ Refund #${wp_id} updated`);
  }
}

module.exports = {
  verifyToken,
  receiveSync
};
