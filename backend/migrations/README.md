# Database Migrations

Ce dossier contient les migrations de la base de données PostgreSQL.

## Exécuter une migration

### Sur le VPS

```bash
# Se connecter au VPS
ssh user@54.37.156.233

# Aller dans le dossier du projet
cd /var/www/Youvape_apps/backend

# Rendre le script exécutable (première fois seulement)
chmod +x run-migration.sh

# Exécuter la migration
./run-migration.sh migrations/add_woosb_ids_column.sql
```

### En local (si Docker est lancé)

```bash
cd backend
chmod +x run-migration.sh
./run-migration.sh migrations/add_woosb_ids_column.sql
```

## Migrations disponibles

### `add_sav_spam_blocklist.sql`
**Date:** 2026-08-17 — **appliquée en prod le 2026-08-17**
**Description:** Ajoute `is_spam` / `spam_marked_at` / `spam_marked_by` à
`sav_tickets` (+ index partiel sur `is_spam`), et crée la table `sav_blocklist`
(motifs `email` / `domain` / `local` / `contains`, index unique insensible à la
casse) avec 2 motifs de départ.

**Pourquoi:** Le formulaire SAV public envoie un accusé de réception à l'adresse
saisie sans la vérifier — des bots s'en servaient pour tester un relais d'envoi
(9 sondes « Test » les 13 et 14/08/2026, adresse tierce différente à chaque fois).
Le classement spam sort ces demandes des vues, et la blocklist les prive d'accusé
de réception dès la deuxième.

⚠️ **À appliquer AVANT de rebuilder le backend** : sans la colonne `is_spam`,
toutes les requêtes de liste des tickets échouent.

### `add_woosb_ids_column.sql`
**Date:** 2025-11-26
**Description:** Ajoute la colonne `woosb_ids` (JSONB) à la table `products` pour stocker les IDs des produits inclus dans les bundles (type woosb).

**Pourquoi:** Les bundles (WooCommerce Product Bundles) créent des lignes de commande à 0€ pour leurs produits constituants. Cette colonne permet de les identifier et de les exclure des statistiques individuelles des produits.

## Créer une nouvelle migration

1. Créer un fichier `.sql` dans ce dossier avec un nom descriptif
2. Utiliser `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` pour éviter les erreurs si la colonne existe déjà
3. Ajouter des commentaires explicatifs
4. Tester la migration en local avant de l'exécuter sur le VPS
5. Mettre à jour ce README avec la description de la migration
