-- Retour arrière de add_inventaire_emplacement.sql : supprime les passages et
-- les dossiers « par emplacement ». Les mouvements déjà envoyés à BMS restent.

BEGIN;

DROP TABLE IF EXISTS inventory_spot_lines;
DROP TABLE IF EXISTS inventory_spot_passes;
DELETE FROM inventories WHERE kind = 'location';
ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_kind_check;
ALTER TABLE inventories ADD CONSTRAINT inventories_kind_check CHECK (kind IN ('global', 'partial'));

COMMIT;
