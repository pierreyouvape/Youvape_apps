import { useState } from 'react';
import { tachesApi, apiError, formatDateTime, todayStr, M, mTable, mTh, mTd, mCell, ellipsis } from './tachesShared';
import { StepStatusPill, PeoplePicker, InlineText, PriorityPill, DateRange } from './tachesUi';

const arrow = { background: 'none', border: 'none', cursor: 'pointer', color: '#C3C6D4', fontSize: 9, padding: 0, lineHeight: 1 };

/**
 * Étapes d'une tâche (sous-éléments Monday), modifiables en place.
 *
 * `focusUserId` (« Mes tâches », filtre par personne) : les étapes de cette
 * personne encore à traiter sont surlignées, celles d'avant grisées.
 * Chaque modification renvoie la tâche complète (`onChange`), y compris
 * l'étape suivante débloquée par un « Fait ».
 */
export default function StepsTable({ task, members, onChange, onError, focusUserId = null, color = '#579BFC' }) {
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
    <div style={{ overflowX: 'auto', opacity: busy ? 0.7 : 1, transition: 'opacity .15s', borderLeft: `4px solid ${color}`, background: '#fff' }}>
      <table style={{ ...mTable, minWidth: 1050 }}>
        <colgroup>
          <col style={{ width: 26 }} />
          <col />
          <col style={{ width: 96 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={mTh} />
            <th style={{ ...mTh, textAlign: 'left' }}>Sous-élément</th>
            <th style={mTh} title="Qui fait le travail">Owner</th>
            <th style={mTh}>Statut</th>
            <th style={mTh} title="Prévenu sur Slack quand l'étape est faite">Personnes</th>
            <th style={mTh}>Échéances</th>
            <th style={mTh}>Priorité</th>
            <th style={mTh}>Texte</th>
            <th style={{ ...mTh, borderRight: 'none' }} />
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const isMine = focusUserId && s.status !== 'fait' && s.owners.includes(focusUserId);
            const before = mineIdx >= 0 && i < mineIdx;
            const late = s.due_date && s.status !== 'fait' && s.due_date < today;
            return (
              <tr key={s.id} style={{ background: isMine ? '#E5F4FF' : '#fff', opacity: before ? 0.5 : 1 }}>
                <td style={{ ...mTd, padding: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <button type="button" style={{ ...arrow, visibility: i ? 'visible' : 'hidden' }} title="Monter"
                      onClick={() => run(() => tachesApi.moveStep(s.id, 'up'))}>▲</button>
                    <button type="button" style={{ ...arrow, visibility: i < steps.length - 1 ? 'visible' : 'hidden' }} title="Descendre"
                      onClick={() => run(() => tachesApi.moveStep(s.id, 'down'))}>▼</button>
                  </div>
                </td>
                <td style={{ ...mTd, textAlign: 'left', fontWeight: isMine ? 600 : 400 }}
                  title={s.status === 'fait' && s.done_by_name ? `${s.name}\nFait par ${s.done_by_name} · ${formatDateTime(s.done_at)}` : s.name}>
                  <InlineText value={s.name} onSave={(name) => update(s, { name })} style={{ ...ellipsis, width: '100%' }} />
                </td>
                <td style={mTd}><PeoplePicker title="Owner (qui fait le travail)" value={s.owners} members={members} onChange={(owners) => update(s, { owners })} /></td>
                <td style={mCell}><StepStatusPill cell status={s.status} onChange={(status) => update(s, { status })} /></td>
                <td style={mTd}><PeoplePicker title="Personnes prévenues quand c'est fait" value={s.notify} members={members} onChange={(notify) => update(s, { notify })} /></td>
                <td style={mTd}><DateRange start={s.start_date} end={s.due_date} late={late} onChange={(b) => update(s, b)} /></td>
                <td style={mCell}><PriorityPill cell priority={s.priority} onChange={(priority) => update(s, { priority })} /></td>
                <td style={{ ...mTd, textAlign: 'left', color: M.sub }} title={s.note}>
                  <InlineText value={s.note} placeholder="" onSave={(note) => update(s, { note })} style={{ ...ellipsis, width: '100%', minHeight: 20 }} />
                </td>
                <td style={{ ...mTd, borderRight: 'none', padding: 0 }}>
                  <button type="button" onClick={() => remove(s)} title="Supprimer ce sous-élément"
                    style={{ background: 'none', border: 'none', color: '#C3C6D4', cursor: 'pointer', fontSize: 15, width: '100%', height: 36 }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#DF2F4A'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#C3C6D4'; }}>
                    🗑
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={mTd} />
            <td colSpan={8} style={{ ...mTd, textAlign: 'left', borderRight: 'none' }}>
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
