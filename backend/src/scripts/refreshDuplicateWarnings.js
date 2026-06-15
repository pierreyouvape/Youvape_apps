/**
 * Recalcule l'alerte doublon (has_duplicate_warning + duplicate_candidates)
 * pour tous les tickets actuellement marqués. Avec la nouvelle règle (exclusion
 * des tickets fusionnés via merged_into_id), les alertes devenues obsolètes
 * après une fusion sont nettoyées.
 *
 * Idempotent. Usage : node src/scripts/refreshDuplicateWarnings.js
 */
const pool = require('../config/database');
const { tagDuplicates } = require('../services/duplicateDetector');

async function run() {
  const { rows } = await pool.query(
    `SELECT * FROM sav_tickets WHERE has_duplicate_warning = true`
  );

  let cleared = 0;
  let kept = 0;

  for (const ticket of rows) {
    const dups = await tagDuplicates(ticket);
    if (dups.length === 0) {
      cleared += 1;
      console.log(`Ticket #${ticket.id} : alerte doublon retiree`);
    } else {
      kept += 1;
    }
  }

  console.log(`\nTermine : ${rows.length} ticket(s) recalcule(s), ${cleared} alerte(s) retiree(s), ${kept} conservee(s).`);
  await pool.end();
}

run().catch(err => { console.error('Erreur refresh doublons:', err); process.exit(1); });
