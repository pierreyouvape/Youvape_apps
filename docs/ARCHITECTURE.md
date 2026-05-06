# Architecture — Youvape Apps

## Vue d'ensemble

Application interne de gestion e-commerce, connectée à WooCommerce via un plugin WordPress (YouSync).

```
WordPress / WooCommerce
        |
   [YouSync Plugin]  ──── webhooks ────┐
        |                              |
   REST API WC                         |
        |                              ▼
   [Backend Node.js]  ◄────────  PostgreSQL
        |
   [Frontend React]
```

---

## Infrastructure

| Composant      | Technologie         | Docker             |
|----------------|---------------------|--------------------|
| Backend        | Node.js / Express   | `youvape_backend`  |
| Frontend       | React / Vite        | `youvape_frontend` |
| Base de données| PostgreSQL          | `youvape_postgres` |

Tous les conteneurs sont sur le même réseau Docker. Le VPS est accessible via SSH alias `youvape`.

---

## Backend — `backend/src/`

Architecture en couches classique :

```
server.js
    └── routes/          → définition des endpoints HTTP
         └── controllers/ → traitement requête/réponse
              └── models/  → requêtes SQL
              └── services/ → logique métier complexe
```

### Couches

**`routes/`** — Déclaration des endpoints, association route → controller. Pas de logique.

**`controllers/`** — Reçoit la requête HTTP, valide les paramètres, appelle model ou service, renvoie la réponse JSON.

**`models/`** — Accès direct à la BDD via `pg`. Requêtes SQL. Retourne des données brutes ou formatées.

**`services/`** — Logique métier qui dépasse un simple accès BDD : calculs, orchestration multi-models, appels API externes.

**`middleware/`** — `authMiddleware.js` (vérification JWT), `permissionMiddleware.js` (contrôle d'accès par rôle).

**`parsers/`** — Parseurs de fichiers fournisseurs (PDF/CSV). Un fichier par fournisseur.

**`transformers/`** — Normalisation des données WooCommerce avant insertion en BDD (commandes, clients, produits, remboursements).

**`config/`** — Connexion PostgreSQL (`database.js`).

**`utils/`** — Fonctions utilitaires partagées (dates, recherche).

### Services principaux

| Service | Rôle |
|---|---|
| `wcSyncService.js` | Sync WooCommerce → BDD (commandes, clients, produits) |
| `cronService.js` | Tâches planifiées (sync BMS, alertes stock…) |
| `emailService.js` | Envoi d'emails (via SMTP configuré en BDD) |
| `alertService.js` | Détection et envoi d'alertes stock |
| `statsService.js` | Calculs KPIs et statistiques |
| `rewardService.js` | Gestion programme de fidélité |
| `stockResyncService.js` | Re-synchronisation des stocks |

### APIs externes consommées

| API | Usage |
|---|---|
| WooCommerce REST API | Sync produits / commandes / clients |
| BMS (BoostMyShop myFulfillment) | Commandes fournisseurs, stocks |
| La Poste | Génération étiquettes |
| Gmail API | Parsing emails Revolut |

---

## Frontend — `frontend/src/`

```
main.jsx
    └── App.jsx          → routeur React Router, protection des routes
         └── pages/      → une page par grande fonctionnalité
              └── components/ → composants réutilisables par domaine
```

### Pages (routes principales)

| Page | Route | Description |
|---|---|---|
| `Home.jsx` | `/` | Accueil / dashboard |
| `PackingApp.jsx` | `/packing` | Préparation des commandes |
| `OrdersApp.jsx` | `/orders` | Liste et gestion des commandes |
| `OrderDetail.jsx` | `/orders/:id` | Détail d'une commande |
| `CustomersApp.jsx` | `/customers` | Liste clients |
| `CustomerDetail.jsx` | `/customers/:id` | Fiche client |
| `ProductsApp.jsx` | `/products` | Catalogue produits |
| `ProductDetail.jsx` | `/products/:id` | Fiche produit |
| `CatalogApp.jsx` | `/catalog` | Gestion catalogue (marques, catégories) |
| `StatsApp.jsx` | `/stats` | Statistiques et KPIs |
| `PurchasesApp.jsx` | `/purchases` | Commandes fournisseurs + besoins |
| `ImportPdfPage.jsx` | `/import-pdf` | Import factures fournisseurs |
| `EmailApp.jsx` | `/email` | Campagnes email |
| `ReviewsApp.jsx` | `/reviews` | Avis clients |
| `RewardsApp.jsx` | `/rewards` | Programme fidélité |
| `SettingsApp.jsx` | `/settings` | Paramètres de l'app |

### Composants organisés par domaine

```
components/
├── charts/        → graphiques Recharts (CA, pays, horaires…)
├── filters/       → composants de filtres (période…)
├── purchases/     → onglets Besoins / Commandes / Fournisseurs
└── stats/         → onglets de l'app Stats
```

### Contexte et hooks

| Fichier | Rôle |
|---|---|
| `context/AuthContext.jsx` | État d'authentification global (JWT, user) |
| `hooks/usePermissions.js` | Vérification des droits de l'utilisateur courant |
| `hooks/useColumnPreferences.js` | Persistance des colonnes visibles par tableau |

### Utilitaires

| Fichier | Rôle |
|---|---|
| `utils/dateUtils.js` | Formatage dates (ne jamais utiliser `new Date(string)` directement) |
| `utils/formatNumber.js` | Formatage monétaire et nombres |
| `utils/countries.js` | Liste pays (codes ISO → noms) |

---

## Authentification

JWT stocké côté client. Toutes les routes backend (sauf `/auth`) passent par `authMiddleware`. Les permissions par fonctionnalité sont gérées par `permissionMiddleware` et consultables via `usePermissions` côté frontend.

---

## Flux de données principaux

**Sync WooCommerce → BDD**
```
YouSync Plugin (WP) → POST /api/sync/* → wcSyncService → transformers → BDD
                    ou webhook → webhookController
```

**Commandes fournisseurs (BMS)**
```
BMS API → bmsApiModel → purchaseOrderModel → BDD
Cron toutes les 30 min (9h–19h, lun–ven)
```

**Import factures PDF**
```
Upload PDF → pdfImportModel → parsers/[fournisseur]Parser → BDD (product_suppliers)
```

**Génération étiquettes La Poste**
```
Frontend (PackingApp) → laposteController → API La Poste → PDF étiquette
```
