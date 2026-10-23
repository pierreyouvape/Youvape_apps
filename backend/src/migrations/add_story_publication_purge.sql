-- App « Stories » : purge du cache du site après chaque publication.
--
-- Après l'écriture de stories/index.json sur R2, l'app appelle
-- POST <site>/wp-json/youvape-stories/v1/purge : le site relit index.json et
-- vide ses caches (WP Rocket, Cloudflare APO). Une purge ratée n'annule pas la
-- publication (le site la voit au plus tard 5 min après) : on garde ici son
-- résultat pour l'afficher dans l'app.
--
-- purge_status : ok | retrying (nouvel essai programmé) | failed | skipped (non configurée)
ALTER TABLE story_publications ADD COLUMN IF NOT EXISTS purge_status   TEXT;
ALTER TABLE story_publications ADD COLUMN IF NOT EXISTS purge_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE story_publications ADD COLUMN IF NOT EXISTS purge_at       TIMESTAMP;
ALTER TABLE story_publications ADD COLUMN IF NOT EXISTS purge_result   JSONB;
