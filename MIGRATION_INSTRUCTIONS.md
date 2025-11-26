# Instructions pour appliquer la migration woosb_ids

## Contexte

Pour résoudre le problème des bundles qui créent des lignes à 0€ dans les commandes, j'ai ajouté une nouvelle colonne `woosb_ids` à la table `products`. Cette colonne stocke les IDs des produits inclus dans chaque bundle.

## Fichiers modifiés

- `backend/src/transformers/productTransformer.js` - Ajout de l'extraction du champ woosb_ids depuis les métadonnées
- `backend/migrations/add_woosb_ids_column.sql` - Migration SQL pour ajouter la colonne
- `DATABASE_SCHEMA.md` - Documentation mise à jour

## Étapes pour appliquer la migration sur le VPS

### 1. Pousser les changements vers le VPS

```bash
# Dans votre terminal local
cd /Users/pierremerle/Documents/Youvape/Youvape_apps
git add .
git commit -m "Add woosb_ids field to products table for bundle detection"
git push
```

### 2. Se connecter au VPS et récupérer les changements

```bash
ssh pierremerle@54.37.156.233
cd /var/www/Youvape_apps
git pull
```

### 3. Exécuter la migration

```bash
cd backend
chmod +x run-migration.sh
./run-migration.sh migrations/add_woosb_ids_column.sql
```

### 4. Redémarrer le backend pour charger les nouveaux changements

```bash
pm2 restart youvape-api
```

### 5. Resynchroniser les produits bundles

Pour que les produits bundles existants aient leur champ `woosb_ids` rempli, il faudra les resynchroniser depuis WordPress. Les nouveaux produits synchro auront automatiquement ce champ.

## Vérification

Pour vérifier que la migration a fonctionné :

```bash
docker compose exec postgres psql -U youvape -d youvape_db -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'woosb_ids';"
```

Vous devriez voir :
```
 column_name | data_type
-------------+-----------
 woosb_ids   | jsonb
```

Pour voir un exemple de produit bundle avec ses IDs :

```bash
docker compose exec postgres psql -U youvape -d youvape_db -c "SELECT wp_product_id, post_title, product_type, woosb_ids FROM products WHERE product_type = 'woosb' LIMIT 1;"
```

## Prochaine étape

Une fois la migration appliquée et les produits resynchronisés, je pourrai modifier les requêtes de statistiques pour exclure les produits qui sont des "bundle sub-items" (produits vendus à 0€ qui font partie d'un bundle).
