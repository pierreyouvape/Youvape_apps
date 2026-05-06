# Base de données — youvape_db

PostgreSQL. 34 tables métier.

---

## Logique des identifiants

Le projet utilise **trois systèmes d'ID en parallèle** (BDD interne, WordPress, BMS) :

| Colonne | Type | Description |
|---|---|---|
| `id` | integer (serial) | ID interne BDD — utilisé pour toutes les relations entre tables de l'app |
| `wp_product_id` | bigint | ID WordPress du produit (post_id dans WP) |
| `wp_order_id` | bigint | ID WordPress de la commande |
| `wp_user_id` | bigint | ID WordPress du client |
| `wp_refund_id` | integer | ID WordPress du remboursement |
| `wp_parent_id` | bigint | ID WordPress du produit parent (pour les variations) |

**Règle critique** : les FK entre tables utilisent toujours les `id` internes (ex: `order_items.wp_order_id` → `orders.wp_order_id`), sauf pour `order_items` qui fait une exception en utilisant `wp_order_id` comme clé de jointure.

**Produits** : `resolveProductId()` dans `supplierModel.js` résout `wp_product_id` → `id` interne. `product_suppliers` stocke toujours sur la variation (ou simple), jamais sur le produit parent.

**Règles d'utilisation des IDs selon le contexte :**

| Contexte | ID à utiliser |
|---|---|
| FK entre tables de l'app | `id` interne |
| Appel API WooCommerce | `wp_product_id` / `wp_order_id` / `wp_user_id` |
| Appel API BMS | `bms_id` (suppliers) / `bms_po_id` (purchase_orders) |
| Webhook WC entrant | `wp_order_id` → résoudre via `orders.wp_order_id` |
| Import PDF / SKU fournisseur | SKU → `resolveProductId()` → `id` interne |
| Réponse API frontend | `id` interne (sauf si WP/BMS en a besoin côté client) |

**Cas où un objet n'a pas encore d'ID externe :**
- Un PO en `draft` n'a pas de `bms_po_id` (créé localement avant d'être envoyé à BMS)
- Un produit peut ne pas avoir de `bms_id` s'il n'est pas encore référencé dans BMS

**Point d'entrée obligatoire depuis une source externe :**
- Toujours passer par `resolveProductId()` (`supplierModel.js`) pour convertir un `wp_product_id` ou un SKU en `id` interne avant toute opération BDD

---

## Tables par domaine

### Utilisateurs & Auth

**`users`** — Comptes de l'application (pas les clients WC)
- `id` · `email` · `password` (hashé) · `name`
- `is_admin` : flag administrateur
- `bms_email` / `bms_password` : credentials BMS de l'utilisateur (pour les appels API BMS)

**`user_permissions`** — Droits d'accès par app
- `user_id` → `users.id`
- `app_name` : nom fonctionnel (ex: `reviews`, `rewards`, `emails`)
- `can_read` / `can_write` : booléens

**`user_column_preferences`** — Colonnes masquées par tableau
- `user_id` → `users.id`
- `page` : identifiant de la page (ex: `orders`, `products`)
- `hidden_columns` : tableau JSON des colonnes masquées

---

### Clients WooCommerce

**`customers`** — Clients synchronisés depuis WC
- `id` : ID interne
- `wp_user_id` : ID WordPress (UNIQUE)
- `email`, `first_name`, `last_name`, `date_of_birth`
- Données de session : `session_start_time`, `session_pages`, `session_count`, `device_type`
- `user_registered` : date d'inscription WC

---

### Commandes WooCommerce

**`orders`** — Commandes
- `id` : ID interne
- `wp_order_id` : ID WooCommerce (UNIQUE)
- `wp_customer_id` : ID WP du client (peut être 0 pour les guests)
- `post_status` : statut WC (ex: `wc-completed`, `wc-processing`)
- `post_date` : date de la commande (heure Paris, stockée telle quelle)
- `shipping_method` : méthode de livraison (texte libre, ex: "Lettre Suivie")
- `order_total` : total TTC · `order_shipping` : frais de port facturés
- `shipping_cost_calculated` : coût de livraison calculé (barème)
- `payment_cost_calculated` : coût du moyen de paiement calculé
- `cart_discount` : montant remise (> 0 = commande avec coupon)
- `order_total_cost` : **TOUJOURS NULL** — non calculé
- Données Mollie : `mollie_payment_id`, `mollie_order_id`, `mollie_payment_mode`, etc.
- Données attribution : `attribution_utm_source`, `attribution_utm_medium`, etc.
- `mondial_relay_pickup_info` : JSON point relais Mondial Relay

**`order_items`** — Lignes de commande
- `wp_order_id` → `orders.wp_order_id` (FK, CASCADE DELETE)
- `order_item_id` : ID de la ligne côté WC
- `order_item_type` : `line_item` (produit), `shipping`, `coupon`, `fee`
- `product_id` / `variation_id` : IDs WP (pas les ids internes)
- `qty` · `line_total` · `line_subtotal` · `line_tax`
- `item_cost` / `item_total_cost` : coût unitaire et total (depuis WC COG)
- `product_attributes` : JSON des attributs de variation (ex: taille, goût)
- `wdr_discounts` / `advanced_discount` : JSON des remises appliquées

**`refunds`** — Remboursements
- `wp_refund_id` : ID WC du remboursement (UNIQUE)
- `wp_order_id` : ID WC de la commande parente
- `refund_amount` · `refund_reason` · `refund_date`

**`order_sync_log`** — Historique des syncs WC
- Log de chaque batch de sync : nb commandes créées/mises à jour/en erreur

---

### Produits

**`products`** — Catalogue (simples + variations)
- `id` : ID interne
- `wp_product_id` : ID WP (UNIQUE)
- `wp_parent_id` : ID WP du parent (si variation)
- `product_type` : `simple`, `variable`, `variation`, `woosb` (bundle)
- `sku` · `stock` · `stock_status` · `regular_price` · `price`
- `wc_cog_cost` : coût importé depuis WooCommerce (plugin COG)
- `computed_cost` : PMP FIFO calculé depuis les lignes de PO reçus — recalculé toutes les 30 min
- `computed_cost_updated_at` : timestamp du dernier calcul PMP
- `brand` / `sub_brand` / `category` / `sub_category` : dénormalisés (texte)
- `product_attributes` : JSON des attributs WC (indexé GIN)
- `woosb_ids` : JSON des produits composant un bundle
- `exclude_from_reorder` : exclure ce produit du calcul des besoins
- `image_url` · `post_title` · `post_status` · `post_date`

**`product_suppliers`** — Liaisons produit ↔ fournisseur
- `product_id` → `products.id` (toujours une variation ou un simple, jamais un parent)
- `supplier_id` → `suppliers.id`
- `is_primary` : fournisseur principal pour ce produit
- `supplier_price` : prix d'achat HT (prix du pack)
- `pack_qty` : nombre d'unités dans un pack (synté depuis BMS)
- `min_order_qty` : quantité minimale de commande
- `supplier_sku` : référence fournisseur

**`product_barcodes`** — Codes-barres
- `product_id` → `products.id`
- `barcode` · `type` : `unit` ou `pack`
- `quantity` : nombre d'unités (pour les packs)

**`product_alerts`** — Seuils d'alerte stock
- `product_id` → `products.id` (UNIQUE : un seuil par produit)
- `alert_threshold` : seuil de déclenchement de l'alerte
- `notes` : note libre

---

### Fournisseurs & Achats

**`suppliers`** — Fournisseurs
- `id` : ID interne
- `bms_id` : ID dans BMS (UNIQUE quand renseigné)
- `code` : code court (UNIQUE)
- `name` · `email` · `contact_name` · `address` · `phone`
- `analysis_period_months` : période d'analyse des ventes pour le calcul des besoins
- `coverage_months` : nombre de mois de stock à couvrir
- `lead_time_days` : délai de livraison en jours
- `reception_threshold` : seuil de réception BMS (%)
- `minimum_order` · `carriage_free_amount` : franchise de port
- `csv_mapping` : JSON pour le mapping des colonnes d'import CSV

**`purchase_orders`** — Bons de commande fournisseur
- `id` : ID interne
- `bms_po_id` : ID dans BMS (UNIQUE)
- `bms_reference` : référence textuelle BMS
- `order_number` : numéro interne (UNIQUE)
- `supplier_id` → `suppliers.id`
- `status` : `draft`, `ordered`, `partial`, `received`, `cancelled`
- `created_by` → `users.id`
- `order_date` · `expected_date` · `received_date`
- `total_items` · `total_qty` · `total_amount`

**`purchase_order_items`** — Lignes de bon de commande
- `purchase_order_id` → `purchase_orders.id` (CASCADE DELETE)
- `product_id` → `products.id`
- `supplier_sku` · `product_name`
- `qty_ordered` : quantité commandée (déjà multipliée par `pack_qty`)
- `qty_received` : quantité reçue (déjà multipliée par `pack_qty`)
- `unit_price` : prix du pack (diviser par `pack_qty` pour le coût unitaire)
- `discount_percent` : remise en %
- `stock_before` : stock au moment de la commande
- `theoretical_need` / `supposed_need` : besoins calculés
- `item_type` : `product` ou autre

---

### Livraison

**`shipping_carriers`** — Transporteurs
- `id` · `code` (UNIQUE) · `name` · `fuel_surcharge` · `active`

**`shipping_methods`** — Méthodes d'expédition
- `carrier_id` → `shipping_carriers.id`
- `code` · `name` · `wc_method_title` (titre côté WC)

**`shipping_rates`** — Grille tarifaire par méthode
- `method_id` → `shipping_methods.id`
- `weight_from` / `weight_to` / `price_ht`

**`shipping_zones`** — Zones WooCommerce
- `wc_zone_id` : ID de zone WC · `name` · `zone_order`

**`shipping_zone_methods`** — Méthodes actives par zone
- `zone_id` → `shipping_zones.id` · `carrier_id` → `shipping_carriers.id`
- `wc_instance_id` / `wc_method_id` : identifiants WC

**`shipping_country_mapping`** — Mapping pays → zone
- `country_code` (UNIQUE) · `zone_name`

**`shipping_tariff_zones`** — Zones tarifaires (nouvelle structure)
- `carrier` / `method` / `zone_name` (UNIQUE ensemble)
- `fuel_surcharge` par zone

**`shipping_tariff_rates`** — Tarifs par zone et tranche de poids
- `zone_id` → `shipping_tariff_zones.id`
- `weight_from` / `weight_to` / `price_ht`

**`shipping_method_zone_rates`** — Tarifs par méthode WC et zone
- `method_title` · `zone_id` → `shipping_zones.id`
- `weight_from` / `weight_to` / `price_ht`

**`shipping_settings`** — Paramètres livraison clé-valeur

---

### Avis

**`reviews`** — Avis clients (Guaranteed Reviews)
- `review_id` : ID externe API (UNIQUE)
- `review_type` : `site` ou `product`
- `rating` (1-5) · `comment` · `customer_name` · `customer_email`
- `product_id` : ID produit WC (string, nullable si avis site)
- `order_id` : numéro de commande WC
- `review_status` : statut API (0 = en attente, etc.)
- `rewarded` / `rewarded_at` : points fidélité attribués

**`reviews_logs`** — Logs des appels API avis
- Log de chaque exécution du cron : statut, réponse brute, erreur

---

### Fidélité

**`rewards_config`** — Configuration programme fidélité (single row)
- `woocommerce_url` / `consumer_key` / `consumer_secret` : accès API WC
- `points_site` / `points_product` : points attribués par type d'avis
- `htaccess_user` / `htaccess_password` : auth .htaccess si nécessaire

**`rewards_history`** — Historique points attribués
- `review_id` · `customer_email` · `points_awarded` · `review_type`
- `api_response` : réponse JSON de l'API WC
- `rewarded` : booléen de confirmation

---

### Email

**`email_config`** — Configuration Probance (single row, `id = 1`)
- `probance_url` · `probance_token` · `campaign_external_id` · `enabled`

**`email_sent_tracking`** — Suivi des emails d'invitation avis envoyés
- `order_id` (UNIQUE) : une ligne par commande
- `customer_email` · `sent_at` · `reviews_count`

---

### La Poste

**`laposte_labels`** — Étiquettes générées
- `order_number` : numéro de commande WC (pas l'id interne)
- `tracking_id` : numéro de suivi La Poste
- `laposte_order_id` : ID de l'ordre côté API La Poste
- `status` : `active` ou `cancelled`
- `packed_by` → `users.id`
- `cancelled_at` : date d'annulation si annulée

---

### Configuration

**`app_config`** — Table de configuration globale clé-valeur
- `config_key` (UNIQUE) / `config_value`
- Clés principales :
  - `bms_last_po_sync_at` : timestamp de la dernière sync BMS (pour sync incrémentale)
  - `cron_enabled` : active/désactive le cron avis
  - `interval` : fréquence du cron avis
  - `api_key` / `review_type` / `limit` / `product_id` / `cutoff_date` : config avis
  - `stock_resync_scheduled_at` : timestamp pour le re-sync stocks one-shot

**`payment_methods`** — Méthodes de paiement avec leurs frais
- `code` (UNIQUE) · `name` · `wc_payment_method` (code WC)
- `monthly_fee` · `fixed_fee` · `percent_fee`

---

## Relations clés

```
orders (wp_order_id)
  └── order_items (wp_order_id) [CASCADE DELETE]

products (id)
  ├── product_suppliers (product_id) [CASCADE DELETE]
  ├── product_barcodes (product_id) [CASCADE DELETE]
  ├── product_alerts (product_id) [CASCADE DELETE]
  └── purchase_order_items (product_id)

suppliers (id)
  ├── product_suppliers (supplier_id) [CASCADE DELETE]
  └── purchase_orders (supplier_id)

purchase_orders (id)
  └── purchase_order_items (purchase_order_id) [CASCADE DELETE]

users (id)
  ├── user_permissions (user_id) [CASCADE DELETE]
  ├── user_column_preferences (user_id) [CASCADE DELETE]
  ├── laposte_labels (packed_by)
  └── purchase_orders (created_by)

shipping_carriers (id)
  ├── shipping_methods (carrier_id) [CASCADE DELETE]
  └── shipping_zone_methods (carrier_id)

shipping_zones (id)
  ├── shipping_zone_methods (zone_id) [CASCADE DELETE]
  └── shipping_method_zone_rates (zone_id)

shipping_methods (id)
  └── shipping_rates (method_id) [CASCADE DELETE]

shipping_tariff_zones (id)
  └── shipping_tariff_rates (zone_id) [CASCADE DELETE]
```

---

## Calcul des coûts produits

- **`wc_cog_cost`** (table `products`) : coût importé depuis WooCommerce via plugin COG, stocké sur `order_items.item_cost` au moment de la commande
- **`computed_cost`** (table `products`) : PMP FIFO calculé depuis les `purchase_order_items` avec `qty_received > 0`
- **Dans les stats** : `COALESCE(p.computed_cost, p.wc_cog_cost, 0)`
- **`unit_price` dans `purchase_order_items`** = prix du pack. Coût unitaire = `unit_price / pack_qty`
- **`order_total_cost`** dans `orders` : toujours NULL, jamais calculé
Pour le mapping détaillé WooCommerce → PostgreSQL (champs, plugins, transformers), voir _archive/DATABASE_SCHEMA.md