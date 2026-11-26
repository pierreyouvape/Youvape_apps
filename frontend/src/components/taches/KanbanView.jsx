import { useMemo, useRef, useState } from 'react';
import {
  tachesApi, apiError, formatDate, todayStr, inputStyle, labelChip,
  STEP_STATUS, STEP_STATUS_ORDER, TASK_STATUS, TASK_STATUS_ORDER, PRIORITY, PRIORITY_ORDER,
} from './tachesShared';
import { AvatarStack } from './tachesUi';

const GROUP_BY = [
  { key: 'step_status', label: 'Statut des étapes' },
  { key: 'task_status', label: 'Statut des tâches' },
  { key: 'person', label: 'Personne (travail en cours)' },
  { key: 'priority', label: 'Priorité' },
  { key: 'group', label: 'Groupe' },
  { key: 'label', label: 'Étiquette' },
];
const PAGE = 40;
// Deux lignes au plus, puis « … » (une étape peut être une longue adresse).
const clamp = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' };

/**
 * Vue Kanban. Une carte = une tâche, ou une étape quand on regroupe par statut
 * d'étape ou par personne. Glisser une carte dans une autre colonne applique
 * la valeur de la colonne (statut, priorité, groupe, responsable, étiquette) ;
 * passer une étape dans « Fait » débloque la suivante et prévient Slack, comme
 * partout ailleurs.
 */
export default function KanbanView({ tasks, loading, board, boards, members, focusUserId, onOpen, onTaskChange, onError, onReload }) {
  const [by, setBy] = useState(() => localStorage.getItem('yv.taches.kanban') || 'step_status');
  const [over, setOver] = useState(null);
  const [more, setMore] = useState({});
  const dragged = useRef(null);
  const today = todayStr();

  const columns = useMemo(() => {
    const taskCard = (t) => ({ key: `t${t.id}`, task: t });
    const stepCards = (filter) => tasks.flatMap((t) => t.steps.filter(filter).map((s) => ({ key: `s${s.id}`, task: t, step: s })));
    const focus = (s) => !focusUserId || s.owners.includes(focusUserId);
    switch (by) {
      case 'task_status':
        return TASK_STATUS_ORDER.map((k) => ({ key: k, label: TASK_STATUS[k].label, color: TASK_STATUS[k].bg, cards: tasks.filter((t) => t.status === k).map(taskCard) }));
      case 'priority':
        return [...PRIORITY_ORDER, null].map((k) => ({
          key: k || 'none', label: k ? PRIORITY[k].label : 'Sans priorité', color: k ? PRIORITY[k].bg : 'var(--tk-todo)',
          cards: tasks.filter((t) => (t.priority || null) === k).map(taskCard),
        }));
      case 'group': {
        const groups = (board ? [board] : boards).flatMap((b) => b.groups.map((g) => ({ ...g, name: board ? g.name : `${b.name} › ${g.name}` })));
        return groups.map((g) => ({ key: String(g.id), label: g.name, color: g.color, cards: tasks.filter((t) => t.group_id === g.id).map(taskCard) }));
      }
      case 'label': {
        const used = [...new Set(tasks.flatMap((t) => t.labels))].sort();
        return [...used.map((l) => ({ key: l, label: l, color: '#579BFC', cards: tasks.filter((t) => t.labels.includes(l)).map((t) => ({ ...taskCard(t), key: `t${t.id}-${l}`, from: l })) })),
          { key: '', label: 'Sans étiquette', color: 'var(--tk-todo)', cards: tasks.filter((t) => !t.labels.length).map(taskCard) }];
      }
      case 'person': {
        // Ce qui reste à faire, par responsable : étapes non faites + tâches sans étape non terminées.
        const open = (s) => s.status !== 'fait';
        const cols = members.filter((m) => m.has_app !== false).map((m) => ({
          key: String(m.id), label: m.name, color: 'var(--tk-link)',
          cards: [
            ...stepCards((s) => open(s) && s.owners.includes(m.id)),
            ...tasks.filter((t) => !t.steps.length && t.status !== 'fait' && t.people.includes(m.id)).map(taskCard),
          ],
        }));
        cols.push({
          key: 'none', label: 'Sans responsable', color: 'var(--tk-todo)',
          cards: [...stepCards((s) => open(s) && !s.owners.length), ...tasks.filter((t) => !t.steps.length && t.status !== 'fait' && !t.people.length).map(taskCard)],
        });
        return cols;
      }
      default:
        return STEP_STATUS_ORDER.map((k) => ({ key: k, label: STEP_STATUS[k].label, color: STEP_STATUS[k].bg, cards: stepCards((s) => s.status === k && focus(s)) }));
    }
  }, [by, tasks, board, boards, members, focusUserId]);

  const drop = async (card, col) => {
    const t = card.task;
    try {
      if (by === 'step_status') {
        if (card.step.status !== col.key) onTaskChange(await tachesApi.updateStep(card.step.id, { status: col.key }));
      } else if (by === 'task_status') {
        if (t.steps.length) throw new Error('Le statut de cette tâche suit ses étapes : changez plutôt le statut des étapes.');
        onTaskChange(await tachesApi.updateTask(t.id, { manual_status: col.key }));
      } else if (by === 'priority') {
        onTaskChange(await tachesApi.updateTask(t.id, { priority: col.key === 'none' ? null : col.key }));
      } else if (by === 'group') {
        await tachesApi.bulk({ ids: [t.id], action: 'move', group_id: Number(col.key) });
        onReload();
      } else if (by === 'label') {
        const next = t.labels.filter((l) => l !== card.from);
        if (col.key && !next.includes(col.key)) next.push(col.key);
        onTaskChange(await tachesApi.updateTask(t.id, { labels: col.key ? next : [] }));
      } else if (by === 'person') {
        const ids = col.key === 'none' ? [] : [Number(col.key)];
        if (card.step) onTaskChange(await tachesApi.updateStep(card.step.id, { owners: ids }));
        else onTaskChange(await tachesApi.updateTask(t.id, { people: ids }));
      }
    } catch (e) {
      onError(apiError(e));
    }
  };

  if (loading) return <div style={{ color: 'var(--tk-muted)', padding: 20 }}>Chargement…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--tk-text2)', fontWeight: 700 }}>Regrouper par</span>
        <select value={by} onChange={(e) => { setBy(e.target.value); localStorage.setItem('yv.taches.kanban', e.target.value); }}
          style={{ ...inputStyle, width: 240 }}>
          {GROUP_BY.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
        {columns.map((col) => {
          const shown = col.cards.slice(0, more[col.key] ? undefined : PAGE);
          return (
            <div key={col.key}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const key = e.dataTransfer.getData('text/plain');
                const card = columns.flatMap((c) => c.cards).find((c) => c.key === key) || dragged.current;
                if (card && !col.cards.some((c) => c.key === key)) drop(card, col);
              }}
              style={{
                width: 280, flexShrink: 0, background: over === col.key ? 'var(--tk-chip)' : 'var(--tk-line2)', borderRadius: 10,
                maxHeight: 'calc(100vh - 300px)', display: 'flex', flexDirection: 'column',
              }}>
              <div style={{ background: col.color, color: '#fff', borderRadius: '10px 10px 0 0', padding: '8px 12px', fontWeight: 800, fontSize: 14, display: 'flex' }}>
                <span style={{ flex: 1 }}>{col.label}</span><span>{col.cards.length}</span>
              </div>
              <div style={{ padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shown.map((c) => {
                  const due = c.step ? c.step.due_date : c.task.due_date;
                  const late = due && due < today && (c.step ? c.step.status !== 'fait' : c.task.status !== 'fait');
                  const pr = (c.step?.priority || c.task.priority);
                  return (
                    <div key={c.key} draggable
                      onDragStart={(e) => { dragged.current = c; e.dataTransfer.setData('text/plain', c.key); }}
                      onClick={() => onOpen(c.task.id)}
                      style={{
                        background: 'var(--tk-surface)', borderRadius: 8, padding: '8px 10px', cursor: 'grab', boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                        borderLeft: `4px solid ${c.step ? STEP_STATUS[c.step.status].bg : TASK_STATUS[c.task.status]?.bg || 'var(--tk-todo)'}`,
                      }}>
                      {c.step && <div style={{ ...clamp, fontSize: 14, fontWeight: 600, color: 'var(--tk-text)' }} title={c.step.name}>{c.step.name}</div>}
                      <div style={{ ...clamp, fontSize: c.step ? 12 : 14, fontWeight: c.step ? 400 : 600, color: c.step ? 'var(--tk-sub)' : 'var(--tk-text)' }} title={c.task.title}>{c.task.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <AvatarStack ids={c.step ? c.step.owners : c.task.people} members={members} size={22} />
                        {pr && <span style={{ width: 9, height: 9, borderRadius: '50%', background: PRIORITY[pr].bg }} title={`Priorité ${PRIORITY[pr].label}`} />}
                        {due && <span style={{ fontSize: 11, fontWeight: 700, color: late ? 'var(--tk-danger)' : 'var(--tk-sub)' }}>{formatDate(due)}</span>}
                        {!c.step && c.task.steps.length > 0 && <span style={{ fontSize: 11, color: 'var(--tk-sub)' }}>{c.task.counts.fait}/{c.task.steps.length} étapes</span>}
                        {c.task.comment_count > 0 && <span style={{ fontSize: 11, color: 'var(--tk-link)' }}>💬 {c.task.comment_count}</span>}
                      </div>
                      {by !== 'label' && c.task.labels.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 5 }}>
                          {c.task.labels.map((l) => <span key={l} style={{ ...labelChip, fontSize: 11 }}>{l}</span>)}
                        </div>
                      )}
                    </div>
                  );
                })}
                {col.cards.length > shown.length && (
                  <button type="button" onClick={() => setMore((m) => ({ ...m, [col.key]: true }))}
                    style={{ background: 'none', border: 'none', color: 'var(--tk-link)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Voir les {col.cards.length - shown.length} autres
                  </button>
                )}
                {!col.cards.length && <div style={{ fontSize: 12, color: 'var(--tk-muted)', textAlign: 'center', padding: 10 }}>Déposer ici</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
