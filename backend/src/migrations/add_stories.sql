-- App « Stories » : remplacement de Join Stories par une solution maison.
--
-- Une story = une vidéo envoyée par le back-office. La source (180-200 Mo)
-- part directement du navigateur vers le bucket R2 PRIVÉ `youvape-videos-sources`
-- (URL signée), puis le backend la compresse avec ffmpeg et publie les fichiers
-- diffusés dans le bucket PUBLIC `youvape-videos` (servi par videos.youvape.fr).
--
-- Les fichiers publiés sont versionnés (`story.v2.mp4`) et servis en cache
-- immuable : recompresser crée une nouvelle version, l'ancienne n'est JAMAIS
-- supprimée (des e-mails Probance déjà envoyés pointent encore dessus).

CREATE TABLE IF NOT EXISTS stories (
  id                     SERIAL PRIMARY KEY,
  -- Identifiant stable des URL publiques (videos.youvape.fr/stories/<slug>/…)
  -- et de la future page /videos/<slug> : ne change plus une fois la story prête.
  slug                   TEXT NOT NULL UNIQUE,
  title                  TEXT NOT NULL,
  description            TEXT,
  -- portrait = story 9:16 (720×1280) ; landscape = vidéo produit 16:9 (1280×720)
  format                 TEXT NOT NULL DEFAULT 'portrait',
  -- awaiting_upload → uploaded → processing → ready | error ; archived = retirée
  status                 TEXT NOT NULL DEFAULT 'awaiting_upload',
  error                  TEXT,

  -- Source (bucket privé)
  source_key             TEXT,
  source_name            TEXT,
  source_size            BIGINT,

  -- Fichiers publiés (bucket public). `version` s'incrémente à chaque compression.
  version                INTEGER NOT NULL DEFAULT 0,
  video_key              TEXT,
  video_size             BIGINT,
  poster_key             TEXT,
  thumb_key              TEXT,
  gif_key                TEXT,
  gif_size               BIGINT,
  duration_s             NUMERIC(8,2),
  width                  INTEGER,
  height                 INTEGER,

  -- Bouton d'action du lecteur (« DÉCOUVRIR », « Ajouter au panier »…)
  cta_label              TEXT,
  cta_url                TEXT,
  wp_product_id          BIGINT,
  wp_variation_id        BIGINT,

  created_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_started_at  TIMESTAMP,
  processed_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at DESC);
