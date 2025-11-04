# Résumé Session 2025-11-03 - Module WooCommerce Sync v1.1.3

## Contexte de départ
Suite à la conversation précédente qui avait dépassé le contexte, nous avons repris le travail sur le module de synchronisation WooCommerce avec un système d'offsets pour les tests manuels.

**État au début de session:**
- Module v1.1.2 existant avec des problèmes
- Système d'offsets partiellement implémenté
- Bugs multiples lors de l'import de test

## Problèmes identifiés

### 1. **Customers: Colonne avatar_url manquante**
- **Erreur:** `column "avatar_url" of relation "customers" does not exist`
- **Cause:** Le module PHP envoyait `avatar_url` mais la colonne n'existait pas en base
- **Solution:** Suppression de `avatar_url` du module PHP (inutile, pèse lourd pour rien)

### 2. **Products: HTTP 413 Request Entity Too Large**
- **Erreur:** `PayloadTooLargeError: request entity too large`
- **Cause:** Limite body-parser par défaut = 100kb, beaucoup trop petite pour 25 produits avec métadonnées
- **Solution:** Augmentation de la limite à 200mb dans `backend/src/server.js`

### 3. **Offsets non fonctionnels**
- **Problème:** Le système d'offsets était créé mais non testé
- **Solution:** Test complet après correction des bugs précédents

## Modifications effectuées

### Backend (`backend/src/server.js`)
```javascript
// AVANT
app.use(express.json());

// APRÈS
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
```

### Backend (`backend/src/controllers/syncController.js`)
- Suppression de la colonne `avatar_url` dans la requête INSERT customers
- Réduction de 17 à 16 paramètres dans le INSERT

### Module WordPress v1.1.3 (`module_wc/includes/class-batch-processor.php`)
```php
// SUPPRIMÉ ligne 303
'avatar_url' => get_avatar_url($customer->get_email()),
```

### Module WordPress v1.1.3 (`module_wc/includes/class-event-listener.php`)
```php
// SUPPRIMÉ ligne 348
'avatar_url' => get_avatar_url($customer->get_email()),
```

### Module WordPress - Système d'offsets
**Déjà implémenté dans la session précédente:**
- Endpoints backend: GET/POST/DELETE `/api/sync/test-offsets`
- Fonction `send_test_sample()` modifiée pour utiliser les offsets depuis l'API
- Fonction `reset_test_offsets()` ajoutée
- Bouton "Réinitialiser les offsets de test" dans l'admin WordPress

## Tests effectués

### Test 1: Import avec 5 produits
- ✓ 5 clients importés
- ✓ 5 produits importés (après augmentation limite à 50mb)
- ✓ 5 commandes importées

### Test 2: Import avec 25 produits
- ✓ 25 clients importés
- ✗ 0 produits (HTTP 413 avec limite 50mb)
- ✓ 25 commandes importées

### Test 3: Après augmentation à 200mb
- ✓ 25 clients importés
- ✓ 25 produits importés
- ✓ 25 commandes importées

### Test 4: Import avec 50 produits d'un coup
- ✓ 50 produits importés sans problème

### Test 5: Système d'offsets
- Tables vidées
- 1er envoi: 25 customers, 25 products, 25 orders
- 2ème envoi: 25 customers, 25 products, 25 orders (items suivants)
- **Résultat:** ✓ 50 de chaque en base, offsets fonctionnent correctement

## État final

### ✅ Fonctionnalités opérationnelles
1. **Import customers** - Données complètes (roles, meta_data, billing, shipping)
2. **Import products** - Données complètes (attributes, tags, dimensions, gallery_images URLs)
3. **Import orders** - Données complètes (line_items, coupons, meta_data)
4. **Système d'offsets** - Permet d'envoyer différents batches sans doublons
5. **Bouton reset offsets** - Remet les offsets à 0 pour recommencer depuis le début

### 📦 Fichiers créés
- `youvape-sync-v1.1.3.zip` - Module WordPress prêt à installer

### 🔧 Configuration backend
- Limite body-parser: **200mb**
- Endpoints offsets: `/api/sync/test-offsets` (GET/POST/DELETE)

## Données synchronisées

### Customers (16 champs)
- customer_id, email, first_name, last_name, phone, username
- display_name, roles (JSONB), date_created, date_modified
- total_spent, order_count, is_paying_customer
- billing_address (JSONB), shipping_address (JSONB), meta_data (JSONB)

### Products (21 champs + JSONB)
- product_id, sku, name, description, short_description
- price, regular_price, sale_price, cost_price
- stock_quantity, stock_status, manage_stock
- categories (JSONB), attributes (JSONB), tags (JSONB)
- dimensions (JSONB), weight, gallery_images (JSONB - URLs seulement)
- meta_data (JSONB), date_created, date_modified, total_sales, image_url

### Orders (18 champs + JSONB)
- order_id, customer_id, order_number, status, currency
- total, subtotal, tax_total, shipping_total, discount_total
- payment_method, line_items (JSONB avec meta_data), coupons (JSONB)
- shipping_method, date_created, date_completed
- billing_address (JSONB), shipping_address (JSONB), customer_note, meta_data (JSONB)

## Points importants

### Pourquoi pas avatar_url?
- Poids inutile dans le payload
- Non essentiel pour l'application
- Peut être régénéré côté frontend si besoin

### Pourquoi gallery_images en URLs?
- Envoyer les images en base64 ferait exploser la taille du payload
- Les URLs suffisent pour afficher les images
- Le frontend peut charger les images via les URLs

### Limite 200mb suffisante?
- Testé avec 50 produits: ✓ OK
- Marge confortable pour l'import historique
- Si besoin, peut être augmenté ultérieurement

## Prochaines étapes (non faites)
1. Tester l'import historique complet (tous les produits/clients/commandes)
2. Vérifier les performances avec de gros volumes
3. Monitorer l'utilisation mémoire backend
4. Éventuellement optimiser les données JSONB si nécessaire

## Commits Git
- Suppression avatar_url du module
- Augmentation limite body-parser à 200mb
- Module v1.1.3 finalisé et testé

## Conclusion
Le module v1.1.3 est **opérationnel** avec:
- ✅ Import manuel de test fonctionnel
- ✅ Système d'offsets pour éviter les doublons
- ✅ Support de gros volumes (50+ produits)
- ✅ Toutes les métadonnées WooCommerce synchronisées
- ✅ Prêt pour l'import historique complet
