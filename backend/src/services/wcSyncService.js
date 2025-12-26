/**
 * WooCommerce Sync Service
 * Poll WordPress pour récupérer la queue YouSync et traiter les événements
 */

const axios = require('axios');
const appConfigModel = require('../models/appConfigModel');
const pool = require('../config/database');

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
          'X-YouSync-Token': wpToken,
          'Host': 'vps.youvape.fr'
        },
        timeout: 30000
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
              'Host': 'vps.youvape.fr',
              'Content-Type': 'application/json'
            },
            timeout: 10000
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
   */
  processCustomer: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM woo_customers WHERE wp_user_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Customer #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO woo_customers (
        wp_user_id, email, first_name, last_name, display_name, username,
        billing_first_name, billing_last_name, billing_company, billing_address_1,
        billing_address_2, billing_city, billing_postcode, billing_country,
        billing_phone, billing_email, shipping_first_name, shipping_last_name,
        shipping_company, shipping_address_1, shipping_address_2, shipping_city,
        shipping_postcode, shipping_country, date_created, date_modified,
        orders_count, total_spent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (wp_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        display_name = EXCLUDED.display_name,
        billing_first_name = EXCLUDED.billing_first_name,
        billing_last_name = EXCLUDED.billing_last_name,
        billing_company = EXCLUDED.billing_company,
        billing_address_1 = EXCLUDED.billing_address_1,
        billing_address_2 = EXCLUDED.billing_address_2,
        billing_city = EXCLUDED.billing_city,
        billing_postcode = EXCLUDED.billing_postcode,
        billing_country = EXCLUDED.billing_country,
        billing_phone = EXCLUDED.billing_phone,
        billing_email = EXCLUDED.billing_email,
        shipping_first_name = EXCLUDED.shipping_first_name,
        shipping_last_name = EXCLUDED.shipping_last_name,
        shipping_company = EXCLUDED.shipping_company,
        shipping_address_1 = EXCLUDED.shipping_address_1,
        shipping_address_2 = EXCLUDED.shipping_address_2,
        shipping_city = EXCLUDED.shipping_city,
        shipping_postcode = EXCLUDED.shipping_postcode,
        shipping_country = EXCLUDED.shipping_country,
        date_modified = EXCLUDED.date_modified,
        orders_count = EXCLUDED.orders_count,
        total_spent = EXCLUDED.total_spent
    `, [
      data.wp_customer_id, data.email, data.first_name, data.last_name,
      data.display_name, data.username, data.billing_first_name,
      data.billing_last_name, data.billing_company, data.billing_address_1,
      data.billing_address_2, data.billing_city, data.billing_postcode,
      data.billing_country, data.billing_phone, data.billing_email,
      data.shipping_first_name, data.shipping_last_name, data.shipping_company,
      data.shipping_address_1, data.shipping_address_2, data.shipping_city,
      data.shipping_postcode, data.shipping_country, data.date_created,
      data.date_modified, data.orders_count, data.total_spent
    ]);

    console.log(`🔄 WC Sync: Customer #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'}`);
  },

  /**
   * Traiter un produit (format Data_Fetcher::get_product)
   */
  processProduct: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM woo_products WHERE wp_product_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Product #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO woo_products (
        wp_product_id, parent_id, product_type, post_title, sku, post_status,
        stock_status, stock, price, regular_price, sale_price, category,
        sub_category, brand, sub_brand, image_url, permalink, date_created, date_modified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (wp_product_id)
      DO UPDATE SET
        parent_id = EXCLUDED.parent_id,
        product_type = EXCLUDED.product_type,
        post_title = EXCLUDED.post_title,
        sku = EXCLUDED.sku,
        post_status = EXCLUDED.post_status,
        stock_status = EXCLUDED.stock_status,
        stock = EXCLUDED.stock,
        price = EXCLUDED.price,
        regular_price = EXCLUDED.regular_price,
        sale_price = EXCLUDED.sale_price,
        category = EXCLUDED.category,
        sub_category = EXCLUDED.sub_category,
        brand = EXCLUDED.brand,
        sub_brand = EXCLUDED.sub_brand,
        image_url = EXCLUDED.image_url,
        permalink = EXCLUDED.permalink,
        date_modified = EXCLUDED.date_modified
    `, [
      data.wp_product_id, data.parent_id, data.type, data.name,
      data.sku, data.status, data.stock_status, data.stock_quantity,
      data.price, data.regular_price, data.sale_price, data.category || null,
      data.sub_category || null, data.brand || null, data.sub_brand || null,
      data.image_url, data.permalink, data.date_created, data.date_modified
    ]);

    console.log(`🔄 WC Sync: Product #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'}`);
  },

  /**
   * Traiter une commande (format Data_Fetcher::get_order)
   */
  processOrder: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM woo_order_items WHERE wp_order_id = $1', [wpId]);
      await pool.query('DELETE FROM woo_orders WHERE wp_order_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Order #${wpId} supprimé`);
      return;
    }

    // Upsert order
    await pool.query(`
      INSERT INTO woo_orders (
        wp_order_id, order_number, post_status, currency, order_total, order_subtotal,
        total_tax, shipping_total, discount_total, payment_method, payment_method_title,
        wp_user_id, customer_email, billing_first_name, billing_last_name, billing_company,
        billing_address_1, billing_address_2, billing_city, billing_postcode, billing_country,
        billing_phone, shipping_first_name, shipping_last_name, shipping_address_1,
        shipping_address_2, shipping_city, shipping_postcode, shipping_country,
        customer_note, post_date, date_modified, date_completed, date_paid
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
      ON CONFLICT (wp_order_id)
      DO UPDATE SET
        post_status = EXCLUDED.post_status,
        order_total = EXCLUDED.order_total,
        order_subtotal = EXCLUDED.order_subtotal,
        total_tax = EXCLUDED.total_tax,
        shipping_total = EXCLUDED.shipping_total,
        discount_total = EXCLUDED.discount_total,
        date_modified = EXCLUDED.date_modified,
        date_completed = EXCLUDED.date_completed,
        date_paid = EXCLUDED.date_paid
    `, [
      data.wp_order_id, data.order_number, 'wc-' + data.status, data.currency,
      data.total, data.subtotal, data.total_tax, data.shipping_total,
      data.discount_total, data.payment_method, data.payment_method_title,
      data.customer_id, data.customer_email, data.billing_first_name, data.billing_last_name,
      data.billing_company, data.billing_address_1, data.billing_address_2,
      data.billing_city, data.billing_postcode, data.billing_country, data.billing_phone,
      data.shipping_first_name, data.shipping_last_name, data.shipping_address_1,
      data.shipping_address_2, data.shipping_city, data.shipping_postcode,
      data.shipping_country, data.customer_note, data.date_created, data.date_modified,
      data.date_completed, data.date_paid
    ]);

    // Delete old items and insert new ones
    await pool.query('DELETE FROM woo_order_items WHERE wp_order_id = $1', [wpId]);

    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        await pool.query(`
          INSERT INTO woo_order_items (
            wp_order_id, product_id, variation_id, order_item_name, qty,
            line_subtotal, line_total, line_tax, sku
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          wpId, item.product_id, item.variation_id || null, item.name,
          item.quantity, item.subtotal, item.total, item.tax, item.sku
        ]);
      }
    }

    console.log(`🔄 WC Sync: Order #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'} (${data.items?.length || 0} items)`);
  },

  /**
   * Traiter un remboursement (format Data_Fetcher::get_refund)
   */
  processRefund: async (action, wpId, data) => {
    if (action === 'delete') {
      await pool.query('DELETE FROM woo_refunds WHERE wp_refund_id = $1', [wpId]);
      console.log(`🔄 WC Sync: Refund #${wpId} supprimé`);
      return;
    }

    await pool.query(`
      INSERT INTO woo_refunds (wp_refund_id, wp_order_id, refund_amount, refund_reason, refund_date)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (wp_refund_id)
      DO UPDATE SET
        refund_amount = EXCLUDED.refund_amount,
        refund_reason = EXCLUDED.refund_reason
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
