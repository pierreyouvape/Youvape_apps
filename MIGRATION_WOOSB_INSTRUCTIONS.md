# Migration woosb_ids : PHP → JSON

## Commandes à exécuter sur le VPS

### 1. Se connecter au VPS et aller dans le dossier backend

```bash
cd /var/www/Youvape_apps/backend
```

### 2. Exécuter le script de migration

```bash
node migrations/convert_woosb_ids_to_json.js
```

**Ce que fait le script :**
- Lit tous les produits bundles (type woosb)
- Parse les données PHP serialized
- Les convertit en JSON propre : `[{"id": "11152", "qty": "10"}, ...]`
- Met à jour la base de données
- Affiche un résumé de la migration

**Résultat attendu :**
```
🔄 Starting woosb_ids migration...
📦 Found X bundle products to convert
  ✅ 14742 - "Pack 10 Boosters YouBoost 50/50" - Converted 1 item(s)
  ✅ 14744 - "Pack 10 Boosters YouBoost 30/70" - Converted 1 item(s)
  ...
📊 Migration Summary:
  ✅ Converted: X
  ⏭️  Skipped: 0
  ❌ Errors: 0
✨ Migration completed!
```

### 3. Redémarrer le backend

```bash
pm2 restart youvape-api
```

### 4. Vérifier que ça fonctionne

```bash
curl -s "http://54.37.156.233:3000/api/products/stats-list?limit=5&sortBy=margin_ht&sortOrder=ASC" | python3 -m json.tool | head -50
```

**Vous ne devriez PLUS voir de marges négatives aberrantes** pour les produits 11152, 11155, etc.

## En cas de problème

Si le script échoue, vérifier les logs :
```bash
node migrations/convert_woosb_ids_to_json.js 2>&1 | tee migration.log
```

Les données originales ne sont PAS supprimées, juste converties. En cas de problème, on peut restaurer depuis la sauvegarde PostgreSQL.
