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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Petit throttle global : on espace les appels pour rester sous le quota Zendesk.
// Zendesk limite le débit par minute (variable selon le plan). On sérialise les
// appels avec un délai minimal entre deux requêtes.
let _lastCallAt = 0;
const MIN_GAP_MS = 120; // ~8 req/s max → marge confortable sous la plupart des quotas

async function apiGet(cfg, pathOrUrl, attempt = 0) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl(cfg.subdomain)}${pathOrUrl}`;

  // Espacement minimal entre appels
  const since = Date.now() - _lastCallAt;
  if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
  _lastCallAt = Date.now();

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
  });

  // 429 : on respecte le Retry-After renvoyé par Zendesk, puis on réessaie.
  if (res.status === 429) {
    if (attempt >= 8) {
      throw new Error('Zendesk API 429 — quota dépassé, abandon après plusieurs tentatives');
    }
    const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
    const waitMs = (Number.isFinite(retryAfter) ? retryAfter : Math.min(2 ** attempt, 30)) * 1000;
    await sleep(waitMs);
    return apiGet(cfg, pathOrUrl, attempt + 1);
  }

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

// ─── Lister les statuts Zendesk à mapper ──────────────────────────────────────
// Source primaire : /custom_statuses.json → liste directe et instantanée de tous
// les statuts custom (avec libellés), sans scanner les tickets. Évite tout
// timeout sur les comptes à gros volume.
// Fallback : si l'API custom statuses n'est pas disponible, on retombe sur les
// 6 statuts standards Zendesk.
async function listDistinctStatuses(cfg) {
  try {
    const data = await apiGet(cfg, '/custom_statuses.json');
    const list = (data.custom_statuses || [])
      .filter((cs) => cs.active !== false)
      .map((cs) => ({
        value: `custom:${cs.id}`,
        label: cs.agent_label || cs.raw_agent_label || cs.status_category,
        category: cs.status_category, // new/open/pending/hold/solved
      }));
    if (list.length > 0) return list;
  } catch {
    // API custom statuses indisponible → fallback ci-dessous
  }
  // Fallback : statuts standards Zendesk
  return ['new', 'open', 'pending', 'hold', 'solved', 'closed'].map((s) => ({
    value: s, label: s, category: s,
  }));
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Mapping des champs custom Zendesk → champs app ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Cibles natives proposées dans l'interface (colonne réelle de sav_tickets).
// label = affiché à l'agent, column = colonne SQL.
const NATIVE_TARGETS = [
  { value: 'customer_first_name', label: 'Prénom' },
  { value: 'customer_last_name',  label: 'Nom' },
  { value: 'customer_email',      label: 'Email' },
  { value: 'customer_phone',      label: 'Téléphone' },
  { value: 'order_id',            label: 'N° de commande' },
  { value: 'order_tracking',      label: 'N° de suivi' },
  { value: 'priority',            label: 'Priorité' },
  { value: 'ticket_type',         label: 'Type' },
  { value: 'subject_category',    label: 'Catégorie / motif' },
];
const NATIVE_COLUMNS = new Set(NATIVE_TARGETS.map((t) => t.value));

// ─── Lister les champs Zendesk (custom uniquement) avec titre + exemple ───────
// Renvoie [{ key: "custom:<id>", id, title, example }]. L'exemple est tiré d'un
// échantillon de tickets pour aider à reconnaître le champ.
async function listFields(cfg) {
  // 1. Définitions des ticket fields (titres lisibles)
  const data = await apiGet(cfg, '/ticket_fields.json');
  // On ne garde que les champs custom (les champs système ont un `type` standard
  // comme subject/description/status/priority et sont câblés en dur).
  const SYSTEM_TYPES = new Set([
    'subject', 'description', 'status', 'priority', 'group', 'assignee',
    'ticket_type', 'tickettype',
  ]);
  const fields = (data.ticket_fields || [])
    .filter((f) => f.active !== false && !SYSTEM_TYPES.has(f.type))
    .map((f) => ({ key: `custom:${f.id}`, id: f.id, title: f.title || `Champ ${f.id}`, example: null }));

  // 2. Échantillon de valeurs : 1ʳᵉ page de tickets, première valeur non vide par champ
  try {
    const sample = await apiGet(cfg, `/tickets.json?page[size]=${PAGE_SIZE}`);
    const byId = {};
    for (const f of fields) byId[f.id] = f;
    for (const t of sample.tickets || []) {
      for (const cf of t.custom_fields || []) {
        const f = byId[cf.id];
        if (f && !f.example && cf.value != null && cf.value !== '') {
          f.example = String(cf.value).slice(0, 60);
        }
      }
    }
  } catch { /* échantillon best-effort */ }

  return fields;
}

// ─── Lire / enregistrer le mapping des champs ─────────────────────────────────
async function getFieldMap() {
  const res = await pool.query(
    `SELECT zendesk_field, target_type, target FROM sav_zendesk_field_map`
  );
  const map = {};
  for (const r of res.rows) {
    map[r.zendesk_field] = { target_type: r.target_type, target: r.target };
  }
  return map;
}

async function saveFieldMap(entries) {
  // entries : [{ zendesk_field, zendesk_title, target_type, target }]
  for (const e of entries) {
    if (!e.zendesk_field || !e.target_type) continue;
    await pool.query(
      `INSERT INTO sav_zendesk_field_map (zendesk_field, zendesk_title, target_type, target, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (zendesk_field)
       DO UPDATE SET zendesk_title = $2, target_type = $3, target = $4, updated_at = NOW()`,
      [e.zendesk_field, e.zendesk_title || null, e.target_type, e.target || null]
    );
  }
}

// ─── Appliquer le mapping de champs à un ticket Zendesk ───────────────────────
// Retourne { natives: { col: value }, json: { label: value } } à partir des
// custom_fields du ticket et du mapping configuré.
function applyFieldMap(zTicket, fieldMap) {
  const natives = {};
  const json = {};
  for (const cf of zTicket.custom_fields || []) {
    if (cf.value == null || cf.value === '') continue;
    const conf = fieldMap[`custom:${cf.id}`];
    if (!conf || conf.target_type === 'ignore') continue;
    if (conf.target_type === 'native' && NATIVE_COLUMNS.has(conf.target)) {
      natives[conf.target] = cf.value;
    } else if (conf.target_type === 'json' && conf.target) {
      json[conf.target] = cf.value;
    }
  }
  return { natives, json };
}

// ─── Résoudre le statut d'un ticket via le mapping ────────────────────────────
function resolveStatusValue(ticket, customStatusLabels) {
  if (ticket.custom_status_id && customStatusLabels[ticket.custom_status_id]) {
    return `custom:${ticket.custom_status_id}`;
  }
  return ticket.status;
}

// ─── Upsert d'un ticket Zendesk dans sav_tickets ──────────────────────────────
// natives : { col: value } issus du mapping des champs (peut surcharger l'email).
// json    : { label: value } stockés dans custom_fields.
async function upsertTicket(zTicket, appStatus, messages, usersById, natives = {}, json = {}) {
  const requester = usersById[zTicket.requester_id] || {};
  const subject = zTicket.subject || zTicket.raw_subject || '(sans objet)';
  const description = zTicket.description || (messages[0]?.body) || '';

  // Email : priorité au champ mappé, sinon email du requester Zendesk
  const email = natives.customer_email || requester.email || null;

  // customer_name : concaténation prénom+nom mappés si dispo, sinon name du requester
  const fullName = [natives.customer_first_name, natives.customer_last_name]
    .filter(Boolean).join(' ').trim();
  const customerName = fullName || requester.name || null;

  // Colonnes natives + valeurs, construites dynamiquement
  const cols = {
    zendesk_id: zTicket.id,
    customer_name: customerName,
    customer_email: email,
    subject,
    description,
    sav_status: appStatus,
    source: 'zendesk',
    messages: JSON.stringify(messages),
    custom_fields: JSON.stringify(json || {}),
    created_at: zTicket.created_at || new Date().toISOString(),
  };
  // Champs natifs mappés (prénom, nom, téléphone, commande, suivi, priorité, type, catégorie)
  for (const [col, val] of Object.entries(natives)) {
    if (col === 'customer_email') continue; // déjà géré
    cols[col] = val;
  }

  const colNames = Object.keys(cols);
  const placeholders = colNames.map((c, i) => {
    if (c === 'messages' || c === 'custom_fields') return `$${i + 1}::jsonb`;
    return `$${i + 1}`;
  });
  const values = colNames.map((c) => cols[c]);

  // UPDATE : on met à jour toutes les colonnes sauf created_at (on garde l'original)
  const updates = colNames
    .filter((c) => c !== 'zendesk_id' && c !== 'created_at')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat('updated_at = NOW()')
    .join(', ');

  const res = await pool.query(
    `INSERT INTO sav_tickets (${colNames.join(', ')}, updated_at)
     VALUES (${placeholders.join(', ')}, NOW())
     ON CONFLICT (zendesk_id) DO UPDATE SET ${updates}
     RETURNING (xmax = 0) AS inserted`,
    values
  );
  return res.rows[0]?.inserted ? 'created' : 'updated';
}

// ─── Import complet (avec callback de progression) ────────────────────────────
// onProgress({ total, done, created, updated, errors, currentSubject })
// Retourne le récap final. Si un statut Zendesk n'est pas mappé → throw avec la
// liste des statuts manquants (le front doit alors afficher le matching).
async function importAll(cfg, onProgress) {
  const statusMap = await getStatusMap();
  const fieldMap = await getFieldMap();

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

        const { natives, json } = applyFieldMap(t, fieldMap);
        const result = await upsertTicket(t, appStatus, messages, usersById, natives, json);
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
  listFields,
  getFieldMap,
  saveFieldMap,
  NATIVE_TARGETS,
  importAll,
};
