-- ─────────────────────────────────────────────────────────────────────────────
-- Suivi du tag « Ticket » posé sur la commande BMS associée à un ticket SAV.
--
-- Quand un ticket est créé/lié à une commande, on pose le tag BMS (id 5) sur la
-- commande via l'API. On mémorise ici la référence de commande effectivement
-- taguée côté BMS pour :
--   - l'idempotence : ne pas re-taguer une commande déjà taguée ;
--   - le détag : si le order_id du ticket change, retirer le tag de l'ancienne
--     commande avant de taguer la nouvelle.
--
-- NULL = pas encore tagué (ou échec). On ne traite que les nouveaux tickets /
-- nouvelles liaisons (pas de rétroactif).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS bms_tagged_order_ref VARCHAR(64) DEFAULT NULL;
