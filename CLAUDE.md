# CLAUDE.md — Youvape Apps

## Règles absolues

### Interrogation de la base de données
**Toujours interroger la BDD directement sur le VPS via SSH, jamais en local.**

Pattern SSH à utiliser :
```bash
ssh youvape "docker exec youvape_postgres psql -U youvape -d youvape_db -c \"SELECT ...;\""
```

Pour les requêtes longues ou multi-lignes :
```bash
ssh youvape "docker exec -i youvape_postgres psql -U youvape -d youvape_db" <<'SQL'
SELECT ...
FROM ...
WHERE ...;
SQL
```

### Avant tout UPDATE / DELETE / INSERT / DROP
Montrer la requête exacte à l'utilisateur et attendre sa confirmation explicite.

### Statuts WooCommerce valides pour le CA

Le shop utilise des **statuts personnalisés** en plus des statuts natifs WC.

**Statuts à inclure pour le CA** (commandes payées) :
- `wc-completed` — Terminée
- `wc-delivered` — Livrée (statut custom)
- `wc-processing` — En cours
- `wc-awaiting-delivery` — Retrait boutique (statut custom)
- `wc-shipped` — Expédiée (statut custom)
- `wc-being-delivered` — En cours de livraison (statut custom)

**Statuts à exclure** :
- `wc-cancelled` — Annulée
- `wc-pending` — En attente de paiement
- `wc-failed` — Échouée
- `wc-checkout-draft` — Brouillon (panier abandonné)
- `wc-refunded` — Remboursée (déduire le `refund_amount` depuis la table `refunds`)

**Ne jamais filtrer uniquement sur `wc-completed` + `wc-processing`** — `wc-delivered` représente typiquement ~1 000 €/jour de CA invisible sinon.

### Date de référence pour les requêtes financières

Toujours utiliser `COALESCE(paid_date, post_date)` et non `post_date` seul.
`paid_date` = date de paiement réelle (confirmée par Mollie/WC).
`post_date` = date de création de la commande (peut différer du paiement).

```sql
WHERE COALESCE(o.paid_date, o.post_date) >= 'YYYY-MM-DD 00:00:00'
  AND COALESCE(o.paid_date, o.post_date) <  'YYYY-MM-DD 00:00:00'
```

**Idem pour les remboursements** : filtrer sur `refund_date`, pas sur la date de la commande parente.

---

### Dates
WooCommerce stocke en heure Paris locale (CET/CEST), pas UTC.

### Calcul de la TVA (formule exacte Metorik)

La TVA totale d'une commande = TVA produits + TVA livraison :
```sql
SUM(CASE WHEN oi.order_item_type = 'line_item' THEN oi.line_tax ELSE 0 END)   -- TVA produits
+ SUM(CASE WHEN oi.order_item_type = 'tax'       THEN oi.line_tax ELSE 0 END)  -- TVA livraison
```

**Ne jamais utiliser uniquement les `line_item` — ça oublie la TVA sur le transport.**

CA HT (formule exacte app) :
```
taxRatio    = tva / ca_ttc_brut
tvaAjustee  = tva - (remboursements × taxRatio)
caHTNet     = (ca_ttc_brut - remboursements) - tvaAjustee
```
La TVA est ajustée proportionnellement sur les remboursements (un remboursement réduit aussi la TVA collectée).

### Coûts commandes
`order_total_cost` dans `orders` est toujours NULL — pour le coût d'une commande :
```sql
SUM(oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0))
```
via jointure `order_items` → `products`.

### Bundles WooCommerce (woosb)

Les produits de type `woosb` (packs) génèrent **deux lignes** dans `order_items` :
1. Le bundle lui-même (ex: Pack 10 Boosters) avec le prix réel
2. Chaque composant (ex: Booster unitaire) avec `line_total = 0.00€` et la quantité incluse

**Conséquence :** quand on compte les unités d'un produit simple, les unités vendues via bundle sont **déjà incluses** (à 0€). Ne jamais additionner les deux.

**Règle :** pour toute question sur les volumes d'un produit, toujours vérifier d'abord si ce produit est composant d'un bundle avec une requête sur un cas concret avant de conclure.

### Doutes sur une table/colonne
Introspecter avec `\d+ nom_table` plutôt qu'inventer.

---

## Connexion VPS

- **Alias SSH** : `youvape` (configuré dans `~/.ssh/config`)
- **IP** : 54.37.156.233
- **User** : ubuntu
- **Clé** : `~/.ssh/id_ed25519`

---

## Bugs corrigés — historique

### 2026-05-22 — Besoins achats : alignement ATUM (`commits b85d907 → fb35b10`)
**Fichiers** : `NeedsTab.jsx`, `needsCalculationModel.js`

- **Formule ATUM** : remplacement de `theoreticalSafety = max_order_qty + fifteenDaysSales` par `dailyRate = salesInPeriod / periodDays` → besoin uniquement si `stockWillLast < leadTime + coverage`. Élimine les faux positifs (produits sans ventes récentes).
- **Fenêtre 31 jours** : alignement sur ATUM "Sales last 31 days" (au lieu de 30j). Inclure le jour courant (les commandes du jour sont valides).
- **Migration localStorage** : quand on change une valeur par défaut sauvegardée côté client, toujours prévoir la migration dans `loadSavedFilters()` — sinon les utilisateurs existants gardent l'ancienne valeur.
- **lead_time_days** ajouté au raw data backend pour calcul de la cible.
- **Colonne "Stock j."** ajoutée (jours de stock restants, équivalent ATUM "Stock will last days").
- **Statuts needsCalculationModel** : ajout `wc-awaiting-delivery`, `wc-shipped`, `wc-being-delivered` (x7 requêtes).

---

### 2026-05-22 — Dates temps réel (`commit 968bf4e`)
**Fichiers** : `ProductsStatsTab.jsx`, `NeedsTab.jsx`

- `ProductsStatsTab` utilisait `toISOString()` (UTC) → en heure Paris, donnait **la veille** comme date de fin. Remplacé par formatage local.
- Mode jours et mois : inclure le jour/mois en cours pour des données temps réel.

---

### 2026-05-22 — Statuts fallback incomplets purchases/stats/analysis (`commit fdcaabb`)
**Fichiers** : `productStatsService.js`, `reportsController.js`, `analysisController.js`

- `productStatsService` : ajout `wc-awaiting-delivery`, suppression `wc-wms_cp_delivered` (inexistant en BDD).
- `reportsController` : fallback par défaut `wc-completed + wc-delivered` → 6 statuts valides (x2 occurrences).
- `analysisController` : fallback manquait `wc-shipped` et `wc-being-delivered`.

---

### 2026-05-22 — Statuts incomplets sur toutes les pages (`commit ee8810a`)
**Fichiers** : `productModel.js`, `customerModel.js`, `advancedFilterService.js`, `paymentController.js`

- 28 occurrences de `wc-completed` seul (ou sets incomplets) remplacées par les 6 statuts valides sur l'ensemble du backend.
- Pages corrigées : `/products/:id` (stats, top clients), `/customers` + `/customers/:id` (total_spent, order_count), recherche avancée clients, calcul frais paiement (suppression `wc-pending`).

---

### 2026-05-22 — Ventes 30j catalogue (`commit 5fe9080`)
**Fichier** : `backend/src/models/productModel.js`

- La requête ventes 30j filtraient sur `wc-expediee` (statut inexistant) et omettait `wc-delivered`, `wc-awaiting-delivery`, `wc-shipped`, `wc-being-delivered`. Résultat : 0 ventes affichées pour tous les produits.
- Corrigé avec les 6 statuts valides identiques au reste de l'app.

---

### 2026-05-21 — Export PDF & envoi BMS (`commit 385cce1`)
**Fichiers** : `purchasesController.js`, `purchaseOrderModel.js`, `OrdersTab.jsx`

- **Fix crash export CSV** : `total_amount` retourné par PostgreSQL est une string (type `numeric`). Correction : `parseFloat(order.total_amount).toFixed(2)`.
- **Messages d'erreur** : tous les `catch` du `purchasesController` renvoyaient `'Erreur serveur'` en dur. Corrigé en `error.message || 'Erreur serveur'` pour afficher la vraie cause.
- **Validation avant envoi BMS** : si des articles n'ont pas de `unit_price`, le backend bloque avec un message listant les SKUs concernés au lieu de laisser BMS retourner une 500 opaque.
- **Frontend** : la réponse d'erreur sur l'export est un `Blob` (responseType blob). Ajout d'une lecture `Blob → JSON` pour extraire et afficher le message réel.

> **Règle déployement** : le backend et le frontend sont dans des images Docker — modifier les fichiers sources ne suffit pas. Il faut **rebuilder les images** (`docker compose build`) et relancer les containers.

---

## Sources de vérité
- `docs/DATABASE.md` — schéma des 34 tables
- `docs/ARCHITECTURE.md` — infra, backend, frontend
- `docs/BUSINESS_LOGIC.md` — logique métier
- `.claude/api-routes.md` — routes API
