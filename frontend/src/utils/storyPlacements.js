// Résumé des emplacements d'une story (app /stories) : fiches produit et pages, tous widgets confondus.

/** Emplacements uniques d'une story : fiches produit et pages, tous widgets confondus. */
export const summarizePlacements = (placements = []) => {
  const products = new Map();
  const pages = new Set();
  const widgets = new Set();
  for (const p of placements) {
    widgets.add(p.widget_id);
    if (p.target_type === 'product') products.set(p.target_ref, p.product_title || `Produit #${p.target_ref}`);
    else if (p.target_type === 'page') pages.add(p.target_ref);
  }
  return { products, pages, widgets: widgets.size };
};

/** Résumé court pour la liste : « 2 fiches · 1 page ». */
export const placementsLabel = (placements) => {
  const { products, pages, widgets } = summarizePlacements(placements);
  if (!widgets) return 'Dans aucun widget';
  const parts = [];
  if (products.size) parts.push(`${products.size} fiche${products.size > 1 ? 's' : ''}`);
  if (pages.size) parts.push(`${pages.size} page${pages.size > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : 'Widget sans emplacement';
};
