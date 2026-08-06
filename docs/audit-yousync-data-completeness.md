# Audit exhaustif — Complétude des données synchronisées (WooCommerce → yousync → VPS)

> But : recenser **tout** ce que WooCommerce/WordPress expose et qui n'arrive PAS sur le VPS,
> sur les 4 entités (Commandes/Refunds, Produits, Clients, Méta plugins tiers).
> Objectif : préparer **une seule** nouvelle version de plugin (déploiement prod sensible)
> qui capture tout ce qui est utile, plutôt que de multiplier les déploiements.
>
> Méthode : croisement de 3 sources
> 1. API WooCommerce (`WC_Order`, `WC_Product`, `WC_Customer`, `WC_Order_Refund`, items)
> 2. Ce que le plugin envoie : `yousync/includes/class-data-fetcher.php`
> 3. Ce que le backend stocke : `backend/src/services/wcSyncService.js`
>
> ⚠️ Le DDL réel des tables `orders/products/customers/order_items` n'est **pas versionné**
> dans le repo (créé hors-git sur la BDD). Les colonnes ci-dessous sont déduites des
> `INSERT/UPDATE` du code. **À confirmer** par un `\d orders` etc. sur le Postgres VPS
> avant toute migration.

Légende :
- ✅ capturé et stocké
- 🟡 envoyé par le plugin mais **jeté** par le backend (fix backend seul, sans toucher la prod plugin)
- 🔴 **non envoyé** par le plugin (nécessite nouvelle version plugin = déploiement prod)
- ➖ disponible dans WC mais sans intérêt connu (listé pour exhaustivité)

---

## 1. REFUNDS (`shop_order_refund` → table `refunds`)

| Donnée WC (`WC_Order_Refund`) | Plugin | Backend | État |
|---|---|---|---|
| `get_id()` | ✅ | ✅ | ✅ |
| `get_parent_id()` | ✅ | ✅ | ✅ |
| `get_amount()` | ✅ | ✅ | ✅ |
| `get_reason()` | ✅ | ✅ | ✅ |
| `get_date_created()` | ✅ | ✅ | ✅ |
| `get_refunded_by()` (user id) | ✅ envoyé | ❌ ignoré | 🟡 |
| `get_total()` (total négatif) | ❌ | ❌ | 🔴 **bug TVA** |
| `get_total_tax()` (TVA négative) | ❌ | ❌ | 🔴 **bug TVA** |
| Items remboursés ligne par ligne (`get_items()` du refund : quel produit, quelle qté, quel montant) | ❌ | ❌ | 🔴 (remboursement partiel non détaillé — utile si on veut savoir QUEL produit a été remboursé) |
| `get_refunded_payment()` (bool : remboursé via passerelle ?) | ❌ | ❌ | ➖ |

**Verdict refunds** : 3 champs scalaires perdus (`refunded_by` 🟡, `order_total`+`order_tax` 🔴) + le **détail par item** si on veut un jour ventiler les remboursements par produit/catégorie dans les stats.

---

## 2. ORDERS (`WC_Order` → table `orders` + `order_items`)

### 2a. En-tête commande

| Donnée WC | Plugin | Backend | État |
|---|---|---|---|
| id, status, total, total_tax, shipping_total, discount_total | ✅ | ✅ | ✅ |
| payment_method(_title), customer_id, billing_*, shipping_* | ✅ | ✅ | ✅ |
| date_created / modified / paid | ✅ | ✅ | ✅ |
| attribution_* (UTM, source, device, session) | ✅ | ✅ | ✅ |
| payment_meta Mollie + transaction_id | ✅ | ✅ | ✅ |
| shipping_carrier / tracking_number (meta BMS) | ✅ | ✅ | ✅ |
| `get_order_number()` | ✅ envoyé | ❌ ignoré | 🟡 (souvent = id, peu utile) |
| `get_subtotal()` | ✅ envoyé | ❌ ignoré | 🟡 (recalculable depuis items) |
| `get_customer_note()` | ✅ envoyé | ❌ ignoré | 🟡 (utile SAV/prépa) |
| `get_currency()` | ✅ envoyé | ❌ ignoré | 🟡 (mono-devise EUR → inutile) |
| `date_completed` | ✅ envoyé | ❌ ignoré | 🟡 (utile délais d'expédition) |
| `get_shipping_tax()` (TVA du port séparée) | ❌ | ❌ | 🔴 (TVA port noyée dans total_tax) |
| `get_total_discount()` vs `get_discount_tax()` | partiel | partiel | 🔴 (TVA de la remise non isolée) |
| `get_date_modified` GMT vs local | local | local | ➖ |
| `get_customer_ip_address()` / `get_customer_user_agent()` | ❌ | ❌ | ➖ (fraude/géoloc, RGPD) |
| `get_created_via()` (checkout / admin / api / rest) | ❌ | ❌ | 🔴 (utile : distinguer commandes manuelles) |
| `get_cart_hash()` | ❌ | ❌ | ➖ |
| `get_billing_email()` au niveau order | ✅ (via customer_email) | ✅ | ✅ |
| Meta `_order_stock_reduced` | ❌ | ❌ | ➖ |
| Notes de commande (`get_customer_order_notes()` / notes privées) | ❌ | ❌ | 🔴 (historique interne, utile SAV) |

### 2b. Line items (`order_items` type `line_item`)

| Donnée WC item | Plugin | Backend | État |
|---|---|---|---|
| item_id, product_id, variation_id, name, qty | ✅ | ✅ | ✅ |
| subtotal, total, total_tax, tax_class | ✅ | ✅ | ✅ |
| line_subtotal_tax, line_tax_data | ✅ | ✅ | ✅ |
| sku | ✅ envoyé | ❌ ignoré | 🟡 (résolvable via products) |
| product_attributes (variations) | ✅ | ✅ | ✅ |
| advanced_discount / wdr_discounts (remises plugin) | ✅ | ✅ | ✅ |
| item_cost / item_total_cost (COG) | ✅ | ✅ | ✅ |
| reduced_stock | ✅ | ✅ | ✅ |
| Coupon items (discount_amount, discount_tax) | ✅ | ✅ | ✅ |
| Fee items (total, total_tax, tax_class) | ✅ | ✅ | ✅ |
| Tax items (rate_code, rate_id, label, compound, amounts) | ✅ | ✅ | ✅ |
| Shipping items détaillés (method_id/title/total) | ✅ envoyé | partiel (juste method) | 🟡 (total port OK via order, mais pas multi-lignes) |

**Verdict orders** : aucun trou financier majeur dans les line items (très complet). Manques réels notables :
- 🔴 `get_created_via()` — distinguer commandes site / manuelles / API
- 🔴 `shipping_tax` isolé et `discount_tax` au niveau order — utile pour une TVA ventilée fine
- 🔴 Notes de commande internes — utile SAV
- 🟡 `customer_note`, `date_completed` (déjà envoyés, juste à stocker côté backend)

---

## 3. PRODUCTS (`WC_Product` → table `products`)

| Donnée WC | Plugin | Backend | État |
|---|---|---|---|
| id, parent_id, type, name, slug, sku, status | ✅ | ✅ | ✅ |
| price, regular_price, sale_price, on_sale | ✅ envoyé (4) | partiel (price, regular) | 🟡 sale_price + on_sale ignorés |
| stock_quantity, stock_status, manage_stock | ✅ | ✅ | ✅ |
| weight | ✅ | ✅ | ✅ |
| length, width, height | ✅ envoyé | ❌ ignoré | 🟡 (utile colis/port) |
| tax_status, tax_class | ✅ envoyé | ❌ ignoré | 🟡 (utile calcul TVA produit) |
| description, short_description | ✅ envoyé | ❌ ignoré | 🟡 (volumineux, peu utile stats) |
| image_url, permalink | ✅ | ✅ (image) | 🟡 permalink ignoré |
| brand / sub_brand / category / sub_category | ✅ | ✅ | ✅ |
| variation attributes | ✅ | ✅ | ✅ |
| date_created / modified | ✅ | ✅ | ✅ |
| `get_backorders()` | ❌ | ❌ | ➖ |
| `get_low_stock_amount()` | ❌ | ❌ | 🔴 (utile seuil réappro vs notre `max_order_qty`) |
| `get_total_sales()` (compteur ventes WC) | ❌ | ❌ | ➖ (on recalcule) |
| `get_attributes()` complets (pas juste variation) | ❌ | ❌ | 🔴 (filtres : PG/VG, nicotine, contenance, arôme…) |
| `get_upsell_ids()` / `get_cross_sell_ids()` | ❌ | ❌ | ➖ |
| `get_gallery_image_ids()` | ❌ | ❌ | ➖ |
| `get_purchase_note()` | ❌ | ❌ | ➖ |
| `get_shipping_class()` | ❌ | ❌ | 🔴 (peut impacter calcul frais de port) |
| `get_date_on_sale_from/to()` | ❌ | ❌ | ➖ |
| barcode / EAN (meta selon plugin) | ❌ (géré ailleurs ? cf add_product_barcodes.sql) | — | 🔴 à vérifier |

**Verdict products** : plusieurs manques **utiles** :
- 🔴 **attributs produits complets** (PG/VG, taux nico, contenance, arôme) — gros potentiel pour filtres/stats. Aujourd'hui on n'a que les attributs de variation.
- 🔴 dimensions (length/width/height) + shipping_class — frais de port / colisage
- 🟡 sale_price / on_sale — savoir si une vente s'est faite en promo
- 🔴 low_stock_amount, barcode (à recouper avec la table barcodes existante)

---

## 4. CUSTOMERS (`WC_Customer` → table `customers`)

| Donnée WC | Plugin | Backend | État |
|---|---|---|---|
| id, email, first_name, last_name | ✅ | ✅ | ✅ |
| date_created (user_registered) | ✅ | ✅ | ✅ |
| display_name, username | ✅ envoyé | ❌ ignoré | 🟡 |
| billing_* (adresse complète, company, phone) | ✅ envoyé | ❌ ignoré | 🟡 (redondant avec orders, mais = adresse "compte") |
| shipping_* (adresse complète) | ✅ envoyé | ❌ ignoré | 🟡 |
| date_modified | ✅ envoyé | ❌ ignoré | 🟡 |
| orders_count, total_spent | ✅ envoyé | ❌ ignoré | 🟡 (on recalcule depuis orders → plus fiable) |
| `get_role()` / is_paying_customer | ❌ | ❌ | ➖ |
| `get_meta()` marketing (newsletter opt-in, WPLoyalty points, parrainage) | ❌ | ❌ | 🔴 (fidélité / CRM) |
| `get_last_order()` / dates | ❌ (recalculable) | ❌ | ➖ |
| Préférences RGPD / consentements | ❌ | ❌ | ➖ |
| Champs ACF / custom du compte | ❌ | ❌ | 🔴 si utilisés |

**Verdict customers** : la plupart des "manques" sont **volontaires et sains** (on recalcule
total_spent/orders_count depuis nos propres `orders`, plus fiable). Le seul ajout à valeur réelle :
- 🔴 méta **fidélité / marketing** (points WPLoyalty, opt-in newsletter) si on veut du CRM.
- 🟡 adresse de compte (vs adresse de commande) — utile seulement si différente.

---

## 5. MÉTA / PLUGINS TIERS

| Source | Capturé ? | État |
|---|---|---|
| Mollie (payment_id, mode, customer_id, instructions) | ✅ | ✅ |
| WC Order Attribution (UTM, source, device, session) | ✅ | ✅ |
| WDR / Advanced Woo Discount Rules (remises ligne) | ✅ | ✅ |
| WC COG (`_wc_cog_item_cost`, total_cost) | ✅ | ✅ |
| BMS (carrier, tracking) | ✅ | ✅ |
| WPLoyalty (points, niveau fidélité) | ❌ | 🔴 (CRM/fidélité) |
| Parrainage / referral | ❌ | 🔴 si utilisé |
| Perfect Brands (pwb-brand) | ✅ | ✅ |
| Avis (Garantie/loyalty) | géré hors yousync (API reviews) | ✅ |
| Champs ACF produit/commande custom | ❌ | 🔴 à inventorier sur la prod |

---

## Synthèse — Ce qui vaut la peine d'entrer dans la nouvelle version plugin

### Priorité 1 — Intégrité financière / stats (le cœur)
- 🔴 **Refunds : `order_total`, `order_tax`** (le bug connu) + 🟡 `refunded_by` (backend seul)
- 🔴 **Refund items** (ventiler les remboursements par produit) — si on veut des stats fines
- 🔴 Order : `shipping_tax` + `discount_tax` isolés, `created_via`

### Priorité 2 — Catalogue / opérationnel
- 🔴 **Attributs produits complets** (PG/VG, nicotine, contenance, arôme) → filtres & analyses
- 🔴 Dimensions produit + shipping_class → frais de port / colisage
- 🟡 sale_price / on_sale, tax_class produit (déjà envoyés ou triviaux)

### Priorité 3 — CRM / nice-to-have
- 🔴 Méta fidélité (WPLoyalty), opt-in marketing
- 🟡 customer_note, date_completed sur la commande (backend seul, déjà envoyés)
- 🟡 adresse de compte client

### Gratuit (backend uniquement, AUCUN risque prod plugin) — les 🟡
Tous les champs marqués 🟡 sont **déjà envoyés par le plugin actuel** et simplement jetés
par le backend. On peut les capter sans toucher à la prod WordPress :
`refunds.refunded_by`, `orders.customer_note/date_completed/order_number/subtotal`,
`products.sale_price/on_sale/length/width/height/tax_class/tax_status/permalink`,
`customers.display_name/username/billing_*/shipping_*`, `order_items.sku`, shipping items détaillés.

---

## ⚠️ Prérequis avant toute migration
1. **Dumper le DDL réel** des tables sur le Postgres VPS (`\d orders`, `\d products`,
   `\d customers`, `\d order_items`, `\d refunds`) — le schéma n'est pas dans le repo,
   ce tableau est déduit du code et doit être confirmé.
2. **Inventorier les ACF / meta custom réellement présentes** sur la prod WordPress
   (`SELECT DISTINCT meta_key FROM ...wc_orders_meta / postmeta`) avant de décider
   quelles méta tierces valent un champ.
3. Toute nouvelle colonne = migration Postgres idempotente (`ADD COLUMN IF NOT EXISTS`).
4. Plugin : une **seule** version (ex. 1.5.0) qui ajoute tous les champs P1+P2 retenus,
   testée en préprod, puis copiée en prod + `reload php-fpm`.
