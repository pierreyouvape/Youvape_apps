/**
 * Recherche produit chez Le Petit Vapoteur via son API Algolia publique
 * (clés de recherche embarquées côté navigateur, non bloquées, sans ScraperAPI).
 * Sert à retrouver automatiquement l'URL LPV d'un produit à partir de son nom.
 */
const axios = require('axios');

const APP = 'JXVGH865AN';
const KEY = '09e4a8248a2bde2c62782305ea417c78'; // clé Search-Only publique
const INDEX = 'Prod_LPV_B2C_FR_V2';

/**
 * @param {string} query
 * @param {number} hitsPerPage
 * @returns {Promise<Array>} hits Algolia (name, current_product_link, price_ht, id_manufacturer…)
 */
async function searchLpv(query, hitsPerPage = 5) {
  const res = await axios.post(
    `https://${APP}-dsn.algolia.net/1/indexes/${INDEX}/query`,
    { params: `query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}` },
    {
      headers: {
        'X-Algolia-Application-Id': APP,
        'X-Algolia-API-Key': KEY,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );
  return res.data?.hits || [];
}

module.exports = { searchLpv };
