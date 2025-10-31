# 🚀 Instructions de déploiement - Version 1.2.0

## 📝 Résumé des modifications

La version 1.2.0 ajoute la récupération **COMPLÈTE** de toutes les données disponibles dans WooCommerce :

### Module WooCommerce (PHP)
- ✅ **Produits** : attributs (marque, fabricant, couleur, etc.), tags, dimensions, métadonnées, galerie d'images, descriptions
- ✅ **Clients** : rôles, métadonnées, display_name, is_paying_customer
- ✅ **Commandes** : fees, taxes détaillées, IP client, user agent, métadonnées, shipping/tax lines complets

### Backend (Node.js)
- ✅ Stockage de toutes les nouvelles données en JSONB
- ✅ Index GIN pour recherche performante dans les JSONB

---

## 📋 Actions à effectuer sur le VPS

### Étape 1 : Exécuter la migration SQL

Connectez-vous au VPS et exécutez :

```bash
# Se connecter à PostgreSQL
docker compose exec postgres psql -U youvape -d youvape_db

# Puis dans psql, copier/coller le contenu du fichier :
# backend/migrations/v1.2.0_add_metadata_columns.sql
```

**OU** en une seule commande (plus rapide) :

```bash
docker compose exec postgres psql -U youvape -d youvape_db < backend/migrations/v1.2.0_add_metadata_columns.sql
```

Vous devriez voir :
```
ALTER TABLE
ALTER TABLE
...
CREATE INDEX
...
        status
--------------------------------
Migration v1.2.0 completed successfully!
```

### Étape 2 : Déployer le backend modifié

```bash
# Sur le VPS
cd /path/to/Youvape_apps

# Pull des derniers changements (si via Git)
git pull

# Redémarrer le backend
docker compose restart backend

# Vérifier les logs
docker compose logs backend --tail=50
```

Vous devriez voir :
```
✓ Backend server running on port 3000
```

### Étape 3 : Installer le module WooCommerce v1.2.0

1. **Sur votre machine locale**, le fichier [youvape-sync-v1.2.0.zip](youvape-sync-v1.2.0.zip) est prêt
2. **Sur WordPress (préprod)**, aller dans Extensions → Ajouter → Téléverser
3. **Remplacer** l'ancien module par le nouveau (v1.2.0)
4. **Activer** le module

### Étape 4 : Tester avec un échantillon

1. Aller dans **WordPress → YouVape Sync → Onglet "Test"**
2. Mettre **5 clients, 5 produits, 5 commandes**
3. Cliquer sur **"Envoyer l'échantillon test"**
4. Vérifier que ça fonctionne

### Étape 5 : Vérifier les nouvelles données

Sur le VPS, vérifier qu'on reçoit bien les nouveaux champs :

```bash
# Vérifier un produit avec ses attributs
docker compose exec postgres psql -U youvape -d youvape_db -c "
  SELECT
    name,
    attributes->>'pa_marque' AS marque,
    tags,
    dimensions,
    type,
    featured
  FROM products
  WHERE attributes IS NOT NULL
  LIMIT 3;
"

# Vérifier un client avec ses métadonnées
docker compose exec postgres psql -U youvape -d youvape_db -c "
  SELECT
    email,
    display_name,
    roles,
    is_paying_customer,
    meta_data
  FROM customers
  WHERE meta_data IS NOT NULL
  LIMIT 3;
"

# Vérifier une commande avec ses métadonnées
docker compose exec postgres psql -U youvape -d youvape_db -c "
  SELECT
    order_id,
    order_key,
    transaction_id,
    customer_ip_address,
    shipping_lines,
    fee_lines,
    tax_lines
  FROM orders
  WHERE order_key IS NOT NULL
  LIMIT 3;
"
```

---

## 🆕 Nouvelles colonnes ajoutées

### Table `products`
- `description` (TEXT) - Description longue
- `short_description` (TEXT) - Description courte
- `tags` (JSONB) - Tags produits
- `attributes` (JSONB) - **Marque, fabricant, couleur, taille, etc.**
- `dimensions` (JSONB) - Longueur, largeur, hauteur, poids
- `meta_data` (JSONB) - Tous les champs custom
- `type` (VARCHAR) - simple, variable, grouped, etc.
- `status` (VARCHAR) - publish, draft, etc.
- `featured` (BOOLEAN) - Produit mis en avant
- `gallery_images` (JSONB) - URLs des images de galerie

### Table `customers`
- `display_name` (VARCHAR) - Nom affiché
- `roles` (JSONB) - Rôles utilisateur
- `date_modified` (TIMESTAMP) - Date de modification
- `is_paying_customer` (BOOLEAN) - A déjà payé
- `meta_data` (JSONB) - Tous les champs custom

### Table `orders`
- `order_key` (VARCHAR) - Clé unique de commande
- `cart_tax` (NUMERIC) - Taxe sur le panier
- `shipping_tax` (NUMERIC) - Taxe sur la livraison
- `transaction_id` (VARCHAR) - ID de transaction paiement
- `prices_include_tax` (BOOLEAN) - Prix TTC/HT
- `date_paid` (TIMESTAMP) - Date de paiement
- `customer_ip_address` (VARCHAR) - IP du client
- `customer_user_agent` (TEXT) - Navigateur du client
- `shipping_lines` (JSONB) - Détails complets de livraison
- `fee_lines` (JSONB) - Frais additionnels
- `tax_lines` (JSONB) - Détails des taxes
- `meta_data` (JSONB) - Tous les champs custom

### Table `order_items`
- `variation_id` (BIGINT) - ID de la variation produit
- `meta_data` (JSONB) - Métadonnées de l'item

---

## 🔍 Exemples d'utilisation des nouvelles données

### Filtrer par marque

```sql
SELECT name, attributes->>'pa_marque' AS marque
FROM products
WHERE attributes ? 'pa_marque'
AND attributes->>'pa_marque' = 'VapeKing';
```

### Trouver les produits en vedette

```sql
SELECT name, price, featured
FROM products
WHERE featured = TRUE;
```

### Clients qui ont déjà payé

```sql
SELECT email, first_name, last_name, total_spent
FROM customers
WHERE is_paying_customer = TRUE
ORDER BY total_spent DESC;
```

### Commandes avec des fees

```sql
SELECT order_id, order_number, total, fee_lines
FROM orders
WHERE jsonb_array_length(fee_lines) > 0;
```

---

## ⚠️ Notes importantes

1. **Compatibilité** : La v1.2.0 est **rétrocompatible**. Si un champ n'existe pas dans les anciennes données, il sera NULL ou vide.

2. **Performance** : Les index GIN ont été créés pour permettre des recherches rapides dans les JSONB.

3. **Taille en base** : Les nouvelles colonnes JSONB augmenteront légèrement la taille de la base de données.

4. **Import historique** : Si vous relancez un import historique après la migration, toutes les nouvelles données seront récupérées automatiquement.

---

## 🎯 Prochaines étapes (v1.3.0)

Maintenant que vous avez **TOUTES** les données, vous pourrez :

1. **Frontend** : Ajouter des filtres par marque, fabricant, tags
2. **Stats avancées** : Analyser les taxes, fees, variations
3. **Segmentation** : Filtrer par rôles clients, métadonnées
4. **Export** : Exporter les données complètes vers Excel/CSV

---

## 🆘 En cas de problème

### Erreur "column already exists"
```sql
-- La migration utilise IF NOT EXISTS, mais si ça bloque :
ALTER TABLE products DROP COLUMN IF EXISTS attributes CASCADE;
-- Puis relancer la migration
```

### Backend ne démarre pas
```bash
# Vérifier les logs
docker compose logs backend --tail=100

# Souvent c'est une erreur de syntaxe SQL dans syncController.js
# Vérifier le nombre de paramètres $1, $2... correspond au nombre de values[]
```

### Module ne s'active pas
- Vérifier qu'il n'y a pas d'erreur PHP : activer WP_DEBUG dans wp-config.php
- Vérifier les logs WordPress (si disponibles)

---

## ✅ Checklist de déploiement

- [ ] Migration SQL exécutée sur le VPS
- [ ] Backend redémarré et fonctionnel
- [ ] Module v1.2.0 installé sur WordPress
- [ ] Test d'échantillon réussi (5/5/5)
- [ ] Vérification des nouvelles colonnes dans la base
- [ ] Import historique testé (optionnel)

---

**Version** : 1.2.0
**Date** : 31/10/2025
**Auteur** : Claude Code
**Statut** : ✅ Prêt pour production
