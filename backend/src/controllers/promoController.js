/**
 * App « Actions Promos » — préparation et évaluation d'opérations promotionnelles.
 *
 * L'app ne pousse AUCUN prix vers WooCommerce : elle sert à simuler des remises,
 * vérifier les marges avant de décider, et mesurer après coup l'effet de l'opé.
 */
const promoModel = require('../models/promoModel');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** YYYY-MM-DD en heure locale (les dates WC sont stockées en heure Paris). */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s) => {
  if (!s) return null;
  // pg renvoie les colonnes DATE en objet Date (minuit heure locale) : on garde
  // la partie date locale, jamais toISOString() (UTC -> veille en soiree).
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

/**
 * Calcule tous les prix / marges d'une ligne.
 *
 * Prix catalogue TTC (`price`, `discounted_price`) vs coût HT (`computed_cost`) :
 * on repasse systématiquement le prix en HT avant de calculer une marge.
 */
function computeLine(item, { vatRate, basePriceMode }) {
  const vat = 1 + (num(vatRate) ?? 20) / 100;
  const price = num(item.price);
  const discounted = num(item.discounted_price);
  const cost = num(item.cost_price);
  const stock = parseInt(item.stock, 10) || 0;

  // Base sur laquelle s'applique la remise saisie.
  const base = basePriceMode === 'discounted' ? (discounted ?? price) : price;

  const discountPercent = num(item.discount_percent) ?? 0;
  const forced = num(item.promo_price);
  // Un prix promo saisi à la main prime sur le pourcentage.
  const promoTtc = forced !== null
    ? forced
    : (base !== null ? base * (1 - discountPercent / 100) : null);

  // Remise effective par rapport au prix de vente public (référence client).
  const effectiveDiscount = (price && promoTtc !== null) ? (1 - promoTtc / price) * 100 : null;

  // Remise TOTALE : écart entre le prix sans aucune remise et le prix promo.
  // Le prix sans remise est le prix barré WooCommerce (`regular_price`) quand il
  // existe — `price` peut déjà être un prix soldé, auquel cas la remise réellement
  // vue par le client est plus élevée que le pourcentage saisi.
  const undiscounted = num(item.regular_price) ?? price;
  const totalDiscount = (undiscounted && promoTtc !== null) ? (1 - promoTtc / undiscounted) * 100 : null;

  const htOf = (ttc) => (ttc === null || ttc === undefined ? null : ttc / vat);
  const marginOf = (ttc) => {
    const ht = htOf(ttc);
    if (ht === null || cost === null) return { eur: null, pct: null };
    return { eur: ht - cost, pct: ht > 0 ? ((ht - cost) / ht) * 100 : null };
  };

  // Situation actuelle = tarif réellement appliqué aujourd'hui (remise WDR incluse).
  const current = marginOf(discounted ?? price);
  const promo = marginOf(promoTtc);

  return {
    ...item,
    price, discounted_price: discounted, cost_price: cost, stock,
    base_price: round2(base),
    promo_price_ttc: round2(promoTtc),
    promo_price_ht: round2(htOf(promoTtc)),
    effective_discount_percent: round2(effectiveDiscount),
    undiscounted_price: round2(undiscounted),
    total_discount_percent: round2(totalDiscount),
    current_price_ttc: round2(discounted ?? price),
    current_margin_eur: round2(current.eur),
    current_margin_pct: round2(current.pct),
    promo_margin_eur: round2(promo.eur),
    promo_margin_pct: round2(promo.pct),
    margin_delta_eur: round2(promo.eur !== null && current.eur !== null ? promo.eur - current.eur : null),
    // Ce que rapporterait l'écoulement complet du stock au tarif promo.
    stock_margin_eur: round2(promo.eur !== null ? promo.eur * stock : null),
    stock_value_ht: round2(cost !== null ? cost * stock : null),
    // Alerte : la promo passe sous le prix de revient.
    below_cost: promo.eur !== null ? promo.eur < 0 : false,
  };
}

/* ─── Opérations ─────────────────────────────────────────────── */

exports.listOperations = async (req, res) => {
  try {
    res.json({ success: true, data: await promoModel.listOperations() });
  } catch (error) {
    console.error('Erreur listOperations (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.createOperation = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: "Le nom de l'opération est obligatoire" });
    }
    const op = await promoModel.createOperation({ ...req.body, name: String(name).trim(), created_by: req.user?.id });
    res.status(201).json({ success: true, data: op });
  } catch (error) {
    console.error('Erreur createOperation (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.getOperation = async (req, res) => {
  try {
    const op = await promoModel.getOperation(req.params.id);
    if (!op) return res.status(404).json({ success: false, error: 'Opération introuvable' });

    const rawItems = await promoModel.listItems(op.id);
    const opts = { vatRate: op.vat_rate, basePriceMode: op.base_price_mode };
    const items = rawItems.map((it) => computeLine(it, opts));

    // Totaux : marge « potentielle » = marge unitaire × stock disponible.
    const totals = items.reduce((t, it) => {
      t.stock += it.stock || 0;
      t.stock_value_ht += it.stock_value_ht || 0;
      t.stock_margin_current += (it.current_margin_eur || 0) * (it.stock || 0);
      t.stock_margin_promo += it.stock_margin_eur || 0;
      t.sales_30d += it.sales_30d || 0;
      if (it.below_cost) t.below_cost += 1;
      return t;
    }, { stock: 0, stock_value_ht: 0, stock_margin_current: 0, stock_margin_promo: 0, sales_30d: 0, below_cost: 0 });

    const withDiscount = items.filter((i) => i.effective_discount_percent !== null);
    totals.avg_discount = withDiscount.length
      ? round2(withDiscount.reduce((s, i) => s + i.effective_discount_percent, 0) / withDiscount.length)
      : 0;
    totals.items_count = items.length;
    ['stock_value_ht', 'stock_margin_current', 'stock_margin_promo'].forEach((k) => { totals[k] = round2(totals[k]); });
    totals.stock_margin_delta = round2(totals.stock_margin_promo - totals.stock_margin_current);

    res.json({ success: true, data: { operation: op, items, totals } });
  } catch (error) {
    console.error('Erreur getOperation (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.updateOperation = async (req, res) => {
  try {
    const op = await promoModel.updateOperation(req.params.id, req.body);
    if (!op) return res.status(404).json({ success: false, error: 'Opération introuvable' });
    res.json({ success: true, data: op });
  } catch (error) {
    console.error('Erreur updateOperation (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.deleteOperation = async (req, res) => {
  try {
    const ok = await promoModel.deleteOperation(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Opération introuvable' });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur deleteOperation (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.duplicateOperation = async (req, res) => {
  try {
    const op = await promoModel.duplicateOperation(req.params.id, { name: req.body?.name, created_by: req.user?.id });
    if (!op) return res.status(404).json({ success: false, error: 'Opération introuvable' });
    res.status(201).json({ success: true, data: op });
  } catch (error) {
    console.error('Erreur duplicateOperation (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── Lignes produits ────────────────────────────────────────── */

exports.addItems = async (req, res) => {
  try {
    const ids = (req.body?.wp_product_ids || []).map((v) => parseInt(v, 10)).filter(Boolean);
    if (ids.length === 0) return res.status(400).json({ success: false, error: 'Aucun produit fourni' });
    const added = await promoModel.addItems(req.params.id, ids, {
      discount_percent: num(req.body?.discount_percent) ?? 0,
    });
    res.json({ success: true, added, skipped: ids.length - added });
  } catch (error) {
    console.error('Erreur addItems (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const body = { ...req.body };
    // Saisir un pourcentage efface un prix promo forcé, et inversement.
    if (body.discount_percent !== undefined && body.promo_price === undefined) body.promo_price = null;
    const item = await promoModel.updateItem(req.params.id, req.params.itemId, body);
    if (!item) return res.status(404).json({ success: false, error: 'Ligne introuvable' });
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Erreur updateItem (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.bulkDiscount = async (req, res) => {
  try {
    const pct = num(req.body?.discount_percent);
    if (pct === null) return res.status(400).json({ success: false, error: 'Pourcentage invalide' });
    const itemIds = Array.isArray(req.body?.item_ids)
      ? req.body.item_ids.map((v) => parseInt(v, 10)).filter(Boolean)
      : null;
    const updated = await promoModel.bulkDiscount(req.params.id, pct, itemIds);
    res.json({ success: true, updated });
  } catch (error) {
    console.error('Erreur bulkDiscount (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const ok = await promoModel.deleteItem(req.params.id, req.params.itemId);
    if (!ok) return res.status(404).json({ success: false, error: 'Ligne introuvable' });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur deleteItem (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── Sélecteur produits ─────────────────────────────────────── */

exports.searchProducts = async (req, res) => {
  try {
    const rows = await promoModel.searchProducts({
      q: req.query.q || '',
      brand: req.query.brand || null,
      subBrand: req.query.subBrand || null,
      category: req.query.category || null,
      subCategory: req.query.subCategory || null,
      noSaleDays: req.query.noSaleDays || null,
      inStockOnly: req.query.inStockOnly === '1' || req.query.inStockOnly === 'true',
      limit: req.query.limit,
      excludeOperationId: req.query.excludeOperationId || null,
    });
    // Marge actuelle affichée dès le sélecteur (aide au choix des produits).
    const vatRate = num(req.query.vatRate) ?? 20;
    const data = rows.map((r) => computeLine(
      { ...r, discount_percent: 0, promo_price: null },
      { vatRate, basePriceMode: 'price' }
    ));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Erreur searchProducts (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.listBrands = async (req, res) => {
  try {
    res.json({ success: true, data: await promoModel.listBrands() });
  } catch (error) {
    console.error('Erreur listBrands (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

exports.listCategories = async (req, res) => {
  try {
    res.json({ success: true, data: await promoModel.listCategories() });
  } catch (error) {
    console.error('Erreur listCategories (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── Analyse avant / pendant ────────────────────────────────── */

/**
 * GET /api/promos/:id/analysis
 * Query : ?from&to (bornes de la période promo, sinon dates de l'opération)
 *         &compare=previous|last_year (période de référence)
 *
 * Compare les ventes des produits de l'opération pendant la promo et sur une
 * période de référence de MÊME DURÉE (jour pour jour), afin de dire si l'opé
 * a fonctionné : volume, CA, marge, nombre de commandes, panier moyen.
 */
exports.getAnalysis = async (req, res) => {
  try {
    const op = await promoModel.getOperation(req.params.id);
    if (!op) return res.status(404).json({ success: false, error: 'Opération introuvable' });

    const items = await promoModel.listItems(op.id);
    if (items.length === 0) {
      return res.json({ success: true, data: { operation: op, rows: [], empty: true } });
    }

    // Bornes de la période analysée. Une opé encore en cours est bornée à aujourd'hui
    // (inclus) : comparer une semaine entamée à une semaine complète n'aurait pas de sens.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = parseYmd(req.query.from) || parseYmd(op.start_date) || addDays(today, -30);
    let endExcl = addDays(parseYmd(req.query.to) || parseYmd(op.end_date) || today, 1);
    const tomorrow = addDays(today, 1);
    if (endExcl > tomorrow) endExcl = tomorrow;
    if (endExcl <= start) endExcl = addDays(start, 1);

    const days = dayDiff(start, endExcl);

    // Période de référence, de durée identique.
    const compare = req.query.compare === 'last_year' ? 'last_year' : 'previous';
    let refStart, refEndExcl;
    if (compare === 'last_year') {
      refStart = new Date(start); refStart.setFullYear(refStart.getFullYear() - 1);
      refEndExcl = addDays(refStart, days);
    } else {
      refEndExcl = new Date(start);
      refStart = addDays(refEndExcl, -days);
    }

    const wpIds = items.map((i) => Number(i.wp_product_id));
    const [cur, ref, curOrders, refOrders, series] = await Promise.all([
      promoModel.periodStats(wpIds, ymd(start), ymd(endExcl)),
      promoModel.periodStats(wpIds, ymd(refStart), ymd(refEndExcl)),
      promoModel.periodOrderStats(wpIds, ymd(start), ymd(endExcl)),
      promoModel.periodOrderStats(wpIds, ymd(refStart), ymd(refEndExcl)),
      promoModel.dailySeries(wpIds, ymd(refStart), ymd(endExcl)),
    ]);

    const byId = (rows) => new Map(rows.map((r) => [String(r.wp_id), r]));
    const curMap = byId(cur);
    const refMap = byId(ref);

    const empty = { qty_total: 0, qty_direct: 0, ca_ht: 0, ca_ttc: 0, cost_ht: 0, orders_count: 0 };
    const shape = (r) => {
      const s = r || empty;
      const caHt = num(s.ca_ht) || 0;
      const costHt = num(s.cost_ht) || 0;
      return {
        qty: s.qty_total || 0,
        qty_direct: s.qty_direct || 0,
        ca_ht: round2(caHt),
        ca_ttc: round2(num(s.ca_ttc) || 0),
        cost_ht: round2(costHt),
        margin_ht: round2(caHt - costHt),
        margin_pct: caHt > 0 ? round2(((caHt - costHt) / caHt) * 100) : null,
        orders: s.orders_count || 0,
        // Prix de vente moyen réellement encaissé (TTC) : dit si la remise a bien été appliquée.
        avg_price_ttc: s.qty_direct > 0 ? round2((num(s.ca_ttc) || 0) / s.qty_direct) : null,
      };
    };
    const delta = (a, b) => round2((a || 0) - (b || 0));
    const pctDelta = (a, b) => (b ? round2((((a || 0) - b) / b) * 100) : (a ? null : 0));

    const opts = { vatRate: op.vat_rate, basePriceMode: op.base_price_mode };
    const rows = items.map((it) => {
      const line = computeLine(it, opts);
      const current = shape(curMap.get(String(it.wp_product_id)));
      const reference = shape(refMap.get(String(it.wp_product_id)));
      return {
        item_id: it.id,
        wp_product_id: it.wp_product_id,
        sku: line.sku,
        display_name: line.display_name,
        stock: line.stock,
        discount_percent: line.effective_discount_percent,
        promo_price_ttc: line.promo_price_ttc,
        promo_margin_pct: line.promo_margin_pct,
        current, reference,
        deltas: {
          qty: delta(current.qty, reference.qty),
          qty_pct: pctDelta(current.qty, reference.qty),
          ca_ht: delta(current.ca_ht, reference.ca_ht),
          ca_ht_pct: pctDelta(current.ca_ht, reference.ca_ht),
          margin_ht: delta(current.margin_ht, reference.margin_ht),
          margin_ht_pct: pctDelta(current.margin_ht, reference.margin_ht),
          orders: delta(current.orders, reference.orders),
        },
      };
    });

    const sum = (arr, path) => arr.reduce((s, r) => s + (path(r) || 0), 0);
    const totalsFor = (key) => {
      const caHt = round2(sum(rows, (r) => r[key].ca_ht));
      const costHt = round2(sum(rows, (r) => r[key].cost_ht));
      return {
        qty: sum(rows, (r) => r[key].qty),
        qty_direct: sum(rows, (r) => r[key].qty_direct),
        ca_ht: caHt,
        ca_ttc: round2(sum(rows, (r) => r[key].ca_ttc)),
        cost_ht: costHt,
        margin_ht: round2(caHt - costHt),
        margin_pct: caHt > 0 ? round2(((caHt - costHt) / caHt) * 100) : null,
      };
    };

    const curTot = totalsFor('current');
    const refTot = totalsFor('reference');

    res.json({
      success: true,
      data: {
        operation: op,
        period: { from: ymd(start), to: ymd(addDays(endExcl, -1)), days },
        reference_period: { from: ymd(refStart), to: ymd(addDays(refEndExcl, -1)), days, mode: compare },
        totals: {
          current: { ...curTot, orders: curOrders.orders_count, avg_basket_ttc: round2(num(curOrders.avg_basket_ttc)),
                     shop_orders: curOrders.all_orders_count, shop_ca_ttc: round2(num(curOrders.all_orders_total_ttc)) },
          reference: { ...refTot, orders: refOrders.orders_count, avg_basket_ttc: round2(num(refOrders.avg_basket_ttc)),
                       shop_orders: refOrders.all_orders_count, shop_ca_ttc: round2(num(refOrders.all_orders_total_ttc)) },
          deltas: {
            qty: delta(curTot.qty, refTot.qty),
            qty_pct: pctDelta(curTot.qty, refTot.qty),
            ca_ht: delta(curTot.ca_ht, refTot.ca_ht),
            ca_ht_pct: pctDelta(curTot.ca_ht, refTot.ca_ht),
            margin_ht: delta(curTot.margin_ht, refTot.margin_ht),
            margin_ht_pct: pctDelta(curTot.margin_ht, refTot.margin_ht),
            orders: delta(curOrders.orders_count, refOrders.orders_count),
            orders_pct: pctDelta(curOrders.orders_count, refOrders.orders_count),
            avg_basket_pct: pctDelta(num(curOrders.avg_basket_ttc), num(refOrders.avg_basket_ttc)),
            // Effet relatif : la promo a-t-elle fait mieux que la tendance globale du shop ?
            shop_ca_pct: pctDelta(num(curOrders.all_orders_total_ttc), num(refOrders.all_orders_total_ttc)),
          },
        },
        rows,
        series,
      },
    });
  } catch (error) {
    console.error('Erreur getAnalysis (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};

/* ─── Export CSV (partage équipe) ────────────────────────────── */

exports.exportCsv = async (req, res) => {
  try {
    const op = await promoModel.getOperation(req.params.id);
    if (!op) return res.status(404).json({ success: false, error: 'Opération introuvable' });

    const opts = { vatRate: op.vat_rate, basePriceMode: op.base_price_mode };
    const items = (await promoModel.listItems(op.id)).map((it) => computeLine(it, opts));

    const header = ['SKU', 'Produit', 'Stock', 'Ventes 30j', 'Prix achat HT', 'Prix sans remise TTC',
      'Prix vente TTC', 'Tarif remisé TTC', 'Remise %', 'Prix promo TTC', 'Prix promo HT',
      'Remise totale %', 'Marge actuelle €', 'Marge actuelle %', 'Marge promo €', 'Marge promo %', 'Note'];
    const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[;\r\n]/g, ' '));
    const nb = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

    const lines = [header.join(';')];
    for (const it of items) {
      lines.push([
        esc(it.sku), esc(it.display_name), it.stock, it.sales_30d,
        nb(it.cost_price), nb(it.undiscounted_price), nb(it.price), nb(it.discounted_price),
        nb(it.effective_discount_percent), nb(it.promo_price_ttc), nb(it.promo_price_ht),
        nb(it.total_discount_percent), nb(it.current_margin_eur), nb(it.current_margin_pct),
        nb(it.promo_margin_eur), nb(it.promo_margin_pct), esc(it.note),
      ].join(';'));
    }

    const slug = String(op.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="promo-${slug}.csv"`);
    res.send('﻿' + lines.join('\n'));
  } catch (error) {
    console.error('Erreur exportCsv (promos):', error);
    res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
  }
};
