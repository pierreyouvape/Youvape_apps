/**
 * Frais Mollie des commandes, tels que /financier les additionne
 * (orders.payment_cost_calculated).
 *
 * - Mois dont la facture est stockée : la facture est répartie au centime sur
 *   les commandes (mollie_order_costs). C'est ce coût qui fait foi.
 * - Commandes plus récentes que la dernière facture : tarif recalé sur cette
 *   facture, par moyen et zone (mollie_estimated_rates), au tarif du jour.
 *
 * La synchro WooCommerce recalcule les frais à chaque mise à jour d'une commande
 * (paymentController.applyPaymentCostToOrder) : elle lit ces deux tables en
 * priorité, sinon une répartition exacte serait écrasée au premier changement
 * de statut. Hors Mollie (PayPal, Systempay), rien ne change.
 */
const pool = require('../config/database');
const { loadOrderRows, allocateInvoiceToOrders, rateGroup, METHOD_OF_TITLE } = require('./mollieAuditService');

let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mollie_invoices (
          id             SERIAL PRIMARY KEY,
          invoice_number VARCHAR(60) NOT NULL UNIQUE,
          invoice_date   DATE,
          period_start   DATE,
          period_end     DATE,
          total_ht       NUMERIC(12,2),
          parsed         JSONB NOT NULL,
          pdf_data       BYTEA,
          file_name      VARCHAR(255),
          uploaded_by    VARCHAR(255),
          created_at     TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mollie_order_costs (
          wp_order_id    BIGINT PRIMARY KEY,
          cost           NUMERIC(10,2) NOT NULL,
          invoice_number VARCHAR(60) NOT NULL,
          applied_at     TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mollie_estimated_rates (
          rate_group     VARCHAR(40) PRIMARY KEY,
          fixed          NUMERIC(10,4) NOT NULL,
          pct            NUMERIC(10,4) NOT NULL,
          orders         INT,
          source_invoice VARCHAR(60),
          computed_at    TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
    })().catch((e) => { tablesReady = null; throw e; });
  }
  return tablesReady;
}

let ratesCache = null;
let ratesCacheAt = 0;
async function loadRates() {
  if (ratesCache && Date.now() - ratesCacheAt < 5 * 60 * 1000) return ratesCache;
  await ensureTables();
  const { rows } = await pool.query('SELECT rate_group, fixed::float, pct::float FROM mollie_estimated_rates');
  ratesCache = Object.fromEntries(rows.map((r) => [r.rate_group, r]));
  ratesCacheAt = Date.now();
  return ratesCache;
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Frais Mollie d'une commande, ou null si elle n'est pas Mollie / sans donnée
 * (l'appelant garde alors son tarif par libellé).
 */
async function mollieCostFor(wpOrderId, title, total) {
  const method = METHOD_OF_TITLE[(title || '').trim()];
  if (!method) return null;
  await ensureTables();
  const { rows: [o] } = await pool.query(`
    SELECT COALESCE(NULLIF(o.billing_country, ''), NULLIF(o.shipping_country, ''), '??') AS country, c.cost::float AS cost
    FROM orders o LEFT JOIN mollie_order_costs c ON c.wp_order_id = o.wp_order_id::bigint
    WHERE o.wp_order_id = $1`, [wpOrderId]);
  if (o?.cost != null) return o.cost;
  const rate = (await loadRates())[rateGroup(method, o?.country || '??')];
  if (!rate) return null;
  return r2(rate.fixed + rate.pct / 100 * (parseFloat(total) || 0));
}

const isoDay = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));

/**
 * Recalcule les frais Mollie des commandes. `apply = false` : simulation.
 * Renvoie le détail par facture (avant / après) et le tarif recalé.
 */
async function applyMollieCosts({ apply = false } = {}) {
  await ensureTables();
  const { rows: invoices } = await pool.query(`
    SELECT invoice_number, period_start, period_end, total_ht::float AS total, parsed
    FROM mollie_invoices WHERE period_start IS NOT NULL ORDER BY period_start`);
  if (!invoices.length) throw new Error('Aucune facture Mollie enregistrée');

  const today = isoDay(new Date());
  const months = [];
  const exactCosts = [];
  for (const inv of invoices) {
    const from = isoDay(inv.period_start);
    const to = isoDay(inv.period_end);
    const rows = await loadOrderRows(from, to);
    const res = allocateInvoiceToOrders(inv.parsed, rows, today);
    for (const [id, cost] of Object.entries(res.costs)) exactCosts.push({ id, cost, invoice: inv.invoice_number });
    months.push({
      invoiceNumber: inv.invoice_number, periodStart: from, periodEnd: to, kind: 'facture',
      orders: rows.length, invoiceTotal: inv.total,
      before: r2(rows.reduce((s, r) => s + (r.current || 0), 0)),
      after: res.allocated, unallocated: res.unallocated,
      rates: res.rates,
    });
  }

  // Commandes plus récentes que la dernière facture : tarif recalé.
  const last = months[months.length - 1];
  const rates = last.rates;
  const next = new Date(`${last.periodEnd}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const pending = await loadOrderRows(isoDay(next), null);
  const estimated = [];
  for (const r of pending) {
    const rate = rates[rateGroup(r.method, r.country)];
    if (rate) estimated.push({ id: r.id, cost: r2(rate.fixed + rate.pct / 100 * r.volume), before: r.current || 0 });
  }
  months.push({
    kind: 'estimation', periodStart: isoDay(next), periodEnd: today, orders: pending.length,
    before: r2(estimated.reduce((s, e) => s + e.before, 0)), after: r2(estimated.reduce((s, e) => s + e.cost, 0)),
  });

  if (apply) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (exactCosts.length) {
        await client.query(`
          INSERT INTO mollie_order_costs (wp_order_id, cost, invoice_number, applied_at)
          SELECT * , NOW() FROM unnest($1::bigint[], $2::numeric[], $3::text[])
          ON CONFLICT (wp_order_id) DO UPDATE SET cost = EXCLUDED.cost, invoice_number = EXCLUDED.invoice_number, applied_at = NOW()`,
        [exactCosts.map((c) => c.id), exactCosts.map((c) => c.cost), exactCosts.map((c) => c.invoice)]);
      }
      const all = [...exactCosts, ...estimated];
      if (all.length) {
        await client.query(`
          UPDATE orders o SET payment_cost_calculated = v.cost, updated_at = NOW()
          FROM unnest($1::bigint[], $2::numeric[]) AS v(id, cost)
          WHERE o.wp_order_id = v.id AND o.payment_cost_calculated IS DISTINCT FROM v.cost`,
        [all.map((c) => c.id), all.map((c) => c.cost)]);
      }
      await client.query('DELETE FROM mollie_estimated_rates');
      for (const [group, r] of Object.entries(rates)) {
        await client.query(
          'INSERT INTO mollie_estimated_rates (rate_group, fixed, pct, orders, source_invoice) VALUES ($1,$2,$3,$4,$5)',
          [group, r.fixed, r.pct, r.orders, last.invoiceNumber]);
      }
      await client.query('COMMIT');
      ratesCache = null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { applied: apply, months, rates, sourceInvoice: last.invoiceNumber, exactOrders: exactCosts.length, estimatedOrders: estimated.length };
}

module.exports = { ensureTables, mollieCostFor, applyMollieCosts };
