#!/bin/bash

# Script to run database migrations
# Usage: ./run-migration.sh <migration-file.sql>

if [ -z "$1" ]; then
  echo "Usage: $0 <migration-file.sql>"
  echo "Example: $0 migrations/add_woosb_ids_column.sql"
  exit 1
fi

MIGRATION_FILE="$1"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Error: Migration file '$MIGRATION_FILE' not found"
  exit 1
fi

echo "Running migration: $MIGRATION_FILE"
echo "----------------------------------------"

# Run the migration using docker compose
docker compose exec -T postgres psql -U youvape -d youvape_db < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
  echo "----------------------------------------"
  echo "✓ Migration completed successfully"
else
  echo "----------------------------------------"
  echo "✗ Migration failed"
  exit 1
fi
