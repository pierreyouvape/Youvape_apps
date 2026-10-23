import { useContext, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import TableauModal from './TableauModal';
import { tableauApi, apiError, localToday, addDaysYmd, isoDowOf, formatDue, TABLEAU_COLOR } from './tableauShared';

const pad = (n) => String(n).padStart(2, '0');
const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Raccourcis : dans 1 h (arrondi aux 5 min), ce soir 18h, demain 9h, lundi 9h. */
function shortcuts() {
  const today = localToday();
  const inHour = new Date(Date.now() + 60 * 60 * 1000);
  inHour.setMinutes(Math.ceil(inHour.getMinutes() / 5) * 5, 0, 0);
  const inHourYmd = `${inHour.getFullYear()}-${pad(inHour.getMonth() + 1)}-${pad(inHour.getDate())}`;
  const list = [{ label: 'Dans 1 h', date: inHourYmd, time: `${pad(inHour.getHours())}:${pad(inHour.getMinutes())}` }];
  if (nowHm() < '18:00') list.push({ label: 'Ce soir 18h', date: today, time: '18:00' });
  list.push({ label: 'Demain 9h', date: addDaysYmd(today, 1), time: '09:00' });
  const dow = isoDowOf(today);
  list.push({ label: 'Lundi 9h', date: addDaysYmd(today, dow === 1 ? 7 : 8 - dow), time: '09:00' });
  return list;
}

const label = { display: 'block', fontSize: 12.5, fontWeight: 700, color: '#374151', marginBottom: 5 };
const input = {
  width: '100%', boxSizing: 'border-box', border: '1px solid #D1D5DB', borderRadius: 8,
  padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', background: '#fff',
};
const btn = (primary, danger) => ({
  border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', background: primary ? TABLEAU_COLOR : danger ? '#FEE2E2' : '#F3F4F6',
  color: primary ? '#fff' : danger ? '#B91C1C' : '#374151',
});

/** Programmer, modifier ou retirer le rappel d'un post-it. */
export default function NoteReminderDialog({ note, onClose, onSaved }) {
  const { user } = useContext(AuthContext);
  const [date, setDate] = useState(note.remind_at?.slice(0, 10) || addDaysYmd(localToday(), 1));
  const [time, setTime] = useState(note.remind_at?.slice(11, 16) || '09:00');
  const [screen, setScreen] = useState(note.remind_at ? note.remind_screen : true);
  const [email, setEmail] = useState(note.remind_at ? note.remind_email : false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await fn());
    } catch (e) {
      setError(apiError(e));
      setBusy(false);
    }
  };
  const save = () => run(() => tableauApi.setReminder(note.id, { remind_at: `${date} ${time}`, screen, email }));
  const clear = () => run(() => tableauApi.clearReminder(note.id));

  const check = (checked, onChange, text) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#1F2937', cursor: 'pointer', marginBottom: 8 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  );

  return (
    <TableauModal title="Rappel du post-it" onClose={onClose}>
      {note.remind_due && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 8, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
          Rappel arrivé ({formatDue(note.remind_at.slice(0, 10), note.remind_at.slice(11, 16))}).
          « OK » le ferme ; ou choisissez une nouvelle date pour le reprogrammer.
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {shortcuts().map((s) => (
          <button key={s.label} type="button" onClick={() => { setDate(s.date); setTime(s.time); }} style={{
            ...btn(false), padding: '6px 11px', fontSize: 12.5,
            outline: s.date === date && s.time === time ? `2px solid ${TABLEAU_COLOR}` : 'none',
          }}>
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Date</label>
          <input type="date" style={input} value={date} min={localToday()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={label}>Heure</label>
          <input type="time" style={input} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      {check(screen, setScreen, 'Notification à l\'écran')}
      {check(email, setEmail, `Email${user?.email ? ` (${user.email})` : ''}`)}

      {error && <div style={{ fontSize: 13, color: '#B91C1C', margin: '8px 0' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
        {note.remind_at && (
          <button type="button" disabled={busy} onClick={clear} style={btn(false, !note.remind_due)}>
            {note.remind_due ? 'OK' : 'Retirer le rappel'}
          </button>
        )}
        <button type="button" onClick={onClose} style={btn(false)}>Annuler</button>
        <button type="button" disabled={busy || !date || !time || (!screen && !email)} onClick={save} style={btn(true)}>
          Programmer
        </button>
      </div>
    </TableauModal>
  );
}
