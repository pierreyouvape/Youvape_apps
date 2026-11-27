/**
 * Sous-catégorie caisse (10 ml, 50 ml, Salt, 30 ml…) des fiches CRÉÉES par l'app
 * sans sous-catégorie : jusqu'au 27/11/2026, la création n'en envoyait aucune
 * (~850 liquides rangés dans « E-LIQUIDES » seul, ~185 arômes dans « AROMES »).
 *
 *   node src/scripts/backfillNextoreSubcategories.js           → simulation (rien n'est écrit)
 *   node src/scripts/backfillNextoreSubcategories.js --apply   → écrit dans Nextore (PUT /products, subcategory_id seul)
 *
 * Règle : catalogSyncRules.pickSubcategory (la même qu'à la création).
 * Rejouable : ne touche que les fiches encore sans sous-catégorie. Une fiche
 * reclassée à la main dans Nextore entre-temps n'est pas touchée (miroir relu à :30).
 */

require('dotenv').config();
const pool = require('../config/database');
const nextoreApi = require('../services/nextoreApiClient');
const { pickSubcategory } = require('../services/catalogSyncRules');

const apply = process.argv.includes('--apply');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { rows: subcategories } = await pool.query('SELECT id, category_id, name FROM nextore_subcategories');
  const subName = new Map(subcategories.map((s) => [String(s.id), s.name]));
  const { rows } = await pool.query(`
    SELECT l.nx_product_id, np.name AS nx_name, np.category_id, c.name AS category_name,
           p.post_title AS name, COALESCE(NULLIF(p.sub_category, ''), pp.sub_category) AS sub
      FROM boutique_site_links l
      JOIN nextore_products np ON np.product_id = l.nx_product_id AND COALESCE(np.status, '') <> 'deleted'
      JOIN nextore_categories c ON c.id = np.category_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
     WHERE l.source = 'created' AND COALESCE(NULLIF(np.subcategory_id, 'None'), '') = ''`);

  const plan = rows.map((r) => ({
    ...r,
    subcategory_id: pickSubcategory(r, { categoryId: r.category_id, categoryName: r.category_name, nxName: r.nx_name }, subcategories),
  }));
  const todo = plan.filter((r) => r.subcategory_id);
  const tally = {};
  for (const r of todo) {
    const k = `${r.category_name} › ${subName.get(r.subcategory_id)}`;
    tally[k] = (tally[k] || 0) + 1;
  }
  console.log(`${rows.length} fiches créées sans sous-catégorie, ${todo.length} à classer :`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  const left = plan.filter((r) => !r.subcategory_id);
  const leftByCat = {};
  for (const r of left) leftByCat[r.category_name] = (leftByCat[r.category_name] || 0) + 1;
  console.log(`Laissées sans sous-catégorie : ${left.length} (${Object.entries(leftByCat).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  for (const r of left.filter((x) => ['E-LIQUIDES', 'AROMES'].includes(x.category_name)).slice(0, 10)) {
    console.log(`    ${r.nx_name}`);
  }
  if (!apply) {
    console.log('Simulation : rien n\'est écrit (--apply pour écrire).');
    await pool.end();
    return;
  }
  let done = 0;
  const errors = [];
  for (const r of todo) {
    try {
      await nextoreApi.updateProduct(r.nx_product_id, { subcategory_id: r.subcategory_id });
      await pool.query('UPDATE nextore_products SET subcategory_id = $2 WHERE product_id = $1', [r.nx_product_id, r.subcategory_id]);
      done += 1;
      if (done % 200 === 0) console.log(`${done}/${todo.length}`);
    } catch (error) {
      errors.push(`${r.nx_product_id} ${r.nx_name} : ${error.message}`);
      if (/HTTP 429/.test(error.message)) await sleep(60000);
    }
    await sleep(250);
  }
  console.log(`Écrit : ${done}/${todo.length}${errors.length ? ` — ${errors.length} erreur(s) : ${errors.slice(0, 5).join(' | ')}` : ''}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
