-- RETOUR ARRIÈRE du lot 0 (étiquetage multi-transporteurs).
--
-- À passer AVANT de revenir à la version précédente du backend, et seulement
-- dans ce cas. Le packing envoie des lettres suivies toute la journée sans
-- solution de secours : ce script existe pour que le retour arrière soit une
-- décision de trente secondes, pas une reprise de données sous pression.
--
-- Ce qu'il fait : recopie dans laposte_labels les étiquettes La Poste émises
-- depuis la bascule, que l'ancien code ne sait pas lire. Sans lui, une étiquette
-- générée après la bascule serait introuvable dans l'écran de réimpression et
-- d'annulation.
--
-- Il ne SUPPRIME rien : ni shipment_labels, ni carrier_accounts, ni les clés
-- laposte_* d'app_config (que la migration aller n'a jamais touchées). Un
-- second aller n'aurait donc rien à reconstruire.
--
-- Idempotent : relançable sans créer de doublon.
--
--   docker compose exec -T postgres psql -U youvape -d youvape_db < backend/src/migrations/rollback_shipment_labels.sql

BEGIN;

INSERT INTO laposte_labels
  (id, order_number, tracking_id, laposte_order_id, status, created_at, cancelled_at, packed_by, pdf_data)
SELECT
  s.id, s.order_number, s.tracking_number,
  -- laposte_order_id est NOT NULL côté ancienne table : une étiquette sans
  -- identifiant de commande n'y entrerait pas. Le cas ne s'est jamais produit
  -- avec La Poste, mais le repli évite que le script s'arrête en plein retour
  -- arrière.
  COALESCE(s.carrier_order_id, 'INCONNU-' || s.id),
  s.status, s.created_at, s.cancelled_at, s.packed_by, s.pdf_data
FROM shipment_labels s
WHERE s.carrier_code = 'laposte'
ON CONFLICT (id) DO UPDATE
  SET status       = EXCLUDED.status,
      cancelled_at = EXCLUDED.cancelled_at,
      tracking_id  = EXCLUDED.tracking_id;

-- La séquence de laposte_labels doit repartir au-dessus des id réinjectés,
-- sans quoi la première étiquette de l'ancien code entrerait en collision.
SELECT setval(
  pg_get_serial_sequence('laposte_labels', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM laposte_labels), 0), 1),
  (SELECT MAX(id) IS NOT NULL FROM laposte_labels)
);

-- Contrôle : doit renvoyer 0 ligne manquante.
SELECT COUNT(*) AS etiquettes_laposte_non_reprises
FROM shipment_labels s
WHERE s.carrier_code = 'laposte'
  AND NOT EXISTS (SELECT 1 FROM laposte_labels l WHERE l.id = s.id);

COMMIT;
