/**
 * Catalogue caisse : produits du site → Nextore (10/11/2026). Cron horaire.
 *
 * Quatre passes, chacune bridée (l'API Nextore n'a pas de quota documenté) :
 *  1. Nouveaux produits (1re réception ≥ `nextore_autocreate_since`), absents de
 *     la caisse : créés si aucune fiche caisse ne leur ressemble ET si la
 *     catégorie est sûre ; sinon liste à vérifier (doublon / categorie / sans_ean).
 *  2. Produits existants en stock, absents de la caisse : liste « absent » (rien de créé).
 *  3. Codes-barres du site absents de la fiche caisse liée : ajoutés (jamais retirés).
 *     Un code déjà porté par une AUTRE fiche caisse : liste « ean_conflit ».
 *  4. Prix : le prix normal du site (sans remise WDR) est envoyé quand il change.
 *     1re comparaison avec écart : liste « prix ». Résistances au pack : exclues.
 *
 * Paire (produit du site, fiche caisse) = lien enregistré, sinon UNE fiche par code-barres.
 */

const pool = require('../config/database');
const nextoreApi = require('./nextoreApiClient');
const prelevementModel = require('../models/prelevementModel');
const prelevementRules = require('./prelevementRules');
const rules = require('./catalogSyncRules');

const MAX_CREATES = 30;
const MAX_WRITES = 150;     // ajouts de codes-barres + prix, par passage
const PAUSE_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Code-barres porté par ce seul produit du site (cf. prelevementRules.uniqueSiteBarcodeSql).
const UNIQUE_B = prelevementRules.uniqueSiteBarcodeSql('b');
const SITE_SCOPE = `p.product_type IN ('simple', 'variation') AND p.wc_deleted_at IS NULL AND p.post_status = 'publish'`;
const SITE_COLS = `
  p.id, p.sku, p.post_title AS name, p.regular_price,
  COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
  COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand,
  COALESCE(NULLIF(p.category, ''), pp.category) AS cat,
  COALESCE(NULLIF(p.sub_category, ''), pp.sub_category) AS sub,
  ARRAY(SELECT b.barcode FROM product_barcodes b WHERE b.product_id = p.id AND b.type = 'unit' AND ${UNIQUE_B} ORDER BY b.id) AS barcodes`;
const PARENT_JOIN = `LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id`;
// Fiches caisse (non supprimées) qui portent un code-barres du produit.
const NX_BY_EAN = `ARRAY(SELECT DISTINCT nb.product_id FROM product_barcodes b
                           JOIN nextore_product_barcodes nb ON nb.barcode = b.barcode
                           JOIN nextore_products np ON np.product_id = nb.product_id AND COALESCE(np.status, '') <> 'deleted'
                          WHERE b.product_id = p.id AND ${UNIQUE_B})`;

// Simulation (run({ dryRun: true })) : on compte ce qui serait fait, rien n'est écrit.
let DRY = false;
let byReason = {};

const upsertReview = (productId, reason, { nxProductId = null, candidates = null, categoryId = null, detail = null } = {}) => {
  byReason[reason] = (byReason[reason] || 0) + 1;
  if (DRY) return Promise.resolve();
  return pool.query(
    // Ligne encore ouverte : suggestions recalculées (règles et catalogue caisse
    // évoluent). Ligne réglée ou ignorée : on n'y touche plus.
    `INSERT INTO boutique_catalog_reviews (product_id, reason, nx_product_id, candidates, suggested_category_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (product_id, reason) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id,
       candidates = EXCLUDED.candidates,
       -- Une catégorie choisie à la main (« Sans catégorie caisse ») n'est jamais effacée.
       suggested_category_id = COALESCE(EXCLUDED.suggested_category_id, boutique_catalog_reviews.suggested_category_id),
       detail = EXCLUDED.detail
     WHERE boutique_catalog_reviews.status = 'open'`,
    [productId, reason, nxProductId, candidates ? JSON.stringify(candidates) : null, categoryId, detail ? JSON.stringify(detail) : null]
  );
};

/** Catégorie caisse la plus fréquente par (catégorie, sous-catégorie) du site, sur les paires par code-barres. */
const categoryStats = async () => {
  const { rows } = await pool.query(`
    WITH pairs AS (
      SELECT DISTINCT p.id, COALESCE(NULLIF(p.category, ''), pp.category) AS cat,
             COALESCE(NULLIF(p.sub_category, ''), pp.sub_category) AS sub, np.category_id
        FROM products p ${PARENT_JOIN}
        JOIN product_barcodes b ON b.product_id = p.id
        JOIN nextore_product_barcodes nb ON nb.barcode = b.barcode
        JOIN nextore_products np ON np.product_id = nb.product_id AND np.category_id IS NOT NULL
       WHERE p.product_type IN ('simple', 'variation') AND ${UNIQUE_B}),
    agg AS (
      SELECT cat, sub, category_id AS nx_category_id, count(*) AS n,
             sum(count(*)) OVER (PARTITION BY cat, sub) AS tot,
             row_number() OVER (PARTITION BY cat, sub ORDER BY count(*) DESC) AS rk
        FROM pairs GROUP BY 1, 2, 3)
    SELECT cat, sub, nx_category_id, (SELECT name FROM nextore_categories WHERE id = nx_category_id) AS nx_category_name,
           n::int, tot::int FROM agg WHERE rk = 1`);
  return rows;
};

const loadNxCatalog = async () => {
  const { rows } = await pool.query(
    `SELECT product_id AS id, name, brand FROM nextore_products WHERE COALESCE(status, '') <> 'deleted'`
  );
  return rules.buildIndex(rows);
};

// ── 1 et 2 : produits absents de la caisse ──────────────────────────────────

const missingProducts = async () => {
  const { rows } = await pool.query(`
    SELECT ${SITE_COLS}, ${NX_BY_EAN} AS nx_ids,
           (SELECT min(COALESCE(po.received_date, po.order_date, po.created_at))
              FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
             WHERE poi.product_id = p.id AND poi.units_received > 0) AS first_received,
           COALESCE(p.stock, 0) AS stock
      FROM products p ${PARENT_JOIN}
     WHERE ${SITE_SCOPE}
       AND NOT EXISTS (SELECT 1 FROM boutique_site_links l WHERE l.product_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM boutique_catalog_reviews r
                        WHERE r.product_id = p.id AND r.status <> 'open'
                          AND r.reason IN ('doublon', 'categorie', 'sans_ean', 'ean_multiple', 'absent'))`);
  // Absent = aucune fiche caisse par code-barres (une seule = déjà une paire).
  return rows.filter((r) => r.nx_ids.length !== 1);
};

const syncMissing = async (since, stats, nxCatalog, report) => {
  const rows = await missingProducts();
  for (const r of rows) {
    const isNew = r.first_received && new Date(r.first_received) >= new Date(since);
    if (r.nx_ids.length > 1) {
      await upsertReview(r.id, 'ean_multiple', { candidates: r.nx_ids.map((id) => ({ id })) });
      report.reviews += 1;
      continue;
    }
    if (!isNew) {
      if (Number(r.stock) > 0) {
        const { categoryId } = rules.pickCategory(stats, r.cat, r.sub);
        await upsertReview(r.id, 'absent', { candidates: rules.closest(r, nxCatalog), categoryId });
        report.reviews += 1;
      }
      continue;
    }
    // Nouveau produit.
    if (!r.barcodes.length) {
      await upsertReview(r.id, 'sans_ean', { categoryId: rules.pickCategory(stats, r.cat, r.sub).categoryId });
      report.reviews += 1;
      continue;
    }
    const near = rules.closest(r, nxCatalog);
    // Doublon : une fiche caisse au nom identique (mêmes mots, hors marque).
    if (near.some((c) => c.same)) {
      await upsertReview(r.id, 'doublon', { candidates: near, categoryId: rules.pickCategory(stats, r.cat, r.sub).categoryId });
      report.reviews += 1;
      continue;
    }
    const cat = rules.pickCategory(stats, r.cat, r.sub);
    // Résistances : jamais créées seules (pack sur le site, unité en boutique).
    if (!cat.sure || rules.isResistance(r.name, cat.categoryName)) {
      await upsertReview(r.id, 'categorie', { candidates: near, categoryId: cat.categoryId });
      report.reviews += 1;
      continue;
    }
    if (!DRY && report.created >= MAX_CREATES) { report.deferred = true; continue; }
    try {
      if (!DRY) await prelevementModel.createInNextore(2, r.id, cat.categoryId, null);
      report.created += 1;
      report.createdList.push(`${r.name} (${r.sku})`);
      // La fiche neuve rejoint le catalogue comparé aux suivants de ce passage.
      nxCatalog.add({ id: `new-${r.id}`, name: r.name, brand: r.brand });
    } catch (error) {
      report.errors.push(`Création ${r.sku} : ${error.message}`);
    }
    if (!DRY) await sleep(PAUSE_MS);
  }
};

// ── 3 et 4 : codes-barres et prix des paires ────────────────────────────────

const pairs = async () => {
  const { rows } = await pool.query(`
    WITH base AS (
      SELECT ${SITE_COLS},
             COALESCE((SELECT l.nx_product_id FROM boutique_site_links l WHERE l.product_id = p.id),
                      CASE WHEN array_length(${NX_BY_EAN}, 1) = 1 THEN (${NX_BY_EAN})[1] END) AS nx_id
        FROM products p ${PARENT_JOIN}
       WHERE ${SITE_SCOPE})
    SELECT b.*, np.name AS nx_name, np.price AS nx_price, np.barcode AS nx_barcode, c.name AS category_name,
           s.price_pushed, s.price_locked, s.nx_product_id AS state_nx
      FROM base b
      JOIN nextore_products np ON np.product_id = b.nx_id AND COALESCE(np.status, '') <> 'deleted'
      LEFT JOIN nextore_categories c ON c.id = np.category_id
      LEFT JOIN boutique_nx_sync s ON s.product_id = b.id`);
  return rows;
};

const syncPairs = async (report) => {
  const rows = await pairs();
  const { rows: owners } = await pool.query('SELECT barcode, product_id FROM nextore_product_barcodes');
  const ownerOf = new Map();
  for (const o of owners) {
    if (!ownerOf.has(o.barcode)) ownerOf.set(o.barcode, new Set());
    ownerOf.get(o.barcode).add(o.product_id);
  }
  let writes = 0;

  for (const r of rows) {
    if (!DRY && writes >= MAX_WRITES) { report.deferred = true; break; }

    // 3. Codes-barres du site absents de la fiche caisse.
    const have = new Set(prelevementRules.splitBarcodes(r.nx_barcode));
    const missing = r.barcodes.filter((b) => !have.has(b));
    const conflicts = missing.filter((b) => [...(ownerOf.get(b) || [])].some((id) => id !== r.nx_id));
    const toAdd = missing.filter((b) => !conflicts.includes(b));
    if (conflicts.length) {
      await upsertReview(r.id, 'ean_conflit', {
        nxProductId: r.nx_id,
        detail: { barcodes: conflicts, owners: conflicts.map((b) => [...ownerOf.get(b)]) },
      });
      report.reviews += 1;
    }
    if (toAdd.length) {
      if (DRY) {
        report.barcodes += toAdd.length;
      } else {
        const res = await prelevementModel.addSiteBarcodesToNx(r.nx_id, toAdd);
        if (res.warning) report.errors.push(`${r.sku} : ${res.warning}`);
        else report.barcodes += res.added.length;
        await sleep(PAUSE_MS);
      }
      writes += 1;
    }

    // 4. Prix. Résistances au pack (1 article site = N pièces boutique) : pas comparables.
    if (prelevementRules.boutiqueQty(1, r.name, r) > 1) continue;
    // Fiche caisse changée depuis le dernier alignement : on recompare comme la 1re fois.
    const state = r.state_nx && r.state_nx !== r.nx_id ? null : (r.state_nx ? r : null);
    const decision = rules.priceDecision({ sitePrice: r.regular_price, nxPrice: r.nx_price, state });
    if (decision === 'same') {
      report.pricesSame += 1;
      if (!DRY) await savePrice(r.id, r.nx_id, r.regular_price);
    } else if (decision === 'review') {
      await upsertReview(r.id, 'prix', {
        nxProductId: r.nx_id,
        detail: { site: Number(r.regular_price), caisse: Number(r.nx_price), ecart_pct: rules.priceGapPct(r.regular_price, r.nx_price) },
      });
      report.reviews += 1;
    } else if (decision === 'push') {
      try {
        if (!DRY) await pushPrice(r.id, r.nx_id, r.regular_price);
        report.prices += 1;
      } catch (error) {
        report.errors.push(`Prix ${r.sku} : ${error.message}`);
      }
      writes += 1;
      if (!DRY) await sleep(PAUSE_MS);
    }
  }
};

const savePrice = (productId, nxId, price, locked = false) => pool.query(
  `INSERT INTO boutique_nx_sync (product_id, nx_product_id, price_pushed, price_locked) VALUES ($1, $2, $3, $4)
   ON CONFLICT (product_id) DO UPDATE SET nx_product_id = EXCLUDED.nx_product_id, price_pushed = EXCLUDED.price_pushed,
     price_locked = EXCLUDED.price_locked, updated_at = NOW()`,
  [productId, nxId, price, locked]
);

/**
 * Envoie le prix normal du site à la fiche caisse (seul champ envoyé : vérifié le
 * 10/11/2026). Un prix qui change = une étiquette à refaire dans chaque boutique.
 */
const pushPrice = async (productId, nxId, price, source = 'auto') => {
  const p = Math.round(Number(price) * 100) / 100;
  const { rows: [before] } = await pool.query('SELECT price FROM nextore_products WHERE product_id = $1', [nxId]);
  await nextoreApi.updateProduct(nxId, { price: p });
  await pool.query('UPDATE nextore_products SET price = $2 WHERE product_id = $1', [nxId, p]);
  await savePrice(productId, nxId, p);
  if (before?.price == null || Math.abs(Number(before.price) - p) >= 0.005) {
    await pool.query(
      `INSERT INTO boutique_price_labels (product_id, nx_product_id, old_price, new_price, source) VALUES ($1, $2, $3, $4, $5)`,
      [productId, nxId, before?.price ?? null, p, source]
    );
  }
};

// ── Passage complet ─────────────────────────────────────────────────────────

let running = false;

/**
 * Éteint tant que `app_config.nextore_autocreate_since` n'existe pas (posé
 * après validation de la simulation). `since` force la date pour une simulation.
 */
const run = async ({ dryRun = false, since = null } = {}) => {
  if (running) return { skipped: true };
  running = true;
  DRY = dryRun;
  byReason = {};
  const report = {
    dryRun, created: 0, createdList: [], barcodes: 0, prices: 0, pricesSame: 0, reviews: 0, errors: [], deferred: false,
  };
  report.byReason = byReason;
  try {
    const { rows: [cfg] } = await pool.query(
      `SELECT config_value FROM app_config WHERE config_key = 'nextore_autocreate_since'`
    );
    const start = since || cfg?.config_value;
    if (!start) return { ...report, disabled: true };
    const [stats, nxCatalog] = await Promise.all([categoryStats(), loadNxCatalog()]);
    await syncMissing(start, stats, nxCatalog, report);
    await syncPairs(report);
    return report;
  } finally {
    running = false;
    DRY = false;
  }
};

module.exports = { run, pushPrice, savePrice };
