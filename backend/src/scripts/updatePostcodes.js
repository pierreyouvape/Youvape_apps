/**
 * Met à jour la base officielle des codes postaux de La Poste (« base
 * HEXASMAL », open data, licence ouverte Etalab) utilisée par le contrôle
 * code postal / commune avant étiquetage (`services/carriers/postcodeCheck`).
 *
 * Usage : node src/scripts/updatePostcodes.js [fichier.csv]
 *   sans argument : télécharge la dernière version sur datanova.laposte.fr.
 *
 * Le fichier produit est versionné avec le code : une commune créée ou
 * fusionnée n'arrive qu'après un nouveau passage de ce script et un déploiement.
 * La base bouge peu (quelques fusions de communes par an) : un passage par
 * trimestre suffit.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SOURCE = 'https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw';
const CIBLE = path.join(__dirname, '../assets/postcodes/laposte-hexasmal.json');

const lire = async (fichier) => {
  if (fichier) return fs.readFileSync(fichier);
  const { data } = await axios.get(SOURCE, { responseType: 'arraybuffer', timeout: 60000 });
  return Buffer.from(data);
};

(async () => {
  // Le fichier est en ISO-8859-1, séparateur « ; », première ligne d'en-tête.
  const texte = (await lire(process.argv[2])).toString('latin1');
  const lignes = texte.split(/\r?\n/).filter(Boolean);
  if (!/Code_postal/i.test(lignes[0])) throw new Error(`En-tête inattendu : ${lignes[0]}`);

  // { "84800": [["L ISLE SUR LA SORGUE", "L ISLE SUR LA SORGUE", ""], …] }
  // = [nom de la commune, libellé d'acheminement, ligne 5 (lieu-dit)]
  const base = {};
  for (const ligne of lignes.slice(1)) {
    const [, nom, cp, acheminement, ligne5] = ligne.split(';').map((c) => (c || '').trim());
    if (!/^\d{5}$/.test(cp)) continue;
    (base[cp] ||= []).push([nom, acheminement, ligne5]);
  }

  const nbCp = Object.keys(base).length;
  // Garde-fou : une réponse tronquée ou une page d'erreur ne doit pas remplacer la base.
  if (nbCp < 6000) throw new Error(`Seulement ${nbCp} codes postaux lus : fichier incomplet ?`);

  fs.mkdirSync(path.dirname(CIBLE), { recursive: true });
  fs.writeFileSync(CIBLE, JSON.stringify({ source: SOURCE, generatedAt: new Date().toISOString().slice(0, 10), base }));
  console.log(`${nbCp} codes postaux, ${lignes.length - 1} lignes → ${path.relative(process.cwd(), CIBLE)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
