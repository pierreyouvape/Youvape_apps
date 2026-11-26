-- ============================================================================
-- App Tâches — automatismes des fiches produits (décisions Maxime, 26/11/2026)
-- ============================================================================
-- taches_steps.ask_link : à la fin de cette étape (« Rédaction texte »), l'app
--   demande le lien de la fiche produit créée, rangé dans le lien de la tâche.
-- taches_tasks.wp_product_id : produit du site retrouvé depuis ce lien
--   (WooCommerce, par le slug). Sert à cocher « Stockage » dès que le produit
--   a du stock (cron toutes les 10 min, services/tachesStockService.js).
--
-- Modèle « Fiche Produit » : personnes reprises des fiches réelles (Monday) :
--   Rédaction texte  jib     → prévient Maxime   (demande le lien)
--   Stockage         Maxime  → prévient Gaïa     (coché seul au stock reçu)
--   Photos produits  Gaïa    → prévient jib
--   Relecture front  jib     → prévient Anthony
--   Vérifier Code    Anthony → prévient Maxime
--   Vérif Globale    Maxime  → (Gaïa, responsable de l'étape suivante)
--   Join Story       Gaïa    → prévient Anthony
-- (ids : Maxime 2, Anthony 3, Gaïa 4, jib 10)
--
-- À appliquer sur le VPS AVANT le code :
--   docker exec -i youvape_postgres psql -U youvape -d youvape_db \
--     < backend/src/migrations/add_taches_fiche_auto.sql
-- ============================================================================

ALTER TABLE taches_steps ADD COLUMN IF NOT EXISTS ask_link BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE taches_tasks ADD COLUMN IF NOT EXISTS wp_product_id BIGINT;

UPDATE taches_templates SET steps = '[
  {"name":"Rédaction texte","owners":[10],"notify":[2],"ask_link":true},
  {"name":"Stockage","owners":[2],"notify":[4]},
  {"name":"Photos produits","owners":[4],"notify":[10]},
  {"name":"Relecture en front","owners":[10],"notify":[3]},
  {"name":"Vérifier Code","owners":[3],"notify":[2]},
  {"name":"Vérif Globale","owners":[2],"notify":[]},
  {"name":"Join Story","owners":[4],"notify":[3]}
]'::jsonb, updated_at = (NOW() AT TIME ZONE 'Europe/Paris')
WHERE name = 'Fiche Produit';

-- Fiches produits déjà en cours : la « Rédaction texte » pas encore faite demandera le lien.
UPDATE taches_steps s SET ask_link = true
  FROM taches_tasks t
 WHERE t.id = s.task_id AND 'Fiche Produit' = ANY(t.labels)
   AND lower(s.name) = 'rédaction texte' AND s.status <> 'fait';
