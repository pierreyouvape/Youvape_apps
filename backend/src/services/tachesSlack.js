const appConfigModel = require('../models/appConfigModel');

/**
 * App Tâches — message Slack dans le canal commun (#notifications-taches),
 * par un « Incoming Webhook » d'une app Slack. Remplace le scénario Make.
 *
 * Réglages : app_config.taches_slack = JSON
 *   { webhook_url: 'https://hooks.slack.com/services/…',
 *     members: { "<user_id>": "U0123ABCD" } }   // ID de membre Slack de chacun
 * Sans ID de membre, la personne est nommée en gras (pas de notification Slack).
 *
 * L'URL du webhook est un secret : jamais renvoyée au navigateur (seulement
 * `webhook_set`), un champ vide à l'enregistrement la conserve.
 */

const CONFIG_KEY = 'taches_slack';
const APP_URL = process.env.APP_BASE_URL || 'https://apps.youvape.fr';
const WEBHOOK_RE = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
const MEMBER_RE = /^[UW][A-Z0-9]{6,}$/;

async function readConfig() {
  const row = await appConfigModel.get(CONFIG_KEY);
  if (!row) return { webhook_url: '', members: {} };
  try {
    const v = JSON.parse(row.config_value);
    return { webhook_url: v.webhook_url || '', members: v.members || {} };
  } catch {
    return { webhook_url: '', members: {} };
  }
}

/** Ce que l'écran de réglages peut voir. */
async function getPublicConfig() {
  const c = await readConfig();
  return { webhook_set: Boolean(c.webhook_url), members: c.members };
}

async function saveConfig({ webhook_url, members }) {
  const current = await readConfig();
  const url = String(webhook_url || '').trim();
  if (url && !WEBHOOK_RE.test(url)) {
    const e = new Error("L'adresse doit être un webhook Slack (https://hooks.slack.com/services/…)");
    e.statusCode = 400;
    throw e;
  }
  const clean = {};
  Object.entries(members || {}).forEach(([userId, slackId]) => {
    const id = String(slackId || '').trim().toUpperCase();
    if (!id) return;
    if (!MEMBER_RE.test(id)) {
      const e = new Error(`ID de membre Slack invalide : « ${slackId} » (ex. U0123ABCD)`);
      e.statusCode = 400;
      throw e;
    }
    clean[Number(userId)] = id;
  });
  await appConfigModel.upsert(CONFIG_KEY, JSON.stringify({ webhook_url: url || current.webhook_url, members: clean }));
  return getPublicConfig();
}

/** Échappe le texte libre pour Slack (&, <, > seulement, cf. doc mrkdwn). */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const mention = (userId, members, names) => (members[userId]
  ? `<@${members[userId]}>`
  : `*${esc(names.get(Number(userId)) || 'quelqu’un')}*`);

/** Message Block Kit — pur, testé. */
function buildDoneMessage({ task, doneStep, nextStep, unblocked, finished, doneBy, recipients, members, names }) {
  const who = recipients.map((id) => mention(id, members, names)).join(' ');
  const lines = [`🔔 ${who} une étape vient d'être terminée${doneBy ? ` par ${esc(doneBy)}` : ''}.`,
    `*Tâche :* ${esc(task.title)}`,
    `*Étape terminée :* ${esc(doneStep.name)}`];
  if (finished) {
    lines.push('✅ *Toutes les étapes sont faites.*');
  } else if (nextStep) {
    const owners = (nextStep.owners || []).map((id) => esc(names.get(Number(id)) || '?')).join(', ');
    lines.push(`*${unblocked ? 'Débloquée, à faire maintenant' : 'Étape suivante'} :* ${esc(nextStep.name)}${owners ? ` (${owners})` : ''}`);
  }
  const url = `${APP_URL}/taches/tache/${task.id}`;
  return {
    text: `Tâche « ${task.title} » : ${doneStep.name} terminée`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Ouvrir la tâche' }, url }] },
    ],
  };
}

/**
 * Tâche SANS étape passée « fait » (suivi quotidien) — comme le scénario Make :
 * « une tâche de Anthony est terminée ». Les personnes sont nommées, pas
 * mentionnées : c'est une information pour l'équipe, pas un travail à prendre.
 */
function buildTaskDoneMessage({ task, doneBy, names }) {
  const people = (task.people || []).map((id) => esc(names.get(Number(id)) || '?')).join(', ');
  const lines = [`✅ ${doneBy ? `*${esc(doneBy)}* a terminé une tâche` : 'Tâche terminée'}${people && people !== esc(doneBy) ? ` (de ${people})` : ''}.`,
    `*Tâche :* ${esc(task.title)}`];
  if (task.board_name) lines.push(`*Tableau :* ${esc(task.board_name)}`);
  const url = `${APP_URL}/taches/tache/${task.id}`;
  return {
    text: `Tâche « ${task.title} » terminée`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Ouvrir la tâche' }, url }] },
    ],
  };
}

/** Mention @ dans un commentaire : les mentionnés sont notifiés, avec l'extrait. */
function buildMentionMessage({ task, author, text, recipients, members, names }) {
  const who = recipients.map((id) => mention(id, members, names)).join(' ');
  const excerpt = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  const url = `${APP_URL}/taches/tache/${task.id}`;
  return {
    text: `${author || 'Quelqu’un'} vous a mentionné dans « ${task.title} »`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 ${who} *${esc(author || 'Quelqu’un')}* vous a mentionné.\n*Tâche :* ${esc(task.title)}\n> ${esc(excerpt)}`,
        },
      },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Ouvrir la tâche' }, url }] },
    ],
  };
}

async function post(webhookUrl, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await res.text();
    // Slack répond « ok » en texte brut ; tout le reste est un échec (un 200 n'est pas une preuve).
    if (res.ok && body.trim() === 'ok') return { ok: true };
    return { ok: false, error: `Slack ${res.status} : ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Slack ne répond pas (10 s)' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function sendDoneNotice(args) {
  const { webhook_url: url, members } = await readConfig();
  if (!url) return { ok: false, error: 'Slack non configuré' };
  return post(url, buildDoneMessage({ ...args, members }));
}

async function sendTaskDoneNotice(args) {
  const { webhook_url: url } = await readConfig();
  if (!url) return { ok: false, error: 'Slack non configuré' };
  return post(url, buildTaskDoneMessage(args));
}

async function sendMentionNotice(args) {
  const { webhook_url: url, members } = await readConfig();
  if (!url) return { ok: false, error: 'Slack non configuré' };
  return post(url, buildMentionMessage({ ...args, members }));
}

async function sendTest(userName) {
  const { webhook_url: url } = await readConfig();
  if (!url) return { ok: false, error: 'Slack non configuré' };
  return post(url, { text: `✅ Test de l'app Tâches envoyé par ${userName || 'un administrateur'} : les notifications arriveront ici.` });
}

module.exports = {
  getPublicConfig, saveConfig, sendDoneNotice, sendTaskDoneNotice, sendMentionNotice, sendTest,
  buildDoneMessage, buildTaskDoneMessage, buildMentionMessage,
};
