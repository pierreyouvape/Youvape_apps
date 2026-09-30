-- Retour à NUMERIC(10,2). ATTENTION : cette réduction ARRONDIT les prix déjà
-- écrits au millième — 1,2325 redevient 1,23, sans trace. À ne lancer que si la
-- précision pose un problème qu'on n'a pas vu venir.
ALTER TABLE supplier_refs        ALTER COLUMN pack_price TYPE NUMERIC(10,2);
ALTER TABLE purchase_order_items ALTER COLUMN unit_price TYPE NUMERIC(10,2);
