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
const {
  loadOrderRows, allocateInvoiceToOrders, rateGroup, METHOD_OF_TITLE, classifyLine, coverageOf, allocate, roundKeepingTotal,
} = require('./mollieAuditService');

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
  const { rows: docs } = await pool.query(`
    SELECT invoice_number, period_start, period_end, total_ht::float AS total, parsed
    FROM mollie_invoices WHERE period_start IS NOT NULL ORDER BY period_start, invoice_number`);
  const invoices = docs.filter((d) => d.parsed.docType !== 'credit');
  if (!invoices.length) throw new Error('Aucune facture Mollie enregistrée');

  const today = isoDay(new Date());
  const periods = invoices.map((d) => ({ from: isoDay(d.period_start), to: isoDay(d.period_end), number: d.invoice_number }));
  const invoiced = (day) => periods.some((p) => day >= p.from && day <= p.to);

  const acc = {};        // coût accumulé par commande (factures + avoirs)
  const source = {};     // facture qui porte la commande
  const current = {};    // frais actuels, pour l'avant / après
  const credits = [];
  let lastRates = null;
  const add = (costs, number) => {
    for (const [id, c] of Object.entries(costs)) { acc[id] = r2((acc[id] || 0) + c); source[id] = source[id] || number; }
  };

  for (const doc of docs) {
    const from = isoDay(doc.period_start);
    const to = isoDay(doc.period_end);
    // Un avoir qui nomme sa période (« during January 30 to May 20, 2026 ») va aux
    // commandes de cette période, pas à celles du mois où il est émis.
    const covering = [];
    const rest = [];
    for (const l of doc.parsed.lines || []) {
      const cls = classifyLine(l.label);
      const cov = cls?.kind === 'adjustment' ? coverageOf(l.label) : null;
      (cov ? covering : rest).push({ l, cls, cov });
    }

    const rows = await loadOrderRows(from, to);
    for (const r of rows) current[r.id] = r.current || 0;
    const res = allocateInvoiceToOrders({ ...doc.parsed, lines: rest.map((x) => x.l) }, rows, today);
    add(res.costs, doc.invoice_number);
    if (doc.parsed.docType !== 'credit') lastRates = { rates: res.rates, number: doc.invoice_number, end: to };
    if (doc.parsed.docType === 'credit') credits.push({ invoiceNumber: doc.invoice_number, label: (doc.parsed.lines || []).map((l) => l.label).join(' + '), amount: doc.total, spreadOn: `${from} → ${to}` });

    for (const { l, cls, cov } of covering) {
      let target = (await loadOrderRows(cov.from, cov.to)).filter((r) => invoiced(r.day));
      if (!target.length) target = rows;
      for (const r of target) current[r.id] = r.current || 0;
      const parts = allocate(l, cls, target, (o) => o.id) || {};
      add(roundKeepingTotal(parts, l.amount), doc.invoice_number);
      credits.push({ invoiceNumber: doc.invoice_number, label: l.label, amount: l.amount, spreadOn: `${cov.from} → ${cov.to}`, orders: target.length });
    }
  }

  // Avant / après par facture : commandes de sa période, avoirs compris.
  const months = [];
  for (const p of periods) {
    const rows = await loadOrderRows(p.from, p.to);
    months.push({
      invoiceNumber: p.number, periodStart: p.from, periodEnd: p.to, kind: 'facture', orders: rows.length,
      invoiceTotal: invoices.find((d) => d.invoice_number === p.number).total,
      before: r2(rows.reduce((s, r) => s + (current[r.id] ?? r.current ?? 0), 0)),
      after: r2(rows.reduce((s, r) => s + (acc[r.id] || 0), 0)),
      unallocated: [],
    });
  }
  const exactCosts = Object.entries(acc).map(([id, cost]) => ({ id, cost, invoice: source[id] }));

  // Commandes plus récentes que la dernière facture : tarif recalé.
  const rates = lastRates.rates;
  const next = new Date(`${lastRates.end}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const pending = (await loadOrderRows(isoDay(next), null)).filter((r) => acc[r.id] == null);
  const estimated = [];
  for (const r of pending) {
    const rate = rates[rateGroup(r.method, r.country)];
    if (rate) estimated.push({ id: r.id, cost: r2(rate.fixed + rate.pct / 100 * r.volume), before: r.current || 0 });
  }
  months.push({
    kind: 'estimation', periodStart: isoDay(next), periodEnd: today, orders: pending.length,
    before: r2(estimated.reduce((s, e) => s + e.before, 0)), after: r2(estimated.reduce((s, e) => s + e.cost, 0)),
  });
  const last = { invoiceNumber: lastRates.number };

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

  return { applied: apply, months, credits, rates, sourceInvoice: last.invoiceNumber, exactOrders: exactCosts.length, estimatedOrders: estimated.length };
}

module.exports = { ensureTables, mollieCostFor, applyMollieCosts };
