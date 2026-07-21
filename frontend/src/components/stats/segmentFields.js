// Registre des champs et opérateurs du constructeur de segments (onglet Stats Produits).
// Doit rester cohérent avec STATS_FILTER_FIELDS côté backend (productModel.js).

export const FILTER_FIELDS = [
  // Stock & ventes
  { key: 'stock',          label: 'Stock',              type: 'number', group: 'Stock & ventes' },
  { key: 'qty_sold',       label: 'Vendu (période)',    type: 'number', group: 'Stock & ventes' },
  { key: 'velocity',       label: 'Ventes / jour',      type: 'number', group: 'Stock & ventes' },
  { key: 'coverage_days',  label: 'Couverture (jours)', type: 'number', group: 'Stock & ventes' },
  { key: 'stock_status',   label: 'État du stock',      type: 'enum',   group: 'Stock & ventes',
    options: [{ v: 'instock', l: 'En stock' }, { v: 'outofstock', l: 'Rupture' }, { v: 'onbackorder', l: 'Sur commande' }] },
  // Financier
  { key: 'margin_percent', label: '% Marge',            type: 'number', group: 'Financier' },
  { key: 'ca_ttc',         label: 'CA TTC (période)',   type: 'number', group: 'Financier' },
  { key: 'ca_ht',          label: 'CA HT (période)',    type: 'number', group: 'Financier' },
  { key: 'cost_ht',        label: 'Coût HT (période)',  type: 'number', group: 'Financier' },
  { key: 'unit_cost',      label: 'Coût unitaire',      type: 'number', group: 'Financier' },
  { key: 'price',          label: 'Prix TTC',           type: 'number', group: 'Financier' },
  // Dates
  { key: 'last_sold',      label: 'Dernière vente',     type: 'date',   group: 'Dates' },
  { key: 'first_sold',     label: 'Première vente',     type: 'date',   group: 'Dates' },
  { key: 'created_date',   label: 'Création produit',   type: 'date',   group: 'Dates' },
  // Attributs
  { key: 'brand',          label: 'Marque',             type: 'enum',   group: 'Attributs', optionsSource: 'brands' },
  { key: 'sub_brand',      label: 'Sous-marque',        type: 'enum',   group: 'Attributs', optionsSource: 'sub_brands' },
  { key: 'category',       label: 'Catégorie',          type: 'enum',   group: 'Attributs', optionsSource: 'categories' },
  { key: 'sub_category',   label: 'Sous-catégorie',     type: 'enum',   group: 'Attributs', optionsSource: 'sub_categories' },
  { key: 'supplier',       label: 'Fournisseur',        type: 'enum',   group: 'Attributs', optionsSource: 'suppliers' },
  { key: 'weight',         label: 'Poids (g)',          type: 'number', group: 'Attributs' },
  { key: 'product_type',   label: 'Type',               type: 'enum',   group: 'Attributs',
    options: [{ v: 'simple', l: 'Simple' }, { v: 'variable', l: 'Variable' }, { v: 'woosb', l: 'Pack (woosb)' }] },
];

export const OPERATORS = {
  number: [
    { v: 'gte', l: '≥' }, { v: 'lte', l: '≤' }, { v: 'gt', l: '>' }, { v: 'lt', l: '<' },
    { v: 'eq', l: '=' }, { v: 'neq', l: '≠' }, { v: 'between', l: 'entre' },
  ],
  date: [
    { v: 'between',       l: 'entre le … et le …' },
    { v: 'over_days_ago', l: 'il y a plus de (jours)' },
    { v: 'within_days',   l: 'dans les X derniers jours' },
    { v: 'before',        l: 'avant le' },
    { v: 'after',         l: 'après le' },
    { v: 'is_set',        l: 'renseignée' },
    { v: 'not_set',       l: 'jamais' },
  ],
  text: [ { v: 'contains', l: 'contient' }, { v: 'eq', l: 'est' }, { v: 'neq', l: "n'est pas" } ],
  enum: [ { v: 'eq', l: 'est' }, { v: 'neq', l: "n'est pas" } ],
};

export const fieldByKey = (key) => FILTER_FIELDS.find((f) => f.key === key);
export const fieldType = (key) => (fieldByKey(key)?.type || 'number');

// Un opérateur date sans valeur (case vide)
export const opNeedsNoValue = (op) => op === 'is_set' || op === 'not_set';

// Crée une ligne de filtre par défaut pour un champ donné
export function defaultFilterFor(fieldKey) {
  const type = fieldType(fieldKey);
  return { field: fieldKey, op: OPERATORS[type][0].v, value: '', value2: '' };
}

// Résumé lisible d'un filtre (pour l'affichage compact des segments)
export function describeFilter(f) {
  const fld = fieldByKey(f.field);
  if (!fld) return '';
  const type = fld.type;
  const opLabel = (OPERATORS[type].find((o) => o.v === f.op) || {}).l || f.op;
  if (opNeedsNoValue(f.op)) return `${fld.label} : ${opLabel}`;
  if (f.op === 'between') return `${fld.label} ${opLabel} ${f.value} et ${f.value2}`;
  if (type === 'enum') {
    const opt = (fld.options || []).find((o) => o.v === f.value);
    return `${fld.label} ${opLabel} ${opt ? opt.l : f.value}`;
  }
  return `${fld.label} ${opLabel} ${f.value}`;
}
