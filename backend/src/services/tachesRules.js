/**
 * App Tâches — règles pures (sans base), testées dans tests/taches.test.js.
 */

/** Statuts d'étape (Monday : + « Attente correction », « Suivi Google »). */
const STEP_STATUSES = ['a_faire', 'en_cours', 'attente_correction', 'suivi_google', 'bloque', 'fait'];
/** Statuts saisis à la main d'une tâche SANS étape (Monday : En cours / Fait / Bloqué ; suivi : Longue). */
const TASK_STATUSES = ['a_faire', 'en_cours', 'bloque', 'longue', 'fait'];
/** Une étape « en mouvement » : ni à faire, ni bloquée, ni faite. */
const ACTIVE = (status) => !['a_faire', 'bloque', 'fait'].includes(status);

/**
 * Ce qu'entraîne le passage à « fait » de l'étape `doneId`.
 *
 * - next     : la première étape APRÈS elle qui n'est pas faite (null s'il n'y en a plus).
 * - unblock  : cette même étape si elle était « bloqué » → elle passe « à faire ».
 *              Une étape déjà « à faire » / « en cours » n'est pas touchée.
 * - finished : toutes les étapes de la tâche sont faites.
 * - recipients : qui prévenir sur Slack. Les « personnes à notifier » de l'étape
 *              terminée (colonne « Personnes » de Monday) ; à défaut, les
 *              responsables de l'étape suivante, pour qu'un oubli de saisie ne
 *              laisse pas l'étape débloquée sans que personne le sache.
 *
 * `steps` est la liste COMPLÈTE de la tâche, dans l'ordre, l'étape terminée
 * portant déjà son nouveau statut.
 */
function nextStepPlan(steps, doneId) {
  const i = steps.findIndex((s) => s.id === doneId);
  if (i < 0) return { done: null, next: null, unblock: null, finished: false, recipients: [] };
  const done = steps[i];
  const next = steps.slice(i + 1).find((s) => s.status !== 'fait') || null;
  const finished = steps.every((s) => s.id === doneId || s.status === 'fait');
  const notify = (done.notify || []).map(Number);
  const recipients = notify.length ? notify : (next?.owners || []).map(Number);
  return {
    done,
    next,
    unblock: next && next.status === 'bloque' ? next : null,
    finished,
    recipients: [...new Set(recipients)],
  };
}

/**
 * Statut d'une tâche, calculé depuis ses étapes :
 * toutes faites → fait ; au moins une faite ou en mouvement (en cours,
 * attente correction, suivi Google) → en_cours ; sinon à faire.
 * Sans étape : le statut saisi à la main.
 */
function taskStatus(steps, manualStatus = 'a_faire') {
  if (!steps.length) return manualStatus;
  if (steps.every((s) => s.status === 'fait')) return 'fait';
  if (steps.some((s) => s.status === 'fait' || ACTIVE(s.status))) return 'en_cours';
  return 'a_faire';
}

module.exports = { STEP_STATUSES, TASK_STATUSES, nextStepPlan, taskStatus };
