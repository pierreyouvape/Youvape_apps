import { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { useTicketStatuses } from './useTicketStatuses';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav/automations';

const CONDITION_TYPES = [
  { value: 'status_since',      label: 'Statut depuis…',           help: 'Le ticket est au statut filtré depuis au moins X temps.' },
  { value: 'no_customer_reply', label: 'Sans réponse client depuis…', help: 'Aucune réponse du client depuis X temps.' },
  { value: 'no_agent_action',   label: 'Sans action agent depuis…', help: 'Aucune réponse de l\'équipe depuis X temps.' },
];

const UNIT_OPTIONS = [
  { value: 'hours', label: 'heures' },
  { value: 'days',  label: 'jours' },
];

// ─── Icônes ──────────────────────────────────────────────────────────────────
const IconPlus = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconEdit = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconTrash = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);
const IconCheck = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconX = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const IconPlay = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M7 4v16l13-8z" />
  </svg>
);

const inputStyle = {
  width: '100%', padding: '8px 12px', border: `1px solid ${C.grisCL}`,
  borderRadius: 7, fontSize: 13.5, fontFamily: 'Lato, sans-serif',
  color: C.grisTF, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.12s',
};

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 38, height: 22, borderRadius: 99,
        background: checked ? TICKETS_COLOR : C.grisCL,
        border: 'none', cursor: 'pointer', padding: 0,
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
      title={checked ? 'Activé' : 'Désactivé'}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }} />
    </button>
  );
}

// ─── Une ligne de condition (dans le form) ───────────────────────────────────
function ConditionRow({ cond, onChange, onRemove, canRemove }) {
  const typeMeta = CONDITION_TYPES.find(t => t.value === cond.type);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
      <div style={{ flex: 2 }}>
        <select
          value={cond.type}
          onChange={e => onChange({ ...cond, type: e.target.value })}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {CONDITION_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {typeMeta?.help && (
          <div style={{ fontSize: 11, color: C.grisM, marginTop: 3 }}>{typeMeta.help}</div>
        )}
      </div>
      <div style={{ width: 80 }}>
        <input
          type="number" min={1} step={1}
          value={cond.value}
          onChange={e => onChange({ ...cond, value: e.target.value })}
          style={{ ...inputStyle, textAlign: 'center' }}
        />
      </div>
      <div style={{ width: 100 }}>
        <select
          value={cond.unit}
          onChange={e => onChange({ ...cond, unit: e.target.value })}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {UNIT_OPTIONS.map(u => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </div>
      <button
        onClick={onRemove} disabled={!canRemove}
        style={{
          width: 36, height: 36, borderRadius: 7,
          border: `1px solid ${canRemove ? '#FECACA' : C.grisCL}`,
          background: canRemove ? '#FEF2F2' : C.grisTL,
          color: canRemove ? '#DC2626' : C.grisCL,
          cursor: canRemove ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
        title={canRemove ? 'Supprimer cette condition' : 'Au moins une condition requise'}
      >
        <IconX />
      </button>
    </div>
  );
}

// ─── Formulaire (création + édition) ─────────────────────────────────────────
function AutomationForm({ initial, statuses, onSubmit, onCancel, submitLabel = 'Enregistrer' }) {
  const [name,         setName]         = useState(initial?.name || '');
  const [description,  setDescription]  = useState(initial?.description || '');
  const [filterStatus, setFilterStatus] = useState(initial?.filter_status || '');
  const [conditions,   setConditions]   = useState(
    Array.isArray(initial?.conditions) && initial.conditions.length > 0
      ? initial.conditions
      : [{ type: 'status_since', value: 72, unit: 'hours' }]
  );
  const [targetStatus, setTargetStatus] = useState(initial?.target_status || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Nom requis'); return; }
    if (!targetStatus) { setError('Statut cible requis'); return; }
    if (filterStatus && filterStatus === targetStatus) {
      setError('Le statut cible doit être différent du statut source'); return;
    }
    if (conditions.length === 0) { setError('Au moins une condition est requise'); return; }
    for (const c of conditions) {
      const v = parseInt(c.value, 10);
      if (!Number.isFinite(v) || v <= 0) { setError('Toutes les conditions doivent avoir une valeur > 0'); return; }
    }
    setSaving(true); setError('');
    const err = await onSubmit({
      name: name.trim(),
      description: description || null,
      filter_status: filterStatus || null,
      conditions: conditions.map(c => ({ type: c.type, value: parseInt(c.value, 10), unit: c.unit })),
      target_status: targetStatus,
    });
    setSaving(false);
    if (err) setError(err);
  };

  const updateCond = (idx, next) => setConditions(prev => prev.map((c, i) => i === idx ? next : c));
  const addCond    = () => setConditions(prev => [...prev, { type: 'status_since', value: 24, unit: 'hours' }]);
  const removeCond = (idx) => setConditions(prev => prev.filter((_, i) => i !== idx));

  return (
    <div style={{
      background: C.blanc, borderRadius: 10, border: `2px solid ${TICKETS_COLOR}`,
      padding: 18, boxShadow: `0 0 0 3px ${TICKETS_COLOR}18`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, marginBottom: 16 }}>
        {initial ? 'Modifier l\'automatisme' : 'Nouvel automatisme'}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Nom *</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Ex : Relance attente transporteur"
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
          autoFocus />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Optionnel"
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Statut source (filtre, optionnel)</label>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">— Tous les statuts —</option>
          {statuses.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
          Conditions (toutes doivent être vraies)
        </label>
        {conditions.map((c, i) => (
          <ConditionRow
            key={i} cond={c}
            onChange={(next) => updateCond(i, next)}
            onRemove={() => removeCond(i)}
            canRemove={conditions.length > 1}
          />
        ))}
        <button onClick={addCond}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 7,
            border: `1px dashed ${C.grisCL}`, background: C.grisTL,
            color: TICKETS_COLOR, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'Lato, sans-serif', marginTop: 4,
          }}>
          <IconPlus /> Ajouter une condition
        </button>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Statut cible *</label>
        <select value={targetStatus} onChange={e => setTargetStatus(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">— Choisir un statut —</option>
          {statuses.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12.5, color: '#DC2626', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSubmit} disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 7, border: 'none',
            background: saving ? C.grisM : TICKETS_COLOR,
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>
          <IconCheck /> {saving ? 'Enregistrement…' : submitLabel}
        </button>
        <button onClick={onCancel}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 7,
            border: `1px solid ${C.grisCL}`, background: C.blanc,
            color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
          <IconX /> Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Ligne automatisme ───────────────────────────────────────────────────────
function AutomationRow({ auto, statuses, onToggle, onUpdate, onDelete, onRunNow }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [running, setRunning] = useState(false);

  if (editing) {
    return (
      <AutomationForm
        initial={auto}
        statuses={statuses}
        submitLabel="Enregistrer"
        onCancel={() => setEditing(false)}
        onSubmit={async (payload) => {
          const err = await onUpdate(auto.id, payload);
          if (!err) setEditing(false);
          return err;
        }}
      />
    );
  }

  const filterObj = auto.filter_status ? statuses.find(s => s.value === auto.filter_status) : null;
  const targetObj = statuses.find(s => s.value === auto.target_status);

  const conditionLabel = (c) => {
    const typeMeta = CONDITION_TYPES.find(t => t.value === c.type);
    const unit = c.unit === 'days' ? (c.value > 1 ? 'jours' : 'jour') : 'h';
    return `${typeMeta?.label.replace('…', '')} ${c.value} ${unit}`;
  };

  const handleRunNow = async () => {
    setRunning(true);
    await onRunNow(auto.id);
    setRunning(false);
  };

  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`,
      borderRadius: 10, padding: '12px 16px',
      opacity: auto.enabled ? 1 : 0.62,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Toggle checked={auto.enabled} onChange={(v) => onToggle(auto.id, v)} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.grisTF, marginBottom: 4 }}>
            {auto.name}
          </div>
          {auto.description && (
            <div style={{ fontSize: 12.5, color: C.grisF, marginBottom: 6 }}>{auto.description}</div>
          )}

          {/* Récap visuel : SI <filtre + conditions> ALORS <cible> */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.grisM }}>SI</span>
            {filterObj ? (
              <span style={{ fontSize: 11, fontWeight: 700, background: filterObj.bg_color, color: filterObj.text_color, padding: '2px 8px', borderRadius: 99 }}>
                {filterObj.label}
              </span>
            ) : (
              <span style={{ fontSize: 11, fontStyle: 'italic', color: C.grisM }}>tous statuts</span>
            )}
            <span style={{ fontSize: 11, color: C.grisM }}>·</span>
            {(auto.conditions || []).map((c, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 600, background: '#E0F2FE', color: '#0369A1',
                padding: '2px 8px', borderRadius: 99,
              }}>
                {conditionLabel(c)}
              </span>
            ))}
            <span style={{ fontSize: 11, fontWeight: 700, color: C.grisM, marginLeft: 4 }}>ALORS →</span>
            {targetObj && (
              <span style={{ fontSize: 11, fontWeight: 700, background: targetObj.bg_color, color: targetObj.text_color, padding: '2px 8px', borderRadius: 99 }}>
                {targetObj.label}
              </span>
            )}
          </div>

          {/* Dernière exécution */}
          {auto.last_run_at && (
            <div style={{ fontSize: 11, color: C.grisM, fontStyle: 'italic' }}>
              Dernière exécution : {formatDate(auto.last_run_at, { time: true })}
              {' · '}
              <strong style={{ color: auto.last_run_count > 0 ? C.grisF : C.grisM }}>
                {auto.last_run_count} ticket{auto.last_run_count > 1 ? 's' : ''} modifié{auto.last_run_count > 1 ? 's' : ''}
              </strong>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={handleRunNow} disabled={running}
            title="Exécuter maintenant"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: running ? C.grisM : '#E5F4EB', color: running ? '#fff' : '#2A8049', fontSize: 12, fontWeight: 600, cursor: running ? 'wait' : 'pointer' }}>
            <IconPlay /> {running ? '…' : 'Lancer'}
          </button>
          <button onClick={() => setEditing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.grisTL, color: C.grisF, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <IconEdit /> Modifier
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <IconTrash /> Supprimer
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>Confirmer ?</span>
              <button onClick={() => onDelete(auto.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#DC2626', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <IconCheck /> Oui
              </button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, fontSize: 12, cursor: 'pointer' }}>
                <IconX />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section création repliée ────────────────────────────────────────────────
function CreateAutomationForm({ statuses, onCreate }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 8,
          border: `2px dashed ${C.grisCL}`, background: C.grisTL,
          color: TICKETS_COLOR, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', width: '100%', justifyContent: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = TICKETS_COLOR; e.currentTarget.style.background = '#E0F7FA'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.grisCL; e.currentTarget.style.background = C.grisTL; }}>
        <IconPlus /> Nouvel automatisme
      </button>
    );
  }
  return (
    <AutomationForm
      statuses={statuses}
      submitLabel="Créer l'automatisme"
      onCancel={() => setOpen(false)}
      onSubmit={async (payload) => {
        const err = await onCreate(payload);
        if (!err) setOpen(false);
        return err;
      }}
    />
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────
export default function AutomationsSettings() {
  const { token } = useContext(AuthContext);
  const { statuses } = useTicketStatuses();
  const [autos, setAutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const fetchAutos = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setAutos(data.automations || []);
      else setError(data.error || 'Erreur de chargement');
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, [token, authHeaders]);

  useEffect(() => { fetchAutos(); }, [fetchAutos]);

  const handleCreate = async (payload) => {
    const res = await fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur création';
    setAutos(prev => [data.automation, ...prev]);
    return null;
  };

  const handleUpdate = async (id, payload) => {
    const res = await fetch(`${API}/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur sauvegarde';
    setAutos(prev => prev.map(a => a.id === id ? data.automation : a));
    return null;
  };

  const handleToggle = async (id, enabled) => handleUpdate(id, { enabled });

  const handleDelete = async (id) => {
    await fetch(`${API}/${id}`, { method: 'DELETE', headers: authHeaders() });
    setAutos(prev => prev.filter(a => a.id !== id));
  };

  const handleRunNow = async (id) => {
    try {
      const res = await fetch(`${API}/${id}/run`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (data.success && data.automation) {
        setAutos(prev => prev.map(a => a.id === id ? data.automation : a));
      }
    } catch { /* silencieux */ }
  };

  return (
    <>
      <div style={{
        background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`,
        border: `1px solid ${TICKETS_COLOR}30`, borderRadius: 10,
        padding: '14px 18px', marginBottom: 24,
        fontSize: 13, color: C.grisF, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.grisTF }}>Automatismes</strong> — Changez automatiquement le statut des tickets selon des conditions temporelles.
        Exemple : <em>« Si le ticket est en attente réponse transporteur depuis 72h, le repasser à Ouvert. »</em>
        Évalués toutes les heures. Le bouton <strong>Lancer</strong> permet d'exécuter manuellement pour tester.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM }}>Chargement…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#DC2626' }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {autos.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: C.grisM, fontSize: 13, fontStyle: 'italic' }}>
              Aucun automatisme configuré.
            </div>
          )}
          {autos.map(a => (
            <AutomationRow
              key={a.id}
              auto={a}
              statuses={statuses}
              onToggle={handleToggle}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onRunNow={handleRunNow}
            />
          ))}
          <div style={{ marginTop: 6 }}>
            <CreateAutomationForm statuses={statuses} onCreate={handleCreate} />
          </div>
        </div>
      )}
    </>
  );
}
