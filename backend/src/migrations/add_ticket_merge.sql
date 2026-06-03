-- Fusion de tickets SAV (façon Zendesk) : un ticket source est fusionné dans
-- un ticket cible (maître). Le source est fermé et pointe vers la cible.
--
-- merged_into_id : si renseigné, ce ticket a été fusionné dans le ticket cible
--                  indiqué. Il reste consultable mais n'est plus actif.
-- merged_at      : horodatage de la fusion.

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS merged_into_id INTEGER REFERENCES sav_tickets(id) ON DELETE SET NULL;

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_sav_tickets_merged_into
  ON sav_tickets(merged_into_id);
