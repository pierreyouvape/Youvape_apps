-- Réception : le motif d'un manquant (2026-09-30)
--
-- L'écran le demandait déjà, et le rendait obligatoire, mais `validate` postait
-- un objet vide : le magasinier renseignait un motif par ligne manquante pour
-- rien. Il vit ici, à côté du comptage qu'il explique.
--
-- reliquat : le fournisseur doit encore l'envoyer.
-- solde    : il ne l'enverra pas et nous a déjà remboursés.
-- manquant : personne ne sait — c'est une erreur, elle se réclame.
ALTER TABLE reception_counts ADD COLUMN IF NOT EXISTS motif varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reception_counts_motif_check') THEN
    ALTER TABLE reception_counts ADD CONSTRAINT reception_counts_motif_check
      CHECK (motif IS NULL OR motif IN ('reliquat', 'solde', 'manquant'));
  END IF;
END $$;

-- Destinataire des mails de réception (manquants, surplus). Vide = pas d'envoi,
-- et c'est dit dans les journaux plutôt que d'échouer la réception.
INSERT INTO app_config (config_key, config_value)
VALUES ('reception_email_to', '')
ON CONFLICT (config_key) DO NOTHING;
