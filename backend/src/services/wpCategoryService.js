/**
 * Catégories de produits WooCommerce (taxonomie product_cat), lues sur le site
 * par l'API REST publique de WordPress, pour rattacher un widget de stories à
 * une catégorie entière (app /stories).
 *
 * La liste (une soixantaine de termes) est gardée 10 min en mémoire : la
 * recherche dans l'app ne relance pas un appel au site à chaque lettre tapée.
 */
const axios = require('axios');
const pool = require('../config/database');

const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, list: null };

const siteUrl = async () => {
  const { rows } = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const url = rows[0]?.config_value;
  if (!url) throw new Error('Adresse du site introuvable (app_config.wc_sync_wp_url)');
  return url.replace(/\/+$/, '');
};

/** Toutes les catégories, avec leur chemin lisible (« Parent › Enfant »). */
const listCategories = async () => {
  if (cache.list && Date.now() - cache.at < TTL_MS) return cache.list;
  const base = await siteUrl();
  const terms = [];
  for (let page = 1; page <= 10; page += 1) {
    const res = await axios.get(`${base}/wp-json/wp/v2/product_cat`, {
      params: { per_page: 100, page, _fields: 'id,name,slug,parent,count' },
      timeout: 20000,
    });
    if (!Array.isArray(res.data)) throw new Error('Réponse inattendue du site pour les catégories');
    terms.push(...res.data);
    if (page >= Number(res.headers['x-wp-totalpages'] || 1)) break;
  }
  const byId = new Map(terms.map((t) => [t.id, t]));
  const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#039;/g, "'");
  const pathOf = (t) => {
    const names = [];
    for (let cur = t, guard = 0; cur && guard < 10; cur = byId.get(cur.parent), guard += 1) names.unshift(decode(cur.name));
    return names.join(' › ');
  };
  const list = terms.map((t) => ({
    id: t.id, name: decode(t.name), slug: t.slug, parent: t.parent, count: t.count, path: pathOf(t),
  })).sort((a, b) => a.path.localeCompare(b.path, 'fr'));
  cache = { at: Date.now(), list };
  return list;
};

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche dans le nom ou le chemin (sans accents) ; vide = toutes. */
const searchCategories = async (q) => {
  const list = await listCategories();
  const term = normalize(q).trim();
  return term ? list.filter((c) => normalize(c.path).includes(term)) : list;
};

const getCategory = async (id) => (await listCategories()).find((c) => c.id === Number(id)) || null;

module.exports = { listCategories, searchCategories, getCategory };
