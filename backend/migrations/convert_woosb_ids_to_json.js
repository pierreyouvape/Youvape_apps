/**
 * Migration: Convert woosb_ids from PHP serialized to JSON
 * This script reads all products with woosb_ids in PHP serialized format
 * and converts them to clean JSON arrays
 */

const pool = require('../src/config/database');

/**
 * Parse woosb_ids from PHP serialized format to clean JSON array
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

async function migrate() {
  try {
    console.log('🔄 Starting woosb_ids migration...');

    // Get all products with woosb_ids
    const selectQuery = `
      SELECT wp_product_id, post_title, woosb_ids
      FROM products
      WHERE product_type = 'woosb' AND woosb_ids IS NOT NULL
    `;

    const result = await pool.query(selectQuery);
    const products = result.rows;

    console.log(`📦 Found ${products.length} bundle products to convert`);

    let converted = 0;
    let skipped = 0;
    let errors = 0;

    for (const product of products) {
      try {
        // Try to parse the current value
        const currentValue = product.woosb_ids;

        // Skip if already in JSON array format
        if (Array.isArray(currentValue)) {
          console.log(`  ⏭️  ${product.wp_product_id} - Already JSON array, skipping`);
          skipped++;
          continue;
        }

        // Parse the PHP serialized data
        const parsedData = parseWoosbIds(currentValue);

        if (!parsedData) {
          console.log(`  ⚠️  ${product.wp_product_id} - Could not parse, skipping`);
          skipped++;
          continue;
        }

        // Update the database with JSON data
        const updateQuery = `
          UPDATE products
          SET woosb_ids = $1, updated_at = NOW()
          WHERE wp_product_id = $2
        `;

        await pool.query(updateQuery, [JSON.stringify(parsedData), product.wp_product_id]);

        console.log(`  ✅ ${product.wp_product_id} - "${product.post_title}" - Converted ${parsedData.length} item(s)`);
        converted++;
      } catch (error) {
        console.error(`  ❌ ${product.wp_product_id} - Error: ${error.message}`);
        errors++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Converted: ${converted}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📦 Total: ${products.length}`);

    console.log('\n✨ Migration completed!');

    // Verify a sample
    console.log('\n🔍 Sample verification:');
    const verifyQuery = `
      SELECT wp_product_id, post_title, woosb_ids
      FROM products
      WHERE product_type = 'woosb' AND woosb_ids IS NOT NULL
      LIMIT 3
    `;
    const verifyResult = await pool.query(verifyQuery);

    verifyResult.rows.forEach(row => {
      console.log(`\n  Product ${row.wp_product_id}: ${row.post_title}`);
      console.log(`  woosb_ids:`, row.woosb_ids);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
