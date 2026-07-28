/**
 * Veille concurrentielle — relève le prix de chaque produit suivi chez chaque
 * concurrent, enregistre l'historique, détecte les changements de prix et
 * envoie un email récapitulatif (uniquement s'il y a du nouveau).
 */
const appConfigModel = require('../models/appConfigModel');
const competitorModel = require('../models/competitorModel');
const { fetchPage } = require('./competitorFetchService');
const { parsePrice } = require('../parsers/competitorPriceParser');
const { sendMail } = require('./alertService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtEur = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(2)} €`);

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - ignore le flag competitor_monitor_enabled (run manuel)
 * @param {boolean} [opts.notify=true] - envoyer l'email récap
 */
async function runMonitor({ force = false, notify = true } = {}) {
  const enabledCfg = await appConfigModel.get('competitor_monitor_enabled');
  if (!force && enabledCfg?.config_value === 'false') {
    console.log('[Veille] Désactivée (competitor_monitor_enabled=false)');
    return { skipped: true };
  }

  const products = await competitorModel.listProducts({ activeOnly: true });
  console.log(`[Veille] Démarrage : ${products.length} suivi(s) actif(s)`);

  const changes = [];   // { ...product, oldPrice, newPrice }
  const errors = [];    // { ...product, error }
  let okCount = 0;

  for (const product of products) {
    try {
      const prev = await competitorModel.getLastOkPrice(product.id);
      const res = await fetchPage(product.url);

      if (res.blocked || !res.html) {
        const msg = res.error || `Page inaccessible (HTTP ${res.status})`;
        await competitorModel.insertPrice({
          competitor_product_id: product.id,
          status: 'error',
          error_message: msg,
          source: res.source,
        });
        errors.push({ ...product, error: msg });
        continue;
      }

      const parsed = parsePrice(res.html);
      if (parsed.price === null) {
        const msg = 'Prix introuvable dans la page (parser à vérifier)';
        await competitorModel.insertPrice({
          competitor_product_id: product.id,
          status: 'error',
          error_message: msg,
          source: res.source,
        });
        errors.push({ ...product, error: msg });
        continue;
      }

      await competitorModel.insertPrice({
        competitor_product_id: product.id,
        price: parsed.price,
        regular_price: parsed.regular_price,
        in_stock: parsed.in_stock,
        currency: parsed.currency,
        status: 'ok',
        source: res.source,
      });
      okCount++;

      // Détection de changement de prix vs dernier relevé OK
      if (prev && prev.price !== null && Number(prev.price) !== Number(parsed.price)) {
        changes.push({ ...product, oldPrice: Number(prev.price), newPrice: parsed.price });
      }
    } catch (err) {
      console.error(`[Veille] Erreur sur suivi #${product.id} (${product.competitor}):`, err.message);
      errors.push({ ...product, error: err.message });
    }

    await sleep(1500); // politesse : ~1 requête / 1,5 s
  }

  console.log(`[Veille] Terminé : ${okCount} OK, ${changes.length} changement(s), ${errors.length} erreur(s)`);

  if (notify && (changes.length > 0 || errors.length > 0)) {
    await sendRecapEmail(changes, errors);
  }

  return { total: products.length, ok: okCount, changes, errors };
}

async function sendRecapEmail(changes, errors) {
  const toCfg = await appConfigModel.get('competitor_alert_email');
  const to = toCfg?.config_value?.trim();
  if (!to) {
    console.log('[Veille] Aucun destinataire (competitor_alert_email vide), email non envoyé');
    return;
  }

  const lines = [];
  lines.push('Bonjour,');
  lines.push('');

  if (changes.length) {
    lines.push(`💶 ${changes.length} changement(s) de prix concurrent détecté(s) :`);
    lines.push('');
    for (const c of changes) {
      const arrow = c.newPrice > c.oldPrice ? '▲ hausse' : '▼ baisse';
      const delta = (c.newPrice - c.oldPrice).toFixed(2);
      lines.push(`• ${c.product_name || c.sku} — ${c.competitor}`);
      lines.push(`    ${fmtEur(c.oldPrice)} → ${fmtEur(c.newPrice)}  (${arrow} ${delta} €)`);
      lines.push(`    ${c.url}`);
      lines.push('');
    }
  } else {
    lines.push('Aucun changement de prix aujourd’hui.');
    lines.push('');
  }

  if (errors.length) {
    lines.push(`⚠️ ${errors.length} relevé(s) en échec (à surveiller) :`);
    lines.push('');
    for (const e of errors) {
      lines.push(`• ${e.product_name || e.sku} — ${e.competitor} : ${e.error}`);
    }
    lines.push('');
  }

  lines.push('— Veille concurrentielle Youvape');

  const subject = changes.length
    ? `Veille concurrents : ${changes.length} changement(s) de prix`
    : `Veille concurrents : ${errors.length} relevé(s) en échec`;

  const res = await sendMail({ to, subject, text: lines.join('\n') });
  if (res.success) console.log('[Veille] Email récap envoyé →', to);
  else console.error('[Veille] Échec envoi email récap:', res.error);
}

// ─── État de run partagé (pour lancement asynchrone / suivi de progression) ──
let runState = { running: false, startedAt: null, finishedAt: null, result: null, error: null };

const getRunState = () => runState;

/**
 * Lance le relevé en arrière-plan et retourne immédiatement (évite les
 * timeouts de passerelle 524 sur les gros relevés via ScraperAPI).
 */
function startMonitorAsync(opts = {}) {
  if (runState.running) return { alreadyRunning: true, startedAt: runState.startedAt };
  runState = { running: true, startedAt: Date.now(), finishedAt: null, result: null, error: null };
  runMonitor(opts)
    .then((r) => {
      runState = {
        running: false, startedAt: runState.startedAt, finishedAt: Date.now(),
        result: { total: r.total, ok: r.ok, changes: r.changes ? r.changes.length : 0, errors: r.errors || [] },
        error: null,
      };
    })
    .catch((e) => {
      runState = { running: false, startedAt: runState.startedAt, finishedAt: Date.now(), result: null, error: e.message };
    });
  return { started: true, startedAt: runState.startedAt };
}

module.exports = { runMonitor, startMonitorAsync, getRunState };
