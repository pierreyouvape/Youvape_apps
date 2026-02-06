================================================================================
                         YOUSYNC - Documentation Technique
                                  Version 1.2.0
================================================================================

DESCRIPTION
-----------
YouSync est un plugin WordPress qui synchronise en temps réel les données
WooCommerce vers un VPS externe. Le VPS poll périodiquement WordPress pour
récupérer les événements en queue et les traiter.

ARCHITECTURE
------------
1. WordPress (Plugin YouSync) : Écoute les hooks WC, stocke les événements en queue JSON
2. VPS (wcSyncService.js) : Poll la queue via REST API, traite et stocke en PostgreSQL

FLUX DE DONNÉES
---------------
[WooCommerce] → [Hook déclenché] → [Queue JSON] ← [VPS Poll] → [PostgreSQL]

================================================================================
                              DONNÉES SYNCHRONISÉES
================================================================================

COMMANDES (orders)
------------------
Hooks : woocommerce_new_order, woocommerce_order_status_changed, woocommerce_update_order
Données :
  - Infos commande : wp_order_id, status, total, subtotal, tax, shipping, discount
  - Paiement : payment_method, payment_method_title
  - Billing : first_name, last_name, address, city, postcode, country, phone, email
  - Shipping : first_name, last_name, address, city, postcode, country
  - Méthode livraison : shipping_method, shipping_carrier (BMS), tracking_number
  - Items : product_id, variation_id, name, qty, subtotal, total, tax, sku
  - Coupons utilisés

PRODUITS (products)
-------------------
Hooks : woocommerce_new_product, woocommerce_update_product, woocommerce_product_set_stock, before_delete_post
Données :
  - Infos : wp_product_id, parent_id, type, name, slug, sku, status
  - Description : description, short_description
  - Prix : price, regular_price, sale_price, on_sale
  - Stock : stock_quantity, stock_status, manage_stock
  - Dimensions : weight, length, width, height
  - Taxe : tax_status, tax_class
  - Taxonomies : brand, sub_brand, category, sub_category (texte)
  - Variations : attributes (pour variations), children IDs (pour variables)
  - Media : image_url, permalink

CLIENTS (customers)
-------------------
Hooks : woocommerce_created_customer, woocommerce_update_customer, profile_update
Données :
  - Infos : wp_customer_id, email, first_name, last_name, display_name, username
  - Billing : first_name, last_name, company, address, city, postcode, country, phone, email
  - Shipping : first_name, last_name, company, address, city, postcode, country
  - Stats : orders_count, total_spent
  - Dates : date_created, date_modified

REMBOURSEMENTS (refunds)
------------------------
Hooks : woocommerce_refund_created, woocommerce_refund_deleted
Données :
  - wp_refund_id, wp_order_id
  - refund_amount, refund_reason
  - refund_date, refunded_by

================================================================================
                              STRUCTURE DU PLUGIN
================================================================================

yousync/
├── yousync.php                    # Point d'entrée, REST API endpoints
├── includes/
│   ├── class-hooks-manager.php    # Écoute les hooks WooCommerce
│   ├── class-data-fetcher.php     # Récupère les données complètes des entités
│   ├── class-queue-manager.php    # Gestion de la queue JSON (FIFO)
│   ├── class-sync-sender.php      # Envoi vers VPS (mode push, non utilisé)
│   └── class-logger.php           # Logs dans wp-content/uploads/yousync/logs/
└── admin/
    └── class-admin.php            # Interface admin WordPress

================================================================================
                                REST API ENDPOINTS
================================================================================

GET /wp-json/yousync/v1/queue
-----------------------------
Récupère les événements en queue avec données complètes.
Header requis : X-YouSync-Token
Réponse : { success: true, events: [{type, action, wp_id, data, created_at}, ...] }

POST /wp-json/yousync/v1/queue/ack
----------------------------------
Acquitte les événements traités (les supprime de la queue).
Header requis : X-YouSync-Token
Body : { events: [{type, wp_id}, ...] }
Réponse : { success: true, removed: N }

================================================================================
                              CONFIGURATION WORDPRESS
================================================================================

Options stockées dans wp_options (clé: yousync_settings) :
- enabled : boolean - Activer/désactiver la sync
- api_url : string - URL du VPS (non utilisé en mode poll)
- api_token : string - Token d'authentification pour l'API REST
- cron_interval : int - Intervalle cron en minutes (mode push, non utilisé)
- sync_orders : boolean - Synchroniser les commandes
- sync_products : boolean - Synchroniser les produits
- sync_customers : boolean - Synchroniser les clients
- sync_refunds : boolean - Synchroniser les remboursements
- batch_size : int - Nombre max d'événements par poll (défaut: 50)
- retry_hours : int - Heures avant retry (défaut: 24)

================================================================================
                              SERVICE VPS (Node.js)
================================================================================

Fichier : backend/src/services/wcSyncService.js

Fonctions principales :
- start() : Démarre le polling selon l'intervalle configuré
- stop() : Arrête le polling
- poll() : Récupère la queue WP et traite les événements
- processEvent(event) : Dispatch vers le handler approprié
- processCustomer(action, wpId, data) : Upsert/delete dans table customers
- processProduct(action, wpId, data) : Upsert/delete dans table products
- processOrder(action, wpId, data) : Upsert/delete dans tables orders + order_items
- processRefund(action, wpId, data) : Upsert/delete dans table refunds

Configuration VPS (table app_config) :
- wc_sync_interval : Intervalle de poll en secondes (0 = désactivé)
- wc_sync_wp_url : URL WordPress (ex: https://vps.youvape.fr)
- wc_sync_wp_token : Token d'authentification

================================================================================
                              TABLES POSTGRESQL
================================================================================

orders          : Commandes (wp_order_id PK)
order_items     : Lignes de commande (wp_order_id FK)
products        : Produits et variations (wp_product_id PK)
customers       : Clients (wp_user_id PK)
refunds         : Remboursements (wp_refund_id PK)

================================================================================
                              NOTES IMPORTANTES
================================================================================

1. MODE POLL vs PUSH
   Le plugin supporte les deux modes mais seul le mode POLL est utilisé.
   Le VPS interroge WordPress, pas l'inverse.

2. GESTION DES CONFLITS
   Toutes les insertions utilisent ON CONFLICT ... DO UPDATE (upsert).
   Les données sont écrasées à chaque sync.

3. QUEUE PERSISTANTE
   La queue est stockée dans wp-content/uploads/yousync/queue.json
   Les événements restent en queue jusqu'à acquittement par le VPS.

4. OPTIMISATION
   - Les changements de statut commande envoient uniquement le nouveau statut
   - Les changements de stock envoient uniquement stock_quantity et stock_status
   - Les autres modifications envoient les données complètes

5. SÉCURITÉ
   - Token requis pour tous les endpoints REST
   - Répertoire uploads/yousync/ protégé par .htaccess

================================================================================
                              DÉPENDANCES
================================================================================

WordPress : >= 5.8
PHP : >= 7.4
WooCommerce : >= 6.0

================================================================================
