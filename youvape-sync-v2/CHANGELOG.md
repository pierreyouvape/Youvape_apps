# Changelog - Youvape Sync v2

## Version 2.2.0 - 2025-01-28

### ✨ Nouvelles fonctionnalités

#### Import indépendant des produits et clients
- **Séparation des imports** : Vous pouvez maintenant importer les customers et products séparément
- **3 nouveaux boutons** dans l'interface admin :
  - 🟢 **Process CUSTOMERS** - Importe uniquement les clients
  - 🔴 **Process PRODUCTS** - Importe uniquement les produits
  - 🔵 **Process ORDERS** - Importe uniquement les commandes
- **Bouton legacy conservé** : Le bouton "Process DATA" (customers + products ensemble) reste disponible pour compatibilité

### 🔧 Modifications techniques

#### Backend (PHP)
- Ajout de `Bulk_Sync_Manager::process_customers_batches()` - Import customers uniquement
- Ajout de `Bulk_Sync_Manager::process_products_batches()` - Import products uniquement
- Ajout de 2 nouveaux REST endpoints :
  - `POST /wp-json/youvape-sync/v1/bulk/process-customers`
  - `POST /wp-json/youvape-sync/v1/bulk/process-products`

#### Frontend (JavaScript)
- Ajout de `YouvapeSync.bulkProcessCustomers()` - Handler pour le bouton customers
- Ajout de `YouvapeSync.bulkProcessProducts()` - Handler pour le bouton products
- Amélioration des messages de confirmation et de progression

#### Interface admin
- Nouvelle mise en page avec 3 boutons séparés par couleur
- Message d'avertissement mis à jour pour refléter l'ordre d'import recommandé
- Section legacy clairement identifiée pour le bouton "Process DATA"

### 📋 Utilisation

#### Import recommandé (ordre)
1. **Customers** en premier (les commandes ont besoin des clients)
2. **Products** ensuite (les commandes ont besoin des produits)
3. **Orders** en dernier (nécessite customers et products existants)

#### Cas d'usage
- ✅ **Réimporter uniquement les produits** sans toucher aux clients
- ✅ **Corriger les données produits** sans risque sur les autres données
- ✅ **Plus de granularité** dans la synchronisation
- ✅ **Meilleure gestion des erreurs** par type de données

### 🔄 Migration depuis v2.1.2

Aucune action requise ! Le plugin détectera automatiquement la mise à jour.

**Important :** Le système de queue (offsets) est compatible avec l'ancienne version. Si vous aviez une sync en cours :
- Les offsets `customers_offset`, `products_offset` et `orders_offset` sont préservés
- Vous pouvez continuer votre sync avec les nouveaux boutons séparés
- L'ancien bouton "Process DATA" continue de fonctionner

### 🐛 Corrections
- Aucune pour cette version (nouvelles fonctionnalités uniquement)

---

## Version 2.1.2 (précédente)
- Séparation DATA/ORDERS
- Optimisations diverses
