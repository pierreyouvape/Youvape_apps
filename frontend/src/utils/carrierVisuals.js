/**
 * Identité visuelle des transporteurs, pour le packing et les réglages.
 *
 * Le préparateur doit savoir **d'un coup d'œil** chez qui part le colis : il
 * enchaîne les commandes et n'a pas le temps de lire un libellé. D'où une
 * couleur pleine par transporteur et un fond teinté sur toute la fiche.
 *
 * Ce sont des pastilles nominatives, pas des logos : nous n'avons pas les
 * fichiers de marque, et un faux logo serait pire qu'un mot lisible. Les
 * couleurs reprennent celles des transporteurs pour que l'association se fasse
 * seule. Si les vrais logos arrivent un jour, il suffira d'ajouter un champ
 * `logo` ici — rien d'autre à changer.
 */

const VISUELS = {
  laposte: {
    label: 'La Poste',
    court: 'LA POSTE',
    couleur: '#FFCC00',   // jaune La Poste
    encre: '#003B7A',
    fond: '#FFFBEB',
    bordure: '#FFCC00'
  },
  mondial_relay: {
    label: 'Mondial Relay',
    court: 'MONDIAL RELAY',
    couleur: '#E30613',   // rouge Mondial Relay
    encre: '#FFFFFF',
    fond: '#FEF2F2',
    bordure: '#E30613'
  },
  interne: {
    label: 'Retrait magasin',
    court: 'RETRAIT MAGASIN',
    couleur: '#135E84',   // bleu Youvape
    encre: '#FFFFFF',
    fond: '#EFF6FB',
    bordure: '#135E84'
  },
  colissimo: {
    label: 'Colissimo',
    court: 'COLISSIMO',
    couleur: '#003B7A',
    encre: '#FFFFFF',
    fond: '#EEF3F9',
    bordure: '#003B7A'
  },
  chronopost: {
    label: 'Chronopost',
    court: 'CHRONOPOST',
    couleur: '#00539B',
    encre: '#FFFFFF',
    fond: '#EEF4FA',
    bordure: '#00539B'
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
 * @returns {{label: string, court: string, couleur: string, encre: string, fond: string, bordure: string}}
 */
export const visuelTransporteur = (code) => VISUELS[code] || INCONNU;

/** Codes ayant une identité déclarée — pour les listes de réglages. */
export const codesTransporteurs = () => Object.keys(VISUELS);

export default visuelTransporteur;
