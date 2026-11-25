-- ============================================================================
-- Boutiques — RÉCEPTION à plusieurs : « Envoyer mes lignes » (25/11/2026)
-- ============================================================================
-- Chaque personne envoie dans Nextore SES lignes comptées (un achat reçu à part,
-- référence -R2, -R3…), sans motif ; la réception reste ouverte pour les autres.
-- « Valider la réception » reste le geste de fin (motifs des manquants, clôture).
--   boutique_reception_counts.sent         = ligne déjà envoyée par un envoi partiel :
--     elle ne se recompte plus dans cette réception (sinon les pièces déjà en stock
--     entreraient une seconde fois) ; ses pièces sont dans la réception d'historique
--   boutique_reception_sessions.sending_only_by = pendant un envoi partiel, la
--     personne dont les lignes partent : un envoi interrompu se reprend pour ses
--     seules lignes, jamais pour toute la réception
--
-- À appliquer AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_boutique_reception_send_mine.sql
-- ============================================================================

ALTER TABLE boutique_reception_counts
  ADD COLUMN IF NOT EXISTS sent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE boutique_reception_sessions
  ADD COLUMN IF NOT EXISTS sending_only_by TEXT;
