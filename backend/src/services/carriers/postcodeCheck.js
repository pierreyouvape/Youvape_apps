/**
 * Contrôle code postal / commune d'une adresse française, avant étiquetage.
 *
 * Colissimo facture un supplément « qualité d'annonce » (3 € HT, motif
 * « Problème CP / Commune ») quand la commune annoncée n'existe pas pour le
 * code postal. La référence est la base officielle de La Poste (HEXASMAL),
 * figée dans `assets/postcodes/` et rafraîchie par `scripts/updatePostcodes.js`.
 *
 * Le contrôle compare des CLÉS, pas le texte : majuscules, sans accents, toute
 * ponctuation ramenée à une espace, « ST » lu « SAINT ». « L’Isle-sur-la-Sorgue »,
 * « l isle sur la sorgue » et « L'ISLE-SUR-LA-SORGUE » sont la même commune.
 *
 * Quatre verdicts :
 *   - `ok`         la commune existe pour ce code postal, rien à changer ;
 *   - `corrige`    une seule commune du code postal est assez proche (faute de
 *                  frappe) : son libellé d'acheminement officiel la remplace ;
 *   - `a_choisir`  aucune commune du code postal ne ressemble, ou plusieurs :
 *                  l'opérateur choisit (le code postal lui-même peut être faux) ;
 *   - `cp_inconnu` le code postal n'existe pas.
 * Hors de France, ou sans code postal, le contrôle ne dit rien (`null`).
 */
const fs = require('fs');
const path = require('path');
const { sanitizeAddressField, transliterateLatin } = require('./addressFields');

const FICHIER = path.join(__dirname, '../../assets/postcodes/laposte-hexasmal.json');

// Chargée au premier contrôle : 1,4 Mo qu'on n'impose pas au démarrage.
let base = null;
const getBase = () => {
  if (!base) base = JSON.parse(fs.readFileSync(FICHIER, 'utf8')).base;
  return base;
};

// Commune (clé sans espaces) → ses codes postaux, toute la France.
let index = null;
const getIndex = () => {
  if (index) return index;
  index = new Map();
  for (const [cp, communes] of Object.entries(getBase())) {
    for (const [nom, acheminement] of communes) {
      for (const v of [nom, acheminement]) {
        const k = compact(cle(v));
        if (!index.has(k)) index.set(k, new Set());
        index.get(k).add(cp);
      }
    }
  }
  return index;
};

// Pays dont les codes postaux sont dans la base La Poste (France, DROM, Monaco).
const PAYS_CONTROLES = new Set(['FR', 'MC', 'GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF']);

const ABREVIATIONS = { ST: 'SAINT', STE: 'SAINTE', STS: 'SAINTS', STES: 'SAINTES' };

/** Clé de comparaison d'un nom de commune. */
const cle = (value) => {
  const s = transliterateLatin(sanitizeAddressField(String(value ?? '')) || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  return s.split(' ').filter(Boolean).map((m) => ABREVIATIONS[m] || m).join(' ');
};

// Ce que les clients ajoutent autour de la commune : le code postal
// (« VANNES (56000) », « 30127 - BELLEGARDE »), le pays (« FR – … »,
// « …, France »), le département (« Haute-Garonne (31) »), « CEDEX 9 »,
// l'arrondissement (« Paris 15ème », « Lyon 3e »).
const sansSuffixe = (k) => k
  .replace(/\b\d{5}\b/g, ' ')
  .replace(/^(FR|FRANCE) /, '')
  .replace(/ (FR|FRANCE)$/, '')
  .replace(/ CEDEX( \d+)?$/, '')
  .replace(/ \d{1,2}( ?(E|EME|ER|IEME))?( ARRONDISSEMENT)?$/, '')
  .replace(/\s+/g, ' ')
  .trim();

// `court` est-il une suite de mots entiers de `long` ?
const contientMots = (long, court) => ` ${long} `.includes(` ${court} `);

const compact = (k) => k.replace(/ /g, '');

/** Distance d'édition (Levenshtein), bornée : au-delà de `max`, renvoie max + 1. */
const distance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let minLigne = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < minLigne) minLigne = cur[j];
    }
    if (minLigne > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
};

// Fautes tolérées : 1 pour un nom court (« LUNEL »/« LUNAL » oui, mais
// « LAGNES »/« LAGNEZ »…), 2 au-delà de 8 lettres.
const tolerance = (k) => (k.length <= 4 ? 0 : k.length <= 8 ? 1 : 2);

/**
 * @param {{ postcode?: string, city?: string, country?: string }} adresse
 * @returns {null | { status: 'ok'|'corrige'|'a_choisir'|'cp_inconnu',
 *   city: string, suggestions: string[], otherPostcodes: string[] }}
 *   `city` = la ville à imprimer (corrigée si `corrige`, sinon telle que saisie) ;
 *   `suggestions` = libellés officiels du code postal, à proposer à l'écran ;
 *   `otherPostcodes` = codes postaux où la ville saisie existe telle quelle
 *   (le code postal est alors sans doute faux : « Castelnau-le-Lez » au 34000).
 */
const checkPostcodeCity = ({ postcode, city, country } = {}) => {
  const pays = String(country || 'FR').trim().toUpperCase();
  if (!PAYS_CONTROLES.has(pays)) return null;
  const cp = String(postcode || '').replace(/\s+/g, '');
  if (!cp) return null;
  const saisie = String(city ?? '');

  const k = cle(saisie);
  const otherPostcodes = [...(getIndex().get(compact(sansSuffixe(k))) || [])].filter((x) => x !== cp).sort();

  const communes = getBase()[cp];
  if (!communes) return { status: 'cp_inconnu', city: saisie, suggestions: [], otherPostcodes };

  // Libellés officiels proposés à l'écran : l'acheminement, unique par commune.
  const suggestions = [...new Set(communes.map(([, acheminement]) => acheminement))].sort();

  // Toutes les écritures admises pour ce code postal, avec le libellé à imprimer.
  const connus = [];
  for (const [nom, acheminement, ligne5] of communes) {
    for (const v of [nom, acheminement, ligne5]) {
      if (!v) continue;
      const kv = cle(v);
      connus.push({ k: kv, libelle: acheminement });
      // « Houat » pour ILE D HOUAT, « Hoedic » pour ILE DE HOEDIC (commande 1140680).
      const ile = kv.replace(/^ILE (D|DE|DU|DES) /, '');
      // Écriture admise, pas officielle : l'étiquette prend le libellé.
      if (ile !== kv) connus.push({ k: ile, libelle: acheminement, alias: true });
    }
  }

  const candidats = [...new Set([k, sansSuffixe(k)])].filter(Boolean);
  const verdict = (status, ville = saisie) => ({ status, city: ville, suggestions, otherPostcodes });
  if (!candidats.length) return verdict('a_choisir');

  // Même commune, à la ponctuation près — y compris « LISLE » pour « L ISLE ».
  const egale = (x) => connus.find((c) => c.k === x || compact(c.k) === compact(x));
  const exacte = egale(k);
  if (exacte) return exacte.alias ? verdict('corrige', exacte.libelle) : verdict('ok');
  // Même commune une fois retiré ce qui l'entoure : on imprime le libellé
  // officiel, pas « VANNES 56000 ».
  const nettoyee = egale(sansSuffixe(k));
  if (nettoyee) return verdict('corrige', nettoyee.libelle);

  // La ville saisie existe, mais sous un autre code postal : c'est le code
  // postal qui est faux, aucune commune d'ici ne doit la remplacer.
  // « 76500 Caudebec-lès-Elbeuf » (76320) serait sinon devenu ELBEUF.
  const villeAilleurs = otherPostcodes.length > 0;

  // Faute de frappe : une seule commune assez proche.
  const proches = new Set();
  for (const c of connus) {
    for (const x of candidats) {
      if (distance(compact(x), compact(c.k), tolerance(compact(c.k))) <= tolerance(compact(c.k))) proches.add(c.libelle);
    }
  }
  if (proches.size === 1 && !villeAilleurs) return verdict('corrige', [...proches][0]);

  // Nom incomplet (« Le Touquet » pour LE TOUQUET PARIS PLAGE, « Saint-Ouen »
  // pour ST OUEN SUR SEINE) ou entouré d'autre chose (« Ajaccio (Mezzavia) »,
  // « 18 Ronde des Gargouilles, Istres, France ») : retenu s'il ne désigne
  // qu'une commune du code postal. Quatre lettres au moins, pour qu'un « LE »
  // ou un « ST » isolé ne désigne rien. Un nom incomplet reste accepté même
  // s'il existe ailleurs : « 17290 Aigrefeuille » est AIGREFEUILLE D AUNIS,
  // pas l'Aigrefeuille de Haute-Garonne.
  if (proches.size === 0) {
    const inclus = new Set();
    for (const c of connus) {
      for (const x of candidats) {
        if (x.length >= 4 && contientMots(c.k, x) && c.k.startsWith(x.split(' ')[0])) inclus.add(c.libelle);
        if (!villeAilleurs && c.k.length >= 4 && contientMots(x, c.k)) inclus.add(c.libelle);
      }
    }
    if (inclus.size === 1) return verdict('corrige', [...inclus][0]);
  }

  return verdict('a_choisir');
};

/**
 * L'adresse a-t-elle été validée telle quelle au Picking (« Adresse vérifiée,
 * garder telle quelle ») ? Seulement pour le couple validé : un code postal ou
 * une ville modifiés depuis relancent le contrôle.
 *
 * @param {?{postcode?: string, city?: string}} confirmed - `orders.postcode_city_confirmed`
 * @param {{postcode?: string, city?: string}} adresse - adresse actuelle
 */
const isConfirmed = (confirmed, { postcode, city } = {}) => Boolean(confirmed)
  && String(confirmed.postcode ?? '').replace(/\s+/g, '') === String(postcode ?? '').replace(/\s+/g, '')
  && cle(confirmed.city) === cle(city);

module.exports = { checkPostcodeCity, isConfirmed, cle };
