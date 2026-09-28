/**
 * Reconstitution d'une référence fournisseur tronquée.
 *
 * Les PDF aplatissent les colonnes « Référence » et « Désignation » : une
 * référence contenant un espace se retrouve collée au libellé, et aucun parseur
 * ne peut deviner de façon fiable où elle s'arrête. On lève l'ambiguïté en
 * cherchant, parmi les références CONNUES de ce fournisseur, la plus longue qui
 * préfixe le texte « réf + désignation », à la frontière d'un mot.
 *
 * Pourquoi ça n'est pas un détail : sur la facture LVP F2609287196 du
 * 28/09/2026, « VP RES GTI 0.15 » et « VP Box Arm S Cyber Gold » se réduisaient
 * tous deux à « VP ». Non seulement les deux lignes ne retrouvaient plus leur
 * commande, mais elles FUSIONNAIENT en une seule de 11 pièces à 92,70 € — deux
 * produits différents additionnés, et deux fausses anomalies en face.
 *
 * Utilisé par l'import fournisseur ET par le contrôle de facture : c'est le même
 * document, la même ambiguïté. En avoir deux copies, c'est se garantir qu'une
 * seule des deux sera corrigée le jour où ça casse.
 */

/** Normalise pour comparaison : minuscules, espaces collapsés, trim. */
function normalizeSku(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Modifie `items` EN PLACE. Ne change une ligne que si une référence connue plus
 * complète est trouvée : aucune régression pour les références déjà correctes ou
 * absentes du catalogue.
 *
 * @param {Array}  items      lignes à corriger
 * @param {Array}  knownRefs  références connues du fournisseur
 * @param {Object} [keys]     noms des champs porteurs de la réf et du libellé
 */
function resolveCompleteRefs(items, knownRefs, keys = {}) {
  const refKey = keys.refKey || 'ref';
  const labelKey = keys.labelKey || 'label';

  if (!items || items.length === 0 || !knownRefs || knownRefs.length === 0) return items;

  // Plus longue référence d'abord → on retient la plus complète.
  const entries = knownRefs
    .map((original) => ({ original, normalized: normalizeSku(original) }))
    .filter((e) => e.normalized.length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length);

  for (const item of items) {
    if (!item || !item[refKey]) continue;

    const combined = `${item[refKey]} ${item[labelKey] || ''}`.trim();
    const nc = normalizeSku(combined);

    // 1. Correspondance mot à mot : la référence contient des espaces
    //    (« VP RES GTI 0.15 » chez LVP), le parseur n'en a gardé que le début.
    const match = entries.find((e) => nc === e.normalized || nc.startsWith(e.normalized + ' '));
    if (match && match.normalized !== normalizeSku(item[refKey])) {
      const pattern = match.original.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
      item[labelKey] = combined.replace(new RegExp('^' + pattern + '\\s*', 'i'), '').trim();
      item[refKey] = match.original;
      continue;
    }

    // 2. Correspondance SANS LES ESPACES. Un PDF peut couper une référence
    //    n'importe où, pas seulement sur un tiret : Curieux rend
    //    « 190-FRAI-50-0M » puis, à la ligne, « G Fraise Grenade - 50ml ». Le
    //    « G » de la référence part dans la désignation, la ligne ne retrouve
    //    plus sa commande, et l'écran annonce à la fois un article commandé non
    //    facturé et le même facturé non commandé.
    //
    //    On compare donc les textes débarrassés de leurs espaces, puis on
    //    recoupe le texte d'origine au bon endroit. Réservé aux références d'au
    //    moins quatre caractères : plus court, le risque d'attraper n'importe
    //    quel début de désignation l'emporte.
    const compactCombined = nc.replace(/\s+/g, '');
    const loose = entries.find((e) => {
      const c = e.normalized.replace(/\s+/g, '');
      return c.length >= 4 && compactCombined.startsWith(c);
    });
    if (!loose) continue;

    const wanted = loose.normalized.replace(/\s+/g, '').length;
    let consumed = 0;
    let cut = 0;
    for (const ch of combined) {
      cut += 1;
      if (!/\s/.test(ch)) consumed += 1;
      if (consumed === wanted) break;
    }
    item[labelKey] = combined.slice(cut).trim();
    item[refKey] = loose.original;
  }

  return items;
}

module.exports = { resolveCompleteRefs, normalizeSku };
