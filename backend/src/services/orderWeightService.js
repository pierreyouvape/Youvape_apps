/**
 * Poids expédié d'une commande — source unique.
 *
 * Deux usages en dépendent et doivent impérativement donner le même chiffre :
 *   - le calcul prévisionnel des frais de port (shippingController), qui cherche
 *     la tranche tarifaire du transporteur ;
 *   - la génération d'étiquettes, qui déclare le poids au transporteur.
 *
 * Si les deux divergeaient, le contrôle de factures signalerait des écarts qui
 * n'existent pas — ou masquerait ceux qui existent. D'où l'expression SQL
 * partagée plutôt que deux copies qui dérivent.
 *
 * Unité : le gramme. products.weight est en kilogrammes côté WooCommerce, d'où
 * le × 1000 ; la tare (shipping_settings.packaging_weight) est déjà en grammes.
 */

/**
 * Expression SQL du poids d'une commande, en grammes, tare comprise.
 *
 * À utiliser dans une requête qui agrège order_items par commande, avec les
 * jointures `oi`, `p` (produit) et `parent` (produit parent d'une déclinaison).
 * Le paramètre positionnel de la tare est passé en argument car il dépend du
 * numéro de placeholder disponible dans la requête appelante.
 *
 * Le cas des packs (`woosb`) est la seule subtilité. WooCommerce écrit deux
 * sortes de lignes pour un pack : la ligne du pack lui-même, et une ligne par
 * composant à 0 €. Additionner les deux compterait le contenu deux fois. On
 * somme donc les lignes non-woosb, et on n'ajoute le poids de la ligne pack que
 * si aucun composant à 0 € pesant n'est déjà présent — auquel cas le contenu est
 * déjà compté par les lignes de composants.
 *
 * L'unité est explicite car les deux familles d'appelants ne parlent pas la même :
 * le calcul de frais de port et l'étiquetage raisonnent en grammes, les
 * contrôleurs de factures comparent des kilogrammes aux poids facturés par le
 * transporteur. Même logique, même résultat, deux échelles — d'où le paramètre
 * plutôt que deux expressions qui finiraient par diverger.
 *
 * @param {string} tareParam - placeholder de la tare, dans l'unité demandée (ex. '$3')
 * @param {'g'|'kg'} unit - unité du résultat, grammes par défaut
 * @returns {string} expression SQL à insérer dans un SELECT agrégé
 */
function orderWeightSql(tareParam, unit = 'g') {
  if (unit !== 'g' && unit !== 'kg') {
    throw new Error(`orderWeightSql : unité inconnue « ${unit} » (attendu 'g' ou 'kg')`);
  }

  // products.weight est en kilogrammes : le passage en grammes est un × 1000.
  const scale = unit === 'g' ? ' * 1000' : '';

  return `
    COALESCE((
      SUM(oi.qty * COALESCE(p.weight, parent.weight, 0))
        FILTER (WHERE p.product_type IS DISTINCT FROM 'woosb')
      + CASE
          WHEN bool_or(
                 oi.line_total = 0
                 AND COALESCE(p.weight, parent.weight, 0) > 0
                 AND p.product_type IS DISTINCT FROM 'woosb'
               )
          THEN 0
          ELSE COALESCE(
                 SUM(oi.qty * COALESCE(p.weight, parent.weight, 0))
                   FILTER (WHERE p.product_type = 'woosb'),
                 0
               )
        END
    )${scale}, 0) + ${tareParam}
  `;
}

/**
 * Tare d'emballage en grammes, telle que saisie dans les réglages Livraison.
 *
 * Paramètre et non valeur codée en dur : l'emballage change sans qu'on doive
 * redéployer. Une tare unique et moyenne suffit — c'est la décision prise, les
 * différences entre formats d'emballage restant sous le gramme significatif.
 *
 * Le repli est laissé au choix de l'appelant : les contrôleurs de factures
 * retombaient historiquement sur 11 g, alors qu'un calcul de frais de port
 * préfère 0 à une valeur inventée. Un poids sans tare reste exploitable, là où
 * une erreur bloquerait l'expédition.
 *
 * @param {import('pg').Pool} pool
 * @param {number} fallbackGrams - valeur si le réglage n'existe pas
 * @returns {Promise<number>} tare en grammes
 */
async function getPackagingWeight(pool, fallbackGrams = 0) {
  const result = await pool.query(
    "SELECT config_value FROM shipping_settings WHERE config_key = 'packaging_weight'"
  );

  const value = parseFloat(result.rows[0]?.config_value);
  return Number.isFinite(value) ? value : fallbackGrams;
}

/**
 * Poids expédié d'une commande, en grammes, tare comprise.
 *
 * @param {import('pg').Pool} pool
 * @param {number|string} wpOrderId
 * @returns {Promise<number|null>} grammes, ou null si la commande est introuvable
 */
async function computeOrderWeight(pool, wpOrderId) {
  const tare = await getPackagingWeight(pool);

  const result = await pool.query(`
    SELECT ${orderWeightSql('$2')} AS total_weight
    FROM orders o
    LEFT JOIN order_items oi
      ON oi.wp_order_id = o.wp_order_id
     AND oi.order_item_type = 'line_item'
    LEFT JOIN products p
      ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id::int, 0), oi.product_id::int)
    LEFT JOIN products parent
      ON parent.wp_product_id = p.wp_parent_id
    WHERE o.wp_order_id = $1
    GROUP BY o.wp_order_id
  `, [wpOrderId, tare]);

  if (result.rows.length === 0) {
    return null;
  }

  return Math.round(parseFloat(result.rows[0].total_weight));
}

module.exports = {
  orderWeightSql,
  getPackagingWeight,
  computeOrderWeight,
};
