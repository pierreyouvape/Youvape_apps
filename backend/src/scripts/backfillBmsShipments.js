/**
 * Reprise de l'historique des expéditions BMS signées (table bms_shipments).
 *
 *   docker exec -w /app youvape_backend node src/scripts/backfillBmsShipments.js [--from-offset N]
 *
 * Lecture seule côté BMS, relançable sans dégât (upsert sur l'id BMS). Ensuite,
 * le cron (bmsShipmentSyncService.syncRecent) reprend là où le script s'arrête.
 */

const pool = require('../config/database');
const { syncFrom } = require('../services/bmsShipmentSyncService');

const arg = process.argv.indexOf('--from-offset');
const fromOffset = arg > -1 ? parseInt(process.argv[arg + 1], 10) || 0 : 0;

(async () => {
  const t0 = Date.now();
  const res = await syncFrom(fromOffset, {
    onPage: ({ offset, total, kept }) => {
      if (offset % 5000 === 0) console.log(`  offset ${offset} / ${total} — ${kept} expéditions signées`);
    },
  });
  console.log(`Terminé en ${Math.round((Date.now() - t0) / 1000)} s : ${res.read} lues, ${res.kept} signées gardées (total BMS ${res.total}).`);
  await pool.end();
})().catch(async (err) => {
  console.error('Échec :', err.message);
  await pool.end();
  process.exit(1);
});
