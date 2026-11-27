import { useState } from 'react';
import TableauModal from '../tableau/TableauModal';
import { btn, inputStyle, M } from './tachesShared';
import { Avatar } from './tachesUi';

/**
 * Créer ou modifier une vue du menu : nom et partage. Une vue est PERSONNELLE
 * par défaut ; « Partager cette vue » la montre à toute l'équipe ou aux
 * personnes choisies. `onSave({ name, shared, shared_all, shared_with })`.
 */
export default function ViewModal({ view = null, members, meId, onClose, onSave }) {
  const [name, setName] = useState(view?.name || '');
  const [shared, setShared] = useState(Boolean(view && (view.shared_all || view.shared_with?.length)));
  const [all, setAll] = useState(Boolean(view?.shared_all));
  const [ids, setIds] = useState(view?.shared_with || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const people = members.filter((m) => m.has_app !== false && m.id !== meId);
  const toggle = (id) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const ready = name.trim() && (!shared || all || ids.length);

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSave({ name: name.trim(), shared, shared_all: shared && all, shared_with: shared && !all ? ids : [] });
    setBusy(false);
    if (err) setError(err);
  };

  const radio = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer', color: M.text };
  return (
    <TableauModal title={view ? 'Modifier la vue' : 'Nouvelle vue'} onClose={onClose} width={480} overlayClassName="tk-overlay" boxClassName="tk-pop">
      <form onSubmit={submit}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: M.sub, marginBottom: 4 }}>Nom</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. « SEO (Jib) »" maxLength={80} style={inputStyle} />
        {!view && <div style={{ fontSize: 12, color: M.sub, marginTop: 4 }}>Enregistre les filtres affichés en ce moment.</div>}

        <label style={{ ...radio, marginTop: 16, fontWeight: 700 }}>
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Partager cette vue
        </label>
        <div style={{ fontSize: 12, color: M.sub, margin: '2px 0 0 22px' }}>
          {shared ? 'Les personnes choisies la verront dans leur menu, sans pouvoir la modifier.' : 'Personnelle : vous seul la voyez.'}
        </div>
        {shared && (
          <div style={{ margin: '10px 0 0 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={radio}><input type="radio" checked={all} onChange={() => setAll(true)} /> Toute l'équipe</label>
            <label style={radio}><input type="radio" checked={!all} onChange={() => setAll(false)} /> Certaines personnes</label>
            {!all && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 22 }}>
                {people.map((m) => {
                  const on = ids.includes(m.id);
                  return (
                    <button key={m.id} type="button" onClick={() => toggle(m.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                      border: `1px solid ${on ? '#0073EA' : M.border}`, background: on ? 'var(--tk-sel)' : 'transparent', color: M.text, fontWeight: on ? 700 : 400,
                    }}>
                      <Avatar id={m.id} name={m.name} size={22} />{m.name}{on ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {error && <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btn()}>Annuler</button>
          <button type="submit" disabled={!ready || busy} style={{ ...btn(true), opacity: ready && !busy ? 1 : 0.5 }}>
            {view ? 'Enregistrer' : 'Créer la vue'}
          </button>
        </div>
      </form>
    </TableauModal>
  );
}
