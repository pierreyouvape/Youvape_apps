const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');

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
        ps.min_order_qty
      FROM products p
      JOIN product_suppliers ps ON p.id = ps.product_id
      WHERE ps.supplier_id = $1
      ORDER BY p.post_title
    `;
    const result = await pool.query(query, [supplierId]);
    return result.rows;
  },

  // Associer un produit à un fournisseur
  addProduct: async (supplierId, productId, data = {}) => {
    const query = `
      INSERT INTO product_suppliers (
        supplier_id, product_id, is_primary, supplier_sku, supplier_price, min_order_qty
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (product_id, supplier_id) DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        supplier_sku = EXCLUDED.supplier_sku,
        supplier_price = EXCLUDED.supplier_price,
        min_order_qty = EXCLUDED.min_order_qty,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const values = [
      supplierId,
      productId,
      data.is_primary || false,
      data.supplier_sku || null,
      data.supplier_price || null,
      data.min_order_qty || 1
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Retirer un produit d'un fournisseur
  removeProduct: async (supplierId, productId) => {
    const query = `
      DELETE FROM product_suppliers
      WHERE supplier_id = $1 AND product_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [supplierId, productId]);
    return result.rows[0];
  },

  // Définir le fournisseur principal d'un produit
  setPrimarySupplier: async (productId, supplierId) => {
    // D'abord retirer le statut principal des autres fournisseurs
    await pool.query(`
      UPDATE product_suppliers SET is_primary = false
      WHERE product_id = $1 AND supplier_id != $2
    `, [productId, supplierId]);

    // Puis définir le nouveau principal
    const query = `
      UPDATE product_suppliers SET is_primary = true, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND supplier_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [productId, supplierId]);
    return result.rows[0];
  },

  // Récupérer les fournisseurs d'un produit
  getSuppliersByProduct: async (productId) => {
    const query = `
      SELECT
        s.*,
        ps.is_primary,
        ps.supplier_sku,
        ps.supplier_price,
        ps.min_order_qty
      FROM suppliers s
      JOIN product_suppliers ps ON s.id = ps.supplier_id
      WHERE ps.product_id = $1 AND s.is_active = true
      ORDER BY ps.is_primary DESC, s.name
    `;
    const result = await pool.query(query, [productId]);
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
  }
};

module.exports = supplierModel;
