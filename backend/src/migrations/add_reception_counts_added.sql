-- Réception : la ligne a-t-elle été AJOUTÉE pendant la réception ? (2026-11-20)
--
-- Un article livré mais absent du bon s'ajoute depuis l'écran de réception
-- (« Ajouter un article ») : il devient une ligne de commande à la quantité
-- saisie, donc reçu = attendu, aucun écart, et le mail de réception n'en disait
-- rien. CGWZWKGPZ (Highbuy, 18/11/2026) : HB0938 × 26 et 1277892 × 40 ajoutés
-- à la main, absents du mail qui listait le manquant HB0936.
--
-- Le drapeau vit sur le COMPTAGE et pas sur la ligne : la synchro BMS remplace
-- les lignes d'une commande, et ne conserve que les comptages (purchaseOrderModel,
-- « LES RÉCEPTIONS PASSÉES SURVIVENT »).
ALTER TABLE reception_counts
  ADD COLUMN IF NOT EXISTS added_at_reception boolean NOT NULL DEFAULT false;
