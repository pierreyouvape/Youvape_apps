/**
 * Contrôle d'une facture Mollie contre le contrat (config/mollieContract.js)
 * et contre nos commandes de la période, + répartition des coûts par pays.
 *
 * Le contrôle est rejoué à chaque lecture : une grille ajoutée au contrat
 * s'applique aussi aux factures déjà stockées.
 */
const pool = require('../config/database');
const { CONTRACT, GRIDS, REFERENCE_GRIDS, RATE_LABELS, METHODS, PAID_STATUSES, EEA, FR_ZONE } = require('../config/mollieContract');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Ligne de facture → tarif, moyen de paiement et zone.
 * zone : pool de commandes sur lequel répartir la ligne par pays
 * ('FR' = France + DROM, 'EEA' = EEE hors France, 'NON_EEA', 'BE', null = tout le moyen).
 */
function classifyLine(label) {
  const L = label.toLowerCase();
  const kind = /frais variables/.test(L) ? 'variable' : 'fixed';
  const refundMethod = /alma/.test(L) ? 'alma' : /bancontact/.test(L) ? 'bancontact'
    : /banque|pay by bank/.test(L) ? 'paybybank' : 'cards';

  if (/rembours/.test(L)) return { rateKey: 'refund', method: refundMethod, kind: 'refund', zone: null, inContract: false };
  if (/3ds/.test(L)) return { rateKey: 'threeds', method: 'cards', kind: '3ds', zone: null, inContract: true };
  if (/^alma/.test(L)) {
    const be = /belgique/.test(L);
    const x = /4 fois/.test(L) ? '4x' : '3x';
    return { rateKey: `alma_${be ? 'be' : 'fr'}_${x}`, method: 'alma', kind, zone: be ? 'BE' : 'FR', inContract: false };
  }
  if (/^bancontact/.test(L)) return { rateKey: 'bancontact', method: 'bancontact', kind, zone: null, inContract: true };
  if (/payer par banque|pay by bank/.test(L)) return { rateKey: 'paybybank', method: 'paybybank', kind, zone: null, inContract: false };
  if (/^cartes - en ligne/.test(L)) {
    if (/americanexpress|american express/.test(L)) return { rateKey: 'amex', method: 'cards', kind, zone: null, inContract: true };
    if (/cartes bancaires/.test(L)) return { rateKey: 'cb', method: 'cards', kind, zone: 'FR', inContract: true };
    if (/domestique particulier/.test(L)) return { rateKey: 'card_consumer', method: 'cards', kind, zone: 'FR', inContract: true };
    if (/europ.enne particulier/.test(L)) return { rateKey: 'card_consumer', method: 'cards', kind, zone: 'EEA', inContract: true };
    if (/commerciale/.test(L)) return { rateKey: 'card_commercial', method: 'cards', kind, zone: /domestique/.test(L) ? 'FR' : 'EEA', inContract: true };
    if (/d.faut|non eee|hors eee/.test(L)) return { rateKey: 'card_non_eea', method: 'cards', kind, zone: 'NON_EEA', inContract: true };
  }
  return null;
}

// Grilles du contrat en vigueur sur la période (une facture à cheval en accepte deux).
function gridsFor(periodStart, periodEnd) {
  const s = periodStart || '2000-01-01';
  const e = periodEnd || s;
  return GRIDS.filter((g) => g.from <= e && g.to > s);
}

/**
 * Tarifs hors contrat d'une clé applicables sur la période : la grille en
 * vigueur au début, plus celles qui prennent effet en cours de période.
 */
function referenceFor(rateKey, periodStart, periodEnd) {
  const s = periodStart || '2000-01-01';
  const e = periodEnd || s;
  const defining = REFERENCE_GRIDS.filter((g) => g.rates[rateKey]).sort((a, b) => a.from.localeCompare(b.from));
  const atStart = defining.filter((g) => g.from <= s && g.to > s).pop();
  const during = defining.filter((g) => g.from > s && g.from <= e);
  return [atStart, ...during].filter(Boolean);
}

const zoneOf = (country) => (FR_ZONE.includes(country) ? 'FR' : EEA.includes(country) ? 'EEA' : 'NON_EEA');

/** Nos commandes payées sur la période, par libellé de paiement × pays. */
async function loadOrders(periodStart, periodEnd) {
  const titles = Object.values(METHODS).flatMap((m) => m.titles);
  const { rows } = await pool.query(`
    SELECT payment_method_title AS title,
           COALESCE(NULLIF(billing_country, ''), NULLIF(shipping_country, ''), '??') AS country,
           count(*)::int AS n,
           COALESCE(sum(order_total), 0)::float AS volume,
           COALESCE(sum(payment_cost_calculated), 0)::float AS estimated
    FROM orders
    WHERE COALESCE(paid_date, post_date) >= $1::date
      AND COALESCE(paid_date, post_date) <  $2::date + 1
      AND post_status = ANY($3)
      AND order_total > 0
      AND payment_method_title = ANY($4)
    GROUP BY 1, 2
  `, [periodStart, periodEnd, PAID_STATUSES, titles]);
  const methodOf = Object.fromEntries(Object.entries(METHODS).flatMap(([k, m]) => m.titles.map((t) => [t, k])));
  return rows.map((r) => ({ ...r, method: methodOf[r.title], zone: zoneOf(r.country) }));
}

/**
 * Commandes concernées par une ligne : même moyen de paiement et même zone
 * (Alma Belgique → BE, cartes européennes → EEE hors France…). À défaut, tout le moyen.
 */
function poolFor(cls, rows) {
  const ofMethod = rows.filter((o) => o.method === cls.method);
  let pool = ofMethod;
  if (cls.zone === 'BE' || cls.zone === 'FR' && cls.method === 'alma') {
    pool = ofMethod.filter((o) => (cls.zone === 'BE' ? o.country === 'BE' : o.country !== 'BE'));
  } else if (cls.zone) {
    pool = ofMethod.filter((o) => o.zone === cls.zone);
  }
  return pool.length ? pool : ofMethod;
}

/**
 * Répartit le montant d'une ligne sur `rows` (pays agrégés ou commandes une à une),
 * frais fixes au nombre de transactions, frais variables au montant.
 */
function allocate(line, cls, rows, keyOf = (o) => o.country) {
  const pool = poolFor(cls, rows);
  if (!pool.length) return null;
  const weight = (o) => (cls.kind === 'variable' ? o.volume : o.n);
  const total = pool.reduce((s, o) => s + weight(o), 0) || 1;
  const out = {};
  for (const o of pool) out[keyOf(o)] = (out[keyOf(o)] || 0) + line.amount * weight(o) / total;
  return out;
}

/**
 * Contrôle complet. `orders` optionnel (sinon chargé).
 * Renvoie { checks[], lines[], byMethod{}, byCountry{}, reconciliation[], totals }.
 */
async function auditInvoice(inv, orders) {
  if (!orders) orders = await loadOrders(inv.periodStart, inv.periodEnd);
  const grids = gridsFor(inv.periodStart, inv.periodEnd);
  const checks = [];
  const add = (level, title, detail, amount) => checks.push({ level, title, detail, amount: amount ?? null });

  const byMethod = {};
  const byCountry = {};
  const byCountryMethod = {};
  let overcharge = 0;
  let unknown = 0;
  let calcErrors = 0;

  const lines = inv.lines.map((l) => {
    const cls = classifyLine(l.label);
    const out = { ...l, cls, issues: [] };
    if (!cls) {
      unknown++;
      out.issues.push('Ligne non reconnue');
      add('warn', 'Ligne inconnue du contrat', `« ${l.label} » (${l.amount} €) : nouveau frais ou nouveau moyen de paiement ? À ajouter à config/mollieContract.js.`, l.amount);
      return out;
    }

    // 1. Calcul : assiette × taux = montant exact, montant facturé = tronqué au centime.
    const expected = l.rateUnit === 'pct' ? l.base * l.rate / 100 : l.base * l.rate;
    if (Math.abs(expected - l.unrounded) > 0.0005) {
      calcErrors++;
      out.issues.push(`Calcul faux : ${l.base} × ${l.rate} = ${expected.toFixed(6)}`);
      add('error', 'Erreur de calcul', `« ${l.label} » : ${l.base} × ${l.rate}${l.rateUnit === 'pct' ? ' %' : ' €'} = ${expected.toFixed(4)} €, facturé ${l.unrounded} €.`, r2(l.unrounded - expected));
    }
    if (l.amount - l.unrounded > 0.005 || l.unrounded - l.amount >= 0.01) {
      calcErrors++;
      out.issues.push('Arrondi anormal');
      add('error', 'Arrondi anormal', `« ${l.label} » : ${l.unrounded} € arrondi à ${l.amount} € (Mollie tronque au centime inférieur).`, r2(l.amount - l.unrounded));
    }

    // 2. Taux contre le contrat (ou contre le tarif standard relevé, hors contrat).
    const field = l.rateUnit === 'pct' ? 'pct' : 'fixed';
    const refGrids = cls.inContract ? [] : referenceFor(cls.rateKey, inv.periodStart, inv.periodEnd);
    const candidates = cls.inContract
      ? grids.map((g) => g.rates[cls.rateKey]?.[field]).filter((v) => v != null)
      : refGrids.map((g) => g.rates[cls.rateKey]?.[field]).filter((v) => v != null);
    const notice = refGrids.map((g) => g.notice).filter(Boolean).pop();
    out.expectedRate = candidates.length ? Math.min(...candidates) : null;
    if (candidates.length && !candidates.some((c) => Math.abs(c - l.rate) < 1e-9)) {
      const ref = Math.min(...candidates);
      const delta = l.rateUnit === 'pct' ? l.base * (l.rate - ref) / 100 : l.base * (l.rate - ref);
      out.rateGap = r2(delta);
      const what = `${RATE_LABELS[cls.rateKey] || cls.rateKey} (${field === 'pct' ? 'variable' : 'fixe'}) : facturé ${l.rate}${field === 'pct' ? ' %' : ' €'}, attendu ${ref}${field === 'pct' ? ' %' : ' €'}`;
      if (cls.inContract && delta > 0) {
        overcharge += delta;
        out.issues.push('Taux supérieur au contrat');
        const clause = (inv.periodStart || '') < CONTRACT.inflationEarliest
          ? `Hausse interdite avant le ${CONTRACT.inflationEarliest.split('-').reverse().join('/')} (clause inflation) ; seule une hausse imposée par les banques, notifiée 1 mois avant, est possible.`
          : 'Hausse possible seulement si Mollie l\'a notifiée au moins 1 mois avant (inflation +2 à +5 % une fois par an, ou hausse imposée par les banques).';
        add('error', 'Taux supérieur au contrat', `${what}. ${clause}`, r2(delta));
      } else if (cls.inContract) {
        out.issues.push('Taux inférieur au contrat');
        add('info', 'Taux inférieur au contrat', `${what} (en notre faveur).`, r2(delta));
      } else if (notice && delta > 0) {
        overcharge += delta;
        out.issues.push('Taux supérieur au tarif annoncé');
        add('error', 'Taux supérieur au tarif annoncé par Mollie', `${what}. ${notice}`, r2(delta));
      } else {
        out.issues.push('Tarif hors contrat modifié');
        add('warn', 'Tarif hors contrat modifié', `${what}. Ce moyen n'est pas couvert par le contrat : vérifier la notification de Mollie.`, r2(delta));
      }
    } else if (!candidates.length) {
      add('warn', 'Pas de tarif de référence', `« ${l.label} » : aucun tarif attendu dans le contrat ni relevé. À compléter dans config/mollieContract.js.`, null);
    }

    // 3. Ventilation moyen de paiement / pays.
    const m = (byMethod[cls.method] = byMethod[cls.method] || { cost: 0, transactions: 0, volume: 0, fixed: 0, variable: 0, threeds: 0, refunds: 0 });
    m.cost += l.amount;
    if (cls.kind === 'variable') { m.variable += l.amount; m.volume += l.base; }
    else if (cls.kind === 'fixed') { m.fixed += l.amount; m.transactions += l.base; }
    else if (cls.kind === '3ds') m.threeds += l.amount;
    else m.refunds += l.amount;

    out.countries = allocate(l, cls, orders) || { [cls.zone && cls.zone.length === 2 ? cls.zone : '??']: l.amount };
    for (const [c, v] of Object.entries(out.countries)) {
      byCountry[c] = (byCountry[c] || 0) + v;
      const k = `${c}|${cls.method}`;
      byCountryMethod[k] = (byCountryMethod[k] || 0) + v;
    }
    return out;
  });

  // 4. Totaux : détail = total HT, récapitulatif = total HT, prélèvement − reversement = total.
  const sumLines = r2(inv.lines.reduce((s, l) => s + l.amount, 0));
  const sumSummary = r2(inv.summary.reduce((s, l) => s + l.amount, 0));
  if (inv.totalHT == null) add('error', 'Total HT illisible', 'Le total hors TVA n\'a pas été trouvé sur la facture.');
  else {
    if (Math.abs(sumLines - inv.totalHT) > 0.005) add('error', 'Détail ≠ total facturé', `Somme des lignes de détail ${sumLines} € contre total HT ${inv.totalHT} €.`, r2(inv.totalHT - sumLines));
    if (inv.summary.length && Math.abs(sumSummary - inv.totalHT) > 0.005) add('error', 'Récapitulatif ≠ total facturé', `Somme du récapitulatif ${sumSummary} € contre total HT ${inv.totalHT} €.`, r2(inv.totalHT - sumSummary));
    if (inv.prepaid != null) {
      const net = r2(-inv.prepaid - (inv.credited || 0));
      if (Math.abs(net - inv.totalHT) > 0.005) add('warn', 'Prélèvement ≠ facture', `Prélevé ${-inv.prepaid} €, reversé ${inv.credited || 0} € : net ${net} € contre ${inv.totalHT} € facturés.`, r2(net - inv.totalHT));
    }
    if (inv.amountDue && inv.amountDue > 0) add('warn', 'Reste à payer', `Montant dû : ${inv.amountDue} €.`, inv.amountDue);
  }
  if (inv.totalTTC != null && inv.totalHT != null && Math.abs(inv.totalTTC - inv.totalHT) > 0.005) {
    add('warn', 'TVA facturée', `TTC ${inv.totalTTC} € ≠ HT ${inv.totalHT} € : la facture devrait être en autoliquidation (TVA 0).`);
  }
  for (const w of inv.warnings || []) add('error', 'Ligne illisible', w);

  // 5. Rapprochement avec nos commandes (nombre de paiements et montant encaissé).
  const ours = (filter) => orders.filter(filter).reduce((a, o) => ({ n: a.n + o.n, volume: a.volume + o.volume, estimated: a.estimated + o.estimated }), { n: 0, volume: 0, estimated: 0 });
  const mollieOf = (filter) => lines.filter((l) => l.cls && l.cls.kind !== 'refund' && l.cls.kind !== '3ds' && filter(l))
    .reduce((a, l) => (l.cls.kind === 'variable' ? { ...a, volume: a.volume + l.base } : { ...a, n: a.n + l.base }), { n: 0, volume: 0 });
  const recoDefs = [
    { key: 'cards', label: 'Cartes', mol: (l) => l.cls.method === 'cards', our: (o) => o.method === 'cards' },
    { key: 'bancontact', label: 'Bancontact', mol: (l) => l.cls.method === 'bancontact', our: (o) => o.method === 'bancontact' },
    { key: 'alma_be', label: 'Alma Belgique', mol: (l) => l.cls.method === 'alma' && l.cls.zone === 'BE', our: (o) => o.method === 'alma' && o.country === 'BE' },
    { key: 'alma_fr', label: 'Alma France', mol: (l) => l.cls.method === 'alma' && l.cls.zone === 'FR', our: (o) => o.method === 'alma' && o.country !== 'BE' },
    { key: 'paybybank', label: 'Pay by Bank', mol: (l) => l.cls.method === 'paybybank', our: (o) => o.method === 'paybybank' },
  ];
  const reconciliation = recoDefs.map((d) => {
    const mo = mollieOf(d.mol);
    const ou = ours(d.our);
    return {
      key: d.key, label: d.label,
      mollieCount: mo.n, mollieVolume: r2(mo.volume),
      ourCount: ou.n, ourVolume: r2(ou.volume),
      diffCount: mo.n - ou.n, diffVolume: r2(mo.volume - ou.volume),
    };
  }).filter((r) => r.mollieCount || r.ourCount);
  for (const r of reconciliation) {
    const tolN = Math.max(3, r.ourCount * 0.02);
    const tolV = Math.max(50, r.ourVolume * 0.02);
    if (r.diffCount > tolN || r.diffVolume > tolV) {
      add('warn', `${r.label} : Mollie facture plus que nos ventes`,
        `${r.mollieCount} paiements / ${r.mollieVolume} € chez Mollie contre ${r.ourCount} / ${r.ourVolume} € dans nos commandes payées (écart ${r.diffCount} / ${r.diffVolume} €). Paiements hors site (boutiques, liens de paiement) ou commandes non synchronisées ?`);
    } else if (-r.diffCount > tolN || -r.diffVolume > tolV) {
      add('info', `${r.label} : moins de paiements Mollie que de commandes`,
        `${r.mollieCount} / ${r.mollieVolume} € chez Mollie contre ${r.ourCount} / ${r.ourVolume} € chez nous (commandes payées autrement ou à cheval sur deux mois).`);
    }
  }

  // 6. 3DS : tentatives par paiement carte (information).
  const threeds = inv.lines.find((l) => /3ds/i.test(l.label));
  const cardTx = reconciliation.find((r) => r.key === 'cards')?.mollieCount || 0;
  const threedsRatio = threeds && cardTx ? threeds.base / cardTx : null;

  // 7. Frais estimés par l'app (/financier) contre frais réels.
  const estimated = r2(orders.reduce((s, o) => s + o.estimated, 0));

  if (!checks.some((c) => c.level === 'error' || c.level === 'warn')) {
    add('ok', 'Facture conforme', 'Tous les taux sont ceux du contrat, chaque ligne est juste et les totaux se recoupent.');
  }

  const volume = Object.values(byMethod).reduce((s, m) => s + m.volume, 0);
  return {
    checks,
    lines,
    byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, r2(b)]))])),
    byCountry: Object.fromEntries(Object.entries(byCountry).map(([k, v]) => [k, r2(v)])),
    byCountryMethod: Object.fromEntries(Object.entries(byCountryMethod).map(([k, v]) => [k, r2(v)])),
    reconciliation,
    totals: {
      cost: inv.totalHT, volume: r2(volume), effectiveRate: volume ? inv.totalHT / volume * 100 : null,
      overcharge: r2(overcharge), unknownLines: unknown, calcErrors,
      threedsAttempts: threeds?.base ?? null, threedsRatio, estimatedByApp: estimated,
      errors: checks.filter((c) => c.level === 'error').length,
      warnings: checks.filter((c) => c.level === 'warn').length,
    },
    grids: grids.map((g) => g.label),
  };
}

/* ─── Frais de paiement des commandes (/financier) ──────────────────────── */

const METHOD_OF_TITLE = Object.fromEntries(Object.entries(METHODS).flatMap(([k, m]) => m.titles.map((t) => [t, k])));

/** Groupe de tarif d'une commande : moyen + zone (celle des lignes de facture). */
function rateGroup(method, country) {
  if (method === 'cards') return `cards|${zoneOf(country)}`;
  if (method === 'alma') return `alma|${country === 'BE' ? 'BE' : 'FR'}`;
  return `${method}|ALL`;
}

/** Commandes Mollie payées sur [from, to] (dates incluses), une ligne par commande. */
async function loadOrderRows(from, to) {
  const { rows } = await pool.query(`
    SELECT wp_order_id::bigint AS id, payment_method_title AS title,
           COALESCE(NULLIF(billing_country, ''), NULLIF(shipping_country, ''), '??') AS country,
           order_total::float AS volume, payment_cost_calculated::float AS current
    FROM orders
    WHERE COALESCE(paid_date, post_date) >= $1::date
      AND ($2::date IS NULL OR COALESCE(paid_date, post_date) < $2::date + 1)
      AND post_status = ANY($3)
      AND order_total > 0
      AND payment_method_title = ANY($4)
  `, [from, to, PAID_STATUSES, Object.keys(METHOD_OF_TITLE)]);
  return rows.map((r) => ({ ...r, n: 1, method: METHOD_OF_TITLE[r.title], zone: zoneOf(r.country) }));
}

/** Tarif en vigueur à une date pour une ligne classée (contrat ou tarif standard). */
function rateAt(cls, field, date) {
  if (cls.inContract) return gridsFor(date, date).map((g) => g.rates[cls.rateKey]?.[field]).find((v) => v != null) ?? null;
  return referenceFor(cls.rateKey, date, date).map((g) => g.rates[cls.rateKey]?.[field]).filter((v) => v != null).pop() ?? null;
}

/** Arrondit au centime en gardant la somme exacte (plus forts restes). */
function roundKeepingTotal(values, target) {
  const entries = Object.entries(values).map(([k, v]) => ({ k, v, c: Math.floor(v * 100 + 1e-9) }));
  let rest = Math.round(target * 100) - entries.reduce((s, e) => s + e.c, 0);
  entries.sort((a, b) => (b.v * 100 - b.c) - (a.v * 100 - a.c));
  for (let i = 0; rest > 0 && entries.length; i = (i + 1) % entries.length, rest--) entries[i].c++;
  return Object.fromEntries(entries.map((e) => [e.k, e.c / 100]));
}

/**
 * Répartit une facture sur les commandes de sa période. Chaque ligne va aux
 * commandes de son moyen et de sa zone. Renvoie le coût de chaque commande
 * (somme = total réparti, au centime) et, par groupe de tarif, le fixe et le
 * pourcentage qui reproduisent la facture au tarif en vigueur à `rateDate`.
 */
function allocateInvoiceToOrders(inv, rows, rateDate) {
  const fixedPart = {};
  const variablePart = {};
  let allocated = 0;
  const unallocated = [];
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  for (const l of inv.lines) {
    const cls = classifyLine(l.label);
    const parts = cls && allocate(l, cls, rows, (o) => o.id);
    if (!parts) { unallocated.push({ label: l.label, amount: l.amount }); continue; }
    allocated += l.amount;
    // Recalage au tarif du jour (ex. Pay by Bank 0,80 % → 0,45 % au 01/12/2026).
    const field = l.rateUnit === 'pct' ? 'pct' : 'fixed';
    const today = cls && rateDate ? rateAt(cls, field, rateDate) : null;
    const factor = today != null && l.rate ? today / l.rate : 1;
    const target = cls.kind === 'variable' ? variablePart : fixedPart;
    for (const [id, v] of Object.entries(parts)) {
      target[id] = target[id] || { exact: 0, now: 0 };
      target[id].exact += v;
      target[id].now += v * factor;
    }
  }

  const exact = {};
  for (const id of Object.keys(byId)) exact[id] = (fixedPart[id]?.exact || 0) + (variablePart[id]?.exact || 0);
  const costs = roundKeepingTotal(exact, allocated);

  const groups = {};
  for (const r of rows) {
    const g = (groups[rateGroup(r.method, r.country)] = groups[rateGroup(r.method, r.country)] || { orders: 0, volume: 0, fixed: 0, variable: 0 });
    g.orders++;
    g.volume += r.volume;
    g.fixed += fixedPart[r.id]?.now || 0;
    g.variable += variablePart[r.id]?.now || 0;
  }
  const rates = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
    orders: g.orders,
    fixed: g.orders ? Math.round(g.fixed / g.orders * 10000) / 10000 : 0,
    pct: g.volume ? Math.round(g.variable / g.volume * 100 * 10000) / 10000 : 0,
  }]));

  return { costs, allocated: r2(allocated), unallocated, rates };
}

module.exports = { auditInvoice, classifyLine, loadOrders, loadOrderRows, allocateInvoiceToOrders, rateGroup, METHOD_OF_TITLE };
