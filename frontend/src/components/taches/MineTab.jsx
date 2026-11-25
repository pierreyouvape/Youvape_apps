import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import {
  tachesApi, apiError, ago, formatDate, priorityRank, todayStr, STEP_STATUS, TASK_STATUS, TACHES_COLOR, btn, labelChip,
} from './tachesShared';
import { PriorityPill, AvatarStack } from './tachesUi';

const card = { background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' };
const h2 = { fontSize: 16, fontWeight: 800, color: '#1F2937', margin: '4px 0 10px' };

/**
 * Mon espace : les tâches où j'ai quelque chose à faire, tous tableaux confondus.
 * - une étape dont je suis responsable : toute la chaîne est affichée, les
 *   étapes passées en grisé, la mienne en évidence ;
 * - une tâche sans étape dont je suis la personne (suivi quotidien).
 */
export default function MineTab({ members, reloadKey, onOpen, onError }) {
  const { user } = useContext(AuthContext);
  const me = user?.id;
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.mine());
    } catch (e) {
      onError(apiError(e));
    }
  }, [onError]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(load, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      onError(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  if (tasks === null) return <div style={{ color: '#9CA3AF', padding: 20 }}>Chargement…</div>;

  const today = todayStr();
  const rows = tasks.map((t) => ({ task: t, step: t.steps.find((s) => s.status !== 'fait' && s.owners.includes(me)) || null }))
    .filter((r) => r.step || (!r.task.steps.length && r.task.people.includes(me) && r.task.status !== 'fait'));
  const stateOf = (r) => (r.step ? r.step.status : r.task.status);
  const due = (r) => (r.step ? r.step.due_date : r.task.due_date);
  const cmp = (a, b) => priorityRank(a.task.priority) - priorityRank(b.task.priority)
    || (due(a) || '9999').localeCompare(due(b) || '9999') || b.task.updated_at.localeCompare(a.task.updated_at);
  const now = rows.filter((r) => !['bloque', 'longue'].includes(stateOf(r))).sort(cmp);
  const longues = rows.filter((r) => stateOf(r) === 'longue').sort(cmp);
  const later = rows.filter((r) => stateOf(r) === 'bloque').sort(cmp);

  const renderCard = ({ task, step }) => {
    const idx = step ? task.steps.findIndex((s) => s.id === step.id) : -1;
    const prev = idx > 0 ? task.steps[idx - 1] : null;
    const d = step ? step.due_date : task.due_date;
    const late = d && d < today;
    const state = step ? step.status : task.status;
    const key = step ? `s${step.id}` : `t${task.id}`;
    return (
      <div key={key} style={{ ...card, borderLeft: `5px solid ${state === 'bloque' ? '#DF2F4A' : TACHES_COLOR}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onOpen(task.id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 17, fontWeight: 800, color: '#1F2937', textAlign: 'left',
          }}>{task.title}</button>
          {task.labels.map((l) => <span key={l} style={labelChip}>{l}</span>)}
          {task.comment_count > 0 && <span style={{ fontSize: 12, color: '#2563EB' }}>💬 {task.comment_count}</span>}
          <span style={{ flex: 1 }} />
          {task.link_url && <a href={task.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700 }}>Ouvrir le lien ↗</a>}
          {task.priority && <PriorityPill priority={task.priority} />}
        </div>

        {step && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
            {task.steps.map((s, i) => {
              const mine = s.id === step.id;
              const st = STEP_STATUS[s.status];
              return (
                <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span style={{ color: '#CBD5E1' }}>→</span>}
                  <span title={`${s.name} — ${st.label}${s.done_by_name ? ` (${s.done_by_name}, ${ago(s.done_at)})` : ''}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8,
                    border: mine ? `2px solid ${TACHES_COLOR}` : '1px solid #E5E7EB', background: mine ? '#EFF6FF' : '#fff',
                    opacity: i < idx ? 0.55 : 1, fontSize: 13, fontWeight: mine ? 800 : 600, color: '#374151',
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.bg, flexShrink: 0 }} />
                    {s.status === 'fait' ? <s style={{ textDecorationColor: '#9CA3AF' }}>{s.name}</s> : s.name}
                    <AvatarStack ids={s.owners} members={members} size={20} />
                  </span>
                </span>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#F9FAFB', borderRadius: 8, padding: '8px 10px', marginTop: step ? 0 : 10 }}>
          <span style={{ fontSize: 14, color: '#374151' }}>
            {step ? <>Mon étape : <strong>{step.name}</strong></> : <>Statut : <strong>{TASK_STATUS[task.status]?.label}</strong></>}
            {step && <span style={{ marginLeft: 8, background: STEP_STATUS[step.status].bg, color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontWeight: 700 }}>{STEP_STATUS[step.status].label}</span>}
            {step?.status === 'bloque' && prev && (
              <span style={{ color: '#B91C1C' }}> — attend « {prev.name} »{prev.owners.length ? ` (${prev.owners.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(', ')})` : ''}</span>
            )}
            {step && step.status !== 'bloque' && prev?.status === 'fait' && prev.done_by_name && (
              <span style={{ color: '#6B7280' }}> — « {prev.name} » fait par {prev.done_by_name} {ago(prev.done_at)}</span>
            )}
          </span>
          {d && (
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 6, padding: '2px 8px', background: late ? '#FEE2E2' : '#E5E7EB', color: late ? '#B91C1C' : '#374151' }}>
              {late ? 'En retard · ' : 'Pour le '}{formatDate(d)}
            </span>
          )}
          {step?.note && <span style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>{step.note}</span>}
          <span style={{ flex: 1 }} />
          {step ? (
            <>
              {step.status === 'a_faire' && <button type="button" style={btn()} disabled={busy === key} onClick={() => act(key, () => tachesApi.updateStep(step.id, { status: 'en_cours' }))}>Je commence</button>}
              {step.status === 'bloque' && (
                <button type="button" style={btn()} disabled={busy === key} title="Si l'étape précédente n'est pas nécessaire"
                  onClick={() => act(key, () => tachesApi.updateStep(step.id, { status: 'a_faire' }))}>Débloquer</button>
              )}
              <button type="button" disabled={busy === key} onClick={() => act(key, () => tachesApi.updateStep(step.id, { status: 'fait' }))}
                style={{ ...btn(true), background: '#00C875' }}>✓ Fait</button>
            </>
          ) : (
            <>
              {task.status === 'a_faire' && <button type="button" style={btn()} disabled={busy === key} onClick={() => act(key, () => tachesApi.updateTask(task.id, { manual_status: 'en_cours' }))}>Je commence</button>}
              <button type="button" disabled={busy === key} onClick={() => act(key, () => tachesApi.updateTask(task.id, { manual_status: 'fait' }))}
                style={{ ...btn(true), background: '#00C875' }}>✓ Terminée</button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2 style={h2}>À traiter maintenant <span style={{ color: '#9CA3AF', fontWeight: 600 }}>({now.length})</span></h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {now.length ? now.map(renderCard) : <div style={{ ...card, color: '#6B7280' }}>Rien à faire pour l'instant 🎉</div>}
      </div>

      {longues.length > 0 && (
        <>
          <h2 style={{ ...h2, marginTop: 26 }}>Tâches de fond <span style={{ color: '#9CA3AF', fontWeight: 600 }}>({longues.length})</span></h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{longues.map(renderCard)}</div>
        </>
      )}

      {later.length > 0 && (
        <>
          <h2 style={{ ...h2, marginTop: 26, marginBottom: 4 }}>Bientôt pour moi <span style={{ color: '#9CA3AF', fontWeight: 600 }}>({later.length})</span></h2>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 10px' }}>Bloqué : passera « À faire » quand l'étape d'avant sera faite.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{later.map(renderCard)}</div>
        </>
      )}
    </div>
  );
}
