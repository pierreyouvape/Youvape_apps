import axios from 'axios';

/* App Tâches : constantes, appels API et libellés partagés. */

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
export const TACHES_COLOR = '#0073EA';

/** Statuts d'étape (clés identiques à services/tachesRules.STEP_STATUSES), couleurs Monday. */
export const STEP_STATUS = {
  a_faire:            { label: 'À faire',            bg: 'var(--tk-todo)', ink: '#fff' },
  en_cours:           { label: 'En cours',           bg: '#FDAB3D', ink: '#fff' },
  attente_correction: { label: 'Attente correction', bg: '#A25DDC', ink: '#fff' },
  suivi_google:       { label: 'Suivi Google',       bg: '#579BFC', ink: '#fff' },
  bloque:             { label: 'Bloqué',             bg: '#DF2F4A', ink: '#fff' },
  fait:               { label: 'Fait',               bg: '#00C875', ink: '#fff' },
};
export const STEP_STATUS_ORDER = ['a_faire', 'en_cours', 'attente_correction', 'suivi_google', 'bloque', 'fait'];

/** Statut d'une tâche : calculé si elle a des étapes, sinon choisi à la main. */
export const TASK_STATUS = {
  a_faire:  { label: 'À faire',  bg: 'var(--tk-todo)' },
  en_cours: { label: 'En cours', bg: '#FDAB3D' },
  bloque:   { label: 'Bloqué',   bg: '#DF2F4A' },
  longue:   { label: 'Longue',   bg: '#4EB3E8' },
  fait:     { label: 'Terminée', bg: '#00C875' },
};
export const TASK_STATUS_ORDER = ['a_faire', 'en_cours', 'bloque', 'longue', 'fait'];

export const PRIORITY = {
  critique: { label: 'Critique', bg: '#333333' },
  haute:    { label: 'Principale', bg: '#E2445C' },
  moyenne:  { label: 'Moyenne',  bg: '#FDAB3D' },
  basse:    { label: 'Basse',    bg: '#579BFC' },
};
export const PRIORITY_ORDER = ['critique', 'haute', 'moyenne', 'basse'];
export const priorityRank = (p) => (p ? PRIORITY_ORDER.indexOf(p) : PRIORITY_ORDER.length);

// 11 couleurs et un pas de 7 : les comptes de l'équipe (1, 2, 3, 4, 10) ont chacun la leur.
const AVATAR_COLORS = ['#0073EA', '#00C875', '#E2445C', '#FDAB3D', '#A25DDC', '#037F4C', '#FF158A', '#579BFC', '#784BD1', '#BB3354', '#00A9FF'];
export const avatarColor = (id) => AVATAR_COLORS[(Number(id) * 7) % AVATAR_COLORS.length];
export const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const apiError = (e) => e?.response?.data?.error || e?.message || 'Erreur';

const base = `${API_URL}/taches`;

/**
 * Passage d'une étape à « Fait ». Si l'étape demande le lien de la fiche
 * produit (« Rédaction texte »), le serveur répond LINK_REQUIRED avec le lien
 * actuel : on le fait confirmer ou saisir, puis on renvoie. Annuler = rien ne change.
 */
async function updateStepAsking(id, body) {
  try {
    return (await axios.patch(`${base}/steps/${id}`, body)).data;
  } catch (e) {
    if (e?.response?.data?.code !== 'LINK_REQUIRED') throw e;
    const current = e.response.data.details?.current || '';
    const link = window.prompt(
      'Lien de la fiche produit créée sur le site (obligatoire pour terminer cette étape) :',
      /youvape\.fr/i.test(current) ? current : 'https://www.youvape.fr/produit/',
    );
    if (link === null) {
      const cancel = new Error('Étape non terminée : lien de la fiche non renseigné.');
      cancel.response = { data: { error: cancel.message } };
      throw cancel;
    }
    return (await axios.patch(`${base}/steps/${id}`, { ...body, link_url: link.trim() })).data;
  }
}
const data = (p) => p.then((r) => r.data);

export const tachesApi = {
  members: () => data(axios.get(`${base}/members`)),
  boards: () => data(axios.get(`${base}/boards`)),
  views: () => data(axios.get(`${base}/views`)),
  createView: (body) => data(axios.post(`${base}/views`, body)),
  updateView: (id, body) => data(axios.put(`${base}/views/${id}`, body)),
  deleteView: (id) => data(axios.delete(`${base}/views/${id}`)),
  createBoard: (body) => data(axios.post(`${base}/boards`, body)),
  updateBoard: (id, body) => data(axios.put(`${base}/boards/${id}`, body)),
  deleteBoard: (id) => data(axios.delete(`${base}/boards/${id}`)),
  createGroup: (boardId, body) => data(axios.post(`${base}/boards/${boardId}/groups`, body)),
  updateGroup: (id, body) => data(axios.put(`${base}/groups/${id}`, body)),
  deleteGroup: (id) => data(axios.delete(`${base}/groups/${id}`)),
  search: (q) => data(axios.get(`${base}/search`, { params: { q } })),
  bulk: (body) => data(axios.post(`${base}/tasks/bulk`, body)),
  labels: () => data(axios.get(`${base}/labels`)),
  board: (params = {}) => data(axios.get(`${base}/board`, { params })),
  mine: () => data(axios.get(`${base}/mine`)),
  task: (id) => data(axios.get(`${base}/tasks/${id}`)),
  createTask: (body) => data(axios.post(`${base}/tasks`, body)),
  updateTask: (id, body) => data(axios.patch(`${base}/tasks/${id}`, body)),
  deleteTask: (id) => data(axios.delete(`${base}/tasks/${id}`)),
  addStep: (taskId, body) => data(axios.post(`${base}/tasks/${taskId}/steps`, body)),
  updateStep: (id, body) => updateStepAsking(id, body),
  moveStep: (id, direction) => data(axios.post(`${base}/steps/${id}/move`, { direction })),
  deleteStep: (id) => data(axios.delete(`${base}/steps/${id}`)),
  addComment: (taskId, body, mentions = [], files = []) => {
    if (!files.length) return data(axios.post(`${base}/tasks/${taskId}/comments`, { body, mentions }));
    const form = new FormData();
    form.append('body', body);
    form.append('mentions', JSON.stringify(mentions));
    files.forEach((f) => form.append('files', f, f.name));
    return data(axios.post(`${base}/tasks/${taskId}/comments`, form));
  },
  /** Pièce jointe d'un commentaire, lue avec la session (pas de lien public). */
  commentFile: (file) => data(axios.get(`${base}/files/${encodeURIComponent(file)}`, { responseType: 'blob' })),
  notifications: (params = {}) => data(axios.get(`${base}/notifications`, { params })),
  notificationCount: () => data(axios.get(`${base}/notifications/count`)),
  readNotification: (id, read = true) => data(axios.post(`${base}/notifications/${id}/read`, { read })),
  readAllNotifications: () => data(axios.post(`${base}/notifications/read-all`)),
  setLayout: (boardId, layout) => data(axios.put(`${base}/boards/${boardId}/layout`, { layout })),
  createColumn: (boardId, body) => data(axios.post(`${base}/boards/${boardId}/columns`, body)),
  updateColumn: (id, body) => data(axios.patch(`${base}/columns/${id}`, body)),
  deleteColumn: (id) => data(axios.delete(`${base}/columns/${id}`)),
  setValue: (taskId, columnId, value) => data(axios.put(`${base}/tasks/${taskId}/values/${columnId}`, { value })),
  reorderTasks: (groupId, ids) => data(axios.post(`${base}/tasks/reorder`, { group_id: groupId, ids })),
  reorderSteps: (taskId, ids) => data(axios.post(`${base}/tasks/${taskId}/steps/reorder`, { ids })),
  deleteComment: (id) => data(axios.delete(`${base}/comments/${id}`)),
  templates: () => data(axios.get(`${base}/templates`)),
  createTemplate: (body) => data(axios.post(`${base}/templates`, body)),
  updateTemplate: (id, body) => data(axios.put(`${base}/templates/${id}`, body)),
  deleteTemplate: (id) => data(axios.delete(`${base}/templates/${id}`)),
  slack: () => data(axios.get(`${base}/slack`)),
  saveSlack: (body) => data(axios.put(`${base}/slack`, body)),
  testSlack: () => data(axios.post(`${base}/slack/test`)),
};

/** « il y a 3 jours » à partir d'un horodatage Paris sans fuseau (YYYY-MM-DDTHH:MM:SS). */
export function ago(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const days = Math.floor(s / 86400);
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  if (days < 31) return `il y a ${Math.floor(days / 7)} sem.`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

export const formatDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');
/** « 25 nov. 2026 » à partir d'un horodatage. */
export const formatDay = (ts) => (ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
/** « 25 nov. » cette année, « 25 nov. 2025 » sinon (une date d'une autre année reste sans ambiguïté). */
export const formatDayShort = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};
export const formatDateTime = (ts) => (ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
/** Ajoute n jours à une date YYYY-MM-DD (calcul en UTC : pas de décalage d'heure d'été). */
export const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

/** Dates d'une tâche pour le Gantt / calendrier : les siennes, sinon l'enveloppe de ses étapes. */
export function taskSpan(t) {
  let start = t.start_date;
  let end = t.due_date;
  if (!start && !end) {
    const s = t.steps.map((x) => x.start_date || x.due_date).filter(Boolean).sort();
    const e = t.steps.map((x) => x.due_date || x.start_date).filter(Boolean).sort();
    start = s[0] || null;
    end = e[e.length - 1] || null;
  }
  if (!start && !end) return null;
  return { start: start || end, end: end || start, own: Boolean(t.start_date || t.due_date) };
}

export const isOpenStep = (s) => s.status !== 'fait' && s.status !== 'bloque';

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Styles partagés (ici et pas dans tachesUi.jsx : un fichier de composants n'exporte que des composants). */
export const btn = (primary = false) => ({
  background: primary ? '#2563EB' : 'var(--tk-surface)', color: primary ? '#fff' : 'var(--tk-text2)',
  border: primary ? 'none' : '1px solid var(--tk-border)', borderRadius: 8, padding: '8px 14px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});

export const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--tk-border)', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};

export const labelChip = {
  background: 'var(--tk-chip)', color: 'var(--tk-chipInk)', borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
};

/* ─── Tableaux façon Monday ─────────────────────────────────
 * Lignes de 36 px, grille fine grise, en-têtes gris centrés, texte sur une
 * seule ligne (coupé avec « … », complet au survol), cellules de statut pleines.
 */
export const M = {
  text: 'var(--tk-text)', sub: 'var(--tk-sub)', border: 'var(--tk-border)', grid: 'var(--tk-grid)', hover: 'var(--tk-hover)', rowH: 36,
  font: "'Figtree', 'Roboto', 'Lato', -apple-system, sans-serif",
};
export const mTable = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 14, color: M.text, fontFamily: M.font };
export const mTh = {
  position: 'relative', height: 36, padding: '0 8px', fontSize: 14, fontWeight: 400, color: M.sub, textAlign: 'center',
  borderBottom: `1px solid ${M.grid}`, borderRight: `1px solid ${M.grid}`, background: 'var(--tk-surface)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
export const mTd = {
  height: 36, padding: '0 8px', borderBottom: `1px solid ${M.grid}`, borderRight: `1px solid ${M.grid}`,
  textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
/** Case occupée entièrement par une cellule de couleur (statut, priorité). */
export const mCell = { ...mTd, padding: 0 };
/** Texte coupé sur une ligne. */
export const ellipsis = { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
