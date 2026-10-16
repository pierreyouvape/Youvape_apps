-- ============================================================================
-- Boutiques Nextore — Coffre (solde théorique du coffre par boutique)
-- ============================================================================
-- théorique = dernier comptage du coffre
--           + Σ (espèces comptées à la clôture − fond de caisse) des clôtures depuis
--           − remises en banque depuis
--
-- nextore_registers : sessions de caisse Nextore (/registers, non documenté),
-- recopiées au fil des ouvertures de l'écran. Une session ne porte PAS sa
-- boutique : elle se déduit du compte qui ouvre la caisse
-- (config/nextore.js → REGISTER_USER_WAREHOUSE).
--
-- coffre_movements : ce que la boutique saisit (comptages, remises en banque).
-- Suppression logique : une ligne d'argent ne disparaît pas sans trace.
--
-- À appliquer manuellement sur le VPS :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_coffre_boutiques.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS nextore_registers (
  id            INTEGER PRIMARY KEY,   -- id Nextore de la session
  warehouse_id  INTEGER,               -- NULL = compte d'ouverture inconnu
  user_id       TEXT,                  -- compte Nextore qui a ouvert la caisse
  opened_at     TIMESTAMP,             -- heure Paris
  closed_at     TIMESTAMP,             -- heure Paris
  status        TEXT,                  -- open | close
  cash_in_hand  NUMERIC(12,2),         -- fond de caisse
  cash_sold     NUMERIC(12,2),         -- espèces encaissées (total_payments_real)
  cash_declared NUMERIC(12,2),         -- espèces comptées à la clôture, fond compris
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextore_registers_wh_closed
  ON nextore_registers (warehouse_id, closed_at);

CREATE TABLE IF NOT EXISTS coffre_movements (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('comptage', 'remise')),
  amount        NUMERIC(12,2) NOT NULL,   -- comptage : total compté ; remise : montant sorti
  occurred_at   TIMESTAMP NOT NULL,       -- heure Paris
  denominations JSONB,                    -- comptage : { "50": 3, "0.2": 7 }
  theoretical   NUMERIC(12,2),            -- comptage : théorique affiché au moment du comptage
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'Europe/Paris'),
  deleted_at    TIMESTAMP,
  deleted_by    INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_coffre_movements_wh
  ON coffre_movements (warehouse_id, occurred_at) WHERE deleted_at IS NULL;
