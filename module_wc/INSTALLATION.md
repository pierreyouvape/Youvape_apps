# Guide d'Installation - Youvape Sync

## 📦 Installation via ZIP WordPress

### Étape 1 : Créer le ZIP

Depuis le répertoire contenant le dossier `module_wc`, exécutez :

```bash
cd /Users/pierremerle/Documents/Youvape/Youvape_apps
zip -r youvape-sync.zip module_wc/ -x "*.DS_Store" "*/.*" "*/__pycache__/*"
```

Ou manuellement :
1. Sélectionner le dossier `module_wc`
2. Clic droit → Compresser "module_wc"
3. Renommer `module_wc.zip` en `youvape-sync.zip`

### Étape 2 : Installer dans WordPress

1. **Aller dans WordPress Admin**
   - Connexion à votre site WordPress
   - Menu **Extensions** → **Ajouter**

2. **Téléverser le plugin**
   - Cliquer sur **Téléverser une extension**
   - Cliquer sur **Choisir un fichier**
   - Sélectionner `youvape-sync.zip`
   - Cliquer sur **Installer maintenant**

3. **Activer le plugin**
   - Une fois l'installation terminée, cliquer sur **Activer**
   - Le plugin apparaît maintenant dans le menu latéral : **Youvape Sync**

### Étape 3 : Configuration

1. **Accéder aux paramètres**
   - Menu **Youvape Sync** dans le panneau d'administration

2. **Configurer l'API** (onglet Configuration)
   - **URL de l'API** : `https://api.youvape.com` (votre API Node.js)
   - **Clé API** : Token Bearer si nécessaire (optionnel)
   - **Taille des lots** : 25 (recommandé)
   - **Types de données** : Cocher Clients, Produits, Commandes
   - **Synchro live** : Activer
   - **Délai synchro live** : 60 secondes

3. **Tester la connexion**
   - Cliquer sur **Tester la connexion**
   - Vérifier que la connexion à l'API fonctionne

4. **Sauvegarder**
   - Cliquer sur **Sauvegarder les paramètres**

## 🔄 Installation manuelle (FTP)

Si vous préférez installer manuellement :

1. **Uploader via FTP**
   ```
   /wp-content/plugins/youvape-sync/
   ```

2. **Structure attendue**
   ```
   /wp-content/plugins/youvape-sync/
   ├── youvape-sync.php
   ├── includes/
   ├── admin/
   └── README.md
   ```

3. **Activer dans WordPress**
   - Extensions → Extensions installées
   - Trouver "Youvape Sync"
   - Cliquer sur **Activer**

## ✅ Vérification de l'installation

### 1. Plugin activé
- Le menu **Youvape Sync** apparaît dans le panneau d'administration
- Icône : ⟳ (symbole de synchronisation)

### 2. WooCommerce requis
- Si WooCommerce n'est pas installé, un message d'erreur apparaît
- Le plugin se désactive automatiquement

### 3. Configuration visible
- 4 onglets disponibles : Configuration, Import Historique, Synchro Live, Logs
- Statistiques affichées (nombre de clients, produits, commandes)

## 🚀 Utilisation

### Import Historique

1. Aller dans l'onglet **Import Historique**
2. Vérifier les totaux (clients, produits, commandes)
3. Cliquer sur **Lancer l'import historique**
4. Suivre la progression en temps réel
5. L'import se fait automatiquement : Clients → Produits → Commandes

### Synchro Live

Une fois activée :
- Les nouveaux clients/produits/commandes sont synchronisés automatiquement
- Délai de 60 secondes (configurable) avant envoi
- Vérifier la file d'attente dans l'onglet **Synchro Live**

### Export des Logs

1. Aller dans l'onglet **Logs**
2. Cliquer sur **Télécharger les logs (.txt)**
3. Un fichier `youvape-sync-logs-YYYY-MM-DD-HHMMSS.txt` est téléchargé
4. Le fichier contient :
   - Configuration actuelle
   - Statut de l'import batch
   - Queue de synchro live
   - Erreurs éventuelles
   - Informations système

## 🔧 Dépannage

### Le plugin ne s'active pas
- ✅ Vérifier que WooCommerce est installé et activé
- ✅ Vérifier la version PHP (7.4 minimum)
- ✅ Vérifier les permissions des fichiers (644 pour les fichiers, 755 pour les dossiers)

### Test de connexion échoue
- ✅ Vérifier l'URL de l'API (doit commencer par `http://` ou `https://`)
- ✅ Vérifier que l'API est accessible depuis le serveur WordPress
- ✅ Vérifier le certificat SSL si HTTPS
- ✅ Créer un endpoint `/api/woo-sync/ping` sur l'API

### Import batch ne démarre pas
- ✅ Vérifier que l'API est configurée
- ✅ Vérifier qu'au moins un type de données est activé
- ✅ Consulter les logs WordPress : `/wp-content/debug.log`

### Mode Debug

Activer le mode debug WordPress pour voir les logs détaillés :

```php
// wp-config.php
define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);
```

Les logs seront dans `/wp-content/debug.log`

## 🗑️ Désinstallation

1. **Désactiver le plugin**
   - Extensions → Extensions installées
   - Trouver "Youvape Sync"
   - Cliquer sur **Désactiver**

2. **Supprimer le plugin**
   - Cliquer sur **Supprimer**
   - Confirmer la suppression

3. **Nettoyage manuel (optionnel)**

Les options WordPress restent après désinstallation. Pour les supprimer manuellement :

```sql
DELETE FROM wp_options WHERE option_name LIKE 'youvape_sync_%';
```

Ou depuis phpMyAdmin :
- Chercher dans la table `wp_options`
- Supprimer les lignes commençant par `youvape_sync_`

## 📞 Support

Pour toute question ou problème, contacter l'équipe technique Youvape.

## 🔐 Sécurité

- Toutes les requêtes AJAX sont protégées par nonce
- Seuls les administrateurs (`manage_options`) peuvent accéder aux paramètres
- La clé API est stockée de manière sécurisée dans `wp_options`
- Le plugin fonctionne en mode lecture seule sur WooCommerce

## 📋 Prérequis

- WordPress 5.8+
- WooCommerce 5.0+
- PHP 7.4+
- API Node.js opérationnelle

## 📄 Licence

Propriétaire - Youvape © 2025
