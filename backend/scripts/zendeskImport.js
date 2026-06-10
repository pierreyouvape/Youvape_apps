#!/usr/bin/env node
/**
 * Import Zendesk en one-shot, côté serveur — détaché du navigateur/SSE/Cloudflare.
 *
 * À lancer DANS le conteneur backend :
 *   docker exec -d youvape_backend node scripts/zendeskImport.js
 * (le -d détache : l'import survit à la fermeture de la session ssh)
 *
 * Suivi :  docker logs -f youvape_backend | grep "[zendesk-cli]"
 *
 * Idempotent : upsert ON CONFLICT (zendesk_id). Relancer reprend sans doublon.
 */
const zendeskModel = require('../src/models/zendeskModel');

(async () => {
  const t0 = Date.now();
  console.log('[zendesk-cli] démarrage import…');
  try {
    const cfg = await zendeskModel.getConfig();
    if (!cfg.subdomain || !cfg.email || !cfg.token) {
      console.error('[zendesk-cli] config Zendesk incomplète — abandon');
      process.exit(1);
    }

    let lastLog = 0;
    const onProgress = (p) => {
      const now = Date.now();
      // Log au plus toutes les 5s pour ne pas noyer les logs Docker
      if (now - lastLog > 5000 || (p.total && p.done === p.total)) {
        lastLog = now;
        console.log(`[zendesk-cli] ${p.done}/${p.total ?? '?'} — créés:${p.created} maj:${p.updated} erreurs:${p.errors}`);
      }
    };

    const recap = await zendeskModel.importAll(cfg, onProgress);
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`[zendesk-cli] ✅ TERMINÉ en ${secs}s :`, JSON.stringify(recap));
    process.exit(0);
  } catch (err) {
    console.error('[zendesk-cli] ❌ échec :', err.message);
    process.exit(1);
  }
})();
