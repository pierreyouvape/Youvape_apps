/**
 * Identité visuelle des transporteurs, pour le packing et les réglages.
 *
 * Le préparateur doit savoir **d'un coup d'œil** chez qui part le colis : il
 * enchaîne les commandes et n'a pas le temps de lire un libellé. D'où le logo
 * du transporteur, une couleur pleine et un fond teinté sur toute la fiche.
 *
 * Logos officiels (Wikimedia) dans `public/images/carriers/`. Bpost n'a pas le
 * sien : chez nous, c'est du Colissimo (même contrat, même étiquette). 2Shop
 * n'a pas de logo public : c'est le logo Chronopost avec la mention « 2Shop ».
 */

const VISUELS = {
  laposte: {
    label: 'La Poste',
    court: 'LA POSTE',
    couleur: '#FFCC00',   // jaune La Poste
    encre: '#003B7A',
    fond: '#FFFBEB',
    bordure: '#FFCC00',
    logo: '/images/carriers/laposte.svg'
  },
  mondial_relay: {
    label: 'Mondial Relay',
    court: 'MONDIAL RELAY',
    couleur: '#E30613',   // rouge Mondial Relay
    encre: '#FFFFFF',
    fond: '#FEF2F2',
    bordure: '#E30613',
    logo: '/images/carriers/mondial_relay.svg'
  },
  interne: {
    label: 'Retrait magasin',
    court: 'RETRAIT MAGASIN',
    couleur: '#135E84',   // bleu Youvape
    encre: '#FFFFFF',
    fond: '#EFF6FB',
    bordure: '#135E84',
    logo: '/images/carriers/retrait_magasin.svg'
  },
  colissimo: {
    label: 'Colissimo',
    court: 'COLISSIMO',
    couleur: '#003B7A',
    encre: '#FFFFFF',
    fond: '#EEF3F9',
    bordure: '#003B7A',
    logo: '/images/carriers/colissimo.svg'
  },
  chronopost: {
    label: 'Chronopost',
    court: 'CHRONOPOST',
    couleur: '#00539B',
    encre: '#FFFFFF',
    fond: '#EEF4FA',
    bordure: '#00539B',
    logo: '/images/carriers/chronopost.svg'
  }
};

/** Repli neutre : un transporteur inconnu ne doit pas casser l'affichage. */
const INCONNU = {
  label: 'Transporteur inconnu',
  court: 'INCONNU',
  couleur: '#6C757D',
  encre: '#FFFFFF',
  fond: '#F1F3F5',
  bordure: '#ADB5BD'
};

/**
 * @param {?string} code - code transporteur (`laposte`, `mondial_relay`…)
 * @param {?string} [accountCode] - contrat : distingue 2Shop (`2shop`) de
 *        Chronopost, rangés sous le même code transporteur
 * @returns {{label: string, court: string, couleur: string, encre: string,
 *   fond: string, bordure: string, logo?: string, mention?: string}}
 */
export const visuelTransporteur = (code, accountCode) => {
  const visuel = VISUELS[code] || INCONNU;
  if (code === 'chronopost' && accountCode === '2shop') {
    return { ...visuel, label: 'Chronopost 2Shop', court: '2SHOP', mention: '2Shop' };
  }
  return visuel;
};

/** Codes ayant une identité déclarée — pour les listes de réglages. */
export const codesTransporteurs = () => Object.keys(VISUELS);

export default visuelTransporteur;
