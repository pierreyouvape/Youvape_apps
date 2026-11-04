import axios from 'axios';
import { API_URL, authHeaders, C } from '../picking/pickingUi';
import { pdaBtn as bigBtn } from '../pda/pdaStyles';

/** Appels et styles communs aux écrans PDA de l'Inventaire (classique et par emplacement). */

let onUnauthorized = null;
export const setOnUnauthorized = (fn) => { onUnauthorized = fn; };
const unauthorized = (err) => {
  if (err.response?.status === 401) onUnauthorized?.();
  throw err;
};

export const api = (token) => {
  const base = `${API_URL}/inventaire/pda`;
  const h = authHeaders(token);
  return {
    get: (url) => axios.get(base + url, h).then(r => r.data, unauthorized),
    post: (url, body = {}) => axios.post(base + url, body, h).then(r => r.data, unauthorized),
    put: (url, body = {}) => axios.put(base + url, body, h).then(r => r.data, unauthorized),
    del: (url) => axios.delete(base + url, h).then(r => r.data, unauthorized),
  };
};

export const errorText = (err) => err.response?.data?.error || (err.response?.status === 403
  ? 'Vous n\'avez pas le droit Picking : demandez-le à un responsable.'
  : err.message);

export const BLUE = '#0369A1';
export const locLabel = (l) => l || 'Sans emplacement';
export const pct = (n, total) => (total ? Math.floor((n / total) * 100) : 0);

export const card = { background: C.white, borderRadius: 14, border: `1px solid ${C.greyB}`, padding: 14 };
export const smallBtn = { ...bigBtn(C.white, C.dark), border: `1px solid ${C.greyB}`, fontSize: 14, padding: '9px 12px' };
export const input = {
  width: '100%', boxSizing: 'border-box', padding: 14, fontSize: 26, fontWeight: 800, borderRadius: 10,
  border: `2px solid ${C.greyB}`, fontFamily: 'inherit', textAlign: 'center',
};
