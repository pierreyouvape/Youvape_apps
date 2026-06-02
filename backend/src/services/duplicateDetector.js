const pool = require('../config/database');

// Cherche des tickets en doublon potentiel pour un ticket donné.
// Critères : même customer_email ET (si order_id renseigné) même order_id,
// statut non terminé/refusé, créés dans les 30 derniers jours, exclut le ticket lui-même.
async function findDuplicates(ticket) {
  if (!ticket || !ticket.customer_email) return [];

  const params = [ticket.customer_email.toLowerCase(), ticket.id];
  let where = `LOWER(customer_email) = $1 AND id != $2`;

  // Si order_id renseigné -> critère strict ET, sinon -> juste l'email
  if (ticket.order_id) {
    where += ` AND order_id = $3`;
    params.push(String(ticket.order_id));
  }

  where += `
    AND sav_status NOT IN ('terminé', 'refusé')
    AND created_at >= NOW() - INTERVAL '30 days'
  `;

  const res = await pool.query(
    `SELECT id, subject, sav_status, created_at, customer_name
     FROM sav_tickets
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT 20`,
    params
  );
  return res.rows;
}

// Met à jour le ticket avec la liste des doublons potentiels (idempotent).
// Si le ticket source est lui-même un doublon d'un autre, on tag aussi les
// autres tickets (rétro-tagging) pour qu'ils voient le nouveau venant.
async function tagDuplicates(ticket) {
  const dups = await findDuplicates(ticket);
  const candidatesJson = JSON.stringify(dups.map(d => ({
    id: d.id,
    subject: d.subject,
    sav_status: d.sav_status,
    created_at: d.created_at,
    customer_name: d.customer_name,
  })));

  // Tag le ticket source
  await pool.query(
    `UPDATE sav_tickets
     SET has_duplicate_warning = $1,
         duplicate_candidates = $2::jsonb
     WHERE id = $3`,
    [dups.length > 0, candidatesJson, ticket.id]
  );

  // Rétro-tagger les autres tickets pour qu'ils voient le nouveau dans leur liste
  // (sinon, seul le dernier créé est marqué, les anciens ne savent pas qu'un nouveau est arrivé)
  for (const dup of dups) {
    try {
      const subDups = await findDuplicates({
        id: dup.id,
        customer_email: ticket.customer_email,
        order_id: ticket.order_id,
      });
      const subJson = JSON.stringify(subDups.map(d => ({
        id: d.id,
        subject: d.subject,
        sav_status: d.sav_status,
        created_at: d.created_at,
        customer_name: d.customer_name,
      })));
      await pool.query(
        `UPDATE sav_tickets
         SET has_duplicate_warning = $1,
             duplicate_candidates = $2::jsonb
         WHERE id = $3`,
        [subDups.length > 0, subJson, dup.id]
      );
    } catch (e) {
      console.warn(`[DuplicateDetector] rétro-tag ticket #${dup.id} échoué:`, e.message);
    }
  }

  return dups;
}

module.exports = { findDuplicates, tagDuplicates };
