# Déploiement de la correction des bundles

## Résumé du problème

Les produits bundles (woosb) créent des lignes à 0€ dans les commandes, ce qui causait :
- Marges négatives pour les produits individuels
- Quantités vendues gonflées
- Statistiques incorrectes

## Solution implémentée

1. ✅ Ajout du champ `woosb_ids` dans la table products
2. ✅ Fonction de parsing PHP → JSON dans le transformer
3. ✅ Exclusion des "bundle sub-items" dans les requêtes de stats
4. ✅ Script de migration pour convertir les données existantes

## Déploiement sur le VPS

### Étape 1 : Push et pull des changements

```bash
# Local
cd /Users/pierremerle/Documents/Youvape/Youvape_apps
git add .
git commit -m "Fix: Handle bundle products correctly in stats"
git push

# VPS
ssh ubuntu@54.37.156.233
cd /var/www/Youvape_apps
git pull
```

### Étape 2 : Migration des données woosb_ids

```bash
cd /var/www/Youvape_apps/backend
node migrations/convert_woosb_ids_to_json.js
```

**Résultat attendu :** Tous les bundles convertis de PHP serialized → JSON

### Étape 3 : Redémarrer le backend

```bash
pm2 restart youvape-api
```

### Étape 4 : Vérification

#### A. Vérifier qu'un bundle a bien ses données JSON

```bash
docker compose exec postgres psql -U youvape -d youvape_db -c "SELECT wp_product_id, post_title, woosb_ids FROM products WHERE wp_product_id = 14742;"
```

**Attendu :** `woosb_ids` doit être un tableau JSON propre :
```json
[{"id": "11152", "qty": "10"}]
```

#### B. Vérifier les stats du produit 11152 (qui était à -97% de marge)

```bash
curl -s "http://54.37.156.233:3000/api/products/stats-list?limit=50" | python3 -m json.tool | grep -A 15 '"wp_product_id": "11152"'
```

**Avant la correction :**
```json
{
    "wp_product_id": "11152",
    "qty_sold": 111173,
    "margin_ht": "-12225.82",
    "margin_percent": "-97.47"
}
```

**Après la correction (attendu) :**
- `qty_sold` doit être divisé par ~10 (car c'était gonflé par le bundle de 10)
- `margin_ht` et `margin_percent` doivent être positifs ou proches de 0

#### C. Test global : plus de marges négatives

```bash
curl -s "http://54.37.156.233:3000/api/products/stats-list?limit=100&sortBy=margin_ht&sortOrder=ASC" | python3 -m json.tool | grep "margin_percent" | head -10
```

Les premières marges ne doivent plus être à -97%, -146%, -251%...

## Fichiers modifiés

### Backend
- `backend/src/transformers/productTransformer.js` - Ajout fonction parseWoosbIds
- `backend/src/models/productModel.js` - Exclusion bundle sub-items
- `backend/migrations/add_woosb_ids_column.sql` - Ajout colonne
- `backend/migrations/convert_woosb_ids_to_json.js` - Script conversion
- `DATABASE_SCHEMA.md` - Documentation

### Frontend
Aucune modification nécessaire pour cette correction.

## Rollback en cas de problème

Si les statistiques sont incorrectes après la migration :

```bash
# Restaurer le champ woosb_ids à NULL pour tous les bundles
docker compose exec postgres psql -U youvape -d youvape_db -c "UPDATE products SET woosb_ids = NULL WHERE product_type = 'woosb';"

# Redémarrer
pm2 restart youvape-api
```

Les stats reviendront à l'état précédent (avec les marges négatives).

## Support

En cas de problème, vérifier :
1. Les logs PM2 : `pm2 logs youvape-api`
2. Les logs PostgreSQL : `docker compose logs postgres`
3. Le script de migration : `node migrations/convert_woosb_ids_to_json.js 2>&1 | tee migration.log`
