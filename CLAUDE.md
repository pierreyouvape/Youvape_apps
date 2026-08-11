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

## Sécurité

### Authentification des routes API
La plupart des routeurs de données (`stats, customers, products, orders, brands,
categories, analysis, reports, shipping, payment, tariffs, transporteurs,
competitors, chronopost, colissimo, lettre-suivie, mondial-relay`) sont protégés
par `authMiddleware` (JWT) **au point de montage dans `server.js`**
(`app.use('/api/x', authMiddleware, xRoutes)`). Le front attache le token à
**chaque** requête via un intercepteur axios global (`main.jsx`) — donc tout
nouvel appel de lecture est authentifié sans effort. Les appels `fetch()`
(hors axios) doivent poser le header à la main.

**Routeurs volontairement NON couverts par le JWT utilisateur** (ne pas casser) :
- `/api/auth` (login public)
- `/api/sync` + `/api/woo-sync` (ingestion YouSync depuis WordPress — **pas d'auth
  aujourd'hui, à sécuriser via un secret partagé, pas un JWT utilisateur**)
- `/api/webhook` (a son propre `verifyToken`)
- `/api/client-sav` (a son propre middleware `CLIENT_SAV_SECRET`)
- routeurs déjà auto-authentifiés (`reviews, rewards, emails, users, settings,
  purchases, packing, laposte, preferences, financier, sav`)

**Règle** : tout nouveau routeur exposant des données doit être monté avec
`authMiddleware` dans `server.js`, sauf s'il est appelé par un système externe
(alors : secret dédié).

## Bugs corrigés — historique

### 2026-08-11 — Achats : arrivages comptés en packs (`commit b41501d`)
**Fichiers** : `purchaseOrderModel.js`, `productModel.js`, `needsCalculationModel.js`, `productsController.js`, `OrdersTab.jsx`

- **Règle à connaître** : `purchase_order_items` a **deux unités de compte**. Pour les
  fournisseurs « à l'unité » (`parserRegistry.skipsPackQty` : LCA, Highbuy, Levest,
  MG Vape), `qty_ordered` = nombre de **PACKS** et `unit_price` = prix **DU PACK** ;
  ailleurs, `qty_ordered` = unités et `unit_price` = prix unitaire. Dans les deux cas
  `qty_ordered × unit_price` = montant de la ligne (invariant), d'où la survie du bug.
- **Symptôme** : un pack de 10 LCA (BMS PO 118531, `#REF12575-41110` : qty 1 ×
  qty_pack 10 à 8,70 €) apparaissait « 1 pièce en arrivage » au lieu de 10 — les
  6 requêtes d'arrivage sommaient `qty_ordered - qty_received` comme des unités.
- **Correctif** : colonne `purchase_order_items.units_per_qty` = nombre d'unités de
  stock par `qty_ordered` (1 par défaut, `qty_pack` pour les lignes en packs),
  renseignée à la synchro BMS, à la création et à l'édition de commande.
  **Tout calcul de stock doit faire `(qty_ordered - qty_received) × units_per_qty`.**
- **Rattrapage** : jamais via `product_suppliers.pack_qty` (= conditionnement COURANT
  du catalogue, pas celui de la commande passée : les vieilles lignes boosters LCA,
  déjà en unités, deviennent des packs de 200). Utiliser
  `node backend/scripts/backfillUnitsPerQty.js [--all] [--apply]`, qui tranche ligne à
  ligne en comparant la quantité locale à la commande BMS d'origine.
- **Sémantique BMS** (utile pour toute reprise) : `qty` est un nombre de packs,
  `subtotal = qty × price`, unités physiques = `qty × qty_pack`.

### 2026-07-29 — Sécurité : exposition de données sans authentification (`commit 1bbf603`)
**Fichiers** : `server.js`, `permissionMiddleware.js`, `main.jsx`, `CustomerAutocomplete.jsx`

- **Faille** : ~15 routeurs (dont `customers`, `orders`, `products`, `stats`…)
  n'appliquaient aucun `authMiddleware` → `GET /api/customers/stats-list` renvoyait
  emails clients + historique d'achat **sans token**, en clair sur l'IP publique.
- **Correctif backend** : `authMiddleware` ajouté au montage dans `server.js` (voir
  section Sécurité pour la liste + exclusions).
- **Correctif frontend** : intercepteur axios global (`main.jsx`) attachant le token
  à toutes les requêtes (beaucoup d'appels de lecture ne le posaient pas) ; fix du
  `fetch()` de `CustomerAutocomplete` (SAV) qui ne l'envoyait pas.
- **`permissionMiddleware`** : renvoyait 500 au lieu de 401 quand `req.user` absent.
- **Reste à faire** : sécuriser `/api/sync` + `/api/woo-sync` (ingestion WordPress)
  via un secret partagé — actuellement sans auth.


### 2026-07-29 — Stats : paniers abandonnés comptés comme ventes (`commits 9590b14, 5bd7a26`)
**Fichiers** : `productModel.js`, `customerModel.js`, `categoriesController.js`, `ProductsStatsTab.jsx`

- **Cause racine** : filtrage par statut incohérent dans toute l'app stats. Plusieurs requêtes utilisaient une **liste noire incomplète** `NOT IN ('wc-failed','wc-cancelled')`, laissant passer `wc-checkout-draft` (3 546 paniers abandonnés, dont 3 532 rattachés à de vrais clients ≈ 157 k€ fantômes), `wc-pending` et `wc-refunded`.
- **Onglet Produits** (`productModel.getStatsList`, `item_base`) : `qty_sold`/CA/marge gonflés. Ex. Puff Falcon X 60 j = 213 → **148** (Metorik : 144). Corrigé aussi `getVariationsForStats` (détail par variation) et `getStatsCountries` (filtre pays).
- **Onglet Clients** (`customerModel`) : `order_count`/`total_spent`/dates/coût/marge/commandes-par-mois incluaient les paniers abandonnés. Ex. client 20728 : 17 cmd / 619 € → **0 / 0** (toutes ses "commandes" étaient des drafts).
- **Onglet Catégories** (`categoriesController.VALID_ORDER_STATUSES`) : contenait le statut **fantôme `wc-wms_cp_delivered`** et **oubliait `wc-shipped` + `wc-awaiting-delivery`** (sous-comptage).
- **Correctif** : partout, liste blanche des 6 statuts payés (`wc-completed, wc-delivered, wc-processing, wc-awaiting-delivery, wc-shipped, wc-being-delivered`), cohérente avec Financier/Analyse.
- **Règle** : pour toute stat de ventes/CA, **toujours filtrer en liste blanche des 6 statuts payés**, jamais en liste noire (le shop a des statuts custom + `wc-checkout-draft` très volumineux).
- **Choix assumé** : la tab Produits reste sur `post_date` (pas `paid_date`) car elle est cross-checkée contre Metorik qui indexe sur la date de commande ; l'écart `paid_date`/`post_date` > 1 j ne concerne que ~0,4 % des commandes.
- **Bonus** : `ProductsStatsTab` préremplissait les dates du sélecteur perso via `toISOString()` (UTC → veille en soirée), remplacé par `localFmt`.

**Audit VPS complémentaire (même jour)** — 3 autres foyers du même bug trouvés et corrigés :
- **Onglet Marques** (`brandsController.VALID_ORDER_STATUSES`, 7 requêtes) : identique à Catégories (statut fantôme `wc-wms_cp_delivered` + oubli `wc-shipped`/`wc-awaiting-delivery`). → 6 statuts payés.
- **Dashboard `statsService`** (KPIs, top produits/clients, CA par pays/catégorie via `statsRoutes`) : liste blanche à 4 statuts, oubliait `wc-shipped` + `wc-being-delivered` (137 cmd / 6 k€ latents). → 6 statuts.
- **Coût PMP FIFO** (`computedCostModel.recalculateAll`) : le "total vendu" consommant les lots FIFO utilisait `NOT IN (cancelled,refunded,failed,on-hold,pending)` sans exclure `wc-checkout-draft` → **2 267 produits/3 631 (62 %)** avaient un total vendu gonflé (25 262 unités fantômes, pire cas +6 437), décalant le pointeur FIFO et faussant `computed_cost` (donc toutes les marges). → 6 statuts payés. Recalcul auto via cron (`5,35 9-19 * * 1-5`).
- **Vérifiés OK** : `stockValuationModel` (exclut bien checkout-draft), `financierController`, `ordersController`/`reportsController` (liste noire complète), `customerResolver` + `reimportIncompleteOrders` (maintenance/identité, sans impact chiffres).

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
