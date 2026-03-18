/**
 * WooCommerce Sync Service
 * Poll WordPress pour récupérer la queue YouSync et traiter les événements
 */

const axios = require('axios');
const https = require('https');
const appConfigModel = require('../models/appConfigModel');
const pool = require('../config/database');

// Agent HTTPS qui ignore les certificats auto-signés (pour communication interne Docker)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let syncInterval = null;
let isProcessing = false;

const wcSyncService = {
  /**
   * Démarrer le service de polling
   */
  start: async () => {
    console.log('🔄 WC Sync Service: Initialisation...');

    // Récupérer l'intervalle depuis la config
    const intervalConfig = await appConfigModel.get('wc_sync_interval');
    const intervalSeconds = intervalConfig ? parseInt(intervalConfig.config_value) : 0;

    if (intervalSeconds <= 0) {
      console.log('🔄 WC Sync Service: Désactivé (intervalle = 0)');
      return;
    }

    // Récupérer l'URL et le token WP
    const wpUrlConfig = await appConfigModel.get('wc_sync_wp_url');
    const wpTokenConfig = await appConfigModel.get('wc_sync_wp_token');

    if (!wpUrlConfig || !wpTokenConfig) {
      console.log('🔄 WC Sync Service: Non configuré (URL ou token manquant)');
      return;
    }

    console.log(`🔄 WC Sync Service: Démarré (intervalle: ${intervalSeconds}s)`);

    // Lancer le polling
    wcSyncService.poll();
    syncInterval = setInterval(() => {
      wcSyncService.poll();
    }, intervalSeconds * 1000);
  },

  /**
   * Arrêter le service de polling
   */
  stop: () => {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
      console.log('🔄 WC Sync Service: Arrêté');
    }
  },

  /**
   * Redémarrer avec un nouvel intervalle
   */
  restart: async () => {
    wcSyncService.stop();
    await wcSyncService.start();
  },

  /**
   * Poll WordPress pour récupérer et traiter la queue
   */
  poll: async () => {
    if (isProcessing) {
      return; // Éviter les traitements concurrents
    }

    isProcessing = true;

    try {
      // Récupérer la config
      const wpUrlConfig = await appConfigModel.get('wc_sync_wp_url');
      const wpTokenConfig = await appConfigModel.get('wc_sync_wp_token');

      if (!wpUrlConfig || !wpTokenConfig) {
        return;
      }

      const wpUrl = wpUrlConfig.config_value.replace(/\/$/, '');
      const wpToken = wpTokenConfig.config_value;

      // Appeler l'endpoint WP pour récupérer la queue
      const response = await axios.get(`${wpUrl}/wp-json/yousync/v1/queue`, {
        headers: {
          'X-YouSync-Token': wpToken
        },
        timeout: 30000,
        httpsAgent
      });

      if (!response.data.success || !response.data.events || response.data.events.length === 0) {
        return; // Pas d'événements à traiter
      }

      const events = response.data.events;
      console.log(`🔄 WC Sync: ${events.length} événement(s) à traiter`);

      const processedIds = [];

      for (const event of events) {
        try {
          await wcSyncService.processEvent(event);
          processedIds.push({
            type: event.type,
            wp_id: event.wp_id
          });
        } catch (err) {
          console.error(`🔄 WC Sync Error: ${event.type} #${event.wp_id}:`, err.message);
        }
      }

      // Acquitter les événements traités
      if (processedIds.length > 0) {
        try {
          await axios.post(`${wpUrl}/wp-json/yousync/v1/queue/ack`, {
            events: processedIds
          }, {
            headers: {
              'X-YouSync-Token': wpToken,
              'Content-Type': 'application/json'
            },
            timeout: 10000,
            httpsAgent
          });
          console.log(`🔄 WC Sync: ${processedIds.length} événement(s) acquitté(s)`);
        } catch (err) {
          console.error('🔄 WC Sync: Erreur acquittement:', err.message);
        }
      }

    } catch (err) {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT') {
        console.error('🔄 WC Sync Poll Error:', err.message);
      }
    } finally {
      isProcessing = false;
    }
  },

  /**
   * Traiter un événement individuel
   */
  processEvent: async (event) => {
    const { type, action, wp_id, data } = event;

    switch (type) {
      case 'customer':
        await wcSyncService.processCustomer(action, wp_id, data);
        break;
      case 'product':
        await wcSyncService.processProduct(action, wp_id, data);
        break;
      case 'order':
        await wcSyncService.processOrder(action, wp_id, data);
        break;
      case 'refund':
        await wcSyncService.processRefund(action, wp_id, data);
        break;
      default:
        console.log(`🔄 WC Sync: Type inconnu: ${type}`);
    }
  },

  /**
   * Traiter un client (format Data_Fetcher::get_customer)
   * Table: customers (wp_user_id, email, first_name, last_name, user_registered, etc.)
   */
  processCustomer: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM customers WHERE wp_user_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Customer #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO customers (
        wp_user_id, email, first_name, last_name, user_registered, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (wp_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        updated_at = NOW()
    `, [
      data.wp_customer_id,
      data.email,
      data.first_name,
      data.last_name,
      data.date_created
    ]);

    console.log(`🔄 WC Sync: Customer #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'}`);
  },

  /**
   * Traiter un produit (format Data_Fetcher::get_product)
   * Table: products (wp_product_id, wp_parent_id, product_type, post_title, sku, etc.)
   */
  processProduct: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM products WHERE wp_product_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Product #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO products (
        wp_product_id, wp_parent_id, product_type, post_title, sku, post_status,
        stock_status, stock, price, regular_price, image_url, weight, post_date, post_modified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (wp_product_id)
      DO UPDATE SET
        wp_parent_id = EXCLUDED.wp_parent_id,
        product_type = EXCLUDED.product_type,
        post_title = EXCLUDED.post_title,
        sku = EXCLUDED.sku,
        post_status = EXCLUDED.post_status,
        stock_status = EXCLUDED.stock_status,
        stock = EXCLUDED.stock,
        price = EXCLUDED.price,
        regular_price = EXCLUDED.regular_price,
        image_url = EXCLUDED.image_url,
        weight = EXCLUDED.weight,
        post_modified = EXCLUDED.post_modified
    `, [
      data.wp_product_id, data.parent_id || null, data.type, data.name,
      data.sku, data.status, data.stock_status, data.stock_quantity,
      data.price, data.regular_price, data.image_url || null, data.weight || null,
      data.date_created, data.date_modified
    ]);

    // Traiter les variations si presentes (donnees completes depuis v1.3.1)
    if (data.variations && Array.isArray(data.variations) && data.variations.length > 0) {
      for (const variation of data.variations) {
        if (variation.wp_product_id) {
          await wcSyncService.processProduct(action, variation.wp_product_id, variation);
        }
      }
    }

    console.log(`🔄 WC Sync: Product #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'}`);
  },

  /**
   * Traiter une commande (format Data_Fetcher::get_order)
   * Tables: orders + order_items
   */
  processOrder: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM order_items WHERE wp_order_id = $1', [wpId]);
      await pool.query('DELETE FROM orders WHERE wp_order_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Order #${wpId} supprimé`);
      return;
    }

    // Upsert order
    await pool.query(`
      INSERT INTO orders (
        wp_order_id, wp_customer_id, post_status, order_total, order_tax,
        order_shipping, cart_discount, payment_method_title,
        billing_first_name, billing_last_name, billing_address_1, billing_address_2,
        billing_city, billing_postcode, billing_country, billing_email, billing_phone,
        shipping_first_name, shipping_last_name, shipping_address_1,
        shipping_city, shipping_postcode, shipping_country,
        shipping_method, shipping_carrier, tracking_number,
        post_date, post_modified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (wp_order_id)
      DO UPDATE SET
        post_status = EXCLUDED.post_status,
        order_total = EXCLUDED.order_total,
        order_tax = EXCLUDED.order_tax,
        order_shipping = EXCLUDED.order_shipping,
        cart_discount = EXCLUDED.cart_discount,
        shipping_method = COALESCE(EXCLUDED.shipping_method, orders.shipping_method),
        shipping_carrier = COALESCE(EXCLUDED.shipping_carrier, orders.shipping_carrier),
        tracking_number = COALESCE(EXCLUDED.tracking_number, orders.tracking_number),
        post_modified = EXCLUDED.post_modified
    `, [
      data.wp_order_id, data.customer_id, 'wc-' + data.status, data.total,
      data.total_tax, data.shipping_total, data.discount_total, data.payment_method_title,
      data.billing_first_name, data.billing_last_name, data.billing_address_1,
      data.billing_address_2, data.billing_city, data.billing_postcode,
      data.billing_country, data.customer_email, data.billing_phone,
      data.shipping_first_name, data.shipping_last_name, data.shipping_address_1,
      data.shipping_city, data.shipping_postcode, data.shipping_country,
      data.shipping_method || null, data.shipping_carrier || null, data.tracking_number || null,
      data.date_created, data.date_modified
    ]);

    // Delete old items and insert new ones
    await pool.query('DELETE FROM order_items WHERE wp_order_id = $1', [wpId]);

    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        await pool.query(`
          INSERT INTO order_items (
            wp_order_id, order_item_id, order_item_name, order_item_type,
            product_id, variation_id, qty, line_subtotal, line_total, line_tax
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          wpId, item.item_id || 0, item.name, 'line_item',
          item.product_id, item.variation_id || null, item.quantity,
          item.subtotal, item.total, item.tax
        ]);
      }
    }

    console.log(`🔄 WC Sync: Order #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'} (${data.items?.length || 0} items)`);
  },

  /**
   * Traiter un remboursement (format Data_Fetcher::get_refund)
   * Table: refunds
   */
  processRefund: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM refunds WHERE wp_refund_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Refund #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO refunds (wp_refund_id, wp_order_id, refund_amount, refund_reason, refund_date)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (wp_refund_id)
      DO UPDATE SET
        refund_amount = EXCLUDED.refund_amount,
        refund_reason = EXCLUDED.refund_reason,
        updated_at = NOW()
    `, [
      data.wp_refund_id, data.wp_order_id, data.refund_amount,
      data.refund_reason, data.refund_date
    ]);

    console.log(`🔄 WC Sync: Refund #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'}`);
  },

  /**
   * Obtenir le statut du service
   */
  getStatus: async () => {
    const intervalConfig = await appConfigModel.get('wc_sync_interval');
    const wpUrlConfig = await appConfigModel.get('wc_sync_wp_url');
    const wpTokenConfig = await appConfigModel.get('wc_sync_wp_token');

    return {
      enabled: syncInterval !== null,
      interval: intervalConfig ? parseInt(intervalConfig.config_value) : 0,
      configured: !!(wpUrlConfig && wpTokenConfig),
      isProcessing
    };
  }
};

module.exports = wcSyncService;
