/**
 * Product Transformer - VPS Side
 * Transforms RAW WordPress product data into clean DB format
 * Handles: Simple products, Variable products (parent + variations)
 */

/**
 * Transform RAW product data from WordPress (SIMPLE or VARIABLE PARENT)
 * @param {Object} rawData - RAW data from WordPress (post + meta)
 * @returns {Object} Transformed product ready for DB insertion
 */
function transformProduct(rawData) {
  if (!rawData || !rawData.post) {
    throw new Error('Invalid product data: missing post object');
  }

  const { post, meta, product_type, brand, sub_brand } = rawData;

  // Helper to get meta value
  const getMeta = (key, defaultValue = null) => {
    return meta && meta[key] !== undefined ? meta[key] : defaultValue;
  };

  // Helper to validate timestamp (empty string = null)
  const validateTimestamp = (value) => {
    if (!value || value === '' || value === '0000-00-00 00:00:00') {
      return null;
    }
    return value;
  };

  // Base product fields (common to all types)
  const baseProduct = {
    wp_product_id: parseInt(post.ID),
    product_type: product_type || 'simple', // 'simple', 'variable', 'variation'
    wp_parent_id: post.post_parent ? parseInt(post.post_parent) : null,
    post_author: post.post_author ? parseInt(post.post_author) : null,
    post_date: validateTimestamp(post.post_date),
    post_title: post.post_title || null,
    post_status: post.post_status || null,
    guid: post.guid || null,
    sku: getMeta('_sku'),
    total_sales: getMeta('total_sales') ? parseInt(getMeta('total_sales')) : 0,
    sold_individually: getMeta('_sold_individually') === 'yes',
    weight: getMeta('_weight') ? parseFloat(getMeta('_weight')) : null,
    stock: getMeta('_stock') ? parseInt(getMeta('_stock')) : null,
    stock_status: getMeta('_stock_status'),
    product_attributes: tryParseJson(getMeta('_product_attributes')),
    wc_productdata_options: tryParseJson(getMeta('wc_productdata_options')),
    wc_cog_cost: getMeta('_wc_cog_cost') ? parseFloat(getMeta('_wc_cog_cost')) : null,
    product_join_stories: getMeta('product_join_stories'),
    thumbnail_id: getMeta('_thumbnail_id') ? parseInt(getMeta('_thumbnail_id')) : null,
    image_url: rawData.image_url || null,
    regular_price: getMeta('_regular_price') ? parseFloat(getMeta('_regular_price')) : null,
    price: getMeta('_price') ? parseFloat(getMeta('_price')) : null,
    brand: brand || null,
    sub_brand: sub_brand || null
  };

  // Additional fields for VARIABLE products
  if (product_type === 'variable') {
    baseProduct.product_version = getMeta('_product_version');
    baseProduct.woovr_show_image = getMeta('_woovr_show_image');
    baseProduct.woovr_show_price = getMeta('_woovr_show_price');
    baseProduct.woovr_show_description = getMeta('_woovr_show_description');
    baseProduct.yoast_wpseo_linkdex = getMeta('_yoast_wpseo_linkdex');
    baseProduct.yoast_wpseo_estimated_reading_time_minutes = getMeta('_yoast_wpseo_estimated-reading-time-minutes')
      ? parseInt(getMeta('_yoast_wpseo_estimated-reading-time-minutes')) : null;
    baseProduct.product_with_nicotine = getMeta('product_with_nicotine') === '1' || getMeta('_product_with_nicotine') === '1';
    baseProduct.product_excerpt_custom = getMeta('product_excerpt_custom');
    baseProduct.yoast_indexnow_last_ping = getMeta('_yoast_indexnow_last_ping');
    baseProduct.faq_title = getMeta('faq_title');
    baseProduct.accodion_list = getMeta('accodion_list') ? parseInt(getMeta('accodion_list')) : null;
    baseProduct.product_tip = getMeta('product_tip');
  }

  // Additional fields for BUNDLE products (woosb type)
  if (product_type === 'woosb') {
    baseProduct.woosb_ids = parseWoosbIds(getMeta('woosb_ids'));
  }

  return baseProduct;
}

/**
 * Transform RAW variation data from WordPress
 * @param {Object} rawVariation - RAW variation data (post + meta)
 * @param {number} parentWpId - Parent product WP ID
 * @returns {Object} Transformed variation ready for DB insertion
 */
function transformVariation(rawVariation, parentWpId) {
  if (!rawVariation || !rawVariation.post) {
    throw new Error('Invalid variation data: missing post object');
  }

  const { post, meta } = rawVariation;

  const getMeta = (key, defaultValue = null) => {
    return meta && meta[key] !== undefined ? meta[key] : defaultValue;
  };

  // Helper to validate timestamp (empty string = null)
  const validateTimestamp = (value) => {
    if (!value || value === '' || value === '0000-00-00 00:00:00') {
      return null;
    }
    return value;
  };

  // Extract all attribute_pa_* fields for product_attributes JSONB
  const productAttributes = {};
  if (meta) {
    Object.keys(meta).forEach(key => {
      if (key.startsWith('attribute_pa_')) {
        productAttributes[key] = meta[key];
      }
    });
  }

  return {
    wp_product_id: parseInt(post.ID),
    product_type: 'variation',
    wp_parent_id: parentWpId,
    post_date: validateTimestamp(post.post_date),
    post_title: post.post_title || null,
    post_excerpt: post.post_excerpt || null,
    post_status: post.post_status || null,
    post_modified: validateTimestamp(post.post_modified),
    guid: post.guid || null,
    variation_description: getMeta('_variation_description'),
    total_sales: getMeta('total_sales') ? parseInt(getMeta('total_sales')) : 0,
    manage_stock: getMeta('_manage_stock') === 'yes',
    stock: getMeta('_stock') ? parseInt(getMeta('_stock')) : null,
    stock_status: getMeta('_stock_status'),
    product_attributes: productAttributes,
    sku: getMeta('_sku'),
    regular_price: getMeta('_regular_price') ? parseFloat(getMeta('_regular_price')) : null,
    thumbnail_id: getMeta('_thumbnail_id') ? parseInt(getMeta('_thumbnail_id')) : null,
    price: getMeta('_price') ? parseFloat(getMeta('_price')) : null,
    wc_cog_cost: getMeta('_wc_cog_cost') ? parseFloat(getMeta('_wc_cog_cost')) : null,
    global_unique_id: getMeta('_global_unique_id')
  };
}

/**
 * Helper to parse JSON or PHP serialized data
 * Returns JSONB-ready object or null
 */
function tryParseJson(value) {
  if (!value || value === '') return null;

  // Already an object
  if (typeof value === 'object') {
    return value;
  }

  // Try JSON parse
  try {
    return JSON.parse(value);
  } catch (e) {
    // If it's PHP serialized, return as-is string (VPS can handle later if needed)
    return value;
  }
}

/**
 * Parse woosb_ids from PHP serialized format to clean JSON array
 * Input: PHP serialized like 'a:3:{s:4:"83hb";a:5:{s:2:"id";s:6:"687674";...}...}'
 * Output: JSON array like [{"id": "687674", "qty": "1"}, ...]
 */
function parseWoosbIds(value) {
  if (!value || value === '') return null;

  // Already an array
  if (Array.isArray(value)) return value;

  // Already an object, convert to array
  if (typeof value === 'object') {
    return Object.values(value).map(item => ({
      id: item.id || null,
      qty: item.qty || "1"
    }));
  }

  // Parse PHP serialized format
  if (typeof value === 'string' && value.startsWith('a:')) {
    const items = [];

    // Extract all id values: s:2:"id";s:X:"VALUE"
    const idRegex = /s:2:"id";s:\d+:"(\d+)"/g;
    const qtyRegex = /s:3:"qty";s:\d+:"(\d+)"/g;

    const ids = Array.from(value.matchAll(idRegex)).map(m => m[1]);
    const qtys = Array.from(value.matchAll(qtyRegex)).map(m => m[1]);

    for (let i = 0; i < ids.length; i++) {
      items.push({
        id: ids[i],
        qty: qtys[i] || "1"
      });
    }

    return items.length > 0 ? items : null;
  }

  // Try JSON parse as fallback
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object') {
      return Object.values(parsed).map(item => ({
        id: item.id || null,
        qty: item.qty || "1"
      }));
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Insert or update product in database (simple, variable parent, or variation)
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} productData - Transformed product data
 * @returns {Object} Result with inserted/updated info
 */
async function insertProduct(pool, productData) {
  const query = `
    INSERT INTO products (
      wp_product_id, product_type, wp_parent_id, post_author, post_date,
      post_title, post_excerpt, post_status, post_modified, guid,
      sku, total_sales, sold_individually, weight, stock, stock_status,
      product_attributes, wc_productdata_options, wc_cog_cost, product_join_stories,
      thumbnail_id, image_url, regular_price, price,
      product_version, woovr_show_image, woovr_show_price, woovr_show_description,
      yoast_wpseo_linkdex, yoast_wpseo_estimated_reading_time_minutes,
      product_with_nicotine, product_excerpt_custom, yoast_indexnow_last_ping,
      faq_title, accodion_list, product_tip,
      variation_description, manage_stock, global_unique_id,
      woosb_ids, brand, sub_brand,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, NOW()
    )
    ON CONFLICT (wp_product_id)
    DO UPDATE SET
      product_type = EXCLUDED.product_type,
      wp_parent_id = EXCLUDED.wp_parent_id,
      post_author = EXCLUDED.post_author,
      post_date = EXCLUDED.post_date,
      post_title = EXCLUDED.post_title,
      post_excerpt = EXCLUDED.post_excerpt,
      post_status = EXCLUDED.post_status,
      post_modified = EXCLUDED.post_modified,
      guid = EXCLUDED.guid,
      sku = EXCLUDED.sku,
      total_sales = EXCLUDED.total_sales,
      sold_individually = EXCLUDED.sold_individually,
      weight = EXCLUDED.weight,
      stock = EXCLUDED.stock,
      stock_status = EXCLUDED.stock_status,
      product_attributes = EXCLUDED.product_attributes,
      wc_productdata_options = EXCLUDED.wc_productdata_options,
      wc_cog_cost = EXCLUDED.wc_cog_cost,
      product_join_stories = EXCLUDED.product_join_stories,
      thumbnail_id = EXCLUDED.thumbnail_id,
      image_url = EXCLUDED.image_url,
      regular_price = EXCLUDED.regular_price,
      price = EXCLUDED.price,
      product_version = EXCLUDED.product_version,
      woovr_show_image = EXCLUDED.woovr_show_image,
      woovr_show_price = EXCLUDED.woovr_show_price,
      woovr_show_description = EXCLUDED.woovr_show_description,
      yoast_wpseo_linkdex = EXCLUDED.yoast_wpseo_linkdex,
      yoast_wpseo_estimated_reading_time_minutes = EXCLUDED.yoast_wpseo_estimated_reading_time_minutes,
      product_with_nicotine = EXCLUDED.product_with_nicotine,
      product_excerpt_custom = EXCLUDED.product_excerpt_custom,
      yoast_indexnow_last_ping = EXCLUDED.yoast_indexnow_last_ping,
      faq_title = EXCLUDED.faq_title,
      accodion_list = EXCLUDED.accodion_list,
      product_tip = EXCLUDED.product_tip,
      variation_description = EXCLUDED.variation_description,
      manage_stock = EXCLUDED.manage_stock,
      global_unique_id = EXCLUDED.global_unique_id,
      woosb_ids = EXCLUDED.woosb_ids,
      brand = EXCLUDED.brand,
      sub_brand = EXCLUDED.sub_brand,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `;

  const values = [
    productData.wp_product_id,
    productData.product_type,
    productData.wp_parent_id,
    productData.post_author,
    productData.post_date,
    productData.post_title,
    productData.post_excerpt || null,
    productData.post_status,
    productData.post_modified || null,
    productData.guid,
    productData.sku,
    productData.total_sales,
    productData.sold_individually,
    productData.weight,
    productData.stock,
    productData.stock_status,
    JSON.stringify(productData.product_attributes),
    JSON.stringify(productData.wc_productdata_options),
    productData.wc_cog_cost,
    JSON.stringify(productData.product_join_stories),
    productData.thumbnail_id,
    productData.image_url,
    productData.regular_price,
    productData.price,
    productData.product_version || null,
    productData.woovr_show_image || null,
    productData.woovr_show_price || null,
    productData.woovr_show_description || null,
    productData.yoast_wpseo_linkdex || null,
    productData.yoast_wpseo_estimated_reading_time_minutes,
    productData.product_with_nicotine || false,
    productData.product_excerpt_custom || null,
    productData.yoast_indexnow_last_ping || null,
    productData.faq_title || null,
    productData.accodion_list,
    productData.product_tip || null,
    productData.variation_description || null,
    productData.manage_stock || false,
    productData.global_unique_id || null,
    JSON.stringify(productData.woosb_ids || null),
    productData.brand || null,
    productData.sub_brand || null
  ];

  const result = await pool.query(query, values);

  return {
    id: result.rows[0].id,
    wp_product_id: productData.wp_product_id,
    inserted: result.rows[0].inserted
  };
}

/**
 * Insert product with all its variations (for variable products)
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} rawProductData - RAW product data with variations array
 * @returns {Object} Result with parent and variations insert info
 */
async function insertProductWithVariations(pool, rawProductData) {
  const { variations } = rawProductData;

  // Transform and insert parent product
  const parentData = transformProduct(rawProductData);
  const parentResult = await insertProduct(pool, parentData);

  const variationsInserted = [];

  // Insert all variations if any
  if (variations && variations.length > 0) {
    for (const rawVariation of variations) {
      const variationData = transformVariation(rawVariation, parentData.wp_product_id);
      const varResult = await insertProduct(pool, variationData);
      variationsInserted.push({
        id: varResult.id,
        wp_product_id: varResult.wp_product_id,
        inserted: varResult.inserted
      });
    }
  }

  return {
    parent: {
      id: parentResult.id,
      wp_product_id: parentResult.wp_product_id,
      inserted: parentResult.inserted
    },
    variations: variationsInserted,
    total_variations: variationsInserted.length
  };
}

module.exports = {
  transformProduct,
  transformVariation,
  insertProduct,
  insertProductWithVariations
};
