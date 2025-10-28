# Changelog - Youvape Sync

## [1.0.3] - 2025-10-27

### 🐛 HOTFIX CRITIQUE
- **Fix Fatal Error** : Correction de l'erreur "Cannot redeclare fetch_customers()"
  - Suppression des méthodes dupliquées (lignes 692-942)
  - Modification des méthodes `fetch_customers()`, `fetch_products()`, `fetch_orders()` pour accepter un paramètre `$limit` optionnel
  - Le plugin peut maintenant s'activer sans crasher le site
  - **IMPORTANT** : Cette version corrige un bug critique qui rendait la v1.0.2 inutilisable

### 📝 Fichier modifié
- `includes/class-batch-processor.php` : Suppression code dupliqué (252 lignes supprimées)

---

## [1.0.2] - 2025-10-27 ⚠️ VERSION CASSÉE

### ✨ Nouvelles fonctionnalités
- **Fonction de test avec échantillons** : Envoi d'un nombre limité de données pour tester
  - Interface dans l'onglet Configuration
  - Sélection du nombre de clients, produits, commandes à envoyer (défaut: 5 de chaque)
  - Affichage du JSON envoyé (collapsible)
  - Compteurs des items envoyés
  - Parfait pour tester le backend sans charger 48k clients !

### 📝 Fichiers modifiés
- `includes/class-batch-processor.php` : Ajout méthode `send_test_sample()` et wrappers fetch
- `youvape-sync.php` : Ajout endpoint AJAX `wp_ajax_youvape_sync_send_test_sample`
- `admin/settings-page.php` : Ajout interface de test
- `admin/js/admin.js` : Ajout gestion AJAX pour test sample

---

## [1.0.1] - 2025-10-27

### 🐛 Corrections
- **Fix comptage des commandes** : Correction du bug qui affichait 0 commandes
  - Ajout du support pour WooCommerce 8.0+ HPOS (High-Performance Order Storage)
  - Ajout du fallback pour les anciennes versions (lecture via `wp_posts`)
  - Le comptage se fait maintenant correctement sur tous les types de commandes
  - Fichiers modifiés :
    - `includes/class-batch-processor.php` (ligne 481-504)
    - `admin/settings-page.php` (ligne 17-40)

### 📝 Notes techniques
- Le plugin détecte automatiquement si WooCommerce utilise HPOS ou le système legacy
- Compatible avec WooCommerce 5.0 à 8.0+

---

## [1.0.0] - 2025-10-27

### 🎉 Version initiale

#### ✨ Fonctionnalités
- **Import Batch (Historique)**
  - Traitement par lots configurables (défaut: 25 items)
  - Ordre de traitement : Clients → Produits → Commandes
  - Progression temps réel avec barres de progression
  - Gestion erreurs avec retry automatique (3 tentatives)
  - Restriction horaire optionnelle

- **Synchronisation Live (Temps réel)**
  - Détection automatique des événements WooCommerce
  - Délai configurable avant envoi (défaut: 60s)
  - Queue avec envoi groupé
  - Hooks : clients, produits, commandes

- **Interface Admin WordPress**
  - 4 onglets : Configuration, Import Batch, Synchro Live, Logs
  - Test de connexion API
  - Export des logs en fichier .txt téléchargeable
  - Design professionnel responsive

- **Sécurité**
  - Nonce pour toutes les requêtes AJAX
  - Capacité `manage_options` requise
  - Sanitization de tous les inputs
  - Mode lecture seule sur WooCommerce

#### 📦 Installation
- Plugin installable via ZIP WordPress
- Compatible WordPress 5.8+
- Nécessite WooCommerce 5.0+
- Nécessite PHP 7.4+

#### 🏗️ Architecture
- Aucune table DB custom (uniquement `wp_options`)
- Simple proxy HTTP entre WooCommerce et API Node.js
- Classes PHP bien structurées
- Code documenté et commenté
