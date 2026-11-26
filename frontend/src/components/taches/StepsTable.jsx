import { useState } from 'react';
import { tachesApi, apiError, formatDateTime, formatDay, todayStr, M, mTable, mTh, mTd, mCell, ellipsis } from './tachesShared';
import { Avatar, StepStatusPill, PeoplePicker, InlineText, PriorityPill, DateRange, ColGroup, ColResizer } from './tachesUi';
import { useColumnWidths } from './tachesColumns';

const arrow = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-faint)', fontSize: 9, padding: 0, lineHeight: 1 };

/**
 * Étapes d'une tâche (sous-éléments Monday), modifiables en place.
 *
 * `focusUserId` (« Mes tâches », filtre par personne) : les étapes de cette
 * personne encore à traiter sont surlignées, celles d'avant grisées.
 * Chaque modification renvoie la tâche complète (`onChange`), y compris
 * l'étape suivante débloquée par un « Fait ».
 */
export default function StepsTable({ task, members, onChange, onError, focusUserId = null, color = '#579BFC' }) {
  const cols = useColumnWidths('steps', [26, 360, 96, 150, 96, 150, 150, 120, 180, 40]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const steps = task.steps || [];
  const today = todayStr();

  const run = async (fn) => {
    setBusy(true);
    try {
      onChange(await fn());
    } catch (e) {
      onError?.(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const update = (step, body) => run(() => tachesApi.updateStep(step.id, body));
  // Glisser-déposer des sous-éléments (poignée ⠿)
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null); // { id, before }
  const dropOn = (targetId, before) => {
    const moving = dragId;
    setDragId(null);
    setOver(null);
    if (!moving || moving === targetId) return;
    const ids = steps.map((x) => x.id).filter((x) => x !== moving);
    let at = ids.indexOf(targetId);
    if (!before) at += 1;
    ids.splice(at, 0, moving);
    run(() => tachesApi.reorderSteps(task.id, ids));
  };

  const mineIdx = focusUserId ? steps.findIndex((s) => s.status !== 'fait' && s.owners.includes(focusUserId)) : -1;

  const add = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    run(() => tachesApi.addStep(task.id, { name }));
  };
  const remove = (step) => {
    if (!window.confirm(`Supprimer l'étape « ${step.name} » ?`)) return;
    run(() => tachesApi.deleteStep(step.id));
  };

  return (
    <div style={{ overflowX: 'auto', opacity: busy ? 0.7 : 1, transition: 'opacity .15s', borderLeft: `4px solid ${color}`, background: 'var(--tk-surface)' }}>
      <table style={{ ...mTable, width: cols.total }}>
        <ColGroup widths={cols.widths} />
        <thead>
          <tr>
            <th style={mTh}><ColResizer index={0} cols={cols} /></th>
            <th style={{ ...mTh, textAlign: 'left' }}>Sous-élément<ColResizer index={1} cols={cols} /></th>
            <th style={mTh} title="Qui fait le travail">Owner<ColResizer index={2} cols={cols} /></th>
            <th style={mTh}>Statut<ColResizer index={3} cols={cols} /></th>
            <th style={mTh} title="Prévenu sur Slack quand l'étape est faite">Personnes<ColResizer index={4} cols={cols} /></th>
            <th style={mTh}>Échéances<ColResizer index={5} cols={cols} /></th>
            <th style={mTh} title="Date à laquelle le sous-élément est passé à « Fait »">Fait le<ColResizer index={6} cols={cols} /></th>
            <th style={mTh}>Priorité<ColResizer index={7} cols={cols} /></th>
            <th style={mTh}>Texte<ColResizer index={8} cols={cols} /></th>
            <th style={{ ...mTh, borderRight: 'none' }}><ColResizer index={9} cols={cols} /></th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const isMine = focusUserId && s.status !== 'fait' && s.owners.includes(focusUserId);
            const before = mineIdx >= 0 && i < mineIdx;
            const late = s.due_date && s.status !== 'fait' && s.due_date < today;
            return (
              <tr key={s.id}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setOver({ id: s.id, before: e.clientY < box.top + box.height / 2 });
                }}
                onDrop={(e) => { e.preventDefault(); dropOn(s.id, over?.before !== false); }}
                style={{
                  background: isMine ? 'var(--tk-sel)' : 'var(--tk-surface)', opacity: before || dragId === s.id ? 0.5 : 1,
                  boxShadow: over?.id === s.id ? `inset 0 ${over.before ? 2 : -2}px 0 #0073EA` : 'none',
                }}>
                <td style={{ ...mTd, padding: 0 }}>
                  <span draggable title="Glisser pour changer l'ordre"
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(s.id)); setDragId(s.id); }}
                    onDragEnd={() => { setDragId(null); setOver(null); }}
                    style={{ ...arrow, display: 'block', fontSize: 13, cursor: 'grab', userSelect: 'none', textAlign: 'center' }}>⠿</span>
                </td>
                <td style={{ ...mTd, textAlign: 'left', fontWeight: isMine ? 600 : 400 }}
                  title={s.status === 'fait' && s.done_by_name ? `${s.name}\nFait par ${s.done_by_name} · ${formatDateTime(s.done_at)}` : s.name}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <InlineText value={s.name} onSave={(name) => update(s, { name })} style={{ ...ellipsis, flex: 1, minWidth: 0 }} />
                    <button type="button" onClick={() => update(s, { ask_link: !s.ask_link })}
                      title={s.ask_link ? 'Le lien de la fiche produit sera demandé au passage à « Fait » (cliquer pour ne plus le demander)' : 'Demander le lien de la fiche produit au passage à « Fait »'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0, flexShrink: 0, opacity: s.ask_link ? 1 : 0.2 }}>🔗</button>
                  </span>
                </td>
                <td style={mTd}><PeoplePicker title="Owner (qui fait le travail)" value={s.owners} members={members} onChange={(owners) => update(s, { owners })} /></td>
                <td style={mCell}><StepStatusPill cell status={s.status} onChange={(status) => update(s, { status })} /></td>
                <td style={mTd}><PeoplePicker title="Personnes prévenues quand c'est fait" value={s.notify} members={members} onChange={(notify) => update(s, { notify })} /></td>
                <td style={mTd}><DateRange start={s.start_date} end={s.due_date} late={late} onChange={(b) => update(s, b)} /></td>
                <td style={{ ...mTd, color: M.sub, fontSize: 13 }}
                  title={s.status === 'fait' && s.done_at ? `Fait${s.done_by_name ? ` par ${s.done_by_name}` : ''} le ${formatDateTime(s.done_at)}` : ''}>
                  {s.status === 'fait' && s.done_at && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {s.done_by && <Avatar id={s.done_by} name={s.done_by_name} size={20} />}
                      {formatDay(s.done_at)}
                    </span>
                  )}
                </td>
                <td style={mCell}><PriorityPill cell priority={s.priority} onChange={(priority) => update(s, { priority })} /></td>
                <td style={{ ...mTd, textAlign: 'left', color: M.sub }} title={s.note}>
                  <InlineText value={s.note} placeholder="" onSave={(note) => update(s, { note })} style={{ ...ellipsis, width: '100%', minHeight: 20 }} />
                </td>
                <td style={{ ...mTd, borderRight: 'none', padding: 0 }}>
                  <button type="button" onClick={() => remove(s)} title="Supprimer ce sous-élément"
                    style={{ background: 'none', border: 'none', color: 'var(--tk-faint)', cursor: 'pointer', fontSize: 15, width: '100%', height: 36 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#DF2F4A'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--tk-faint)'; }}>
                    🗑
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={mTd} />
            <td colSpan={9} style={{ ...mTd, textAlign: 'left', borderRight: 'none' }}>
              <form onSubmit={add}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="+ Ajouter sous-élément"
                  style={{ border: 'none', outline: 'none', width: '100%', fontSize: 14, fontFamily: 'inherit', background: 'transparent', color: M.text }} />
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
