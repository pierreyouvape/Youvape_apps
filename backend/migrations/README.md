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
