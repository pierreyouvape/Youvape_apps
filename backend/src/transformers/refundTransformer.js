/**
 * Refund Transformer - VPS Side
 * Transforms RAW WordPress refund data into clean DB format
 */

/**
 * Transform RAW refund data from WordPress
 * @param {Object} rawData - RAW data from WordPress (post + meta)
 * @returns {Object} Transformed refund ready for DB insertion
 */
function transformRefund(rawData) {
  if (!rawData || !rawData.post) {
    throw new Error('Invalid refund data: missing post object');
  }

  const { post, meta } = rawData;

  // Helper to get meta value
  const getMeta = (key, defaultValue = null) => {
    return meta && meta[key] !== undefined ? meta[key] : defaultValue;
  };

  // Helper to validate timestamp
  const validateTimestamp = (value) => {
    if (!value || value === '' || value === '0000-00-00 00:00:00') {
      return null;
    }
    return value;
  };

  return {
    wp_refund_id: parseInt(post.ID),
    wp_order_id: parseInt(post.post_parent),
    refund_amount: parseFloat(getMeta('_refund_amount', 0)),
    refund_reason: getMeta('_refund_reason') || post.post_excerpt || null,
    refund_date: validateTimestamp(post.post_date),
    refunded_by: getMeta('_refunded_by') ? parseInt(getMeta('_refunded_by')) : null,
    order_total: parseFloat(getMeta('_order_total', 0)), // This is negative
    order_tax: parseFloat(getMeta('_order_tax', 0)) // This is negative
  };
}

/**
 * Insert or update refund in database
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} refundData - Transformed refund data
 * @returns {Object} Result with inserted/updated info
 */
async function insertRefund(pool, refundData) {
  const query = `
    INSERT INTO refunds (
      wp_refund_id, wp_order_id, refund_amount, refund_reason,
      refund_date, refunded_by, order_total, order_tax, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (wp_refund_id)
    DO UPDATE SET
      wp_order_id = EXCLUDED.wp_order_id,
      refund_amount = EXCLUDED.refund_amount,
      refund_reason = EXCLUDED.refund_reason,
      refund_date = EXCLUDED.refund_date,
      refunded_by = EXCLUDED.refunded_by,
      order_total = EXCLUDED.order_total,
      order_tax = EXCLUDED.order_tax,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `;

  const values = [
    refundData.wp_refund_id,
    refundData.wp_order_id,
    refundData.refund_amount,
    refundData.refund_reason,
    refundData.refund_date,
    refundData.refunded_by,
    refundData.order_total,
    refundData.order_tax
  ];

  const result = await pool.query(query, values);

  return {
    id: result.rows[0].id,
    wp_refund_id: refundData.wp_refund_id,
    inserted: result.rows[0].inserted
  };
}

module.exports = {
  transformRefund,
  insertRefund
};
