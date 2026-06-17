-- ─────────────────────────────────────────────────────────────────────────────
-- Libellé client des statuts SAV (espace "Mes demandes au service client").
--
-- Chaque statut interne (sav_ticket_statuses.value) a un libellé interne (label,
-- vu par les agents) ET un libellé client (client_label, vu par le client dans
-- son compte WooCommerce). Modèle façon Zendesk : plusieurs statuts internes
-- peuvent partager le même libellé client (ex. "on-hold" et "open" → "En cours
-- de traitement").
--
-- client_label sera rendu OBLIGATOIRE dans l'UI admin avant le go-live de
-- l'espace client. La colonne reste nullable en base ; côté API client, un
-- garde-fou défensif affiche "En cours de traitement" si client_label est NULL,
-- pour ne JAMAIS exposer un libellé interne au client par accident.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sav_ticket_statuses
  ADD COLUMN IF NOT EXISTS client_label TEXT DEFAULT NULL;
