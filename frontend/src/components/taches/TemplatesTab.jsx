import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { tachesApi, apiError } from './tachesShared';
import { btn, inputStyle, labelChip } from './tachesShared';
import { LabelsInput } from './tachesUi';
import StepsEditor from './StepsEditor';

/** Modèles d'enchaînement (Fiche Produit…), recopiés à la création d'une tâche. */
export default function TemplatesTab({ members, labels, templates, onChange }) {
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const canEdit = isSuperAdmin || permissions?.taches?.write === true;
  const [editing, setEditing] = useState(null); // null | { id?, name, label, steps }
  const [error, setError] = useState(null);

  useEffect(() => { setError(null); }, [editing]);

  const save = async () => {
    try {
      const list = editing.id
        ? await tachesApi.updateTemplate(editing.id, editing)
        : await tachesApi.createTemplate(editing);
      onChange(list);
      setEditing(null);
    } catch (e) {
      setError(apiError(e));
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`Supprimer le modèle « ${t.name} » ? Les tâches déjà créées ne changent pas.`)) return;
    try { onChange(await tachesApi.deleteTemplate(t.id)); } catch (e) { setError(apiError(e)); }
  };

  const names = (ids) => ids.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean).join(', ') || '—';

  return (
    <div style={{ maxWidth: 900 }}>
      {!canEdit && <p style={{ fontSize: 13, color: 'var(--tk-sub)' }}>Lecture seule : modifier les modèles demande le droit d'écriture sur l'app Tâches.</p>}
      {error && <div style={{ padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {editing ? (
        <div style={{ background: 'var(--tk-surface)', border: '1px solid var(--tk-line)', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--tk-sub)', marginBottom: 4 }}>Nom du modèle</div>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--tk-sub)', marginBottom: 4 }}>Étiquettes posées sur la tâche</div>
              <LabelsInput value={editing.labels || []} suggestions={labels} onChange={(l) => setEditing({ ...editing, labels: l })} />
            </div>
          </div>
          <StepsEditor steps={editing.steps} members={members} onChange={(steps) => setEditing({ ...editing, steps })} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" style={btn()} onClick={() => setEditing(null)}>Annuler</button>
            <button type="button" style={btn(true)} onClick={save} disabled={!editing.name.trim()}>Enregistrer</button>
          </div>
        </div>
      ) : (
        <>
          {canEdit && (
            <button type="button" style={{ ...btn(true), marginBottom: 14 }}
              onClick={() => setEditing({ name: '', labels: [], steps: [{ name: '', owners: [], notify: [] }] })}>
              + Nouveau modèle
            </button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ background: 'var(--tk-surface)', border: '1px solid var(--tk-line)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <strong style={{ fontSize: 16, color: 'var(--tk-text)' }}>{t.name}</strong>
                  {(t.labels || []).map((l) => <span key={l} style={labelChip}>{l}</span>)}
                  <span style={{ flex: 1 }} />
                  {canEdit && <button type="button" style={btn()} onClick={() => setEditing({ ...t, steps: t.steps.map((s) => ({ ...s })) })}>Modifier</button>}
                  {canEdit && <button type="button" style={{ ...btn(), color: 'var(--tk-danger)' }} onClick={() => remove(t)}>Supprimer</button>}
                </div>
                <ol style={{ margin: 0, paddingLeft: 22, fontSize: 14, color: 'var(--tk-text2)' }}>
                  {t.steps.map((s, i) => (
                    <li key={i} style={{ padding: '2px 0' }}>
                      <strong>{s.name}</strong>{s.ask_link && <span title="Demande le lien de la fiche produit"> 🔗</span>}
                      <span style={{ color: 'var(--tk-sub)' }}> — fait par {names(s.owners)} · prévient {names(s.notify)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {!templates.length && <div style={{ color: 'var(--tk-muted)' }}>Aucun modèle.</div>}
          </div>
        </>
      )}
    </div>
  );
}
