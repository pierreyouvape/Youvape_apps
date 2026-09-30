-- units_received : les PIÈCES réellement reçues sur une ligne de commande.
--
-- POURQUOI UNE COLONNE DE PLUS. `qty_received` compte dans l'unité de la ligne,
-- qui est parfois le LOT (`units_per_qty` > 1 chez les fournisseurs facturés au
-- pack). Or une réception se compte en PIÈCES. La validation convertissait donc
-- les pièces en lots par une division — entière, puisque les deux colonnes sont
-- des entiers — et le reste disparaissait sans un mot :
--
--     23 pièces comptées sur une ligne « par 5 »
--       → 23 / 5 = 4 lots enregistrés = 20 pièces
--       → 3 PIÈCES PERDUES, dans le stock comme dans le coût de revient.
--
-- Aucune arithmétique ne rattrape ça : un reste ne se représente pas dans une
-- unité plus grosse que lui. Diviser en décimal ne ferait que déplacer la perte
-- (23/3 ne tombe juste dans aucune précision finie), et convertir la ligne en
-- pièces obligerait à diviser aussi `unit_price`, qui n'a que deux décimales —
-- 16,10 € le lot de 50 donnerait 0,32 € la pièce, soit 16,00 € au lieu de 16,10.
--
-- La seule représentation exacte est donc la pièce, en entier, à côté de la
-- quantité de ligne. C'est ce que TOUTES les requêtes reconstituaient déjà par
-- `qty_received * units_per_qty` : elles lisent désormais la valeur directement.
--
-- `qty_received` reste tenue à jour, dans l'unité de la ligne : c'est elle que la
-- synchro BMS écrit et relit, et elle sert encore à dire « cette ligne est
-- soldée ». Mais elle n'est plus ce sur quoi on compte.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS units_received INTEGER NOT NULL DEFAULT 0;

-- Rattrapage : pour l'existant, la conversion est exacte — ces lignes n'ont
-- jamais reçu que des multiples entiers de leur conditionnement, puisque c'est
-- tout ce que l'ancienne division savait enregistrer.
UPDATE purchase_order_items
   SET units_received = COALESCE(qty_received, 0) * GREATEST(COALESCE(units_per_qty, 1), 1)
 WHERE units_received = 0
   AND COALESCE(qty_received, 0) <> 0;

CREATE INDEX IF NOT EXISTS idx_poi_units_received
  ON purchase_order_items (product_id) WHERE units_received > 0;
