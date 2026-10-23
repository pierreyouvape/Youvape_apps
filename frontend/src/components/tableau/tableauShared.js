import axios from 'axios';

/* App Tableau : constantes, appels API et libellés partagés (page + notifications). */

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');
export const TABLEAU_COLOR = '#CA8A04';

/** Couleurs de post-it (clés identiques à tableauModel.COLORS). */
export const NOTE_COLORS = {
  jaune:  { bg: '#FEF3C7', bar: '#FDE68A', ink: '#713F12' },
  rose:   { bg: '#FCE7F3', bar: '#FBCFE8', ink: '#831843' },
  bleu:   { bg: '#DBEAFE', bar: '#BFDBFE', ink: '#1E3A8A' },
  vert:   { bg: '#DCFCE7', bar: '#BBF7D0', ink: '#14532D' },
  violet: { bg: '#EDE9FE', bar: '#DDD6FE', ink: '#4C1D95' },
  orange: { bg: '#FFEDD5', bar: '#FED7AA', ink: '#7C2D12' },
};
export const noteColor = (key) => NOTE_COLORS[key] || NOTE_COLORS.jaune;

const post = (path, body) => axios.post(`${API_URL}/tableau${path}`, body).then((r) => r.data);

const imageForm = (file, fields = {}) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
  fd.append('image', file);
  return fd;
};

export const tableauApi = {
  inbox: () => axios.get(`${API_URL}/tableau/inbox`).then((r) => r.data),
  recipients: () => axios.get(`${API_URL}/tableau/recipients`).then((r) => r.data),
  notes: () => axios.get(`${API_URL}/tableau/notes`).then((r) => r.data),
  createNote: (body) => post('/notes', body),
  // Image collée seule : { x, y, width, height } = place et taille d'affichage
  createImage: (file, box) => post('/notes/image', imageForm(file, box)),
  // Image insérée dans le texte d'un post-it → { url } signée
  uploadMedia: (file) => post('/media', imageForm(file)),
  updateNote: (id, body) => axios.patch(`${API_URL}/tableau/notes/${id}`, body).then((r) => r.data),
  deleteNote: (id) => axios.delete(`${API_URL}/tableau/notes/${id}`).then((r) => r.data),
  send: (noteId, toUserId, mode) => post('/transfers', { note_id: noteId, to_user_id: toUserId, mode }),
  accept: (id) => post(`/transfers/${id}/accept`),
  refuse: (id) => post(`/transfers/${id}/refuse`),
  cancel: (id) => post(`/transfers/${id}/cancel`),
  seen: (id) => post(`/transfers/${id}/seen`),
  tasks: () => axios.get(`${API_URL}/tableau/tasks`).then((r) => r.data),
  createTask: (body) => post('/tasks', body),
  updateTask: (id, body) => axios.put(`${API_URL}/tableau/tasks/${id}`, body).then((r) => r.data),
  deleteTask: (id) => axios.delete(`${API_URL}/tableau/tasks/${id}`).then((r) => r.data),
  done: (id) => post(`/tasks/${id}/done`),
  undo: (id) => post(`/tasks/${id}/undo`),
  dismissReminder: (id) => post(`/tasks/${id}/dismiss-reminder`),
};

export const apiError = (e) => e?.response?.data?.error || e?.message || 'Erreur';

/* ─── Images ─── */

/** Fichiers image d'un presse-papiers ou d'un dépôt (DataTransfer). */
export const imageFilesOf = (dataTransfer) =>
  Array.from(dataTransfer?.items || [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f) => f && (f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name)));

/**
 * Remet une image dans le presse-papiers, pour la coller ailleurs (mail, SAV…).
 * Toujours en PNG : c'est le seul format image que les navigateurs acceptent d'y
 * écrire. Le blob est passé en promesse, sans quoi Safari refuse l'écriture
 * (elle doit partir dans le geste de l'utilisateur).
 */
export async function copyImageToClipboard(url) {
  const toPng = async () => {
    const blob = await (await fetch(url)).blob();
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  };
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng() })]);
}

/** Aperçu texte d'un post-it (HTML) : son texte, et le nombre d'images. */
export function previewText(html, max = 140) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const images = doc.querySelectorAll('img').length;
  doc.querySelectorAll('br').forEach((el) => el.replaceWith(' '));
  doc.querySelectorAll('p, li').forEach((el) => el.append(' '));
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  const cut = text.length > max ? `${text.slice(0, max)}…` : text;
  const imgs = images ? `(${images} image${images > 1 ? 's' : ''})` : '';
  return [cut, imgs].filter(Boolean).join(' ') || '(post-it vide)';
}

/* ─── Dates (chaînes 'YYYY-MM-DD', jamais new Date(chaîne)) ─── */

const parseYmd = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const ymdOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const localToday = () => ymdOf(new Date());
/** Jour ISO (1 = lundi … 7 = dimanche) d'une date 'YYYY-MM-DD'. */
export const isoDowOf = (ymd) => parseYmd(ymd).getDay() || 7;
export const addDaysYmd = (ymd, n) => {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdOf(d);
};

const DOW_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/** « aujourd'hui », « demain », « hier », sinon « jeu. 23/10 ». */
export function formatDay(ymd, today = localToday()) {
  if (ymd === today) return "aujourd'hui";
  if (ymd === addDaysYmd(today, 1)) return 'demain';
  if (ymd === addDaysYmd(today, -1)) return 'hier';
  const d = parseYmd(ymd);
  const sameYear = ymd.slice(0, 4) === today.slice(0, 4);
  return `${DOW_SHORT[d.getDay()]} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}${sameYear ? '' : `/${ymd.slice(0, 4)}`}`;
}

export const formatDue = (ymd, time, today) => `${formatDay(ymd, today)}${time ? ` à ${time.replace(':', 'h')}` : ''}`;

/* ─── Récurrence ─── */

export const WEEKDAYS = [
  { n: 1, short: 'L', label: 'lundi' }, { n: 2, short: 'M', label: 'mardi' },
  { n: 3, short: 'M', label: 'mercredi' }, { n: 4, short: 'J', label: 'jeudi' },
  { n: 5, short: 'V', label: 'vendredi' }, { n: 6, short: 'S', label: 'samedi' },
  { n: 7, short: 'D', label: 'dimanche' },
];

const joinFr = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

/** « Tous les lundis et jeudis », « Toutes les 2 semaines, le lundi », « Le 31 de chaque mois »… */
export function ruleSummary(t) {
  if (t.unit === 'day') return t.every === 1 ? 'Tous les jours' : `Tous les ${t.every} jours`;
  if (t.unit === 'week') {
    const days = (t.weekdays || []).map((n) => WEEKDAYS[n - 1].label);
    if (t.every === 1) {
      if (days.length === 7) return 'Tous les jours';
      return `Tous les ${joinFr(days.map((d) => `${d}s`))}`;
    }
    return `Toutes les ${t.every} semaines, le ${joinFr(days)}`;
  }
  const day = t.month_day === 31 ? 'dernier jour' : (t.month_day === 1 ? '1er' : t.month_day);
  if (t.every === 1) return `Le ${day} de chaque mois`;
  if (t.every === 12) return `Le ${day}, tous les ans`;
  return `Le ${day}, tous les ${t.every} mois`;
}

/** Libellé d'un délai de rappel en minutes. */
export function reminderLabel(minutes) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes === 0) return "à l'heure";
  if (minutes % 1440 === 0) return `${minutes / 1440} j avant`;
  if (minutes % 60 === 0) return `${minutes / 60} h avant`;
  return `${minutes} min avant`;
}
