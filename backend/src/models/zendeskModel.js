/**
 * Zendesk Import Model
 *
 * Client de l'API Zendesk + logique d'import des tickets dans le SAV.
 *
 * Auth : Basic Auth, identifiant `{email}/token`, mot de passe = API token.
 *   → header Authorization: Basic base64("{email}/token:{token}")
 * Doc : https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 *
 * Config stockée dans app_config :
 *   - zendesk_subdomain  (ex. "youvape" → https://youvape.zendesk.com)
 *   - zendesk_email      (email du compte agent)
 *   - zendesk_token      (API token)
 */

const pool = require('../config/database');
const appConfigModel = require('./appConfigModel');

const PAGE_SIZE = 100; // max Zendesk cursor pagination

// ─── Config ───────────────────────────────────────────────────────────────────
async function getConfig() {
  const [sub, email, token] = await Promise.all([
    appConfigModel.get('zendesk_subdomain'),
    appConfigModel.get('zendesk_email'),
    appConfigModel.get('zendesk_token'),
  ]);
  return {
    subdomain: sub?.config_value || '',
    email: email?.config_value || '',
    token: token?.config_value || '',
  };
}

async function saveConfig({ subdomain, email, token }) {
  if (subdomain !== undefined) await appConfigModel.upsert('zendesk_subdomain', subdomain.trim());
  if (email !== undefined) await appConfigModel.upsert('zendesk_email', email.trim());
  // Le token n'est réécrit que s'il est fourni non vide (le front envoie vide pour « ne pas changer »)
  if (token) await appConfigModel.upsert('zendesk_token', token.trim());
}

function authHeader({ email, token }) {
  const raw = `${email}/token:${token}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

function baseUrl(subdomain) {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

// ─── Appel API générique ──────────────────────────────────────────────────────
async function apiGet(cfg, pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl(cfg.subdomain)}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Zendesk API ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Tester la connexion ──────────────────────────────────────────────────────
async function testConnection(cfg) {
  if (!cfg.subdomain || !cfg.email || !cfg.token) {
    throw new Error('Sous-domaine, email et token requis');
  }
  // /users/me.json renvoie l'utilisateur courant si les credentials sont valides
  const data = await apiGet(cfg, '/users/me.json');
  return { name: data.user?.name, email: data.user?.email, role: data.user?.role };
}

// ─── Itérer sur tous les tickets (cursor pagination) ──────────────────────────
// Appelle onPage(tickets[], meta) pour chaque page. meta.estimatedTotal si dispo.
async function forEachTicketPage(cfg, onPage) {
  let url = `/tickets.json?page[size]=${PAGE_SIZE}`;
  while (url) {
    const data = await apiGet(cfg, url);
    await onPage(data.tickets || []);
    url = data.meta?.has_more ? data.links?.next : null;
  }
}

// ─── Compter les tickets (pour la barre de progression) ───────────────────────
async function countTickets(cfg) {
  // /tickets/count.json renvoie un total (possiblement approximatif côté Zendesk)
  try {
    const data = await apiGet(cfg, '/tickets/count.json');
    return data.count?.value ?? null;
  } catch {
    return null;
  }
}

// ─── Lister les statuts distincts présents dans Zendesk ───────────────────────
// Parcourt tous les tickets et collecte les valeurs distinctes de `status`
// (+ `custom_status_id` résolu en libellé si l'API custom statuses est dispo).
async function listDistinctStatuses(cfg) {
  // 1. Tenter de récupérer les statuts custom (libellés lisibles)
  const customStatusLabels = {}; // id → label
  try {
    const data = await apiGet(cfg, '/custom_statuses.json');
    for (const cs of data.custom_statuses || []) {
      customStatusLabels[cs.id] = cs.agent_label || cs.raw_agent_label || cs.status_category;
    }
  } catch {
    // L'API custom statuses peut ne pas être activée → on retombe sur status standard
  }

  const seen = new Map(); // value → { value, label, count }
  await forEachTicketPage(cfg, (tickets) => {
    for (const t of tickets) {
      // Valeur de mapping : on privilégie le statut custom si présent, sinon le statut standard
      let value, label;
      if (t.custom_status_id && customStatusLabels[t.custom_status_id]) {
        value = `custom:${t.custom_status_id}`;
        label = customStatusLabels[t.custom_status_id];
      } else {
        value = t.status; // open, pending, hold, solved, closed, new
        label = t.status;
      }
      if (!seen.has(value)) seen.set(value, { value, label, count: 0 });
      seen.get(value).count += 1;
    }
  });
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

// ─── Mapping des statuts (table sav_zendesk_status_map) ───────────────────────
async function getStatusMap() {
  const res = await pool.query(`SELECT zendesk_value, app_status FROM sav_zendesk_status_map`);
  const map = {};
  for (const r of res.rows) map[r.zendesk_value] = r.app_status;
  return map;
}

async function saveStatusMap(entries) {
  // entries : [{ zendesk_value, app_status }]
  for (const e of entries) {
    if (!e.zendesk_value || !e.app_status) continue;
    await pool.query(
      `INSERT INTO sav_zendesk_status_map (zendesk_value, app_status, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (zendesk_value)
       DO UPDATE SET app_status = $2, updated_at = NOW()`,
      [e.zendesk_value, e.app_status]
    );
  }
}

// ─── Récupérer les commentaires (messages) d'un ticket ────────────────────────
async function getTicketComments(cfg, ticketId, usersById) {
  const data = await apiGet(cfg, `/tickets/${ticketId}/comments.json`);
  return (data.comments || []).map((c) => {
    const author = usersById[c.author_id];
    return {
      from: author?.name || author?.email || 'Zendesk',
      body: c.html_body || c.body || '',
      is_agent: author?.role === 'agent' || author?.role === 'admin',
      is_private: c.public === false,
      date: c.created_at || new Date().toISOString(),
      attachments: (c.attachments || []).map((a) => ({
        name: a.file_name,
        url: a.content_url,
        size: a.size,
        content_type: a.content_type,
        external: true, // hébergé chez Zendesk, pas téléchargé localement
      })),
    };
  });
}

// ─── Résoudre le statut d'un ticket via le mapping ────────────────────────────
function resolveStatusValue(ticket, customStatusLabels) {
  if (ticket.custom_status_id && customStatusLabels[ticket.custom_status_id]) {
    return `custom:${ticket.custom_status_id}`;
  }
  return ticket.status;
}

// ─── Upsert d'un ticket Zendesk dans sav_tickets ──────────────────────────────
async function upsertTicket(zTicket, appStatus, messages, usersById) {
  const requester = usersById[zTicket.requester_id] || {};
  const subject = zTicket.subject || zTicket.raw_subject || '(sans objet)';
  // Description = premier commentaire si dispo, sinon champ description
  const description = zTicket.description || (messages[0]?.body) || '';

  const res = await pool.query(
    `INSERT INTO sav_tickets
       (zendesk_id, customer_name, customer_email, subject, description,
        sav_status, source, messages, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'zendesk', $7::jsonb, $8, NOW())
     ON CONFLICT (zendesk_id) DO UPDATE SET
       customer_name = EXCLUDED.customer_name,
       customer_email = EXCLUDED.customer_email,
       subject = EXCLUDED.subject,
       description = EXCLUDED.description,
       sav_status = EXCLUDED.sav_status,
       messages = EXCLUDED.messages,
       updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [
      zTicket.id,
      requester.name || null,
      requester.email || null,
      subject,
      description,
      appStatus,
      JSON.stringify(messages),
      zTicket.created_at || new Date().toISOString(),
    ]
  );
  return res.rows[0]?.inserted ? 'created' : 'updated';
}

// ─── Import complet (avec callback de progression) ────────────────────────────
// onProgress({ total, done, created, updated, errors, currentSubject })
// Retourne le récap final. Si un statut Zendesk n'est pas mappé → throw avec la
// liste des statuts manquants (le front doit alors afficher le matching).
async function importAll(cfg, onProgress) {
  const statusMap = await getStatusMap();

  // Récupérer les libellés des statuts custom pour la résolution
  const customStatusLabels = {};
  try {
    const data = await apiGet(cfg, '/custom_statuses.json');
    for (const cs of data.custom_statuses || []) {
      customStatusLabels[cs.id] = cs.agent_label || cs.raw_agent_label || cs.status_category;
    }
  } catch { /* pas de statuts custom */ }

  const total = await countTickets(cfg);
  let done = 0, created = 0, updated = 0, errors = 0;
  const missingStatuses = new Set();

  // Cache des utilisateurs (requester + auteurs de commentaires)
  const usersById = {};
  async function loadUsers(ids) {
    const toFetch = [...new Set(ids)].filter((id) => id && !(id in usersById));
    for (let i = 0; i < toFetch.length; i += 100) {
      const batch = toFetch.slice(i, i + 100);
      try {
        const data = await apiGet(cfg, `/users/show_many.json?ids=${batch.join(',')}`);
        for (const u of data.users || []) usersById[u.id] = u;
      } catch { /* on continue sans les noms */ }
    }
  }

  await forEachTicketPage(cfg, async (tickets) => {
    // Pré-charger les requesters de la page
    await loadUsers(tickets.map((t) => t.requester_id));

    for (const t of tickets) {
      try {
        const zStatus = resolveStatusValue(t, customStatusLabels);
        const appStatus = statusMap[zStatus];
        if (!appStatus) {
          missingStatuses.add(zStatus);
          done += 1;
          if (onProgress) onProgress({ total, done, created, updated, errors, skippedUnmapped: true });
          continue;
        }
        // Charger les commentaires (messages) — peut référencer de nouveaux auteurs
        const rawComments = await apiGet(cfg, `/tickets/${t.id}/comments.json`);
        await loadUsers((rawComments.comments || []).map((c) => c.author_id));
        const messages = (rawComments.comments || []).map((c) => {
          const author = usersById[c.author_id];
          return {
            from: author?.name || author?.email || 'Zendesk',
            body: c.html_body || c.body || '',
            is_agent: author?.role === 'agent' || author?.role === 'admin',
            is_private: c.public === false,
            date: c.created_at || new Date().toISOString(),
            attachments: (c.attachments || []).map((a) => ({
              name: a.file_name, url: a.content_url, size: a.size,
              content_type: a.content_type, external: true,
            })),
          };
        });

        const result = await upsertTicket(t, appStatus, messages, usersById);
        if (result === 'created') created += 1; else updated += 1;
      } catch (err) {
        errors += 1;
        console.error(`[zendesk import] ticket ${t.id} :`, err.message);
      }
      done += 1;
      if (onProgress) onProgress({ total, done, created, updated, errors, currentSubject: t.subject });
    }
  });

  return { total, done, created, updated, errors, missingStatuses: [...missingStatuses] };
}

module.exports = {
  getConfig,
  saveConfig,
  testConnection,
  listDistinctStatuses,
  getStatusMap,
  saveStatusMap,
  importAll,
};
