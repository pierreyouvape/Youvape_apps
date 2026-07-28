/**
 * Récupération du HTML d'une fiche produit concurrente.
 *
 * 1. Tente un fetch HTTP direct depuis le VPS (rapide, gratuit).
 * 2. Si le site bloque l'IP du VPS (403/429/503, ou réponse trop courte),
 *    bascule sur un service de scraping tiers (ScraperAPI) si une clé est
 *    configurée dans app_config (scraperapi_key). Proxy résidentiel + rendu.
 *    Les 500 ScraperAPI étant souvent transitoires, on réessaie 2-3 fois.
 *
 * Retourne { html, source: 'direct'|'scraper', status, blocked }.
 */

const axios = require('axios');
const appConfigModel = require('../models/appConfigModel');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// En dessous, on considère la réponse comme une page de blocage, pas un vrai contenu
const MIN_HTML_BYTES = 8000;

const looksBlocked = (status, html) =>
  status === 403 || status === 429 || status === 503 || !html || html.length < MIN_HTML_BYTES;

const fetchDirect = async (url) => {
  try {
    const res = await axios.get(url, {
      timeout: 25000,
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: (s) => s < 500,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    return { html: typeof res.data === 'string' ? res.data : '', status: res.status };
  } catch (err) {
    return { html: '', status: err.response?.status || 0, error: err.message };
  }
};

// ScraperAPI avec retry (les 500 sont souvent transitoires : charge / timeout)
const fetchViaScraper = async (url, apiKey, attempts = 3) => {
  let last = { html: '', status: 0 };
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get('https://api.scraperapi.com/', {
        timeout: 70000, // le rendu + proxy peut être lent
        responseType: 'text',
        validateStatus: (s) => s < 600,
        params: { api_key: apiKey, url, country_code: 'fr' },
      });
      const html = typeof res.data === 'string' ? res.data : '';
      if (res.status < 500 && html) return { html, status: res.status };
      last = { html, status: res.status };
    } catch (err) {
      last = { html: '', status: err.response?.status || 0, error: err.message };
    }
    if (i < attempts - 1) await sleep(3000);
  }
  return last;
};

/**
 * @param {string} url
 * @returns {Promise<{html:string, source:string, status:number, blocked:boolean, error?:string}>}
 */
async function fetchPage(url) {
  const direct = await fetchDirect(url);

  if (!looksBlocked(direct.status, direct.html)) {
    return { html: direct.html, source: 'direct', status: direct.status, blocked: false };
  }

  const keyCfg = await appConfigModel.get('scraperapi_key');
  const apiKey = keyCfg?.config_value?.trim();

  if (!apiKey) {
    return {
      html: direct.html,
      source: 'direct',
      status: direct.status,
      blocked: true,
      error: `Bloqué en direct (HTTP ${direct.status}) et aucune clé ScraperAPI configurée`,
    };
  }

  const scr = await fetchViaScraper(url, apiKey);
  if (looksBlocked(scr.status, scr.html)) {
    return {
      html: scr.html,
      source: 'scraper',
      status: scr.status,
      blocked: true,
      error: scr.error ? `Service de scraping en échec: ${scr.error}` : `Service de scraping en échec (HTTP ${scr.status})`,
    };
  }
  return { html: scr.html, source: 'scraper', status: scr.status, blocked: false };
}

module.exports = { fetchPage };
