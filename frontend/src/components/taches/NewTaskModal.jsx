import { useState } from 'react';
import TableauModal from '../tableau/TableauModal';
import { tachesApi, apiError, PRIORITY, PRIORITY_ORDER, btn, inputStyle } from './tachesShared';
import { LabelsInput, PeoplePicker } from './tachesUi';
import StepsEditor from './StepsEditor';

const lbl = { display: 'block', fontSize: 12, fontWeight: 800, color: 'var(--tk-sub)', margin: '12px 0 4px' };

/**
 * Nouvelle tâche. Choisir un modèle recopie ses étapes et leurs personnes,
 * modifiables avant de créer (un produit précis peut changer de photographe).
 */
export default function NewTaskModal({ templates, members, labels, boards, preset = {}, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [taskLabels, setTaskLabels] = useState([]);
  const [priority, setPriority] = useState('');
  const [boardId, setBoardId] = useState(preset.board_id || boards[0]?.id || '');
  const [groupId, setGroupId] = useState(preset.group_id || '');
  const [people, setPeople] = useState([]);
  const [start, setStart] = useState(preset.start_date || '');
  const [due, setDue] = useState(preset.due_date || '');
  const [templateId, setTemplateId] = useState('');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const board = boards.find((b) => String(b.id) === String(boardId));

  const pickTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === String(id));
    setSteps(t ? t.steps.map((s) => ({ ...s })) : []);
    if (t?.labels?.length) setTaskLabels((cur) => [...new Set([...cur, ...t.labels])]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const task = await tachesApi.createTask({
        title, link_url: link, labels: taskLabels, priority: priority || null,
        board_id: Number(boardId) || undefined, group_id: Number(groupId) || undefined,
        people, start_date: start || null, due_date: due || null,
        steps: steps.filter((s) => s.name.trim()),
      });
      onCreated(task);
    } catch (err) {
      setError(apiError(err));
      setSaving(false);
    }
  };

  return (
    <TableauModal title="Nouvelle tâche" onClose={onClose} width={720} overlayClassName="tk-overlay" boxClassName="tk-pop">
      <form onSubmit={submit}>
        <label style={{ ...lbl, marginTop: 0 }}>Titre *</label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="Xlim 4 Pro" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Tableau</label>
            <select value={boardId} onChange={(e) => { setBoardId(e.target.value); setGroupId(''); }} style={inputStyle}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Groupe</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={inputStyle}>
              {(board?.groups || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <label style={lbl}>Lien</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} style={inputStyle} placeholder="https://www.youvape.fr/produit/…" />

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Étiquettes</label>
            <LabelsInput value={taskLabels} suggestions={labels} onChange={setTaskLabels} />
          </div>
          <div>
            <label style={lbl}>Priorité</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
              <option value="">Aucune</option>
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Personne(s)</label>
            <PeoplePicker title="Personne(s) de la tâche" value={people} members={members} onChange={setPeople} />
          </div>
          <div>
            <label style={lbl}>Début</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={lbl}>Fin</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <label style={lbl}>Modèle d'étapes</label>
        <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={inputStyle}>
          <option value="">Aucun (tâche simple, ou étapes ajoutées à la main)</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.steps.length} étapes)</option>)}
        </select>

        <label style={lbl}>Étapes</label>
        <div style={{ border: '1px solid var(--tk-line)', borderRadius: 8, padding: 10 }}>
          <StepsEditor steps={steps} members={members} onChange={setSteps} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--tk-muted)', margin: '6px 0 0' }}>
          La première étape démarre « À faire », les suivantes « Bloqué » jusqu'à ce que la précédente soit faite.
        </p>

        {error && <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" style={btn()} onClick={onClose}>Annuler</button>
          <button type="submit" style={btn(true)} disabled={!title.trim() || saving}>{saving ? 'Création…' : 'Créer la tâche'}</button>
        </div>
      </form>
    </TableauModal>
  );
}
