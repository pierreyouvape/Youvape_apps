-- ─────────────────────────────────────────────────────────────────────────────
-- Total HT des PRODUITS de la facture fournisseur, lu au parsing du PDF.
--
-- Sert de garde-fou de réconciliation avant l'envoi à BMS (cf. createInBMS,
-- GARDE-FOU B) : le total du payload BMS = Σ (qty / pack_qty) × price doit
-- correspondre à ce montant. Un écart > tolérance bloque l'envoi (rattrape les
-- bugs de prix/quantité : prefill prix pack, ×pack_qty, qty non convertie…).
--
-- NULL = le parseur du fournisseur n'extrait pas (encore) le total → contrôle B
-- ignoré pour cette commande (le contrôle A de divisibilité reste actif).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS invoice_total_ht NUMERIC(12,2) DEFAULT NULL;
