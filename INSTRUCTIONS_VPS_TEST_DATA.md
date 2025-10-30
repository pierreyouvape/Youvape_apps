# Instructions de déploiement - Système de données de test avec pagination

## ✅ Ce qui a été fait en local

1. **Service backend** : `backend/src/services/testDataService.js`
   - Génération de données de test (clients, produits, commandes)
   - Système d'offset/pagination pour éviter les doublons
   - Gestion des offsets dans `app_config`

2. **Controller** : `backend/src/controllers/testDataController.js`
   - Endpoints pour générer des données de test
   - Endpoints pour gérer les offsets

3. **Routes** : `backend/src/routes/testDataRoutes.js`
   - Routes API pour les données de test

4. **Module WooCommerce** : `module_wc/includes/class-batch-processor.php`
   - Modifié pour utiliser la nouvelle API de génération

5. **Serveur** : `backend/src/server.js`
   - Ajout des routes de test

---

## 📋 Actions à faire sur le VPS

### Étape 1 : Initialiser les offsets dans la base de données

Connectez-vous à PostgreSQL et exécutez :

```sql
-- Initialise les offsets de test à 0
INSERT INTO app_config (config_key, config_value, updated_at)
VALUES
  ('test_customers_offset', '0', NOW()),
  ('test_products_offset', '0', NOW()),
  ('test_orders_offset', '0', NOW())
ON CONFLICT (config_key) DO NOTHING;
```

### Étape 2 : Déployer les nouveaux fichiers backend

```bash
# Se connecter au VPS
ssh user@54.37.156.233

# Aller dans le dossier du projet
cd /path/to/Youvape_apps

# Synchroniser les fichiers depuis votre machine locale
# (ou via git pull si vous avez commit les changements)

# Redémarrer le backend
docker compose restart backend
# OU si vous utilisez PM2 ou autre:
# pm2 restart backend
```

### Étape 3 : Déployer le module WooCommerce modifié

```bash
# Sur votre machine locale, créer un zip du module
cd /Users/pierremerle/Documents/Youvape/Youvape_apps/module_wc
zip -r youvape-sync-v1.1.0.zip . -x "*.git*" "*.DS_Store"

# Uploader sur WordPress et remplacer l'ancien module
# OU via FTP/SSH, copier le fichier class-batch-processor.php modifié
```

### Étape 4 : Vérifier que tout fonctionne

```bash
# Tester l'endpoint de génération
curl -X POST http://54.37.156.233:3000/api/test/generate \
  -H "Content-Type: application/json" \
  -d '{"customers": 5, "products": 10, "orders": 15}'

# Vérifier les offsets
curl http://54.37.156.233:3000/api/test/offsets

# Reset les offsets (si besoin)
curl -X DELETE http://54.37.156.233:3000/api/test/offsets
```

---

## 🎯 Nouveaux endpoints disponibles

### 1. Générer des données de test
**POST** `/api/test/generate`

```json
{
  "customers": 25,
  "products": 50,
  "orders": 100
}
```

**Réponse :**
```json
{
  "success": true,
  "message": "Données de test générées et importées avec succès",
  "counts": {
    "customers": 25,
    "products": 50,
    "orders": 100
  },
  "import_results": {
    "customers": { "inserted": 25, "updated": 0 },
    "products": { "inserted": 50, "updated": 0 },
    "orders": { "inserted": 100, "updated": 0 }
  },
  "offsets": {
    "previous": { "customers": 0, "products": 0, "orders": 0 },
    "new": { "customers": 25, "products": 50, "orders": 100 }
  }
}
```

### 2. Voir les offsets actuels
**GET** `/api/test/offsets`

```json
{
  "success": true,
  "offsets": {
    "customers": 25,
    "products": 50,
    "orders": 100
  }
}
```

### 3. Reset les offsets
**DELETE** `/api/test/offsets`

```json
{
  "success": true,
  "message": "Offsets de test réinitialisés à 0"
}
```

### 4. Supprimer TOUTES les données
**DELETE** `/api/test/data`

⚠️ **ATTENTION** : Ceci supprime TOUTES les données (pas seulement les données de test)

```json
{
  "success": true,
  "message": "Toutes les données de test ont été supprimées et les offsets réinitialisés"
}
```

---

## 🔄 Fonctionnement du système de pagination

### Exemple d'utilisation

**Import 1 :**
```bash
POST /api/test/generate
{ "customers": 25, "products": 50, "orders": 100 }
```
→ Génère customers 1-25, products 1-50, orders 1-100
→ Offsets deviennent: 25, 50, 100

**Import 2 :**
```bash
POST /api/test/generate
{ "customers": 25, "products": 50, "orders": 100 }
```
→ Génère customers 26-50, products 51-100, orders 101-200
→ Offsets deviennent: 50, 100, 200

**Import 3 :**
```bash
POST /api/test/generate
{ "customers": 50, "products": 25, "orders": 50 }
```
→ Génère customers 51-100, products 101-125, orders 201-250
→ Offsets deviennent: 100, 125, 250

### Avantages

✅ **Pas de doublons** : Chaque import génère de nouveaux IDs
✅ **Prévisible** : Les IDs sont séquentiels (1, 2, 3...)
✅ **Flexible** : Vous choisissez la quantité à chaque import
✅ **Réversible** : Reset possible pour recommencer à zéro

---

## 🧪 Tests depuis le module WooCommerce

1. Aller sur WordPress → YouVape Sync → Onglet "Test"
2. Entrer les quantités souhaitées (ex: 25 clients, 50 produits, 100 commandes)
3. Cliquer sur "Envoyer l'échantillon test"
4. Le module appelle automatiquement `/api/test/generate`
5. Les données sont générées et importées côté backend
6. Vous pouvez relancer autant de fois que vous voulez pour accumuler des données

---

## 📝 Notes importantes

1. **Les IDs sont uniques** : Grâce au système d'offset, chaque nouvelle génération crée des IDs différents
2. **ON CONFLICT DO UPDATE** : Si vous générez deux fois le même ID (après un reset par exemple), les données seront mises à jour au lieu de créer une erreur
3. **Commandes requièrent des clients et produits** : Le système récupère automatiquement les 20 derniers clients et produits pour générer des commandes réalistes
4. **Données réalistes** : Noms français, emails uniques, dates aléatoires, prix cohérents

---

## 🔧 Si besoin de modifier les données générées

Les templates de génération sont dans `testDataService.js` :
- `generateCustomers()` : Ligne 66
- `generateProducts()` : Ligne 117
- `generateOrders()` : Ligne 156

Vous pouvez modifier les noms, produits, prix, etc. selon vos besoins.
