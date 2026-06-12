// Bus d'événements applicatif pour les changements de tickets SAV.
//
// Chaque navigateur ouvrant le flux SSE (GET /api/sav/stream) s'abonne ici via
// un listener. Le code qui modifie un ticket (savModel, services) émet un
// événement `change` ; le flux SSE le relaie au navigateur, qui rafraîchit la
// liste sans attendre le polling de secours.
const { EventEmitter } = require('events');

const ticketEvents = new EventEmitter();
// Autant de listeners que de navigateurs/onglets connectés : pas de plafond.
ticketEvents.setMaxListeners(0);

/**
 * Signale qu'un ticket a été créé ou modifié.
 * @param {number|string} ticketId
 * @param {string} [reason]  étiquette de debug (ex. 'status', 'message', 'create')
 */
function emitChange(ticketId, reason) {
  ticketEvents.emit('change', { ticketId, reason });
}

module.exports = { ticketEvents, emitChange };
