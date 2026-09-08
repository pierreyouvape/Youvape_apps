# Routes API - Youvape Stats Backend

Base URL: `http://54.37.156.233:3000/api`

## 📊 Stats Routes (`/stats`)

- `GET /stats/dashboard` - KPIs du tableau de bord (CA, commandes, clients, panier moyen)
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`

- `GET /stats/revenue-evolution` - Évolution du chiffre d'affaires
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`

- `GET /stats/top-products` - Top des produits les plus vendus
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`, `limit`

- `GET /stats/top-customers` - Top des meilleurs clients
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`, `limit`

- `GET /stats/by-country` - Stats par pays
  - Query params: `period`, `status`, `startDate`, `endDate`

- `GET /stats/by-shipping-method` - Stats par transporteur
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`

- `GET /stats/by-payment-method` - Stats par méthode de paiement
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`

- `GET /stats/by-category` - Stats par catégorie de produit
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`

- `GET /stats/top-coupons` - Top des coupons les plus utilisés
  - Query params: `period`, `status`, `country`, `startDate`, `endDate`, `limit`

- `GET /stats/by-status` - Stats par statut de commande
  - Query params: `period`, `country`, `startDate`, `endDate`

- `GET /stats/comparison` - Comparaison entre deux périodes
  - Query params: `period1Start`, `period1End`, `period2Start`, `period2End`, `status`, `country`

## 📦 Orders Routes (`/orders`)

### Liste et recherche
- `GET /orders` - Liste des commandes
  - Query params: `page`, `limit`, `status`, `country`, `startDate`, `endDate`, `sortBy`, `sortOrder`

- `GET /orders/search` - Recherche de commandes (par numéro, email client, etc.)
  - Query params: `q`, `limit`

- `POST /orders/advanced-search` - Recherche avancée avec filtres multiples
  - Body: `{ status, country, startDate, endDate, minTotal, maxTotal, shippingMethod, paymentMethod }`

### Métadonnées
- `GET /orders/statuses/list` - Liste des statuts disponibles
- `GET /orders/stats/by-status` - Statistiques par statut
- `GET /orders/countries/list` - Liste des pays

### Filtres
- `GET /orders/status/:status` - Commandes par statut
- `GET /orders/country/:country` - Commandes par pays

### Détails et édition
- `GET /orders/:id` - Détails d'une commande
- `PUT /orders/:id/shipping-cost` - Modifier les frais de port
  - Body: `{ shippingCost }`

## 👥 Customers Routes (`/customers`)

### Liste et recherche
- `GET /customers` - Liste des clients
  - Query params: `page`, `limit`, `country`, `sortBy`, `sortOrder`

- `GET /customers/search` - Recherche de clients (par nom, email, etc.)
  - Query params: `q`, `limit`

- `POST /customers/advanced-search` - Recherche avancée
  - Body: `{ country, minOrders, maxOrders, minTotal, maxTotal }`

### Détails client
- `GET /customers/:id` - Détails d'un client
- `GET /customers/:id/orders` - Commandes du client
  - Query params: `page`, `limit`

- `GET /customers/:id/favorite-products` - Produits favoris du client
  - Query params: `limit`

- `GET /customers/:id/stats` - Statistiques du client (CA total, nb commandes, panier moyen)
- `GET /customers/:id/coupons` - Coupons utilisés par le client

### Notes client
- `GET /customers/:customerId/notes` - Liste des notes du client
- `POST /customers/:customerId/notes` - Créer une note
  - Body: `{ content, type }`

- `PUT /customers/notes/:noteId` - Modifier une note
  - Body: `{ content, type }`

- `DELETE /customers/notes/:noteId` - Supprimer une note

## 🛍️ Products Routes (`/products`)

### Liste et recherche
- `GET /products` - Liste des produits
  - Query params: `page`, `limit`, `category`, `inStock`, `sortBy`, `sortOrder`

- `GET /products/search` - Recherche de produits (par nom, SKU, etc.)
  - Query params: `q`, `limit`

- `GET /products/categories/list` - Liste des catégories
- `GET /products/stock-summary` - Résumé des stocks (en stock, rupture, stock bas)
- `GET /products/category/:category` - Produits par catégorie

### Détails produit
- `GET /products/:id` - Détails d'un produit
- `GET /products/:id/sales-history` - Historique des ventes
  - Query params: `period`, `startDate`, `endDate`

- `GET /products/:id/customers` - Clients ayant acheté ce produit
  - Query params: `limit`

- `GET /products/:id/related` - Produits similaires/liés

### Stats produit avancées
- `GET /products/:id/family` - Famille de produits (variantes)
- `GET /products/:id/stats/kpis` - KPIs du produit (quantité vendue, CA, stock)
- `GET /products/:id/stats/variant` - Stats par variante
- `GET /products/:id/stats/all-variants` - Stats toutes variantes
- `GET /products/:id/stats/evolution` - Évolution des ventes
  - Query params: `period`, `startDate`, `endDate`

- `GET /products/:id/stats/frequently-bought-with` - Produits achetés ensemble
- `GET /products/:id/stats/by-country` - Ventes par pays
- `GET /products/:id/stats/top-customers` - Top clients du produit
- `GET /products/:id/stats/recent-orders` - Commandes récentes
- `GET /products/:id/stats/by-day-of-week` - Ventes par jour de la semaine
- `GET /products/:id/stats/by-hour` - Ventes par heure

### Édition
- `PUT /products/:id/cost` - Modifier le prix de revient
  - Body: `{ costPrice }`

## 🧰 ATB Routes (`/atb`) — Anthony Tool Box

JWT au montage (`server.js`) + droit applicatif `atb` en lecture (vérifié dans le routeur).

- `GET /atb/orders/daily` - Commandes payées par jour, avec contreparties M-1 et N-1
  - Query params (obligatoires) : `dateFrom`, `dateTo` au format `YYYY-MM-DD`, bornes incluses, 366 jours maximum
  - Statuts : liste blanche des 6 statuts payés. Jour de rattachement : `COALESCE(paid_date, post_date)`
  - Comparaison **calendaire** (même quantième), pas par jour de semaine. Un quantième
    inexistant dans le mois/l'année cible (31 février, 29 février non bissextile) renvoie
    `m1Date`/`n1Date` à `null` : pas de barre fantôme plutôt qu'une valeur rabattue.
  - Réponse : `{ range, compare, statuses, series[{date, orders, m1Date, m1Orders, n1Date, n1Orders}], totals }`
  - `totals.currentForM1` / `currentForN1` = total courant restreint aux jours ayant une
    contrepartie — c'est cette base qu'il faut utiliser pour l'écart %, pas `totals.current`.
  - `countries` (optionnel) : codes ISO 2 lettres séparés par des virgules (`FR,BE`).
    Absent ou vide = tous les pays. Le pays est `orders.shipping_country`, comme
    `statsService` et `analysisController`. Le filtre s'applique aux **trois** fenêtres,
    sinon on comparerait la France de cette année à l'Europe entière de l'an dernier.
    Un code mal formé renvoie 400 plutôt que d'être ignoré en silence.

- `GET /atb/orders/countries` - Pays servis sur les 24 derniers mois, du plus gros volume au plus petit
  - Fenêtre glissante et non « toute la période affichée » : la liste doit rester stable
    quand on change les dates, sinon un pays déjà coché disparaîtrait de la liste.
  - Renvoie `{ code, orders }` seulement. Libellés et drapeaux viennent du front
    (`utils/countries.js`), qui les tient déjà pour les autres écrans.

- `GET /atb/preferences` - Période, pays et séries affichées de l'utilisateur connecté
- `PUT /atb/preferences` - Enregistre ces choix
  - Stocké dans `user_column_preferences` (page `atb-commandes`), dépôt JSON générique
    déjà utilisé pour la page « home ». **Aucune migration.**
  - Ce qui est enregistré est le CHOIX, pas son résultat : pour un préréglage on garde
    sa clé (`30j`), pas les dates produites — sinon « 30 derniers jours » se figerait au
    jour où il a été coché. Seule la période `perso` garde des dates en dur.
  - La liste des préréglages vit côté front. Le backend ne valide que la forme de la clé ;
    une clé inconnue est ignorée au chargement et le front retombe sur son défaut.
  - Corps : `{ preset, dateFrom, dateTo, countries[], showM1, showN1 }`. Les clés inconnues
    sont écartées, les dates mal formées ou inversées ignorées.

## 🔄 Sync Routes (`/sync`)

### Connexion et santé
- `GET /sync/ping` - Test de connexion

### Réception des données WooCommerce
- `POST /sync/customers` - Recevoir des clients
- `POST /sync/products` - Recevoir des produits
- `POST /sync/orders` - Recevoir des commandes
- `POST /sync/test` - Endpoint de test
- `POST /sync/bulk` - Réception en masse (module v2)

### Logs et stats
- `GET /sync/logs/:type` - Télécharger les logs (customers, products, orders)
- `GET /sync/stats` - Stats de synchronisation
- `DELETE /sync/logs` - Effacer les logs

### Test offsets
- `GET /sync/test-offsets` - Récupérer les offsets de test
- `POST /sync/test-offsets` - Mettre à jour les offsets de test
- `DELETE /sync/test-offsets` - Réinitialiser les offsets de test

## 📝 Notes

### Query params communs
- `period`: `7d`, `30d`, `90d`, `1y`, `all` ou `custom`
- `status`: Statuts WooCommerce (`completed`, `processing`, `pending`, etc.)
- `startDate` / `endDate`: Format ISO 8601
- `page`: Numéro de page (défaut: 1)
- `limit`: Nombre de résultats (défaut: 50)
- `sortBy`: Champ de tri
- `sortOrder`: `asc` ou `desc`

### Authentification
Actuellement aucune authentification n'est requise (à sécuriser en production).
