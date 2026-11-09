/**
 * Coût de livraison réel des commandes, à partir des factures transporteurs.
 *
 * Chaque ligne de colis reçoit son coût complet (cost_ht) : transport + suppléments
 * du colis + quote-part des charges de la facture. Le coût d'une commande est ensuite
 * la somme de toutes ses lignes, tous transporteurs (aller et retours), plus ses
 * avoirs — cf. la vue order_carrier_costs (add_order_carrier_costs.sql).
 *
 * Les formules reprennent exactement celles des écrans d'analyse :
 *   Chronopost : computeTarif (ChronopostApp.jsx)
 *   Colissimo  : total_ht + suppléments du colis + décarbonation (ColissimoApp.jsx)
 *   Mondial Relay : amount_ht, déjà net de remise et charges (annexe CSV)
 */

// ── Chronopost ────────────────────────────────────────────────────────────
// (base + redevance_unit) × (1 + carburant) + eco_unit + frais_gestion / nb_sûreté
function chronopostParams(orders, globalCharges) {
  let redevanceUnit = 0, nbSurete = orders.length || 1, ecoUnit = 0, carburantRate = 0, fraisGestion = 0;
  for (const g of globalCharges || []) {
    const desc = g.description || '', detail = g.detail || '';
    const amount = Number(g.amount_ht) || 0;
    if (/redevance/i.test(desc)) {
      const m = detail.match(/(\d+)\s*colis/);
      if (m) { nbSurete = parseInt(m[1], 10); redevanceUnit = amount / nbSurete; }
      else redevanceUnit = amount / (orders.length || 1);
    } else if (/eco/i.test(desc)) {
      const m = detail.match(/(\d+)\s*colis/);
      if (m) { const n = parseInt(m[1], 10); ecoUnit = amount / n; if (redevanceUnit === 0) nbSurete = n; }
      else ecoUnit = amount / (orders.length || 1);
    } else if (/carburant/i.test(desc)) {
      // Deux surcharges possibles (aérien puis routier) : la première, comme l'écran
      const m = detail.match(/([\d.]+)\s*%/);
      if (m && carburantRate === 0) carburantRate = parseFloat(m[1]) / 100;
    } else if (/frais de gestion/i.test(desc)) {
      fraisGestion = amount;
    }
  }
  return { redevanceUnit, nbSurete, ecoUnit, carburantRate, fraisGestion };
}

// Suppléments hors base carburant : pénalités administratives
const FLAT_SUPPL_RE = /réacheminement|[eé]tiquette\s+non\s+conforme|annonce\s+incompl|assurance/i;

function chronopostLineCosts(invoice, parcels, supplements) {
  const base = {}, flat = {};
  for (const s of supplements || []) {
    if (!s.tracking) continue;
    const target = FLAT_SUPPL_RE.test(s.description || '') ? flat : base;
    target[s.tracking] = (target[s.tracking] || 0) + (Number(s.amount_ht) || 0);
  }
  const gc = Array.isArray(invoice.global_charges) ? invoice.global_charges : [];
  const p = chronopostParams(parcels, gc);
  return parcels.map(parcel => {
    if (parcel.amount_ht == null) return { id: parcel.id, cost: null };
    const amount = Number(parcel.amount_ht);
    const sb = base[parcel.tracking] || 0, sf = flat[parcel.tracking] || 0;
    const cost = parcel.is_return
      ? (amount + sb) * (1 + p.carburantRate) + sf
      : (amount + sb + p.redevanceUnit) * (1 + p.carburantRate) + p.ecoUnit + p.fraisGestion / p.nbSurete + sf;
    return { id: parcel.id, cost };
  });
}

// Montant déduit par chaque ligne d'un avoir. Une ligne de supplément (sans poids) ne porte
// ni sûreté ni éco-participation, comptées au colis, et une pénalité administrative n'entre
// pas dans la base carburant. Sinon la somme des lignes dépasse le total du document
// (40984082 : -74,14 € pour -70,98 €).
function chronopostCreditLines(orders, globalCharges) {
  const p = chronopostParams(orders, globalCharges);
  return orders.map(o => {
    if (o.amount_ht == null) return null;
    const amount = Number(o.amount_ht);
    let credit;
    if (o.weight_chrono == null) {
      credit = FLAT_SUPPL_RE.test(o.supplement_label || '') ? amount : amount * (1 + p.carburantRate);
    } else if (o.is_return) {
      credit = amount * (1 + p.carburantRate);
    } else {
      credit = (amount + p.redevanceUnit) * (1 + p.carburantRate) + p.ecoUnit + p.fraisGestion / p.nbSurete;
    }
    // Au centime, comme carrier_invoice_credits.amount_ht : l'écran montre ce qui sera enregistré
    return Math.round(credit * 100) / 100;
  });
}

// ── Colissimo ─────────────────────────────────────────────────────────────
function colissimoLineCosts(invoice, parcels, supplements) {
  const suppl = {};
  for (const s of supplements || []) if (s.tracking) suppl[s.tracking] = (suppl[s.tracking] || 0) + (Number(s.amount_ht) || 0);
  // La décarbonation n'est que dans le récap global, reportée sur chaque colis à l'analyse
  const decarb = {};
  for (const d of Array.isArray(invoice.parcels_detail) ? invoice.parcels_detail : []) {
    if (d.tracking && d.decarbonation_unit != null) decarb[d.tracking] = Number(d.decarbonation_unit) || 0;
  }
  return parcels.map(parcel => ({
    id: parcel.id,
    cost: parcel.amount_ht == null ? null
      : Number(parcel.amount_ht) + (suppl[parcel.tracking] || 0) + (decarb[parcel.tracking] || 0),
  }));
}

// ── Mondial Relay ─────────────────────────────────────────────────────────
function mondialRelayLineCosts(invoice, parcels) {
  return parcels.map(parcel => ({ id: parcel.id, cost: parcel.amount_ht == null ? null : Number(parcel.amount_ht) }));
}

const LINE_COSTS = {
  chronopost: chronopostLineCosts,
  colissimo: colissimoLineCosts,
  mondial_relay: mondialRelayLineCosts,
};

/**
 * Calcule les cost_ht des colis d'une facture. Avec write=false, ne fait que lire.
 * @returns {{ orderIds: number[], lines: {id, order_id, cost}[] }}
 */
async function computeInvoiceCosts(db, invoiceId, { write = true } = {}) {
  const inv = await db.query(
    'SELECT id, carrier, global_charges, parcels_detail FROM carrier_invoices WHERE id = $1', [invoiceId]
  );
  if (!inv.rows.length) throw Object.assign(new Error('Facture non trouvée'), { status: 404 });
  const invoice = inv.rows[0];
  const fn = LINE_COSTS[invoice.carrier];
  if (!fn) return { orderIds: [], lines: [] };

  const parcels = (await db.query(
    'SELECT id, tracking, order_id, amount_ht, is_return FROM carrier_invoice_parcels WHERE invoice_id = $1 ORDER BY id', [invoiceId]
  )).rows;
  const supplements = (await db.query(
    'SELECT tracking, description, amount_ht FROM carrier_invoice_supplements WHERE invoice_id = $1', [invoiceId]
  )).rows;

  const costs = fn(invoice, parcels, supplements);
  const byId = Object.fromEntries(parcels.map(p => [p.id, p]));
  const lines = costs.map(c => ({ id: c.id, order_id: byId[c.id].order_id, cost: c.cost == null ? null : Math.round(c.cost * 10000) / 10000 }));

  if (write && lines.length) {
    await db.query(`
      UPDATE carrier_invoice_parcels p SET cost_ht = c.cost
      FROM unnest($1::int[], $2::numeric[]) AS c(id, cost)
      WHERE p.id = c.id
    `, [lines.map(l => l.id), lines.map(l => l.cost)]);
  }
  const orderIds = [...new Set(lines.map(l => l.order_id).filter(Boolean))];
  return { orderIds, lines };
}

/**
 * Commandes touchées par les avoirs d'une ou plusieurs factures (avoirs « sur facture N »).
 */
async function creditOrderIds(db, invoiceIds) {
  const { rows } = await db.query(`
    SELECT DISTINCT c.order_id
    FROM carrier_invoices ci
    JOIN carrier_credit_documents d ON d.carrier = ci.carrier AND d.related_invoice_number = ci.invoice_number
    JOIN carrier_invoice_credits c ON c.carrier = d.carrier AND c.credit_number = d.credit_number
    WHERE ci.id = ANY($1::int[]) AND c.order_id IS NOT NULL
  `, [invoiceIds]);
  return rows.map(r => r.order_id);
}

/**
 * Écrit le coût réel (vue order_carrier_costs) dans orders.shipping_cost_calculated.
 * Plancher à 0 : un avoir arrondi à la ligne peut laisser quelques centimes négatifs.
 * @returns {number} commandes mises à jour
 */
async function recomputeOrderCosts(db, orderIds) {
  const ids = [...new Set((orderIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  const r = await db.query(`
    UPDATE orders o
    SET shipping_cost_calculated = GREATEST(0, ROUND(v.cost, 2))
    FROM order_carrier_costs v
    WHERE v.order_id = ANY($1::int[]) AND o.wp_order_id = v.order_id
  `, [ids]);
  return r.rowCount;
}

/**
 * Applique les tarifs de factures : cost_ht des colis, puis coût réel des commandes
 * concernées (y compris celles de leurs avoirs). Marque les factures appliquées.
 */
async function applyInvoices(db, invoiceIds) {
  const ids = [...new Set((invoiceIds || []).map(Number).filter(Boolean))];
  const orderIds = [];
  for (const id of ids) orderIds.push(...(await computeInvoiceCosts(db, id)).orderIds);
  orderIds.push(...await creditOrderIds(db, ids));
  const updated = await recomputeOrderCosts(db, orderIds);
  const upd = await db.query(
    'UPDATE carrier_invoices SET tariffs_applied_at = NOW() WHERE id = ANY($1::int[]) RETURNING tariffs_applied_at', [ids]
  );
  return { updated, tariffsAppliedAt: upd.rows[0]?.tariffs_applied_at || null };
}

/** SQL : la commande a-t-elle un coût réel facturé ? (protège contre l'estimation) */
const HAS_REAL_COST_SQL = alias =>
  `EXISTS (SELECT 1 FROM carrier_invoice_parcels rc WHERE rc.order_id = ${alias}.wp_order_id AND rc.cost_ht IS NOT NULL)`;

/**
 * Coût d'expédition d'une commande pour les KPI : réel (vue order_carrier_costs, alias `ship`)
 * sinon estimé (orders, alias `o`), plancher à 0 (avoir supérieur aux lignes facturées).
 * Le COALESCE doit rester DANS le GREATEST : GREATEST ignore les NULL en PostgreSQL, donc
 * GREATEST(0, NULL) = 0 et COALESCE(GREATEST(0, ship.cost), ...) ne retombe jamais sur
 * l'estimé (commandes non facturées comptées à 0 €, bug du 04/11 au 09/11/2026).
 */
const ORDER_SHIP_COST_SQL = 'GREATEST(0, COALESCE(ship.cost, o.shipping_cost_calculated))';

module.exports = {
  chronopostLineCosts, chronopostCreditLines, colissimoLineCosts, mondialRelayLineCosts,
  computeInvoiceCosts, creditOrderIds, recomputeOrderCosts, applyInvoices, HAS_REAL_COST_SQL,
  ORDER_SHIP_COST_SQL,
};
