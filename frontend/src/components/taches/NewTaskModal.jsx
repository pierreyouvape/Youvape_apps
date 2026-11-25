import { useState } from 'react';
import TableauModal from '../tableau/TableauModal';
import { tachesApi, apiError, PRIORITY, PRIORITY_ORDER } from './tachesShared';
import { btn, inputStyle } from './tachesShared';
import StepsEditor from './StepsEditor';

const lbl = { display: 'block', fontSize: 12, fontWeight: 800, color: '#6B7280', margin: '12px 0 4px' };

/**
 * Nouvelle tâche. Choisir un modèle recopie ses étapes et leurs personnes,
 * modifiables avant de créer (un produit précis peut changer de photographe).
 */
export default function NewTaskModal({ templates, members, labels, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [label, setLabel] = useState('');
  const [priority, setPriority] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const pickTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === String(id));
    setSteps(t ? t.steps.map((s) => ({ ...s })) : []);
    if (t?.label && !label) setLabel(t.label);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const task = await tachesApi.createTask({
        title, link_url: link, label, priority: priority || null,
        steps: steps.filter((s) => s.name.trim()),
      });
      onCreated(task);
    } catch (err) {
      setError(apiError(err));
      setSaving(false);
    }
  };

  return (
    <TableauModal title="Nouvelle tâche" onClose={onClose} width={680}>
      <form onSubmit={submit}>
        <label style={{ ...lbl, marginTop: 0 }}>Titre *</label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="Xlim 4 Pro" />

        <label style={lbl}>Lien</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} style={inputStyle} placeholder="https://www.youvape.fr/produit/…" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Modèle d'étapes</label>
            <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={inputStyle}>
              <option value="">Aucun</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Étiquette</label>
            <input list="taches-new-labels" value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} />
            <datalist id="taches-new-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
          <div>
            <label style={lbl}>Priorité</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
              <option value="">Aucune</option>
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </div>
        </div>

        <label style={lbl}>Étapes</label>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 10 }}>
          <StepsEditor steps={steps} members={members} onChange={setSteps} />
        </div>
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '6px 0 0' }}>
          La première étape démarre « À faire », les suivantes « Bloqué » jusqu'à ce que la précédente soit faite.
        </p>

        {error && <div style={{ marginTop: 12, padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" style={btn()} onClick={onClose}>Annuler</button>
          <button type="submit" style={btn(true)} disabled={!title.trim() || saving}>{saving ? 'Création…' : 'Créer la tâche'}</button>
        </div>
      </form>
    </TableauModal>
  );
}
