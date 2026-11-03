-- Retour arrière de add_carrier_claims.sql. Les tickets créés chez Chronopost et
-- les notes ajoutées dans le SAV restent : seule leur trace ici part.
BEGIN;
DROP TABLE IF EXISTS carrier_claims;
DROP TABLE IF EXISTS carrier_claim_batches;
DELETE FROM app_config WHERE config_key = 'chronopost_claims_since';
COMMIT;
