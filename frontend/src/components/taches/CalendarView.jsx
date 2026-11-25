import { useMemo, useRef, useState } from 'react';
import { tachesApi, apiError, todayStr, addDays, daysBetween, btn, STEP_STATUS, TASK_STATUS } from './tachesShared';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MAX_PER_DAY = 5;

/**
 * Vue Calendrier : chaque tâche datée (et chaque étape datée) sur ses jours.
 * Glisser un élément sur un autre jour le décale, durée conservée.
 * « + » sur un jour crée une tâche à cette date.
 */
export default function CalendarView({ tasks, loading, onOpen, onTaskChange, onError, onNew }) {
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [over, setOver] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const dragged = useRef(null);

  // Grille du lundi avant le 1er au dimanche après la fin du mois.
  const { first, cells } = useMemo(() => {
    const f = `${month}-01`;
    const wd = (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7;
    const start = addDays(f, -wd);
    const next = addDays(f, 32).slice(0, 7);
    const last = addDays(`${next}-01`, -1);
    const lwd = (new Date(`${last}T12:00:00Z`).getUTCDay() + 6) % 7;
    const n = daysBetween(start, addDays(last, 6 - lwd)) + 1;
    return { first: f, cells: Array.from({ length: n }, (_, i) => addDays(start, i)) };
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map();
    const put = (d, item) => { if (!map.has(d)) map.set(d, []); map.get(d).push(item); };
    const lo = cells[0];
    const hi = cells[cells.length - 1];
    const spread = (item, s, e) => {
      let d = s < lo ? lo : s;
      const end = e > hi ? hi : e;
      for (let i = 0; d <= end && i < 62; i += 1, d = addDays(d, 1)) put(d, { ...item, first: d === s });
    };
    tasks.forEach((t) => {
      if (t.start_date || t.due_date) {
        spread({ key: `t${t.id}`, kind: 'task', id: t.id, task: t, label: t.title, color: TASK_STATUS[t.status]?.bg, start: t.start_date || t.due_date, end: t.due_date || t.start_date },
          t.start_date || t.due_date, t.due_date || t.start_date);
      }
      t.steps.forEach((s) => {
        if (s.start_date || s.due_date) {
          spread({ key: `s${s.id}`, kind: 'step', id: s.id, task: t, label: `${s.name} · ${t.title}`, color: STEP_STATUS[s.status].bg, start: s.start_date || s.due_date, end: s.due_date || s.start_date },
            s.start_date || s.due_date, s.due_date || s.start_date);
        }
      });
    });
    return map;
  }, [tasks, cells]);

  const moveTo = async (item, fromDay, day) => {
    const delta = daysBetween(fromDay, day);
    if (!delta) return;
    const body = { start_date: addDays(item.start, delta), due_date: addDays(item.end, delta) };
    try {
      onTaskChange(item.kind === 'step' ? await tachesApi.updateStep(item.id, body) : await tachesApi.updateTask(item.id, body));
    } catch (e) { onError(apiError(e)); }
  };

  if (loading) return <div style={{ color: '#9CA3AF', padding: 20 }}>Chargement…</div>;

  const shift = (n) => setMonth(addDays(`${month}-15`, n * 30).slice(0, 7));
  const [y, m] = month.split('-').map(Number);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" style={{ ...btn(), padding: '6px 12px' }} onClick={() => shift(-1)}>←</button>
        <strong style={{ fontSize: 18, color: '#1F2937', minWidth: 170, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</strong>
        <button type="button" style={{ ...btn(), padding: '6px 12px' }} onClick={() => shift(1)}>→</button>
        <button type="button" style={{ ...btn(), padding: '6px 12px' }} onClick={() => setMonth(today.slice(0, 7))}>Aujourd'hui</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#E5E7EB', gap: 1, border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
        {DAYS.map((d) => <div key={d} style={{ background: '#F9FAFB', padding: '6px 8px', fontSize: 12, fontWeight: 800, color: '#6B7280' }}>{d}</div>)}
        {cells.map((d) => {
          const items = byDay.get(d) || [];
          const inMonth = d.slice(0, 7) === first.slice(0, 7);
          const showAll = expandedDay === d;
          const shown = showAll ? items : items.slice(0, MAX_PER_DAY);
          return (
            <div key={d}
              onDragOver={(e) => { e.preventDefault(); setOver(d); }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragged.current) moveTo(dragged.current.item, dragged.current.day, d); dragged.current = null; }}
              style={{ background: over === d ? '#E0EAFF' : inMonth ? '#fff' : '#FAFAFA', minHeight: 118, padding: 4, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                <span style={{
                  fontSize: 12, fontWeight: 800, color: d === today ? '#fff' : inMonth ? '#374151' : '#C4C4C4',
                  background: d === today ? '#E2445C' : 'transparent', borderRadius: 10, padding: '1px 6px',
                }}>{Number(d.slice(8))}</span>
                <span style={{ flex: 1 }} />
                <button type="button" title="Nouvelle tâche ce jour-là" onClick={() => onNew({ start_date: d, due_date: d })}
                  style={{ background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>+</button>
              </div>
              {shown.map((it) => (
                <div key={it.key} draggable
                  onDragStart={() => { dragged.current = { item: it, day: d }; }}
                  onClick={() => onOpen(it.task.id)}
                  title={it.label}
                  style={{
                    background: it.color, color: '#fff', borderRadius: 4, fontSize: 11, fontWeight: 700, padding: '2px 6px', marginBottom: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'grab',
                    opacity: it.first || d === cells[0] ? 1 : 0.75,
                  }}>
                  {it.kind === 'step' ? '◦ ' : ''}{it.label}
                </div>
              ))}
              {items.length > MAX_PER_DAY && (
                <button type="button" onClick={() => setExpandedDay(showAll ? null : d)}
                  style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                  {showAll ? 'Réduire' : `+ ${items.length - MAX_PER_DAY} autres`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
