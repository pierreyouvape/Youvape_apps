/**
 * WooCommerce Sync Service
 * Poll WordPress pour récupérer la queue YouSync et traiter les événements
 */

const appConfigModel = require('../models/appConfigModel');
const pool = require('../config/database');
const refundLinesService = require('./refundLinesService');
const yousyncClient = require('./yousyncClient');
const { sendAlert } = require('./alertService');
const { decodeWpText } = require('../utils/wpText');
const { validateEvent } = require('../utils/yousyncPayload');

// Code passerelle WooCommerce → libellé tel que le site l'écrit d'habitude
// (relevé sur les commandes du 27/10/2026), pour les commandes reçues sans libellé
const GATEWAY_LABELS = {
  mollie_wc_gateway_creditcard: 'Carte Bancaire',
  mollie_wc_gateway_bancontact: 'Bancontact',
  mollie_wc_gateway_alma: 'En 3 ou 4x sans frais',
  alma_in_page: 'En 3 ou 4x sans frais',
  mollie_wc_gateway_paybybank: 'Virement saisie automatique',
  'ppcp-gateway': 'PayPal',
  systempaystd: 'Paiement par carte bancaire'
};

let syncInterval = null;
let isProcessing = false;

/*
 * Battement de coeur de la synchro.
 *
 * Persisté dans app_config, donc SURVIT aux rebuilds Docker — contrairement aux
 * logs du conteneur, seule trace jusqu'ici, effacés à chaque `docker compose
 * up --build`. Le 08/09/2026, c'est précisément la fenêtre de logs nécessaire à
 * une enquête qui avait disparu de cette façon.
 *
 * Clés (convention des autres synchros : bms_last_po_sync_at, nextore_last_*) :
 *   wc_sync_status          running | disabled | unconfigured
 *   wc_sync_last_poll_ok_at dernier poll ABOUTI, même sans aucun événement
 *   wc_sync_last_event_at   dernier événement réellement traité
 *   wc_sync_last_batch_size taille du dernier lot (un lot qui gonfle = file en retard)
 *   wc_sync_last_error      {message, code, at} du dernier échec, effacé au retour à la normale
 *   wc_sync_queue           {protocol, paused, pending, failed, oldest_pending_at, at}, file vue du site
 *
 * Le poll abouti est enregistré même quand la file est vide : c'est LE signal de
 * vie. Ne l'écrire qu'en présence d'événements ferait passer une nuit calme pour
 * une panne.
 */
const HEARTBEAT_KEYS = {
  status: 'wc_sync_status',
  lastPollOkAt: 'wc_sync_last_poll_ok_at',
  lastEventAt: 'wc_sync_last_event_at',
  lastBatchSize: 'wc_sync_last_batch_size',
  lastError: 'wc_sync_last_error',
  queue: 'wc_sync_queue',
};

// Tant que le site répond « route absente » en v2, on reste en v1. On retente la
// v2 toutes les 5 min : le passage se fait seul quand l'agence pose le plugin.
const V1_RETRY_MS = 5 * 60 * 1000;

/**
 * Écrit une clé de battement de coeur sans jamais faire échouer l'appelant :
 * un incident sur la mesure ne doit pas arrêter la synchronisation qu'elle mesure.
 */
let errorNeedsClearing = true;

async function heartbeat(key, value) {
  try {
    await appConfigModel.upsert(key, String(value));
  } catch (err) {
    console.error(`🫀 Battement de coeur non enregistré (${key}):`, err.message);
  }
}

// Anti-spam alertes
let pollFailureAlerted = false;
const failedEventKeys = new Set(); // "type:wp_id" deja alertes
let alertedFailedCount = 0;
let pauseAlerted = false;

// Fin de la période où l'on reste en v1 sans réessayer la v2.
let v1Until = 0;

/**
 * Exécute `fn` dans une transaction : tout est écrit, ou rien. Le contenu vient de
 * l'extérieur et une écriture interrompue ne doit pas laisser une commande sans
 * ses lignes (l'ancien DELETE + INSERT en plusieurs requêtes le permettait).
 */
const inTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Motif d'échec sans donnée client. Le message d'une erreur Postgres peut recopier
 * une valeur reçue : on ne garde que le code SQL et le nom de la contrainte.
 */
const safeReason = (err) => (err.code ? `DB_${err.code}${err.constraint ? ` ${err.constraint}` : ''}` : 'PROCESSING_ERROR');

const ackCode = (err) => (err.code ? `DB_${err.code}` : 'PROCESSING_ERROR');

/**
 * Si le site refuse le jeton alors qu'un renouvellement est resté en suspens, c'est
 * que le site a déjà basculé et que l'ancien a expiré : on adopte le nouveau plutôt
 * que de couper la synchro (voir yousyncTokenService).
 */
const withTokenRecovery = async (conn, fn) => {
  try {
    return await fn(conn);
  } catch (err) {
    if (err.response?.status !== 401 || !conn.pendingToken) throw err;
    const result = await fn({ ...conn, token: conn.pendingToken });
    await yousyncClient.promoteToken(conn.pendingToken);
    conn.token = conn.pendingToken;
    conn.pendingToken = null;
    console.log('🔄 WC Sync: renouvellement du jeton terminé (jeton en attente adopté)');
    return result;
  }
};

/** Lit la file en v2, ou en v1 tant que le plugin n'est pas passé en 2.0. */
const readQueue = async (conn) => {
  const readV2 = () => withTokenRecovery(conn, yousyncClient.readQueueV2);

  if (Date.now() >= v1Until) {
    try {
      return await readV2();
    } catch (err) {
      if (!yousyncClient.isNoRoute(err)) throw err;
      v1Until = Date.now() + V1_RETRY_MS;
    }
  }

  try {
    return await yousyncClient.readQueueV1(conn);
  } catch (err) {
    if (!yousyncClient.isNoRoute(err)) throw err;
    // La v1 a disparu : le plugin vient de passer en 2.0.
    v1Until = 0;
    return readV2();
  }
};

/** État de la file vu du site, et alertes qui en découlent. */
const noteQueueState = async ({ protocol, paused, stats }) => {
  await heartbeat(HEARTBEAT_KEYS.queue, JSON.stringify({
    protocol,
    paused,
    pending: stats.pending ?? null,
    failed: stats.failed ?? null,
    oldest_pending_at: stats.oldest_pending_at ?? null,
    at: new Date().toISOString(),
  }));

  if (paused !== pauseAlerted) {
    pauseAlerted = paused;
    sendAlert(
      paused ? 'YouSync: livraison en pause' : 'YouSync: livraison reprise',
      paused
        ? 'La livraison des evenements est suspendue depuis l\'admin WordPress. Tout est enregistre et repartira a la reprise, mais rien n\'arrive dans l\'app en attendant.'
        : 'La livraison des evenements a repris.'
    );
  }

  const failedCount = Number(stats.failed) || 0;
  if (failedCount > alertedFailedCount) {
    const sample = (Array.isArray(stats.failed_sample) ? stats.failed_sample : [])
      .map(l => `- ${l.type} #${l.wp_id} : ${l.code}`).join('\n');
    sendAlert(
      `YouSync: ${failedCount} evenement(s) en echec`,
      `${failedCount} evenement(s) sont passes en echec apres plusieurs essais. Ils ne bloquent plus la file et restent dans la table du plugin.\n\n${sample}\n\nA rejouer depuis l'admin WordPress (YouSync), une fois la cause corrigee.`
    );
  }
  alertedFailedCount = failedCount;
};

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
      // Consigné en base : sans ça, une synchro coupée par un réglage à 0 est
      // indiscernable d'une synchro en panne, et rien ne le dit hors des logs.
      await heartbeat(HEARTBEAT_KEYS.status, 'disabled');
      return;
    }

    // Récupérer l'URL et le token WP
    const wpUrlConfig = await appConfigModel.get('wc_sync_wp_url');
    const wpTokenConfig = await appConfigModel.get('wc_sync_wp_token');

    if (!wpUrlConfig || !wpTokenConfig) {
      console.log('🔄 WC Sync Service: Non configuré (URL ou token manquant)');
      await heartbeat(HEARTBEAT_KEYS.status, 'unconfigured');
      return;
    }

    console.log(`🔄 WC Sync Service: Démarré (intervalle: ${intervalSeconds}s)`);
    errorNeedsClearing = true;
    await heartbeat(HEARTBEAT_KEYS.status, 'running');

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
      const conn = await yousyncClient.connection();
      if (!conn) {
        return;
      }

      const queue = await readQueue(conn);
      const { protocol, events } = queue;

      // Signal de vie, noté AVANT le retour anticipé ci-dessous : un poll abouti
      // sur une file vide est un poll SAIN. Ne l'enregistrer qu'en présence
      // d'événements ferait passer une nuit sans commande pour une panne.
      await heartbeat(HEARTBEAT_KEYS.lastPollOkAt, new Date().toISOString());
      if (errorNeedsClearing) {
        await heartbeat(HEARTBEAT_KEYS.lastError, '');
        errorNeedsClearing = false;
      }
      await noteQueueState(queue);

      // Poll reussi — notifier le retour a la normale si on etait en panne
      if (pollFailureAlerted) {
        pollFailureAlerted = false;
        sendAlert(
          'YouSync: polling retabli',
          `Le polling YouSync fonctionne de nouveau.\n\nLe service a repris la synchronisation normalement.`
        );
      }

      if (events.length === 0) {
        return; // Pas d'événements à traiter
      }

      console.log(`🔄 WC Sync: ${events.length} événement(s) à traiter (${protocol})`);

      const processed = [];
      const failed = [];

      for (const event of events) {
        const label = `${event?.type} #${event?.wp_id}`;
        const eventKey = `${event?.type}:${event?.wp_id}`;
        let code;

        const invalidField = validateEvent(event, protocol);
        if (invalidField) {
          code = 'INVALID_PAYLOAD';
          console.error(`🔄 WC Sync: ${label} refusé, champ invalide : ${invalidField}`);
        } else {
          try {
            await wcSyncService.processEvent(event, protocol);
            processed.push(event);
            // Event traite avec succes — retirer du set anti-spam
            failedEventKeys.delete(eventKey);
            continue;
          } catch (err) {
            code = ackCode(err);
            console.error(`🔄 WC Sync Error: ${label}: ${safeReason(err)}`);
          }
        }

        if (Array.isArray(event?.ids)) failed.push({ ids: event.ids, code });
        if (!failedEventKeys.has(eventKey)) {
          failedEventKeys.add(eventKey);
          sendAlert(
            `YouSync: echec traitement ${label}`,
            `Le traitement de l'evenement ${label} (action: ${event?.action}) a echoue.\n\nCode: ${code}\n\nCet event sera re-tente au prochain poll. Apres plusieurs essais, il passe en echec dans la table du plugin, sans bloquer la file.`
          );
        }
      }

      // Si des commandes ont été traitées, lancer un rattrapage des commandes
      // importées de façon incomplète (créées en back-office WC, synchronisées
      // trop tôt par YouSync avant calcul des totaux). Fire-and-forget : ne doit
      // jamais bloquer ni faire échouer le cycle de sync.
      if (processed.some(e => e.type === 'order')) {
        const { reimportIncompleteOrders } = require('../controllers/ordersController');
        reimportIncompleteOrders().catch(err => {
          console.error('🔁 Rattrapage commandes incomplètes échoué:', err.message);
        });
      }

      // Taille du lot : un lot qui gonfle poll après poll signale une file en
      // retard, ce qu'aucune autre mesure ne montre.
      await heartbeat(HEARTBEAT_KEYS.lastBatchSize, events.length);
      if (processed.length > 0) {
        await heartbeat(HEARTBEAT_KEYS.lastEventAt, new Date().toISOString());
      }

      // Acquitter les événements traités (et, en v2, signaler ceux en échec)
      if (processed.length > 0 || failed.length > 0) {
        try {
          if (protocol === 'v2') {
            await yousyncClient.ackV2(conn, processed.flatMap(e => e.ids), failed);
          } else {
            await yousyncClient.ackV1(conn, processed);
          }
          console.log(`🔄 WC Sync: ${processed.length} événement(s) acquitté(s), ${failed.length} en échec`);
        } catch (err) {
          console.error('🔄 WC Sync: Erreur acquittement:', err.message);
          sendAlert(
            `YouSync: echec acquittement events`,
            `L'acquittement de ${processed.length} evenement(s) aupres de WordPress a echoue.\n\nErreur: ${err.message}\n\nCes events seront re-envoyes par WP au prochain poll (doublons possibles).`
          );
        }
      }

    } catch (err) {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT') {
        console.error('🔄 WC Sync Poll Error:', err.message);
      }
      const siteCode = err.response?.data?.code || null;
      await heartbeat(HEARTBEAT_KEYS.lastError, JSON.stringify({
        message: err.message,
        code: err.code || null,
        siteCode,
        at: new Date().toISOString(),
      }));
      errorNeedsClearing = true;

      if (!pollFailureAlerted) {
        pollFailureAlerted = true;
        sendAlert(
          `YouSync: polling en panne`,
          `Le polling YouSync n'arrive plus a contacter WordPress.\n\nErreur: ${err.message}\nCode: ${siteCode || err.code || 'N/A'}\n\nLes commandes, produits et clients ne sont plus synchronises. Verifiez que le site WP est accessible et que le plugin YouSync est actif.`
        );
      }
    } finally {
      isProcessing = false;
    }
  },

  /**
   * Traiter un événement individuel
   */
  processEvent: async (event, protocol = 'v2') => {
    const { type, action, wp_id, data } = event;

    if (event.gone === true) {
      return wcSyncService.processGone(event);
    }

    switch (type) {
      case 'customer':
        await wcSyncService.processCustomer(action, wp_id, data);
        break;
      case 'product':
        // Fiche et déclinaisons ensemble, ou rien.
        await inTransaction(client => wcSyncService.processProduct(action, wp_id, data, client));
        break;
      case 'order':
        await wcSyncService.processOrder(action, wp_id, data);
        break;
      case 'refund':
        await wcSyncService.processRefund(action, wp_id, data);
        break;
      default:
        console.log(`🔄 WC Sync: Type inconnu: ${type} (${protocol})`);
    }
  },

  /**
   * L'objet n'existe plus sur le site.
   *
   * Commande et client : rien ne se propage, notre base est une archive
   * (commandes référencées par les retours, clients par le SAV). L'événement est
   * tout de même acquitté : le marqueur a été lu, il ne reste plus rien à faire.
   * Remboursement : il doit disparaître, sinon il resterait déduit du CA.
   * Produit : même traitement qu'une suppression, la fiche reste en historique.
   */
  processGone: async ({ type, wp_id: wpId, parent_id: parentId }) => {
    if (type === 'refund') {
      await wcSyncService.processRefund('delete', wpId, { wp_order_id: parentId || null });
    } else if (type === 'product') {
      await wcSyncService.processProduct('delete', wpId, null);
    } else {
      console.log(`🔄 WC Sync: ${type} #${wpId} disparu du site, conservé ici`);
    }
  },

  /**
   * Traiter un client (format Data_Fetcher::get_customer)
   * Table: customers (wp_user_id, email, first_name, last_name, user_registered, etc.)
   */
  processCustomer: async (action, wpId, data) => {
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
  processProduct: async (action, wpId, data, db = pool) => {
    if (action === 'delete') {
      // JAMAIS de DELETE : commandes d'achat, réceptions et documents fournisseur
      // référencent la fiche par des FK sans CASCADE, et l'historique (ce qui a
      // été acheté, vendu) doit rester lisible. Un DELETE échouait donc en boucle
      // (« violates foreign key constraint purchase_order_items_product_id_fkey »,
      // CLK One 20mg scindées en un nouveau produit le 13/10/2026).
      // On fait comme le cron de 3h (productDbSyncService) : la fiche est marquée
      // supprimée de WC (`wc_deleted_at`, exclue du catalogue) et son stock est
      // neutralisé, sinon il serait compté en double avec celui de la fiche qui
      // la remplace. Réversible : une fiche restaurée dans WC perd le marqueur au
      // passage suivant du cron de 3h, et retrouve son stock au premier event.
      const del = await db.query(
        `UPDATE products
            SET wc_deleted_at = COALESCE(wc_deleted_at, NOW()),
                stock = 0, stock_status = 'outofstock', track_stock = false,
                updated_at = NOW()
          WHERE wp_product_id = $1
          RETURNING id`,
        [wpId],
      );
      console.log(`🔄 WC Sync: Product #${wpId} ${del.rowCount ? 'marqué supprimé de WC (stock neutralisé, historique conservé)' : 'absent de la base, rien à faire'}`);
      return;
    }

    // Light update — stock change only (pas de name/type = event LIGHT depuis on_stock_changed)
    if (data.stock_quantity !== undefined && !data.name && !data.type) {
      const stockResult = await db.query(
        'UPDATE products SET stock = $1, stock_status = $2, post_modified = NOW(), updated_at = NOW() WHERE wp_product_id = $3 RETURNING wp_product_id',
        [data.stock_quantity, data.stock_status || 'instock', wpId]
      );
      if (stockResult.rowCount === 0) {
        console.log(`  ⚠️ Product #${wpId} not found for stock update, skipping`);
        return;
      }
      console.log(`🔄 WC Sync: Product #${wpId} stock updated to ${data.stock_quantity} (${data.stock_status || 'instock'})`);
      return;
    }

    // Full create/update
    await db.query(`
      INSERT INTO products (
        wp_product_id, wp_parent_id, product_type, post_title, sku, post_status,
        stock_status, stock, price, regular_price, image_url, weight, post_date, post_modified,
        brand, sub_brand, category, sub_category, manage_stock
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
        post_modified = EXCLUDED.post_modified,
        brand = COALESCE(EXCLUDED.brand, products.brand),
        sub_brand = COALESCE(EXCLUDED.sub_brand, products.sub_brand),
        category = COALESCE(EXCLUDED.category, products.category),
        sub_category = COALESCE(EXCLUDED.sub_category, products.sub_category),
        manage_stock = EXCLUDED.manage_stock,
        -- Même oubli que pour la table orders. La mise à jour rapide du stock,
        -- juste au-dessus, pose bien updated_at = NOW() ; cet upsert complet, non.
        updated_at = NOW()
    `, [
      data.wp_product_id, data.parent_id || null, data.type, decodeWpText(data.name),
      data.sku, data.status, data.stock_status, data.stock_quantity,
      data.price, data.regular_price, data.image_url || null, data.weight || null,
      data.date_created, data.date_modified,
      data.brand || null, data.sub_brand || null,
      data.category || null, data.sub_category || null,
      data.manage_stock === true
    ]);

    // Traiter les variations si presentes (donnees completes depuis v1.3.1)
    if (data.variations && Array.isArray(data.variations) && data.variations.length > 0) {
      for (const variation of data.variations) {
        if (variation.wp_product_id) {
          await wcSyncService.processProduct(action, variation.wp_product_id, variation, db);
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
    // Mollie laisse parfois le libellé vide alors que le code de la passerelle est bien là
    // (1267806 : Bancontact payé, titre ''). Sans repli, la commande sortait sans moyen
    // de paiement dans les rapports et ses frais étaient calculés au taux par défaut.
    if (!data.payment_method_title && GATEWAY_LABELS[data.payment_method]) {
      data.payment_method_title = GATEWAY_LABELS[data.payment_method];
    }

    // Tout ou rien, et sérialisé par le verrou de ligne de l'upsert : la synchro et
    // le rattrapage peuvent traiter la même commande en même temps.
    await inTransaction(async (client) => {
      // Upsert order
      const attr = data.attribution || {};
      const pm = data.payment_meta || {};
      await client.query(`
        INSERT INTO orders (
          wp_order_id, wp_customer_id, post_status, order_total, order_tax,
          order_shipping, cart_discount, payment_method_title,
          billing_first_name, billing_last_name, billing_address_1, billing_address_2,
          billing_city, billing_postcode, billing_country, billing_email, billing_phone,
          shipping_first_name, shipping_last_name, shipping_address_1, shipping_address_2,
          shipping_city, shipping_postcode, shipping_country,
          shipping_method, shipping_carrier, tracking_number,
          post_date, post_modified,
          attribution_source_type, attribution_referrer,
          attribution_utm_source, attribution_utm_medium, attribution_utm_campaign,
          attribution_utm_content, attribution_utm_term,
          attribution_session_entry, attribution_session_start_time,
          attribution_session_pages, attribution_session_count,
          attribution_user_agent, attribution_device_type,
          transaction_id, mollie_payment_id, mollie_order_id,
          mollie_payment_mode, mollie_customer_id,
          date_paid, paid_date,
          mollie_payment_instructions, mollie_paid_and_processed,
          relay_point
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52)
        ON CONFLICT (wp_order_id)
        DO UPDATE SET
          -- Le propriétaire de la commande DOIT être remis à jour : il était absent
          -- de cette liste, si bien qu'un wp_customer_id erroné restait figé même
          -- après des mois de sync live portant pourtant la bonne valeur (WooCommerce
          -- la fournit via $order->get_customer_id()). C'est ce qui a laissé perdurer
          -- les 24 871 commandes mal rattachées par backfillGap.js.
          -- COALESCE : un payload sans client (commande invité) ne doit pas effacer
          -- un rattachement valide déjà en base.
          wp_customer_id = COALESCE(EXCLUDED.wp_customer_id, orders.wp_customer_id),
          post_status = EXCLUDED.post_status,
          order_total = EXCLUDED.order_total,
          order_tax = EXCLUDED.order_tax,
          order_shipping = EXCLUDED.order_shipping,
          cart_discount = EXCLUDED.cart_discount,
          payment_method_title = COALESCE(NULLIF(EXCLUDED.payment_method_title, ''), orders.payment_method_title),
          billing_first_name = COALESCE(NULLIF(EXCLUDED.billing_first_name, ''), orders.billing_first_name),
          billing_last_name = COALESCE(NULLIF(EXCLUDED.billing_last_name, ''), orders.billing_last_name),
          billing_address_1 = COALESCE(NULLIF(EXCLUDED.billing_address_1, ''), orders.billing_address_1),
          billing_address_2 = COALESCE(EXCLUDED.billing_address_2, orders.billing_address_2),
          billing_city = COALESCE(NULLIF(EXCLUDED.billing_city, ''), orders.billing_city),
          billing_postcode = COALESCE(NULLIF(EXCLUDED.billing_postcode, ''), orders.billing_postcode),
          billing_country = COALESCE(NULLIF(EXCLUDED.billing_country, ''), orders.billing_country),
          billing_email = COALESCE(NULLIF(EXCLUDED.billing_email, ''), orders.billing_email),
          billing_phone = COALESCE(NULLIF(EXCLUDED.billing_phone, ''), orders.billing_phone),
          shipping_first_name = COALESCE(NULLIF(EXCLUDED.shipping_first_name, ''), orders.shipping_first_name),
          shipping_last_name = COALESCE(NULLIF(EXCLUDED.shipping_last_name, ''), orders.shipping_last_name),
          shipping_address_1 = COALESCE(NULLIF(EXCLUDED.shipping_address_1, ''), orders.shipping_address_1),
          shipping_address_2 = COALESCE(EXCLUDED.shipping_address_2, orders.shipping_address_2),
          shipping_city = COALESCE(NULLIF(EXCLUDED.shipping_city, ''), orders.shipping_city),
          shipping_postcode = COALESCE(NULLIF(EXCLUDED.shipping_postcode, ''), orders.shipping_postcode),
          shipping_country = COALESCE(NULLIF(EXCLUDED.shipping_country, ''), orders.shipping_country),
          shipping_method = COALESCE(EXCLUDED.shipping_method, orders.shipping_method),
          shipping_carrier = COALESCE(EXCLUDED.shipping_carrier, orders.shipping_carrier),
          tracking_number = COALESCE(EXCLUDED.tracking_number, orders.tracking_number),
          -- Rempli seulement s'il manque : une commande créée en back-office arrive
          -- parfois avant que WooCommerce ait posé sa date (reimportIncompleteOrders).
          post_date = COALESCE(orders.post_date, EXCLUDED.post_date),
          post_modified = EXCLUDED.post_modified,
          attribution_source_type = COALESCE(EXCLUDED.attribution_source_type, orders.attribution_source_type),
          attribution_referrer = COALESCE(EXCLUDED.attribution_referrer, orders.attribution_referrer),
          attribution_utm_source = COALESCE(EXCLUDED.attribution_utm_source, orders.attribution_utm_source),
          attribution_utm_medium = COALESCE(EXCLUDED.attribution_utm_medium, orders.attribution_utm_medium),
          attribution_utm_campaign = COALESCE(EXCLUDED.attribution_utm_campaign, orders.attribution_utm_campaign),
          attribution_utm_content = COALESCE(EXCLUDED.attribution_utm_content, orders.attribution_utm_content),
          attribution_utm_term = COALESCE(EXCLUDED.attribution_utm_term, orders.attribution_utm_term),
          attribution_session_entry = COALESCE(EXCLUDED.attribution_session_entry, orders.attribution_session_entry),
          attribution_session_start_time = COALESCE(EXCLUDED.attribution_session_start_time, orders.attribution_session_start_time),
          attribution_session_pages = COALESCE(EXCLUDED.attribution_session_pages, orders.attribution_session_pages),
          attribution_session_count = COALESCE(EXCLUDED.attribution_session_count, orders.attribution_session_count),
          attribution_user_agent = COALESCE(EXCLUDED.attribution_user_agent, orders.attribution_user_agent),
          attribution_device_type = COALESCE(EXCLUDED.attribution_device_type, orders.attribution_device_type),
          transaction_id = COALESCE(EXCLUDED.transaction_id, orders.transaction_id),
          mollie_payment_id = COALESCE(EXCLUDED.mollie_payment_id, orders.mollie_payment_id),
          mollie_order_id = COALESCE(EXCLUDED.mollie_order_id, orders.mollie_order_id),
          mollie_payment_mode = COALESCE(EXCLUDED.mollie_payment_mode, orders.mollie_payment_mode),
          mollie_customer_id = COALESCE(EXCLUDED.mollie_customer_id, orders.mollie_customer_id),
          date_paid = COALESCE(EXCLUDED.date_paid, orders.date_paid),
          paid_date = COALESCE(EXCLUDED.paid_date, orders.paid_date),
          mollie_payment_instructions = COALESCE(EXCLUDED.mollie_payment_instructions, orders.mollie_payment_instructions),
          mollie_paid_and_processed = COALESCE(EXCLUDED.mollie_paid_and_processed, orders.mollie_paid_and_processed),
          -- COALESCE : une commande resynchronisée après expédition ne doit pas
          -- perdre son point relais si le plugin a entre-temps purgé la méta.
          relay_point = COALESCE(EXCLUDED.relay_point, orders.relay_point),
          -- Sans cette ligne, updated_at restait figé à la date de création alors que
          -- le statut, lui, changeait : impossible de savoir quand une commande avait
          -- bougé, ni si la synchro était fraîche. C'est ce qui a rendu muette
          -- l'enquête du 08/09/2026 sur un comptage journalier qui avait varié.
          -- Les autres écrivains de la table (ordersController, orderModel) la posent
          -- déjà ; seul cet upsert-ci, de loin le plus gros volume, l'oubliait.
          updated_at = NOW()
      `, [
        data.wp_order_id, data.customer_id, 'wc-' + data.status, data.total,
        data.total_tax, data.shipping_total, data.discount_total, data.payment_method_title,
        data.billing_first_name, data.billing_last_name, data.billing_address_1,
        data.billing_address_2, data.billing_city, data.billing_postcode,
        data.billing_country, data.customer_email, data.billing_phone,
        data.shipping_first_name, data.shipping_last_name, data.shipping_address_1, data.shipping_address_2 || null,
        data.shipping_city, data.shipping_postcode, data.shipping_country,
        data.shipping_method || null, data.shipping_carrier || null, data.tracking_number || null,
        data.date_created, data.date_modified,
        attr.source_type || null, attr.referrer || null,
        attr.utm_source || null, attr.utm_medium || null, attr.utm_campaign || null,
        attr.utm_content || null, attr.utm_term || null,
        attr.session_entry || null, attr.session_start_time || null,
        attr.session_pages || null, attr.session_count || null,
        attr.user_agent || null, attr.device_type || null,
        pm.transaction_id || null, pm.mollie_payment_id || null, pm.mollie_order_id || null,
        pm.mollie_payment_mode || null, pm.mollie_customer_id || null,
        null, data.date_paid || null,
        pm.mollie_payment_instructions || null, pm.mollie_paid_and_processed || false,
        data.relay_point ? JSON.stringify(data.relay_point) : null
      ]);

      // Delete old items and insert new ones
      await client.query('DELETE FROM order_items WHERE wp_order_id = $1', [wpId]);

      // Line items (19 colonnes)
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          await client.query(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              product_id, variation_id, qty, line_subtotal, line_total, line_tax,
              tax_class, line_subtotal_tax, line_tax_data, product_attributes,
              advanced_discount, wdr_discounts, item_cost, item_total_cost, reduced_stock
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          `, [
            wpId, item.item_id || 0, decodeWpText(item.name), 'line_item',
            item.product_id, item.variation_id || null, item.quantity,
            item.subtotal, item.total, item.tax,
            item.tax_class || null, item.line_subtotal_tax || 0,
            item.line_tax_data ? JSON.stringify(item.line_tax_data) : null,
            item.product_attributes ? JSON.stringify(item.product_attributes) : null,
            item.advanced_discount ? JSON.stringify(item.advanced_discount) : null,
            item.wdr_discounts ? JSON.stringify(item.wdr_discounts) : null,
            item.item_cost || null, item.item_total_cost || null,
            item.reduced_stock || false
          ]);
        }
      }

      // Coupon items
      if (data.coupon_items && data.coupon_items.length > 0) {
        for (const item of data.coupon_items) {
          await client.query(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              line_total, line_tax
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            wpId, item.item_id || 0, item.name, 'coupon',
            item.discount_amount || 0, item.discount_tax || 0
          ]);
        }
      }

      // Fee items
      if (data.fee_items && data.fee_items.length > 0) {
        for (const item of data.fee_items) {
          await client.query(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              line_total, line_tax, tax_class
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            wpId, item.item_id || 0, item.name, 'fee',
            item.total || 0, item.total_tax || 0, item.tax_class || null
          ]);
        }
      }

      // Tax items
      if (data.tax_items && data.tax_items.length > 0) {
        for (const item of data.tax_items) {
          await client.query(`
            INSERT INTO order_items (
              wp_order_id, order_item_id, order_item_name, order_item_type,
              line_total, line_tax, line_tax_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            wpId, item.item_id || 0, item.label || item.rate_code, 'tax',
            item.tax_amount || 0, item.shipping_tax_amount || 0,
            JSON.stringify({ rate_code: item.rate_code, rate_id: item.rate_id, compound: item.compound })
          ]);
        }
      }
    });

    // Appliquer automatiquement les frais de paiement
    const { applyPaymentCostToOrder } = require('../controllers/paymentController');
    await applyPaymentCostToOrder(wpId, data.payment_method_title, data.shipping_country, data.total);

    // Appliquer automatiquement les frais de port
    const { applyShippingCostToOrder } = require('../controllers/shippingController');
    await applyShippingCostToOrder(wpId);

    console.log(`🔄 WC Sync: Order #${wpId} ${action === 'create' ? 'créé' : 'mis à jour'} (${data.items?.length || 0} line, ${data.coupon_items?.length || 0} coupon, ${data.fee_items?.length || 0} fee, ${data.tax_items?.length || 0} tax items)`);
  },

  /**
   * Traiter un remboursement (format Data_Fetcher::get_refund)
   * Table: refunds
   */
  processRefund: async (action, wpId, data) => {
    if (action === 'delete') {
      const { rows: [gone] } = await pool.query(
        'DELETE FROM refunds WHERE wp_refund_id = $1 RETURNING wp_order_id', [wpId]
      );
      console.log(`🔄 WC Sync: Refund #${wpId} supprimé`);
      // Ses lignes (refund_items) partent avec la relecture de la commande.
      refundLinesService.syncOrderInBackground(gone?.wp_order_id || data?.order_id || data?.wp_order_id);
      return;
    }

    await pool.query(`
      INSERT INTO refunds (wp_refund_id, wp_order_id, refund_amount, refund_reason, refund_date, order_total, order_tax)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (wp_refund_id)
      DO UPDATE SET
        refund_amount = EXCLUDED.refund_amount,
        refund_reason = EXCLUDED.refund_reason,
        -- TVA exacte de l'avoir (négative côté WooCommerce). Le plugin l'envoie
        -- depuis la 1.4.2 mais elle n'était pas écrite : 32 remboursements sur 32
        -- sans TVA au 30/10/2026, donc estimée dans les rapports.
        order_total = COALESCE(EXCLUDED.order_total, refunds.order_total),
        order_tax = COALESCE(EXCLUDED.order_tax, refunds.order_tax),
        updated_at = NOW()
    `, [
      data.wp_refund_id, data.wp_order_id, data.refund_amount,
      data.refund_reason, data.refund_date,
      data.order_total ?? null, data.order_tax ?? null
    ]);

    // Articles remboursés : lus chez WC pour le picking, le packing et la fiche.
    refundLinesService.syncOrderInBackground(data.wp_order_id);

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
