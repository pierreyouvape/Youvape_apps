# Logique métier — Youvape Apps

## Dates WooCommerce

WooCommerce envoie les dates en heure Paris locale (CET/CEST), stockées telles quelles en BDD (pas d'UTC). Ne jamais utiliser `new Date(dateString)` directement côté frontend — utiliser `frontend/src/utils/dateUtils.js`.

---

## Coûts produits

Deux sources de coût coexistent sur la table `products` :

| Colonne | Source | Usage |
|---|---|---|
| `wc_cog_cost` | Plugin WooCommerce COG | Coût de référence si pas de PO |
| `computed_cost` | PMP FIFO calculé depuis les PO reçus | Prioritaire sur `wc_cog_cost` |

**Règle dans tous les calculs de stats/marges :**
```sql
COALESCE(p.computed_cost, p.wc_cog_cost, 0)
```

- `order_total_cost` dans `orders` est **toujours NULL** — jamais calculé.
- Pour le coût d'une commande : `SUM(oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0))` via jointure `order_items` → `products`.
- `computed_cost` est recalculé toutes les 30 min par le cron.

---

## BMS (BoostMyShop myFulfillment)

**API** : `https://fr3.myfulfillment.boostmyshop.com/api`, authentification Bearer (token en cache 1h).

**Pagination** : `offset + limit`. Pas de filtre serveur → fetch tout, filtre côté app.

### Prix dans les Purchase Orders

- `unit_price` dans `purchase_order_items` = prix **unitaire** (prix d'une unité, pas d'un pack).
- `qty_ordered` / `qty_received` = déjà multipliés par `pack_qty`.
- Pour créer un PO dans BMS (`createInBMS`) : envoyer `price = unit_price` directement.
- Coût unitaire pour les stats : `unit_price` (déjà unitaire).

### Sync cron PO

- Toutes les 30 min, 9h–19h, lun–ven (Europe/Paris).
- Full re-sync : remettre `bms_last_po_sync_at` à une date ancienne :
  ```sql
  UPDATE app_config SET config_value = '2020-01-01T00:00:00Z' WHERE config_key = 'bms_last_po_sync_at';
  ```

---

## Fournisseurs

- `product_suppliers` stocke toujours sur la **variation** (ou produit simple), jamais sur le produit parent (`variable`).
- `pack_qty` est syncé depuis BMS dans `product_suppliers`.
- `resolveProductId()` dans `backend/src/models/supplierModel.js` : résout `wp_product_id` ou SKU → `id` interne. À utiliser systématiquement pour toute opération BDD depuis une source externe.

---

## Calcul des besoins (NeedsTab)

Le calcul de réapprovisionnement s'appuie sur :
- `suppliers.analysis_period_months` : période de ventes analysée
- `suppliers.coverage_months` : mois de stock à couvrir
- `suppliers.lead_time_days` : délai de livraison
- `products.exclude_from_reorder` : exclure un produit du calcul
- `product_suppliers.min_order_qty` / `max_order_qty` : quantités min/max de commande

Les commandes Belgique sont **exclues** du calcul des besoins.

---

## Parseurs PDF fournisseurs

Répertoire : `backend/src/parsers/`

| Parseur | Fournisseur |
|---|---|
| `lcaParser.js` | LCA |
| `lvpParser.js` | LVP |
| `cigaccessParser.js` | Cigaccess |
| `curieuxParser.js` | Curieux |
| `etastyParser.js` | Etasty |
| `gfcParser.js` | GFC |
| `joshnoaParser.js` | Joshnoa |
| `levestParser.js` | Levest |
| `revoluteParser.js` | Revolut (CSV import + email Gmail confirmation, remise 15%) |
| `lipsParser.js` | LIPS - French Liquide (format Commande Odoo) |

**Règle `pdfImportModel`** : `dbPrice` est divisé par `pack_qty`. Le prix PDF n'est retenu que s'il est inférieur au prix en BDD.

---

## La Poste / Packing

- Poids fixe **20g** pour toutes les étiquettes.
- Tranches : 20g, 50g, 100g, 250g.
- Pop-up de confirmation si la méthode de livraison n'est pas "Lettre Suivie".
- Controller : `backend/src/controllers/laposteController.js`

---

## Stats & Analyse

- **Transporteurs** : `orders.shipping_method`
- **Coupons** : `orders.cart_discount > 0`
- **Coût HT** : `order_items.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)`
- **KPIs** : affichés en noir
- **Camemberts** : légende tableau à droite, pastilles couleur, pas de labels texte sur le graphique

---

## Auth & Permissions

- JWT stocké côté client.
- Toutes les routes backend (sauf `/auth`) passent par `authMiddleware.js`.
- Permissions par fonctionnalité dans `user_permissions` (`app_name` + `can_read` / `can_write`).
- Vérification côté frontend via `hooks/usePermissions.js`.
- `is_admin` dans `users` : accès total sans restriction de permissions.
