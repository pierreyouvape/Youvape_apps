# 📚 Guide d'Utilisation - Application Stats WooCommerce

**Date**: 28/10/2025
**Statut**: ✅ **COMPLET - Prêt à l'emploi**

---

## ✅ Ce qui a été créé

### **Backend complet** (11 fichiers)

#### Models (3)
- [customerModel.js](backend/src/models/customerModel.js)
- [productModel.js](backend/src/models/productModel.js)
- [orderModel.js](backend/src/models/orderModel.js)

#### Services (2)
- [statsService.js](backend/src/services/statsService.js) - 11 méthodes de calculs
- [advancedFilterService.js](backend/src/services/advancedFilterService.js) - **Filtres croisés AND/OR/EXCLUDE**

#### Controllers (4)
- [statsController.js](backend/src/controllers/statsController.js)
- [customersController.js](backend/src/controllers/customersController.js)
- [productsController.js](backend/src/controllers/productsController.js)
- [ordersController.js](backend/src/controllers/ordersController.js)

#### Routes (4)
- [statsRoutes.js](backend/src/routes/statsRoutes.js)
- [customersRoutes.js](backend/src/routes/customersRoutes.js)
- [productsRoutes.js](backend/src/routes/productsRoutes.js)
- [ordersRoutes.js](backend/src/routes/ordersRoutes.js)

### **Frontend complet** (10 fichiers)

#### Composants (2)
- [KPICard.jsx](frontend/src/components/stats/KPICard.jsx)
- [PeriodFilter.jsx](frontend/src/components/filters/PeriodFilter.jsx)

#### Pages (8)
- ✅ [StatsApp.jsx](frontend/src/pages/StatsApp.jsx) - **Dashboard remplacé**
- ✅ [CustomersApp.jsx](frontend/src/pages/CustomersApp.jsx) - Liste + recherche clients
- ✅ [CustomerDetail.jsx](frontend/src/pages/CustomerDetail.jsx) - Fiche client détaillée
- ✅ [ProductsApp.jsx](frontend/src/pages/ProductsApp.jsx) - Liste + recherche produits
- ✅ [ProductDetail.jsx](frontend/src/pages/ProductDetail.jsx) - Fiche produit + édition coûts
- ✅ [OrdersApp.jsx](frontend/src/pages/OrdersApp.jsx) - Liste + recherche commandes
- ✅ [OrderDetail.jsx](frontend/src/pages/OrderDetail.jsx) - Fiche commande détaillée
- ✅ [App.jsx](frontend/src/App.jsx) - **Routes ajoutées**

---

## 🚀 Comment démarrer

### **1. Sur le VPS (Backend)**

Le backend est déjà configuré et tourne. Les nouvelles routes sont disponibles :

```bash
# Vérifier que le backend fonctionne
curl http://VOTRE_VPS:3000/api/health

# Tester le dashboard
curl "http://VOTRE_VPS:3000/api/stats/dashboard?period=30d&status=completed"
```

### **2. En local (Frontend - si besoin de rebuild)**

```bash
cd frontend

# Installer les dépendances (si nécessaire)
npm install prop-types

# Rebuild le frontend
npm run build

# Copier le build vers le VPS (si nécessaire)
# scp -r dist/* user@VPS:/path/to/frontend/
```

---

## 📱 Navigation de l'application

### **Menu principal** (depuis `/home`)

```
🏠 Home
├─ 📊 Stats          → /stats
├─ 👥 Clients        → /customers
├─ 📦 Produits       → /products
└─ 🛒 Commandes      → /orders
```

### **URLs disponibles**

```
/stats                    Dashboard KPI
/customers                Liste clients
/customers/123            Fiche client
/products                 Liste produits
/products/456             Fiche produit + édition coût
/orders                   Liste commandes
/orders/789               Fiche commande détaillée
```

---

## 🔍 Fonctionnalités principales

### **Dashboard Stats** (`/stats`)
- **5 KPI Cards** : CA, Marge, Panier moyen, Clients uniques, Manque à gagner
- **Top 5 Produits** (par CA)
- **Top 5 Clients** (par dépense totale)
- **Stats par Pays**
- **Top 5 Coupons** (avec manque à gagner)
- **Filtre par période** : Aujourd'hui, 7j, 30j, 90j, 1 an, Tout

### **Clients** (`/customers`)
- **Recherche** par nom, email
- **Liste paginée** avec total dépensé, nb commandes, dernière commande
- **Clic sur un client** → Fiche détaillée

### **Fiche Client** (`/customers/:id`)
- **Informations** : Email, téléphone, inscription
- **Stats** : Commandes, Total dépensé, Panier moyen, Produits différents
- **Historique commandes** (20 dernières, cliquables)
- **Produits favoris** (top 10 par quantité achetée)

### **Produits** (`/products`)
- **Recherche** par nom, SKU
- **Filtre par catégorie**
- **Tableau** : Nom, Catégorie, Prix, Coût, Marge unit., Stock, CA Total
- **Clic sur un produit** → Fiche détaillée

### **Fiche Produit** (`/products/:id`)
- **Informations** : SKU, Catégorie, Prix, Stock
- **Gestion coûts** :
  - Coût WooCommerce (lecture seule)
  - **✏️ Coût personnalisé** (éditable) → Sauvegarde instantanée
  - Marge unitaire recalculée automatiquement
- **Stats** : Quantité vendue, CA Total, Nb commandes
- **Historique ventes** (20 dernières)
- **Clients ayant acheté** (top 10)
- **Produits liés** (achetés ensemble)

### **Commandes** (`/orders`)
- **Recherche** par n° commande, email client
- **Filtres** : Statut, Pays
- **Tableau** : N° commande, Client, Statut, Total, Date, Pays
- **Clic sur une commande** → Fiche détaillée

### **Fiche Commande** (`/orders/:id`)
- **Entête** : N° commande, Statut, Date création/complétion, Méthode paiement
- **Client** : Nom, Email, Téléphone + Lien vers fiche client
- **Livraison** : Méthode, Pays, Adresse complète
- **Articles** : Liste détaillée avec prix unitaire, quantité, total
- **Totaux** : Sous-total, Livraison, Remise, TVA, **Total**
- **📊 Analyse marge** : Coût produits, Coût livraison, **Marge brute**

---

## 🎨 Filtres croisés - Mode d'emploi

### **Exemple 1 : Clients ayant acheté produit 123 ET 456**

```javascript
// Frontend → Backend
POST /api/customers/advanced-search
{
  "products": {
    "operator": "AND",
    "product_ids": [123, 456]
  }
}
```

**Résultat** : Tous les clients ayant acheté les DEUX produits.

### **Exemple 2 : Clients ayant acheté 123 OU 456**

```javascript
POST /api/customers/advanced-search
{
  "products": {
    "operator": "OR",
    "product_ids": [123, 456]
  }
}
```

**Résultat** : Tous les clients ayant acheté AU MOINS UN des deux.

### **Exemple 3 : Clients ayant acheté 123 mais PAS 456**

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

**Résultat** : Clients ayant acheté 123 mais jamais 456.

### **Exemple 4 : Commandes avec filtres multiples**

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
  "status": "completed",
  "total": { "min": 50, "max": 500 }
}
```

**Résultat** : Commandes en France, complétées, entre 50€ et 500€, contenant 123 ET 456 mais PAS 789.

---

## 🔧 Édition de données

### **Éditer le coût d'un produit**

1. Aller sur `/products/456`
2. Section **💰 Gestion des coûts**
3. Cliquer sur **✏️ Modifier** à côté de "Coût personnalisé"
4. Entrer le nouveau coût (ex: 5.20)
5. Cliquer sur **💾 Sauver**
6. ✅ La marge unitaire se recalcule automatiquement

**⚠️ Important** : Cela ne modifie PAS les commandes passées (snapshot historique).

### **Éditer le coût réel de livraison** (API disponible)

```javascript
PUT /api/orders/789/shipping-cost
{
  "shipping_cost_real": 8.50
}
```

Le calcul de marge dans la fiche commande utilise ce coût réel.

---

## 📊 API Endpoints - Résumé

### **Stats**
```
GET /api/stats/dashboard?period=30d&status=completed
GET /api/stats/top-products?limit=5&sortBy=revenue
GET /api/stats/top-customers?limit=5
GET /api/stats/by-country
GET /api/stats/by-shipping-method
GET /api/stats/top-coupons?limit=5
```

### **Clients**
```
GET /api/customers
GET /api/customers/search?q=john
POST /api/customers/advanced-search (filtres croisés)
GET /api/customers/123
GET /api/customers/123/orders
GET /api/customers/123/favorite-products
GET /api/customers/123/stats
```

### **Produits**
```
GET /api/products
GET /api/products/search?q=fraise
GET /api/products/categories/list
GET /api/products/category/E-liquides
GET /api/products/456
GET /api/products/456/sales-history
GET /api/products/456/customers
GET /api/products/456/related
PUT /api/products/456/cost (édition coût)
```

### **Commandes**
```
GET /api/orders
GET /api/orders/search?q=12345
POST /api/orders/advanced-search (filtres croisés)
GET /api/orders/statuses/list
GET /api/orders/countries/list
GET /api/orders/status/completed
GET /api/orders/country/FR
GET /api/orders/789
PUT /api/orders/789/shipping-cost (édition coût livraison)
```

---

## 🧪 Tester avec vos 5 données

Vous avez déjà 5 clients, 5 produits, 5 commandes en BDD.

### **Test 1 : Dashboard**
```
http://VOTRE_VPS/stats
```
Vous devriez voir les KPI calculés sur vos 5 commandes.

### **Test 2 : Liste clients**
```
http://VOTRE_VPS/customers
```
Vous devriez voir vos 5 clients avec leur total dépensé.

### **Test 3 : Fiche client**
Cliquer sur un client → Voir ses commandes, produits favoris.

### **Test 4 : Fiche produit + Édition coût**
```
http://VOTRE_VPS/products/[ID_PRODUIT]
```
Essayer de modifier le coût personnalisé → Voir la marge se recalculer.

### **Test 5 : Fiche commande avec analyse marge**
```
http://VOTRE_VPS/orders/[ID_COMMANDE]
```
Voir la décomposition : CA - Coûts produits - Coûts livraison = Marge brute.

---

## 🎯 Prochaines améliorations possibles

- [ ] **Interface filtres croisés** : Composant `AdvancedFilter.jsx` avec sélection produits multiple + opérateurs AND/OR/EXCLUDE
- [ ] **Graphiques** : Évolution CA (Chart.js ou Recharts)
- [ ] **Export CSV/Excel** : Pour tous les tableaux
- [ ] **Pagination avancée** : Navigation page par page
- [ ] **Notifications temps réel** : Nouvelle commande (WebSocket)
- [ ] **Logs d'audit** : Traçabilité des modifications de coûts

---

## 📝 Notes importantes

1. **L'API sync existante** (`POST /api/sync/*`) a été conservée et fonctionne toujours.
2. **Les coûts des commandes passées** ne changent jamais (snapshot historique).
3. **Le module WC** envoie déjà les données vers le backend, tout fonctionne.
4. **Toutes les pages** sont protégées par authentification (PrivateRoute).
5. **Les filtres croisés** sont disponibles via API (`POST /api/customers/advanced-search` et `/api/orders/advanced-search`).

---

## 🐛 Dépannage

### **Erreur : "Cannot find module 'prop-types'"**
```bash
cd frontend
npm install prop-types
npm run build
```

### **Dashboard ne charge pas**
Vérifier que le backend tourne :
```bash
curl http://VOTRE_VPS:3000/api/health
curl "http://VOTRE_VPS:3000/api/stats/dashboard?period=30d&status=completed"
```

### **Images non chargées** (logo)
Vérifier que `/images/logo.svg` existe dans `frontend/public/images/`.

---

## ✅ Checklist de vérification

- [x] Backend avec tous les models, services, controllers, routes
- [x] StatsApp remplacé par la nouvelle version
- [x] CustomersApp + CustomerDetail créés
- [x] ProductsApp + ProductDetail créés (avec édition coûts)
- [x] OrdersApp + OrderDetail créés
- [x] Routes ajoutées dans App.jsx
- [x] Filtres croisés AND/OR/EXCLUDE implémentés
- [x] API sync existante conservée
- [x] Compatibilité avec les 5 données de test

---

**🎉 L'application est complète et prête à l'emploi !**

Tu peux maintenant :
1. Accéder au dashboard `/stats`
2. Naviguer vers `/customers`, `/products`, `/orders`
3. Cliquer sur n'importe quel élément pour voir les détails
4. Éditer les coûts des produits
5. Utiliser l'API pour des filtres croisés avancés

*Document créé le 28/10/2025*
