const { EventEmitter } = require('events');

/**
 * Bus temps réel de l'app Tableau : « quelque chose a changé pour ce compte ».
 *
 * Chaque navigateur ouvert garde un flux SSE (tableauController.stream) abonné
 * aux événements de SON compte, et relit sa boîte de réception à réception. On
 * ne pousse donc aucune donnée, seulement un signal : le contenu reste lu par
 * les routes ordinaires, bornées au compte connecté.
 *
 * En mémoire : un seul processus backend, comme le bus du SAV (ticketEvents).
 */
const bus = new EventEmitter();
bus.setMaxListeners(0); // un écouteur par onglet ouvert

const channel = (userId) => `user:${userId}`;

/** Prévient les comptes concernés (doublons et valeurs vides ignorés). */
function notify(userIds, reason) {
  [...new Set(userIds.filter(Boolean).map(Number))].forEach((id) => bus.emit(channel(id), { reason }));
}

const subscribe = (userId, fn) => bus.on(channel(userId), fn);
const unsubscribe = (userId, fn) => bus.off(channel(userId), fn);

module.exports = { notify, subscribe, unsubscribe };
