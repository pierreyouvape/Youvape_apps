/**
 * Stock Resync Service
 * Re-synchronise les stocks depuis l'API WooCommerce vers la BDD locale.
 * One-shot programme : se lance a la date configuree, envoie un mail de debut,
 * parcourt toutes les pages de produits (100/page, pause 3min entre chaque),
 * puis envoie un mail de fin avec CSV en PJ.
 */

const axios = require('axios');
const pool = require('../config/database');
const { sendAlert, sendAlertWithAttachments } = require('./alertService');

const PER_PAGE = 100;
const PAUSE_MS = 3 * 60 * 1000; // 3 minutes entre chaque page

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Recuperer les credentials WC depuis la BDD
 */
const getWcCredentials = async () => {
  const result = await pool.query('SELECT consumer_key, consumer_secret, woocommerce_url FROM rewards_config LIMIT 1');
  if (result.rows.length === 0) throw new Error('Credentials WC non trouvees dans rewards_config');
  const row = result.rows[0];
  // Utiliser wc_sync_wp_url depuis app_config (URL prod)
  const urlResult = await pool.query("SELECT config_value FROM app_config WHERE config_key = 'wc_sync_wp_url'");
  const wcUrl = urlResult.rows[0]?.config_value || row.woocommerce_url;
  return {
    url: wcUrl.replace(/\/$/, ''),
    consumerKey: row.consumer_key,
    consumerSecret: row.consumer_secret
  };
};

/**
 * Recuperer une page de produits depuis l'API WC
 * Retourne les produits simples/variables avec stock + leurs variations
 */
const fetchProductPage = async (creds, page) => {
  const response = await axios.get(`${creds.url}/wp-json/wc/v3/products`, {
    params: {
      consumer_key: creds.consumerKey,
      consumer_secret: creds.consumerSecret,
      per_page: PER_PAGE,
      page,
      orderby: 'id',
      order: 'asc'
    },
    timeout: 60000
  });

  const totalPages = parseInt(response.headers['x-wp-totalpages']) || 1;
  const totalProducts = parseInt(response.headers['x-wp-total']) || 0;

  return { products: response.data, totalPages, totalProducts };
};

/**
 * Recuperer les variations d'un produit variable
 */
const fetchVariations = async (creds, productId) => {
  const allVariations = [];
  let page = 1;

  while (true) {
    const response = await axios.get(`${creds.url}/wp-json/wc/v3/products/${productId}/variations`, {
      params: {
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
        per_page: 100,
        page
      },
      timeout: 60000
    });

    allVariations.push(...response.data);

    const totalPages = parseInt(response.headers['x-wp-totalpages']) || 1;
    if (page >= totalPages) break;
    page++;
  }

  return allVariations;
};

/**
 * Lancer le re-sync complet des stocks
 */
const runStockResync = async () => {
  console.log('[StockResync] Demarrage du re-sync des stocks...');

  const startTime = Date.now();
  const diffs = [];      // {sku, name, old_stock, new_stock, old_status, new_status, diff}
  const errors = [];     // {wp_product_id, sku, error}
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  try {
    const creds = await getWcCredentials();

    // Premiere page pour connaitre le total
    const firstPage = await fetchProductPage(creds, 1);
    const totalPages = firstPage.totalPages;
    const totalProducts = firstPage.totalProducts;

    console.log(`[StockResync] ${totalProducts} produits parents, ${totalPages} pages`);

    // Mail de debut
    await sendAlert(
      'Re-sync stocks: DEMARRE',
      `Le re-sync des stocks depuis WooCommerce a demarre.\n\n` +
      `- ${totalProducts} produits parents a traiter\n` +
      `- ${totalPages} pages de ${PER_PAGE}\n` +
      `- Pause de 3 min entre chaque page\n` +
      `- Duree estimee: ~${Math.round(totalPages * 3)} minutes\n\n` +
      `Un email de bilan sera envoye a la fin.`
    );

    // Traiter toutes les pages
    for (let page = 1; page <= totalPages; page++) {
      try {
        console.log(`[StockResync] Page ${page}/${totalPages}...`);

        const pageData = page === 1 ? firstPage : await fetchProductPage(creds, page);

        for (const product of pageData.products) {
          try {
            // Traiter le produit parent (simple ou variable)
            await syncProductStock(product, diffs, errors);
            totalProcessed++;

            // Si variable, recuperer et traiter les variations
            if (product.type === 'variable') {
              const variations = await fetchVariations(creds, product.id);
              for (const variation of variations) {
                try {
                  await syncVariationStock(variation, product, diffs, errors);
                  totalProcessed++;
                } catch (err) {
                  errors.push({
                    wp_product_id: variation.id,
                    sku: variation.sku || '',
                    error: err.message
                  });
                }
              }
            }
          } catch (err) {
            errors.push({
              wp_product_id: product.id,
              sku: product.sku || '',
              error: err.message
            });
          }
        }

        // Pause entre les pages (sauf derniere page)
        if (page < totalPages) {
          console.log(`[StockResync] Pause 3 min avant page ${page + 1}...`);
          await sleep(PAUSE_MS);
        }

      } catch (pageErr) {
        console.error(`[StockResync] Erreur page ${page}:`, pageErr.message);
        errors.push({
          wp_product_id: null,
          sku: `PAGE_${page}`,
          error: `Erreur fetch page ${page}: ${pageErr.message}`
        });

        // Pause avant de continuer a la page suivante
        if (page < totalPages) {
          await sleep(PAUSE_MS);
        }
      }
    }

    totalUpdated = diffs.length;
    totalSkipped = totalProcessed - totalUpdated;

    const elapsed = Math.round((Date.now() - startTime) / 1000 / 60);

    console.log(`[StockResync] Termine: ${totalProcessed} traites, ${totalUpdated} ecarts, ${errors.length} erreurs, ${elapsed} min`);

    // Generer les CSV
    const diffsCsv = generateDiffsCsv(diffs);
    const errorsCsv = errors.length > 0 ? generateErrorsCsv(errors) : null;

    // Mail de fin
    const attachments = [
      { filename: `stock_resync_ecarts_${formatDateFile()}.csv`, content: diffsCsv }
    ];
    if (errorsCsv) {
      attachments.push({ filename: `stock_resync_erreurs_${formatDateFile()}.csv`, content: errorsCsv });
    }

    await sendAlertWithAttachments(
      `Re-sync stocks: TERMINE (${totalUpdated} ecarts, ${errors.length} erreurs)`,
      `Le re-sync des stocks depuis WooCommerce est termine.\n\n` +
      `BILAN:\n` +
      `- Produits traites: ${totalProcessed}\n` +
      `- Ecarts corriges: ${totalUpdated}\n` +
      `- Produits inchanges: ${totalSkipped}\n` +
      `- Erreurs: ${errors.length}\n` +
      `- Duree: ${elapsed} minutes\n\n` +
      `Fichiers joints:\n` +
      `- stock_resync_ecarts_*.csv : detail des ecarts corriges (SKU, nom, ancien/nouveau stock)\n` +
      (errors.length > 0 ? `- stock_resync_erreurs_*.csv : detail des erreurs\n` : '') +
      `\nCe re-sync etait un one-shot. La config a ete supprimee.`,
      attachments
    );

    // Supprimer la config pour ne pas relancer
    await pool.query("DELETE FROM app_config WHERE config_key = 'stock_resync_scheduled_at'");
    console.log('[StockResync] Config stock_resync_scheduled_at supprimee (one-shot termine)');

  } catch (fatalErr) {
    console.error('[StockResync] Erreur fatale:', fatalErr.message);
    await sendAlert(
      'Re-sync stocks: ERREUR FATALE',
      `Le re-sync des stocks a echoue avec une erreur fatale.\n\n` +
      `Erreur: ${fatalErr.message}\n\n` +
      `${totalProcessed} produits avaient ete traites avant l'erreur.`
    );
  }
};

/**
 * Sync stock d'un produit simple/variable parent
 */
const syncProductStock = async (product, diffs, errors) => {
  const wcStock = product.stock_quantity;
  const wcStatus = product.stock_status || 'instock';

  // Lire le stock actuel en BDD
  const dbResult = await pool.query(
    'SELECT stock, stock_status, post_title FROM products WHERE wp_product_id = $1',
    [product.id]
  );

  if (dbResult.rows.length === 0) {
    // Produit pas en BDD — on ne l'insere pas, juste un skip
    return;
  }

  const dbRow = dbResult.rows[0];
  const dbStock = dbRow.stock !== null ? parseInt(dbRow.stock) : null;
  const dbStatus = dbRow.stock_status || '';

  // Comparer
  if (dbStock !== wcStock || dbStatus !== wcStatus) {
    await pool.query(
      'UPDATE products SET stock = $1, stock_status = $2, updated_at = NOW() WHERE wp_product_id = $3',
      [wcStock, wcStatus, product.id]
    );

    diffs.push({
      sku: product.sku || '',
      name: dbRow.post_title || product.name || '',
      old_stock: dbStock,
      new_stock: wcStock,
      old_status: dbStatus,
      new_status: wcStatus,
      diff: (wcStock || 0) - (dbStock || 0)
    });
  }
};

/**
 * Sync stock d'une variation
 */
const syncVariationStock = async (variation, parentProduct, diffs, errors) => {
  const wcStock = variation.stock_quantity;
  const wcStatus = variation.stock_status || 'instock';

  const dbResult = await pool.query(
    'SELECT stock, stock_status, post_title FROM products WHERE wp_product_id = $1',
    [variation.id]
  );

  if (dbResult.rows.length === 0) return;

  const dbRow = dbResult.rows[0];
  const dbStock = dbRow.stock !== null ? parseInt(dbRow.stock) : null;
  const dbStatus = dbRow.stock_status || '';

  if (dbStock !== wcStock || dbStatus !== wcStatus) {
    await pool.query(
      'UPDATE products SET stock = $1, stock_status = $2, updated_at = NOW() WHERE wp_product_id = $3',
      [wcStock, wcStatus, variation.id]
    );

    diffs.push({
      sku: variation.sku || '',
      name: dbRow.post_title || `${parentProduct.name} - Variation #${variation.id}`,
      old_stock: dbStock,
      new_stock: wcStock,
      old_status: dbStatus,
      new_status: wcStatus,
      diff: (wcStock || 0) - (dbStock || 0)
    });
  }
};

/**
 * Generer le CSV des ecarts
 */
const generateDiffsCsv = (diffs) => {
  const header = 'SKU;Nom produit;Ancien stock;Nouveau stock;Ancien statut;Nouveau statut;Ecart';
  const lines = diffs.map(d =>
    `${csvEscape(d.sku)};${csvEscape(d.name)};${d.old_stock ?? 'NULL'};${d.new_stock ?? 'NULL'};${d.old_status};${d.new_status};${d.diff >= 0 ? '+' : ''}${d.diff}`
  );
  return [header, ...lines].join('\n');
};

/**
 * Generer le CSV des erreurs
 */
const generateErrorsCsv = (errors) => {
  const header = 'WP Product ID;SKU;Erreur';
  const lines = errors.map(e =>
    `${e.wp_product_id || ''};${csvEscape(e.sku)};${csvEscape(e.error)}`
  );
  return [header, ...lines].join('\n');
};

/**
 * Echapper les valeurs CSV (point-virgule comme separateur)
 */
const csvEscape = (value) => {
  if (!value) return '';
  const str = String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Format date pour nom de fichier
 */
const formatDateFile = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

module.exports = { runStockResync };
