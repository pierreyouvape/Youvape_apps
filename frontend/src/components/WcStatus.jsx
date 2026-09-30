/**
 * L'état WooCommerce d'un produit, quand il n'est pas « publié ».
 *
 * Un produit en brouillon ou en privé n'est PAS en ligne sur la boutique. Rien
 * ne le disait dans l'app, et l'écart se paie cher : le parent « Dead Rabbit 3
 * Rta Joker Edition » est passé en brouillon lors d'une synchro, sa famille a
 * disparu du catalogue, et rien n'indiquait pourquoi — on cherchait un réglage
 * de l'écran alors que la réponse était sur la boutique.
 *
 * Volontairement muet quand le produit est publié : un badge sur les 2 242
 * produits normaux ne dirait plus rien. On ne signale que l'exception.
 *
 * `sombre` : version pour les lignes de tête de famille du catalogue, qui ont un
 * fond bleu foncé — le badge clair y serait illisible.
 */
const ETATS = {
  draft:   { label: 'Brouillon WC', aide: "Ce produit est en BROUILLON sur WooCommerce : il n'est pas en ligne sur la boutique." },
  private: { label: 'Privé WC',     aide: "Ce produit est en PRIVÉ sur WooCommerce : il n'est visible que des administrateurs." },
  pending: { label: 'En attente WC', aide: "Ce produit est EN ATTENTE de relecture sur WooCommerce : il n'est pas en ligne." },
  trash:   { label: 'Corbeille WC', aide: 'Ce produit est à la CORBEILLE sur WooCommerce.' },
};

export default function WcStatus({ statut, sombre = false }) {
  if (!statut || statut === 'publish') return null;
  const etat = ETATS[statut] || {
    label: `${statut} WC`,
    aide: `Ce produit a le statut « ${statut} » sur WooCommerce : il n'est pas publié.`,
  };

  return (
    <span
      title={etat.aide}
      style={{
        marginLeft: 8,
        padding: '1px 7px',
        borderRadius: 9,
        fontSize: 10.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        cursor: 'help',
        background: sombre ? 'rgba(255,255,255,0.18)' : '#FEF3C7',
        color: sombre ? '#FDE68A' : '#B45309',
        border: sombre ? '1px solid rgba(253,230,138,0.45)' : '1px solid #FCD34D',
      }}
    >
      {etat.label}
    </span>
  );
}
