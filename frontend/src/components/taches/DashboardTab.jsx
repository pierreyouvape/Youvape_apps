import { useCallback, useEffect, useMemo, useState } from 'react';
import { tachesApi, apiError, todayStr, addDays, M, inputStyle, mTable, mTh, mTd } from './tachesShared';
import { Avatar } from './tachesUi';

/*
 * Tableau de bord : combien de choses à faire, en cours, bloquées, faites —
 * en tout et par personne. Couleurs = statuts Monday (état, jamais seules :
 * légende + tableau chiffré). Le gris « À faire » est foncé ici pour se voir
 * sur fond blanc.
 */
const BUCKETS = [
  { key: 'a_faire', label: 'À faire', color: '#9699A6' },
  { key: 'en_cours', label: 'En cours', color: '#FDAB3D' },
  { key: 'bloque', label: 'Bloqué', color: '#DF2F4A' },
  { key: 'fait', label: 'Fait (période)', color: '#00C875' },
];
const PERIODS = [{ d: 7, label: '7 derniers jours' }, { d: 30, label: '30 derniers jours' }, { d: 90, label: '90 derniers jours' }];
const ACTIVE = ['en_cours', 'attente_correction', 'suivi_google', 'longue'];

/** « Unité de travail » d'une personne : une étape à son nom, ou une tâche sans étape dont elle est la personne. */
function workItems(tasks) {
  const out = [];
  tasks.forEach((t) => {
    if (t.steps.length) {
      t.steps.forEach((s) => out.push({
        task: t, name: s.name, people: s.owners, status: s.status, due: s.due_date, doneAt: s.done_at,
      }));
    } else {
      out.push({
        task: t, name: t.title, people: t.people, status: t.status, due: t.due_date,
        doneAt: t.status === 'fait' ? t.updated_at : null, // pas d'horodatage « fait » pour une tâche sans étape
      });
    }
  });
  return out;
}
const bucketOf = (st) => (st === 'fait' ? 'fait' : st === 'bloque' ? 'bloque' : ACTIVE.includes(st) ? 'en_cours' : 'a_faire');

export default function DashboardTab({ boards, members, onOpenPerson, onError }) {
  const [tasks, setTasks] = useState(null);
  const [boardId, setBoardId] = useState('all');
  const [period, setPeriod] = useState(30);
  const [tip, setTip] = useState(null); // { x, y, text }

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.board({ board: boardId === 'all' ? undefined : boardId }));
    } catch (e) { onError(apiError(e)); }
  }, [boardId, onError]);
  useEffect(() => { load(); }, [load]);

  const today = todayStr();
  const since = addDays(today, -period);

  const stats = useMemo(() => {
    if (!tasks) return null;
    const items = workItems(tasks);
    const inPeriod = (it) => it.status === 'fait' && it.doneAt && it.doneAt.slice(0, 10) >= since;
    const count = (list) => {
      const c = { a_faire: 0, en_cours: 0, bloque: 0, fait: 0, late: 0, open: 0 };
      list.forEach((it) => {
        const b = bucketOf(it.status);
        if (b === 'fait') { if (inPeriod(it)) c.fait += 1; return; }
        c[b] += 1;
        c.open += 1;
        if (it.due && it.due < today) c.late += 1;
      });
      return c;
    };
    // Tâches (niveau tâche)
    const t = { total: tasks.length, fait: 0, en_cours: 0, a_faire: 0, bloque: 0, late: 0, doneInPeriod: 0 };
    tasks.forEach((x) => {
      const b = x.status === 'longue' ? 'en_cours' : x.status;
      t[b] = (t[b] || 0) + 1;
      if (x.status !== 'fait' && x.due_date && x.due_date < today) t.late += 1;
    });
    t.doneInPeriod = new Set(items.filter(inPeriod).map((it) => it.task.id)).size;
    const people = members.filter((m) => m.has_app !== false).map((m) => ({
      ...m, c: count(items.filter((it) => it.people.includes(m.id))),
    })).sort((a, b) => b.c.open - a.c.open);
    const nobody = count(items.filter((it) => !it.people.length));
    // Faits par semaine (8 dernières semaines, lundi → dimanche)
    const monday = (d) => { const wd = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; return addDays(d, -wd); };
    const start = addDays(monday(today), -7 * 7);
    const weeks = Array.from({ length: 8 }, (_, i) => ({ from: addDays(start, 7 * i), n: 0 }));
    items.forEach((it) => {
      if (it.status !== 'fait' || !it.doneAt) return;
      const d = it.doneAt.slice(0, 10);
      const w = weeks.find((x) => d >= x.from && d < addDays(x.from, 7));
      if (w) w.n += 1;
    });
    const undated = items.filter((it) => it.status === 'fait' && !it.doneAt).length;
    // Par étiquette (ouvert)
    const byLabel = new Map();
    tasks.filter((x) => x.status !== 'fait').forEach((x) => x.labels.forEach((l) => byLabel.set(l, (byLabel.get(l) || 0) + 1)));
    return {
      t, people, nobody, weeks, undated,
      labels: [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [tasks, members, since, today]);

  if (!stats) return <div style={{ color: M.sub, padding: 20 }}>Chargement…</div>;

  const tile = (label, value, hint, color) => (
    <div style={{ flex: '1 1 150px', border: `1px solid ${M.border}`, borderRadius: 8, padding: '12px 14px', background: '#fff' }}>
      <div style={{ fontSize: 13, color: M.sub, display: 'flex', alignItems: 'center', gap: 6 }}>
        {color && <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />}{label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, color: M.text, marginTop: 2 }}>{value.toLocaleString('fr-FR')}</div>
      {hint && <div style={{ fontSize: 12, color: M.sub }}>{hint}</div>}
    </div>
  );
  const maxOpen = Math.max(1, ...stats.people.map((p) => p.c.a_faire + p.c.en_cours + p.c.bloque + p.c.fait));
  // Axe : maximum arrondi à un nombre « rond », graduations entières à leur vraie hauteur.
  const rawMax = Math.max(1, ...stats.weeks.map((w) => w.n));
  const step = rawMax <= 4 ? 1 : 10 ** Math.floor(Math.log10(rawMax / 2)) * ([1, 2, 5].find((k) => k * 10 ** Math.floor(Math.log10(rawMax / 2)) * 2 >= rawMax / 2) || 10);
  const maxWeek = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(maxWeek / step) }, (_, i) => (i + 1) * step).filter((v, i, a) => a.length <= 4 || i % 2 === 1 || v === maxWeek);
  const show = (e, text) => setTip({ x: e.clientX, y: e.clientY, text });
  const periodLabel = PERIODS.find((p) => p.d === period).label.toLowerCase();
  const h2 = { fontSize: 18, fontWeight: 600, margin: '28px 0 4px', color: M.text };
  const sub = { fontSize: 13, color: M.sub, margin: '0 0 12px' };

  return (
    <div style={{ fontFamily: M.font, color: M.text }} onMouseLeave={() => setTip(null)}>
      {/* Filtres : une ligne, au-dessus de tout */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)} style={{ ...inputStyle, width: 240, padding: '7px 8px', fontSize: 13 }}>
          <option value="all">Tous les tableaux</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div style={{ display: 'flex', border: `1px solid ${M.border}`, borderRadius: 6, overflow: 'hidden' }}>
          {PERIODS.map((p) => (
            <button key={p.d} type="button" onClick={() => setPeriod(p.d)} style={{
              border: 'none', padding: '7px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              background: period === p.d ? '#0073EA' : '#fff', color: period === p.d ? '#fff' : M.text,
            }}>{p.label}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: M.sub }}>La période compte ce qui a été <strong>fait</strong> ; le reste est l'état d'aujourd'hui.</span>
      </div>

      {/* Chiffres clés (niveau tâche) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tile('Tâches actives', stats.t.total - stats.t.fait, `${stats.t.total.toLocaleString('fr-FR')} au total`)}
        {tile('À faire', stats.t.a_faire, 'aucune étape commencée', '#9699A6')}
        {tile('En cours', stats.t.en_cours, 'dont tâches de fond', '#FDAB3D')}
        {tile('Bloquées', stats.t.bloque, 'statut « Bloqué »', '#DF2F4A')}
        {tile('En retard', stats.t.late, 'échéance passée, non terminée')}
        {tile('Terminées', stats.t.fait, `${stats.t.doneInPeriod} tâche${stats.t.doneInPeriod > 1 ? 's ont' : ' a'} avancé (étape faite) sur ${periodLabel}`, '#00C875')}
      </div>

      {/* Par personne : barre segmentée + tableau */}
      <h2 style={h2}>Par personne</h2>
      <p style={sub}>Étapes à son nom (et tâches sans étape dont elle est la personne). Cliquez une personne pour voir ses tâches.</p>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: M.sub, marginBottom: 10, flexWrap: 'wrap' }}>
        {BUCKETS.map((b) => (
          <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: b.color }} />{b.label}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
        {stats.people.map((p) => {
          const total = p.c.a_faire + p.c.en_cours + p.c.bloque + p.c.fait;
          return (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 70px', alignItems: 'center', gap: 12 }}>
              <button type="button" onClick={() => onOpenPerson(p.id)} title={`Voir les tâches de ${p.name}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: M.text, padding: 0, textAlign: 'left' }}>
                <Avatar id={p.id} name={p.name} size={26} />{p.name}
              </button>
              <div style={{ height: 24, display: 'flex', gap: 2, width: `${Math.max(2, (total / maxOpen) * 100)}%` }}>
                {BUCKETS.map((b, i) => {
                  const n = p.c[b.key];
                  if (!n) return null;
                  const visible = BUCKETS.filter((x) => p.c[x.key]);
                  const last = visible[visible.length - 1].key === b.key;
                  return (
                    <div key={b.key}
                      onMouseMove={(e) => show(e, `${p.name} · ${b.label} : ${n}`)} onMouseLeave={() => setTip(null)}
                      style={{
                        flex: n, background: b.color, minWidth: 3, height: '100%',
                        borderRadius: last ? '0 4px 4px 0' : 0, cursor: 'default',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: b.key === 'en_cours' ? '#0b0b0b' : '#fff', fontSize: 12, fontWeight: 600,
                      }}
                      data-i={i}>
                      {n / maxOpen > 0.06 ? n : ''}
                    </div>
                  );
                })}
              </div>
              <span style={{ fontSize: 13, color: M.sub, textAlign: 'right' }}>{p.c.open} ouvertes</span>
            </div>
          );
        })}
      </div>

      <table style={{ ...mTable, tableLayout: 'auto', maxWidth: 900 }}>
        <thead>
          <tr>
            <th style={{ ...mTh, textAlign: 'left' }}>Personne</th>
            <th style={mTh}>À faire</th>
            <th style={mTh}>En cours</th>
            <th style={mTh}>Bloquées</th>
            <th style={mTh}>En retard</th>
            <th style={mTh}>Faites ({periodLabel})</th>
            <th style={{ ...mTh, borderRight: 'none' }}>Total ouvert</th>
          </tr>
        </thead>
        <tbody>
          {stats.people.map((p) => (
            <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onOpenPerson(p.id)}
              onMouseEnter={(e) => { e.currentTarget.style.background = M.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}>
              <td style={{ ...mTd, textAlign: 'left' }}>{p.name}</td>
              <td style={mTd}>{p.c.a_faire}</td>
              <td style={mTd}>{p.c.en_cours}</td>
              <td style={mTd}>{p.c.bloque}</td>
              <td style={{ ...mTd, color: p.c.late ? '#B91C1C' : M.text, fontWeight: p.c.late ? 600 : 400 }}>{p.c.late}</td>
              <td style={mTd}>{p.c.fait}</td>
              <td style={{ ...mTd, fontWeight: 600, borderRight: 'none' }}>{p.c.open}</td>
            </tr>
          ))}
          {stats.nobody.open > 0 && (
            <tr>
              <td style={{ ...mTd, textAlign: 'left', color: M.sub, fontStyle: 'italic' }}>Sans responsable</td>
              <td style={mTd}>{stats.nobody.a_faire}</td>
              <td style={mTd}>{stats.nobody.en_cours}</td>
              <td style={mTd}>{stats.nobody.bloque}</td>
              <td style={mTd}>{stats.nobody.late}</td>
              <td style={mTd}>{stats.nobody.fait}</td>
              <td style={{ ...mTd, borderRight: 'none' }}>{stats.nobody.open}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Rythme : étapes faites par semaine */}
      <h2 style={h2}>Étapes faites par semaine</h2>
      <p style={sub}>
        8 dernières semaines, tout le monde.
        {stats.undated > 0 && ` ${stats.undated.toLocaleString('fr-FR')} étapes faites sans date (importées de Monday) n'y figurent pas.`}
      </p>
      <div style={{ position: 'relative', height: 180, maxWidth: 900, borderBottom: `1px solid ${M.border}`, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '0 8px' }}>
        {ticks.map((v) => (
          <div key={v} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(v / maxWeek) * 150}px`, borderTop: `1px solid ${M.grid}` }}>
            <span style={{ position: 'absolute', right: '100%', marginRight: 4, top: -8, fontSize: 11, color: M.sub }}>{v}</span>
          </div>
        ))}
        {stats.weeks.map((w) => (
          <div key={w.from} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', position: 'relative', zIndex: 1 }}
            onMouseMove={(e) => show(e, `Semaine du ${new Date(`${w.from}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${w.n} étape${w.n > 1 ? 's' : ''} faite${w.n > 1 ? 's' : ''}`)}
            onMouseLeave={() => setTip(null)}>
            <span style={{ fontSize: 12, color: M.text, marginBottom: 3 }}>{w.n || ''}</span>
            <div style={{ width: 24, height: `${(w.n / maxWeek) * 150}px`, background: '#0073EA', borderRadius: '4px 4px 0 0', minHeight: w.n ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 8px 0', maxWidth: 900 }}>
        {stats.weeks.map((w) => (
          <span key={w.from} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: M.sub }}>
            {new Date(`${w.from}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
        ))}
      </div>

      {/* Étiquettes */}
      <h2 style={h2}>Tâches ouvertes par étiquette</h2>
      <p style={sub}>Les 10 étiquettes qui ont le plus de tâches non terminées.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 700 }}>
        {stats.labels.map(([l, n]) => (
          <div key={l} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 40px', alignItems: 'center', gap: 10 }}
            onMouseMove={(e) => show(e, `${l} : ${n} tâche${n > 1 ? 's' : ''} ouverte${n > 1 ? 's' : ''}`)} onMouseLeave={() => setTip(null)}>
            <span style={{ fontSize: 13, color: M.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</span>
            <div style={{ height: 16, width: `${(n / stats.labels[0][1]) * 100}%`, background: '#579BFC', borderRadius: '0 4px 4px 0', minWidth: 3 }} />
            <span style={{ fontSize: 13, color: M.text }}>{n}</span>
          </div>
        ))}
        {!stats.labels.length && <span style={{ fontSize: 13, color: M.sub }}>Aucune étiquette sur les tâches ouvertes.</span>}
      </div>

      {tip && (
        <div style={{
          position: 'fixed', left: tip.x + 12, top: tip.y + 12, background: '#323338', color: '#fff', fontSize: 12,
          padding: '6px 9px', borderRadius: 6, pointerEvents: 'none', zIndex: 4000, whiteSpace: 'nowrap',
        }}>{tip.text}</div>
      )}
    </div>
  );
}
