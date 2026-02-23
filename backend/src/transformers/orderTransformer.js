/**
 * Order Transformer - VPS Side
 * Transforms RAW WordPress order data into clean DB format
 */

const { convertWCDate } = require('../utils/dateUtils');

/**
 * Transform RAW order data from WordPress
 * @param {Object} rawData - RAW data from WordPress (post + meta + items)
 * @returns {Object} Transformed order ready for DB insertion
 */
function transformOrder(rawData) {
  if (!rawData || !rawData.post) {
    throw new Error('Invalid order data: missing post object');
  }

  const { post, meta } = rawData;

  // Helper to get meta value
  const getMeta = (key, defaultValue = null) => {
    return meta && meta[key] !== undefined ? meta[key] : defaultValue;
  };

  return {
    wp_order_id: parseInt(post.ID),
    wp_customer_id: getMeta('_customer_user') && parseInt(getMeta('_customer_user')) > 0
      ? parseInt(getMeta('_customer_user'))
      : null,
    guid: post.guid,
    post_date: convertWCDate(post.post_date),
    post_status: post.post_status,
    post_modified: convertWCDate(post.post_modified),
    payment_method_title: getMeta('_payment_method_title'),
    created_via: getMeta('_created_via'),
    billing_first_name: getMeta('_billing_first_name'),
    billing_last_name: getMeta('_billing_last_name'),
    billing_address_1: getMeta('_billing_address_1'),
    billing_address_2: getMeta('_billing_address_2'),
    billing_city: getMeta('_billing_city'),
    billing_postcode: getMeta('_billing_postcode'),
    billing_country: getMeta('_billing_country'),
    billing_email: getMeta('_billing_email'),
    billing_phone: getMeta('_billing_phone'),
    shipping_first_name: getMeta('_shipping_first_name'),
    shipping_last_name: getMeta('_shipping_last_name'),
    shipping_address_1: getMeta('_shipping_address_1'),
    shipping_city: getMeta('_shipping_city'),
    shipping_postcode: getMeta('_shipping_postcode'),
    shipping_country: getMeta('_shipping_country'),
    shipping_phone: getMeta('_shipping_phone'),
    shipping_company: getMeta('_shipping_company'),
    cart_discount: parseFloat(getMeta('_cart_discount', 0)),
    cart_discount_tax: parseFloat(getMeta('_cart_discount_tax', 0)),
    order_shipping: parseFloat(getMeta('_order_shipping', 0)),
    order_shipping_tax: parseFloat(getMeta('_order_shipping_tax', 0)),
    order_tax: parseFloat(getMeta('_order_tax', 0)),
    order_total: parseFloat(getMeta('_order_total', 0)),
    prices_include_tax: getMeta('_prices_include_tax') === 'yes',
    billing_tax: getMeta('_billing_tax'),
    is_vat_exempt: getMeta('is_vat_exempt') === 'yes',
    order_language: getMeta('_wlr_order_language'),
    wdr_discounts: getMeta('_wdr_discounts') ? tryParseJson(getMeta('_wdr_discounts')) : null,
    order_total_cost: getMeta('_wc_cog_order_total_cost') ? parseFloat(getMeta('_wc_cog_order_total_cost')) : null,
    attribution_source_type: getMeta('_wc_order_attribution_source_type'),
    attribution_referrer: getMeta('_wc_order_attribution_referrer'),
    attribution_utm_source: getMeta('_wc_order_attribution_utm_source'),
    attribution_utm_medium: getMeta('_wc_order_attribution_utm_medium'),
    attribution_session_entry: getMeta('_wc_order_attribution_session_entry'),
    attribution_session_start_time: convertWCDate(getMeta('_wc_order_attribution_session_start_time')),
    attribution_session_pages: (() => {
      const val = parseInt(getMeta('_wc_order_attribution_session_pages'));
      return !isNaN(val) ? val : null;
    })(),
    attribution_session_count: (() => {
      const val = parseInt(getMeta('_wc_order_attribution_session_count'));
      return !isNaN(val) ? val : null;
    })(),
    attribution_user_agent: getMeta('_wc_order_attribution_user_agent'),
    attribution_device_type: getMeta('_wc_order_attribution_device_type'),
    mondial_relay_pickup_info: getMeta('_wms_mondial_relay_pickup_info')
      ? tryParseJson(getMeta('_wms_mondial_relay_pickup_info'))
      : null,
    mollie_payment_id: getMeta('_mollie_payment_id'),
    transaction_id: getMeta('_transaction_id'),
    mollie_order_id: getMeta('_mollie_order_id'),
    mollie_payment_mode: getMeta('_mollie_payment_mode'),
    mollie_customer_id: getMeta('_mollie_customer_id'),
    date_paid: (() => {
      const val = parseInt(getMeta('_date_paid'));
      return !isNaN(val) ? val : null;
    })(),
    paid_date: convertWCDate(getMeta('_paid_date')),
    mollie_payment_instructions: getMeta('_mollie_payment_instructions'),
    mollie_paid_and_processed: getMeta('_mollie_paid_and_processed') === '1'
  };
}

/**
 * Transform order items from WordPress
 * @param {Array} items - RAW items from WordPress
 * @param {Number} wpOrderId - WordPress order ID
 * @returns {Array} Transformed items ready for DB insertion
 */
function transformOrderItems(items, wpOrderId) {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  return items.map(itemData => {
    const { item, meta } = itemData;

    // Helper to get meta value
    const getMeta = (key, defaultValue = null) => {
      return meta && meta[key] !== undefined ? meta[key] : defaultValue;
    };

    // Extract all pa_* attributes
    const productAttributes = {};
    if (meta) {
      Object.keys(meta).forEach(key => {
        if (key.startsWith('pa_') || key.startsWith('attribute_pa_')) {
          productAttributes[key] = meta[key];
        }
      });
    }

    return {
      wp_order_id: wpOrderId,
      order_item_id: parseInt(item.order_item_id),
      order_item_name: item.order_item_name,
      order_item_type: item.order_item_type,
      product_id: (() => {
        const val = parseInt(getMeta('_product_id'));
        return !isNaN(val) ? val : null;
      })(),
      variation_id: (() => {
        const val = parseInt(getMeta('_variation_id'));
        return !isNaN(val) ? val : null;
      })(),
      qty: (() => {
        const val = parseInt(getMeta('_qty'));
        return !isNaN(val) ? val : null;
      })(),
      tax_class: getMeta('_tax_class'),
      line_subtotal: getMeta('_line_subtotal') ? parseFloat(getMeta('_line_subtotal')) : null,
      line_subtotal_tax: getMeta('_line_subtotal_tax') ? parseFloat(getMeta('_line_subtotal_tax')) : null,
      line_total: getMeta('_line_total') ? parseFloat(getMeta('_line_total')) : null,
      line_tax: getMeta('_line_tax') ? parseFloat(getMeta('_line_tax')) : null,
      line_tax_data: getMeta('_line_tax_data') ? tryParseJson(getMeta('_line_tax_data')) : null,
      product_attributes: Object.keys(productAttributes).length > 0 ? productAttributes : null,
      advanced_discount: getMeta('_advanced_woo_discount_item_total_discount')
        ? tryParseJson(getMeta('_advanced_woo_discount_item_total_discount'))
        : null,
      wdr_discounts: getMeta('_wdr_discounts') ? tryParseJson(getMeta('_wdr_discounts')) : null,
      item_cost: getMeta('_wc_cog_item_cost') ? parseFloat(getMeta('_wc_cog_item_cost')) : null,
      item_total_cost: getMeta('_wc_cog_item_total_cost') ? parseFloat(getMeta('_wc_cog_item_total_cost')) : null,
      reduced_stock: getMeta('_reduced_stock') === '1'
    };
  });
}

/**
 * Insert or update order in database (with items)
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} orderData - Transformed order data
 * @param {Array} itemsData - Transformed items data
 * @returns {Object} Result with inserted/updated info
 */
async function insertOrder(pool, orderData, itemsData) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert/Update order
    const orderQuery = `
      INSERT INTO orders (
        wp_order_id, wp_customer_id, guid, post_date, post_status, post_modified,
        payment_method_title, created_via,
        billing_first_name, billing_last_name, billing_address_1, billing_address_2,
        billing_city, billing_postcode, billing_country, billing_email, billing_phone,
        shipping_first_name, shipping_last_name, shipping_address_1, shipping_city,
        shipping_postcode, shipping_country, shipping_phone, shipping_company,
        cart_discount, cart_discount_tax, order_shipping, order_shipping_tax,
        order_tax, order_total, prices_include_tax, billing_tax, is_vat_exempt,
        order_language, wdr_discounts, order_total_cost,
        attribution_source_type, attribution_referrer, attribution_utm_source,
        attribution_utm_medium, attribution_session_entry, attribution_session_start_time,
        attribution_session_pages, attribution_session_count, attribution_user_agent,
        attribution_device_type, mondial_relay_pickup_info,
        mollie_payment_id, transaction_id, mollie_order_id, mollie_payment_mode,
        mollie_customer_id, date_paid, paid_date, mollie_payment_instructions,
        mollie_paid_and_processed, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47,
        $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, NOW()
      )
      ON CONFLICT (wp_order_id)
      DO UPDATE SET
        wp_customer_id = EXCLUDED.wp_customer_id,
        guid = EXCLUDED.guid,
        post_date = EXCLUDED.post_date,
        post_status = EXCLUDED.post_status,
        post_modified = EXCLUDED.post_modified,
        payment_method_title = EXCLUDED.payment_method_title,
        created_via = EXCLUDED.created_via,
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
        cart_discount_tax = EXCLUDED.cart_discount_tax,
        order_shipping = EXCLUDED.order_shipping,
        order_shipping_tax = EXCLUDED.order_shipping_tax,
        order_tax = EXCLUDED.order_tax,
        order_total = EXCLUDED.order_total,
        prices_include_tax = EXCLUDED.prices_include_tax,
        billing_tax = EXCLUDED.billing_tax,
        is_vat_exempt = EXCLUDED.is_vat_exempt,
        order_language = EXCLUDED.order_language,
        wdr_discounts = EXCLUDED.wdr_discounts,
        order_total_cost = EXCLUDED.order_total_cost,
        attribution_source_type = EXCLUDED.attribution_source_type,
        attribution_referrer = EXCLUDED.attribution_referrer,
        attribution_utm_source = EXCLUDED.attribution_utm_source,
        attribution_utm_medium = EXCLUDED.attribution_utm_medium,
        attribution_session_entry = EXCLUDED.attribution_session_entry,
        attribution_session_start_time = EXCLUDED.attribution_session_start_time,
        attribution_session_pages = EXCLUDED.attribution_session_pages,
        attribution_session_count = EXCLUDED.attribution_session_count,
        attribution_user_agent = EXCLUDED.attribution_user_agent,
        attribution_device_type = EXCLUDED.attribution_device_type,
        mondial_relay_pickup_info = EXCLUDED.mondial_relay_pickup_info,
        mollie_payment_id = EXCLUDED.mollie_payment_id,
        transaction_id = EXCLUDED.transaction_id,
        mollie_order_id = EXCLUDED.mollie_order_id,
        mollie_payment_mode = EXCLUDED.mollie_payment_mode,
        mollie_customer_id = EXCLUDED.mollie_customer_id,
        date_paid = EXCLUDED.date_paid,
        paid_date = EXCLUDED.paid_date,
        mollie_payment_instructions = EXCLUDED.mollie_payment_instructions,
        mollie_paid_and_processed = EXCLUDED.mollie_paid_and_processed,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
    `;

    const orderValues = [
      orderData.wp_order_id, orderData.wp_customer_id, orderData.guid,
      orderData.post_date, orderData.post_status, orderData.post_modified,
      orderData.payment_method_title, orderData.created_via,
      orderData.billing_first_name, orderData.billing_last_name,
      orderData.billing_address_1, orderData.billing_address_2,
      orderData.billing_city, orderData.billing_postcode, orderData.billing_country,
      orderData.billing_email, orderData.billing_phone,
      orderData.shipping_first_name, orderData.shipping_last_name,
      orderData.shipping_address_1, orderData.shipping_city,
      orderData.shipping_postcode, orderData.shipping_country,
      orderData.shipping_phone, orderData.shipping_company,
      orderData.cart_discount, orderData.cart_discount_tax,
      orderData.order_shipping, orderData.order_shipping_tax,
      orderData.order_tax, orderData.order_total, orderData.prices_include_tax,
      orderData.billing_tax, orderData.is_vat_exempt, orderData.order_language,
      orderData.wdr_discounts, orderData.order_total_cost,
      orderData.attribution_source_type, orderData.attribution_referrer,
      orderData.attribution_utm_source, orderData.attribution_utm_medium,
      orderData.attribution_session_entry, orderData.attribution_session_start_time,
      orderData.attribution_session_pages, orderData.attribution_session_count,
      orderData.attribution_user_agent, orderData.attribution_device_type,
      orderData.mondial_relay_pickup_info,
      orderData.mollie_payment_id, orderData.transaction_id,
      orderData.mollie_order_id, orderData.mollie_payment_mode,
      orderData.mollie_customer_id, orderData.date_paid, orderData.paid_date,
      orderData.mollie_payment_instructions, orderData.mollie_paid_and_processed
    ];

    const orderResult = await client.query(orderQuery, orderValues);
    const inserted = orderResult.rows[0].inserted;

    // Delete existing items if update
    if (!inserted) {
      await client.query('DELETE FROM order_items WHERE wp_order_id = $1', [orderData.wp_order_id]);
    }

    // Insert items
    let itemsInserted = 0;
    for (const itemData of itemsData) {
      const itemQuery = `
        INSERT INTO order_items (
          wp_order_id, order_item_id, order_item_name, order_item_type,
          product_id, variation_id, qty, tax_class,
          line_subtotal, line_subtotal_tax, line_total, line_tax, line_tax_data,
          product_attributes, advanced_discount, wdr_discounts,
          item_cost, item_total_cost, reduced_stock
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `;

      const itemValues = [
        itemData.wp_order_id, itemData.order_item_id, itemData.order_item_name,
        itemData.order_item_type, itemData.product_id, itemData.variation_id,
        itemData.qty, itemData.tax_class, itemData.line_subtotal,
        itemData.line_subtotal_tax, itemData.line_total, itemData.line_tax,
        JSON.stringify(itemData.line_tax_data),
        JSON.stringify(itemData.product_attributes),
        JSON.stringify(itemData.advanced_discount),
        JSON.stringify(itemData.wdr_discounts),
        itemData.item_cost, itemData.item_total_cost, itemData.reduced_stock
      ];

      await client.query(itemQuery, itemValues);
      itemsInserted++;
    }

    await client.query('COMMIT');

    return {
      id: orderResult.rows[0].id,
      wp_order_id: orderData.wp_order_id,
      inserted,
      items_inserted: itemsInserted
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Try to parse JSON, return null if fails
 */
function tryParseJson(value) {
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    // Handle PHP serialized data (basic conversion)
    if (value.startsWith('a:') || value.startsWith('s:')) {
      // For now, just store as string in JSONB
      return { _serialized: value };
    }
    return JSON.parse(value);
  } catch (e) {
    return { _raw: value };
  }
}

module.exports = {
  transformOrder,
  transformOrderItems,
  insertOrder
};
