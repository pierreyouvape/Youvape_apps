/**
 * Backfill `merged_from` sur les messages rapatriés des fusions ANTÉRIEURES à
 * l'introduction du flag. Idempotent : ne touche pas aux messages déjà marqués.
 *
 * Logique : dans le tableau `messages`, dès qu'on croise une bannière système
 * « — Ticket #X fusionné ici … — », tous les messages non-système qui suivent
 * (jusqu'à la prochaine bannière) proviennent du ticket #X → merged_from = X.
 *
 * Usage : node src/scripts/backfillMergedFrom.js
 */
const pool = require('../config/database');

const BANNER_RE = /Ticket #(\d+) fusionné ici/i;

async function run() {
  const { rows } = await pool.query(
    `SELECT id, messages FROM sav_tickets WHERE messages::text LIKE '%fusionné ici%'`
  );

  let ticketsUpdated = 0;
  let messagesTagged = 0;

  for (const t of rows) {
    const messages = Array.isArray(t.messages) ? t.messages : [];
    let currentSource = null;
    let changed = false;

    for (const m of messages) {
      if (m && m.is_system) {
        const match = BANNER_RE.exec(m.body || '');
        currentSource = match ? Number(match[1]) : null;
        continue;
      }
      // Message normal sous une bannière de fusion, pas encore marqué.
      if (currentSource && m && m.merged_from == null) {
        m.merged_from = currentSource;
        messagesTagged += 1;
        changed = true;
      }
    }

    if (changed) {
      await pool.query(
        `UPDATE sav_tickets SET messages = $1::jsonb WHERE id = $2`,
        [JSON.stringify(messages), t.id]
      );
      ticketsUpdated += 1;
      console.log(`Ticket #${t.id} : messages fusionnés marqués`);
    }
  }

  console.log(`\nTermine : ${ticketsUpdated} ticket(s) mis a jour, ${messagesTagged} message(s) marque(s).`);
  await pool.end();
}

run().catch(err => { console.error('Erreur backfill:', err); process.exit(1); });
