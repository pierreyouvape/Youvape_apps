# Solution pour les produits bundles (woosb)

## Problème identifié

Les bundles (type `woosb` - WooCommerce Product Bundles) créent des lignes de commande à 0€ pour leurs produits constituants. Cela causait des problèmes dans les statistiques :

**Exemple concret :**
- Commande avec bundle "Pack Cinema Découverte" (ID 402597) à 48.32€
- Le bundle contient 3 produits : 11674, 11463, 11278
- Dans la commande, on trouve :
  - 1 ligne pour le bundle (402597) à 48.32€
  - 3 lignes à 0€ pour chaque produit du bundle

**Conséquences :**
- Les produits 11674, 11463, 11278 avaient des marges négatives (0€ de CA - coût)
- Leur quantité vendue était gonflée (comptée dans le bundle + en individuel)
- Impossible de distinguer les vraies ventes individuelles des inclusions dans des bundles

## Solution mise en place

### 1. Ajout du champ `woosb_ids` à la table `products`

**Fichier :** `backend/migrations/add_woosb_ids_column.sql`
```sql
ALTER TABLE products
ADD COLUMN IF NOT EXISTS woosb_ids JSONB DEFAULT NULL;
```

Ce champ JSONB stocke la structure suivante (exemple réel) :
```json
{
  "4uf2": {"id": "11674", "sku": "11674", "qty": "1", "min": "", "max": ""},
  "adb7": {"id": "11463", "sku": "11463", "qty": "1", "min": "", "max": ""},
  "lrux": {"id": "11278", "sku": "11278", "qty": "1", "min": "", "max": ""}
}
```

### 2. Synchronisation du champ depuis WordPress

**Fichier :** `backend/src/transformers/productTransformer.js`

Ajout de l'extraction du champ `woosb_ids` depuis les métadonnées WordPress pour les produits de type `woosb` :

```javascript
// Additional fields for BUNDLE products (woosb type)
if (product_type === 'woosb') {
  baseProduct.woosb_ids = tryParseJson(getMeta('woosb_ids'));
}
```

### 3. Exclusion des bundle sub-items dans les statistiques

**Fichier :** `backend/src/models/productModel.js`

Modification des requêtes `getAllForStats()` et `getVariationsForStats()` pour exclure les lignes de commande qui sont des "bundle sub-items".

**Logique d'identification des bundle sub-items :**
```sql
WITH bundle_sub_items AS (
  -- Identifier les lignes de commande qui sont des sous-produits de bundles
  SELECT DISTINCT oi.id as order_item_id
  FROM order_items oi
  INNER JOIN order_items oi_bundle ON oi.wp_order_id = oi_bundle.wp_order_id
  INNER JOIN products p_bundle ON p_bundle.wp_product_id = oi_bundle.product_id
  WHERE
    p_bundle.product_type = 'woosb'
    AND p_bundle.woosb_ids IS NOT NULL
    AND oi.line_total = 0
    AND oi.product_id::text = ANY(
      SELECT jsonb_array_elements_text(
        jsonb_path_query_array(p_bundle.woosb_ids, '$[*].id')
      )
    )
)
```

**Critères :**
1. La ligne de commande a un `line_total = 0`
2. Dans la MÊME commande, il existe un bundle (type woosb)
3. Le `product_id` de la ligne apparaît dans le `woosb_ids` du bundle

### 4. Inclusion des bundles dans la liste des produits

Les bundles sont maintenant visibles dans l'onglet Produits avec leur type affiché. Modification des requêtes pour inclure `'woosb'` :
```javascript
WHERE p.product_type IN ('simple', 'variable', 'woosb')
```

## Fichiers modifiés

1. **backend/src/transformers/productTransformer.js**
   - Ajout extraction `woosb_ids` pour type woosb
   - Ajout du champ dans la requête INSERT/UPDATE

2. **backend/src/models/productModel.js**
   - Ajout CTE `bundle_sub_items` dans `getAllForStats()`
   - Ajout CTE `bundle_sub_items` dans `getVariationsForStats()`
   - Inclusion du type 'woosb' dans les WHERE clauses
   - Exclusion des bundle sub-items des agrégations de stats

3. **backend/migrations/add_woosb_ids_column.sql**
   - Nouvelle migration SQL pour ajouter la colonne

4. **DATABASE_SCHEMA.md**
   - Documentation du nouveau champ `woosb_ids`
   - Ajout du type 'woosb' dans les relations produits

5. **backend/run-migration.sh**
   - Script pour exécuter les migrations

6. **backend/migrations/README.md**
   - Documentation des migrations

## Instructions de déploiement

Voir le fichier [MIGRATION_INSTRUCTIONS.md](./MIGRATION_INSTRUCTIONS.md) pour les étapes détaillées.

**Résumé :**
1. Push des changements vers le VPS
2. Pull sur le VPS
3. Exécution de la migration : `./run-migration.sh migrations/add_woosb_ids_column.sql`
4. Redémarrage du backend : `pm2 restart youvape-api`
5. Resynchronisation des produits bundles depuis WordPress

## Résultats attendus

Après déploiement :
- ✅ Les produits individuels n'affichent plus de marges négatives dues aux bundles
- ✅ Les quantités vendues sont exactes (uniquement les ventes réelles, pas les inclusions dans des bundles)
- ✅ Les bundles apparaissent dans la liste avec leurs propres statistiques
- ✅ Les coûts et marges sont calculés correctement
- ✅ Distinction claire entre vente individuelle et vente via bundle

## Test de vérification

Pour vérifier que la solution fonctionne :

1. Vérifier qu'un produit qui était dans un bundle (ex: 11674) n'a plus de marge négative
2. Vérifier que la quantité vendue correspond aux ventes réelles
3. Vérifier que le bundle lui-même (ex: 402597) apparaît avec ses stats correctes
4. Comparer les stats avant/après pour un produit connu

**Produits de test :**
- Bundle : 402597 (Pack Cinema Découverte)
- Produits dans le bundle : 11674, 11463, 11278
