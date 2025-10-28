# Guide de Mise à Jour - Youvape Sync

## 🐛 Correction v1.0.1 - Bug comptage des commandes

### Problème identifié
Le plugin affichait **0 commandes** alors qu'il y en avait dans WooCommerce.

### Cause
La fonction `wc_orders_count('')` utilisée n'existe pas dans WooCommerce.

### Solution appliquée
✅ Implémentation d'un système de comptage compatible avec :
- **WooCommerce 8.0+** : HPOS (High-Performance Order Storage)
- **WooCommerce legacy** : Système classique via `wp_posts`

Le plugin détecte automatiquement quel système est utilisé.

---

## 📦 Installation de la mise à jour

### Méthode 1 : Mise à jour via WordPress (recommandée)

1. **Télécharger le nouveau ZIP**
   - Fichier : `youvape-sync.zip` (version 1.0.1)

2. **Désactiver l'ancienne version**
   - WordPress Admin → **Extensions**
   - Trouver "Youvape Sync"
   - Cliquer sur **Désactiver**

3. **Supprimer l'ancienne version**
   - Cliquer sur **Supprimer**
   - ⚠️ **Ne pas s'inquiéter** : la configuration sera préservée dans `wp_options`

4. **Installer la nouvelle version**
   - **Extensions** → **Ajouter**
   - **Téléverser une extension**
   - Choisir `youvape-sync.zip` (v1.0.1)
   - **Installer maintenant** → **Activer**

5. **Vérifier**
   - Aller dans **Youvape Sync**
   - Vérifier que le nombre de commandes s'affiche correctement
   - La configuration est préservée

---

### Méthode 2 : Mise à jour manuelle (FTP)

1. **Se connecter en FTP**
2. **Sauvegarder l'ancien dossier** (optionnel)
   ```
   /wp-content/plugins/youvape-sync/ → youvape-sync-backup/
   ```
3. **Supprimer l'ancien dossier**
   ```
   /wp-content/plugins/youvape-sync/
   ```
4. **Uploader le nouveau dossier**
   ```
   Extraire module_wc/ du ZIP
   Renommer en youvape-sync/
   Uploader dans /wp-content/plugins/
   ```
5. **Activer dans WordPress**
   - **Extensions** → Activer "Youvape Sync"

---

## ✅ Vérification après mise à jour

### 1. Version du plugin
- Aller dans **Extensions** → **Extensions installées**
- Vérifier que "Youvape Sync" affiche **Version 1.0.1**

### 2. Comptage des commandes
- Aller dans **Youvape Sync**
- Onglet **Import Historique**
- Vérifier que le nombre de commandes s'affiche correctement
  - Avant : **0 commandes** ❌
  - Après : **48 901 commandes** ✅ (ou votre nombre réel)

### 3. Configuration préservée
- Onglet **Configuration**
- Vérifier que l'URL de l'API est toujours présente
- Vérifier que tous les paramètres sont conservés

---

## 🔍 Test de la correction

### Test rapide
1. Aller dans **Youvape Sync** → **Import Historique**
2. Vérifier les totaux affichés :
   - Clients : **48 901** ✅
   - Produits : **2 651** ✅
   - Commandes : **Doit afficher le nombre réel** ✅ (pas 0)

### Test complet
1. **Lancer un import batch** sur un petit lot
2. Vérifier que les commandes sont bien récupérées
3. Consulter les logs pour vérifier qu'il n'y a pas d'erreur

---

## 📋 Changements techniques

### Fichiers modifiés
1. **`includes/class-batch-processor.php`**
   - Lignes 481-504
   - Fonction `count_totals()`
   - Ajout détection HPOS vs Legacy

2. **`admin/settings-page.php`**
   - Lignes 17-40
   - Comptage initial des commandes
   - Même logique que batch-processor

3. **`youvape-sync.php`**
   - Version passée de 1.0.0 à 1.0.1

### Code ajouté
```php
// WooCommerce 8.0+ utilise HPOS (High-Performance Order Storage)
if (class_exists('Automattic\WooCommerce\Utilities\OrderUtil') &&
    method_exists('Automattic\WooCommerce\Utilities\OrderUtil', 'custom_orders_table_usage_is_enabled') &&
    \Automattic\WooCommerce\Utilities\OrderUtil::custom_orders_table_usage_is_enabled()) {
    // HPOS activé : utiliser wc_get_orders avec limit -1
    $order_count = count(wc_get_orders(array(
        'limit' => -1,
        'return' => 'ids',
    )));
} else {
    // Legacy : compter via wp_posts
    global $wpdb;
    $order_count = $wpdb->get_var("
        SELECT COUNT(ID)
        FROM {$wpdb->posts}
        WHERE post_type IN ('shop_order', 'shop_order_placehold')
    ");
}
```

---

## 🛡️ Sécurité

- ✅ **Configuration préservée** : Stockée dans `wp_options`, pas dans les fichiers du plugin
- ✅ **Aucune perte de données** : La mise à jour ne touche pas à la base de données
- ✅ **Pas d'import en cours** : Si un import est en cours, l'arrêter avant la mise à jour

---

## ⚠️ Important

### Avant la mise à jour
- Arrêter tout import batch en cours
- Noter l'URL de l'API (par sécurité)
- Vérifier que vous avez les droits administrateur

### Après la mise à jour
- Vérifier que les totaux sont corrects
- Tester l'import batch sur un petit lot
- Vérifier les logs

---

## 📞 Support

Si après la mise à jour :
- Les commandes s'affichent toujours à 0 → Télécharger les logs et contacter le support
- L'import batch ne fonctionne pas → Vérifier les logs WordPress (`/wp-content/debug.log`)
- La configuration a disparu → Elle est dans `wp_options`, vérifier les clés `youvape_sync_*`

---

## 📊 Changelog complet

Voir [CHANGELOG.md](CHANGELOG.md) pour l'historique complet des versions.
