import axios from 'axios';

/* App Tâches : constantes, appels API et libellés partagés. */

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
export const TACHES_COLOR = '#2563EB';

/** Statuts d'étape (clés identiques à services/tachesRules.STEP_STATUSES), couleurs Monday. */
export const STEP_STATUS = {
  a_faire:  { label: 'À faire',  bg: '#C4C4C4', ink: '#fff' },
  en_cours: { label: 'En cours', bg: '#FDAB3D', ink: '#fff' },
  bloque:   { label: 'Bloqué',   bg: '#DF2F4A', ink: '#fff' },
  fait:     { label: 'Fait',     bg: '#00C875', ink: '#fff' },
};
export const STEP_STATUS_ORDER = ['a_faire', 'en_cours', 'bloque', 'fait'];

/** Statut d'une tâche (calculé côté serveur). */
export const TASK_STATUS = {
  a_faire:  { label: 'À faire',  bg: '#C4C4C4' },
  en_cours: { label: 'En cours', bg: '#FDAB3D' },
  fait:     { label: 'Terminée', bg: '#00C875' },
};

export const PRIORITY = {
  critique: { label: 'Critique', bg: '#333333' },
  haute:    { label: 'Haute',    bg: '#E2445C' },
  moyenne:  { label: 'Moyenne',  bg: '#FDAB3D' },
  basse:    { label: 'Basse',    bg: '#579BFC' },
};
export const PRIORITY_ORDER = ['critique', 'haute', 'moyenne', 'basse'];
export const priorityRank = (p) => (p ? PRIORITY_ORDER.indexOf(p) : PRIORITY_ORDER.length);

const AVATAR_COLORS = ['#7C3AED', '#0891B2', '#16A34A', '#DB2777', '#EA580C', '#2563EB', '#CA8A04', '#4F46E5'];
export const avatarColor = (id) => AVATAR_COLORS[Number(id) % AVATAR_COLORS.length];
export const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const apiError = (e) => e?.response?.data?.error || e?.message || 'Erreur';

const base = `${API_URL}/taches`;
const data = (p) => p.then((r) => r.data);

export const tachesApi = {
  members: () => data(axios.get(`${base}/members`)),
  labels: () => data(axios.get(`${base}/labels`)),
  board: (params = {}) => data(axios.get(`${base}/board`, { params })),
  mine: () => data(axios.get(`${base}/mine`)),
  task: (id) => data(axios.get(`${base}/tasks/${id}`)),
  createTask: (body) => data(axios.post(`${base}/tasks`, body)),
  updateTask: (id, body) => data(axios.patch(`${base}/tasks/${id}`, body)),
  deleteTask: (id) => data(axios.delete(`${base}/tasks/${id}`)),
  addStep: (taskId, body) => data(axios.post(`${base}/tasks/${taskId}/steps`, body)),
  updateStep: (id, body) => data(axios.patch(`${base}/steps/${id}`, body)),
  moveStep: (id, direction) => data(axios.post(`${base}/steps/${id}/move`, { direction })),
  deleteStep: (id) => data(axios.delete(`${base}/steps/${id}`)),
  addComment: (taskId, body) => data(axios.post(`${base}/tasks/${taskId}/comments`, { body })),
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
export const formatDateTime = (ts) => (ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Styles partagés (ici et pas dans tachesUi.jsx : un fichier de composants n'exporte que des composants). */
export const btn = (primary = false) => ({
  background: primary ? '#2563EB' : '#fff', color: primary ? '#fff' : '#374151',
  border: primary ? 'none' : '1px solid #D1D5DB', borderRadius: 8, padding: '8px 14px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});

export const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 8,
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};
