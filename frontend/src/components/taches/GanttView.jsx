import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  tachesApi, apiError, todayStr, addDays, daysBetween, taskSpan, formatDate, btn,
  STEP_STATUS, TASK_STATUS,
} from './tachesShared';
import { AvatarStack } from './tachesUi';

const ZOOMS = { jour: 34, semaine: 14, mois: 5 };
const LEFT = 320;
const ROW = 34;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Vue Gantt : une barre par tâche (ses dates, sinon l'enveloppe de ses étapes,
 * en pointillé), dépliable en étapes. Glisser une barre la déplace, tirer un
 * bord change la date de début ou de fin. Les tâches sans aucune date sont
 * listées dessous, avec « Planifier ».
 */
export default function GanttView({ tasks, loading, board, boards, members, onOpen, onTaskChange, onError }) {
  const [zoom, setZoom] = useState(() => localStorage.getItem('yv.taches.gantt.zoom') || 'semaine');
  const [expanded, setExpanded] = useState(() => new Set());
  const [drag, setDrag] = useState(null); // { id, kind, mode, x0, start, end, delta }
  const scroller = useRef(null);
  const px = ZOOMS[zoom];
  const today = todayStr();

  const groupsOrder = useMemo(() => {
    const m = new Map();
    (board ? [board] : boards).forEach((b) => b.groups.forEach((g) => m.set(g.id, { ...g, i: m.size })));
    return m;
  }, [board, boards]);

  const { rows, undated, from, days } = useMemo(() => {
    const dated = [];
    const none = [];
    tasks.forEach((t) => {
      const span = taskSpan(t);
      if (span) dated.push({ t, span }); else none.push(t);
    });
    dated.sort((a, b) => (groupsOrder.get(a.t.group_id)?.i ?? 999) - (groupsOrder.get(b.t.group_id)?.i ?? 999)
      || a.span.start.localeCompare(b.span.start));
    const starts = dated.map((d) => d.span.start).concat(dated.flatMap((d) => d.t.steps.map((s) => s.start_date || s.due_date).filter(Boolean)));
    const ends = dated.map((d) => d.span.end).concat(dated.flatMap((d) => d.t.steps.map((s) => s.due_date).filter(Boolean)));
    let lo = addDays(today, -14);
    let hi = addDays(today, 60);
    starts.forEach((s) => { if (s < lo) lo = s; });
    ends.forEach((e) => { if (e > hi) hi = e; });
    lo = addDays(lo, -3);
    hi = addDays(hi, 10);
    return { rows: dated, undated: none, from: lo, days: daysBetween(lo, hi) + 1 };
  }, [tasks, groupsOrder, today]);

  // Centrer sur aujourd'hui au premier affichage et au changement de zoom.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, daysBetween(from, today) * px - 200);
  }, [zoom, px, from, today, loading]);

  // Geste de glisser : suivi au niveau de la fenêtre pour ne pas perdre la souris.
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => setDrag((d) => ({ ...d, delta: Math.round((e.clientX - d.x0) / px) }));
    const up = async () => {
      const d = drag;
      setDrag(null);
      if (!d.delta) return;
      let start = d.start;
      let end = d.end;
      if (d.mode !== 'end') start = addDays(start, d.delta);
      if (d.mode !== 'start') end = addDays(end, d.delta);
      if (start > end) return;
      try {
        const body = { start_date: start, due_date: end };
        onTaskChange(d.kind === 'step' ? await tachesApi.updateStep(d.id, body) : await tachesApi.updateTask(d.id, body));
      } catch (e) { onError(apiError(e)); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, px, onTaskChange, onError]);

  if (loading) return <div style={{ color: 'var(--tk-muted)', padding: 20 }}>Chargement…</div>;

  const x = (d) => daysBetween(from, d) * px;
  const width = days * px;

  // En-tête : mois + jours (ou début de semaine)
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const monthsHdr = [];
  dayList.forEach((d, i) => {
    const key = d.slice(0, 7);
    if (!monthsHdr.length || monthsHdr[monthsHdr.length - 1].key !== key) monthsHdr.push({ key, i, n: 0, label: `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` });
    monthsHdr[monthsHdr.length - 1].n += 1;
  });
  const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();

  const bar = ({ id, kind, start, end, color, label, editable, dashed }) => {
    const live = drag && drag.id === id && drag.kind === kind ? drag : null;
    let s = start;
    let e = end;
    if (live) {
      if (live.mode !== 'end') s = addDays(s, live.delta);
      if (live.mode !== 'start') e = addDays(e, live.delta);
    }
    const left = x(s);
    const w = Math.max(px, (daysBetween(s, e) + 1) * px);
    const grab = (mode) => (ev) => {
      if (!editable) return;
      ev.stopPropagation();
      ev.preventDefault();
      setDrag({ id, kind, mode, x0: ev.clientX, start, end, delta: 0 });
    };
    return (
      <div title={`${label} · ${formatDate(start)} → ${formatDate(end)}${editable ? '' : ' (dates des étapes)'}`}
        onPointerDown={grab('move')}
        style={{
          position: 'absolute', left, width: w, top: 6, height: ROW - 12, borderRadius: 6,
          background: dashed ? `repeating-linear-gradient(45deg, color-mix(in srgb, ${color} 33%, transparent) 0 6px, color-mix(in srgb, ${color} 20%, transparent) 6px 12px)` : color,
          border: dashed ? `1px dashed ${color}` : 'none', cursor: editable ? 'grab' : 'default',
          color: dashed ? 'var(--tk-text)' : '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis', padding: '0 8px', lineHeight: `${ROW - 12}px`, boxShadow: live ? '0 4px 12px rgba(0,0,0,.25)' : 'none',
          userSelect: 'none', touchAction: 'none',
        }}>
        {editable && <span onPointerDown={grab('start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />}
        {w > 40 ? label : ''}
        {editable && <span onPointerDown={grab('end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} />}
      </div>
    );
  };

  const grid = (
    <>
      {zoom !== 'mois' && dayList.map((d, i) => (weekday(d) === 0 || weekday(d) === 6) && (
        <div key={d} style={{ position: 'absolute', left: i * px, width: px, top: 0, bottom: 0, background: 'var(--tk-bg2)' }} />
      ))}
      <div style={{ position: 'absolute', left: x(today) + px / 2, top: 0, bottom: 0, width: 2, background: '#E2445C', zIndex: 1 }} />
    </>
  );

  let lastGroup = null;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {Object.keys(ZOOMS).map((z) => (
          <button key={z} type="button" onClick={() => { setZoom(z); localStorage.setItem('yv.taches.gantt.zoom', z); }}
            style={{ ...btn(z === zoom), padding: '6px 12px', textTransform: 'capitalize' }}>{z}</button>
        ))}
        <button type="button" style={{ ...btn(), padding: '6px 12px' }}
          onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - 200); }}>Aujourd'hui</button>
        <span style={{ fontSize: 12, color: 'var(--tk-muted)' }}>Barre hachurée = dates calculées depuis les étapes (dépliez pour les déplacer).</span>
      </div>

      <div ref={scroller} style={{ background: 'var(--tk-surface)', border: '1px solid var(--tk-line)', borderRadius: 10, overflow: 'auto', maxHeight: 'calc(100vh - 330px)', position: 'relative' }}>
        <div style={{ width: LEFT + width, position: 'relative' }}>
          {/* En-tête */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 4, background: 'var(--tk-surface)', borderBottom: '1px solid var(--tk-line)' }}>
            <div style={{ width: LEFT, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--tk-surface)', zIndex: 5, padding: '8px 12px', fontSize: 12, fontWeight: 800, color: 'var(--tk-sub)', borderRight: '1px solid var(--tk-line)' }}>
              Tâche ({rows.length})
            </div>
            <div style={{ width, position: 'relative', height: 44 }}>
              {monthsHdr.map((m) => (
                <div key={m.key} style={{ position: 'absolute', left: m.i * px, width: m.n * px, top: 0, height: 22, borderLeft: '1px solid var(--tk-line)', fontSize: 12, fontWeight: 800, color: 'var(--tk-text2)', padding: '3px 6px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{m.label}</div>
              ))}
              {dayList.map((d, i) => {
                const show = zoom === 'jour' || (zoom === 'semaine' && weekday(d) === 1) || (zoom === 'mois' && d.endsWith('-01'));
                return show ? (
                  <div key={d} style={{ position: 'absolute', left: i * px, top: 22, height: 22, fontSize: 11, color: d === today ? '#E2445C' : 'var(--tk-muted)', fontWeight: d === today ? 800 : 500, paddingLeft: 3, borderLeft: '1px solid var(--tk-hover)', whiteSpace: 'nowrap' }}>
                    {Number(d.slice(8))}
                  </div>
                ) : null;
              })}
            </div>
          </div>

          {rows.map(({ t, span }) => {
            const g = groupsOrder.get(t.group_id);
            const header = g && g.id !== lastGroup ? g : null;
            lastGroup = g?.id ?? lastGroup;
            const open = expanded.has(t.id);
            return (
              <Fragment key={t.id}>
                {header && (
                  <div style={{ display: 'flex', background: 'var(--tk-bg2)', borderBottom: '1px solid var(--tk-line2)' }}>
                    <div style={{ width: LEFT, position: 'sticky', left: 0, background: 'var(--tk-bg2)', zIndex: 3, padding: '6px 12px', fontSize: 13, fontWeight: 800, color: header.color }}>{header.name}</div>
                    <div style={{ width }} />
                  </div>
                )}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--tk-hover)', height: ROW }}>
                  <div style={{ width: LEFT, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--tk-surface)', zIndex: 3, borderRight: '1px solid var(--tk-line)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                    <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-sub)', fontSize: 11, width: 14, visibility: t.steps.length ? 'visible' : 'hidden' }}>{open ? '▼' : '▶'}</button>
                    <button type="button" onClick={() => onOpen(t.id)} title={t.title}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--tk-text)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, padding: 0 }}>
                      {t.title}
                    </button>
                    <AvatarStack ids={t.people.length ? t.people : [...new Set(t.steps.flatMap((s) => s.owners))].slice(0, 3)} members={members} size={20} />
                  </div>
                  <div style={{ width, position: 'relative' }}>
                    {grid}
                    {bar({ id: t.id, kind: 'task', start: span.start, end: span.end, color: TASK_STATUS[t.status]?.bg || '#579BFC', label: t.title, editable: span.own, dashed: !span.own })}
                  </div>
                </div>
                {open && t.steps.map((s) => (
                  <div key={s.id} style={{ display: 'flex', borderBottom: '1px solid var(--tk-hover)', height: ROW, background: 'var(--tk-bg2)' }}>
                    <div style={{ width: LEFT, flexShrink: 0, position: 'sticky', left: 0, background: 'var(--tk-bg2)', zIndex: 3, borderRight: '1px solid var(--tk-line)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 34px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STEP_STATUS[s.status].bg, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--tk-text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={s.name}>{s.name}</span>
                      <AvatarStack ids={s.owners} members={members} size={18} />
                    </div>
                    <div style={{ width, position: 'relative' }}>
                      {grid}
                      {s.start_date || s.due_date ? bar({
                        id: s.id, kind: 'step', start: s.start_date || s.due_date, end: s.due_date || s.start_date,
                        color: STEP_STATUS[s.status].bg, label: s.name, editable: true,
                      }) : (
                        <button type="button" onClick={async () => {
                          try { onTaskChange(await tachesApi.updateStep(s.id, { start_date: today, due_date: addDays(today, 2) })); } catch (e) { onError(apiError(e)); }
                        }} style={{ position: 'absolute', left: x(today) + 6, top: 7, fontSize: 11, background: 'var(--tk-surface)', border: '1px dashed var(--tk-focus)', borderRadius: 6, color: 'var(--tk-link)', cursor: 'pointer', padding: '2px 8px' }}>
                          + Planifier
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </Fragment>
            );
          })}
          {!rows.length && <div style={{ padding: 20, color: 'var(--tk-muted)' }}>Aucune tâche datée.</div>}
        </div>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 14, background: 'var(--tk-surface)', border: '1px solid var(--tk-line)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tk-sub)', marginBottom: 6 }}>Sans dates ({undated.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {undated.slice(0, 120).map((t) => (
              <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--tk-line)', borderRadius: 8, padding: '3px 4px 3px 10px', fontSize: 13 }}>
                <button type="button" onClick={() => onOpen(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--tk-text)', padding: 0, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.title}>{t.title}</button>
                <button type="button" title="Placer cette semaine" onClick={async () => {
                  try { onTaskChange(await tachesApi.updateTask(t.id, { start_date: today, due_date: addDays(today, 6) })); } catch (e) { onError(apiError(e)); }
                }} style={{ background: 'var(--tk-sel)', border: 'none', borderRadius: 6, color: 'var(--tk-link)', cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '2px 8px' }}>Planifier</button>
              </span>
            ))}
            {undated.length > 120 && <span style={{ fontSize: 12, color: 'var(--tk-muted)' }}>… et {undated.length - 120} autres</span>}
          </div>
        </div>
      )}
    </div>
  );
}
