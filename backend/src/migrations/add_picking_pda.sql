-- App PICKING — lot 3 : le picking au PDA.
--
-- Une vague se prend en main par un bouton « Me l'assigner » (geste volontaire,
-- une seule personne par vague) ; ses lignes sont alors FIGÉES : produits de
-- toute la vague cumulés (picking global), reste à expédier, packs éclatés.
--
-- Tout l'avancement vit ICI, pas dans le PDA : un PDA qui plante ou qu'on
-- change ne perd rien, la personne retrouve sa vague où elle l'avait laissée.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
--   1. pg_dump de sauvegarde
--   2. git pull                                        (sur le VPS)
--   3. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_picking_pda.sql
--   4. docker compose up --build -d backend frontend
--
-- Retour arrière : rollback_picking_pda.sql

BEGIN;

ALTER TABLE picking_waves
  ADD COLUMN IF NOT EXISTS assigned_to  INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS assigned_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS picked_by    INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS picked_at    TIMESTAMP;

COMMENT ON COLUMN picking_waves.assigned_to IS
  'Préparateur qui s''est assigné la vague au PDA. Tant qu''il est renseigné et la vague en picking, personne d''autre n''y entre. « Libérer » (droit écriture) le remet à NULL.';
COMMENT ON COLUMN picking_waves.picked_by IS
  'Préparateur qui a terminé la vague (toutes les lignes complètes ou déclarées manquantes).';

-- Une ligne = un produit de la vague, quantités cumulées sur toutes ses
-- commandes. prise = scannée + validée à la main ; la ligne est traitée quand
-- prise + manquante = à prendre.
CREATE TABLE IF NOT EXISTS picking_wave_lines (
  id            SERIAL PRIMARY KEY,
  wave_id       INTEGER      NOT NULL REFERENCES picking_waves(id) ON DELETE CASCADE,
  line_key      VARCHAR(120) NOT NULL,
  product_id    INTEGER      REFERENCES products(id),
  sku           VARCHAR(100),
  name          TEXT         NOT NULL,
  brand         VARCHAR(255),
  location      VARCHAR(50),
  orders_count  INTEGER      NOT NULL DEFAULT 1,
  qty_needed    INTEGER      NOT NULL CHECK (qty_needed > 0),
  qty_scanned   INTEGER      NOT NULL DEFAULT 0,
  qty_manual    INTEGER      NOT NULL DEFAULT 0,
  qty_missing   INTEGER      NOT NULL DEFAULT 0,
  done_by       INTEGER      REFERENCES users(id),
  done_at       TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (wave_id, line_key),
  CHECK (qty_scanned + qty_manual + qty_missing <= qty_needed)
);

COMMENT ON TABLE picking_wave_lines IS
  'Lignes de picking d''une vague, figées à l''assignation. Avancement enregistré à chaque scan / validation / manquant : c''est la seule mémoire du picking.';
COMMENT ON COLUMN picking_wave_lines.line_key IS
  'SKU du produit, ou « id:<products.id> » pour un produit sans SKU.';
COMMENT ON COLUMN picking_wave_lines.qty_manual IS
  'Quantité validée par le bouton « Valider » (sans scan) : produit sans code-barres, ou grosse quantité.';
COMMENT ON COLUMN picking_wave_lines.qty_missing IS
  'Quantité déclarée manquante par le bouton « Manquant » : le reste à prendre au moment du clic. Affichée au packing (lot 4).';

CREATE INDEX IF NOT EXISTS idx_picking_wave_lines_wave ON picking_wave_lines(wave_id);
CREATE INDEX IF NOT EXISTS idx_picking_waves_assigned ON picking_waves(assigned_to) WHERE assigned_to IS NOT NULL;

COMMIT;
