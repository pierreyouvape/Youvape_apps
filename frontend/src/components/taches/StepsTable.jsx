import { useState } from 'react';
import { tachesApi, apiError, formatDateTime, todayStr } from './tachesShared';
import { StepStatusPill, PeoplePicker, InlineText } from './tachesUi';

const th = {
  fontSize: 12, fontWeight: 700, color: '#6B7280', padding: '6px 8px', textAlign: 'center',
  borderBottom: '1px solid #E5E7EB', background: '#F9FAFB', whiteSpace: 'nowrap',
};
const td = { padding: '4px 8px', borderBottom: '1px solid #EEF0F3', textAlign: 'center', verticalAlign: 'middle' };
const arrow = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0, lineHeight: 1,
};

/**
 * Étapes d'une tâche, modifiables en place (équivalent des sous-éléments Monday).
 *
 * `focusUserId` (vue « Mes tâches ») : les étapes de cette personne encore à
 * traiter sont surlignées, celles qui les précèdent grisées — on voit d'où vient
 * le travail sans que ça prenne la place.
 *
 * Chaque modification renvoie la tâche complète (`onChange`), y compris l'étape
 * suivante débloquée par un « Fait ».
 */
export default function StepsTable({ task, members, onChange, onError, focusUserId = null }) {
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

  const mineIdx = focusUserId
    ? steps.findIndex((s) => s.status !== 'fait' && s.owners.includes(focusUserId))
    : -1;

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
    <div style={{ overflowX: 'auto', opacity: busy ? 0.7 : 1, transition: 'opacity .15s' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 22 }} />
            <th style={{ ...th, textAlign: 'left' }}>Étape</th>
            <th style={{ ...th, width: 90 }} title="Qui fait le travail">Responsable</th>
            <th style={{ ...th, width: 120 }}>Statut</th>
            <th style={{ ...th, width: 90 }} title="Prévenu sur Slack quand l'étape est faite">À prévenir</th>
            <th style={{ ...th, width: 130 }}>Échéance</th>
            <th style={{ ...th, textAlign: 'left', width: '22%' }}>Note</th>
            <th style={{ ...th, width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const isMine = focusUserId && s.status !== 'fait' && s.owners.includes(focusUserId);
            const before = mineIdx >= 0 && i < mineIdx;
            const late = s.due_date && s.status !== 'fait' && s.due_date < today;
            return (
              <tr key={s.id} style={{
                background: isMine ? '#EFF6FF' : before ? '#FAFAFA' : '#fff',
                opacity: before ? 0.6 : 1,
              }}>
                <td style={{ ...td, padding: '0 2px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button type="button" style={{ ...arrow, visibility: i ? 'visible' : 'hidden' }} title="Monter"
                      onClick={() => run(() => tachesApi.moveStep(s.id, 'up'))}>▲</button>
                    <button type="button" style={{ ...arrow, visibility: i < steps.length - 1 ? 'visible' : 'hidden' }} title="Descendre"
                      onClick={() => run(() => tachesApi.moveStep(s.id, 'down'))}>▼</button>
                  </div>
                </td>
                <td style={{ ...td, textAlign: 'left', fontWeight: isMine ? 800 : 500, color: '#1F2937' }}>
                  <InlineText value={s.name} onSave={(name) => update(s, { name })} style={{ width: '100%' }} />
                  {s.status === 'fait' && s.done_by_name && (
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 500 }}>
                      Fait par {s.done_by_name} · {formatDateTime(s.done_at)}
                    </div>
                  )}
                </td>
                <td style={td}>
                  <PeoplePicker title="Responsable(s)" value={s.owners} members={members}
                    onChange={(owners) => update(s, { owners })} />
                </td>
                <td style={td}>
                  <StepStatusPill status={s.status} onChange={(status) => update(s, { status })} />
                </td>
                <td style={td}>
                  <PeoplePicker title="À prévenir quand c'est fait" value={s.notify} members={members}
                    onChange={(notify) => update(s, { notify })} />
                </td>
                <td style={td}>
                  <input type="date" value={s.due_date || ''}
                    onChange={(e) => update(s, { due_date: e.target.value || null })}
                    style={{
                      border: '1px solid transparent', borderRadius: 6, padding: '3px 4px', fontFamily: 'inherit',
                      fontSize: 13, background: late ? '#FEE2E2' : 'transparent', color: late ? '#B91C1C' : '#374151',
                    }} />
                </td>
                <td style={{ ...td, textAlign: 'left', fontSize: 13, color: '#4B5563' }}>
                  <InlineText value={s.note} placeholder="—" onSave={(note) => update(s, { note })} style={{ width: '100%' }} />
                </td>
                <td style={td}>
                  <button type="button" onClick={() => remove(s)} title="Supprimer l'étape"
                    style={{ background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer', fontSize: 16 }}>×</button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={td} />
            <td colSpan={7} style={{ ...td, textAlign: 'left' }}>
              <form onSubmit={add}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="+ Ajouter une étape (Entrée)"
                  style={{ border: 'none', outline: 'none', width: '100%', fontSize: 14, fontFamily: 'inherit', padding: '6px 0', background: 'transparent' }} />
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
