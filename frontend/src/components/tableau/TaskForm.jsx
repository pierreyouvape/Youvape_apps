import { useContext, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import TableauModal from './TableauModal';
import { tableauApi, apiError, localToday, isoDowOf, WEEKDAYS, TABLEAU_COLOR, ruleSummary } from './tableauShared';

/** Délais de rappel proposés, en minutes avant l'heure de la tâche. */
const REMIND_PRESETS = [
  { value: '', label: 'Pas de rappel' },
  { value: '0', label: "À l'heure de la tâche" },
  { value: '15', label: '15 min avant' },
  { value: '30', label: '30 min avant' },
  { value: '60', label: '1 h avant' },
  { value: '120', label: '2 h avant' },
  { value: '1440', label: 'La veille (1 jour avant)' },
  { value: '2880', label: '2 jours avant' },
  { value: '10080', label: '1 semaine avant' },
  { value: 'custom', label: 'Autre délai…' },
];
const UNIT_MINUTES = { min: 1, h: 60, j: 1440 };

const label = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#374151', marginBottom: 5 };
const input = {
  width: '100%', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 8,
  padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', background: '#fff',
};
const row = { marginBottom: 14 };

const toMinutes = (r) => {
  if (r.preset === '') return null;
  if (r.preset === 'custom') return Math.max(0, Math.round(Number(r.amount) || 0)) * UNIT_MINUTES[r.unit];
  return Number(r.preset);
};

/** Choix d'un délai de rappel (préréglages, ou délai libre en minutes / heures / jours). */
function ReminderField({ title, value, onChange, disabled, hint }) {
  return (
    <div style={row}>
      <label style={label}>{title}</label>
      <select
        style={input}
        value={disabled ? '' : value.preset}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, preset: e.target.value })}
      >
        {REMIND_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {disabled && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 5 }}>{hint}</div>}
      {!disabled && value.preset === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input type="number" min={0} style={{ ...input, width: 90 }} value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })} />
          <select style={{ ...input, width: 'auto' }} value={value.unit}
            onChange={(e) => onChange({ ...value, unit: e.target.value })}>
            <option value="min">minutes</option>
            <option value="h">heures</option>
            <option value="j">jours</option>
          </select>
          <span style={{ fontSize: 14, color: '#374151' }}>avant</span>
        </div>
      )}
    </div>
  );
}

function initialRemind(minutes) {
  if (minutes === null || minutes === undefined) return { preset: '', amount: 1, unit: 'h' };
  if (REMIND_PRESETS.some((p) => p.value === String(minutes))) return { preset: String(minutes), amount: 1, unit: 'h' };
  if (minutes % 1440 === 0) return { preset: 'custom', amount: minutes / 1440, unit: 'j' };
  if (minutes % 60 === 0) return { preset: 'custom', amount: minutes / 60, unit: 'h' };
  return { preset: 'custom', amount: minutes, unit: 'min' };
}

/** Création / modification d'une tâche récurrente. */
export default function TaskForm({ task, onClose, onSaved }) {
  const today = localToday();
  const { user } = useContext(AuthContext);
  const userEmail = user?.email;
  const [form, setForm] = useState(() => ({
    title: task?.title || '',
    notes: task?.notes || '',
    unit: task?.unit || 'week',
    every: task?.every || 1,
    weekdays: task?.weekdays || [],
    month_day: task?.month_day || Number(today.slice(8, 10)),
    start_date: task?.start_date || today,
    due_time: task?.due_time || '',
  }));
  const [remind, setRemind] = useState(() => initialRemind(task?.remind_minutes));
  const [emailRemind, setEmailRemind] = useState(() => initialRemind(task?.email_remind_minutes));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleDay = (n) => set({
    weekdays: form.weekdays.includes(n) ? form.weekdays.filter((d) => d !== n) : [...form.weekdays, n].sort(),
  });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      every: Number(form.every),
      due_time: form.due_time || null,
      remind_minutes: form.due_time ? toMinutes(remind) : null,
      email_remind_minutes: form.due_time ? toMinutes(emailRemind) : null,
    };
    try {
      if (task) await tableauApi.updateTask(task.id, body);
      else await tableauApi.createTask(body);
      onSaved();
    } catch (err) {
      setError(apiError(err));
      setBusy(false);
    }
  };

  const unitLabels = { day: ['jour', 'jours'], week: ['semaine', 'semaines'], month: ['mois', 'mois'] };
  const summary = ruleSummary({
    ...form,
    every: Number(form.every) || 1,
    weekdays: form.weekdays.length ? form.weekdays : [isoDowOf(form.start_date || today)],
  });

  return (
    <TableauModal title={task ? 'Modifier la tâche' : 'Nouvelle tâche récurrente'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <div style={row}>
          <label style={label}>Tâche</label>
          <input style={input} value={form.title} onChange={(e) => set({ title: e.target.value })} autoFocus required
            placeholder="Ex. : relever les compteurs de stock" />
        </div>
        <div style={row}>
          <label style={label}>Note (facultative)</label>
          <textarea style={{ ...input, minHeight: 60, resize: 'vertical' }} value={form.notes}
            onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <div style={row}>
          <label style={label}>Répéter</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: '#374151' }}>Tous les</span>
            <input type="number" min={1} max={365} style={{ ...input, width: 80 }} value={form.every}
              onChange={(e) => set({ every: e.target.value })} required />
            <select style={{ ...input, width: 'auto' }} value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
              {Object.entries(unitLabels).map(([k, [one, many]]) => (
                <option key={k} value={k}>{Number(form.every) > 1 ? many : one}</option>
              ))}
            </select>
          </div>
        </div>

        {form.unit === 'week' && (
          <div style={row}>
            <label style={label}>Jours</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {WEEKDAYS.map((d) => {
                const on = form.weekdays.includes(d.n);
                return (
                  <button key={d.n} type="button" title={d.label} onClick={() => toggleDay(d.n)} style={{
                    width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                    border: on ? 'none' : '1px solid #D1D5DB', background: on ? TABLEAU_COLOR : '#fff',
                    color: on ? '#fff' : '#374151', fontFamily: 'inherit',
                  }}>
                    {d.short}
                  </button>
                );
              })}
            </div>
            {!form.weekdays.length && (
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 5 }}>Aucun jour coché : le jour de la date de début.</div>
            )}
          </div>
        )}

        {form.unit === 'month' && (
          <div style={row}>
            <label style={label}>Le</label>
            <select style={{ ...input, width: 'auto' }} value={form.month_day}
              onChange={(e) => set({ month_day: Number(e.target.value) })}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d === 1 ? '1er' : d}</option>
              ))}
              <option value={31}>dernier jour du mois</option>
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ ...row, flex: '1 1 180px' }}>
            <label style={label}>À partir du</label>
            <input type="date" style={input} value={form.start_date}
              onChange={(e) => set({ start_date: e.target.value })} required />
          </div>
          <div style={{ ...row, flex: '1 1 140px' }}>
            <label style={label}>Heure (facultative)</label>
            <input type="time" style={input} value={form.due_time} onChange={(e) => set({ due_time: e.target.value })} />
          </div>
        </div>

        <ReminderField title="Rappel à l'écran" value={remind} onChange={setRemind} disabled={!form.due_time}
          hint="Indiquez une heure pour programmer un rappel." />
        <ReminderField title={`Rappel par email${userEmail ? ` (${userEmail})` : ''}`} value={emailRemind}
          onChange={setEmailRemind} disabled={!form.due_time} hint="Indiquez une heure pour programmer un rappel." />

        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 14 }}>
          {summary}{form.due_time ? ` à ${form.due_time.replace(':', 'h')}` : ''}.
        </div>

        {error && <div style={{ fontSize: 13, color: '#B91C1C', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{
            border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700,
            background: '#F3F4F6', color: '#374151', cursor: 'pointer', fontFamily: 'inherit',
          }}>Annuler</button>
          <button type="submit" disabled={busy} style={{
            border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700,
            background: TABLEAU_COLOR, color: '#fff', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>{task ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </form>
    </TableauModal>
  );
}
