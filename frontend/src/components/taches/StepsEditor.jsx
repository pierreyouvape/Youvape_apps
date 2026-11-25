import { PeoplePicker } from './tachesUi';
import { inputStyle } from './tachesShared';

/**
 * Liste d'étapes à plat (nom, responsables, à prévenir), pour un modèle ou une
 * tâche en cours de création. Rien n'est enregistré ici : `onChange(steps)`.
 */
export default function StepsEditor({ steps, members, onChange }) {
  const set = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const small = { background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 12, padding: '0 3px' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 24px', gap: 8, fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', padding: '0 0 4px' }}>
        <span />
        <span>Étape</span>
        <span style={{ textAlign: 'center' }}>Responsable</span>
        <span style={{ textAlign: 'center' }}>À prévenir</span>
        <span />
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 90px 24px', gap: 8, alignItems: 'center', padding: '3px 0' }}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <button type="button" style={{ ...small, visibility: i ? 'visible' : 'hidden' }} onClick={() => move(i, -1)} title="Monter">▲</button>
            <button type="button" style={{ ...small, visibility: i < steps.length - 1 ? 'visible' : 'hidden' }} onClick={() => move(i, 1)} title="Descendre">▼</button>
          </span>
          <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={`Étape ${i + 1}`}
            style={{ ...inputStyle, padding: '6px 8px' }} />
          <span style={{ textAlign: 'center' }}>
            <PeoplePicker title="Responsable(s)" value={s.owners || []} members={members} onChange={(owners) => set(i, { owners })} />
          </span>
          <span style={{ textAlign: 'center' }}>
            <PeoplePicker title="À prévenir quand c'est fait" value={s.notify || []} members={members} onChange={(notify) => set(i, { notify })} />
          </span>
          <button type="button" onClick={() => onChange(steps.filter((_, j) => j !== i))} title="Retirer"
            style={{ background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, { name: '', owners: [], notify: [] }])}
        style={{ background: 'none', border: 'none', color: '#2563EB', fontWeight: 700, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit', fontSize: 13 }}>
        + Ajouter une étape
      </button>
    </div>
  );
}
