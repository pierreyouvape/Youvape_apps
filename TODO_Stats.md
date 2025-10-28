# TODO - Application de Statistiques WooCommerce

## 🎯 État du Projet (27/10/2025)

**Phase en cours** : Développement Backend Node.js (Phase 1-2)

**Avancement global :**
- ✅ **Phase 0 : Module WooCommerce** - TERMINÉ (v1.0.2)
- ⏳ **Phase 1 : Base de données & Modèles** - À FAIRE
- ⏳ **Phase 2 : Endpoints réception données** - À FAIRE
- ⏳ **Phase 3-7 : Applications frontend** - En attente

**Prochaine étape :**
Développer un backend Node.js minimal pour recevoir les données du module WC et voir le JSON réel avant de finaliser la structure DB.

---

## 📋 Vue d'ensemble

Développement d'une application de statistiques complète pour récupérer et analyser les commandes WooCommerce (type Metorik).

**Objectifs** :
- **Module WooCommerce** : Plugin WordPress ultra-léger qui surveille et pousse les données
- **Synchro Batch** : Import historique massif (dizaines de milliers d'items)
- **Synchro Live** : Capture temps réel des nouveaux événements (délai 1 min)
- **Stockage complet** : Clients, produits, commandes, coupons dans PostgreSQL
- **Applications de visualisation** : Stats avancées, Clients, Produits

**Architecture globale** :
```
[WooCommerce Site]
    ↓ Module WC (lecture seule, aucune DB custom)
    ↓ HTTP POST par lots de 25
[API Node.js sur VPS séparé]
    ↓ Calculs, stockage, endpoints
[PostgreSQL]
    ↓ Données massives
[Frontend React]
    ↓ Affichage, édition
```

---

## 🔌 Module WooCommerce (nouveau)

### Localisation
```
module_WC/
├── youvape-sync.php              // Plugin principal WordPress
├── includes/
│   ├── class-event-listener.php  // Écoute hooks WC (create/update)
│   ├── class-batch-processor.php // Traitement historique par lots
│   ├── class-api-client.php      // Envoi HTTP vers API Node.js
│   └── class-settings.php        // Interface admin WP
└── admin/
    └── settings-page.php          // Page de configuration
```

### Fonctionnalités

#### 1. Synchro Batch (Import historique)
**Usage** : Une seule fois ou très rarement, pour importer tout l'existant

- **Configuration dans l'admin WP** :
  - Ordre d'import : **Clients → Produits → Commandes** (respect dépendances FK)
  - Nombre d'items par batch : 25 (configurable)
  - Plage horaire optionnelle (ex: 02:00-06:00 pour traiter la nuit)
  - URL de l'API Node.js cible

- **Interface admin** :
  ```
  ┌─ Import Historique ─────────────────────┐
  │ Ordre d'import :                         │
  │  1. [✓] Clients      │ 25 items/batch    │
  │  2. [✓] Produits     │ 25 items/batch    │
  │  3. [✓] Commandes    │ 25 items/batch    │
  │                                          │
  │ Plage horaire (optionnel) :              │
  │  [✓] Activer  De [02:00] à [06:00]      │
  │                                          │
  │ URL API : https://api.youvape.com/sync  │
  │                                          │
  │ [ Lancer l'import historique ]           │
  │                                          │
  │ Statut :                                 │
  │  ● Clients : 2.450 / 10.000 (24%)       │
  │  ○ Produits : 0 / 3.500 (en attente)    │
  │  ○ Commandes : 0 / 45.000 (en attente)  │
  └──────────────────────────────────────────┘
  ```

- **Logique** :
  1. Lit WooCommerce via `wc_get_customers()`, `wc_get_products()`, `wc_get_orders()`
  2. Traite par lots de 25 items
  3. Envoie par HTTP POST à l'API Node.js
  4. Aucune écriture DB WordPress (lecture seule)
  5. Attend la fin d'un type avant de passer au suivant

#### 2. Synchro Live (Temps réel)
**Usage** : Capture les événements du jour (nouveaux clients, produits, commandes)

- **Écoute des hooks WooCommerce** :
  ```php
  add_action('woocommerce_new_order', 'send_order_to_api');
  add_action('woocommerce_update_order', 'send_order_to_api');
  add_action('woocommerce_new_product', 'send_product_to_api');
  add_action('woocommerce_update_product', 'send_product_to_api');
  add_action('user_register', 'send_customer_to_api');
  add_action('profile_update', 'send_customer_to_api');
  ```

- **Délai de 1 minute** : Évite de surcharger le site avec envois immédiats
- **Envoi direct** : Aucune queue locale, envoi HTTP direct vers API Node.js
- **Actions** : `create` et `update` uniquement

#### 3. Configuration
- **Aucune table DB WordPress** : Module totalement indépendant
- **Configuration stockée** : Options WordPress (`wp_options`)
- **Ultra-léger** : Simple proxy HTTP entre WooCommerce et API

---

## 🗄️ Architecture Base de Données

### Tables à créer

#### 1. **orders** (Commandes)
```sql
- order_id (BIGINT, PK)
- order_number (VARCHAR)
- status (VARCHAR) -- completed, processing, cancelled, etc.
- total (DECIMAL) -- Total payé par client
- subtotal (DECIMAL) -- Sous-total produits
- shipping_total (DECIMAL) -- Frais port payés
- shipping_cost_real (DECIMAL) -- Coût réel transport (éditable dans l'app)
- discount_total (DECIMAL) -- Total remises appliquées
- tax_total (DECIMAL)
- payment_method (VARCHAR)
- payment_method_title (VARCHAR)
- currency (VARCHAR)
- date_created (TIMESTAMP)
- date_completed (TIMESTAMP)
- date_modified (TIMESTAMP)
- customer_id (BIGINT, FK -> customers)
- shipping_method (VARCHAR) -- colissimo_international
- shipping_method_title (VARCHAR) -- "Colissimo International"
- shipping_country (VARCHAR) -- Code pays (BE, FR, etc.)
- billing_address (JSONB)
- shipping_address (JSONB)
- customer_note (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 2. **order_items** (Produits commandés)
```sql
- id (SERIAL, PK)
- order_id (BIGINT, FK -> orders)
- product_id (BIGINT, FK -> products)
- product_name (VARCHAR)
- sku (VARCHAR)
- quantity (INTEGER)
- price (DECIMAL) -- Prix unitaire PAYÉ (après promo)
- regular_price (DECIMAL) -- Prix catalogue (sans promo)
- subtotal (DECIMAL) -- quantity × regular_price
- total (DECIMAL) -- quantity × price (avec promo)
- discount (DECIMAL) -- subtotal - total
- cost_price (DECIMAL) -- Coût unitaire (snapshot au moment commande)
- tax (DECIMAL)
- created_at (TIMESTAMP)
```

#### 3. **customers** (Clients)
```sql
- customer_id (BIGINT, PK) -- ID WooCommerce
- email (VARCHAR, UNIQUE)
- first_name (VARCHAR)
- last_name (VARCHAR)
- phone (VARCHAR)
- username (VARCHAR)
- date_created (TIMESTAMP)
- total_spent (DECIMAL)
- order_count (INTEGER)
- billing_address (JSONB)
- shipping_address (JSONB)
- avatar_url (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 4. **products** (Produits)
```sql
- product_id (BIGINT, PK)
- sku (VARCHAR, UNIQUE)
- name (VARCHAR)
- price (DECIMAL)
- regular_price (DECIMAL)
- sale_price (DECIMAL)
- cost_price (DECIMAL) -- Coût d'achat (depuis WC à l'import)
- cost_price_custom (DECIMAL) -- Coût modifiable dans l'app
- cost_price_updated_at (TIMESTAMP) -- Date dernière modif manuelle
- stock_quantity (INTEGER)
- stock_status (VARCHAR)
- category (VARCHAR)
- categories (JSONB) -- tableau des catégories
- date_created (TIMESTAMP)
- date_modified (TIMESTAMP)
- total_sales (INTEGER) -- calculé depuis order_items
- revenue_total (DECIMAL) -- calculé depuis order_items
- image_url (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

#### 5. **order_coupons** (Coupons utilisés)
```sql
- id (SERIAL, PK)
- order_id (BIGINT, FK -> orders)
- code (VARCHAR)
- discount (DECIMAL)
- discount_type (VARCHAR) -- percent, fixed_cart, fixed_product
- created_at (TIMESTAMP)
```

#### 6. **order_sync_log** (Logs de synchronisation)
```sql
- id (SERIAL, PK)
- sync_type (VARCHAR) -- initial, incremental, manual
- status (VARCHAR) -- running, success, error
- last_order_id (BIGINT)
- last_modified_date (TIMESTAMP)
- batch_size (INTEGER)
- orders_synced (INTEGER)
- orders_created (INTEGER)
- orders_updated (INTEGER)
- errors_count (INTEGER)
- error_details (JSONB)
- date_started (TIMESTAMP)
- date_completed (TIMESTAMP)
- duration_seconds (INTEGER)
```

### Index à créer
```sql
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_date_created ON orders(date_created);
CREATE INDEX idx_orders_date_modified ON orders(date_modified);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_shipping_country ON orders(shipping_country);
CREATE INDEX idx_orders_shipping_method_title ON orders(shipping_method_title);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_order_coupons_code ON order_coupons(code);
```

---

## 🔄 API Node.js - Réception des données

### Endpoints de réception (depuis Module WC)

#### POST /api/woo-sync/customers
Reçoit un batch de clients depuis le module WC
```json
{
  "batch": [
    {
      "customer_id": 123,
      "email": "client@example.com",
      "first_name": "John",
      "last_name": "Doe",
      "phone": "+33123456789",
      "username": "johndoe",
      "date_created": "2024-01-15T10:30:00",
      "total_spent": "1250.50",
      "order_count": 15,
      "billing_address": {...},
      "shipping_address": {...},
      "avatar_url": "https://..."
    }
  ],
  "action": "batch_import" // ou "live_update"
}
```

#### POST /api/woo-sync/products
Reçoit un batch de produits depuis le module WC
```json
{
  "batch": [
    {
      "product_id": 456,
      "sku": "ELIQ-FRAISE-50ML",
      "name": "E-liquide Fraise 50ml",
      "price": "12.90",
      "regular_price": "14.90",
      "sale_price": "12.90",
      "cost_price": "5.20", // Si disponible dans WC
      "stock_quantity": 45,
      "stock_status": "instock",
      "category": "E-liquides",
      "categories": [{...}],
      "date_created": "2023-05-10T08:00:00",
      "date_modified": "2025-01-20T14:30:00",
      "image_url": "https://..."
    }
  ],
  "action": "batch_import" // ou "live_update"
}
```

#### POST /api/woo-sync/orders
Reçoit un batch de commandes depuis le module WC
```json
{
  "batch": [
    {
      "order_id": 12345,
      "order_number": "12345",
      "status": "completed",
      "total": "125.90",
      "subtotal": "110.00",
      "shipping_total": "8.50",
      "discount_total": "5.00",
      "tax_total": "12.40",
      "payment_method": "stripe",
      "payment_method_title": "Carte bancaire",
      "currency": "EUR",
      "date_created": "2025-01-22T15:30:00",
      "date_completed": "2025-01-23T10:00:00",
      "date_modified": "2025-01-23T10:00:00",
      "customer_id": 123,
      "shipping_method": "colissimo_international",
      "shipping_method_title": "Colissimo International",
      "shipping_country": "BE",
      "billing_address": {...},
      "shipping_address": {...},
      "customer_note": "Livraison express svp",
      "line_items": [
        {
          "product_id": 456,
          "product_name": "E-liquide Fraise 50ml",
          "sku": "ELIQ-FRAISE-50ML",
          "quantity": 2,
          "price": "12.90",
          "regular_price": "14.90",
          "subtotal": "29.80",
          "total": "25.80",
          "discount": "4.00",
          "tax": "5.16"
        }
      ],
      "coupon_lines": [
        {
          "code": "PROMO10",
          "discount": "5.00",
          "discount_type": "percent"
        }
      ]
    }
  ],
  "action": "batch_import" // ou "live_update"
}
```

### Stratégie d'insertion (Backend Node.js)

#### Pour les clients
```javascript
// Upsert client
INSERT INTO customers (...)
VALUES (...)
ON CONFLICT (customer_id)
DO UPDATE SET
  email = EXCLUDED.email,
  first_name = EXCLUDED.first_name,
  ...
  updated_at = NOW()
```

#### Pour les produits
```javascript
// Upsert produit
INSERT INTO products (...)
VALUES (...)
ON CONFLICT (product_id)
DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  stock_quantity = EXCLUDED.stock_quantity,
  cost_price = EXCLUDED.cost_price,
  // SAUF cost_price_custom qui reste si déjà édité
  updated_at = NOW()
```

#### Pour les commandes
```javascript
// 1. Upsert order
INSERT INTO orders (...) VALUES (...) ON CONFLICT (order_id) DO UPDATE ...

// 2. Delete existing order_items
DELETE FROM order_items WHERE order_id = $1

// 3. Insert new order_items
INSERT INTO order_items (...) VALUES (...)

// 4. Insert coupons
INSERT INTO order_coupons (...) VALUES (...)

// 5. Snapshot cost_price des produits dans order_items
UPDATE order_items
SET cost_price = (SELECT COALESCE(cost_price_custom, cost_price) FROM products WHERE product_id = ...)
WHERE order_id = $1
```

### Configuration sync (table `woo_sync_config`)
```sql
- id (SERIAL, PK)
- batch_size (INTEGER) -- ex: 25
- enabled (BOOLEAN)
- last_sync_date (TIMESTAMP)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

---

## 📊 Applications Frontend

### 1. **App Stats Générales** (`StatsApp.jsx`)

#### Fonctionnalités
- **Dashboard avec KPI** :
  - Chiffre d'affaires total/période
  - Nombre de commandes
  - Panier moyen
  - Marge totale (CA - coûts produits - coûts transport)
  - Taux de marge (%)
  - Manque à gagner (total remises appliquées)

- **Graphiques** :
  - Évolution CA par jour/semaine/mois/année
  - Évolution nombre de commandes
  - Évolution marge brute
  - Top 10 produits (par volume et CA)
  - Top 10 clients (par CA)
  - Top coupons utilisés (avec manque à gagner)

- **Filtres** :
  - Par période (aujourd'hui, 7j, 30j, 90j, année, custom)
  - Par statut de commande
  - Par pays
  - Par transporteur

- **Stats par segmentation** :
  - **Par pays de destination** :
    - Nb commandes, CA, marge
  - **Par transporteur** :
    - Nb commandes, CA
    - Frais facturés vs. coûts réels
    - Marge transport
  - **Par méthode de paiement** :
    - Répartition CA
  - **Par catégorie produit** :
    - CA, volume, marge

- **Stats promotions** :
  - Total remises appliquées (manque à gagner)
  - Top coupons utilisés
  - Impact sur le panier moyen

- **Exemple de requête avancée** :
  - "Toutes les commandes Colissimo International vers Belgique"
  - Affichage : CA total, marge totale, nb commandes, panier moyen

### 2. **App Clients** (`CustomersApp.jsx`)

#### Fonctionnalités
- **Recherche client** :
  - Par email, nom, prénom, ID
  - Liste paginée avec filtres
- **Fiche client** :
  - Informations personnelles
  - Adresses (facturation, livraison)
  - Stats client :
    - Total dépensé
    - Nombre de commandes
    - Panier moyen
    - Date première/dernière commande
  - **Historique complet des commandes** :
    - Liste triée par date (plus récent en haut)
    - Détails : numéro, date, montant, statut, produits
    - Filtres par statut, période
  - **Produits favoris** :
    - Top produits achetés (par quantité)
    - Fréquence d'achat
  - **Coupons utilisés**

### 3. **App Produits** (`ProductsApp.jsx`)

#### Fonctionnalités
- **Liste produits** :
  - Tableau avec filtres (catégorie, stock, SKU)
  - Recherche par nom, SKU
  - Tri par ventes, CA, stock, marge
  - Colonnes : Nom, SKU, Prix vente, Coût, Marge unitaire, Stock, Total ventes

- **Fiche produit** :
  - **Informations produit** :
    - Nom, prix, SKU, stock
    - Prix vente : 12,90 €
    - Coût d'achat WC : 4,50 €
    - **✏️ Coût réel éditable** : [5,20 €] 💾 Sauver
    - Marge unitaire : 7,70 € (59%)

  - **Stats produit** :
    - Total ventes (quantité)
    - Revenu total généré
    - Marge totale (avec coût réel)
    - Prix moyen de vente
    - Stock actuel vs. ventes

  - **Historique des ventes** :
    - Graphique d'évolution (quantité/CA/marge)
    - Par période

  - **Clients ayant acheté** :
    - Liste des clients
    - Quantité totale par client
    - CA généré par client

  - **Commandes contenant ce produit** :
    - Liste des commandes avec détails
    - Prix payé (avec/sans promo)

---

## 🛠️ Architecture Technique

### Module WooCommerce (PHP)

```
module_WC/
├── youvape-sync.php              # Plugin principal WordPress
├── includes/
│   ├── class-event-listener.php  # Écoute hooks WC (create/update)
│   ├── class-batch-processor.php # Traitement historique par lots
│   ├── class-api-client.php      # Envoi HTTP vers API Node.js
│   └── class-settings.php        # Interface admin WP
└── admin/
    └── settings-page.php          # Page de configuration
```

### Backend (Node.js + Express)

**Architecture** : Backend calcule tout, Frontend affiche (comme EmailApp existante)

```
backend/src/
├── services/
│   ├── wooSyncService.js         # Réception données depuis Module WC
│   ├── statsService.js           # Calculs statistiques (marges, CA, etc.)
│   ├── customerService.js        # Logique clients
│   └── productService.js         # Logique produits + édition coûts
│
├── models/
│   ├── ordersModel.js            # CRUD orders
│   ├── orderItemsModel.js        # CRUD order_items
│   ├── customersModel.js         # CRUD customers
│   ├── productsModel.js          # CRUD products (avec cost_price_custom)
│   ├── orderCouponsModel.js      # CRUD order_coupons
│   ├── wooSyncConfigModel.js     # Config sync
│   └── orderSyncLogModel.js      # Logs sync
│
├── controllers/
│   ├── wooSyncController.js      # POST /api/woo-sync/customers|products|orders
│   ├── statsController.js        # GET /api/stats/revenue, /marges, etc.
│   ├── customersController.js    # GET /api/customers, GET /api/customers/:id
│   └── productsController.js     # GET /api/products, PUT /api/products/:id/cost
│
└── routes/
    ├── wooSyncRoutes.js
    ├── statsRoutes.js
    ├── customersRoutes.js
    └── productsRoutes.js
```

**Exemples d'endpoints Backend** :
```javascript
// Stats
GET /api/stats/revenue?period=30d
GET /api/stats/margins?period=30d
GET /api/stats/shipping?country=BE&method=colissimo_international
GET /api/stats/coupons?period=30d

// Produits
GET /api/products
GET /api/products/:id
PUT /api/products/:id/cost  // Éditer cost_price_custom
GET /api/products/:id/sales-history

// Commandes
GET /api/orders
GET /api/orders/:id
PUT /api/orders/:id/shipping-cost  // Éditer shipping_cost_real
```

### Frontend (React)

```
frontend/src/
├── pages/
│   ├── StatsApp.jsx              # Dashboard stats
│   ├── CustomersApp.jsx          # Gestion clients
│   ├── CustomerDetailApp.jsx    # Fiche client détaillée
│   ├── ProductsApp.jsx           # Gestion produits
│   ├── ProductDetailApp.jsx     # Fiche produit détaillée
│   └── WooSyncApp.jsx           # Config & logs sync
│
└── components/
    ├── Charts/
    │   ├── LineChart.jsx
    │   ├── BarChart.jsx
    │   └── PieChart.jsx
    ├── Tables/
    │   ├── OrdersTable.jsx
    │   ├── CustomersTable.jsx
    │   └── ProductsTable.jsx
    └── Stats/
        ├── KPICard.jsx
        └── StatCard.jsx
```

---

## 📦 Tâches de Développement

### Phase 0 : Module WooCommerce ✅ TERMINÉ (27/10/2025)
- [x] Créer structure plugin WordPress (`youvape-sync.php`)
- [x] Implémenter `class-api-client.php` (envoi HTTP vers API Node.js)
- [x] Implémenter `class-batch-processor.php` (lecture WC par lots de 25)
  - [x] Clients : `wc_get_customers()`
  - [x] Produits : `wc_get_products()`
  - [x] Commandes : `wc_get_orders()`
- [x] Implémenter `class-event-listener.php` (hooks WC pour synchro live)
  - [x] Hook `woocommerce_new_order` / `woocommerce_update_order`
  - [x] Hook `woocommerce_new_product` / `woocommerce_update_product`
  - [x] Hook `user_register` / `profile_update`
  - [x] Délai de 1 minute avant envoi
- [x] Implémenter `class-settings.php` + `settings-page.php` (interface admin WP)
  - [x] Configuration ordre d'import (Clients → Produits → Commandes)
  - [x] Configuration batch size (25)
  - [x] Configuration plage horaire optionnelle
  - [x] URL API Node.js
  - [x] Bouton "Lancer import historique"
  - [x] Affichage statut import (progression)
- [x] **BONUS** : Fonction test échantillon (v1.0.2)
  - [x] Interface pour envoyer X clients/produits/commandes
  - [x] Affichage JSON envoyé
  - [x] Parfait pour tester le backend !

**📦 Livrables :**
- `youvape-sync.zip` (40 KB) - Version 1.0.2
- Plugin installable via WordPress Admin
- Installé et testé sur préprod Youvape
- Documentation complète (README, INSTALLATION, CHANGELOG)

**🐛 Corrections apportées :**
- v1.0.1 : Fix comptage commandes (HPOS support)
- v1.0.2 : Ajout fonction test échantillon

**🎯 État actuel :**
- ✅ Module WC opérationnel
- ✅ Détecte : 48 901 clients, 2 651 produits, X commandes
- ✅ Prêt à envoyer vers API Node.js
- ⏳ API Node.js à développer (Phase 1-2)

### Phase 1 : Base de données & Modèles Backend (2 jours)
- [ ] Créer migrations SQL pour toutes les tables enrichies
  - [ ] Table `orders` (avec `shipping_cost_real`, `shipping_country`, etc.)
  - [ ] Table `order_items` (avec `cost_price`, `regular_price`, etc.)
  - [ ] Table `products` (avec `cost_price`, `cost_price_custom`)
  - [ ] Table `customers`
  - [ ] Table `order_coupons`
  - [ ] Table `order_sync_log`
- [ ] Créer les index nécessaires (pays, transporteur, dates)
- [ ] Créer les modèles Node.js (CRUD)
- [ ] Tester les modèles

### Phase 2 : Endpoints réception données (2-3 jours)
- [ ] Créer `wooSyncController.js`
  - [ ] POST `/api/woo-sync/customers` (réception batch clients)
  - [ ] POST `/api/woo-sync/products` (réception batch produits)
  - [ ] POST `/api/woo-sync/orders` (réception batch commandes)
- [ ] Implémenter logique upsert dans `wooSyncService.js`
  - [ ] Upsert customers (ON CONFLICT customer_id)
  - [ ] Upsert products (préserver `cost_price_custom` si édité)
  - [ ] Upsert orders + order_items + coupons
  - [ ] Snapshot `cost_price` dans `order_items`
- [ ] Gérer les erreurs & retry logic
- [ ] Créer logs de sync détaillés (`order_sync_log`)
- [ ] Tester avec données du module WC

### Phase 3 : App Stats avec marges (3-4 jours)
- [ ] Créer `statsService.js` avec calculs avancés
  - [ ] Calcul marge par commande (total - coûts produits - coûts transport)
  - [ ] Calcul manque à gagner (total remises)
  - [ ] Stats par pays/transporteur/méthode paiement
- [ ] Créer endpoints API stats
  - [ ] GET `/api/stats/revenue?period=30d`
  - [ ] GET `/api/stats/margins?period=30d`
  - [ ] GET `/api/stats/shipping?country=BE&method=colissimo`
  - [ ] GET `/api/stats/coupons?period=30d`
- [ ] Créer `StatsApp.jsx` avec dashboard
- [ ] Implémenter KPI cards (CA, commandes, panier moyen, marge, manque à gagner)
- [ ] Implémenter graphiques (Chart.js ou Recharts)
- [ ] Implémenter filtres par période/pays/transporteur
- [ ] Implémenter top produits/clients/coupons

### Phase 4 : App Clients (2 jours)
- [ ] Créer `customerService.js`
- [ ] Créer endpoints API clients
- [ ] Créer `CustomersApp.jsx` avec recherche
- [ ] Créer `CustomerDetailApp.jsx` avec fiche complète
- [ ] Implémenter historique des commandes
- [ ] Implémenter stats client
- [ ] Implémenter produits favoris

### Phase 5 : App Produits avec édition coûts (2-3 jours)
- [ ] Créer `productService.js`
- [ ] Créer endpoints API produits
  - [ ] GET `/api/products`
  - [ ] GET `/api/products/:id`
  - [ ] PUT `/api/products/:id/cost` (éditer `cost_price_custom`)
- [ ] Créer `ProductsApp.jsx` avec liste
- [ ] Créer `ProductDetailApp.jsx` avec fiche complète
  - [ ] Affichage coût WC vs. coût réel
  - [ ] Interface édition coût réel
  - [ ] Calcul marge unitaire dynamique
- [ ] Implémenter historique des ventes (graphique)
- [ ] Implémenter liste clients ayant acheté
- [ ] Implémenter liste commandes contenant le produit

### Phase 6 : Édition commandes (1 jour)
- [ ] Endpoint PUT `/api/orders/:id/shipping-cost` (éditer `shipping_cost_real`)
- [ ] Interface édition dans fiche commande
- [ ] Recalcul marge après édition

### Phase 7 : App Config Sync (1 jour)
- [ ] Créer `WooSyncApp.jsx` pour monitoring
- [ ] Afficher logs de sync (succès, erreurs)
- [ ] Statistiques import (nb clients/produits/commandes importés)
- [ ] Export logs en CSV

---

## ⚠️ Points d'attention

### Performance
- Indexer toutes les FK et champs de date
- Utiliser des requêtes optimisées (JOIN, GROUP BY)
- Mettre en cache les stats lourdes si nécessaire (Redis)
- Paginer les résultats (50-100 items max par page)

### Module WooCommerce
- **Aucune DB WordPress** : Utiliser uniquement `wp_options` pour config
- **Lecture seule** : Aucune modification des données WooCommerce
- **Batch size** : 25 items max par envoi HTTP (configurable)
- **Plage horaire** : Respecter les plages configurées pour import historique
- **Délai live** : 1 minute entre événement WC et envoi API
- **Ordre d'import** : Toujours Clients → Produits → Commandes (dépendances FK)
- **Gestion erreurs** : Logger les échecs d'envoi HTTP, retry 3x avec backoff

### Volumes de données
- **10k commandes/mois** : OK avec PostgreSQL standard
- **100k+ commandes/mois** : considérer partitionnement de tables par date
- **Millions de commandes** : utiliser des vues matérialisées pour stats

### Sécurité
- Stocker les credentials WooCommerce chiffrés (ou variables d'environnement)
- Protéger les routes API avec JWT
- Valider tous les inputs utilisateur
- Logs sensibles (ne pas logger les credentials)

---

## 📈 Estimation Totale

**Développement** : ~15-19 jours
- Phase 0 (Module WC) : 3-4 jours
- Phase 1 (DB & Modèles) : 2 jours
- Phase 2 (Endpoints réception) : 2-3 jours
- Phase 3 (App Stats) : 3-4 jours
- Phase 4 (App Clients) : 2 jours
- Phase 5 (App Produits) : 2-3 jours
- Phase 6 (Édition commandes) : 1 jour
- Phase 7 (App Config Sync) : 1 jour

**Tests & Debug** : +3-4 jours

**Total** : ~18-23 jours

---

## 🚀 Prochaines étapes

1. **Valider l'architecture** avec l'équipe dev
2. **Commencer par le Module WooCommerce** (Phase 0)
   - Développer le plugin WordPress
   - Tester envoi de données vers API Node.js locale
3. **Créer la base de données PostgreSQL** (Phase 1)
   - Migrations SQL avec champs enrichis (coûts, marges, transporteurs)
4. **Développer les endpoints de réception** (Phase 2)
   - Tester réception batch depuis Module WC
5. **Itérer sur les apps frontend** par ordre de priorité
   - Stats → Produits → Clients

---

## 📝 Récapitulatif des décisions clés

### Architecture
- **Module WC** : Ultra-léger, aucune DB custom, lecture seule WooCommerce
- **Synchro Batch** : Import historique massif, lots de 25, plages horaires configurables
- **Synchro Live** : Temps réel avec délai 1 min, hooks WooCommerce natifs
- **Backend Node.js** : Calcule tout (marges, stats, agrégations SQL)
- **Frontend React** : Affiche et permet édition (coûts produits, frais transport)

### Données enrichies
- **Produits** : `cost_price` (WC) + `cost_price_custom` (éditable app)
- **Commandes** : `shipping_cost_real` (éditable), `shipping_country`, `shipping_method_title`
- **Order items** : `price` (payé) + `regular_price` (catalogue) + `cost_price` (snapshot)
- **Transporteurs** : Récupérés dynamiquement depuis commandes (pas d'import séparé)

### Ordre d'import
1. **Clients** (aucune dépendance)
2. **Produits** (aucune dépendance)
3. **Commandes** (dépend de clients + produits)

### Stats avancées
- Marge par commande : `total - (coûts produits + coûts transport)`
- Manque à gagner : `SUM(discount_total)`
- Stats par transporteur × pays : CA, marges, frais facturés vs. réels
- Exemple : "Toutes commandes Colissimo International → Belgique"

---

*Document créé le 21/10/2025*
*Dernière mise à jour : 25/10/2025*
