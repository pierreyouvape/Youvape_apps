import { useCallback, useEffect, useState } from 'react';
import { useTableauInbox } from '../../context/TableauInboxContext';
import TaskForm from './TaskForm';
import { tableauApi, apiError, ruleSummary, reminderLabel, formatDue, TABLEAU_COLOR } from './tableauShared';

const GROUPS = [
  { key: 'late', label: 'En retard', color: '#DC2626' },
  { key: 'today', label: "Aujourd'hui", color: TABLEAU_COLOR },
  { key: 'next', label: 'À venir', color: '#6B7280' },
];

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13,
  fontWeight: 700, padding: '4px 8px', fontFamily: 'inherit', borderRadius: 6,
};

/** Onglet Récurrentes : tâches classées par échéance, cochées une à une. */
export default function RecurringTab() {
  const { inbox, refresh } = useTableauInbox();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | tâche

  const load = useCallback(async () => {
    try {
      setData(await tableauApi.tasks());
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Un « Fait » cliqué depuis un rappel (toast d'une autre app) change l'échéance
  const remindersKey = inbox.reminders.map((r) => `${r.id}-${r.next_due}`).join(',');
  useEffect(() => { load(); }, [remindersKey, load]);

  const act = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      setError(apiError(e));
    }
    load();
    refresh();
  };

  const remove = (t) => {
    if (!window.confirm(`Supprimer la tâche « ${t.title} » et son historique ?`)) return;
    act(() => tableauApi.deleteTask(t.id))();
  };

  const today = data?.today;
  const groups = { late: [], today: [], next: [] };
  (data?.tasks || []).forEach((t) => {
    groups[t.next_due < today ? 'late' : t.next_due === today ? 'today' : 'next'].push(t);
  });
  const remindedIds = new Set(inbox.reminders.map((r) => r.id));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setEditing('new')} style={{
          border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700,
          background: TABLEAU_COLOR, color: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          + Nouvelle tâche
        </button>
        {error && <span style={{ fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>{error}</span>}
      </div>

      {data && !data.tasks.length && (
        <div style={{
          padding: '40px 24px', textAlign: 'center', background: '#fff', borderRadius: 14,
          border: '1px dashed #E5E7EB', color: '#6B7280', fontSize: 14,
        }}>
          Aucune tâche récurrente pour l'instant.
        </div>
      )}

      {GROUPS.filter((g) => groups[g.key].length).map((g) => (
        <section key={g.key} style={{ marginBottom: 22 }}>
          <h2 style={{
            fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: g.color, margin: '0 0 8px',
          }}>
            {g.label} · {groups[g.key].length}
          </h2>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            {groups[g.key].map((t, i) => {
              const doneToday = t.last_done_at && t.last_done_at.slice(0, 10) === today;
              const remind = reminderLabel(t.remind_minutes);
              const emailRemind = reminderLabel(t.email_remind_minutes);
              return (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                  borderTop: i ? '1px solid #F3F4F6' : 'none',
                  background: remindedIds.has(t.id) ? '#FFFBEB' : '#fff',
                }}>
                  <button
                    onClick={act(() => tableauApi.done(t.id))}
                    title="Marquer comme fait"
                    style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0, marginTop: 1, cursor: 'pointer',
                      border: `2px solid ${g.key === 'late' ? '#DC2626' : TABLEAU_COLOR}`, background: '#fff',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1F2937' }}>{t.title}</div>
                    <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 2 }}>
                      {ruleSummary(t)}{t.due_time ? ` à ${t.due_time.replace(':', 'h')}` : ''}
                      {remind && <> · Rappel {remind}</>}
                      {emailRemind && <> · Rappel email {emailRemind}</>}
                    </div>
                    {t.notes && (
                      <div style={{ fontSize: 13, color: '#4B5563', marginTop: 4, whiteSpace: 'pre-wrap' }}>{t.notes}</div>
                    )}
                    {doneToday && (
                      <div style={{ fontSize: 12, color: '#15803D', marginTop: 4 }}>
                        Fait aujourd'hui à {t.last_done_at.slice(11).replace(':', 'h')} ·{' '}
                        <button onClick={act(() => tableauApi.undo(t.id))} style={{ ...iconBtn, padding: 0, color: '#15803D', textDecoration: 'underline' }}>
                          annuler
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: g.color }}>
                      {formatDue(t.next_due, t.due_time, today)}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <button style={iconBtn} onClick={() => setEditing(t)}>Modifier</button>
                      <button style={{ ...iconBtn, color: '#B91C1C' }} onClick={() => remove(t)}>Supprimer</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {editing && (
        <TaskForm
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); refresh(); }}
        />
      )}
    </div>
  );
}
