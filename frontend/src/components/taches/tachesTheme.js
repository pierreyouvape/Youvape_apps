import { useEffect, useState } from 'react';

/**
 * Thème de l'app Tâches (clair / sombre, comme Monday). Les couleurs neutres des
 * écrans sont des variables --tk-* ; les valeurs claires sont celles d'origine.
 * Les couleurs de statut, de priorité et des avatars ne changent pas.
 */
const LIGHT = {
  surface: '#FFFFFF', bg2: '#FAFBFC', hover: '#F5F6F8',
  text: '#323338', text2: '#374151', sub: '#676879', muted: '#9CA3AF', faint: '#C3C6D4',
  border: '#D0D4E4', line: '#E5E7EB', grid: '#E6E9EF', line2: '#EEF0F3',
  sel: '#E5F4FF', sel2: '#CCE5FF', chip: '#E0EAFF', chipInk: '#1E40AF',
  danger: '#B91C1C', dangerBg: '#FEE2E2', dangerLine: '#FCA5A5', okBg: '#DCFCE7', okInk: '#166534',
  warn: '#B45309', focus: '#93C5FD', mark: '#FEF08A', barSoft: '#A9CCF5', link: '#0073EA', todo: '#C4C4C4',
};
const DARK = {
  surface: '#22243A', bg2: '#1B1D30', hover: '#2E3150',
  text: '#E6E8EF', text2: '#D5D8DF', sub: '#A9ACBD', muted: '#8E91A5', faint: '#6B6F8C',
  border: '#4B4E69', line: '#3A3D5C', grid: '#3A3D5C', line2: '#303352',
  sel: '#1E3A5F', sel2: '#24467A', chip: '#2B3A66', chipInk: '#C7D7FF',
  danger: '#FF8A9A', dangerBg: '#4A1F2A', dangerLine: '#9B3A4A', okBg: '#173A2A', okInk: '#86EFAC',
  warn: '#FBBF24', focus: '#4C7BD9', mark: '#6B5900', barSoft: '#3A5F92', link: '#6CB4FF', todo: '#6C7089',
};

const vars = (t) => Object.entries(t).map(([k, v]) => `--tk-${k}:${v};`).join('');

export const THEME_CSS = `
.tk-root{${vars(LIGHT)}color-scheme:light;}
.tk-root[data-theme="dark"]{${vars(DARK)}color-scheme:dark;}
.tk-root[data-theme="dark"] input,.tk-root[data-theme="dark"] select,.tk-root[data-theme="dark"] textarea{
  background-color:var(--tk-surface);color:var(--tk-text);border-color:var(--tk-border);}
.tk-root[data-theme="dark"] input::placeholder,.tk-root[data-theme="dark"] textarea::placeholder{color:var(--tk-muted);}
.tk-root[data-theme="dark"] a{color:var(--tk-link);}
.tk-root[data-theme="dark"] mark{color:var(--tk-text);}
`;

const KEY = 'yv.taches.theme';

/** Thème choisi, gardé dans ce navigateur. */
export function useTachesTheme() {
  const [theme, setTheme] = useState(() => (localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'));
  useEffect(() => { localStorage.setItem(KEY, theme); }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
