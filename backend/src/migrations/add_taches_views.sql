-- ============================================================================
-- App Tâches — vues enregistrées (équivalent des tableaux de bord Monday
-- « SEO (Jib) », « Blog (Jib) »… : une liste filtrée, rangée dans le menu)
-- ============================================================================
-- filters (JSON) : { board_id, label, priority, status, person, openOnly,
--   hideDone, q } — mêmes filtres que la barre du Tableau principal.
-- Communes à l'équipe ; created_by = qui l'a créée.
--
-- Additive seulement. À appliquer sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches_views.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS taches_views (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  filters     JSONB NOT NULL DEFAULT '{}',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'Europe/Paris')
);
