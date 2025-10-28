# 📊 Implémentation Application Stats WooCommerce

**Date**: 28/10/2025
**Statut**: Backend complet ✅ | Frontend dashboard de base ✅

---

## 🎯 Ce qui a été créé

### **Backend (Node.js + Express + PostgreSQL)**

#### **1. Models** (Accès base de données)
- ✅ [customerModel.js](backend/src/models/customerModel.js) - CRUD clients + stats
- ✅ [productModel.js](backend/src/models/productModel.js) - CRUD produits + ventes
- ✅ [orderModel.js](backend/src/models/orderModel.js) - CRUD commandes avec relations

#### **2. Services** (Logique métier)
- ✅ [statsService.js](backend/src/services/statsService.js) - **Calculs KPI avancés**
  - Dashboard KPIs (CA, marge, panier moyen, clients uniques)
  - Évolution CA par période (heure, jour, semaine, mois, année)
  - Top produits (par CA ou volume)
  - Top clients
  - Stats par pays, transporteur, méthode paiement, catégorie
  - Top coupons
  - Comparaison entre périodes

- ✅ [advancedFilterService.js](backend/src/services/advancedFilterService.js) - **Filtres croisés AND/OR/EXCLUDE**
  - Recherche clients avec filtres multiples
  - Recherche commandes avec filtres multiples
  - Produits liés (achetés ensemble)
  - Exemple complexe : "Clients ayant acheté X ET Y mais PAS Z"

#### **3. Controllers** (Endpoints HTTP)
- ✅ [statsController.js](backend/src/controllers/statsController.js)
- ✅ [customersController.js](backend/src/controllers/customersController.js)
- ✅ [productsController.js](backend/src/controllers/productsController.js)
- ✅ [ordersController.js](backend/src/controllers/ordersController.js)

#### **4. Routes**
- ✅ [statsRoutes.js](backend/src/routes/statsRoutes.js)
- ✅ [customersRoutes.js](backend/src/routes/customersRoutes.js)
- ✅ [productsRoutes.js](backend/src/routes/productsRoutes.js)
- ✅ [ordersRoutes.js](backend/src/routes/ordersRoutes.js)

#### **5. Configuration**
- ✅ Routes ajoutées dans [server.js](backend/src/server.js)

---

### **Frontend (React + Vite)**

#### **1. Composants réutilisables**
- ✅ [KPICard.jsx](frontend/src/components/stats/KPICard.jsx) - Carte KPI avec icône, valeur, trend
- ✅ [PeriodFilter.jsx](frontend/src/components/filters/PeriodFilter.jsx) - Filtre de période

#### **2. Pages**
- ✅ [StatsApp_new.jsx](frontend/src/pages/StatsApp_new.jsx) - **Dashboard complet**
  - KPI cards (CA, Marge, Panier moyen, Clients, Manque à gagner)
  - Top 5 Produits
  - Top 5 Clients
  - Stats par pays
  - Top 5 Coupons
  - Filtre par période

---

## 🔌 API Endpoints disponibles

### **Stats & KPIs**
```
GET /api/stats/dashboard?period=30d&status=completed
GET /api/stats/revenue-evolution?groupBy=day&period=30d
GET /api/stats/top-products?limit=10&sortBy=revenue
GET /api/stats/top-customers?limit=10
GET /api/stats/by-country?period=30d
GET /api/stats/by-shipping-method?period=30d
GET /api/stats/by-payment-method?period=30d
GET /api/stats/by-category?period=30d
GET /api/stats/top-coupons?limit=10
GET /api/stats/by-status
GET /api/stats/comparison?current=30d&previous=60d
```

### **Clients**
```
GET /api/customers?limit=50&offset=0
GET /api/customers/search?q=john
POST /api/customers/advanced-search
    Body: {
      products: { operator: 'AND', product_ids: [123, 456] },
      exclude: { product_ids: [789] },
      search: 'john',
      total_spent: { min: 100, max: 1000 }
    }
GET /api/customers/:id
GET /api/customers/:id/orders
GET /api/customers/:id/favorite-products
GET /api/customers/:id/stats
```

### **Produits**
```
GET /api/products?limit=50&offset=0
GET /api/products/search?q=fraise
GET /api/products/categories/list
GET /api/products/category/:category
GET /api/products/:id
GET /api/products/:id/sales-history
GET /api/products/:id/customers
GET /api/products/:id/related
PUT /api/products/:id/cost
    Body: { cost_price_custom: 5.20 }
```

### **Commandes**
```
GET /api/orders?limit=50&offset=0
GET /api/orders/search?q=12345
POST /api/orders/advanced-search
    Body: {
      products: { operator: 'AND', product_ids: [123, 456] },
      status: 'completed',
      country: 'FR',
      total: { min: 50, max: 500 }
    }
GET /api/orders/statuses/list
GET /api/orders/countries/list
GET /api/orders/status/:status
GET /api/orders/country/:country
GET /api/orders/:id
PUT /api/orders/:id/shipping-cost
    Body: { shipping_cost_real: 8.50 }
```

---

## 🎨 Filtres croisés - Exemples d'utilisation

### **Clients ayant acheté produit X ET Y**
```javascript
POST /api/customers/advanced-search
{
  "products": {
    "operator": "AND",
    "product_ids": [123, 456]
  }
}
```

### **Clients ayant acheté X OU Y (ou les deux)**
```javascript
POST /api/customers/advanced-search
{
  "products": {
    "operator": "OR",
    "product_ids": [123, 456]
  }
}
```

### **Clients ayant acheté X mais PAS Y**
```javascript
POST /api/customers/advanced-search
{
  "products": {
    "operator": "AND",
    "product_ids": [123]
  },
  "exclude": {
    "product_ids": [456]
  }
}
```

### **Commandes contenant X ET Y mais PAS Z, en France, complétées**
```javascript
POST /api/orders/advanced-search
{
  "products": {
    "operator": "AND",
    "product_ids": [123, 456]
  },
  "exclude": {
    "product_ids": [789]
  },
  "country": "FR",
  "status": "completed"
}
```

---

## 📦 Ce qu'il reste à faire (optionnel)

### **Frontend - Pages avancées**
- [ ] `CustomersApp.jsx` - Liste clients avec recherche avancée
- [ ] `CustomerDetail.jsx` - Fiche client détaillée (historique, favoris)
- [ ] `ProductsApp.jsx` - Liste produits avec filtres
- [ ] `ProductDetail.jsx` - Fiche produit (édition coût, historique ventes)
- [ ] `OrdersApp.jsx` - Liste commandes avec filtres
- [ ] `OrderDetail.jsx` - Fiche commande détaillée

### **Frontend - Composants**
- [ ] `AdvancedFilter.jsx` - Interface filtres croisés (sélection produits multiple, AND/OR/EXCLUDE)
- [ ] `RevenueChart.jsx` - Graphique évolution CA (Chart.js ou Recharts)
- [ ] `CustomersTable.jsx`, `ProductsTable.jsx`, `OrdersTable.jsx` - Tableaux réutilisables

### **Backend - Améliorations**
- [ ] Pagination avancée pour tous les endpoints
- [ ] Export CSV/Excel des résultats
- [ ] Cache Redis pour stats lourdes
- [ ] Webhooks pour notifications

---

## 🚀 Comment utiliser le nouveau dashboard

### **1. Remplacer l'ancien StatsApp**
```bash
# Renommer l'ancien
mv frontend/src/pages/StatsApp.jsx frontend/src/pages/StatsApp_old.jsx

# Renommer le nouveau
mv frontend/src/pages/StatsApp_new.jsx frontend/src/pages/StatsApp.jsx
```

### **2. Installer les dépendances (si nécessaire)**
```bash
cd frontend
npm install prop-types
```

### **3. Redémarrer le backend**
```bash
cd backend
node src/server.js
```

### **4. Tester l'API**
```bash
# Dashboard KPIs
curl "http://localhost:3000/api/stats/dashboard?period=30d&status=completed"

# Top produits
curl "http://localhost:3000/api/stats/top-products?limit=5&sortBy=revenue&period=30d"

# Recherche avancée clients
curl -X POST http://localhost:3000/api/customers/advanced-search \
  -H "Content-Type: application/json" \
  -d '{"products":{"operator":"AND","product_ids":[123,456]}}'
```

---

## 📊 Structure des données retournées

### **Dashboard KPIs**
```json
{
  "total_orders": 1250,
  "unique_customers": 450,
  "total_revenue": "125000.50",
  "avg_order_value": "100.00",
  "total_discounts": "5000.00",
  "total_shipping_charged": "8500.00",
  "total_shipping_real_cost": "7200.00",
  "total_tax": "21000.00",
  "total_products_cost": "65000.00",
  "gross_margin": "52800.50",
  "gross_margin_percent": 42.24,
  "missed_revenue": "5000.00"
}
```

### **Top Products**
```json
[
  {
    "product_id": 456,
    "name": "E-liquide Fraise 50ml",
    "sku": "ELIQ-FRAISE-50ML",
    "total_quantity": 520,
    "total_revenue": "6708.00",
    "total_cost": "2704.00",
    "margin": 4004.00,
    "margin_percent": 59.68
  }
]
```

---

## 🔑 Points clés de l'architecture

### **Calcul des marges**
```
Marge brute = CA total - Coûts produits - Coûts transport réels
```

Le backend utilise `COALESCE(cost_price_custom, cost_price)` pour prendre en compte :
1. Le coût personnalisé (éditable dans l'app) si défini
2. Sinon le coût WooCommerce

### **Filtres dynamiques**
Le `statsService._buildWhereConditions()` construit dynamiquement les clauses SQL WHERE en fonction des filtres passés :
- `period` : période relative (7d, 30d, 1y)
- `startDate` / `endDate` : plage custom
- `status`, `country`, `shippingMethod`, `paymentMethod`

### **Filtres croisés AND/OR**
Le `advancedFilterService` utilise :
- `EXISTS` pour les conditions AND (client a acheté X ET Y)
- `IN` / `ANY` pour les conditions OR (client a acheté X OU Y)
- `NOT EXISTS` pour les exclusions (client n'a PAS acheté Z)

---

## 📝 Notes importantes

1. **Performance** : Les index sont déjà en place sur `order_items.product_id`, `orders.customer_id`, etc.
2. **Snapshot des coûts** : Les `order_items.cost_price` sont figés au moment de la commande (historique)
3. **Édition coûts** : Modifier `products.cost_price_custom` ne change PAS les commandes passées
4. **Statut completed** : La plupart des stats filtrent sur `status = 'completed'` pour exclure les commandes en cours/annulées

---

## 🧪 Pour tester avec des données réelles

1. Depuis WordPress, allez dans **WooCommerce → YouVape Sync**
2. Onglet **Test**, envoyez un échantillon (ex: 10-10-10)
3. Les données sont insérées en BDD via les endpoints `/api/sync/*`
4. Testez l'API stats : `curl "http://localhost:3000/api/stats/dashboard?period=30d"`
5. Ouvrez le frontend : `http://localhost:5173/stats` (après avoir renommé StatsApp_new.jsx)

---

*Document généré le 28/10/2025*
