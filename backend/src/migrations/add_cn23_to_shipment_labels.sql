-- Lot 2 du chantier expédition : la déclaration douanière CN23.
--
-- Colissimo renvoie la CN23 comme un SECOND document, à côté de l'étiquette
-- (partie MIME `<cn23>`). Les deux ne s'impriment pas au même endroit : AutoPrint
-- envoie l'étiquette sur l'Intermec (règle `colissimo_*`) et la déclaration sur
-- la Brother A4 (règle `customs_document*`). Il faut donc la stocker à part, pour
-- que la réimpression rende les deux.
--
-- Concerne l'outre-mer (GF, GP, MQ, RE, PF) et le Royaume-Uni : environ 21
-- commandes sur 90 jours, noyées dans les mêmes dénominations que la France.
--
-- Idempotente : relançable sans dégât. Colonne nullable, sans défaut : aucune
-- réécriture de la table, aucun verrou long — le packing peut tourner pendant.
--
-- ── PROCÉDURE ───────────────────────────────────────────────────────────────
-- Moins critique que le lot 0 : l'enregistrement d'une étiquette La Poste ou
-- Mondial Relay n'écrit PAS cette colonne, il continue de marcher si la
-- migration tarde. Seul Colissimo refuse d'étiqueter tant qu'elle manque, et il
-- le refuse AVANT d'acheter l'étiquette. L'ordre reste néanmoins le même :
--
--   1. git pull                                        (sur le VPS)
--   2. docker compose exec -T postgres psql -U youvape -d youvape_db \
--        < backend/src/migrations/add_cn23_to_shipment_labels.sql
--   3. Contrôle go / no-go depuis les sources fraîches (cf. procédure détaillée
--      en tête de add_shipment_labels.sql, étape 3) :
--        node scripts/checkShipmentSchema.js   → « Bascule possible », sortie 0
--   4. docker compose up --build -d backend frontend
--
-- Après le rebuild, rien ne change pour le packing : les dénominations Colissimo
-- amorcées plus bas sont inactives. La mise en service se fait à l'écran —
-- contrats, répétition, puis activation.

BEGIN;

ALTER TABLE shipment_labels ADD COLUMN IF NOT EXISTS cn23_data TEXT;

COMMENT ON COLUMN shipment_labels.cn23_data IS
  'Déclaration douanière CN23 (PDF base64), quand le transporteur en a produit une. '
  'Imprimée à part de l''étiquette : AutoPrint route customs_document* vers la Brother A4.';

-- ── Amorçage des dénominations Colissimo / Bpost ────────────────────────────
-- Amorcées INACTIVES et sur le contrat de TEST, comme Mondial Relay au lot 1.
-- Inactives, elles se comportent comme absentes : le packing continue de
-- bloquer ces commandes exactement comme aujourd'hui. Elles servent d'abord à
-- la répétition (scripts/checkColissimoLabels.js), qui les lit actives ou non.
--
-- Les activer est une décision explicite : rééditer chaque ligne dans
-- « Modes de livraison » en choisissant le contrat de production.
--
-- Le service de chaque dénomination a été éprouvé à blanc sur 90 jours de
-- commandes réelles (10/09/2026, 4 054 commandes, sans appel à l'API).
INSERT INTO shipping_method_carrier_map
  (denomination, carrier_code, account_code, delivery_mode, active, note)
VALUES
  ('Colissimo Domicile', 'colissimo', 'test', 'domicile', false,
   'DOM en France et à Monaco, COM + CN23 vers l''outre-mer (GF GP MQ RE PF) : le code produit se calcule par pays.'),
  ('Colissimo Domicile avec Signature', 'colissimo', 'test', 'signature', false,
   'DOS, France.'),
  ('Colissimo avec Signature', 'colissimo', 'test', 'signature', false,
   'DOS vers l''UE, où la livraison sans signature n''existe pas. CN23 vers le Royaume-Uni.'),
  ('Bpost Relais', 'colissimo', 'test', 'relais', false,
   'Point de retrait bpost = code produit HD. Mobile obligatoire (SMS de mise à disposition).'),
  ('Bpost Relais 2 à 3 jours ouvrés', 'colissimo', 'test', 'relais', false,
   'Point de retrait bpost = code produit HD. Mobile obligatoire (SMS de mise à disposition).'),
  ('Bpost, Colissimo International', 'colissimo', 'test', 'domicile', false,
   'BE et LU. En « domicile » (ce que fait BMS aujourd''hui), le Luxembourg est refusé : Colissimo n''y livre qu''avec signature. À trancher.'),
  ('Colissimo', 'colissimo', 'test', 'domicile', false,
   'Libellé résiduel, 1 commande (BE).')
ON CONFLICT (denomination) DO NOTHING;

COMMIT;
