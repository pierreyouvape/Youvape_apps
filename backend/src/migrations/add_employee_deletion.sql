-- Départ d'un salarié : couper l'accès sans rien détruire.
--
-- Un compte app n'est JAMAIS supprimé. `users` est référencé en NO ACTION par
-- les étiquettes d'expédition, les commandes fournisseur et les tickets SAV :
-- Franck a 903 étiquettes à son nom, Maxime 337 commandes. Un DELETE échouerait,
-- et s'il passait il effacerait la trace de qui a emballé quoi.
--
-- Un départ désactive donc : droits effacés, connexion refusée, jeton en cours
-- invalidé (authMiddleware relit les comptes actifs), profil retiré de la grille
-- des permissions dans Réglages — et la ligne, elle, reste.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;

-- Le n° d'ordre des codes-barres passe d'un MAX()+1 à une vraie séquence :
-- aucun numéro n'est jamais libéré, même si une fiche disparaissait un jour —
-- le prochain arrivant recevrait sinon le code d'une étiquette en circulation.
CREATE SEQUENCE IF NOT EXISTS employees_barcode_seq AS INTEGER MINVALUE 1;

DO $$
DECLARE last_seq INTEGER := (SELECT COALESCE(MAX(barcode_seq), 0) FROM employees);
BEGIN
  IF last_seq > 0 THEN
    PERFORM setval('employees_barcode_seq', last_seq, true);   -- prochain = last_seq + 1
  ELSE
    PERFORM setval('employees_barcode_seq', 1, false);         -- prochain = 1
  END IF;
END $$;
