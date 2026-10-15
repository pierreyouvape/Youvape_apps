-- App « Stories » : miniature choisie (image affichée avant la lecture et
-- vignette des bulles).
--
-- cover_source : video  = image extraite automatiquement de la vidéo (défaut)
--                frame  = image de la vidéo choisie à un instant (cover_frame_at)
--                upload = image envoyée (visuel avec titre, logos…)
-- Les fichiers sont versionnés à part de la vidéo (poster.cN.webp) : changer de
-- miniature ne recompresse pas la vidéo, et inversement une recompression garde
-- une miniature envoyée (et refait celle prise à un instant, sur la nouvelle vidéo).
ALTER TABLE stories ADD COLUMN IF NOT EXISTS cover_source   TEXT NOT NULL DEFAULT 'video';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS cover_version  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS cover_frame_at NUMERIC(8,2);
