const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Filtres produits partagés par l'onglet Produits (liste, vue par mois) et par
// l'onglet Catégories : mêmes champs, mêmes opérateurs, même traitement des
// attributs de déclinaison. Un seul endroit à faire évoluer.

const STATS_FILTER_FIELDS = {
  stock: 'number', qty_sold: 'number', velocity: 'number', coverage_days: 'number',
  margin_percent: 'number', ca_ttc: 'number', ca_ht: 'number', cost_ht: 'number',
  unit_cost: 'number', stock_value: 'number', price: 'number', weight: 'number',
  last_sold: 'date', first_sold: 'date', created_date: 'date',
  brand: 'text', sub_brand: 'text', category: 'text', sub_category: 'text',
  post_title: 'text',
  supplier: 'text', stock_status: 'text', product_type: 'enum',
};
// Un produit peut porter plusieurs marques dans WordPress alors que
// products.brand n'en garde qu'une : wp_product_brands (brandMapService) complete.
/**
 * Construit une clause SQL (booléenne, sans le WHERE) à partir d'un tableau de filtres
 * { field, op, value, value2 } et d'un type de correspondance ('all' => AND, 'any' => OR).
 * Les champs et opérateurs sont whitelistés ; les valeurs sont paramétrées via P().
 * Retourne '' si aucun filtre valide.
 */
function buildStatsFilterClause(filters, matchType, P, opts = {}) {
  if (!Array.isArray(filters) || filters.length === 0) return '';
  // `alias` : préfixe de table quand la clause ne s'applique pas à la CTE `final`
  // (onglet Catégories : les colonnes viennent directement de `products p`).
  // `allow` : sous-ensemble de champs utilisable — les autres sont ignorés en
  // silence, comme un champ inconnu.
  const { alias = '', allow = null } = opts;
  const conds = [];
  for (const f of filters) {
    const type = STATS_FILTER_FIELDS[f && f.field];
    if (!type) continue;
    if (allow && !allow.includes(f.field)) continue;
    const col = alias ? `${alias}.${f.field}` : f.field; // whitelisté => sûr
    const op = f.op;

    if (type === 'number') {
      const v = Number(f.value);
      if (f.value === '' || f.value == null || Number.isNaN(v)) continue;
      const map = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '<>' };
      if (map[op]) conds.push(`${col} ${map[op]} ${P(v)}`);
      else if (op === 'between') {
        const v2 = Number(f.value2);
        if (Number.isNaN(v2)) continue;
        conds.push(`${col} BETWEEN ${P(v)} AND ${P(v2)}`);
      }
    } else if (type === 'date') {
      if (op === 'over_days_ago') { const n = Number(f.value); if (Number.isNaN(n)) continue; conds.push(`(${col} IS NULL OR ${col} < CURRENT_DATE - ${P(n)}::int)`); }
      else if (op === 'within_days') { const n = Number(f.value); if (Number.isNaN(n)) continue; conds.push(`${col} >= CURRENT_DATE - ${P(n)}::int`); }
      else if (op === 'before') { if (!isYmd(f.value)) continue; conds.push(`${col} < ${P(f.value)}`); }
      else if (op === 'after') { if (!isYmd(f.value)) continue; conds.push(`${col} > ${P(f.value)}`); }
      else if (op === 'between') { if (!isYmd(f.value) || !isYmd(f.value2)) continue; conds.push(`(${col} >= ${P(f.value)} AND ${col} < (${P(f.value2)}::date + 1))`); }
      else if (op === 'is_set') conds.push(`${col} IS NOT NULL`);
      else if (op === 'not_set') conds.push(`${col} IS NULL`);
    } else if (type === 'text') {
      if (f.value == null || f.value === '') continue;
      if (op === 'contains') conds.push(`${col} ILIKE ${P('%' + f.value + '%')}`);
      else if (op === 'eq') conds.push(`${col} = ${P(f.value)}`);
      else if (op === 'neq') conds.push(`${col} IS DISTINCT FROM ${P(f.value)}`);
    } else if (type === 'enum') {
      if (f.value == null || f.value === '') continue;
      if (op === 'neq') conds.push(`${col} <> ${P(f.value)}`);
      else conds.push(`${col} = ${P(f.value)}`);
    }
  }
  if (conds.length === 0) return '';
  return '(' + conds.join(matchType === 'any' ? ' OR ' : ' AND ') + ')';
}

// Un attribut WooCommerce vit à deux niveaux : sur la DÉCLINAISON quand il sert
// aux variations (« Saveur »), sur le PRODUIT sinon (« Taux de Nicotine : 0mg »
// d'une puff sans nicotine). Le filtre couvre les deux :
//   • produit  → toutes les ventes du produit comptent, il est 0 mg en entier ;
//   • déclinaison → seules les lignes de cette déclinaison comptent (le CA des
//     0 mg d'un e-liquide, pas celui de tout le produit).
// Les valeurs se comparent normalisées : WooCommerce stocke le libellé côté
// produit (« 0mg ») et le slug côté déclinaison (« 0-mg »).
const ATTR_KEY = /^(attribute_)?pa_[a-z0-9_-]+$/i;

// Même résultat que le SQL ci-dessous : minuscules, tout ce qui n'est ni lettre
// ni chiffre retiré, accents CONSERVÉS (lower() + [:alnum:] les gardent aussi).
const normalizeAttrValue = (v) => String(v == null ? '' : v)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const normSql = (expr) => `lower(regexp_replace(COALESCE(${expr}, ''), '[^[:alnum:]]+', '', 'g'))`;

function buildAttributeClauses(filters, P, opts = {}) {
  const {
    productAlias = 'p',
    soldPidExpr = 'ib.sold_pid',
    parentIdExpr = 'ib.parent_id',
  } = opts;
  const selection = [];
  const sales = [];
  for (const f of Array.isArray(filters) ? filters : []) {
    if (!f || f.field !== 'attribute') continue;
    const raw = String(f.value || '').trim();
    if (!ATTR_KEY.test(raw)) continue;
    const slug = raw.replace(/^attribute_/i, '');       // pa_taux-de-nicotine
    const value = normalizeAttrValue(f.value2);
    if (!value) continue;

    const slugP = P(slug);
    const metaP = P(`attribute_${slug}`);
    const valP = P(value);
    const not = f.op === 'neq' ? 'NOT ' : '';

    selection.push(`${not}(
      EXISTS (SELECT 1 FROM wp_product_attributes wa
               WHERE wa.wp_product_id = ${productAlias}.wp_product_id
                 AND wa.attribute = ${slugP} AND wa.value_norm = ${valP})
      OR EXISTS (SELECT 1 FROM products av
                  WHERE av.wp_parent_id = ${productAlias}.wp_product_id
                    AND ${normSql(`av.product_attributes->>${metaP}`)} = ${valP})
    )`);
    sales.push(`${not}(
      EXISTS (SELECT 1 FROM wp_product_attributes wa
               WHERE wa.wp_product_id = ${parentIdExpr}
                 AND wa.attribute = ${slugP} AND wa.value_norm = ${valP})
      OR EXISTS (SELECT 1 FROM products av
                  WHERE av.wp_product_id = ${soldPidExpr}
                    AND ${normSql(`av.product_attributes->>${metaP}`)} = ${valP})
    )`);
  }
  return {
    selection: selection.length ? ' AND ' + selection.join(' AND ') : '',
    sales,
  };
}

module.exports = { STATS_FILTER_FIELDS, buildStatsFilterClause, buildAttributeClauses, normalizeAttrValue, isYmd };
