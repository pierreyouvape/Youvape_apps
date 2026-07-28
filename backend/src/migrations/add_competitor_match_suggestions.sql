-- Suggestions de matching auto (découverte produits concurrents ↔ produits Youvape)
-- Créé le 2026-07-28
CREATE TABLE IF NOT EXISTS competitor_match_suggestions (
  id                  SERIAL PRIMARY KEY,
  competitor          VARCHAR(120) NOT NULL,
  brand               VARCHAR(120),
  model_key           VARCHAR(255) NOT NULL,   -- clé normalisée du modèle (dédoublonnage)
  model_label         TEXT,                    -- libellé lisible côté concurrent
  representative_url   TEXT NOT NULL,          -- URL d'une saveur représentative du modèle
  representative_name TEXT,
  matched_sku         VARCHAR(255),            -- SKU Youvape proposé (variation avec prix), NULL si non matché
  matched_title       TEXT,                    -- titre produit Youvape proposé
  match_score         NUMERIC(4,3),            -- 0..1 confiance
  status              VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | validated | rejected
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competitor, model_key)
);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_status ON competitor_match_suggestions (status);
