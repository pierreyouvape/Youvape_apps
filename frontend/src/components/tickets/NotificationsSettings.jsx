import { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { TICKETS_COLOR } from './ticketConstants';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav/notifications';

const TRIGGER_OPTIONS = [
  { value: 'new_message',    label: 'Nouveau message reçu', description: 'Ticket créé via le formulaire SAV' },
  { value: 'reply_received', label: 'Réponse reçue',        description: 'Réponse client par e-mail sur un ticket existant' },
];

const ACTION_OPTIONS = [
  { value: 'email', label: 'Envoyer un e-mail' },
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
const IconMail = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
  </svg>
);

// ─── Styles ──────────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '8px 12px', border: `1px solid ${C.grisCL}`,
  borderRadius: 7, fontSize: 13.5, fontFamily: 'Lato, sans-serif',
  color: C.grisTF, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.12s',
};

// ─── Toggle ──────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 38, height: 22, borderRadius: 99,
        background: checked ? TICKETS_COLOR : C.grisCL,
        border: 'none', cursor: 'pointer', padding: 0,
        position: 'relative', transition: 'background 0.15s',
        flexShrink: 0,
      }}
      title={checked ? 'Activée' : 'Désactivée'}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }} />
    </button>
  );
}

// ─── Formulaire (création + édition) ─────────────────────────────────────────
function NotificationForm({ initial, onSubmit, onCancel, submitLabel = 'Enregistrer' }) {
  const [trigger, setTrigger]       = useState(initial?.trigger || 'new_message');
  const [action, setAction]         = useState(initial?.action || 'email');
  const [recipients, setRecipients] = useState(initial?.recipients || '');
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const handleSubmit = async () => {
    if (action === 'email' && !recipients.trim()) {
      setError('Au moins un destinataire requis');
      return;
    }
    setSaving(true); setError('');
    const err = await onSubmit({ trigger, action, recipients });
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div style={{
      background: C.blanc, borderRadius: 10, border: `2px solid ${TICKETS_COLOR}`,
      padding: 18, boxShadow: `0 0 0 3px ${TICKETS_COLOR}18`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, marginBottom: 16 }}>
        {initial ? 'Modifier la notification' : 'Nouvelle notification'}
      </div>

      {/* Trigger */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
          Déclencheur *
        </label>
        <select value={trigger} onChange={e => setTrigger(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}>
          {TRIGGER_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, color: C.grisM, marginTop: 4 }}>
          {TRIGGER_OPTIONS.find(o => o.value === trigger)?.description}
        </div>
      </div>

      {/* Action */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
          Action *
        </label>
        <select value={action} onChange={e => setAction(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}>
          {ACTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Recipients (si action = email) */}
      {action === 'email' && (
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
            Destinataires *
          </label>
          <div style={{ fontSize: 11.5, color: C.grisM, marginBottom: 6, fontStyle: 'italic' }}>
            Séparez plusieurs adresses par une virgule (ex. <code style={{ background: C.grisTL, padding: '0 4px', borderRadius: 3 }}>jean@x.fr, marie@y.fr</code>).
          </div>
          <textarea
            value={recipients}
            onChange={e => setRecipients(e.target.value)}
            placeholder="adresse1@exemple.fr, adresse2@exemple.fr"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'Lato, sans-serif' }}
            onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
            onBlur={e => e.target.style.borderColor = C.grisCL}
          />
        </div>
      )}

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

// ─── Ligne notification ──────────────────────────────────────────────────────
function NotificationRow({ notif, onToggle, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <NotificationForm
        initial={notif}
        submitLabel="Enregistrer"
        onCancel={() => setEditing(false)}
        onSubmit={async (payload) => {
          const err = await onUpdate(notif.id, payload);
          if (!err) setEditing(false);
          return err;
        }}
      />
    );
  }

  const triggerLabel = TRIGGER_OPTIONS.find(o => o.value === notif.trigger)?.label || notif.trigger;
  const actionLabel  = ACTION_OPTIONS.find(o => o.value === notif.action)?.label  || notif.action;

  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`,
      borderRadius: 10, padding: '12px 16px',
      opacity: notif.enabled ? 1 : 0.62,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Toggle checked={notif.enabled} onChange={(v) => onToggle(notif.id, v)} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#E0F2FE', color: '#0369A1',
              padding: '2px 8px', borderRadius: 99,
            }}>
              Si {triggerLabel.toLowerCase()}
            </span>
            <span style={{ fontSize: 11, color: C.grisM, fontWeight: 700 }}>→</span>
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#E5F4EB', color: '#2A8049',
              padding: '2px 8px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <IconMail /> {actionLabel.toLowerCase()}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: C.grisF, fontWeight: 600 }}>
            À : <span style={{ color: C.grisTF, fontWeight: 700 }}>{notif.recipients}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
              <button onClick={() => onDelete(notif.id)}
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
function CreateNotificationForm({ onCreate }) {
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
        <IconPlus /> Nouvelle notification
      </button>
    );
  }

  return (
    <NotificationForm
      submitLabel="Créer la notification"
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
export default function NotificationsSettings() {
  const { token } = useContext(AuthContext);
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const fetchNotifs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(API, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setNotifs(data.notifications || []);
      else setError(data.error || 'Erreur de chargement');
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, [token, authHeaders]);

  useEffect(() => { fetchNotifs(); }, [fetchNotifs]);

  const handleCreate = async (payload) => {
    const res = await fetch(API, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur création';
    setNotifs(prev => [data.notification, ...prev]);
    return null;
  };

  const handleUpdate = async (id, payload) => {
    const res = await fetch(`${API}/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur sauvegarde';
    setNotifs(prev => prev.map(n => n.id === id ? data.notification : n));
    return null;
  };

  const handleToggle = async (id, enabled) => {
    await handleUpdate(id, { enabled });
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/${id}`, { method: 'DELETE', headers: authHeaders() });
    setNotifs(prev => prev.filter(n => n.id !== id));
  };

  return (
    <>
      <div style={{
        background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`,
        border: `1px solid ${TICKETS_COLOR}30`, borderRadius: 10,
        padding: '14px 18px', marginBottom: 24,
        fontSize: 13, color: C.grisF, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.grisTF }}>Notifications</strong> — Recevez un e-mail à chaque nouvel événement SAV.
        Vos règles ne sont visibles que par vous. Vous pouvez activer / désactiver chaque règle à volonté.
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM }}>Chargement…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#DC2626' }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notifs.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: C.grisM, fontSize: 13, fontStyle: 'italic' }}>
              Aucune notification configurée pour le moment.
            </div>
          )}
          {notifs.map(n => (
            <NotificationRow
              key={n.id}
              notif={n}
              onToggle={handleToggle}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
          <div style={{ marginTop: 6 }}>
            <CreateNotificationForm onCreate={handleCreate} />
          </div>
        </div>
      )}
    </>
  );
}
