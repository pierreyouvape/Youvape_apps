# Base de données PostgreSQL - Youvape Sync

Documentation complète des tables, champs et mapping WooCommerce → PostgreSQL.

---

## Table: `customers`

### Structure PostgreSQL

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | ID interne PostgreSQL |
| `wp_user_id` | BIGINT | UNIQUE, NOT NULL | ID utilisateur WordPress |
| `email` | VARCHAR(255) | NOT NULL | Email du client |
| `user_registered` | TIMESTAMP | NULL | Date d'inscription |
| `first_name` | VARCHAR(255) | NULL | Prénom |
| `last_name` | VARCHAR(255) | NULL | Nom |
| `session_start_time` | TIMESTAMP | NULL | Début de session attribution WooCommerce |
| `session_pages` | INTEGER | NULL | Nombre de pages vues |
| `session_count` | INTEGER | NULL | Nombre de sessions |
| `device_type` | VARCHAR(50) | NULL | Type d'appareil |
| `date_of_birth` | TIMESTAMP | NULL | Date de naissance (plugin loyalty) |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de création en DB |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Date de mise à jour |

### Mapping WooCommerce → PostgreSQL

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `wp_user_id` | `wp_users.ID` | Clé primaire WordPress |
| `email` | `wp_users.user_email` | |
| `user_registered` | `wp_users.user_registered` | Validé (vide = null) |
| `first_name` | `wp_usermeta.first_name` | |
| `last_name` | `wp_usermeta.last_name` | |
| `session_start_time` | `wp_usermeta._wc_order_attribution_session_start_time` | Validé (vide = null) |
| `session_pages` | `wp_usermeta._wc_order_attribution_session_pages` | Validé isNaN |
| `session_count` | `wp_usermeta._wc_order_attribution_session_count` | Validé isNaN |
| `device_type` | `wp_usermeta._wc_order_attribution_device_type` | |
| `date_of_birth` | `wp_usermeta.wlr_dob` | Plugin WooCommerce Loyalty, validé (vide = null) |

---

## Table: `products`

### Structure PostgreSQL

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | ID interne PostgreSQL |
| `wp_product_id` | BIGINT | UNIQUE, NOT NULL | ID produit WordPress |
| `product_type` | VARCHAR(50) | NOT NULL | Type: 'simple', 'variable', 'variation' |
| `wp_parent_id` | BIGINT | NULL, FK → products.wp_product_id | ID parent pour variations |
| `post_author` | BIGINT | NULL | ID auteur WordPress |
| `post_date` | TIMESTAMP | NULL | Date de création |
| `post_title` | TEXT | NULL | Titre du produit |
| `post_excerpt` | TEXT | NULL | Extrait (variations) |
| `post_status` | VARCHAR(50) | NULL | Statut: 'publish', 'draft', etc. |
| `post_modified` | TIMESTAMP | NULL | Date de modification |
| `guid` | TEXT | NULL | GUID WordPress |
| `sku` | VARCHAR(255) | NULL | Référence produit |
| `total_sales` | INTEGER | DEFAULT 0 | Nombre de ventes |
| `sold_individually` | BOOLEAN | DEFAULT FALSE | Vente individuelle |
| `weight` | DECIMAL(10,2) | NULL | Poids |
| `stock` | INTEGER | NULL | Stock disponible |
| `stock_status` | VARCHAR(50) | NULL | 'instock', 'outofstock', etc. |
| `product_attributes` | JSONB | NULL | Attributs produit/variation |
| `wc_productdata_options` | JSONB | NULL | Options WooCommerce |
| `wc_cog_cost` | DECIMAL(10,2) | NULL | Coût d'achat (Cost of Goods) |
| `product_join_stories` | TEXT | NULL | Stories associées |
| `thumbnail_id` | BIGINT | NULL | ID image principale |
| `regular_price` | DECIMAL(10,2) | NULL | Prix normal |
| `price` | DECIMAL(10,2) | NULL | Prix actuel |
| `product_version` | VARCHAR(50) | NULL | Version (variable) |
| `woovr_show_image` | VARCHAR(10) | NULL | Afficher image variations |
| `woovr_show_price` | VARCHAR(10) | NULL | Afficher prix variations |
| `woovr_show_description` | VARCHAR(10) | NULL | Afficher description variations |
| `yoast_wpseo_linkdex` | VARCHAR(50) | NULL | Score SEO Yoast |
| `yoast_wpseo_estimated_reading_time_minutes` | INTEGER | NULL | Temps de lecture |
| `product_with_nicotine` | BOOLEAN | DEFAULT FALSE | Contient nicotine |
| `product_excerpt_custom` | TEXT | NULL | Extrait personnalisé |
| `yoast_indexnow_last_ping` | VARCHAR(255) | NULL | Dernier ping IndexNow |
| `faq_title` | VARCHAR(255) | NULL | Titre FAQ |
| `accodion_list` | INTEGER | NULL | Liste accordéon |
| `product_tip` | TEXT | NULL | Conseil produit |
| `variation_description` | TEXT | NULL | Description variation |
| `manage_stock` | BOOLEAN | DEFAULT FALSE | Gestion stock variation |
| `global_unique_id` | VARCHAR(255) | NULL | ID unique global |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de création en DB |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Date de mise à jour |

### Mapping WooCommerce → PostgreSQL

**Champs communs (tous types de produits):**

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `wp_product_id` | `wp_posts.ID` | |
| `product_type` | Taxonomy `product_type` | Récupéré via `wp_get_object_terms()` |
| `wp_parent_id` | `wp_posts.post_parent` | NULL pour produits parents |
| `post_author` | `wp_posts.post_author` | |
| `post_date` | `wp_posts.post_date` | Validé (vide = null) |
| `post_title` | `wp_posts.post_title` | |
| `post_excerpt` | `wp_posts.post_excerpt` | Utilisé pour variations |
| `post_status` | `wp_posts.post_status` | |
| `post_modified` | `wp_posts.post_modified` | Validé (vide = null) |
| `guid` | `wp_posts.guid` | |
| `sku` | `wp_postmeta._sku` | |
| `total_sales` | `wp_postmeta.total_sales` | |
| `sold_individually` | `wp_postmeta._sold_individually` | 'yes' → true |
| `weight` | `wp_postmeta._weight` | |
| `stock` | `wp_postmeta._stock` | |
| `stock_status` | `wp_postmeta._stock_status` | |
| `product_attributes` | `wp_postmeta._product_attributes` | JSONB |
| `wc_productdata_options` | `wp_postmeta.wc_productdata_options` | JSONB |
| `wc_cog_cost` | `wp_postmeta._wc_cog_cost` | Plugin Cost of Goods |
| `product_join_stories` | `wp_postmeta.product_join_stories` | |
| `thumbnail_id` | `wp_postmeta._thumbnail_id` | |
| `regular_price` | `wp_postmeta._regular_price` | |
| `price` | `wp_postmeta._price` | Prix actuel (avec promo) |

**Champs spécifiques produits variables:**

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `product_version` | `wp_postmeta._product_version` | |
| `woovr_show_image` | `wp_postmeta._woovr_show_image` | Plugin WooVR |
| `woovr_show_price` | `wp_postmeta._woovr_show_price` | |
| `woovr_show_description` | `wp_postmeta._woovr_show_description` | |
| `yoast_wpseo_linkdex` | `wp_postmeta._yoast_wpseo_linkdex` | |
| `yoast_wpseo_estimated_reading_time_minutes` | `wp_postmeta._yoast_wpseo_estimated-reading-time-minutes` | |
| `product_with_nicotine` | `wp_postmeta.product_with_nicotine` OU `_product_with_nicotine` | '1' → true |
| `product_excerpt_custom` | `wp_postmeta.product_excerpt_custom` | |
| `yoast_indexnow_last_ping` | `wp_postmeta._yoast_indexnow_last_ping` | |
| `faq_title` | `wp_postmeta.faq_title` | |
| `accodion_list` | `wp_postmeta.accodion_list` | |
| `product_tip` | `wp_postmeta.product_tip` | |

**Champs spécifiques variations:**

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `variation_description` | `wp_postmeta._variation_description` | |
| `manage_stock` | `wp_postmeta._manage_stock` | 'yes' → true |
| `global_unique_id` | `wp_postmeta._global_unique_id` | |
| `product_attributes` | Tous les `wp_postmeta.attribute_pa_*` | Compilés en JSONB |

**Relation parent/variations:**
- Produit variable: `post_type = 'product'`, `product_type = 'variable'`, `wp_parent_id = NULL`
- Variations: `post_type = 'product_variation'`, `product_type = 'variation'`, `wp_parent_id = ID du parent`

---

## Table: `orders`

### Structure PostgreSQL

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | ID interne PostgreSQL |
| `wp_order_id` | BIGINT | UNIQUE, NOT NULL | ID commande WordPress |
| `wp_customer_id` | BIGINT | NULL, FK → customers.wp_user_id | ID client (NULL si invité) |
| `guid` | TEXT | NULL | GUID WordPress |
| `post_date` | TIMESTAMP | NULL | Date de création |
| `post_status` | VARCHAR(50) | NULL | Statut: 'wc-completed', 'wc-processing', etc. |
| `post_modified` | TIMESTAMP | NULL | Date de modification |
| `payment_method_title` | VARCHAR(255) | NULL | Titre méthode paiement |
| `created_via` | VARCHAR(255) | NULL | Source création |
| `billing_first_name` | VARCHAR(255) | NULL | Prénom facturation |
| `billing_last_name` | VARCHAR(255) | NULL | Nom facturation |
| `billing_address_1` | TEXT | NULL | Adresse facturation ligne 1 |
| `billing_address_2` | TEXT | NULL | Adresse facturation ligne 2 |
| `billing_city` | VARCHAR(255) | NULL | Ville facturation |
| `billing_postcode` | VARCHAR(20) | NULL | Code postal facturation |
| `billing_country` | VARCHAR(2) | NULL | Pays facturation (code ISO) |
| `billing_email` | VARCHAR(255) | NULL | Email facturation |
| `billing_phone` | VARCHAR(50) | NULL | Téléphone facturation |
| `shipping_first_name` | VARCHAR(255) | NULL | Prénom livraison |
| `shipping_last_name` | VARCHAR(255) | NULL | Nom livraison |
| `shipping_address_1` | TEXT | NULL | Adresse livraison ligne 1 |
| `shipping_city` | VARCHAR(255) | NULL | Ville livraison |
| `shipping_postcode` | VARCHAR(20) | NULL | Code postal livraison |
| `shipping_country` | VARCHAR(2) | NULL | Pays livraison |
| `shipping_phone` | VARCHAR(50) | NULL | Téléphone livraison |
| `shipping_company` | VARCHAR(255) | NULL | Société livraison |
| `cart_discount` | DECIMAL(10,2) | DEFAULT 0 | Réduction panier |
| `cart_discount_tax` | DECIMAL(10,2) | DEFAULT 0 | Taxe sur réduction |
| `order_shipping` | DECIMAL(10,2) | DEFAULT 0 | Frais de port |
| `order_shipping_tax` | DECIMAL(10,2) | DEFAULT 0 | Taxe sur port |
| `order_tax` | DECIMAL(10,2) | DEFAULT 0 | Taxe totale |
| `order_total` | DECIMAL(10,2) | DEFAULT 0 | Total commande |
| `prices_include_tax` | BOOLEAN | DEFAULT FALSE | Prix TTC |
| `billing_tax` | VARCHAR(255) | NULL | Numéro TVA |
| `is_vat_exempt` | BOOLEAN | DEFAULT FALSE | Exonéré TVA |
| `order_language` | VARCHAR(10) | NULL | Langue commande |
| `wdr_discounts` | JSONB | NULL | Réductions plugin Discount Rules |
| `order_total_cost` | DECIMAL(10,2) | NULL | Coût total d'achat |
| `attribution_source_type` | VARCHAR(255) | NULL | Type de source attribution |
| `attribution_referrer` | TEXT | NULL | Referrer |
| `attribution_utm_source` | VARCHAR(255) | NULL | UTM Source |
| `attribution_utm_medium` | VARCHAR(255) | NULL | UTM Medium |
| `attribution_session_entry` | TEXT | NULL | URL entrée session |
| `attribution_session_start_time` | TIMESTAMP | NULL | Début session |
| `attribution_session_pages` | INTEGER | NULL | Nombre pages vues |
| `attribution_session_count` | INTEGER | NULL | Nombre de sessions |
| `attribution_user_agent` | TEXT | NULL | User agent |
| `attribution_device_type` | VARCHAR(50) | NULL | Type appareil |
| `mondial_relay_pickup_info` | JSONB | NULL | Info point relais Mondial Relay |
| `mollie_payment_id` | VARCHAR(255) | NULL | ID paiement Mollie |
| `transaction_id` | VARCHAR(255) | NULL | ID transaction |
| `mollie_order_id` | VARCHAR(255) | NULL | ID commande Mollie |
| `mollie_payment_mode` | VARCHAR(50) | NULL | Mode paiement Mollie |
| `mollie_customer_id` | VARCHAR(255) | NULL | ID client Mollie |
| `date_paid` | BIGINT | NULL | Timestamp paiement (Unix) |
| `paid_date` | TIMESTAMP | NULL | Date paiement |
| `mollie_payment_instructions` | TEXT | NULL | Instructions paiement |
| `mollie_paid_and_processed` | BOOLEAN | DEFAULT FALSE | Payé et traité |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de création en DB |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | Date de mise à jour |

### Mapping WooCommerce → PostgreSQL

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `wp_order_id` | `wp_posts.ID` (post_type = 'shop_order') | |
| `wp_customer_id` | `wp_postmeta._customer_user` | NULL si = 0 |
| `guid` | `wp_posts.guid` | |
| `post_date` | `wp_posts.post_date` | Validé (vide = null) |
| `post_status` | `wp_posts.post_status` | |
| `post_modified` | `wp_posts.post_modified` | Validé (vide = null) |
| `payment_method_title` | `wp_postmeta._payment_method_title` | |
| `created_via` | `wp_postmeta._created_via` | |
| `billing_first_name` | `wp_postmeta._billing_first_name` | |
| `billing_last_name` | `wp_postmeta._billing_last_name` | |
| `billing_address_1` | `wp_postmeta._billing_address_1` | |
| `billing_address_2` | `wp_postmeta._billing_address_2` | |
| `billing_city` | `wp_postmeta._billing_city` | |
| `billing_postcode` | `wp_postmeta._billing_postcode` | |
| `billing_country` | `wp_postmeta._billing_country` | |
| `billing_email` | `wp_postmeta._billing_email` | |
| `billing_phone` | `wp_postmeta._billing_phone` | |
| `shipping_first_name` | `wp_postmeta._shipping_first_name` | |
| `shipping_last_name` | `wp_postmeta._shipping_last_name` | |
| `shipping_address_1` | `wp_postmeta._shipping_address_1` | |
| `shipping_city` | `wp_postmeta._shipping_city` | |
| `shipping_postcode` | `wp_postmeta._shipping_postcode` | |
| `shipping_country` | `wp_postmeta._shipping_country` | |
| `shipping_phone` | `wp_postmeta._shipping_phone` | |
| `shipping_company` | `wp_postmeta._shipping_company` | |
| `cart_discount` | `wp_postmeta._cart_discount` | |
| `cart_discount_tax` | `wp_postmeta._cart_discount_tax` | |
| `order_shipping` | `wp_postmeta._order_shipping` | |
| `order_shipping_tax` | `wp_postmeta._order_shipping_tax` | |
| `order_tax` | `wp_postmeta._order_tax` | |
| `order_total` | `wp_postmeta._order_total` | |
| `prices_include_tax` | `wp_postmeta._prices_include_tax` | 'yes' → true |
| `billing_tax` | `wp_postmeta._billing_tax` | |
| `is_vat_exempt` | `wp_postmeta.is_vat_exempt` | 'yes' → true |
| `order_language` | `wp_postmeta._wlr_order_language` | Plugin Loyalty |
| `wdr_discounts` | `wp_postmeta._wdr_discounts` | JSONB, plugin Discount Rules |
| `order_total_cost` | `wp_postmeta._wc_cog_order_total_cost` | Plugin Cost of Goods |
| `attribution_source_type` | `wp_postmeta._wc_order_attribution_source_type` | |
| `attribution_referrer` | `wp_postmeta._wc_order_attribution_referrer` | |
| `attribution_utm_source` | `wp_postmeta._wc_order_attribution_utm_source` | |
| `attribution_utm_medium` | `wp_postmeta._wc_order_attribution_utm_medium` | |
| `attribution_session_entry` | `wp_postmeta._wc_order_attribution_session_entry` | |
| `attribution_session_start_time` | `wp_postmeta._wc_order_attribution_session_start_time` | Validé (vide = null) |
| `attribution_session_pages` | `wp_postmeta._wc_order_attribution_session_pages` | Validé isNaN |
| `attribution_session_count` | `wp_postmeta._wc_order_attribution_session_count` | Validé isNaN |
| `attribution_user_agent` | `wp_postmeta._wc_order_attribution_user_agent` | |
| `attribution_device_type` | `wp_postmeta._wc_order_attribution_device_type` | |
| `mondial_relay_pickup_info` | `wp_postmeta._wms_mondial_relay_pickup_info` | JSONB |
| `mollie_payment_id` | `wp_postmeta._mollie_payment_id` | |
| `transaction_id` | `wp_postmeta._transaction_id` | |
| `mollie_order_id` | `wp_postmeta._mollie_order_id` | |
| `mollie_payment_mode` | `wp_postmeta._mollie_payment_mode` | |
| `mollie_customer_id` | `wp_postmeta._mollie_customer_id` | |
| `date_paid` | `wp_postmeta._date_paid` | Unix timestamp, validé isNaN |
| `paid_date` | `wp_postmeta._paid_date` | Validé (vide = null) |
| `mollie_payment_instructions` | `wp_postmeta._mollie_payment_instructions` | |
| `mollie_paid_and_processed` | `wp_postmeta._mollie_paid_and_processed` | '1' → true |

---

## Table: `order_items`

### Structure PostgreSQL

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | ID interne PostgreSQL |
| `wp_order_id` | BIGINT | NOT NULL, FK → orders.wp_order_id | ID commande |
| `order_item_id` | BIGINT | NOT NULL | ID item WooCommerce |
| `order_item_name` | VARCHAR(255) | NULL | Nom de l'item |
| `order_item_type` | VARCHAR(50) | NULL | Type: 'line_item', 'shipping', etc. |
| `product_id` | BIGINT | NULL, FK → products.wp_product_id | ID produit |
| `variation_id` | BIGINT | NULL, FK → products.wp_product_id | ID variation |
| `qty` | INTEGER | NULL | Quantité |
| `tax_class` | VARCHAR(50) | NULL | Classe de taxe |
| `line_subtotal` | DECIMAL(10,2) | NULL | Sous-total HT |
| `line_subtotal_tax` | DECIMAL(10,2) | NULL | Taxe sur sous-total |
| `line_total` | DECIMAL(10,2) | NULL | Total TTC |
| `line_tax` | DECIMAL(10,2) | NULL | Taxe |
| `line_tax_data` | JSONB | NULL | Détail taxes |
| `product_attributes` | JSONB | NULL | Attributs sélectionnés |
| `advanced_discount` | JSONB | NULL | Réductions avancées |
| `wdr_discounts` | JSONB | NULL | Réductions Discount Rules |
| `item_cost` | DECIMAL(10,2) | NULL | Coût unitaire |
| `item_total_cost` | DECIMAL(10,2) | NULL | Coût total |
| `reduced_stock` | BOOLEAN | DEFAULT FALSE | Stock réduit |
| `created_at` | TIMESTAMP | DEFAULT NOW() | Date de création en DB |

### Mapping WooCommerce → PostgreSQL

| Champ PostgreSQL | Source WordPress | Notes |
|------------------|------------------|-------|
| `wp_order_id` | ID commande parent | |
| `order_item_id` | `wp_woocommerce_order_items.order_item_id` | |
| `order_item_name` | `wp_woocommerce_order_items.order_item_name` | |
| `order_item_type` | `wp_woocommerce_order_items.order_item_type` | |
| `product_id` | `wp_woocommerce_order_itemmeta._product_id` | Validé isNaN |
| `variation_id` | `wp_woocommerce_order_itemmeta._variation_id` | Validé isNaN |
| `qty` | `wp_woocommerce_order_itemmeta._qty` | Validé isNaN |
| `tax_class` | `wp_woocommerce_order_itemmeta._tax_class` | |
| `line_subtotal` | `wp_woocommerce_order_itemmeta._line_subtotal` | |
| `line_subtotal_tax` | `wp_woocommerce_order_itemmeta._line_subtotal_tax` | |
| `line_total` | `wp_woocommerce_order_itemmeta._line_total` | |
| `line_tax` | `wp_woocommerce_order_itemmeta._line_tax` | |
| `line_tax_data` | `wp_woocommerce_order_itemmeta._line_tax_data` | JSONB |
| `product_attributes` | Tous les `pa_*` de l'item meta | JSONB |
| `advanced_discount` | `wp_woocommerce_order_itemmeta._advanced_woo_discount_item_total_discount` | JSONB |
| `wdr_discounts` | `wp_woocommerce_order_itemmeta._wdr_discounts` | JSONB |
| `item_cost` | `wp_woocommerce_order_itemmeta._wc_cog_item_cost` | Plugin Cost of Goods |
| `item_total_cost` | `wp_woocommerce_order_itemmeta._wc_cog_item_total_cost` | Plugin Cost of Goods |
| `reduced_stock` | `wp_woocommerce_order_itemmeta._reduced_stock` | '1' → true |

---

## Notes importantes

### Validations appliquées

1. **Timestamps vides**: Tous les champs timestamp reçoivent `null` si la valeur est vide (`""`) ou invalide (`"0000-00-00 00:00:00"`)

2. **parseInt() invalides**: Tous les `parseInt()` sont validés avec `isNaN()` et retournent `null` si invalide

3. **Boolean WordPress**:
   - `'yes'` → `true`
   - `'no'` ou vide → `false`
   - `'1'` → `true`
   - Autres → `false`

### Plugins WordPress détectés

Les champs suivants proviennent de plugins tiers:

- **WooCommerce Cost of Goods**: `_wc_cog_*`
- **WooCommerce Order Attribution**: `_wc_order_attribution_*`
- **WooCommerce Loyalty Rewards**: `_wlr_*`, `wlr_*`
- **Discount Rules for WooCommerce**: `_wdr_discounts`, `_advanced_woo_discount_*`
- **Mollie Payments**: `_mollie_*`
- **Mondial Relay**: `_wms_mondial_relay_*`
- **WooVR (variations radio)**: `_woovr_*`
- **Yoast SEO**: `_yoast_*`

### Relations entre tables

```
customers (wp_user_id)
    ↓ (1:N)
orders (wp_customer_id → customers.wp_user_id)
    ↓ (1:N)
order_items (wp_order_id → orders.wp_order_id)
    ↓ (N:1)
products (wp_product_id)

products (wp_product_id) [type=variable]
    ↓ (1:N)
products (wp_parent_id → products.wp_product_id) [type=variation]
```

### Fichiers de transformation

- **WordPress → VPS (RAW)**: [youvape-sync-v2/includes/class-bulk-sync-manager.php](youvape-sync-v2/includes/class-bulk-sync-manager.php)
- **VPS Transformers**:
  - [backend/src/transformers/customerTransformer.js](backend/src/transformers/customerTransformer.js)
  - [backend/src/transformers/productTransformer.js](backend/src/transformers/productTransformer.js)
  - [backend/src/transformers/orderTransformer.js](backend/src/transformers/orderTransformer.js)
- **VPS Models (GET endpoints)**:
  - [backend/src/models/customerModel.js](backend/src/models/customerModel.js)
  - [backend/src/models/productModel.js](backend/src/models/productModel.js)
  - [backend/src/models/orderModel.js](backend/src/models/orderModel.js)

---

**Dernière mise à jour**: 2025-11-13
**Version module WordPress**: 2.1.2
**Version backend**: Compatible avec les transformers actuels
