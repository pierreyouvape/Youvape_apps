/**
 * Lignes d'une commande à porter sur une déclaration douanière (CN23).
 *
 * Commun à tous les transporteurs : la règle de ce qu'on déclare ne dépend pas
 * de qui transporte le colis. Colissimo en a besoin pour l'outre-mer et le
 * Royaume-Uni (lot 2) ; Chronopost en aura besoin hors UE.
 *
 * Décision actée : la valeur déclarée est le **prix payé après remise**, et le
 * nom commercial est conservé en désignation. Tout le reste de ce fichier sert
 * à appliquer cette phrase aux packs `woosb`, qui la rendent moins simple
 * qu'elle n'en a l'air.
 *
 * Un pack produit deux sortes de lignes : le pack lui-même, qui porte le prix,
 * et une ligne par composant à 0 €. Déclarer les composants enverrait « 10
 * boosters à 0 € » — et l'API refuse une valeur nulle. Le plugin Colissimo
 * officiel fait justement ça, en forçant chaque composant à 1 € : sur la
 * commande 1254235 (Guadeloupe), « Pack 10 Boosters » à 6,58 € serait devenu
 * 10 € déclarés. On déclare donc le pack, et on ignore ses composants.
 *
 * Mais une ligne à 0 € n'est pas toujours un composant : la commande 1240410
 * (Polynésie) porte « The Green Oil 100ml » à 0 € sans aucun pack — un article
 * offert. Il est dans le carton, il doit figurer sur la déclaration. D'où la
 * règle : une ligne à 0 € n'est ignorée que si la commande contient un pack.
 *
 * Angle mort assumé : un article offert DANS une commande qui contient aussi un
 * pack est pris pour un composant et omis. Sur 12 mois, 8 commandes CN23 sur 61
 * contenaient un pack. La valeur déclarée reste juste — seul un article gratuit
 * manquerait à la liste. Le distinguer exigerait la composition des packs, que
 * la synchronisation ne remonte pas.
 */

/**
 * Charge les lignes et le port d'une commande.
 *
 * Mêmes jointures produit que `orderWeightService` : la déclinaison si elle
 * existe, sinon le produit, et le poids du parent en repli.
 *
 * @param {import('pg').Pool} pool
 * @param {number|string} wpOrderId
 * @returns {Promise<?{lines: object[], shippingTotal: number}>} null si la commande est introuvable
 */
async function loadOrderCustoms(pool, wpOrderId) {
  const { rows: [order] } = await pool.query(
    'SELECT order_shipping FROM orders WHERE wp_order_id = $1', [wpOrderId]
  );
  if (!order) return null;

  const { rows: lines } = await pool.query(`
    SELECT oi.order_item_name AS name,
           oi.qty,
           oi.line_total,
           p.product_type,
           p.sku,
           COALESCE(p.weight, parent.weight) AS weight_kg
    FROM order_items oi
    LEFT JOIN products p
      ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
    LEFT JOIN products parent
      ON parent.wp_product_id = p.wp_parent_id
    WHERE oi.wp_order_id = $1
      AND oi.order_item_type = 'line_item'
    ORDER BY oi.order_item_id
  `, [wpOrderId]);

  return { lines, shippingTotal: Number(order.order_shipping) || 0 };
}

/**
 * Applique la règle de déclaration. Fonction pure : le banc la vérifie sur les
 * commandes réelles 1254235 et 1240410.
 *
 * @param {object[]} lines - lignes telles que rendues par loadOrderCustoms
 * @param {{minUnitValue?: number}} [options] - valeur plancher d'un article
 *        offert, l'API refusant 0
 * @returns {{name: string, sku: ?string, quantity: number, unitValue: number, unitWeightKg: number}[]}
 */
function customsArticles(lines, { minUnitValue = 1 } = {}) {
  const contientUnPack = lines.some(l => l.product_type === 'woosb');
  const articles = [];

  for (const l of lines) {
    const quantity = Number(l.qty) || 0;
    if (quantity <= 0) continue;

    const total = Number(l.line_total) || 0;
    const gratuit = Math.abs(total) < 0.005;

    // Composant de pack : sa valeur est déjà portée par la ligne du pack.
    if (gratuit && contientUnPack) continue;

    articles.push({
      name: l.name || '',
      sku: l.sku || null,
      quantity,
      // Calcul en centimes : en flottant, 31,69 / 2 donne 15,8449… et s'arrondit à
      // 15,84 au lieu de 15,85 (commande 1240410).
      unitValue: gratuit ? minUnitValue : Math.round(Math.round(total * 100) / quantity) / 100,
      unitWeightKg: Number(l.weight_kg) || 0
    });
  }

  return articles;
}

module.exports = { loadOrderCustoms, customsArticles };
