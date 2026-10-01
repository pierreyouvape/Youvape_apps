-- Fournisseurs RETIRÉS À LA MAIN d'un produit.
--
-- product_suppliers est alimentée automatiquement (cron BMS de 5h10, imports de
-- factures, propagation aux déclinaisons sœurs). Une suppression manuelle y était
-- donc sans effet durable : BMS garde ses associations à vie, et le cron réinsérait
-- le lien le lendemain matin (constaté le 01/10/2026 sur wp 1209789, où LCA et
-- Cigaccess — derniers achats 06/05 et 07/04/2026 — revenaient sans arrêt).
--
-- Cette table est la mémoire de ce refus : tant que la ligne existe, AUCUNE source
-- automatique ne recrée le lien. Seule une action humaine explicite sur ce produit
-- (bouton « Ajouter un fournisseur », création/déplacement d'une réf, import d'une
-- facture de ce fournisseur, édition du conditionnement) la lève.

CREATE TABLE IF NOT EXISTS product_supplier_exclusions (
  product_id  INTEGER NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_supplier_exclusions_supplier
  ON product_supplier_exclusions (supplier_id);

COMMENT ON TABLE product_supplier_exclusions IS
  'Liens produit x fournisseur retires a la main : jamais recrees automatiquement (cron BMS, propagation aux declinaisons).';
