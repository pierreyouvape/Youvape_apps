/**
 * L'assiette d'une remise de pied, quand elle ne vise pas toute la facture.
 *
 * Une remise de pied n'est pas forcément globale. Chez LVP, RSPV20 ne porte que
 * sur les Vaporesso — Dojo et Armour G/GS exclus. L'étaler au prorata sur toutes
 * les lignes fabrique de faux coûts de revient DANS LES DEUX SENS : sur la
 * facture F2609287455 (écart réel −0,71 €), le tableau des tarifs annonçait
 * +0,64 € sur des résistances GTX et −0,24 € sur une fiole graduée, alors que
 * les Vaporesso remisés à 20 % retombent exactement sur le prix commandé.
 *
 * CES RÈGLES NE SONT PAS CRUES SUR PAROLE. Celui qui les applique vérifie que la
 * somme des remises qu'elles produisent retombe sur la remise imprimée ; sinon
 * il repasse à une remise générale. Une promotion change, un fournisseur en
 * ajoute une autre — mieux vaut une répartition approximative qu'une règle
 * périmée appliquée avec aplomb.
 */

const SCOPES = {
  // Vérifié sur F2609287455 du 29/09/2026 : 445,46 € de Vaporesso remisables,
  // soit 89,09 € à 20 %, contre 89,11 € imprimés — deux centimes d'arrondi.
  'LVP Distribution': [
    {
      name: 'RSPV20',
      rate: 0.20,
      note: '−20 % sur les Vaporesso, sauf Dojo, Armour G et Armour GS',
      // « Armour S » reste remisé : le motif exige un G après « Armour ».
      covers: (label) => /vaporesso/i.test(label)
        && !/\bdojo\b/i.test(label)
        && !/armour\s*gs?\b/i.test(label),
    },
  ],
};

/**
 * @param {string} supplierCode  code fournisseur (suppliers.code)
 * @returns {Array} règles connues, éventuellement vide
 */
function scopesFor(supplierCode) {
  return SCOPES[supplierCode] || [];
}

module.exports = { scopesFor, SCOPES };
