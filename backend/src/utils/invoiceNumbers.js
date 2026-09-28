/**
 * Découpage d'une suite de nombres lue sur une facture.
 *
 * Le séparateur de milliers est un ESPACE, exactement comme celui qui sépare
 * les colonnes : « 1 008.50 » et « 20 100.00 » s'écrivent pareil et ne veulent
 * pas dire la même chose. Aucune règle typographique ne tranche — seule
 * l'arithmétique le peut.
 *
 * On produit donc les DEUX lectures possibles, à charge pour l'appelant de
 * retenir celle qui vérifie `quantité × prix = montant`. C'est le même principe
 * que partout ailleurs dans ces parseurs : le document se valide lui-même.
 *
 * Le bug qui a motivé ce module : sur la facture LCA F2511349312, le pied
 * « 5 042.51 20.00 % 1 008.50 » était découpé en « 1 » et « 008.50 », lus comme
 * une ligne d'article de 1 × 8,50 € — un article fantôme de 8,50 €, et un total
 * qui ne retombait plus.
 */

/** Regroupe « 1 008.50 » en un seul nombre ; laisse « 2 12.98 » intact. */
function joinThousands(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const next = tokens[i + 1];
    // Un groupe de milliers, c'est EXACTEMENT trois chiffres, éventuellement
    // suivis d'une décimale. « 12.98 » n'en est pas un, « 008.50 » en est un.
    if (/^-?\d{1,3}$/.test(t) && next && /^\d{3}([.,]\d+)?$/.test(next)) {
      out.push(`${t}${next}`);
      i += 1;
      continue;
    }
    out.push(t);
  }
  return out;
}

const toNumber = (s) => parseFloat(String(s).replace(/[  ]/g, '').replace(',', '.'));

/**
 * Les lectures possibles d'une suite de jetons numériques, de la plus littérale
 * à la plus regroupée. Sans doublon : quand aucun regroupement n'est possible,
 * une seule lecture est renvoyée.
 */
function numberReadings(tokens) {
  const brut = tokens.map(toNumber).filter(Number.isFinite);
  const groupe = joinThousands(tokens).map(toNumber).filter(Number.isFinite);
  return groupe.length === brut.length ? [brut] : [brut, groupe];
}

module.exports = { numberReadings, joinThousands, toNumber };
