/**
 * Nettoyage des champs d'adresse destinataire, commun à tous les transporteurs.
 *
 * WooCommerce stocke parfois des entités HTML brutes dans les adresses
 * (`&#8211;`, `&amp;`, `&eacute;`) et laisse passer la typographie collée par
 * les clients (tirets cadratins, apostrophes courbes, espaces insécables). Les
 * API transporteurs les refusent ou les impriment tels quels sur l'étiquette :
 * La Poste rejette l'entité brute dans `name1`/`add4`, et le problème est le
 * même chez les autres — d'où un module partagé plutôt qu'une copie par
 * adaptateur.
 *
 * Extrait tel quel de `controllers/laposteController` (lot 0 du chantier
 * expédition) : le comportement doit rester identique au caractère près, c'est
 * lui qui a été validé en production sur la lettre suivie.
 */

// Caractères invisibles : marques de direction bidirectionnelle, espaces de
// largeur nulle, BOM. Ils arrivent des claviers arabes et hébreux et des
// copier-coller depuis un traitement de texte. Invisibles à l'écran, ils font
// échouer la validation des transporteurs sans que personne comprenne pourquoi :
// la commande 1259134 portait un U+202A devant le prénom et faisait échouer la
// clé de sécurité Mondial Relay côté BMS.
const INVISIBLES = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

// Ligatures et lettres barrées, sans décomposition Unicode.
const LIGATURES = [
  ['Œ', 'OE'], ['œ', 'oe'], ['Æ', 'AE'], ['æ', 'ae'], ['ß', 'ss'],
  ['Ł', 'L'], ['ł', 'l'], ['Đ', 'D'], ['đ', 'd'], ['Ð', 'D'], ['ð', 'd'],
  ['Þ', 'TH'], ['þ', 'th'], ['ı', 'i'], ['İ', 'I'], ['ſ', 's']
];

const sanitizeAddressField = (value) => {
  if (value === null || value === undefined) return value;
  let s = String(value);

  // Entités HTML numériques décimales : &#8211; -> –
  s = s.replace(/&#(\d+);/g, (_, code) => {
    try { return String.fromCodePoint(parseInt(code, 10)); } catch (e) { return ''; }
  });
  // Entités HTML numériques hexadécimales : &#x2013; -> –
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
    try { return String.fromCodePoint(parseInt(code, 16)); } catch (e) { return ''; }
  });
  // Entités nommées courantes
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â',
    ccedil: 'ç', ugrave: 'ù', ucirc: 'û', icirc: 'î', ocirc: 'ô',
    ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»'
  };
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => (name in named ? named[name] : m));

  // Normalisation typographique vers ASCII acceptés par La Poste
  s = s
    .replace(/[‐-―−]/g, '-')   // tirets typographiques -> -
    .replace(/[‘’‛]/g, "'")    // apostrophes typographiques -> '
    .replace(/[“”]/g, '"')          // guillemets typographiques -> "
    .replace(/[  ]/g, ' ');          // espaces insécables -> espace normal

  // Supprimer les caractères de contrôle, normaliser les espaces multiples
  s = s.replace(/[\x00-\x1f\x7f]/g, '').replace(INVISIBLES, '').replace(/\s+/g, ' ').trim();

  return s;
};

/**
 * Ramène à leur lettre de base les caractères latins que les transporteurs
 * n'acceptent pas.
 *
 * Les API d'étiquetage n'admettent en général que le latin-1 accentué
 * (`À-ÖØ-öø-ÿ`). Tout ce qui sort de là — le turc `ğ`, le hongrois `ő`, le
 * polonais `ł`, la ligature `œ` — fait échouer la validation. Les rendre à leur
 * base (`g`, `o`, `l`, `oe`) vaut mieux que les supprimer : « Gőz » devient
 * « Goz », lisible et livrable, là où le retrait donnerait « Gz ».
 *
 * @param {string} value
 * @returns {string}
 */
const transliterateLatin = (value) => {
  let s = String(value ?? '');

  // Ligatures et lettres barrées : aucune décomposition Unicode ne les couvre.
  for (const [from, to] of LIGATURES) s = s.split(from).join(to);

  // Décomposition canonique puis retrait des diacritiques restants. Les
  // accents du latin-1 ont déjà été conservés par l'appelant s'il les accepte.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
};

/**
 * Restreint une valeur au jeu de caractères accepté par un transporteur.
 *
 * Marche en trois temps : nettoyage commun, translittération de ce qui a un
 * équivalent latin, puis suppression de ce qui reste hors jeu. Un caractère
 * supprimé devient une espace plutôt que rien : « Dupont(Fils) » donne
 * « Dupont Fils » et non « DupontFils ».
 *
 * @param {string} value
 * @param {RegExp} allowed - classe des caractères ADMIS, ex. /[A-Za-z ]/
 * @returns {string}
 */
const restrictToCharset = (value, allowed) => {
  const source = sanitizeAddressField(String(value ?? '')) || '';

  // « & » porte du sens dans les raisons sociales : le perdre en silence
  // transformerait « Durand & Fils » en « Durand Fils ».
  let s = source.replace(/&/g, ' et ');

  return [...s]
    .map((c) => (allowed.test(c) ? c : (allowed.test(transliterateLatin(c)) ? transliterateLatin(c) : ' ')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
};

module.exports = { sanitizeAddressField, transliterateLatin, restrictToCharset };
