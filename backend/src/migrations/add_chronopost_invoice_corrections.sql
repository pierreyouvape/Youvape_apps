-- App CHRONOPOST : factures rectificatives et avoirs rattachés à leur facture d'origine.
--
-- Après une réclamation acceptée, Chronopost émet :
--   - un AVOIR « sur facture N » qui annule les lignes contestées ;
--   - une FACTURE RECTIFICATIVE qui refacture ces colis au bon poids, sans citer N.
-- On repère la rectificative (mention « Facture rectificative » dans le PDF) et on la
-- rattache à l'origine par ses n° de suivi (lien calculé à la lecture, pas stocké).
-- Les totaux comptent : origine + avoir + rectificative, au mois de la facture d'origine.
--
-- Idempotente : relançable sans dégât.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- La migration passe AVANT le rebuild : le nouveau code lit ces colonnes.
--
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_chronopost_invoice_corrections.sql
--   3. docker compose up --build -d backend frontend
--
-- Rattrapage : les factures Chronopost classiques sont numérotées 13xxxxxx ; les
-- rectificatives partagent la série des avoirs (40971693 le 05/10/2026). Les
-- rectificatives déjà enregistrées sont repérées par ce préfixe.
--
-- Retour arrière :
--   ALTER TABLE carrier_invoices DROP COLUMN is_rectificative;
--   ALTER TABLE carrier_credit_documents DROP COLUMN total_ht, DROP COLUMN total_ttc;

ALTER TABLE carrier_invoices ADD COLUMN IF NOT EXISTS is_rectificative BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE carrier_invoices
   SET is_rectificative = TRUE
 WHERE carrier = 'chronopost' AND invoice_number LIKE '4%' AND NOT is_rectificative;

-- Totaux lus sur le récapitulatif « TOTAL AVOIR HT TVA TTC » du PDF (NULL pour les
-- avoirs enregistrés avant : on retombe alors sur la somme des lignes).
ALTER TABLE carrier_credit_documents ADD COLUMN IF NOT EXISTS total_ht  NUMERIC(12,2);
ALTER TABLE carrier_credit_documents ADD COLUMN IF NOT EXISTS total_ttc NUMERIC(12,2);
