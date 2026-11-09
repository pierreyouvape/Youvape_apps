/**
 * Compare une réclamation de facturation aux avoirs et rectificatives reçus.
 * Rien n'est stocké : le résultat se recalcule à chaque lecture, donc il suit
 * d'un import ou d'une suppression d'avoir.
 *
 * Statut d'une ligne :
 *   accepted     : on a obtenu au moins le montant réclamé
 *   partial      : on a obtenu une partie
 *   not_accepted : Chronopost a répondu sur cette facture après la demande, sans cette ligne
 *   pending      : aucune réponse depuis la demande
 *
 * Écart de poids : obtenu = avoir (ancien tarif) − rectificative (nouveau tarif).
 * Un écart peut dépasser la demande : le mail compte parfois en tarif de grille,
 * la facture en tarif révisé (2Shop d'octobre 2026 : 4,45 € réclamés, 4,66 € obtenus).
 */

const round2 = n => Math.round(n * 100) / 100;
const key = t => String(t || '').toUpperCase();

function matchBillingClaim({ sentOn, lines, credits, rectifs }) {
  const usable = (credits || []).filter(c => c.base_ht != null);
  const used = new Set();
  const answered = usable.some(c => !c.credit_date || !sentOn || c.credit_date >= sentOn);

  const take = test => {
    const i = usable.findIndex((c, idx) => !used.has(idx) && test(c));
    if (i < 0) return null;
    used.add(i);
    return usable[i];
  };

  const out = (lines || []).map(line => {
    const tracking = key(line.tracking);
    const claimed = line.claimed_ht == null ? null : Number(line.claimed_ht);
    let credit, rectif = null, obtained = 0;

    if (line.kind === 'weight') {
      credit = take(c => key(c.tracking) === tracking && c.has_weight);
      rectif = (rectifs || []).find(r => key(r.tracking) === tracking) || null;
      if (credit) obtained = -Number(credit.base_ht) - (rectif ? Number(rectif.amount_ht) : 0);
    } else {
      credit = take(c => key(c.tracking) === tracking && !c.has_weight && c.description === line.description);
      if (credit) obtained = -Number(credit.base_ht);
    }
    obtained = round2(obtained);

    let status;
    if (!credit) status = answered ? 'not_accepted' : 'pending';
    else if (claimed == null ? obtained > 0 : obtained >= claimed - 0.005) status = 'accepted';
    else status = obtained > 0 ? 'partial' : 'not_accepted';

    return {
      ...line,
      status,
      obtained_ht: credit ? obtained : 0,
      credit_number: credit?.credit_number || null,
      rectif_number: credit ? rectif?.invoice_number || null : null,
      rebilled_ht: credit && rectif ? Number(rectif.amount_ht) : null,
    };
  });

  // Reçu sans avoir été demandé ici : indemnisation, geste commercial…
  const extras = usable.filter((_, i) => !used.has(i));

  const count = s => out.filter(l => l.status === s).length;
  const summary = {
    claimed_ht: round2(out.reduce((s, l) => s + (Number(l.claimed_ht) || 0), 0)),
    obtained_ht: round2(out.reduce((s, l) => s + l.obtained_ht, 0)),
    accepted: count('accepted'),
    partial: count('partial'),
    not_accepted: count('not_accepted'),
    pending: count('pending'),
    total: out.length,
  };
  summary.status = !summary.total ? 'pending'
    : summary.accepted === summary.total ? 'accepted'
    : summary.pending === summary.total ? 'pending'
    : 'partial';

  return { lines: out, extras, summary };
}

module.exports = { matchBillingClaim };
