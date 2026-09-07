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
  s = s.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();

  return s;
};

module.exports = { sanitizeAddressField };
