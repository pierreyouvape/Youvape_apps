const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');

/**
 * Résout un productId (id interne OU wp_product_id) vers l'id interne.
 * Ne résout plus vers le parent — les fournisseurs sont gérés par variation/simple.
 */
const resolveProductId = async (productId) => {
  const result = await pool.query(`
    SELECT p.id FROM products p
    WHERE p.id = $1 OR p.wp_product_id = $1
    ORDER BY CASE WHEN p.id = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `, [productId]);
  if (result.rows.length === 0) return productId;
  return result.rows[0].id;
};

const supplierModel = {
  // Récupérer tous les fournisseurs
  getAll: async (includeInactive = false) => {
    const query = `
      SELECT
        s.*,
        COUNT(DISTINCT ps.product_id) as product_count
      FROM suppliers s
      LEFT JOIN product_suppliers ps ON s.id = ps.supplier_id
      ${includeInactive ? '' : 'WHERE s.is_active = true'}
      GROUP BY s.id
      ORDER BY s.name
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  // Récupérer un fournisseur par ID
  getById: async (id) => {
    const query = `
      SELECT
        s.*,
        COUNT(DISTINCT ps.product_id) as product_count
      FROM suppliers s
      LEFT JOIN product_suppliers ps ON s.id = ps.supplier_id
      WHERE s.id = $1
      GROUP BY s.id
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // Créer un fournisseur
  create: async (data) => {
    const query = `
      INSERT INTO suppliers (
        name, code, email, phone, address, contact_name,
        analysis_period_months, coverage_months, reception_threshold, lead_time_days,
        csv_mapping, notes, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    const values = [
      data.name,
      data.code || null,
      data.email || null,
      data.phone || null,
      data.address || null,
      data.contact_name || null,
      data.analysis_period_months || 1,
      data.coverage_months || 1,
      data.reception_threshold || 50,
      data.lead_time_days || 2,
      data.csv_mapping ? JSON.stringify(data.csv_mapping) : null,
      data.notes || null,
      data.is_active !== false
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Mettre à jour un fournisseur
  update: async (id, data) => {
    const query = `
      UPDATE suppliers SET
        name = COALESCE($2, name),
        code = COALESCE($3, code),
        email = COALESCE($4, email),
        phone = COALESCE($5, phone),
        address = COALESCE($6, address),
        contact_name = COALESCE($7, contact_name),
        analysis_period_months = COALESCE($8, analysis_period_months),
        coverage_months = COALESCE($9, coverage_months),
        reception_threshold = COALESCE($10, reception_threshold),
        lead_time_days = COALESCE($11, lead_time_days),
        csv_mapping = COALESCE($12, csv_mapping),
        notes = COALESCE($13, notes),
        is_active = COALESCE($14, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const values = [
      id,
      data.name,
      data.code,
      data.email,
      data.phone,
      data.address,
      data.contact_name,
      data.analysis_period_months,
      data.coverage_months,
      data.reception_threshold,
      data.lead_time_days,
      data.csv_mapping ? JSON.stringify(data.csv_mapping) : null,
      data.notes,
      data.is_active
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Supprimer un fournisseur (soft delete)
  delete: async (id) => {
    const query = `
      UPDATE suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // Supprimer définitivement (hard delete)
  hardDelete: async (id) => {
    const query = 'DELETE FROM suppliers WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // Récupérer les produits d'un fournisseur
  getProducts: async (supplierId) => {
    const query = `
      SELECT
        p.*,
        ps.is_primary,
        ps.supplier_sku,
        ps.supplier_price,
        ps.min_order_qty,
        ps.pack_qty
      FROM products p
      JOIN product_suppliers ps ON p.id = ps.product_id
      WHERE ps.supplier_id = $1
      ORDER BY p.post_title
    `;
    const result = await pool.query(query, [supplierId]);
    return result.rows;
  },

  // Associer un produit à un fournisseur (résout wp_product_id vers id interne)
  addProduct: async (supplierId, productId, data = {}) => {
    const resolvedId = await resolveProductId(productId);
    const query = `
      INSERT INTO product_suppliers (
        supplier_id, product_id, is_primary, supplier_sku, supplier_price, min_order_qty, pack_qty
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        supplier_sku = EXCLUDED.supplier_sku,
        supplier_price = EXCLUDED.supplier_price,
        min_order_qty = EXCLUDED.min_order_qty,
        pack_qty = EXCLUDED.pack_qty,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const values = [
      supplierId,
      resolvedId,
      data.is_primary || false,
      data.supplier_sku || null,
      data.supplier_price || null,
      data.min_order_qty || 1,
      data.pack_qty || 1
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Mettre à jour les données d'un produit chez un fournisseur (résout wp_product_id vers id interne)
  updateProductSupplier: async (supplierId, productId, data) => {
    const resolvedId = await resolveProductId(productId);
    const fields = [];
    const values = [supplierId, resolvedId];
    let paramIndex = 3;

    if (data.supplier_sku !== undefined) {
      fields.push(`supplier_sku = $${paramIndex++}`);
      values.push(data.supplier_sku);
    }
    if (data.supplier_price !== undefined) {
      fields.push(`supplier_price = $${paramIndex++}`);
      values.push(data.supplier_price);
    }
    if (data.pack_qty !== undefined) {
      fields.push(`pack_qty = $${paramIndex++}`);
      values.push(data.pack_qty);
    }
    if (data.min_order_qty !== undefined) {
      fields.push(`min_order_qty = $${paramIndex++}`);
      values.push(data.min_order_qty);
    }
    if (data.is_primary !== undefined) {
      fields.push(`is_primary = $${paramIndex++}`);
      values.push(data.is_primary);
    }

    if (fields.length === 0) return null;

    // Upsert : crée la ligne si elle n'existe pas encore (variation sans fournisseur assigné)
    const query = `
      INSERT INTO product_suppliers (
        supplier_id, product_id, supplier_sku, supplier_price, pack_qty, min_order_qty, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        supplier_sku = COALESCE(EXCLUDED.supplier_sku, product_suppliers.supplier_sku),
        supplier_price = COALESCE(EXCLUDED.supplier_price, product_suppliers.supplier_price),
        pack_qty = COALESCE(EXCLUDED.pack_qty, product_suppliers.pack_qty),
        min_order_qty = COALESCE(EXCLUDED.min_order_qty, product_suppliers.min_order_qty),
        is_primary = COALESCE(EXCLUDED.is_primary, product_suppliers.is_primary),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await pool.query(query, [
      supplierId, resolvedId,
      data.supplier_sku !== undefined ? data.supplier_sku : null,
      data.supplier_price !== undefined ? data.supplier_price : null,
      data.pack_qty !== undefined ? data.pack_qty : null,
      data.min_order_qty !== undefined ? data.min_order_qty : null,
      data.is_primary !== undefined ? data.is_primary : null
    ]);
    return result.rows[0];
  },

  // Retirer un produit d'un fournisseur (résout wp_product_id vers id interne)
  // Si le produit est un parent variable, supprime toutes les variations pour ce fournisseur
  removeProduct: async (supplierId, productId) => {
    const resolvedId = await resolveProductId(productId);

    // Vérifier si c'est un produit variable (parent)
    const typeResult = await pool.query(
      `SELECT product_type, wp_product_id FROM products WHERE id = $1`,
      [resolvedId]
    );
    const product = typeResult.rows[0];
    const isVariable = product?.product_type === 'variable';

    if (isVariable) {
      // wp_parent_id stocke le wp_product_id du parent (pas l'id interne)
      const result = await pool.query(`
        DELETE FROM product_suppliers
        WHERE supplier_id = $1 AND product_id IN (
          SELECT id FROM products WHERE wp_parent_id = $2
        )
        RETURNING *
      `, [supplierId, product.wp_product_id]);
      return result.rows[0];
    }

    const result = await pool.query(`
      DELETE FROM product_suppliers
      WHERE supplier_id = $1 AND product_id = $2
      RETURNING *
    `, [supplierId, resolvedId]);
    return result.rows[0];
  },

  // Définir le fournisseur principal d'un produit (résout wp_product_id vers id interne)
  setPrimarySupplier: async (productId, supplierId) => {
    const resolvedId = await resolveProductId(productId);
    // D'abord retirer le statut principal des autres fournisseurs
    await pool.query(`
      UPDATE product_suppliers SET is_primary = false
      WHERE product_id = $1 AND supplier_id != $2
    `, [resolvedId, supplierId]);

    // Puis définir le nouveau principal
    const query = `
      UPDATE product_suppliers SET is_primary = true, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND supplier_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [resolvedId, supplierId]);
    return result.rows[0];
  },

  // Récupérer les fournisseurs d'un produit (résout wp_product_id vers id interne)
  // Si le produit est un parent (variable), remonte les fournisseurs distincts de ses variations
  getSuppliersByProduct: async (productId) => {
    const resolvedId = await resolveProductId(productId);

    // Vérifier si c'est un produit variable (parent)
    const typeResult = await pool.query(
      `SELECT product_type, wp_product_id, post_title FROM products WHERE id = $1`,
      [resolvedId]
    );
    const product = typeResult.rows[0];

    if (product && product.product_type === 'variable') {
      // CROSS JOIN fournisseurs×variations : toutes les variations apparaissent pour chaque fournisseur
      // même si elles n'ont pas encore de ligne dans product_suppliers
      const query = `
        SELECT
          s.id as supplier_id, s.name as supplier_name,
          bool_or(ps.is_primary) OVER (PARTITION BY s.id) as is_primary,
          child.id as variation_id,
          child.wp_product_id as variation_wp_id,
          child.post_title as variation_title,
          child.sku as variation_sku,
          ps.supplier_sku,
          ps.supplier_price,
          ps.min_order_qty,
          ps.pack_qty
        FROM suppliers s
        -- Fournisseurs présents sur au moins une variation de ce parent
        JOIN product_suppliers ps_any ON ps_any.supplier_id = s.id
        JOIN products var_any ON var_any.id = ps_any.product_id AND var_any.wp_parent_id = $1
        -- Toutes les variations du parent
        CROSS JOIN products child
        -- Données de ce fournisseur pour cette variation spécifique (peut être NULL)
        LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.product_id = child.id
        WHERE child.wp_parent_id = $1 AND s.is_active = true
        GROUP BY s.id, s.name, child.id, child.wp_product_id, child.post_title, child.sku,
                 ps.supplier_sku, ps.supplier_price, ps.min_order_qty, ps.pack_qty, ps.is_primary
        ORDER BY s.name, child.post_title
      `;
      const result = await pool.query(query, [product.wp_product_id]);

      // Regrouper par fournisseur : { id, name, is_primary, variations: [...] }
      const suppliersMap = new Map();
      for (const row of result.rows) {
        if (!suppliersMap.has(row.supplier_id)) {
          suppliersMap.set(row.supplier_id, {
            id: row.supplier_id,
            name: row.supplier_name,
            is_primary: row.is_primary,
            is_variable_parent: true,
            variations: []
          });
        }
        const parentTitle = product.post_title || '';
        const varLabel = row.variation_title.replace(parentTitle + ' - ', '').replace(parentTitle, '') || row.variation_title;
        suppliersMap.get(row.supplier_id).variations.push({
          variation_id: row.variation_id,
          variation_wp_id: row.variation_wp_id,
          variation_label: varLabel,
          variation_sku: row.variation_sku,
          supplier_sku: row.supplier_sku,
          supplier_price: row.supplier_price,
          min_order_qty: row.min_order_qty,
          pack_qty: row.pack_qty
        });
      }

      return [...suppliersMap.values()].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.name.localeCompare(b.name));
    }

    // Produit simple ou variation : comportement normal
    const query = `
      SELECT
        s.*,
        ps.is_primary,
        ps.supplier_sku,
        ps.supplier_price,
        ps.min_order_qty,
        ps.pack_qty
      FROM suppliers s
      JOIN product_suppliers ps ON s.id = ps.supplier_id
      WHERE ps.product_id = $1 AND s.is_active = true
      ORDER BY ps.is_primary DESC, s.name
    `;
    const result = await pool.query(query, [resolvedId]);
    return result.rows;
  },

  // Import CSV de fournisseurs
  bulkCreate: async (suppliers) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = [];

      for (const supplier of suppliers) {
        const query = `
          INSERT INTO suppliers (name, code, email, phone, contact_name, notes)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (code) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            contact_name = EXCLUDED.contact_name,
            notes = EXCLUDED.notes,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;
        const result = await client.query(query, [
          supplier.name,
          supplier.code || null,
          supplier.email || null,
          supplier.phone || null,
          supplier.contact_name || null,
          supplier.notes || null
        ]);
        created.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // ==================== SYNC BMS ====================

  /**
   * Synchroniser les fournisseurs depuis BMS
   * - Insère les nouveaux fournisseurs (basé sur bms_id)
   * - Met à jour les existants
   */
  syncFromBMS: async () => {
    const bmsSuppliers = await bmsApiModel.getSuppliers();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let created = 0;
      let updated = 0;
      const results = [];

      for (const bms of bmsSuppliers) {
        // Construire l'adresse complète
        const address = [bms.street1, bms.street2].filter(Boolean).join('\n');

        const query = `
          INSERT INTO suppliers (
            bms_id, name, code, email, phone, address,
            postcode, city, country_code,
            minimum_order, carriage_free_amount, currency,
            account_number, lead_time_days, is_active, bms_synced_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
          ON CONFLICT (bms_id) DO UPDATE SET
            name = EXCLUDED.name,
            code = EXCLUDED.code,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            address = EXCLUDED.address,
            postcode = EXCLUDED.postcode,
            city = EXCLUDED.city,
            country_code = EXCLUDED.country_code,
            minimum_order = EXCLUDED.minimum_order,
            carriage_free_amount = EXCLUDED.carriage_free_amount,
            currency = EXCLUDED.currency,
            account_number = EXCLUDED.account_number,
            lead_time_days = EXCLUDED.lead_time_days,
            is_active = EXCLUDED.is_active,
            bms_synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *, (xmax = 0) AS inserted
        `;

        const values = [
          bms.id,                                    // bms_id
          bms.name,                                  // name
          bms.code || null,                          // code
          bms.email ? bms.email.trim() : null,       // email
          bms.telephone || null,                     // phone
          address || null,                           // address
          bms.postcode || null,                      // postcode
          bms.city || null,                          // city
          bms.country_code || null,                  // country_code
          parseFloat(bms.minimum_of_order) || 0,     // minimum_order
          parseFloat(bms.carriage_free_amount) || 0, // carriage_free_amount
          bms.currency || 'EUR',                     // currency
          bms.account_number || null,                // account_number
          bms.shipping_delay || 1,                   // lead_time_days
          bms.is_active === 1                        // is_active
        ];

        const result = await client.query(query, values);
        const row = result.rows[0];

        if (row.inserted) {
          created++;
        } else {
          updated++;
        }

        results.push({
          id: row.id,
          bms_id: row.bms_id,
          name: row.name,
          action: row.inserted ? 'created' : 'updated'
        });
      }

      await client.query('COMMIT');

      return {
        total: bmsSuppliers.length,
        created,
        updated,
        suppliers: results
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Récupérer un fournisseur par son bms_id
   */
  getByBmsId: async (bmsId) => {
    const query = 'SELECT * FROM suppliers WHERE bms_id = $1';
    const result = await pool.query(query, [bmsId]);
    return result.rows[0];
  },

  /**
   * Synchroniser les associations produits-fournisseurs depuis BMS.
   * Pour chaque fournisseur local avec un bms_id, récupère ses produits BMS
   * et upsert dans product_suppliers (matching par SKU).
   * Ne supprime pas les associations manuelles existantes.
   */
  syncProductSuppliersFromBMS: async () => {
    // 1. Fournisseurs locaux avec bms_id
    const suppliersResult = await pool.query(
      'SELECT id, name, bms_id FROM suppliers WHERE bms_id IS NOT NULL AND is_active = true'
    );
    const localSuppliers = suppliersResult.rows;

    // 2. Mapping sku → product.id local (publish uniquement)
    const productsResult = await pool.query(`
      SELECT id, sku FROM products
      WHERE sku IS NOT NULL AND sku != '' AND post_status = 'publish'
    `);
    const productBySku = new Map(productsResult.rows.map(p => [p.sku, p.id]));

    let linked = 0;
    let skipped = 0;
    let skuNotFound = 0;
    const details = [];

    for (const supplier of localSuppliers) {
      let bmsProducts;
      try {
        bmsProducts = await bmsApiModel.getSupplierProducts(supplier.bms_id);
      } catch (err) {
        console.warn(`Impossible de récupérer les produits BMS pour ${supplier.name} (bms_id=${supplier.bms_id}): ${err.message}`);
        skipped++;
        continue;
      }

      for (const item of bmsProducts) {
        const productId = productBySku.get(item.sku);
        if (!productId) {
          skuNotFound++;
          continue;
        }

        const price = item.price ? parseFloat(item.price) : null;
        const packQty = parseInt(item.pack_qty) || 1;
        const isPrimary = item.primary === 1 || item.primary === true;

        await pool.query(`
          INSERT INTO product_suppliers (supplier_id, product_id, supplier_price, pack_qty, is_primary)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (product_id, supplier_id) DO UPDATE SET
            supplier_price = COALESCE(EXCLUDED.supplier_price, product_suppliers.supplier_price),
            pack_qty = EXCLUDED.pack_qty,
            is_primary = CASE WHEN EXCLUDED.is_primary THEN true ELSE product_suppliers.is_primary END,
            updated_at = CURRENT_TIMESTAMP
        `, [supplier.id, productId, price, packQty, isPrimary]);

        linked++;
        details.push({ supplier: supplier.name, sku: item.sku, productId });
      }
    }

    return { linked, skipped, skuNotFound, suppliersProcessed: localSuppliers.length };
  }
};

module.exports = supplierModel;
