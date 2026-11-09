// Identité d'une ligne de réclamation : relie une case à cocher à la demande enregistrée.
export const claimLineId = l => `${l.kind}|${String(l.tracking || '').toUpperCase()}|${l.description || ''}`;

// Un supplément facturé 0 € n'a rien à réclamer (retour non facturé par Chronopost).
export const isClaimableSupplement = s => Number(s.amount_ht) > 0;

// Lignes du mail par type ET par prix : un même type peut avoir plusieurs prix
// (Retour expéditeur à 1 € et à 2 €), le coût unitaire affiché doit expliquer le total.
export function groupSupplementsForEmail(supplements) {
  const sorted = [...supplements].sort((a, b) =>
    String(a.description).localeCompare(String(b.description), 'fr') || (a.amount_ht || 0) - (b.amount_ht || 0));
  const groups = {};
  for (const s of sorted) {
    const key = `${s.description}|${s.amount_ht}`;
    if (!groups[key]) groups[key] = { description: s.description, count: 0, total: 0, unitCost: s.amount_ht };
    groups[key].count += 1;
    groups[key].total += s.amount_ht || 0;
  }
  return groups;
}
