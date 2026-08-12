const { ticketEvents } = require('./ticketEvents');

/**
 * Présence des agents sur les tickets — qui regarde quoi, et qui est en train
 * d'écrire.
 *
 * Sert à éviter les réponses croisées : deux agents sur le même ticket qui
 * répondent chacun de leur côté.
 *
 * ⚠️ État EN MÉMOIRE, volontairement. La présence est éphémère par nature :
 * elle n'a aucun intérêt après un redémarrage, et la persister coûterait une
 * écriture en base toutes les dix secondes par agent pour rien. En contrepartie,
 * ça ne fonctionne qu'avec UN SEUL processus backend — ce qui est le cas
 * aujourd'hui. Le jour où l'app tournerait sur plusieurs instances, il faudrait
 * un état partagé (Redis) : sans ça, chaque instance ne verrait que ses propres
 * agents, et la protection deviendrait silencieusement inopérante.
 */

// Au-delà de ce délai sans signe de vie, un agent est considéré parti. Doit
// rester nettement supérieur à la période de battement du navigateur (10 s)
// pour absorber un onglet en veille ou un réseau lent.
const PRESENCE_TTL_MS = 35 * 1000;

// « En train d'écrire » = A UNE RÉPONSE EN COURS, pas « a frappé une touche il
// y a moins de N secondes ». Un brouillon commencé puis laissé de côté reste une
// intention de répondre : c'est justement là qu'une collision fait mal.
//
// Pas de délai d'expiration, donc : l'état suit le contenu de l'éditeur, et le
// battement de cœur en fait foi. C'est la présence elle-même qui expire (35 s) —
// un agent qui ferme son onglet libère le ticket, brouillon ou pas.
//
// Contrepartie : un brouillon oublié dans un onglet resté ouvert verrouille
// longtemps. D'où `typingSince`, exposé pour que l'interface affiche l'ancienneté
// et que le collègue puisse juger — un brouillon de 30 s et un de 3 h n'appellent
// pas la même réaction.

// ticketId (string) → Map(userId → { userId, userName, lastSeen, typingSince })
const byTicket = new Map();

const now = () => Date.now();

/** Retire les agents silencieux d'un ticket. Renvoie true si ça a changé. */
function pruneTicket(ticketId) {
  const viewers = byTicket.get(ticketId);
  if (!viewers) return false;

  let changed = false;
  for (const [userId, entry] of viewers) {
    if (now() - entry.lastSeen > PRESENCE_TTL_MS) {
      viewers.delete(userId);
      changed = true;
    }
  }
  if (viewers.size === 0) byTicket.delete(ticketId);
  return changed;
}

/** Projection publique d'un agent présent. */
function toPublic(entry) {
  return {
    user_id: entry.userId,
    user_name: entry.userName,
    typing: !!entry.typingSince,
    typing_since: entry.typingSince || null,
  };
}

/** Agents actuellement sur un ticket (purge au passage). */
function getViewers(ticketId) {
  const key = String(ticketId);
  pruneTicket(key);
  const viewers = byTicket.get(key);
  return viewers ? Array.from(viewers.values()).map(toPublic) : [];
}

/**
 * Signale qu'un agent est sur un ticket (battement de cœur).
 *
 * @param {object} p
 * @param {number|string} p.ticketId
 * @param {number|string} p.userId
 * @param {string} p.userName
 * @param {boolean} p.typing  l'agent a frappé une touche récemment
 * @returns {Array} agents présents après mise à jour
 */
function heartbeat({ ticketId, userId, userName, typing }) {
  const key = String(ticketId);
  if (!byTicket.has(key)) byTicket.set(key, new Map());
  const viewers = byTicket.get(key);

  const uid = String(userId);
  const previous = viewers.get(uid);
  const entry = {
    userId: uid,
    userName: userName || 'Agent',
    lastSeen: now(),
    // On conserve l'horodatage du DÉBUT de la rédaction tant qu'elle dure :
    // c'est lui qui permet d'afficher « depuis 2 h ». Vider l'éditeur remet à
    // zéro, et un nouveau brouillon repartira d'un nouvel horodatage.
    typingSince: typing ? (previous?.typingSince || now()) : null,
  };
  viewers.set(uid, entry);

  // On ne diffuse qu'aux changements visibles (arrivée, départ, bascule de
  // rédaction) : un battement de cœur toutes les 10 s par agent ne doit pas
  // réveiller tous les navigateurs connectés.
  const wasTyping = !!previous?.typingSince;
  const isTyping = !!entry.typingSince;
  if (!previous || wasTyping !== isTyping) {
    broadcast(key);
  }

  return getViewers(key);
}

/** L'agent quitte le ticket (fermeture d'onglet, navigation). */
function leave({ ticketId, userId }) {
  const key = String(ticketId);
  const viewers = byTicket.get(key);
  if (!viewers) return;
  if (viewers.delete(String(userId))) {
    if (viewers.size === 0) byTicket.delete(key);
    broadcast(key);
  }
}

/** Présence de TOUS les tickets, pour pastiller la liste. */
function getAll() {
  const out = {};
  for (const ticketId of Array.from(byTicket.keys())) {
    const viewers = getViewers(ticketId);
    if (viewers.length > 0) out[ticketId] = viewers;
  }
  return out;
}

function broadcast(ticketId) {
  ticketEvents.emit('presence', { ticketId, viewers: getViewers(ticketId) });
}

// Purge périodique : sans ça, un ticket dont tous les agents sont partis sans
// prévenir (onglet tué) resterait pastillé dans la liste jusqu'au prochain
// battement de quelqu'un d'autre.
setInterval(() => {
  for (const ticketId of Array.from(byTicket.keys())) {
    if (pruneTicket(ticketId)) broadcast(ticketId);
  }
}, 15 * 1000).unref();

module.exports = { heartbeat, leave, getViewers, getAll };
