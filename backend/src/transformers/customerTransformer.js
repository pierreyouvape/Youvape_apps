/**
 * Customer Transformer - VPS Side
 * Transforms RAW WordPress data into clean DB format
 */

/**
 * Transform RAW customer data from WordPress
 * @param {Object} rawData - RAW data from WordPress (user + meta)
 * @returns {Object} Transformed customer ready for DB insertion
 */
function transformCustomer(rawData) {
  if (!rawData || !rawData.user) {
    throw new Error('Invalid customer data: missing user object');
  }

  const { user, meta } = rawData;

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

  return {
    wp_user_id: parseInt(user.ID),
    email: user.user_email,
    user_registered: validateTimestamp(user.user_registered),
    first_name: getMeta('first_name'),
    last_name: getMeta('last_name'),
    session_start_time: validateTimestamp(getMeta('_wc_order_attribution_session_start_time')),
    session_pages: getMeta('_wc_order_attribution_session_pages')
      ? parseInt(getMeta('_wc_order_attribution_session_pages'))
      : null,
    session_count: getMeta('_wc_order_attribution_session_count')
      ? parseInt(getMeta('_wc_order_attribution_session_count'))
      : null,
    device_type: getMeta('_wc_order_attribution_device_type'),
    date_of_birth: validateTimestamp(getMeta('wlr_dob'))
  };
}

/**
 * Insert or update customer in database
 * @param {Object} pool - PostgreSQL pool
 * @param {Object} customerData - Transformed customer data
 * @returns {Object} Result with inserted/updated info
 */
async function insertCustomer(pool, customerData) {
  const query = `
    INSERT INTO customers (
      wp_user_id, email, user_registered, first_name, last_name,
      session_start_time, session_pages, session_count, device_type, date_of_birth,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (wp_user_id)
    DO UPDATE SET
      email = EXCLUDED.email,
      user_registered = EXCLUDED.user_registered,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      session_start_time = EXCLUDED.session_start_time,
      session_pages = EXCLUDED.session_pages,
      session_count = EXCLUDED.session_count,
      device_type = EXCLUDED.device_type,
      date_of_birth = EXCLUDED.date_of_birth,
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `;

  const values = [
    customerData.wp_user_id,
    customerData.email,
    customerData.user_registered,
    customerData.first_name,
    customerData.last_name,
    customerData.session_start_time,
    customerData.session_pages,
    customerData.session_count,
    customerData.device_type,
    customerData.date_of_birth
  ];

  const result = await pool.query(query, values);

  return {
    id: result.rows[0].id,
    wp_user_id: customerData.wp_user_id,
    inserted: result.rows[0].inserted
  };
}

module.exports = {
  transformCustomer,
  insertCustomer
};
