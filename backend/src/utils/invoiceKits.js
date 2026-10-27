/**
 * Une référence fournisseur qui est un PACK de plusieurs articles.
 *
 * JoshNoa V3/2026/41269 : « OCT - Pack Offre Gourmand Biggy Bear 200ml »
 * (josh00045997), 15 × 14,90 €, contient 1 Crunchy Sesame Biscuit, 1 Caramel
 * Frosted Flakes, 1 Creamy Vanilla Caramel et 1 Smooth Vanilla Custard. La
 * commande, elle, porte les quatre parfums séparément à 4,90 € — BMS ne connaît
 * pas l'offre. Sans découpage, le contrôle annonçait une ligne « facturée non
 * commandée » de 223,50 € face à trois « commandées non facturées » et un
 * manquant de 15 Smooth Vanilla : cinq anomalies pour une facture conforme,
 * payée 70,50 € de MOINS que la commande.
 *
 * La ligne du pack est donc remplacée, AVANT le rapprochement, par une ligne par
 * composant. Le reste du moteur ne sait rien des packs : il voit des parfums
 * facturés, qu'il compare à des parfums commandés.
 *
 * LE MONTANT SE RÉPARTIT AU PRORATA DU PRIX DE CHAQUE COMPOSANT — celui de la
 * commande, à défaut celui de la réf. — et AU CENTIME : le reliquat d'arrondi va
 * à la plus grosse part, comme pour les remises de pied. La somme des lignes
 * reste celle de la facture, et le total imprimé retombe.
 *
 * Module pur : aucune base. L'appelant fournit les packs et les prix.
 */

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {Array}    lines   lignes lues sur la facture
 * @param {Map}      kits    réf. du pack normalisée → { ref, label, components: [{ ref, label, qty }] }
 * @param {Function} priceOf (réf. composant) → prix unitaire de référence, ou null
 * @returns {Array} les lignes, packs remplacés par leurs composants. Chaque ligne
 *                  issue d'un pack porte `kit` : { ref, label, qty, total }.
 */
function explodeKits(lines, kits, priceOf = () => null) {
  if (!kits || kits.size === 0) return lines;
  const out = [];
  for (const line of lines || []) {
    const kit = (line.kind || 'product') === 'product' ? kits.get(norm(line.ref)) : null;
    if (!kit || !kit.components || kit.components.length === 0) {
      out.push(line);
      continue;
    }

    const qtyPacks = Number(line.qty) || 0;
    const total = round2(line.lineTotalHt);
    // Le poids de chaque composant : son prix × sa quantité dans le pack. Sans
    // aucun prix connu, parts égales à la quantité — un pack de parfums au même
    // tarif, le cas courant.
    const prix = kit.components.map((c) => {
      const p = Number(priceOf(c.ref));
      return Number.isFinite(p) && p > 0 ? p : null;
    });
    const tousConnus = prix.every((p) => p !== null);
    const poids = kit.components.map((c, i) => (Number(c.qty) || 1) * (tousConnus ? prix[i] : 1));
    const somme = poids.reduce((s, p) => s + p, 0);

    // Au centime, le reliquat à la plus grosse part.
    const parts = poids.map((p) => round2(total * (p / somme)));
    const reliquat = round2(total - parts.reduce((s, p) => s + p, 0));
    if (reliquat !== 0) {
      let iMax = 0;
      poids.forEach((p, i) => { if (p > poids[iMax]) iMax = i; });
      parts[iMax] = round2(parts[iMax] + reliquat);
    }

    const origine = { ref: line.ref, label: line.label || kit.label || null, qty: qtyPacks, total };
    kit.components.forEach((c, i) => {
      out.push({
        ...line,
        ref: c.ref,
        label: c.label || null,
        qty: qtyPacks * (Number(c.qty) || 1),
        lineTotalHt: parts[i],
        kit: origine,
      });
    });
  }
  return out;
}

/** « 15 via le pack josh00045997 » : ce qu'une ligne doit au découpage, en clair. */
function kitNoteOf(kits) {
  if (!kits || kits.length === 0) return null;
  return kits
    .map((k) => `${k.pieces} via le pack ${k.ref}${k.label ? ` (${k.label})` : ''}, ${k.qty} × ${(k.total / (k.qty || 1)).toFixed(2).replace('.', ',')} €`)
    .join(' ; ');
}

module.exports = { explodeKits, kitNoteOf };
