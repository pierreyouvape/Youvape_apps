-- Migration: Ajouter les colonnes UTM manquantes dans orders
-- Date: 2026-03-20
-- Contexte: YouSync v1.4.0 envoie maintenant utm_campaign, utm_content, utm_term

ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution_utm_campaign VARCHAR;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution_utm_content VARCHAR;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS attribution_utm_term VARCHAR;
