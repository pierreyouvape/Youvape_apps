-- Un tarif fournisseur se négocie au millième, pas au centime.
--
-- `supplier_refs.pack_price` et `purchase_order_items.unit_price` étaient des
-- NUMERIC(10,2). Une ligne LIPS facturée 1,4500 € remisée à 15 % coûte 1,2325 € :
-- la base en gardait 1,23, la commande suivante repartait à 1,23, et le contrôle
-- de la facture d'après retrouvait un écart de 0,0025 € — « Arrondi de remise »,
-- à vie, sur chaque ligne de chaque facture. Le message ne décrivait pas une
-- erreur du fournisseur mais la précision de nos propres colonnes.
--
-- Quatre décimales, comme BMS les accepte déjà sur ses lignes de commande
-- (PUT /v2/purchase-orders/{id}/items/{itemId}, cf. CLAUDE.md) et comme
-- `supplier_document_lines.expected_unit_price` (12,5) les portait déjà.
--
-- Élargir l'échelle d'un NUMERIC ne perd rien et ne réécrit aucune valeur :
-- 1.23 devient 1.2300. Aucune reprise de données n'est nécessaire.
ALTER TABLE supplier_refs        ALTER COLUMN pack_price TYPE NUMERIC(12,4);
ALTER TABLE purchase_order_items ALTER COLUMN unit_price TYPE NUMERIC(12,4);

COMMENT ON COLUMN supplier_refs.pack_price IS
  'Prix HT du pack de pack_qty pièces, au dix-millième. Un prix remisé ne tombe pas au centime.';
COMMENT ON COLUMN purchase_order_items.unit_price IS
  'Prix HT de l''unité de ligne (un pack de units_per_qty pièces), au dix-millième. Lu par le FIFO.';
