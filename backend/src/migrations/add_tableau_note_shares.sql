-- ============================================================================
-- App Tableau : post-its PARTAGÉS (04/11/2026)
--
-- Un post-it partagé reste UN seul post-it (tableau_notes) : texte, images, PDF
-- et couleur sont communs, toute modification se voit chez chacun. Chaque
-- participant garde sa propre place sur son tableau (x, y, taille, plan), ici.
--
-- accepted_at NULL = partage proposé, en attente de réponse (boîte de réception).
-- Refus = la ligne est supprimée. Le propriétaire (tableau_notes.owner_id) n'a
-- pas de ligne : sa place reste sur tableau_notes.
--
-- Supprimer le post-it (propriétaire) le retire de tous les tableaux (CASCADE).
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_tableau_note_shares.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS tableau_note_shares (
  note_id      INTEGER NOT NULL REFERENCES tableau_notes(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  shared_by    INTEGER REFERENCES users(id),
  x            INTEGER NOT NULL DEFAULT 40,
  y            INTEGER NOT NULL DEFAULT 40,
  width        INTEGER NOT NULL DEFAULT 220,
  height       INTEGER NOT NULL DEFAULT 200,
  z            INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  accepted_at  TIMESTAMP,
  PRIMARY KEY (note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tableau_note_shares_user ON tableau_note_shares (user_id);
