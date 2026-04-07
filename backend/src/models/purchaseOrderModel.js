const pool = require('../config/database');
const bmsApiModel = require('./bmsApiModel');

// Warehouse ID principal BMS (Entrepot)
const BMS_WAREHOUSE_ID = 270;

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
        u.email as created_by_email,
        COALESCE(SUM(poi.qty_ordered), 0) as total_qty_ordered,
        COALESCE(SUM(poi.qty_received), 0) as total_qty_received
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN users u ON po.created_by = u.id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
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

    if (filters.exclude_status && filters.exclude_status.length > 0) {
      const placeholders = filters.exclude_status.map(() => `$${paramIndex++}`).join(', ');
      query += ` AND po.status NOT IN (${placeholders})`;
      values.push(...filters.exclude_status);
    }

    if (filters.from_date) {
      query += ` AND po.created_at >= $${paramIndex++}`;
      values.push(filters.from_date);
    }

    if (filters.to_date) {
      query += ` AND po.created_at <= $${paramIndex++}`;
      values.push(filters.to_date);
    }

    query += ' GROUP BY po.id, s.name, s.code, u.email ORDER BY po.created_at DESC';

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
      LEFT JOIN products p ON poi.product_id = p.id
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

      // Utiliser le numéro fourni (import PDF) ou en générer un
      const orderNumber = data.order_number || await purchaseOrderModel.generateOrderNumber();

      // Créer la commande localement
      const orderQuery = `
        INSERT INTO purchase_orders (
          order_number, supplier_id, status, notes, created_by, order_date, global_discount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const orderResult = await client.query(orderQuery, [
        orderNumber,
        data.supplier_id,
        data.status || 'draft',
        data.notes || null,
        userId,
        data.order_date || null,
        parseFloat(data.global_discount) || 0
      ]);
      const order = orderResult.rows[0];

      // Récupérer les SKUs des produits pour les items
      const itemsWithSku = [];
      let totalItems = 0;
      let totalQty = 0;
      let totalAmount = 0;

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          // Récupérer le produit interne (product_id peut être wp_product_id ou id interne)
          const productResult = await client.query(
            `SELECT p.id, p.sku, p.wc_cog_cost, ps.pack_qty
             FROM products p
             LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = $2
             WHERE p.wp_product_id = $1 OR p.id = $1
             LIMIT 1`,
            [item.product_id, data.supplier_id]
          );
          const product = productResult.rows[0];
          if (!product) {
            throw new Error(`Produit introuvable pour product_id=${item.product_id}`);
          }
          const internalProductId = product.id;
          const sku = product.sku || null;
          const packQty = parseInt(product.pack_qty) || 1;
          // Si unit_price est fourni (meme 0), l'utiliser. Sinon fallback sur wc_cog_cost.
          // 'unit_price' in item permet de distinguer "non fourni" de "explicitement null" (import PDF sans prix)
          const unitPrice = ('unit_price' in item && item.unit_price !== undefined)
            ? item.unit_price
            : (product?.wc_cog_cost || 0);

          const discountPercent = ('discount_percent' in item && item.discount_percent !== undefined)
            ? parseFloat(item.discount_percent) || 0
            : 0;

          const itemQuery = `
            INSERT INTO purchase_order_items (
              purchase_order_id, product_id, supplier_sku, product_name,
              qty_ordered, unit_price, discount_percent, stock_before, theoretical_need, supposed_need
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
          `;
          const insertedItem = await client.query(itemQuery, [
            order.id,
            internalProductId,
            item.supplier_sku || sku || null,
            item.product_name,
            item.qty_ordered,
            unitPrice || null,
            discountPercent,
            item.stock_before || null,
            item.theoretical_need || null,
            item.supposed_need || null
          ]);

          itemsWithSku.push({
            ...insertedItem.rows[0],
            sku: sku,
            unit_price: unitPrice,
            discount_percent: discountPercent,
            pack_qty: packQty
          });

          totalItems++;
          totalQty += item.qty_ordered;
          if (unitPrice) {
            const netPrice = unitPrice * (1 - discountPercent / 100);
            totalAmount += item.qty_ordered * netPrice;
          }
        }

        // Mettre à jour les totaux
        await client.query(`
          UPDATE purchase_orders
          SET total_items = $2, total_qty = $3, total_amount = $4
          WHERE id = $1
        `, [order.id, totalItems, totalQty, totalAmount]);
      }

      // Enregistrer les nouvelles associations supplier_sku (import PDF, matching manuel)
      // Stocké sur le produit exact (variation ou simple), pas le parent
      if (data.new_supplier_skus && data.new_supplier_skus.length > 0) {
        for (const entry of data.new_supplier_skus) {
          // Résoudre wp_product_id vers id interne (sans remonter au parent)
          const resolveResult = await client.query(
            'SELECT id FROM products WHERE id = $1 OR wp_product_id = $1 LIMIT 1',
            [entry.product_id]
          );
          const productId = resolveResult.rows[0]?.id || entry.product_id;

          // Upsert : ne met a jour QUE le supplier_sku, sans ecraser prix/pack_qty existants
          await client.query(`
            INSERT INTO product_suppliers (supplier_id, product_id, supplier_sku)
            VALUES ($1, $2, $3)
            ON CONFLICT (product_id, supplier_id) DO UPDATE SET
              supplier_sku = EXCLUDED.supplier_sku,
              updated_at = CURRENT_TIMESTAMP
          `, [data.supplier_id, productId, entry.supplier_sku]);
        }
      }

      // Si send_to_bms est true, créer la commande dans BMS
      if (data.send_to_bms) {
        // Récupérer les credentials BMS de l'utilisateur connecté (si configurés)
        const userCreds = await client.query(
          'SELECT bms_email, bms_password FROM users WHERE id = $1', [userId]
        );
        const bmsCreds = userCreds.rows[0]?.bms_email
          ? { email: userCreds.rows[0].bms_email, password: userCreds.rows[0].bms_password }
          : null;

        const bmsResult = await purchaseOrderModel.createInBMS(
          client,
          order,
          data.supplier_id,
          itemsWithSku,
          bmsCreds
        );

        if (bmsResult.bms_po_id) {
          await client.query(
            'UPDATE purchase_orders SET bms_po_id = $2, status = $3 WHERE id = $1',
            [order.id, bmsResult.bms_po_id, 'sent']
          );
        }
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

  // Créer la commande dans BMS
  createInBMS: async (client, order, supplierId, items, bmsCredentials = null) => {
    // Récupérer le bms_id du fournisseur
    const supplierResult = await client.query(
      'SELECT bms_id, name FROM suppliers WHERE id = $1',
      [supplierId]
    );
    const supplier = supplierResult.rows[0];

    if (!supplier?.bms_id) {
      throw new Error(`Le fournisseur n'a pas d'ID BMS associé. Synchronisez les fournisseurs depuis BMS d'abord.`);
    }

    // Préparer les items pour BMS (seuls les produits avec SKU)
    // BMS divise qty par son pack_qty mais ne touche pas au prix
    // → on envoie qty en unités, price en prix PACK (unit_price * pack_qty)
    const bmsItems = items
      .filter(item => item.sku)
      .map(item => {
        const packQty = parseInt(item.pack_qty) || 1;
        const discountPercent = parseFloat(item.discount_percent) || 0;
        const bmsItem = {
          sku: item.sku,
          qty: parseInt(item.qty_ordered) || 0,
          price: (parseFloat(item.unit_price) || 0) * packQty,
          name: item.product_name,
          supplier_sku: item.supplier_sku || null
        };
        if (discountPercent > 0) {
          bmsItem.discount_percent = discountPercent;
        }
        return bmsItem;
      });

    if (bmsItems.length === 0) {
      throw new Error('Aucun produit avec SKU valide pour créer la commande BMS');
    }

    // Créer la commande dans BMS
    const bmsOrderData = {
      reference: order.order_number,
      status: 'expected',
      supplier_id: supplier.bms_id,
      warehouse_id: BMS_WAREHOUSE_ID,
      items: bmsItems
    };

    console.log('Creating BMS order:', JSON.stringify(bmsOrderData, null, 2));

    const bmsResponse = await bmsApiModel.createPurchaseOrder(bmsOrderData, bmsCredentials);
    console.log('BMS response:', JSON.stringify(bmsResponse, null, 2));

    return {
      bms_po_id: bmsResponse.id || null,
      bms_reference: bmsResponse.reference || null
    };
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
    // Supprimer les items d'abord (FK)
    await pool.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id]);
    const result = await pool.query(`
      DELETE FROM purchase_orders
      WHERE id = $1
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
  },

  // ==================== SYNC BMS ====================

  /**
   * Synchroniser les commandes fournisseur depuis BMS
   * - Filtre incremental par created_at >= last_sync_at
   * - Déduplication par bms_po_id (ON CONFLICT)
   * - Met à jour product_suppliers (prix achat + fournisseur) depuis les items
   */
  syncFromBMS: async () => {
    // 1. Lire la date du dernier import
    const configResult = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_po_sync_at'"
    );
    const lastSyncAt = configResult.rows[0]?.config_value || '2000-01-01T00:00:00.000Z';

    // 2. Récupérer toutes les commandes BMS
    const allOrders = await bmsApiModel.getPurchaseOrders();

    // Filtrer : commandes créées OU mises à jour >= dernière sync
    const lastSyncDate = new Date(lastSyncAt);
    const orders = allOrders.filter(o => {
      const created = o.created_at ? new Date(o.created_at) : null;
      const updated = o.updated_at ? new Date(o.updated_at) : null;
      return (created && created >= lastSyncDate) || (updated && updated >= lastSyncDate);
    });

    if (orders.length === 0) {
      return { total: 0, created: 0, updated: 0, skipped: 0, orders: [] };
    }

    // 3. Charger le mapping bms_id → supplier local (en une seule requête)
    const suppliersResult = await pool.query(
      'SELECT id, bms_id FROM suppliers WHERE bms_id IS NOT NULL'
    );
    const supplierByBmsId = new Map(suppliersResult.rows.map(s => [s.bms_id, s.id]));

    // 4. Charger le mapping sku → product.id local (en une seule requête)
    const productsResult = await pool.query(`
      SELECT p.id, p.sku, p.product_type
      FROM products p
      WHERE p.sku IS NOT NULL AND p.sku != '' AND p.post_status = 'publish'
    `);
    const productBySku = new Map(productsResult.rows.map(p => [p.sku, p.id]));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const results = [];

      // Mapping statut BMS → statut local
      const statusMap = {
        draft: 'draft',
        confirmed: 'confirmed',
        expected: 'confirmed', // Attendu = en attente de réception
        cancelled: 'cancelled',
        partial: 'partial',
        shipped: 'shipped'
      };

      for (const bmsOrder of orders) {
        const supplierId = supplierByBmsId.get(bmsOrder.supplier_id);
        if (!supplierId) {
          skipped++;
          continue; // Fournisseur BMS inconnu localement
        }

        const bmsReference = String(bmsOrder.reference);
        const items = bmsOrder.items || [];

        // Calculer les totaux réels (qty × qty_pack) pour déterminer le statut
        const totalOrdered = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseInt(i.qty_pack) || 1), 0);
        const totalReceived = items.reduce((s, i) => s + (parseInt(i.qty_received) || 0) * (parseInt(i.qty_pack) || 1), 0);

        let status;
        if (bmsOrder.status === 'complete') {
          status = totalReceived >= totalOrdered ? 'received' : 'partial';
        } else if (bmsOrder.status === 'expected') {
          // Attendu sans aucune réception → confirmed, avec réception partielle → partial
          status = totalReceived > 0 ? 'partial' : 'confirmed';
        } else {
          status = statusMap[bmsOrder.status] || 'sent';
        }

        // Upsert de la commande
        const orderQuery = `
          INSERT INTO purchase_orders (
            order_number, supplier_id, status,
            bms_po_id, bms_reference,
            order_date, expected_date, received_date,
            total_items, total_qty, total_amount,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (bms_po_id) DO UPDATE SET
            status = EXCLUDED.status,
            bms_reference = EXCLUDED.bms_reference,
            expected_date = EXCLUDED.expected_date,
            received_date = EXCLUDED.received_date,
            total_items = EXCLUDED.total_items,
            total_qty = EXCLUDED.total_qty,
            total_amount = EXCLUDED.total_amount,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, (xmax = 0) AS inserted
        `;
        const totalQty = items.reduce((s, i) => s + (parseInt(i.qty) || 0), 0);
        const totalAmount = parseFloat(bmsOrder.grandtotal) || 0;

        // Pour les commandes complètes, updated_at BMS est la meilleure approximation de la date de réception
        const receivedDate = (bmsOrder.status === 'complete' && bmsOrder.updated_at) ? bmsOrder.updated_at : null;

        const orderResult = await client.query(orderQuery, [
          `BMS-${bmsOrder.id}`,             // order_number (basé sur l'id BMS, toujours unique)
          supplierId,                       // supplier_id
          status,                           // status
          bmsOrder.id,                      // bms_po_id
          bmsReference,                     // bms_reference
          bmsOrder.created_at || null,      // order_date (date de création de la commande)
          bmsOrder.eta || null,             // expected_date
          receivedDate,                     // received_date (updated_at BMS si complete)
          items.length,                     // total_items
          totalQty,                         // total_qty
          totalAmount,                      // total_amount
          bmsOrder.private_comments || null // notes
        ]);

        const { id: poId, inserted } = orderResult.rows[0];

        if (inserted) {
          created++;
        } else {
          updated++;
          // Supprimer les anciens items pour les remplacer
          await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [poId]);
        }

        // Insérer les items
        for (const item of items) {
          const productId = productBySku.get(item.sku) || null; // NULL si SKU inconnu, on garde quand même la ligne
          const pricepack = parseFloat(item.price) || null;
          const qtyPack = parseInt(item.qty_pack) || 1;
          // unit_price = prix unitaire (prix pack / qty_pack)
          const unitPrice = (pricepack != null && qtyPack > 1) ? pricepack / qtyPack : pricepack;
          const qtyOrdered = (parseInt(item.qty) || 0) * qtyPack;
          const qtyReceived = (parseInt(item.qty_received) || 0) * qtyPack;

          await client.query(`
            INSERT INTO purchase_order_items (
              purchase_order_id, product_id, supplier_sku,
              product_name, qty_ordered, qty_received, unit_price
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            poId,
            productId,
            item.supplier_sku || item.sku || null,
            item.name || null,
            qtyOrdered,
            qtyReceived,
            unitPrice
          ]);

          // Mettre à jour product_suppliers — sur le produit exact (variation ou simple)
          const productIdForSupplier = item.sku ? productBySku.get(item.sku) : null;
          if (productIdForSupplier !== null && productIdForSupplier !== undefined && unitPrice !== null) {
            await client.query(`
              INSERT INTO product_suppliers (supplier_id, product_id, supplier_sku, supplier_price, min_order_qty, pack_qty)
              VALUES ($1, $2, $3, $4, 1, $5)
              ON CONFLICT (product_id, supplier_id) DO UPDATE SET
                supplier_price = EXCLUDED.supplier_price,
                supplier_sku = COALESCE(EXCLUDED.supplier_sku, product_suppliers.supplier_sku),
                pack_qty = EXCLUDED.pack_qty,
                updated_at = CURRENT_TIMESTAMP
            `, [supplierId, productIdForSupplier, item.supplier_sku || null, unitPrice, qtyPack]);
          }
        }

        results.push({
          id: poId,
          bms_po_id: bmsOrder.id,
          reference: bmsReference,
          supplier: bmsOrder.supplier_name,
          action: inserted ? 'created' : 'updated'
        });
      }

      // 5. Mettre à jour la date du dernier import (maintenant)
      await client.query(`
        INSERT INTO app_config (config_key, config_value)
        VALUES ('bms_last_po_sync_at', $1)
        ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP
      `, [new Date().toISOString()]);

      await client.query('COMMIT');

      return {
        total: orders.length,
        created,
        updated,
        skipped,
        orders: results
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Récupérer la date du dernier import BMS
   */
  getLastBmsSyncAt: async () => {
    const result = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_po_sync_at'"
    );
    const val = result.rows[0]?.config_value;
    return val === '2000-01-01T00:00:00.000Z' ? null : val;
  },

  /**
   * Récupérer la date du dernier import réceptions BMS
   */
  getLastBmsReceptionSyncAt: async () => {
    const result = await pool.query(
      "SELECT config_value FROM app_config WHERE config_key = 'bms_last_reception_sync_at'"
    );
    const val = result.rows[0]?.config_value;
    return val === '2000-01-01T00:00:00.000Z' ? null : val;
  },

  /**
   * Synchroniser les réceptions depuis BMS
   * Pour chaque réception BMS :
   * - Retrouve la commande locale via bms_reference
   * - Met à jour qty_received sur chaque ligne via SKU
   * - Met à jour received_date et status (received/partial)
   */
  syncReceptionsFromBMS: async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Récupérer la date du dernier import réceptions
      const configResult = await client.query(
        "SELECT config_value FROM app_config WHERE config_key = 'bms_last_reception_sync_at'"
      );
      const lastSyncAt = configResult.rows[0]?.config_value || '2000-01-01T00:00:00.000Z';

      // 2. Récupérer toutes les réceptions BMS
      const allReceptions = await bmsApiModel.getReceptions();

      // 3. Filtrer par date (incrémental)
      const receptions = allReceptions.filter(r =>
        !r.created_at || new Date(r.created_at) >= new Date(lastSyncAt)
      );

      // 4. Charger toutes les commandes locales avec leur bms_reference (non-ambigus uniquement)
      // On exclut les bms_reference qui apparaissent plusieurs fois
      const poResult = await client.query(`
        SELECT id, bms_reference, status
        FROM purchase_orders
        WHERE bms_reference IS NOT NULL
          AND bms_po_id IS NOT NULL
          AND bms_reference IN (
            SELECT bms_reference FROM purchase_orders GROUP BY bms_reference HAVING COUNT(*) = 1
          )
      `);
      const orderByRef = new Map(poResult.rows.map(r => [r.bms_reference, r]));

      // 5. Charger les produits (sku → product_id) pour les lignes de commande
      const productsResult = await client.query(
        'SELECT wp_product_id as id, sku FROM products WHERE sku IS NOT NULL AND sku != \'\''
      );
      const productBySku = new Map(productsResult.rows.map(r => [r.sku, r.id]));

      let processed = 0;
      let skipped = 0;
      let updatedOrders = 0;

      for (const reception of receptions) {
        const bmsRef = reception.purchase_order;
        const order = orderByRef.get(bmsRef);

        if (!order) {
          skipped++;
          continue; // Commande inconnue ou référence ambiguë
        }

        const orderId = order.id;
        const receptionDate = reception.created_at || null;
        const items = reception.items || [];

        // Mettre à jour qty_received pour chaque ligne de réception
        for (const rItem of items) {
          const productId = productBySku.get(rItem.sku);
          if (!productId) continue;

          // Additionner les quantités reçues (une commande peut avoir plusieurs réceptions partielles)
          await client.query(`
            UPDATE purchase_order_items
            SET qty_received = LEAST(qty_ordered, qty_received + $1)
            WHERE purchase_order_id = $2 AND product_id = $3
          `, [parseInt(rItem.qty) || 0, orderId, productId]);
        }

        // Recalculer le statut de la commande
        const itemsResult = await client.query(`
          SELECT
            SUM(qty_ordered) as total_ordered,
            SUM(qty_received) as total_received
          FROM purchase_order_items
          WHERE purchase_order_id = $1
        `, [orderId]);

        const totalOrdered = parseInt(itemsResult.rows[0]?.total_ordered) || 0;
        const totalReceived = parseInt(itemsResult.rows[0]?.total_received) || 0;

        let newStatus = order.status;
        if (totalReceived >= totalOrdered && totalOrdered > 0) {
          newStatus = 'received';
        } else if (totalReceived > 0) {
          newStatus = 'partial';
        }

        // Mettre à jour le statut et la date de réception
        if (newStatus !== order.status || receptionDate) {
          await client.query(`
            UPDATE purchase_orders
            SET
              status = $1,
              received_date = COALESCE(received_date, $2),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [newStatus, receptionDate, orderId]);
          updatedOrders++;
        }

        processed++;
      }

      // 6. Mettre à jour la date du dernier import réceptions
      await client.query(`
        INSERT INTO app_config (config_key, config_value)
        VALUES ('bms_last_reception_sync_at', $1)
        ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = CURRENT_TIMESTAMP
      `, [new Date().toISOString()]);

      await client.query('COMMIT');

      return {
        total: receptions.length,
        processed,
        skipped,
        updatedOrders
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Historique des commandes pour un produit chez un fournisseur
  getByProductAndSupplier: async (productId, supplierId) => {
    const query = `
      SELECT
        po.id as order_id,
        po.order_number,
        po.bms_reference,
        po.order_date,
        po.status,
        poi.qty_ordered,
        poi.qty_received,
        poi.unit_price
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.supplier_id = $2
      ORDER BY po.order_date DESC NULLS LAST, po.created_at DESC
    `;
    const result = await pool.query(query, [productId, supplierId]);
    return result.rows;
  }
};

module.exports = purchaseOrderModel;
