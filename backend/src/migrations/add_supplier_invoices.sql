-- ─────────────────────────────────────────────────────────────────────────────
-- Contrôle et classement des factures fournisseur (Pierre, 25/09/2026)
--
-- Trois objets, et une règle qui explique leur séparation :
--
--   • supplier_documents        la facture, l'avoir ou la proforma, avec son
--                               analyse GELÉE au moment du contrôle ;
--   • supplier_payments         le règlement réel, qui n'a rien à voir avec ce
--                               que le document imprime ;
--   • supplier_payment_allocations  ce qu'un règlement solde, document par
--                               document.
--
-- POURQUOI LE PAIEMENT N'EST PAS UNE COLONNE DE LA FACTURE
-- LCA et JoshNoa impriment « Mode de règlement : virement bancaire » sur toutes
-- leurs factures, alors qu'elles sont réglées à 30 jours et plus, en Amex, par
-- paiements REGROUPÉS couvrant plusieurs factures à la fois. Le mode imprimé
-- n'est donc qu'une valeur proposée à la saisie : la vérité, c'est le règlement,
-- et il est N↔N avec les factures. Un même virement solde six factures ; une
-- facture peut être réglée en deux fois (Cloud Vapor INV/2025/04126 : 2 338,08 €
-- le 20/10 puis 259,79 € le 21/10). Aucune colonne « payée » ne tiendrait ça :
-- le reste à payer se DÉDUIT des affectations (vue supplier_document_balances).
--
-- POURQUOI L'ANALYSE EST GELÉE
-- La commande BMS bouge pendant le contrôle : on corrige un prix, on ajuste une
-- quantité, on valide. Vérifié sur la commande S311485, dont la ligne Tropical
-- Berries était passée de 8 à 7 avant même qu'on la regarde. Si l'analyse était
-- rejouée à chaque affichage, la preuve de l'écart disparaîtrait au moment même
-- où on la corrige. Les quantités et prix ATTENDUS sont donc recopiés dans
-- supplier_document_lines à l'instant du contrôle.
--
-- SIGNE DES AVOIRS
-- Un avoir est un document comme un autre, avec des totaux NÉGATIFS. Les sommes
-- et les affectations restent alors de simples additions : un règlement Amex
-- groupé peut couvrir trois factures et un avoir sans cas particulier.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Délai de règlement négocié, par fournisseur : alimente « en attente de
-- paiement » quand le document n'imprime pas d'échéance exploitable (beaucoup
-- impriment l'échéance au jour de la facture, ce qui est faux pour nous).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_payment_method VARCHAR(20);

COMMENT ON COLUMN suppliers.payment_terms_days IS
  'Délai de règlement réellement accordé (30 j et plus chez LCA et JoshNoa), qui prime sur l''échéance imprimée.';

-- ── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_documents (
  id              SERIAL PRIMARY KEY,
  supplier_id     INTEGER      NOT NULL REFERENCES suppliers(id),
  doc_type        VARCHAR(20)  NOT NULL DEFAULT 'invoice'
                    CHECK (doc_type IN ('invoice', 'credit_note', 'proforma')),
  number          VARCHAR(80)  NOT NULL CHECK (btrim(number) <> ''),
  doc_date        DATE         NOT NULL,
  due_date        DATE,
  currency        VARCHAR(5)   DEFAULT 'EUR',
  -- Totaux tels qu'imprimés. NÉGATIFS pour un avoir (cf. en-tête).
  total_ht        NUMERIC(12,2),
  total_tva       NUMERIC(12,2),
  total_ttc       NUMERIC(12,2),
  -- Mode de règlement IMPRIMÉ sur le document : indicatif, jamais la vérité.
  stated_payment_method VARCHAR(40),
  -- Référence de commande telle qu'imprimée (« Réf. Commande », « Origine »,
  -- « Source » selon le fournisseur). Conservée même quand elle ne retrouve
  -- aucune commande : chez GFC et MG Vape c'est le numéro interne du
  -- fournisseur, et le rapprochement se fait alors à la main.
  order_ref_on_doc VARCHAR(80),
  -- Avancement du CONTRÔLE (pas du paiement, qui se déduit des affectations).
  status          VARCHAR(20)  NOT NULL DEFAULT 'to_check'
                    CHECK (status IN ('to_check', 'checked', 'disputed', 'archived')),
  file_path       TEXT,
  -- Sortie gelée de compareInvoiceToOrder : totaux, ventilation, avertissements.
  analysis        JSONB,
  notes           TEXT,
  created_by      INTEGER      REFERENCES users(id),
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  -- Un même numéro ne peut pas arriver deux fois du même fournisseur : c'est le
  -- garde-fou contre le double dépôt, donc contre le double paiement.
  CONSTRAINT supplier_documents_number_key UNIQUE (supplier_id, number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_documents_supplier_date
  ON supplier_documents (supplier_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_status
  ON supplier_documents (status);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_date
  ON supplier_documents (doc_date DESC);

-- ── Lignes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_document_lines (
  id                  SERIAL PRIMARY KEY,
  document_id         INTEGER NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  line_no             INTEGER,
  supplier_sku        VARCHAR(100),
  label               TEXT,
  kind                VARCHAR(16) NOT NULL DEFAULT 'product'
                        CHECK (kind IN ('product', 'shipping', 'discount', 'other')),
  qty                 NUMERIC(12,3),
  line_total_ht       NUMERIC(12,2),
  product_id          INTEGER REFERENCES products(id),
  -- État de la COMMANDE au moment du contrôle (cf. en-tête : elle bouge après).
  expected_qty        NUMERIC(12,3),
  expected_unit_price NUMERIC(12,5),
  -- Verdict du moteur (invoiceCompare) : ok, price, qty, qty_price, rounding,
  -- packaging, not_ordered, free, missing_in_invoice, shipping, discount, other.
  verdict             VARCHAR(24),
  material            BOOLEAN DEFAULT false,
  gap_qty             NUMERIC(12,2) DEFAULT 0,
  gap_price           NUMERIC(12,2) DEFAULT 0,
  gap                 NUMERIC(12,2) DEFAULT 0,
  -- Coût unitaire RÉEL, remise de pied répartie au prorata : c'est lui qui doit
  -- alimenter un tarif ou un PMP, jamais le prix de ligne brut (Cosmer facture
  -- au prix commandé puis retire 15 % au pied du document).
  effective_unit_cost NUMERIC(12,5),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_document_lines_doc
  ON supplier_document_lines (document_id);
CREATE INDEX IF NOT EXISTS idx_supplier_document_lines_product
  ON supplier_document_lines (product_id) WHERE product_id IS NOT NULL;
-- Les écarts, c'est ce qu'on relit : index partiel sur tout ce qui n'est pas conforme.
CREATE INDEX IF NOT EXISTS idx_supplier_document_lines_verdict
  ON supplier_document_lines (verdict) WHERE verdict <> 'ok';

-- ── Document ↔ commandes (N↔N) ───────────────────────────────────────────────
-- Une facture peut couvrir plusieurs commandes (regroupement du fournisseur),
-- et une commande peut être facturée en plusieurs fois (reliquats).
CREATE TABLE IF NOT EXISTS supplier_document_orders (
  document_id       INTEGER NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  -- Comment le lien a été établi : sur la référence imprimée, ou à la main.
  matched_by        VARCHAR(20) DEFAULT 'reference'
                      CHECK (matched_by IN ('reference', 'manual', 'amount_date')),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, purchase_order_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_document_orders_po
  ON supplier_document_orders (purchase_order_id);

-- ── Règlements ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_payments (
  id           SERIAL PRIMARY KEY,
  supplier_id  INTEGER     NOT NULL REFERENCES suppliers(id),
  method       VARCHAR(20) NOT NULL
                 CHECK (method IN ('cb', 'amex', 'virement', 'prelevement',
                                   'avoir', 'especes', 'cheque', 'autre')),
  paid_at      DATE        NOT NULL,
  -- Montant TTC réellement sorti. Un règlement groupé Amex porte ici son total ;
  -- ce qu'il couvre est dans les affectations.
  amount       NUMERIC(12,2) NOT NULL,
  reference    VARCHAR(120),
  notes        TEXT,
  created_by   INTEGER     REFERENCES users(id),
  created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_date
  ON supplier_payments (supplier_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_method
  ON supplier_payments (method);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  payment_id  INTEGER NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES supplier_documents(id) ON DELETE CASCADE,
  -- Signé : négatif quand un avoir vient en déduction du règlement groupé.
  amount      NUMERIC(12,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_allocations_doc
  ON supplier_payment_allocations (document_id);

-- ── Reste à payer ────────────────────────────────────────────────────────────
-- Déduit, jamais stocké : un document est réglé quand ses affectations couvrent
-- son total. Échéance = celle imprimée, à défaut date du document + délai
-- négocié du fournisseur (30 j et plus chez LCA et JoshNoa).
CREATE OR REPLACE VIEW supplier_document_balances AS
SELECT
  d.id                AS document_id,
  d.supplier_id,
  d.doc_type,
  d.number,
  d.doc_date,
  COALESCE(d.due_date, d.doc_date + (COALESCE(s.payment_terms_days, 0) || ' days')::interval)::date
                      AS effective_due_date,
  d.total_ttc,
  COALESCE(SUM(a.amount), 0)                       AS paid_amount,
  COALESCE(d.total_ttc, 0) - COALESCE(SUM(a.amount), 0) AS remaining_amount,
  CASE
    WHEN d.total_ttc IS NULL THEN 'unknown'
    WHEN abs(COALESCE(d.total_ttc, 0) - COALESCE(SUM(a.amount), 0)) < 0.01 THEN 'paid'
    WHEN COALESCE(SUM(a.amount), 0) = 0 THEN 'unpaid'
    ELSE 'partial'
  END                 AS payment_status
FROM supplier_documents d
JOIN suppliers s ON s.id = d.supplier_id
LEFT JOIN supplier_payment_allocations a ON a.document_id = d.id
GROUP BY d.id, s.payment_terms_days;

COMMIT;
