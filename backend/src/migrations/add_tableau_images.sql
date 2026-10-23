-- ============================================================================
-- App Tableau — images : posées seules sur le tableau, ou dans le texte d'un post-it
-- ============================================================================
-- kind = 'note'  : post-it ; `content` devient du HTML (images comprises). Les
--                  post-its en texte brut sont convertis à la lecture, rien n'est
--                  réécrit ici (utils/tableauMedia.js → asHtml).
-- kind = 'image' : image collée seule, fichier dans `image_file` (volume
--                  tableau_uploads).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_tableau_images.sql
-- Rollback (après avoir supprimé les images seules) :
--   ALTER TABLE tableau_notes DROP COLUMN kind, DROP COLUMN image_file;
-- ============================================================================

ALTER TABLE tableau_notes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'image')),
  ADD COLUMN IF NOT EXISTS image_file TEXT;
