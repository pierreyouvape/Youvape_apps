/**
 * Les bons de réduction « à valoir sur la prochaine commande », retrouvés sur la
 * facture qui les consomme.
 *
 * Module pur, comme le moteur de comparaison : il reçoit les lignes lues, le
 * texte du document et les bons du fournisseur, et rend les lignes réécrites.
 *
 * POURQUOI ON RÉÉCRIT LA REMISE. Un bon déduit d'une commande n'apparaît pas
 * comme une ligne à part. GFC F2606406741 et LVP F2607279320 impriment tous deux
 * une simple « Remise : 27.90 € » / « Remise : 110.78 € » au pied, et le code du
 * bon dans « Code(s) promo : ». Laissée telle quelle, cette remise est répartie
 * sur le coût des lignes (règle 6 du moteur) : la nouvelle commande paraît moins
 * chère qu'elle ne l'est, et une vraie surfacturation de cette commande se
 * retrouve « expliquée par la remise » — donc jamais réclamée. Or ce montant
 * rembourse une AUTRE facture. On le sort donc de la remise pour en faire une
 * ligne `voucher`, que le moteur ne répartit sur rien.
 *
 * COMMENT ON LE RECONNAÎT, du plus sûr au moins sûr :
 *   1. Le CODE du bon figure dans le document (espaces ignorés : un code long
 *      peut être coupé par la mise en page). C'est la règle normale : le
 *      fournisseur communique le code dès qu'il émet le bon.
 *   2. À défaut de code saisi, un bon dont le montant retombe AU CENTIME sur la
 *      remise imprimée (ou sur une de ses lignes) — et un seul : deux bons sans
 *      code du même montant, le document ne tranche pas, nous non plus.
 *
 * Un bon dont le code est connu mais absent du document n'est JAMAIS rapproché
 * au montant : le code dit qu'il a servi ailleurs, ou pas encore.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const compact = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');

/** Les codes trop courts se retrouveraient par hasard dans n'importe quel texte. */
const MIN_CODE_LENGTH = 4;

/**
 * @param {Object}   input
 * @param {Array}    input.lines     lignes lues ({ kind, label, lineTotalHt, … })
 * @param {string}   input.text      texte brut du document
 * @param {Array}    input.vouchers  bons candidats : { id, code, amount_ht, source_number }
 * @returns {{ lines: Array, used: Array<{ id, amount, matchedBy, partial }> }}
 */
function detachVouchers({ lines, text, vouchers }) {
  const remises = (lines || []).filter((l) => l.kind === 'discount' && Number(l.lineTotalHt) < 0);
  let disponible = round2(-remises.reduce((s, l) => s + Number(l.lineTotalHt), 0));
  if (!(disponible > 0) || !(vouchers || []).length) return { lines, used: [] };

  const document = compact(text);
  const retenus = [];

  // 1. Par le code.
  for (const v of vouchers) {
    const code = compact(v.code);
    if (code.length >= MIN_CODE_LENGTH && document.includes(code)) {
      retenus.push({ voucher: v, matchedBy: 'code' });
    }
  }

  // 2. Par le montant, pour les bons dont on n'a pas (encore) le code.
  if (retenus.length === 0) {
    const montants = [disponible, ...remises.map((l) => round2(-l.lineTotalHt))];
    const sansCode = vouchers.filter((v) => !compact(v.code)
      && montants.some((m) => Math.abs(m - round2(v.amount_ht)) < 0.005));
    if (sansCode.length === 1) retenus.push({ voucher: sansCode[0], matchedBy: 'amount' });
  }

  if (retenus.length === 0) return { lines, used: [] };

  // On retire chaque bon de la remise : d'abord de la ligne qui porte son code
  // dans son libellé (détail PrestaShop), sinon des plus grosses lignes.
  const copies = lines.map((l) => ({ ...l }));
  const aRemises = copies.filter((l) => l.kind === 'discount' && l.lineTotalHt < 0);
  const used = [];
  const nouvelles = [];

  for (const { voucher: v, matchedBy } of retenus) {
    if (!(disponible > 0)) break;
    const montant = round2(Math.min(Number(v.amount_ht) || 0, disponible));
    if (!(montant > 0)) continue;

    const code = compact(v.code);
    const ordre = [...aRemises].sort((a, b) => {
      const ca = code && compact(a.label).includes(code) ? 0 : 1;
      const cb = code && compact(b.label).includes(code) ? 0 : 1;
      return ca !== cb ? ca - cb : a.lineTotalHt - b.lineTotalHt;
    });
    let reste = montant;
    for (const l of ordre) {
      if (!(reste > 0)) break;
      const pris = round2(Math.min(reste, -l.lineTotalHt));
      l.lineTotalHt = round2(l.lineTotalHt + pris);
      reste = round2(reste - pris);
    }

    disponible = round2(disponible - montant);
    used.push({
      id: v.id,
      amount: montant,
      matchedBy,
      // Le bon vaut plus que la remise imprimée : il n'a servi qu'en partie.
      partial: montant < round2(v.amount_ht),
    });
    nouvelles.push({
      ref: null,
      label: `Bon à valoir${v.code ? ` ${v.code}` : ''}`
        + `${v.source_number ? ` (facture ${v.source_number})` : ''}`,
      qty: 1,
      lineTotalHt: -montant,
      kind: 'voucher',
      voucherId: v.id,
    });
  }

  // Une remise entièrement absorbée par un bon disparaît : ce n'était pas une
  // remise. La somme des lignes, elle, ne bouge pas d'un centime.
  const restantes = copies.filter((l) => !(l.kind === 'discount' && Math.abs(l.lineTotalHt) < 0.005));
  return { lines: [...restantes, ...nouvelles], used };
}

module.exports = { detachVouchers };
