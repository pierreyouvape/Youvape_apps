# Passation — Bug : TVA des remboursements non synchronisée (Youvape_apps ↔ yousync)

> Document de passation pour le mainteneur du module `yousync`.
> Rédigé en juin 2026 après investigation d'un écart de TVA VPS vs Metorik.

## 1. Symptôme

Dans les rapports du VPS (`/stats/reports` et dashboard financier), la TVA d'une
période ne correspond pas à Metorik. Exemple mai 2026 :
**VPS 35 245,77 € vs Metorik 34 971 €**.

Plus largement, on a découvert en investiguant que **la colonne `refunds.order_tax`
(et `refunds.order_total`) est NULL pour tous les remboursements depuis février 2026**,
ce qui empêche tout calcul de TVA nette des remboursements.

## 2. Architecture concernée

- **Boutique prod** : `www.youvape.fr`, WooCommerce en **HPOS**, **php-fpm sur le host**
  du VPS (pas de conteneur Docker), plugin déployé dans une *release copiée* (non git) :
  `/home/ubuntu/youvape-site/www/releases/1/wp-content/plugins/yousync/`
- **DB boutique** : MySQL conteneur `youvape-site-db-1`, base `youvape-vps`,
  **préfixe de tables `hJvjTIOu`**. Les remboursements HPOS sont dans
  `hJvjTIOuwc_orders` (`type='shop_order_refund'`), colonnes **`total_amount`** et
  **`tax_amount`** (toutes deux **négatives**).
- **App** : repo `Youvape_apps`, backend Node + Postgres `youvape_db` (conteneur
  `youvape_postgres`). Le backend **poll** la queue du plugin yousync
  (`wc_sync_wp_url = https://www.youvape.fr`, intervalle 60 s) et écrit dans Postgres.

## 3. Cause racine (chaîne complète)

Le remboursement perd sa TVA à **deux endroits** du pipeline de sync :

### a) Plugin WordPress `yousync` — `Data_Fetcher::get_refund()`

Fichier : `yousync/includes/class-data-fetcher.php` (~ lignes 341-348)
La méthode ne renvoie **que** :

```php
'wp_refund_id', 'wp_order_id', 'refund_amount', 'refund_reason', 'refund_date', 'refunded_by'
```

→ **pas** `order_total` ni `order_tax`. WooCommerce les expose pourtant sur l'objet
`WC_Order_Refund` : `$refund->get_total()` et `$refund->get_total_tax()`.

### b) Backend — `wcSyncService.processRefund()`

Fichier : `backend/src/services/wcSyncService.js` (~ ligne 529)
L'`INSERT INTO refunds (...)` ne contient que
`wp_refund_id, wp_order_id, refund_amount, refund_reason, refund_date`. Donc même si
le plugin envoyait la TVA, elle ne serait pas stockée.

### Pourquoi NULL seulement à partir de fév. 2026 ?

Les remboursements ≤ nov. 2025 ont leur `order_tax` car ils proviennent du
**dump initial** (migration de l'ancien système). Depuis que le **sync live** a pris
le relais (~déc. 2025), chaque nouveau remboursement passe par `get_refund()` /
`processRefund()` → `order_tax` NULL.

Distribution constatée (table `refunds`) :

```
2025-01 → 2025-11 : order_tax renseigné (dump initial)
2026-02 → 2026-06 : order_tax NULL  (sync live)   ← 113 lignes
```

## 4. Convention de données (à respecter pour tout fix/backfill)

| Champ | Signe | Source WooCommerce / HPOS |
|---|---|---|
| `refunds.refund_amount` | **positif** | `get_amount()` |
| `refunds.order_total` | **négatif** | `get_total()` / `hJvjTIOuwc_orders.total_amount` |
| `refunds.order_tax` | **négatif** | `get_total_tax()` / `hJvjTIOuwc_orders.tax_amount` |

Exemple vérifié : refund `1239826` → MySQL `total_amount=-129.23, tax_amount=-21.54` ;
Postgres `refund_amount=129.23, order_tax NULL`.

## 5. Ce qui a déjà été fait (côté app/DB uniquement)

- ✅ **Backfill de 108 remboursements** historiques NULL dans Postgres, lu depuis la
  copie MySQL de la prod. Méthode :

  ```sql
  -- 1) Export MySQL (boutique)
  SELECT id, total_amount, tax_amount
  FROM hJvjTIOuwc_orders WHERE type='shop_order_refund';

  -- 2) Dans Postgres (table temp rb(id,total,tax) chargée du TSV)
  UPDATE refunds r SET order_total = rb.total, order_tax = rb.tax
  FROM rb WHERE rb.id = r.wp_refund_id AND r.order_tax IS NULL;
  ```

- ⚠️ Restent **5 remboursements NULL** (juin 2026 :
  `1241134, 1240507, 1240312, 1240311, 1240106`) **absents de `hJvjTIOuwc_orders`**
  → remboursements fantômes / non trouvés côté WooCommerce, à investiguer.
- ↩️ Les modifs de code (plugin + backend) ont été **revertées** à la demande
  (ne pas toucher le module). Commits de référence : ajout initial par un collègue
  `08a943a`, revert `83d5278`, ré-ajout puis re-revert côté app (`1ca5163` → `6820bb3`).

## 6. Ce qu'il reste à faire (nécessite le module)

Le backfill ne couvre que l'existant. **Les nouveaux remboursements seront à nouveau
NULL.** Deux options :

### Option A (propre, recommandée) — corriger le pipeline de sync

1. `yousync` `get_refund()` : ajouter

   ```php
   'order_total' => floatval($refund->get_total()),
   'order_tax'   => floatval($refund->get_total_tax()),
   ```

   bumper la version, déployer dans la release prod + recharger l'opcache
   (`systemctl reload php8.2-fpm`).
2. backend `processRefund()` : ajouter `order_total, order_tax` à l'`INSERT` **et** à
   l'`ON CONFLICT DO UPDATE SET`.
   ⚠️ L'`ON CONFLICT` actuel ne touche pas `order_tax` → les valeurs backfillées
   survivent aux updates, c'est volontaire.

### Option B (sans toucher le module) — rattrapage récurrent en base

Un job planifié qui rejoue périodiquement le backfill MySQL→Postgres
(l'`UPDATE … WHERE order_tax IS NULL` ci-dessus). C'est la voie choisie côté app
pour l'instant.

## 7. ⚠️ Point crucial à ne pas mal interpréter

**Ce bug n'est PAS la cause de l'écart de TVA avec Metorik.** Une fois la TVA des
remboursements backfillée, la TVA remboursée réelle de mai = **175,91 €**, donc TVA
nette = 35 069,86 €, **toujours ~99 € au-dessus de Metorik (34 971)**. L'écart TVA
(et ceux du CA ~170 €, du port ~12 €, des commandes ±3) est du **bruit de
frontière/arrondi interne à Metorik** (< 0,3 %), pas un bug de données. Corriger la
sync des remboursements est nécessaire **pour l'intégrité des données** (et tout
calcul futur basé sur la TVA remboursée), **pas** pour faire matcher la TVA Metorik
au centime.

Pour info, les alignements Metorik déjà déployés côté rapports (commits `cb0fda2`,
`c0df463`) : filtrage en `Europe/Paris`, base **date de création** `post_date`,
remboursements hors commandes annulées/échouées, KPI frais de port.
