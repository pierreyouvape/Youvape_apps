// Identité d'une ligne de réclamation : relie une case à cocher à la demande enregistrée.
export const claimLineId = l => `${l.kind}|${String(l.tracking || '').toUpperCase()}|${l.description || ''}`;
