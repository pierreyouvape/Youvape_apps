/**
 * Ordre d'affichage des listes de scan (packing, réception).
 *
 * Le principe est le même des deux côtés : ce qui reste à faire en haut, ce qui
 * est bouclé en bas. Sur une commande ou un bon de cinquante lignes, chercher
 * les lignes incomplètes entre les lignes vertes coûte plus de temps que le scan
 * lui-même ; ici la liste se vide par le haut.
 *
 * La subtilité qui justifie une fonction partagée est la STABILITÉ. À rang égal,
 * l'ordre d'origine doit être conservé au caractère près : sans le départage par
 * index d'origine, deux lignes de même état pourraient permuter d'un rendu à
 * l'autre et faire sauter la ligne sous le doigt de l'opérateur — au moment
 * précis où il tend la main vers un bouton.
 *
 * @template T
 * @param {T[]} lignes
 * @param {(ligne: T) => number} rangDe - rang d'affichage, croissant (0 = en haut)
 * @returns {T[]} un NOUVEAU tableau ; l'entrée n'est jamais modifiée
 */
export function trierParAvancement(lignes, rangDe) {
  return (lignes || [])
    .map((ligne, i) => ({ ligne, i }))
    .sort((a, b) => rangDe(a.ligne) - rangDe(b.ligne) || a.i - b.i)
    .map(({ ligne }) => ligne);
}

export default trierParAvancement;
