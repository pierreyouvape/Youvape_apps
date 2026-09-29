/**
 * Colis emballés dans BMS — copie des expéditions BMS signées d'un préparateur.
 *
 * Pendant la transition, une partie des colis part encore de BMS : sans eux,
 * les Stats et l'Historique d'expédition ne montreraient qu'une fraction de
 * l'activité (le 28/09/2026 : 206 colis BMS pour 39 étiquetés par l'app).
 *
 * Deux faits mesurés en prod le 29/09/2026 commandent ce fichier :
 *   - `GET /v2/sales/shipments` IGNORE `filters` et `sorts` : la liste vient
 *     toujours par id croissant, seule la pagination marche. Les nouvelles
 *     expéditions sont donc à la fin, et on relit la fin.
 *   - BMS remplit `packer` quand on emballe chez lui, et le laisse vide pour
 *     les expéditions que l'app y confirme par API. On ne garde que les
 *     expéditions signées : un colis étiqueté par l'app n'est jamais compté deux fois.
 *
 * Lecture seule : rien n'est écrit dans BMS.
 */

const pool = require('../config/database');
const bmsApiModel = require('../models/bmsApiModel');

const PAGE = 100;
const OFFSET_KEY = 'bms_shipments_offset';
// Relue à chaque passage : une expédition supprimée dans BMS décale les
// suivantes d'un cran, et on ne veut pas en sauter.
const OVERLAP = 200;

/**
 * Mode de livraison BMS → transporteur de l'app. Relevé sur 6 000 expéditions
 * (29/09/2026). 2Shop avant Chronopost : même préfixe « chrono ».
 *
 * @param {?string} methodCode
 * @returns {{carrierCode: ?string, accountCode: ?string}}
 */
const bmsCarrier = (methodCode) => {
  const m = String(methodCode || '').toLowerCase();
  if (m.startsWith('mondialrelay')) return { carrierCode: 'mondial_relay', accountCode: 'Prod' };
  if (m.startsWith('colissimo')) return { carrierCode: 'colissimo', accountCode: 'production' };
  if (m.includes('2shop')) return { carrierCode: 'chronopost', accountCode: '2shop' };
  if (m.startsWith('chrono')) return { carrierCode: 'chronopost', accountCode: 'principal' };
  if (m.startsWith('laposte')) return { carrierCode: 'laposte', accountCode: 'lettre_suivie' };
  if (m.startsWith('erpcloudstorepickup')) return { carrierCode: 'interne', accountCode: 'retrait_magasin' };
  return { carrierCode: null, accountCode: null };
};

/** Expédition BMS → ligne, ou null si personne ne l'a signée. */
const toRow = (s) => {
  const packer = String(s.packer || '').trim();
  if (!packer || !s.id || !s.order_reference || !s.created_at) return null;
  const { carrierCode, accountCode } = bmsCarrier(s.method_code);
  return {
    bmsId: s.id,
    orderNumber: String(s.order_reference).slice(0, 20),
    packer: packer.slice(0, 120),
    createdAt: s.created_at,
    methodCode: s.method_code || null,
    methodDescription: s.method_description || null,
    carrierCode,
    accountCode,
    tracking: s.trackings?.[0]?.number || null,
    itemsQty: (s.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0),
  };
};

const upsert = async (rows) => {
  if (rows.length === 0) return 0;
  const col = (k) => rows.map(r => r[k]);
  // L'heure BMS porte son fuseau (« …+02:00 ») : Postgres la ramène en UTC.
  await pool.query(
    `INSERT INTO bms_shipments (bms_id, order_number, packer_name, created_at, method_code,
                                method_description, carrier_code, account_code, tracking_number, items_qty, synced_at)
     SELECT u.bms_id, u.order_number, u.packer, (u.created_at::timestamptz AT TIME ZONE 'UTC'),
            u.method_code, u.method_description, u.carrier_code, u.account_code, u.tracking, u.items_qty, NOW()
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::text[], $8::text[], $9::text[], $10::int[])
         AS u(bms_id, order_number, packer, created_at, method_code, method_description,
              carrier_code, account_code, tracking, items_qty)
     ON CONFLICT (bms_id) DO UPDATE SET
       packer_name = EXCLUDED.packer_name, tracking_number = EXCLUDED.tracking_number,
       method_code = EXCLUDED.method_code, method_description = EXCLUDED.method_description,
       carrier_code = EXCLUDED.carrier_code, account_code = EXCLUDED.account_code,
       items_qty = EXCLUDED.items_qty, synced_at = NOW()`,
    [col('bmsId'), col('orderNumber'), col('packer'), col('createdAt'), col('methodCode'),
      col('methodDescription'), col('carrierCode'), col('accountCode'), col('tracking'), col('itemsQty')]
  );
  return rows.length;
};

/**
 * Relit les expéditions de `fromOffset` à la fin de la liste.
 * @returns {Promise<{total: number, read: number, kept: number}>}
 */
const syncFrom = async (fromOffset, { onPage } = {}) => {
  let total = null;
  let read = 0;
  let kept = 0;
  for (let offset = Math.max(0, fromOffset); ; offset += PAGE) {
    const res = await bmsApiModel.apiCall(`/v2/sales/shipments?limit=${PAGE}&offset=${offset}`);
    const data = res?.data || [];
    total = Number(res?.meta?.total) || total;
    read += data.length;
    kept += await upsert(data.map(toRow).filter(Boolean));
    if (onPage) onPage({ offset, total, read, kept });
    if (data.length < PAGE) break;
  }
  if (total != null) {
    await pool.query(
      `INSERT INTO app_config (config_key, config_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [OFFSET_KEY, String(total)]
    );
  }
  return { total, read, kept };
};

let running = null;

/**
 * Passage du cron : reprend là où le précédent s'est arrêté (moins une marge),
 * quel que soit le temps écoulé — une nuit ou un week-end ne perdent rien.
 * Deux appels simultanés n'en font qu'un.
 */
const syncRecent = () => {
  if (running) return running;
  running = (async () => {
    const { rows } = await pool.query('SELECT config_value FROM app_config WHERE config_key = $1', [OFFSET_KEY]);
    let last = rows[0] ? parseInt(rows[0].config_value, 10) : NaN;
    if (!Number.isFinite(last)) {
      // Jamais lancé : la reprise de l'historique est le travail du script.
      const head = await bmsApiModel.apiCall('/v2/sales/shipments?limit=1');
      last = Number(head?.meta?.total) || 0;
    }
    return syncFrom(last - OVERLAP);
  })().finally(() => { running = null; });
  return running;
};

module.exports = { bmsCarrier, toRow, syncFrom, syncRecent };
