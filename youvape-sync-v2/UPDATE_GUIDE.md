# Guide de mise à jour vers v2.2.0

## 🎯 Objectif de la mise à jour

Cette version permet d'importer **indépendamment** :
- Les **clients** seuls
- Les **produits** seuls
- Les **commandes** seules

Avant, vous deviez importer clients + produits ensemble avec le bouton "Process DATA".

---

## 📦 Installation de la mise à jour

### Méthode 1 : Remplacement manuel (WordPress)

1. **Désactiver le plugin** (sans le désinstaller !)
   - WordPress Admin → Extensions → Youvape Sync v2 → Désactiver

2. **Supprimer l'ancien dossier** du plugin
   ```bash
   cd /path/to/wordpress/wp-content/plugins/
   rm -rf youvape-sync-v2/
   ```

3. **Uploader le nouveau dossier**
   - Zipper le dossier `youvape-sync-v2/`
   - Uploader via WordPress Admin → Extensions → Ajouter → Téléverser
   - OU via FTP/SSH : copier le dossier dans `wp-content/plugins/`

4. **Réactiver le plugin**
   - WordPress Admin → Extensions → Youvape Sync v2 → Activer

### Méthode 2 : Via Git (si votre WordPress est sous Git)

```bash
cd /path/to/wordpress/wp-content/plugins/youvape-sync-v2/
git pull origin main
```

Puis dans WordPress Admin → Extensions → vérifier que la version 2.2.0 s'affiche.

---

## ✅ Vérification de la mise à jour

1. Aller dans **WordPress Admin → Youvape Sync**

2. Vérifier que vous voyez **3 nouveaux boutons** :
   ```
   🟢 Process CUSTOMERS
   🔴 Process PRODUCTS
   🔵 Process ORDERS
   ```

3. Vérifier que l'ancien bouton est toujours présent dans la section "Legacy" :
   ```
   🔄 Process DATA (Customers + Products together)
   ```

4. Vérifier en bas de la page : **Version 2.2.0**

---

## 🔧 Compatibilité et données existantes

### Pas de perte de données
- ✅ Les offsets de synchronisation sont **préservés**
- ✅ L'historique des logs est **conservé**
- ✅ Les paramètres API sont **inchangés**

### Si vous aviez une sync en cours
- ✅ Vous pouvez **continuer** avec les nouveaux boutons
- ✅ Les offsets `customers_offset`, `products_offset`, `orders_offset` sont **compatibles**
- ✅ Pas besoin de reset

---

## 🚀 Utilisation après mise à jour

### Cas 1 : Nouvelle synchronisation complète

```
1. Cliquer sur "Start Full Sync"
2. Utiliser les 3 nouveaux boutons dans l'ordre :
   → Process CUSTOMERS (jusqu'à 100%)
   → Process PRODUCTS (jusqu'à 100%)
   → Process ORDERS (jusqu'à 100%)
```

### Cas 2 : Réimporter uniquement les produits

```
1. Cliquer sur "Start Full Sync" (ou "Resume" si déjà démarré)
2. Cliquer uniquement sur "Process PRODUCTS"
   → Ajuster le "Number of batches" selon vos besoins
   → Les produits seront réimportés (UPDATE si déjà existants)
```

### Cas 3 : Continuer une sync en cours

```
1. Vérifier le statut actuel (barre de progression)
2. Si customers = 50% → cliquer sur "Process CUSTOMERS"
3. Si products = 30% → cliquer sur "Process PRODUCTS"
4. Si orders = 0% → cliquer sur "Process ORDERS"
```

---

## 🆘 En cas de problème

### Le plugin ne s'active pas
```bash
# Vérifier les logs WordPress
tail -f /path/to/wordpress/wp-content/debug.log

# Vérifier les permissions
chmod -R 755 /path/to/wordpress/wp-content/plugins/youvape-sync-v2/
```

### Les nouveaux boutons n'apparaissent pas
```bash
# Vider le cache WordPress (si vous utilisez un plugin de cache)
# Vider le cache du navigateur (Ctrl+Shift+R)

# Vérifier la version dans le fichier principal
grep "Version:" youvape-sync-v2.php
# Devrait afficher : Version: 2.2.0
```

### Les offsets ont été perdus
```sql
-- Vérifier dans la base de données WordPress
SELECT * FROM wp_options WHERE option_name = 'youvape_sync_v2_queue_state';

-- Si vide, faire un "Start Full Sync" pour réinitialiser
```

---

## 📞 Support

En cas de problème, vérifier :
1. Version PHP ≥ 7.4
2. Version WordPress ≥ 5.8
3. WooCommerce installé et actif
4. API VPS accessible (Settings → API URL)

Logs disponibles dans :
- `wp-content/plugins/youvape-sync-v2/debug.log`
- WordPress Admin → Youvape Sync → voir les logs en bas de page
