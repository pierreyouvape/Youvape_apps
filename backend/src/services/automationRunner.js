const pool = require('../config/database');
const savAutomationModel = require('../models/savAutomationModel');
const savModel = require('../models/savModel');

const VALID_TYPES = new Set(['status_since', 'no_customer_reply', 'no_agent_action']);
const VALID_UNITS = new Set(['hours', 'days']);

function toInterval(value, unit) {
  const v = parseInt(value, 10);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!VALID_UNITS.has(unit)) return null;
  // PostgreSQL accepte "72 hours" / "7 days"
  return `${v} ${unit}`;
}

// Construit un fragment SQL WHERE pour une condition.
// Renvoie { sql, params } où params est un objet à fusionner.
// La condition est exprimée en SQL inline (pas de paramètre dynamique pour
// éviter les injections : on contrôle strictement la valeur et l'unité).
function buildConditionSQL(cond) {
  if (!cond || !VALID_TYPES.has(cond.type)) return null;
  const interval = toInterval(cond.value, cond.unit);
  if (!interval) return null;

  // L'interval est construit à partir de valeurs validées (entier + enum),
  // donc safe à interpoler. On garde l'identifiant entier coerce explicite.
  const v = parseInt(cond.value, 10);
  const u = cond.unit; // 'hours' ou 'days'

  switch (cond.type) {
    case 'status_since':
      return `t.last_status_change_at <= NOW() - INTERVAL '${v} ${u}'`;

    case 'no_customer_reply': {
      // Dernier message client (is_agent=false). Si aucun, on prend created_at.
      // jsonb_path_query_array + extraction de date max.
      return `
        COALESCE(
          (SELECT MAX( (msg->>'date')::timestamptz )
           FROM jsonb_array_elements(t.messages) AS msg
           WHERE (msg->>'is_agent')::boolean = FALSE),
          t.created_at
        ) <= NOW() - INTERVAL '${v} ${u}'
      `;
    }

    case 'no_agent_action': {
      // Dernier message agent (is_agent=true). Si aucun, on prend created_at.
      return `
        COALESCE(
          (SELECT MAX( (msg->>'date')::timestamptz )
           FROM jsonb_array_elements(t.messages) AS msg
           WHERE (msg->>'is_agent')::boolean = TRUE),
          t.created_at
        ) <= NOW() - INTERVAL '${v} ${u}'
      `;
    }
  }
  return null;
}

// Exécute un automatisme : trouve les tickets matchant, applique le statut cible.
// Retourne { count, ticketIds, skipped }.
async function runOne(automation) {
  const conds = Array.isArray(automation.conditions) ? automation.conditions : [];
  if (conds.length === 0) return { count: 0, ticketIds: [], skipped: 'aucune condition' };

  const condSQLs = conds.map(buildConditionSQL).filter(Boolean);
  if (condSQLs.length === 0) return { count: 0, ticketIds: [], skipped: 'aucune condition valide' };

  const whereParts = [...condSQLs];
  const params = [];
  let paramIdx = 1;

  // Filtre statut source (optionnel)
  if (automation.filter_status) {
    whereParts.push(`t.sav_status = $${paramIdx++}`);
    params.push(automation.filter_status);
  }

  // Idempotence : on n'applique pas si le statut est déjà la cible (évite boucle)
  whereParts.push(`t.sav_status != $${paramIdx++}`);
  params.push(automation.target_status);

  const sql = `
    SELECT id FROM sav_tickets t
    WHERE ${whereParts.join(' AND ')}
  `;

  const result = await pool.query(sql, params);
  const ticketIds = result.rows.map(r => r.id);

  // Appliquer le nouveau statut (séquentiel pour éviter de bloquer la BDD)
  for (const id of ticketIds) {
    try {
      await savModel.updateStatus(id, automation.target_status);
    } catch (e) {
      console.warn(`[AutomationRunner] ticket #${id} updateStatus échoué:`, e.message);
    }
  }

  await savAutomationModel.markRun(automation.id, ticketIds.length);
  return { count: ticketIds.length, ticketIds };
}

// Exécute tous les automatismes activés
async function runAll() {
  const automations = await savAutomationModel.getAllEnabled();
  const summary = [];
  for (const auto of automations) {
    try {
      const r = await runOne(auto);
      summary.push({ id: auto.id, name: auto.name, ...r });
      if (r.count > 0) {
        console.log(`🤖 [Automation #${auto.id} "${auto.name}"] ${r.count} ticket(s) → ${auto.target_status}`);
      }
    } catch (e) {
      console.error(`[AutomationRunner] règle #${auto.id} échouée :`, e.message);
      summary.push({ id: auto.id, name: auto.name, error: e.message });
    }
  }
  return summary;
}

module.exports = { runOne, runAll, buildConditionSQL };
