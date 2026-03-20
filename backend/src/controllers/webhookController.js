/**
 * Webhook Controller - Gère les webhooks temps réel depuis YouSync
 * Adapté au schéma BDD existant (wp_order_id, wp_product_id, wp_user_id, etc.)
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
 * Schéma: wp_order_id, wp_customer_id, post_status, post_date, post_modified, etc.
 * ============================================ */

async function processOrderEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    await pool.query(
      'UPDATE orders SET post_status = $1, updated_at = NOW() WHERE wp_order_id = $2',
      ['deleted', wp_id]
    );
    results.details.orders.deleted++;
    console.log(`  ✓ Order #${wp_id} marked as deleted`);
    return;
  }

  // Light update - just status change
  if (action === 'update' && data.status && Object.keys(data).length <= 3) {
    const status = data.status.startsWith('wc-') ? data.status : `wc-${data.status}`;
    const updateResult = await pool.query(
      'UPDATE orders SET post_status = $1, post_modified = $2, updated_at = NOW() WHERE wp_order_id = $3 RETURNING wp_order_id',
      [status, data.date_modified || new Date(), wp_id]
    );
    if (updateResult.rowCount === 0) {
      // Order doesn't exist yet - skip, the polling will pick it up as FULL
      console.log(`  ⚠️ Order #${wp_id} not found for light update, skipping light update`);
      return;
    }
    results.details.orders.updated++;
    console.log(`  ✓ Order #${wp_id} status updated to ${status}`);
    return;
  }

  // Full create/update
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const status = (data.status || 'pending').startsWith('wc-') ? data.status : `wc-${data.status || 'pending'}`;

    const attr = data.attribution || {};
    const pm = data.payment_meta || {};
    const orderQuery = `
      INSERT INTO orders (
        wp_order_id, wp_customer_id, post_status, post_date, post_modified,
        payment_method_title, created_via,
        billing_first_name, billing_last_name, billing_address_1, billing_address_2,
        billing_city, billing_postcode, billing_country, billing_email, billing_phone,
        shipping_first_name, shipping_last_name, shipping_address_1,
        shipping_city, shipping_postcode, shipping_country, shipping_phone, shipping_company,
        cart_discount, order_shipping, order_tax, order_total,
        attribution_source_type, attribution_referrer,
        attribution_utm_source, attribution_utm_medium, attribution_utm_campaign,
        attribution_utm_content, attribution_utm_term,
        attribution_session_entry, attribution_session_start_time,
        attribution_session_pages, attribution_session_count,
        attribution_user_agent, attribution_device_type,
        transaction_id, mollie_payment_id, mollie_order_id,
        mollie_payment_mode, mollie_customer_id,
        date_paid, paid_date,
        mollie_payment_instructions, mollie_paid_and_processed,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,NOW())
      ON CONFLICT (wp_order_id)
      DO UPDATE SET
        wp_customer_id = EXCLUDED.wp_customer_id,
        post_status = EXCLUDED.post_status,
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
        shipping_phone = EXCLUDED.shipping_phone,
        shipping_company = EXCLUDED.shipping_company,
        cart_discount = EXCLUDED.cart_discount,
        order_shipping = EXCLUDED.order_shipping,
        order_tax = EXCLUDED.order_tax,
        order_total = EXCLUDED.order_total,
        attribution_source_type = COALESCE(EXCLUDED.attribution_source_type, orders.attribution_source_type),
        attribution_referrer = COALESCE(EXCLUDED.attribution_referrer, orders.attribution_referrer),
        attribution_utm_source = COALESCE(EXCLUDED.attribution_utm_source, orders.attribution_utm_source),
        attribution_utm_medium = COALESCE(EXCLUDED.attribution_utm_medium, orders.attribution_utm_medium),
        attribution_utm_campaign = COALESCE(EXCLUDED.attribution_utm_campaign, orders.attribution_utm_campaign),
        attribution_utm_content = COALESCE(EXCLUDED.attribution_utm_content, orders.attribution_utm_content),
        attribution_utm_term = COALESCE(EXCLUDED.attribution_utm_term, orders.attribution_utm_term),
        attribution_session_entry = COALESCE(EXCLUDED.attribution_session_entry, orders.attribution_session_entry),
        attribution_session_start_time = COALESCE(EXCLUDED.attribution_session_start_time, orders.attribution_session_start_time),
        attribution_session_pages = COALESCE(EXCLUDED.attribution_session_pages, orders.attribution_session_pages),
        attribution_session_count = COALESCE(EXCLUDED.attribution_session_count, orders.attribution_session_count),
        attribution_user_agent = COALESCE(EXCLUDED.attribution_user_agent, orders.attribution_user_agent),
        attribution_device_type = COALESCE(EXCLUDED.attribution_device_type, orders.attribution_device_type),
        transaction_id = COALESCE(EXCLUDED.transaction_id, orders.transaction_id),
        mollie_payment_id = COALESCE(EXCLUDED.mollie_payment_id, orders.mollie_payment_id),
        mollie_order_id = COALESCE(EXCLUDED.mollie_order_id, orders.mollie_order_id),
        mollie_payment_mode = COALESCE(EXCLUDED.mollie_payment_mode, orders.mollie_payment_mode),
        mollie_customer_id = COALESCE(EXCLUDED.mollie_customer_id, orders.mollie_customer_id),
        date_paid = COALESCE(EXCLUDED.date_paid, orders.date_paid),
        paid_date = COALESCE(EXCLUDED.paid_date, orders.paid_date),
        mollie_payment_instructions = COALESCE(EXCLUDED.mollie_payment_instructions, orders.mollie_payment_instructions),
        mollie_paid_and_processed = COALESCE(EXCLUDED.mollie_paid_and_processed, orders.mollie_paid_and_processed),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;

    const values = [
      wp_id,
      data.customer_id || null,
      status,
      data.date_created || null,
      data.date_modified || new Date(),
      data.payment_method_title || null,
      data.created_via || null,
      data.billing_first_name || null,
      data.billing_last_name || null,
      data.billing_address_1 || null,
      data.billing_address_2 || null,
      data.billing_city || null,
      data.billing_postcode || null,
      data.billing_country || null,
      data.billing_email || data.customer_email || null,
      data.billing_phone || null,
      data.shipping_first_name || null,
      data.shipping_last_name || null,
      data.shipping_address_1 || null,
      data.shipping_city || null,
      data.shipping_postcode || null,
      data.shipping_country || null,
      data.shipping_phone || null,
      data.shipping_company || null,
      data.discount_total || 0,
      data.shipping_total || 0,
      data.total_tax || 0,
      data.total || 0,
      attr.source_type || null, attr.referrer || null,
      attr.utm_source || null, attr.utm_medium || null, attr.utm_campaign || null,
      attr.utm_content || null, attr.utm_term || null,
      attr.session_entry || null, attr.session_start_time || null,
      attr.session_pages || null, attr.session_count || null,
      attr.user_agent || null, attr.device_type || null,
      pm.transaction_id || null, pm.mollie_payment_id || null, pm.mollie_order_id || null,
      pm.mollie_payment_mode || null, pm.mollie_customer_id || null,
      data.date_paid || null, data.date_paid || null,
      pm.mollie_payment_instructions || null, pm.mollie_paid_and_processed || false
    ];

    const result = await client.query(orderQuery, values);
    const isInsert = result.rows[0].inserted;

    // Handle order items
    if (data.items && Array.isArray(data.items)) {
      // Delete existing items for updates
      if (!isInsert) {
        await client.query('DELETE FROM order_items WHERE wp_order_id = $1', [wp_id]);
      }

      // Line items (19 colonnes)
      for (const item of data.items) {
        await client.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            product_id, variation_id, qty,
            line_subtotal, line_total, line_tax,
            tax_class, line_subtotal_tax, line_tax_data, product_attributes,
            advanced_discount, wdr_discounts, item_cost, item_total_cost, reduced_stock
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        `, [
          wp_id,
          item.id || item.item_id || item.order_item_id || 0,
          item.name || '',
          item.type || 'line_item',
          item.product_id || null,
          item.variation_id || null,
          item.quantity || 0,
          item.subtotal || 0,
          item.total || 0,
          item.tax || item.total_tax || 0,
          item.tax_class || null, item.line_subtotal_tax || 0,
          item.line_tax_data ? JSON.stringify(item.line_tax_data) : null,
          item.product_attributes ? JSON.stringify(item.product_attributes) : null,
          item.advanced_discount ? JSON.stringify(item.advanced_discount) : null,
          item.wdr_discounts ? JSON.stringify(item.wdr_discounts) : null,
          item.item_cost || null, item.item_total_cost || null,
          item.reduced_stock || false
        ]);
      }
    }

    // Coupon items
    if (data.coupon_items && Array.isArray(data.coupon_items)) {
      for (const item of data.coupon_items) {
        await client.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            line_total, line_tax
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          wp_id, item.item_id || 0, item.name, 'coupon',
          item.discount_amount || 0, item.discount_tax || 0
        ]);
      }
    }

    // Fee items
    if (data.fee_items && Array.isArray(data.fee_items)) {
      for (const item of data.fee_items) {
        await client.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            line_total, line_tax, tax_class
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          wp_id, item.item_id || 0, item.name, 'fee',
          item.total || 0, item.total_tax || 0, item.tax_class || null
        ]);
      }
    }

    // Tax items
    if (data.tax_items && Array.isArray(data.tax_items)) {
      for (const item of data.tax_items) {
        await client.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            line_total, line_tax, line_tax_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          wp_id, item.item_id || 0, item.label || item.rate_code, 'tax',
          item.tax_amount || 0, item.shipping_tax_amount || 0,
          JSON.stringify({ rate_code: item.rate_code, rate_id: item.rate_id, compound: item.compound })
        ]);
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
 * Schéma: wp_product_id, wp_parent_id, post_title, post_status, stock, stock_status, etc.
 * ============================================ */

async function processProductEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    await pool.query(
      'UPDATE products SET post_status = $1, updated_at = NOW() WHERE wp_product_id = $2',
      ['trash', wp_id]
    );
    results.details.products.deleted++;
    console.log(`  ✓ Product #${wp_id} marked as deleted`);
    return;
  }

  // Light update - just stock change
  if (action === 'update' && data.stock_quantity !== undefined && Object.keys(data).length <= 3) {
    const stockResult = await pool.query(
      'UPDATE products SET stock = $1, stock_status = $2, post_modified = NOW(), updated_at = NOW() WHERE wp_product_id = $3 RETURNING wp_product_id',
      [data.stock_quantity, data.stock_status || 'instock', wp_id]
    );
    if (stockResult.rowCount === 0) {
      console.log(`  ⚠️ Product #${wp_id} not found for light update, skipping light update`);
      return;
    }
    results.details.products.updated++;
    console.log(`  ✓ Product #${wp_id} stock updated to ${data.stock_quantity}`);
    return;
  }

  // Full create/update
  const query = `
    INSERT INTO products (
      wp_product_id, wp_parent_id, sku, post_title, post_excerpt,
      price, regular_price, stock, stock_status,
      product_type, post_status, weight, image_url,
      post_date, post_modified, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
    ON CONFLICT (wp_product_id)
    DO UPDATE SET
      wp_parent_id = EXCLUDED.wp_parent_id,
      sku = EXCLUDED.sku,
      post_title = EXCLUDED.post_title,
      post_excerpt = EXCLUDED.post_excerpt,
      price = EXCLUDED.price,
      regular_price = EXCLUDED.regular_price,
      stock = EXCLUDED.stock,
      stock_status = EXCLUDED.stock_status,
      product_type = EXCLUDED.product_type,
      post_status = EXCLUDED.post_status,
      weight = EXCLUDED.weight,
      image_url = EXCLUDED.image_url,
      post_modified = EXCLUDED.post_modified,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted
  `;

  const values = [
    wp_id,
    data.parent_id || null,
    data.sku || null,
    data.name || '',
    data.short_description || data.description || null,
    data.price || 0,
    data.regular_price || null,
    data.stock_quantity || null,
    data.stock_status || 'instock',
    data.type || 'simple',
    data.status || 'publish',
    data.weight || null,
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

  // Traiter les variations si presentes (donnees completes depuis YouSync v1.3.1)
  if (data.variations && Array.isArray(data.variations) && data.variations.length > 0) {
    for (const variation of data.variations) {
      if (variation.wp_product_id) {
        await processProductEvent(action, variation.wp_product_id, variation, results);
      }
    }
  }
}

/* ============================================
 * CUSTOMER HANDLERS
 * Schéma: wp_user_id, email, first_name, last_name, user_registered, etc.
 * ============================================ */

async function processCustomerEvent(action, wp_id, data, results) {
  if (action === 'delete') {
    console.log(`  ⚠️ Customer #${wp_id} delete ignored (soft delete not implemented)`);
    return;
  }

  const query = `
    INSERT INTO customers (
      wp_user_id, email, first_name, last_name, user_registered, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (wp_user_id)
    DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted
  `;

  const values = [
    wp_id,
    data.email || '',
    data.first_name || null,
    data.last_name || null,
    data.date_created || null
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
  // Vérifier si la table refunds existe
  const tableExists = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'refunds'
    )
  `);

  if (!tableExists.rows[0].exists) {
    console.log(`  ⚠️ Refund #${wp_id} ignored (refunds table does not exist)`);
    return;
  }

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
    wp_id,
    data.wp_order_id || data.order_id,
    data.refund_amount || data.amount || 0,
    data.refund_reason || data.reason || null,
    data.refund_date || data.date_created || new Date(),
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
