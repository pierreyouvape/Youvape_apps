-- Gestion employé — registre des salariés et de leurs codes-barres.
--
-- La liste est volontairement INDÉPENDANTE de `users` : les codes d'avril 2026
-- existaient avant que certains salariés aient un compte app (jib, Joël), des
-- salariés n'en auront jamais (boutique, saisonniers), et `users.name` ne porte
-- qu'un prénom ou un pseudo (« jib », « Celyne », « Préparateur »).
-- `user_id` fait le lien quand il y a un compte, sans le rendre obligatoire.

CREATE TABLE IF NOT EXISTS employees (
  id                   SERIAL PRIMARY KEY,
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL,
  -- Code EAN-13 de la série 2522. NULL tant qu'aucun code n'a été généré.
  barcode              VARCHAR(13) UNIQUE,
  -- N° d'ordre porté par le code. Jamais réattribué, même après un départ :
  -- deux personnes partageraient sinon un code dans l'historique des scans.
  barcode_seq          INTEGER UNIQUE,
  barcode_generated_at TIMESTAMP,
  -- Compte app correspondant, quand il y en a un. Supprimer le compte ne
  -- supprime pas le salarié : son code reste valide.
  -- UNIQUE : un compte app appartient à une seule personne.
  user_id              INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  -- Un départ archive le salarié (code conservé), il ne l'efface pas.
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_active ON employees (active);

-- Les 10 codes imprimés le 24/04/2026 (SVG `barcodes_employes_YV/`), repris à
-- l'identique : les étiquettes déjà collées ne se mettent pas à jour. L'ordre
-- des n° est celui de la série d'origine, pas l'alphabet.
INSERT INTO employees (first_name, last_name, barcode, barcode_seq, barcode_generated_at)
VALUES
  ('Maxime',       'Coglitore', '2522130300013',  1, '2026-04-24 13:41:00'),
  ('Elena',        'Coglitore', '2522050300025',  2, '2026-04-24 13:41:00'),
  ('Pierre',       'Merle',     '2522161300037',  3, '2026-04-24 13:41:00'),
  ('Franck',       'Demougeot', '2522060400043',  4, '2026-04-24 13:41:00'),
  ('Jean-Baptist', 'Reinaud',   '2522101800054',  5, '2026-04-24 13:41:00'),
  ('Anthony',      'Chevalier', '2522010300065',  6, '2026-04-24 13:41:00'),
  ('Gaïa',         'Iaggi',     '2522070900076',  7, '2026-04-24 13:41:00'),
  ('Céline',       'Pialat',    '2522031600083',  8, '2026-04-24 13:41:00'),
  ('Villizara',    'Marinova',  '2522221300090',  9, '2026-04-24 13:41:00'),
  ('Joël',         'Pozzo',     '2522101600104', 10, '2026-04-24 13:41:00')
ON CONFLICT (barcode) DO NOTHING;

-- Rattachement aux comptes app existants, par email connu. Un salarié sans
-- compte (ou dont l'email change) reste simplement non rattaché.
UPDATE employees e SET user_id = u.id
FROM users u
WHERE e.user_id IS NULL AND u.email = CASE
  WHEN e.barcode = '2522130300013' THEN 'youvape34@gmail.com'
  WHEN e.barcode = '2522050300025' THEN 'lenny.coglitore@gmail.com'
  WHEN e.barcode = '2522161300037' THEN 'pierre.youvape@gmail.com'
  WHEN e.barcode = '2522060400043' THEN 'demougeotfranck@hotmail.fr'
  WHEN e.barcode = '2522101800054' THEN 'chroniqueur@youvape.fr'
  WHEN e.barcode = '2522010300065' THEN 'webmaster@youvape.fr'
  WHEN e.barcode = '2522070900076' THEN 'marketing.youvape@gmail.com'
  WHEN e.barcode = '2522031600083' THEN 'celylive@gmail.com'
  WHEN e.barcode = '2522221300090' THEN 'vilizara0505@gmail.com'
  WHEN e.barcode = '2522101600104' THEN 'joel.pozzo97@yahoo.com'
END;
