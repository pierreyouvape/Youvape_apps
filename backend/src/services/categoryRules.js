/**
 * Catégorie retenue pour un produit — règles pures (testées : tests/categoryRules.test.js).
 *
 * `products` ne garde qu'une catégorie (category = parent, sub_category = terme).
 * yousync prend `$categories[0]` de wp_get_post_terms, trié par NOM : un produit
 * rangé à la fois en « Eliquides 10ml » et en « Eliquides Sel de Nicotine » serait
 * compté en 10 ml, et un produit rangé aussi en « DLUO » partirait en DLUO.
 *
 * Ordre de choix :
 *   1. la catégorie principale (Yoast), lue dans le permalien du produit
 *      (/produit/<parent>/<terme>/<slug>) ;
 *   2. sinon le terme le plus profond, Sels de nicotine avant 10 ml, puis par nom.
 * Les catégories de destockage (DLUO, promo, prix cassé, Non classé) ne sont
 * retenues que si le produit n'a rien d'autre.
 */

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

// Catégories qui disent « comment c'est vendu », pas « ce que c'est ».
const NON_FAMILLE = /DLUO|non class|prix cass|promotion/i;
const NON_FAMILLE_SLUGS = new Set(['uncategorized', 'non-classe']);

// Un produit dans les deux : le format le plus précis l'emporte.
const PRIORITE = ['eliquides-sels-de-nicotine'];

const depth = (term, byId) => {
  let d = 0;
  for (let t = term, seen = 0; t && t.parent && seen < 10; seen++) { d++; t = byId.get(t.parent); }
  return d;
};

const isNonFamille = (term, byId) => {
  if (!term) return false;
  if (NON_FAMILLE_SLUGS.has(term.slug) || NON_FAMILLE.test(term.name || '')) return true;
  const parent = term.parent ? byId.get(term.parent) : null;
  return Boolean(parent && (NON_FAMILLE_SLUGS.has(parent.slug) || NON_FAMILLE.test(parent.name || '')));
};

// Dernier dossier du permalien = slug de la catégorie principale. null pour un brouillon (?p=…).
const primarySlug = (permalink) => {
  if (!permalink) return null;
  let path;
  try { path = new URL(permalink).pathname; } catch { return null; }
  const parts = path.split('/').filter(Boolean);
  const i = parts.indexOf('produit');
  if (i < 0 || parts.length - i < 3) return null;
  return parts[parts.length - 2];
};

/**
 * @param {{categories: {id:number}[], permalink?: string}} product  produit wc/v3
 * @param {Map<number, {id, name, slug, parent}>} byId  termes product_cat (noms bruts)
 * @returns {{category: string, sub_category: string|null}|null}
 */
const pickCategory = (product, byId) => {
  const terms = (product.categories || []).map((c) => byId.get(c.id)).filter(Boolean);
  if (!terms.length) return null;

  const familles = terms.filter((t) => !isNonFamille(t, byId));
  const pool = familles.length ? familles : terms;

  const slug = primarySlug(product.permalink);
  let chosen = slug ? pool.find((t) => t.slug === slug) : null;
  // Principale = un parent, et le produit est aussi dans un de ses enfants : l'enfant est plus précis.
  if (chosen) chosen = pool.find((t) => t.parent === chosen.id) || chosen;

  if (!chosen) {
    const rank = (t) => { const i = PRIORITE.indexOf(t.slug); return i < 0 ? PRIORITE.length : i; };
    chosen = [...pool].sort((a, b) =>
      depth(b, byId) - depth(a, byId) || rank(a) - rank(b) || collator.compare(a.name, b.name))[0];
  }

  const parent = chosen.parent ? byId.get(chosen.parent) : null;
  return parent
    ? { category: parent.name, sub_category: chosen.name }
    : { category: chosen.name, sub_category: null };
};

module.exports = { pickCategory, primarySlug, isNonFamille };
