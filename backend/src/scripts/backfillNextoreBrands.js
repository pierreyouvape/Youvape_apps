/**
 * Marque (champ Nextore cf1) sur les fiches caisse CRÉÉES par l'app sans marque
 * (création en masse du 10/11/2026 : 2 161 fiches sans marque).
 *
 *   node src/scripts/backfillNextoreBrands.js           → simulation (rien n'est écrit)
 *   node src/scripts/backfillNextoreBrands.js --apply   → écrit dans Nextore (PUT /products, cf1 seul)
 *
 * Orthographe d'une marque déjà présente dans Nextore reprise (catalogSyncRules.pickBrand).
 * Rejouable : ne touche que les fiches encore sans marque.
 */

require('dotenv').config();
const pool = require('../config/database');
const nextoreApi = require('../services/nextoreApiClient');
const { pickBrand } = require('../services/catalogSyncRules');

const apply = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { rows: brands } = await pool.query(
    `SELECT DISTINCT brand FROM nextore_products WHERE COALESCE(brand, '') <> '' AND COALESCE(status, '') <> 'deleted'`
  );
  const existing = brands.map((b) => b.brand);
  const { rows } = await pool.query(`
    SELECT l.nx_product_id, np.name,
           COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand, COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand
      FROM boutique_site_links l
      JOIN nextore_products np ON np.product_id = l.nx_product_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
     WHERE l.source = 'created' AND COALESCE(np.brand, '') = ''`);

  const plan = rows.map((r) => ({ ...r, cf1: pickBrand(r, existing) })).filter((r) => r.cf1);
  const known = new Set(existing);
  const reused = plan.filter((r) => known.has(r.cf1)).length;
  const fresh = [...new Set(plan.filter((r) => !known.has(r.cf1)).map((r) => r.cf1))];
  console.log(`${rows.length} fiches sans marque, ${plan.length} avec une marque à écrire`);
  console.log(`  ${reused} sur une marque déjà dans Nextore, ${plan.length - reused} sur ${fresh.length} marque(s) nouvelle(s) :`);
  console.log(`  ${fresh.slice(0, 60).join(', ')}${fresh.length > 60 ? '…' : ''}`);
  if (!apply) {
    console.log('Simulation : rien n\'est écrit (--apply pour écrire).');
    await pool.end();
    return;
  }
  let done = 0;
  const errors = [];
  for (const r of plan) {
    try {
      await nextoreApi.updateProduct(r.nx_product_id, { cf1: r.cf1 });
      await pool.query('UPDATE nextore_products SET brand = $2 WHERE product_id = $1', [r.nx_product_id, r.cf1]);
      done += 1;
      if (done % 200 === 0) console.log(`${done}/${plan.length}`);
    } catch (error) {
      errors.push(`${r.nx_product_id} ${r.name} : ${error.message}`);
      if (/HTTP 429/.test(error.message)) await sleep(60000);
    }
    await sleep(250);
  }
  console.log(`Écrit : ${done}/${plan.length}${errors.length ? ` — ${errors.length} erreur(s) : ${errors.slice(0, 5).join(' | ')}` : ''}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
