// Filtres de périmètre partagés par l'onglet Marques de /stats et les pages de
// détail (marque, sous-marque, catégorie, sous-catégorie).
//
// Deux sens de lecture, symétriques :
//   • sur une marque   → on restreint à un rayon / une famille du catalogue
//   • sur une catégorie → on restreint à une marque / une sous-marque
//
// Les valeurs sont préfixées ('cat:', 'sub:', 'brand:', 'subbrand:') pour tenir
// dans un seul <select>, et converties en paramètres d'API par scopeToParams().

import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = '/api';

// Les libellés WooCommerce arrivent encodés (« Box &amp; Mods »)
export const decodeEntities = (s) => (s || '')
  .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

export const scopeToParams = (scope) => {
  if (!scope) return {};
  const value = scope.slice(scope.indexOf(':') + 1);
  if (scope.startsWith('cat:')) return { category: value };
  if (scope.startsWith('sub:')) return { subCategory: value };
  if (scope.startsWith('brand:')) return { brand: value };
  if (scope.startsWith('subbrand:')) return { subBrand: value };
  return {};
};

export const scopeLabel = (scope) =>
  (scope ? decodeEntities(scope.slice(scope.indexOf(':') + 1)) : '');

// Deux graphies du même libellé (« E-Liquides pour… » / « E Liquides pour… ») ne
// font qu'une entrée : le backend compare lui aussi sans casse ni ponctuation.
const normKey = (v) => decodeEntities(v).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

export const dedupe = (list) => {
  const seen = new Set();
  return (list || []).filter((v) => {
    const k = normKey(v);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Listes du catalogue (marques, rayons, familles), chargées une fois par écran.
 * `context` restreint les propositions au périmètre de la page : sur une marque,
 * seuls ses rayons apparaissent, avec le nombre de SES produits.
 *   { brand } | { subBrand } | { category } | { subCategory }
 */
export function useCatalogOptions(context) {
  const [options, setOptions] = useState({
    brands: [], sub_brands: [], categories: [], sub_categories: [], category_tree: [],
  });
  const contextKey = JSON.stringify(context || {});

  useEffect(() => {
    axios.get(`${API_BASE_URL}/products/stats-filter-options`, { params: JSON.parse(contextKey) })
      .then((r) => { if (r.data?.success) setOptions((prev) => ({ ...prev, ...r.data.data })); })
      .catch(() => {});
  }, [contextKey]);

  return options;
}

const selectStyle = (active) => ({
  padding: '9px 12px', border: '1px solid #ddd', borderRadius: '6px',
  fontSize: '14px', background: '#fff', color: '#374151', maxWidth: '100%',
  fontWeight: active ? 700 : 400,
});

/** Rayon / famille du catalogue — pour une page ou un tableau de marques. */
export function CategoryScopeSelect({ scope, setScope, options }) {
  const tree = options.category_tree || [];
  return (
    <select
      value={scope}
      onChange={(e) => setScope(e.target.value)}
      title="Limiter à un rayon du catalogue (ex. Eliquides 10ml)"
      style={selectStyle(scope)}
    >
      <option value="">Tout le catalogue</option>
      {tree.length > 0 ? (
        // Le rayon est lui-même une ligne sélectionnable ; ses familles sont
        // indentées dessous. Pas d'en-tête de groupe : il répéterait le rayon.
        tree.flatMap((g) => [
          <option key={`cat:${g.category}`} value={`cat:${g.category}`}>
            {decodeEntities(g.category)} ({g.count})
          </option>,
          ...g.sub_categories.map((sc) => (
            <option key={`sub:${sc.name}`} value={`sub:${sc.name}`}>
              {'\u2003'}{decodeEntities(sc.name)} ({sc.count})
            </option>
          )),
        ])
      ) : (<>
        <optgroup label="Catégorie">
          {dedupe(options.categories).map((c) => (
            <option key={`cat:${c}`} value={`cat:${c}`}>{decodeEntities(c)}</option>
          ))}
        </optgroup>
        <optgroup label="Sous-catégorie">
          {dedupe(options.sub_categories).map((c) => (
            <option key={`sub:${c}`} value={`sub:${c}`}>{decodeEntities(c)}</option>
          ))}
        </optgroup>
      </>)}
    </select>
  );
}

/** Marque / sous-marque — pour une page de catégorie. */
export function BrandScopeSelect({ scope, setScope, options }) {
  return (
    <select
      value={scope}
      onChange={(e) => setScope(e.target.value)}
      title="Limiter à une marque (ex. Pulp)"
      style={selectStyle(scope)}
    >
      <option value="">Toutes les marques</option>
      <optgroup label="Marque">
        {dedupe(options.brands).map((b) => (
          <option key={`brand:${b}`} value={`brand:${b}`}>{decodeEntities(b)}</option>
        ))}
      </optgroup>
      <optgroup label="Sous-marque">
        {dedupe(options.sub_brands).map((b) => (
          <option key={`subbrand:${b}`} value={`subbrand:${b}`}>{decodeEntities(b)}</option>
        ))}
      </optgroup>
    </select>
  );
}
