-- ─────────────────────────────────────────────────────────────────────────────
-- Motif de la demande SAV (champ « 10 » du formulaire Gravity Forms).
--
-- GF renvoie un slug (ex. « un_conseil_avant_de_passer_commande »). On stocke la
-- valeur brute telle quelle ; l'humanisation du libellé se fait à l'affichage
-- côté front. NULL = pas de motif (anciens tickets, tickets email/manuels).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sav_tickets
  ADD COLUMN IF NOT EXISTS request_reason VARCHAR(255) DEFAULT NULL;
