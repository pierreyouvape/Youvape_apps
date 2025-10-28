# Youvape Sync - Plugin WordPress

Plugin WooCommerce ultra-léger pour synchroniser les données (clients, produits, commandes) vers une API Node.js externe.

## 📋 Caractéristiques

### ✅ Import Historique (Batch)
- Import massif de toutes les données WooCommerce existantes
- Traitement par lots configurables (défaut: 25 items)
- Ordre de traitement respecté: **Clients → Produits → Commandes**
- Restriction horaire optionnelle (ex: 02:00-06:00)
- Interface admin avec progression temps réel
- Gestion des erreurs avec retry automatique (3 tentatives)

### ✅ Synchronisation Live (Temps réel)
- Détection automatique des nouveaux événements WooCommerce
- Délai configurable avant envoi (défaut: 60 secondes)
- Hooks supportés:
  - Clients: `user_register`, `profile_update`, `woocommerce_new_customer`
  - Produits: `woocommerce_new_product`, `woocommerce_update_product`
  - Commandes: `woocommerce_new_order`, `woocommerce_update_order`, `woocommerce_order_status_changed`

### ✅ Ultra-léger
- **Aucune table de base de données WordPress** créée (pas de table custom)
- Configuration stockée dans `wp_options` (standard WordPress)
- Logs téléchargeables en fichier `.txt` depuis l'interface admin
- Simple proxy HTTP entre WooCommerce et l'API
- Mode lecture seule (aucune modification des données WC)

## 📦 Structure du Plugin

```
module_wc/
├── youvape-sync.php              # Plugin principal WordPress
├── includes/
│   ├── class-api-client.php      # Client HTTP pour envoi vers API
│   ├── class-batch-processor.php # Traitement import historique
│   ├── class-event-listener.php  # Écoute hooks WooCommerce
│   └── class-settings.php        # Gestion configuration
├── admin/
│   ├── settings-page.php         # Interface admin WordPress
│   ├── css/
│   │   └── admin.css            # Styles interface admin
│   └── js/
│       └── admin.js             # JavaScript interface admin
└── README.md                     # Ce fichier
```

## 🚀 Installation

### Méthode 1 : Installation via ZIP (recommandée)

1. **Télécharger le ZIP**
   - Le fichier `youvape-sync.zip` est disponible dans le dépôt

2. **Installer dans WordPress**
   - Aller dans WordPress Admin → **Extensions** → **Ajouter**
   - Cliquer sur **Téléverser une extension**
   - Choisir le fichier `youvape-sync.zip`
   - Cliquer sur **Installer maintenant**
   - Une fois installé, cliquer sur **Activer**

3. **Configurer l'API**
   - Menu **Youvape Sync** dans le panneau d'administration
   - Onglet **Configuration**
   - Renseigner l'URL de l'API Node.js (ex: `https://api.youvape.com`)
   - Optionnel: Clé API Bearer si authentification requise
   - Sauvegarder et tester la connexion

### Méthode 2 : Installation manuelle (FTP)

1. **Copier le plugin dans WordPress**
   ```bash
   cp -r module_wc /path/to/wordpress/wp-content/plugins/youvape-sync
   ```

2. **Activer le plugin**
   - Aller dans WordPress Admin → Extensions
   - Activer "Youvape Sync"

3. **Configurer comme ci-dessus**

> **📖 Guide complet** : Voir [INSTALLATION.md](INSTALLATION.md) pour plus de détails

## ⚙️ Configuration

### Paramètres disponibles

| Paramètre | Description | Défaut |
|-----------|-------------|--------|
| **URL de l'API** | URL de base de l'API Node.js | - |
| **Clé API** | Token Bearer pour authentification (optionnel) | - |
| **Taille des lots** | Nombre d'items par batch (1-100) | 25 |
| **Types de données** | Clients, Produits, Commandes | Tous activés |
| **Restriction horaire** | Limite l'import batch à une plage horaire | Désactivé |
| **Synchro live** | Active la synchronisation temps réel | Activé |
| **Délai synchro live** | Délai avant envoi (secondes) | 60 |

### Endpoints API attendus

Le plugin envoie les données vers ces endpoints:

- `POST /api/woo-sync/customers` - Batch de clients
- `POST /api/woo-sync/products` - Batch de produits
- `POST /api/woo-sync/orders` - Batch de commandes

### Format des requêtes

Toutes les requêtes sont en JSON avec cette structure:

```json
{
  "batch": [...],       // Tableau d'items
  "action": "batch_import" | "live_update"
}
```

**Headers envoyés:**
- `Content-Type: application/json`
- `Authorization: Bearer <api_key>` (si configurée)

## 📊 Structure des Données

### Clients
```json
{
  "customer_id": 123,
  "email": "client@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+33123456789",
  "username": "johndoe",
  "date_created": "2024-01-15T10:30:00+00:00",
  "total_spent": "1250.50",
  "order_count": 15,
  "billing_address": { ... },
  "shipping_address": { ... },
  "avatar_url": "https://..."
}
```

### Produits
```json
{
  "product_id": 456,
  "sku": "ELIQ-FRAISE-50ML",
  "name": "E-liquide Fraise 50ml",
  "price": "12.90",
  "regular_price": "14.90",
  "sale_price": "12.90",
  "cost_price": "5.20",  // Si disponible dans WC
  "stock_quantity": 45,
  "stock_status": "instock",
  "category": "E-liquides",
  "categories": [{...}],
  "date_created": "2023-05-10T08:00:00+00:00",
  "date_modified": "2025-01-20T14:30:00+00:00",
  "total_sales": 125,
  "image_url": "https://..."
}
```

### Commandes
```json
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
  "date_created": "2025-01-22T15:30:00+00:00",
  "date_completed": "2025-01-23T10:00:00+00:00",
  "date_modified": "2025-01-23T10:00:00+00:00",
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
      "price": "12.90",          // Prix unitaire PAYÉ
      "regular_price": "14.90",  // Prix catalogue
      "subtotal": "29.80",       // quantity × regular_price
      "total": "25.80",          // quantity × price
      "discount": "4.00",        // subtotal - total
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
```

## 🔄 Utilisation

### Import Historique

1. Aller dans l'onglet "Import Historique"
2. Vérifier les totaux affichés (clients, produits, commandes)
3. Cliquer sur "Lancer l'import historique"
4. Suivre la progression en temps réel
5. L'import se fait automatiquement dans l'ordre: Clients → Produits → Commandes

**⚠️ Important:**
- L'import peut prendre plusieurs heures pour de gros catalogues
- Les barres de progression se mettent à jour automatiquement
- Vous pouvez arrêter l'import à tout moment (reprise possible)
- Si restriction horaire activée, l'import attendra la plage autorisée

### Synchronisation Live

Une fois activée dans la configuration:
- Les nouveaux clients sont détectés automatiquement
- Les nouveaux produits sont détectés automatiquement
- Les nouvelles commandes sont détectées automatiquement
- Les modifications sont également synchronisées

**Délai de synchronisation:**
- Par défaut: 60 secondes après l'événement
- Configurable entre 0 et 3600 secondes
- Permet de regrouper plusieurs modifications

### Logs et Export

Onglet "Logs" pour consulter:
- Statut du dernier import batch
- Nombre d'items traités
- Erreurs rencontrées (si présentes)

**Export des logs:**
- Bouton **"Télécharger les logs (.txt)"** disponible dans l'onglet Logs
- Génère un fichier texte téléchargeable avec toutes les informations :
  - Configuration actuelle
  - Statut import batch (progression, erreurs)
  - Queue synchro live
  - Informations système (WordPress, WooCommerce, PHP)
- Format: `youvape-sync-logs-YYYY-MM-DD-HHMMSS.txt`

## 🔍 Dépannage

### Le plugin ne s'active pas
- Vérifier que WooCommerce est installé et activé
- Vérifier la version de PHP (7.4 minimum)

### Test de connexion échoue
- Vérifier que l'URL de l'API est correcte
- Vérifier que l'API est accessible depuis le serveur WordPress
- Vérifier le certificat SSL si HTTPS
- Créer un endpoint `/api/woo-sync/ping` sur l'API pour le test

### Import batch bloqué
- Vérifier les logs dans l'onglet "Logs"
- Vérifier si restriction horaire activée
- Vérifier les logs WordPress: `/wp-content/debug.log` (si `WP_DEBUG` activé)

### Synchro live ne fonctionne pas
- Vérifier que "Synchro live" est activée dans la configuration
- Vérifier que les types de données sont activés
- Vérifier la queue dans l'onglet "Synchro Live"

### Mode Debug

Activer le mode debug WordPress pour voir les logs détaillés:

```php
// wp-config.php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
```

Les logs seront dans `/wp-content/debug.log`

## 🛡️ Sécurité

- Toutes les requêtes AJAX sont protégées par nonce
- Seuls les utilisateurs avec capacité `manage_options` peuvent accéder aux paramètres
- Les données sensibles (clé API) sont stockées de manière sécurisée
- Mode lecture seule sur WooCommerce (aucune modification)
- Validation et sanitization de tous les inputs

## 📝 Notes Techniques

### Gestion des erreurs
- Retry automatique avec backoff exponentiel (1s, 2s, 4s)
- Maximum 3 tentatives par requête
- Erreurs 4xx (client) ne sont pas retryées
- Toutes les erreurs sont loggées

### Performance
- Traitement asynchrone via AJAX
- Batch size configurable (recommandé: 25)
- Délai configurable pour la synchro live
- Aucune table DB = impact minimal sur WordPress

### Coûts produits
Le plugin tente de récupérer le coût d'achat depuis ces meta fields (dans l'ordre):
1. `_cost_price`
2. `_alg_wc_cog_cost` (plugin Cost of Goods for WooCommerce)
3. `_wc_cog_cost` (plugin WooCommerce Cost of Goods)

Si aucun champ n'est trouvé, `cost_price` sera `null`.

## 🔗 Intégration avec l'API Node.js

Votre API Node.js doit implémenter ces endpoints:

### POST /api/woo-sync/customers
Reçoit un batch de clients et les stocke en base de données.

### POST /api/woo-sync/products
Reçoit un batch de produits et les stocke en base de données.

### POST /api/woo-sync/orders
Reçoit un batch de commandes avec leurs line_items et coupons.

### GET /api/woo-sync/ping (optionnel)
Endpoint de test pour vérifier la connexion.

**Exemple de réponse attendue:**
```json
{
  "success": true,
  "message": "Batch processed successfully",
  "items_processed": 25
}
```

## 📄 Licence

Propriétaire - Youvape © 2025

## 👨‍💻 Auteur

Développé par l'équipe Youvape

## 📞 Support

Pour toute question ou problème, contacter l'équipe technique Youvape.
