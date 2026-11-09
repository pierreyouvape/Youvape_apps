/**
 * Suivi SEO : lecture des pages cibles (09/11/2026).
 *
 * Deux questions SÉPARÉES, qui peuvent se contredire :
 *   - Part : quand Google affiche une de nos pages sur la requête, est-ce la page cible ?
 *   - Position : la page cible est-elle mieux ou moins bien classée qu'au départ ?
 * Le verdict ne porte que sur la part.
 *
 * Les « 28 derniers jours » ne servent pas de mesure tant que la décision a moins
 * de 28 jours : ils mélangeraient l'avant et l'après (« gros fumeur » : 80,9 % sur
 * 28 j, donc « gagnée », alors que la page ne faisait que 72,8 % depuis la décision).
 */

const PART_GAGNEE = 80;
// Sous ces volumes, un pourcentage ou une position ne veut rien dire
// (« magasin » : position 1 au départ, sur 3 impressions seulement).
const MIN_IMPRESSIONS_PART = 100;
const MIN_IMPRESSIONS_POSITION = 30;
// En deçà, on ne parle pas d'évolution.
const STABLE_PART_POINTS = 2;
const STABLE_POSITION_PLACES = 0.5;

const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => String(v).replace('.', ',');

// Fenêtre de mesure : depuis la décision, ou les 28 derniers jours quand la
// décision est plus ancienne. Null tant que rien n'a été mesuré depuis la décision.
const currentWindow = (stats) => {
  const since = stats?.since;
  const last28 = stats?.last28;
  if (!since) return null;
  if (last28?.from && since.from <= last28.from) return last28;
  return since;
};

const readShare = (base, cur) => {
  const from = base?.target_share ?? null;
  const to = cur?.target_share ?? null;
  if (!cur || from === null || to === null
    || (base.impressions || 0) < MIN_IMPRESSIONS_PART || (cur.impressions || 0) < MIN_IMPRESSIONS_PART) {
    return { from, to, delta: null, status: 'peu', label: 'Peu de données' };
  }
  const delta = round1(to - from);
  if (Math.abs(delta) < STABLE_PART_POINTS) return { from, to, delta, status: 'stable', label: '= stable' };
  return delta > 0
    ? { from, to, delta, status: 'hausse', label: `▲ +${num(delta)} pts` }
    : { from, to, delta, status: 'baisse', label: `▼ −${num(Math.abs(delta))} pts` };
};

const placesLabel = (delta, word) => {
  const n = Math.abs(delta);
  return `${num(n)} ${n >= 2 ? `places ${word}s` : `place ${word}`}`;
};

const readPosition = (base, cur) => {
  const enough = (w) => (w?.target_impressions || 0) >= MIN_IMPRESSIONS_POSITION && w?.target_position != null;
  const from = enough(base) ? base.target_position : null;
  const to = enough(cur) ? cur.target_position : null;
  if (from === null || to === null) return { from, to, delta: null, status: 'peu', label: 'Peu de données' };
  // Une position qui baisse est une place gagnée.
  const delta = round1(from - to);
  if (Math.abs(delta) < STABLE_POSITION_PLACES) return { from, to, delta, status: 'stable', label: '= stable' };
  return delta > 0
    ? { from, to, delta, status: 'gagnee', label: `▲ ${placesLabel(delta, 'gagnée')}` }
    : { from, to, delta, status: 'perdue', label: `▼ ${placesLabel(delta, 'perdue')}` };
};

const readTarget = (stats) => {
  const base = stats?.baseline || null;
  const cur = currentWindow(stats);
  return {
    from: cur?.from || null,
    to: cur?.to || null,
    impressions: cur?.impressions ?? null,
    share: readShare(base, cur),
    position: readPosition(base, cur),
  };
};

// `waiting` : décision ou dernière modification de la page de moins de 28 jours.
const verdictOf = (stats, waiting) => {
  const cur = currentWindow(stats);
  if (!cur) return { code: 'attente', label: 'En attente de mesure' };
  if ((cur.impressions || 0) < MIN_IMPRESSIONS_PART) return { code: 'vide', label: 'Pas assez de données' };
  const wasWon = (stats.baseline?.target_share ?? 0) >= PART_GAGNEE;
  if (cur.target_share >= PART_GAGNEE) {
    return wasWon ? { code: 'acquise', label: 'Déjà acquise' } : { code: 'gagnee', label: 'Gagnée' };
  }
  if (wasWon) return { code: 'perdue', label: 'Perdue' };
  return waiting ? { code: 'attente', label: 'En attente de mesure' } : { code: 'revoir', label: 'À revoir' };
};

/* ─── Rapport du lundi ─────────────────────────────────── */

const COLORS = {
  gagnee: '#15803d', acquise: '#15803d', perdue: '#b91c1c', revoir: '#b91c1c', attente: '#b45309', vide: '#6b7280',
  hausse: '#15803d', baisse: '#b91c1c', stable: '#6b7280', peu: '#6b7280',
};
const VERDICT_ORDER = [
  ['gagnee', 'gagnée', 'gagnées'], ['acquise', 'déjà acquise', 'déjà acquises'], ['perdue', 'perdue', 'perdues'],
  ['revoir', 'à revoir', 'à revoir'], ['attente', 'en attente', 'en attente'], ['vide', 'sans assez de données', 'sans assez de données'],
];
const CELL = 'padding:4px 8px';
const NUM = `${CELL};text-align:right;white-space:nowrap`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => (v === null || v === undefined ? '—' : `${num(v)} %`);
const pos = (v) => (v === null || v === undefined ? '—' : num(v));
const frDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
const dayCount = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
const colored = (status, text) => `<span style="color:${COLORS[status] || '#374151'}">${esc(text)}</span>`;

const howToReadPositions = () => `<p style="background:#f8fafc;padding:8px 12px;font-size:13px"><b>Comment lire ce tableau</b><br>
<b>Position</b> : rang moyen sur Google (1 = premier résultat). Plus le chiffre est bas, mieux c'est.<br>
<b>Évolution</b> : <span style="color:#15803d">▲ places gagnées</span>, <span style="color:#b91c1c">▼ places perdues</span>, par rapport à la semaine précédente.<br>
<b>Impressions</b> : nombre de fois où YouVape s'est affiché dans Google. <b>Clics</b> : nombre de fois où l'internaute a cliqué.</p>`;

// Fenêtre la plus fréquente : les cibles décidées le même jour la partagent.
const mainWindow = (targets) => {
  const counts = new Map();
  for (const t of targets) {
    if (t.reading.from) {
      const k = `${t.reading.from}|${t.reading.to}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [from, to] = best[0].split('|');
  return { from, to, days: dayCount(from, to), all: counts.size === 1 };
};

const summaryLine = (targets) => {
  const n = (code) => targets.filter((t) => t.verdict.code === code).length;
  const verdicts = VERDICT_ORDER.filter(([code]) => n(code))
    .map(([code, one, many]) => `${n(code)} ${n(code) > 1 ? many : one}`).join(', ');
  const p = (status) => targets.filter((t) => t.reading.position.status === status).length;
  return `<b>Part :</b> ${verdicts}.<br><b>Position :</b> ${p('gagnee')} en progrès, ${p('perdue')} en recul, ${p('stable')} stables, ${p('peu')} avec trop peu de données.`;
};

const renderTargetsHtml = (targets, seuil = PART_GAGNEE) => {
  const w = mainWindow(targets);
  const period = w
    ? `${w.all ? 'Mesure actuelle' : 'Mesure actuelle, pour la plupart des pages'} : du ${frDate(w.from)} au ${frDate(w.to)} (${w.days} jours)`
    : 'Pas encore de mesure depuis la décision';
  const short = w && w.days < 28 ? ` Moins de 28 jours de recul : à confirmer dans les prochaines semaines.` : '';
  const rows = targets.map((t) => {
    const { share, position } = t.reading;
    return `<tr><td style="${CELL}">${esc(t.label)}<br><span style="color:#6b7280;font-size:11px">${esc(t.target_path)}</span></td>`
      + `<td style="${NUM}">${pct(share.from)}</td><td style="${NUM}"><b>${pct(share.to)}</b></td><td style="${NUM}">${colored(share.status, share.label)}</td>`
      + `<td style="${CELL};white-space:nowrap">${colored(t.verdict.code, t.verdict.label)}</td>`
      + `<td style="${NUM};border-left:3px solid #94a3b8">${pos(position.from)}</td><td style="${NUM}"><b>${pos(position.to)}</b></td><td style="${NUM}">${colored(position.status === 'gagnee' ? 'hausse' : position.status === 'perdue' ? 'baisse' : position.status, position.label)}</td></tr>`;
  }).join('\n');
  return `<h3 style="font-family:Arial,sans-serif;margin:20px 0 6px">Pages cibles</h3>
<p style="margin:0 0 8px">${summaryLine(targets)}</p>
<div style="background:#f8fafc;padding:8px 12px;font-size:13px;margin-bottom:8px"><b>Comment lire ce tableau</b> : deux questions séparées. Une page peut gagner sur l'une et perdre sur l'autre.<br>
<b>Part (Google montre-t-il la bonne page ?)</b> : sur 100 affichages de nos pages pour cette requête, combien sont pour la page choisie. Elle compare nos pages entre elles, pas YouVape aux concurrents.<br>
<b>Position (la page choisie est-elle mieux classée ?)</b> : son rang moyen sur Google. Plus le chiffre est bas, mieux c'est.<br>
<b>Départ</b> = avant la décision. <b>Actuelle</b> = depuis la décision, ou les 28 derniers jours quand elle est plus ancienne. ${esc(period)}.${esc(short)}<br>
<b>Verdict (sur la part seulement, seuil ${seuil} %)</b> :
<span style="color:#15803d">Gagnée</span> = sous le seuil au départ, au-dessus maintenant ;
<span style="color:#15803d">Déjà acquise</span> = elle le passait déjà au départ ;
<span style="color:#b91c1c">Perdue</span> = elle le passait au départ, plus maintenant ;
<span style="color:#b45309">En attente de mesure</span> = sous le seuil, décision ou modification de moins de 28 jours, on ne touche à rien ;
<span style="color:#b91c1c">À revoir</span> = sous le seuil après 28 jours, il faut agir.<br>
<b>Peu de données</b> : moins de ${MIN_IMPRESSIONS_PART} impressions sur la requête ou moins de ${MIN_IMPRESSIONS_POSITION} sur la page cible : aucune conclusion possible.</div>
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px" border="1">
<tr style="background:#f2f6f8"><th style="${CELL}" rowspan="2">Requête et page cible</th><th style="${CELL}" colspan="4">Part de la page cible</th><th style="${CELL};border-left:3px solid #94a3b8" colspan="3">Position de la page cible</th></tr>
<tr style="background:#f2f6f8"><th style="${CELL}">Départ</th><th style="${CELL}">Actuelle</th><th style="${CELL}">Évolution</th><th style="${CELL}">Verdict</th><th style="${CELL};border-left:3px solid #94a3b8">Départ</th><th style="${CELL}">Actuelle</th><th style="${CELL}">Gagnée ou perdue</th></tr>
${rows}
</table>`;
};

module.exports = {
  PART_GAGNEE, MIN_IMPRESSIONS_PART, MIN_IMPRESSIONS_POSITION,
  currentWindow, readTarget, verdictOf, renderTargetsHtml, howToReadPositions,
};
