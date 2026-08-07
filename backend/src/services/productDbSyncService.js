/**
 * Product DB Sync Service
 * Resynchronise post_status / stock_status / stock / manage_stock depuis
 * l'API REST WooCommerce de production (www.youvape.fr) vers la table
 * Postgres `products`.
 *
 * Les webhooks YouSync couvrent la plupart des changements en temps reel,
 * mais certaines operations (edition groupee WC, ATUM bulk edit) ne
 * declenchent pas toujours de webhook par produit. Ce job de rattrapage
 * tourne chaque nuit pour combler les ecarts residuels.
 *
 * NB: le switch ATUM "Suivi de stock" (atum_controlled) n'est pas expose
 * par l'API REST WooCommerce et n'est donc pas resynchronise ici.
 */

const axios = require('axios');
const pool = require('../config/database');

const PER_PAGE = 100;
const REQUEST_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Le prix remise (Woo Discount Rules) n'est pas expose par l'API REST WC standard.
// Un mu-plugin cote prod ajoute le champ `wdr_discounted_price` a la reponse produit/variation.
// Tant qu'il n'est pas deploye, le champ est absent -> discounted_price reste NULL (colonne vide).
const parseDiscounted = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const getWcCredentials = async () => {
  const result = await pool.query('SELECT consumer_key, consumer_secret, woocommerce_url FROM rewards_config LIMIT 1');
  if (result.rows.length === 0) throw new Error('Credentials WC non trouvees dans rewards_config');
  const row = result.rows[0];
  const urlResult = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const wcUrl = urlResult.rows[0]?.config_value || row.woocommerce_url;
  return {
    url: wcUrl.replace(/\/$/, ''),
    consumerKey: row.consumer_key,
    consumerSecret: row.consumer_secret,
  };
};

const fetchAllProducts = async (creds) => {
  const all = [];
  let page = 1;
  while (true) {
    const res = await axios.get(`${creds.url}/wp-json/wc/v3/products`, {
      params: {
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
        per_page: PER_PAGE,
        page,
        status: 'any',
        orderby: 'id',
        order: 'asc',
      },
      timeout: 60000,
    });
    all.push(...res.data);
    const totalPages = parseInt(res.headers['x-wp-totalpages']) || 1;
    if (page >= totalPages) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
};

const fetchVariations = async (creds, productId) => {
  const all = [];
  let page = 1;
  while (true) {
    const res = await axios.get(`${creds.url}/wp-json/wc/v3/products/${productId}/variations`, {
      params: {
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
        per_page: PER_PAGE,
        page,
        status: 'any',
      },
      timeout: 60000,
    });
    all.push(...res.data);
    const totalPages = parseInt(res.headers['x-wp-totalpages']) || 1;
    if (page >= totalPages) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
};

const runProductDbSync = async () => {
  const startTime = Date.now();
  const creds = await getWcCredentials();

  const products = await fetchAllProducts(creds);

  // Extrait le COG (_wc_cog_cost) depuis les meta_data WC. Renvoie null si absent
  // ou <= 0 → on ne veut JAMAIS écraser un COG existant par NULL (cf. COALESCE ci-dessous).
  const getCog = (obj) => {
    const m = (obj.meta_data || []).find((x) => x.key === '_wc_cog_cost');
    const v = m ? parseFloat(m.value) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  // Composition d'un bundle woosb depuis WC (meta woosb_ids = objet {clé:{id,qty}}).
  // Normalisé au format tableau [{id,qty}] stocké en base. Null si absent → COALESCE
  // ne l'écrasera pas (certains sync ne portent pas la meta).
  const getWoosb = (obj) => {
    if (obj.type !== 'woosb') return null;
    const m = (obj.meta_data || []).find((x) => x.key === 'woosb_ids');
    if (!m || !m.value) return null;
    let arr = [];
    if (typeof m.value === 'object') {
      // Format objet WC : {clé:{id,qty}}
      arr = Object.values(m.value).map((it) => ({ id: String(it.id), qty: String(it.qty || '1') }));
    } else if (typeof m.value === 'string') {
      // Format chaîne legacy : "id/qty,id/qty"
      arr = m.value.split(',').map((s) => {
        const [id, qty] = s.split('/');
        return { id: String(id || '').trim(), qty: String(qty || '1').trim() };
      });
    }
    arr = arr.filter((x) => /^\d+$/.test(x.id));
    return arr.length ? JSON.stringify(arr) : null;
  };

  const liveRows = [];
  const errors = [];
  // Parents dont le fetch des variations a echoue : leurs variations sont absentes de
  // liveRows sans etre supprimees dans WC. Elles doivent etre exclues de la detection
  // des fiches fantomes, sinon on neutraliserait du stock bien reel.
  const failedParents = [];

  for (const p of products) {
    liveRows.push({
      wp_product_id: p.id,
      post_status: p.status,
      stock_status: p.stock_status || 'outofstock',
      stock: p.stock_quantity === null || p.stock_quantity === undefined ? 0 : Number(p.stock_quantity),
      manage_stock: !!p.manage_stock,
      discounted_price: parseDiscounted(p.wdr_discounted_price),
      wc_cog_cost: getCog(p),
      woosb_ids: getWoosb(p),
    });

    if (p.type === 'variable') {
      try {
        const variations = await fetchVariations(creds, p.id);
        for (const v of variations) {
          liveRows.push({
            wp_product_id: v.id,
            post_status: v.status,
            stock_status: v.stock_status || 'outofstock',
            stock: v.stock_quantity === null || v.stock_quantity === undefined ? 0 : Number(v.stock_quantity),
            manage_stock: !!v.manage_stock,
            discounted_price: parseDiscounted(v.wdr_discounted_price),
            wc_cog_cost: getCog(v),
          });
        }
      } catch (err) {
        errors.push({ wp_product_id: p.id, error: err.message });
        failedParents.push(p.id);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const client = await pool.connect();
  let result = { statusUpdated: 0, variableUpdated: 0, ghosts: [] };
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE live_wc_products (
        wp_product_id bigint PRIMARY KEY,
        live_post_status text,
        live_stock_status text,
        live_stock numeric,
        live_manage_stock boolean,
        live_discounted_price numeric,
        live_wc_cog_cost numeric,
        live_woosb_ids text
      ) ON COMMIT DROP
    `);

    const CHUNK = 500;
    for (let i = 0; i < liveRows.length; i += CHUNK) {
      const chunk = liveRows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      chunk.forEach((r, idx) => {
        const base = idx * 8;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`);
        params.push(r.wp_product_id, r.post_status, r.stock_status, r.stock, r.manage_stock, r.discounted_price, r.wc_cog_cost, r.woosb_ids ?? null);
      });
      await client.query(
        `INSERT INTO live_wc_products (wp_product_id, live_post_status, live_stock_status, live_stock, live_manage_stock, live_discounted_price, live_wc_cog_cost, live_woosb_ids) VALUES ${values.join(',')}`,
        params
      );
    }

    // 1) post_status / stock_status / stock / manage_stock / discounted_price pour simples, variations et woosb
    // wc_cog_cost : COALESCE → on ne remplace que si WC renvoie une valeur (jamais
    // écraser un COG existant par NULL, ex. si un sync partiel ne l'a pas). Corrige
    // aussi les produits créés par le sync webhook sans COG (bug : COG resté NULL).
    const r1 = await client.query(`
      UPDATE products p
      SET post_status = l.live_post_status,
          stock_status = l.live_stock_status,
          stock = l.live_stock,
          manage_stock = l.live_manage_stock,
          discounted_price = l.live_discounted_price,
          wc_cog_cost = COALESCE(l.live_wc_cog_cost, p.wc_cog_cost),
          woosb_ids = COALESCE(l.live_woosb_ids::jsonb, p.woosb_ids),
          updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type IN ('simple', 'variation', 'woosb')
        AND (p.post_status IS DISTINCT FROM l.live_post_status
             OR p.stock_status IS DISTINCT FROM l.live_stock_status
             OR p.stock IS DISTINCT FROM l.live_stock
             OR p.manage_stock IS DISTINCT FROM l.live_manage_stock
             OR p.discounted_price IS DISTINCT FROM l.live_discounted_price
             OR (l.live_wc_cog_cost IS NOT NULL AND p.wc_cog_cost IS DISTINCT FROM l.live_wc_cog_cost)
             OR (l.live_woosb_ids IS NOT NULL AND p.woosb_ids IS DISTINCT FROM l.live_woosb_ids::jsonb))
    `);

    // 2) post_status + COG pour les parents variable (le COG vit souvent sur le parent)
    const r2 = await client.query(`
      UPDATE products p
      SET post_status = l.live_post_status,
          wc_cog_cost = COALESCE(l.live_wc_cog_cost, p.wc_cog_cost),
          updated_at = NOW()
      FROM live_wc_products l
      WHERE l.wp_product_id = p.wp_product_id
        AND p.product_type = 'variable'
        AND (p.post_status IS DISTINCT FROM l.live_post_status
             OR (l.live_wc_cog_cost IS NOT NULL AND p.wc_cog_cost IS DISTINCT FROM l.live_wc_cog_cost))
    `);

    // 3) Fiches fantomes : lignes locales avec du stock alors que le produit n'existe
    // plus dans WooCommerce (supprime avant l'arrivee du hook de suppression YouSync,
    // ou event de suppression jamais arrive). On neutralise le stock sans supprimer la
    // ligne : elle peut etre referencee par purchase_order_items (FK sans CASCADE).
    // Deux garde-fous : si le catalogue live est anormalement petit (reponse WC
    // tronquee) ou si des variations n'ont pas pu etre lues, on ne touche a rien.
    const dbCountRes = await client.query('SELECT COUNT(*)::int AS db_count FROM products');
    const dbCount = dbCountRes.rows[0].db_count;

    let ghosts = [];
    if (liveRows.length >= dbCount * 0.8) {
      const r3 = await client.query(`
        WITH ghosts AS (
          SELECT p.id, p.wp_product_id, p.sku, p.post_title, p.product_type,
                 p.post_status, p.stock AS old_stock
          FROM products p
          WHERE p.stock > 0
            AND NOT EXISTS (SELECT 1 FROM live_wc_products l WHERE l.wp_product_id = p.wp_product_id)
            AND (p.wp_parent_id IS NULL OR NOT (p.wp_parent_id = ANY($1::bigint[])))
        ), upd AS (
          UPDATE products p
          SET stock = 0, stock_status = 'outofstock', track_stock = false, updated_at = NOW()
          FROM ghosts g
          WHERE p.id = g.id
          RETURNING p.id
        )
        SELECT wp_product_id, sku, post_title, product_type, post_status, old_stock
        FROM ghosts ORDER BY old_stock DESC
      `, [failedParents]);
      ghosts = r3.rows;
    } else {
      errors.push({
        wp_product_id: null,
        error: `Detection fiches fantomes ignoree: ${liveRows.length} produits live pour ${dbCount} en base`,
      });
    }

    await client.query('COMMIT');

    result = { statusUpdated: r1.rowCount, variableUpdated: r2.rowCount, ghosts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const elapsed = Date.now() - startTime;
  return { ...result, totalRows: liveRows.length, errors, elapsed };
};

module.exports = { runProductDbSync };
