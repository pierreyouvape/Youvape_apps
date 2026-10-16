/**
 * En boutique, les RÉSISTANCES se vendent à l'unité (décision Pierre, 16/10/2026),
 * quand le site les vend en « Pack N » : sa réf compte un article = le pack. Pour
 * une résistance Nextore, le conditionnement proposé devient donc N pièces par
 * article, signalé « à vérifier ». Les cartouches restent à la boîte : seule la
 * catégorie Nextore tranche, pas le nom du site (« Cartouches … résistance intégrée »).
 */
const UNIT_CATEGORY = 'RESISTANCES';
function boutiquePack(sitePack, siteTitle, product) {
  const n = parseInt((/^pack\s+(\d+)/i.exec(siteTitle || '') || [])[1], 10);
  const pack = parseInt(sitePack, 10) || 1;
  if (n > 1 && product && String(product.category_name || '').toUpperCase() === UNIT_CATEGORY) {
    return {
      pack: pack * n,
      warning: `Le site vend « ${siteTitle} » ; la boutique compte les résistances à l'unité : `
        + `${pack * n} pièces par article de la réf. À vérifier.`,
    };
  }
  return { pack, warning: null };
}

module.exports = { boutiquePack, UNIT_CATEGORY };
