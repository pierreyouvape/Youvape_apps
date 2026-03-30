/**
 * Construit une condition SQL de recherche multi-mots insensible aux accents.
 *
 * Pour chaque mot du terme de recherche, génère un bloc AND qui vérifie
 * que le mot apparaît dans au moins un des champs fournis.
 *
 * Exemple : "kit kiwi" sur ['p.post_title', 'p.sku']
 *   => (unaccent(p.post_title||' '||coalesce(p.sku,'')) ILIKE unaccent($1))
 *      AND (unaccent(p.post_title||' '||coalesce(p.sku,'')) ILIKE unaccent($2))
 *   params: ['%kit%', '%kiwi%']
 *
 * @param {string} searchTerm  - Terme saisi par l'utilisateur
 * @param {string[]} fields    - Colonnes SQL à inclure dans la recherche
 * @param {number} startIndex  - Index de départ pour les paramètres ($1, $2…)
 * @returns {{ clause: string, params: string[], nextIndex: number }}
 */
function buildSearchCondition(searchTerm, fields, startIndex = 1) {
  const words = searchTerm.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return { clause: 'TRUE', params: [], nextIndex: startIndex };
  }

  // Concatène tous les champs en une seule expression pour unaccent
  const combined = fields.length === 1
    ? fields[0]
    : fields[0] + fields.slice(1).map(f => ` || ' ' || COALESCE(${f}, '')`).join('');

  const expr = `unaccent(${combined})`;

  const wordClauses = words.map((_, i) => `${expr} ILIKE unaccent($${startIndex + i})`);
  const clause = '(' + wordClauses.join(' AND ') + ')';
  const params = words.map(w => `%${w}%`);

  return { clause, params, nextIndex: startIndex + words.length };
}

module.exports = { buildSearchCondition };
