const pool = require('../config/database');

const purchaseOrderModel = {
  // Générer un numéro de commande
  generateOrderNumber: async () => {
    const result = await pool.query('SELECT generate_po_number() as order_number');
    return result.rows[0].order_number;
  },

  // Récupérer toutes les commandes
  getAll: async (filters = {}) => {
    let query = `
      SELECT
        po.*,
        s.name as supplier_name,
        s.code as supplier_code,
        u.email as created_by_email
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (filters.supplier_id) {
      query += ` AND po.supplier_id = $${paramIndex++}`;
      values.push(filters.supplier_id);
    }

    if (filters.status) {
      query += ` AND po.status = $${paramIndex++}`;
      values.push(filters.status);
    }

    if (filters.from_date) {
      query += ` AND po.created_at >= $${paramIndex++}`;
      values.push(filters.from_date);
    }

    if (filters.to_date) {
      query += ` AND po.created_at <= $${paramIndex++}`;
      values.push(filters.to_date);
    }

    query += ' ORDER BY po.created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    const result = await pool.query(query, values);
    return result.rows;
  },

  // Récupérer une commande par ID avec ses lignes
  getById: async (id) => {
    const orderQuery = `
      SELECT
        po.*,
        s.name as supplier_name,
        s.code as supplier_code,
        s.email as supplier_email,
        u.email as created_by_email
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE po.id = $1
    `;
    const orderResult = await pool.query(orderQuery, [id]);

    if (orderResult.rows.length === 0) {
      return null;
    }

    const itemsQuery = `
      SELECT
        poi.*,
        p.sku as product_sku,
        p.post_title as current_product_name,
        p.stock as current_stock
      FROM purchase_order_items poi
      JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.id
    `;
    const itemsResult = await pool.query(itemsQuery, [id]);

    return {
      ...orderResult.rows[0],
      items: itemsResult.rows
    };
  },

  // Créer une commande
  create: async (data, userId) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Générer le numéro de commande
      const orderNumber = await purchaseOrderModel.generateOrderNumber();

      // Créer la commande
      const orderQuery = `
        INSERT INTO purchase_orders (
          order_number, supplier_id, status, notes, created_by, order_date
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const orderResult = await client.query(orderQuery, [
        orderNumber,
        data.supplier_id,
        data.status || 'draft',
        data.notes || null,
        userId,
        data.order_date || null
      ]);
      const order = orderResult.rows[0];

      // Ajouter les lignes
      let totalItems = 0;
      let totalQty = 0;
      let totalAmount = 0;

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const itemQuery = `
            INSERT INTO purchase_order_items (
              purchase_order_id, product_id, supplier_sku, product_name,
              qty_ordered, unit_price, stock_before, theoretical_need, supposed_need
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
          `;
          await client.query(itemQuery, [
            order.id,
            item.product_id,
            item.supplier_sku || null,
            item.product_name,
            item.qty_ordered,
            item.unit_price || null,
            item.stock_before || null,
            item.theoretical_need || null,
            item.supposed_need || null
          ]);

          totalItems++;
          totalQty += item.qty_ordered;
          if (item.unit_price) {
            totalAmount += item.qty_ordered * item.unit_price;
          }
        }

        // Mettre à jour les totaux
        await client.query(`
          UPDATE purchase_orders
          SET total_items = $2, total_qty = $3, total_amount = $4
          WHERE id = $1
        `, [order.id, totalItems, totalQty, totalAmount]);
      }

      await client.query('COMMIT');

      return purchaseOrderModel.getById(order.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Mettre à jour le statut d'une commande
  updateStatus: async (id, status, additionalData = {}) => {
    let query = `
      UPDATE purchase_orders
      SET status = $2, updated_at = CURRENT_TIMESTAMP
    `;
    const values = [id, status];
    let paramIndex = 3;

    if (status === 'sent' && !additionalData.order_date) {
      query += `, order_date = CURRENT_TIMESTAMP`;
    }

    if (additionalData.order_date) {
      query += `, order_date = $${paramIndex++}`;
      values.push(additionalData.order_date);
    }

    if (additionalData.expected_date) {
      query += `, expected_date = $${paramIndex++}`;
      values.push(additionalData.expected_date);
    }

    if (status === 'received') {
      query += `, received_date = CURRENT_TIMESTAMP`;
    }

    if (additionalData.notes) {
      query += `, notes = $${paramIndex++}`;
      values.push(additionalData.notes);
    }

    query += ' WHERE id = $1 RETURNING *';

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Mettre à jour les quantités reçues
  updateReceivedQty: async (orderId, itemId, qtyReceived) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mettre à jour la ligne
      await client.query(`
        UPDATE purchase_order_items
        SET qty_received = $3, updated_at = CURRENT_TIMESTAMP
        WHERE purchase_order_id = $1 AND id = $2
      `, [orderId, itemId, qtyReceived]);

      // Vérifier si toutes les lignes sont reçues
      const checkQuery = `
        SELECT
          COUNT(*) as total_items,
          COUNT(*) FILTER (WHERE qty_received >= qty_ordered) as received_items,
          COUNT(*) FILTER (WHERE qty_received > 0 AND qty_received < qty_ordered) as partial_items
        FROM purchase_order_items
        WHERE purchase_order_id = $1
      `;
      const checkResult = await client.query(checkQuery, [orderId]);
      const { total_items, received_items, partial_items } = checkResult.rows[0];

      // Mettre à jour le statut de la commande
      let newStatus;
      if (received_items == total_items) {
        newStatus = 'received';
      } else if (received_items > 0 || partial_items > 0) {
        newStatus = 'partial';
      }

      if (newStatus) {
        await client.query(`
          UPDATE purchase_orders
          SET status = $2, updated_at = CURRENT_TIMESTAMP
          ${newStatus === 'received' ? ', received_date = CURRENT_TIMESTAMP' : ''}
          WHERE id = $1
        `, [orderId, newStatus]);
      }

      await client.query('COMMIT');

      return purchaseOrderModel.getById(orderId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Supprimer une commande (seulement si draft)
  delete: async (id) => {
    const result = await pool.query(`
      DELETE FROM purchase_orders
      WHERE id = $1 AND status = 'draft'
      RETURNING *
    `, [id]);
    return result.rows[0];
  },

  // Récupérer les commandes en cours pour un produit (pour calculer "en arrivage")
  getPendingForProduct: async (productId) => {
    const query = `
      SELECT
        poi.qty_ordered,
        poi.qty_received,
        po.order_number,
        po.status,
        po.expected_date
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
    `;
    const result = await pool.query(query, [productId]);
    return result.rows;
  },

  // Calculer le total en arrivage pour un produit
  getIncomingQty: async (productId) => {
    const query = `
      SELECT COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0) as incoming_qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
    `;
    const result = await pool.query(query, [productId]);
    return parseInt(result.rows[0].incoming_qty) || 0;
  }
};

module.exports = purchaseOrderModel;
