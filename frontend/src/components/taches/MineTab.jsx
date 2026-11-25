import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { tachesApi, apiError, ago, formatDate, priorityRank, todayStr, STEP_STATUS, TACHES_COLOR } from './tachesShared';
import { PriorityPill, AvatarStack } from './tachesUi';
import { btn } from './tachesShared';

const card = {
  background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px',
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};

/**
 * Mon espace : les tâches où j'ai une étape à traiter. Toute la chaîne est
 * affichée — les étapes déjà passées en grisé, la mienne en évidence — pour
 * savoir d'où vient le travail et à qui il part ensuite.
 */
export default function MineTab({ members, reloadKey, onOpen }) {
  const { user } = useContext(AuthContext);
  const me = user?.id;
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.mine());
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(load, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  const setStatus = async (step, status) => {
    setBusy(step.id);
    try {
      await tachesApi.updateStep(step.id, { status });
      await load();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  if (tasks === null) return <div style={{ color: error ? '#B91C1C' : '#9CA3AF', padding: 20 }}>{error || 'Chargement…'}</div>;

  const today = todayStr();
  const myStep = (t) => t.steps.find((s) => s.status !== 'fait' && s.owners.includes(me));
  const rows = tasks.map((t) => ({ task: t, step: myStep(t) })).filter((r) => r.step);
  const sortKey = (r) => [
    priorityRank(r.task.priority),
    r.step.due_date || '9999-12-31',
    r.task.updated_at,
  ];
  const cmp = (a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || kb[2].localeCompare(ka[2]);
  };
  const now = rows.filter((r) => r.step.status !== 'bloque').sort(cmp);
  const later = rows.filter((r) => r.step.status === 'bloque').sort(cmp);

  const renderCard = ({ task, step }) => {
    const idx = task.steps.findIndex((s) => s.id === step.id);
    const prev = idx > 0 ? task.steps[idx - 1] : null;
    const late = step.due_date && step.due_date < today;
    return (
      <div key={task.id} style={{ ...card, borderLeft: `5px solid ${step.status === 'bloque' ? '#DF2F4A' : TACHES_COLOR}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => onOpen(task.id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 17, fontWeight: 800, color: '#1F2937', textAlign: 'left',
          }}>{task.title}</button>
          {task.label && <span style={{ background: '#E0EAFF', color: '#1E40AF', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>{task.label}</span>}
          {task.comment_count > 0 && <span style={{ fontSize: 12, color: '#2563EB' }}>💬 {task.comment_count}</span>}
          <span style={{ flex: 1 }} />
          {task.link_url && <a href={task.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700 }}>Ouvrir le lien ↗</a>}
          {task.priority && <PriorityPill priority={task.priority} />}
        </div>

        {/* La chaîne complète : passé grisé, mon étape en évidence */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
          {task.steps.map((s, i) => {
            const mine = s.id === step.id;
            const past = i < idx;
            const st = STEP_STATUS[s.status];
            return (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: '#CBD5E1' }}>→</span>}
                <span title={`${s.name} — ${st.label}${s.done_by_name ? ` (${s.done_by_name}, ${ago(s.done_at)})` : ''}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8,
                  border: mine ? `2px solid ${TACHES_COLOR}` : '1px solid #E5E7EB',
                  background: mine ? '#EFF6FF' : '#fff', opacity: past ? 0.55 : 1,
                  fontSize: 13, fontWeight: mine ? 800 : 600, color: '#374151',
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.bg, flexShrink: 0 }} />
                  {s.status === 'fait' ? <s style={{ textDecorationColor: '#9CA3AF' }}>{s.name}</s> : s.name}
                  <AvatarStack ids={s.owners} members={members} size={20} />
                </span>
              </span>
            );
          })}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: '#F9FAFB', borderRadius: 8, padding: '8px 10px',
        }}>
          <span style={{ fontSize: 14, color: '#374151' }}>
            Mon étape : <strong>{step.name}</strong>
            {step.status === 'bloque' && prev && (
              <span style={{ color: '#B91C1C' }}> — attend « {prev.name} »{prev.owners.length ? ` (${prev.owners.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(', ')})` : ''}</span>
            )}
            {step.status !== 'bloque' && prev?.status === 'fait' && prev.done_by_name && (
              <span style={{ color: '#6B7280' }}> — « {prev.name} » fait par {prev.done_by_name} {ago(prev.done_at)}</span>
            )}
          </span>
          {step.due_date && (
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 6, padding: '2px 8px', background: late ? '#FEE2E2' : '#E5E7EB', color: late ? '#B91C1C' : '#374151' }}>
              {late ? 'En retard · ' : 'Pour le '}{formatDate(step.due_date)}
            </span>
          )}
          {step.note && <span style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>{step.note}</span>}
          <span style={{ flex: 1 }} />
          {step.status === 'a_faire' && (
            <button type="button" style={btn()} disabled={busy === step.id} onClick={() => setStatus(step, 'en_cours')}>Je commence</button>
          )}
          {step.status === 'bloque' && (
            <button type="button" style={btn()} disabled={busy === step.id} onClick={() => setStatus(step, 'a_faire')}
              title="Si l'étape précédente n'est pas nécessaire">Débloquer</button>
          )}
          <button type="button" disabled={busy === step.id} onClick={() => setStatus(step, 'fait')}
            style={{ ...btn(true), background: '#00C875' }}>✓ Fait</button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {error && <div style={{ padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1F2937', margin: '4px 0 10px' }}>
        À traiter maintenant <span style={{ color: '#9CA3AF', fontWeight: 600 }}>({now.length})</span>
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {now.length ? now.map(renderCard) : (
          <div style={{ ...card, color: '#6B7280' }}>Rien à faire pour l'instant 🎉</div>
        )}
      </div>

      {later.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1F2937', margin: '26px 0 4px' }}>
            Bientôt pour moi <span style={{ color: '#9CA3AF', fontWeight: 600 }}>({later.length})</span>
          </h2>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 10px' }}>
            Mon étape est bloquée : elle passera « À faire » quand l'étape d'avant sera faite.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{later.map(renderCard)}</div>
        </>
      )}
    </div>
  );
}
