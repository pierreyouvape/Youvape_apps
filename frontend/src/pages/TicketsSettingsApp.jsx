import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { Tickets as TicketsIcon } from '../components/AppIcons';
import { invalidateStatusCache } from '../components/tickets/useTicketStatuses';

const TICKETS_COLOR = '#0891B2';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav';

// ─── Icônes ───────────────────────────────────────────────────────────────────
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

// ─── Palette de couleurs suggérées ───────────────────────────────────────────
const COLOR_PALETTES = [
  { bg: '#FDEAEA', text: '#B71D1D', name: 'Rouge' },
  { bg: '#FEF3C7', text: '#92400E', name: 'Ambre' },
  { bg: '#FFF7ED', text: '#C2410C', name: 'Orange' },
  { bg: '#E5EEF6', text: '#2C5F80', name: 'Bleu' },
  { bg: '#E0F2FE', text: '#0369A1', name: 'Ciel' },
  { bg: '#E5F4EB', text: '#2A8049', name: 'Vert' },
  { bg: '#D1FAE5', text: '#065F46', name: 'Émeraude' },
  { bg: '#EDE9FE', text: '#5B21B6', name: 'Violet' },
  { bg: '#FCE7F3', text: '#9D174D', name: 'Rose' },
  { bg: '#F0F0F0', text: '#626E85', name: 'Gris' },
  { bg: '#F0FDF4', text: '#15803D', name: 'Lime' },
  { bg: '#FFF1F2', text: '#BE123C', name: 'Framboise' },
];

// ─── Badge prévisualisation ───────────────────────────────────────────────────
function StatusPreview({ label, bg, text }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      background: bg, color: text,
      borderRadius: 99, padding: '3px 10px',
      fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: 0.2,
    }}>
      {label || 'Aperçu'}
    </span>
  );
}

// ─── Ligne statut éditable ────────────────────────────────────────────────────
function StatusRow({ status, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel]     = useState(status.label);
  const [bg, setBg]           = useState(status.bg_color);
  const [text, setText]       = useState(status.text_color);
  const [saving, setSaving]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(status.id, { label, bg_color: bg, text_color: text });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setLabel(status.label);
    setBg(status.bg_color);
    setText(status.text_color);
    setEditing(false);
    setConfirmDelete(false);
  };

  return (
    <div style={{
      background: C.blanc,
      border: `1px solid ${editing ? TICKETS_COLOR : C.grisCL}`,
      borderRadius: 10,
      padding: editing ? '16px' : '12px 16px',
      transition: 'border-color 0.15s, box-shadow 0.15s',
      boxShadow: editing ? `0 0 0 3px ${TICKETS_COLOR}18` : 'none',
    }}>
      {!editing ? (
        /* ── Mode lecture ── */
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Pastille couleur */}
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: status.text_color, flexShrink: 0,
          }} />
          {/* Badge */}
          <StatusPreview label={status.label} bg={status.bg_color} text={status.text_color} />
          {/* Value slug */}
          <span style={{ fontSize: 11.5, color: C.grisM, fontFamily: 'monospace' }}>
            {status.value}
          </span>
          {/* Actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              onClick={() => setEditing(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 6,
                border: `1px solid ${C.grisCL}`, background: C.grisTL,
                color: C.grisF, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <IconEdit /> Modifier
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 6,
                  border: '1px solid #FECACA', background: '#FEF2F2',
                  color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <IconTrash /> Supprimer
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>Confirmer ?</span>
                <button
                  onClick={() => onDelete(status.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '5px 10px', borderRadius: 6,
                    border: 'none', background: '#DC2626',
                    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  <IconCheck /> Oui
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '5px 8px', borderRadius: 6,
                    border: `1px solid ${C.grisCL}`, background: C.blanc,
                    color: C.grisF, fontSize: 12, cursor: 'pointer',
                  }}
                >
                  <IconX />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Mode édition ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Ligne 1 : label + preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                Label affiché
              </label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px',
                  border: `1px solid ${C.grisCL}`, borderRadius: 7,
                  fontSize: 13.5, fontFamily: 'Lato, sans-serif', color: C.grisTF,
                  outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
                onBlur={e => e.target.style.borderColor = C.grisCL}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
                Aperçu
              </label>
              <StatusPreview label={label} bg={bg} text={text} />
            </div>
          </div>

          {/* Ligne 2 : palette couleurs */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 8 }}>
              Couleur
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {COLOR_PALETTES.map(p => (
                <button
                  key={p.name}
                  title={p.name}
                  onClick={() => { setBg(p.bg); setText(p.text); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 99,
                    background: p.bg, color: p.text,
                    border: `2px solid ${bg === p.bg && text === p.text ? p.text : 'transparent'}`,
                    fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                    transition: 'border-color 0.12s',
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {/* Couleurs custom */}
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: C.grisF }}>Fond :</span>
                <input type="color" value={bg} onChange={e => setBg(e.target.value)}
                  style={{ width: 32, height: 28, border: `1px solid ${C.grisCL}`, borderRadius: 5, cursor: 'pointer', padding: 2 }} />
                <code style={{ fontSize: 11, color: C.grisM }}>{bg}</code>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: C.grisF }}>Texte :</span>
                <input type="color" value={text} onChange={e => setText(e.target.value)}
                  style={{ width: 32, height: 28, border: `1px solid ${C.grisCL}`, borderRadius: 5, cursor: 'pointer', padding: 2 }} />
                <code style={{ fontSize: 11, color: C.grisM }}>{text}</code>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving || !label.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 7,
                border: 'none', background: saving ? C.grisM : TICKETS_COLOR,
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              <IconCheck /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              onClick={handleCancel}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 7,
                border: `1px solid ${C.grisCL}`, background: C.blanc,
                color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <IconX /> Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Formulaire création ──────────────────────────────────────────────────────
function CreateStatusForm({ onCreate }) {
  const [open, setOpen]     = useState(false);
  const [label, setLabel]   = useState('');
  const [value, setValue]   = useState('');
  const [bg, setBg]         = useState('#F0F0F0');
  const [text, setText]     = useState('#626E85');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Auto-générer le slug depuis le label
  const handleLabelChange = (v) => {
    setLabel(v);
    setValue(v.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_éàèùâêîôûäëïöü-]/g, ''));
  };

  const handleSubmit = async () => {
    if (!label.trim() || !value.trim()) return;
    setSaving(true); setError('');
    const err = await onCreate({ value, label, bg_color: bg, text_color: text });
    setSaving(false);
    if (err) { setError(err); return; }
    setLabel(''); setValue(''); setBg('#F0F0F0'); setText('#626E85');
    setOpen(false);
  };

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 18px', borderRadius: 8,
        border: `2px dashed ${C.grisCL}`, background: C.grisTL,
        color: TICKETS_COLOR, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        width: '100%', justifyContent: 'center',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = TICKETS_COLOR; e.currentTarget.style.background = '#E0F7FA'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.grisCL; e.currentTarget.style.background = C.grisTL; }}
    >
      <IconPlus /> Nouveau statut
    </button>
  );

  return (
    <div style={{
      background: C.blanc, borderRadius: 10,
      border: `2px solid ${TICKETS_COLOR}`,
      padding: 18,
      boxShadow: `0 0 0 3px ${TICKETS_COLOR}18`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, marginBottom: 14 }}>
        Créer un nouveau statut
      </div>

      {/* Label */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
          Label affiché *
        </label>
        <input
          value={label}
          onChange={e => handleLabelChange(e.target.value)}
          placeholder="Ex : En attente"
          style={{
            width: '100%', padding: '8px 12px',
            border: `1px solid ${C.grisCL}`, borderRadius: 7,
            fontSize: 13.5, fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
          autoFocus
        />
      </div>

      {/* Value (slug) */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
          Identifiant interne (slug)
        </label>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="en_attente"
          style={{
            width: '100%', padding: '8px 12px',
            border: `1px solid ${C.grisCL}`, borderRadius: 7,
            fontSize: 13, fontFamily: 'monospace', color: C.grisF, outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
        />
        <div style={{ fontSize: 11, color: C.grisM, marginTop: 4 }}>
          Généré automatiquement. Ne peut pas être modifié après création.
        </div>
      </div>

      {/* Aperçu + palette */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Couleur
          </label>
          <StatusPreview label={label || 'Aperçu'} bg={bg} text={text} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COLOR_PALETTES.map(p => (
            <button
              key={p.name}
              title={p.name}
              onClick={() => { setBg(p.bg); setText(p.text); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 99,
                background: p.bg, color: p.text,
                border: `2px solid ${bg === p.bg && text === p.text ? p.text : 'transparent'}`,
                fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: C.grisF }}>Fond :</span>
            <input type="color" value={bg} onChange={e => setBg(e.target.value)}
              style={{ width: 32, height: 28, border: `1px solid ${C.grisCL}`, borderRadius: 5, cursor: 'pointer', padding: 2 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: C.grisF }}>Texte :</span>
            <input type="color" value={text} onChange={e => setText(e.target.value)}
              style={{ width: 32, height: 28, border: `1px solid ${C.grisCL}`, borderRadius: 5, cursor: 'pointer', padding: 2 }} />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12.5, color: '#DC2626', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={saving || !label.trim() || !value.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 7, border: 'none',
            background: (!label.trim() || !value.trim()) ? C.grisM : TICKETS_COLOR,
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: (!label.trim() || !value.trim() || saving) ? 'not-allowed' : 'pointer',
          }}
        >
          <IconPlus /> {saving ? 'Création…' : 'Créer le statut'}
        </button>
        <button
          onClick={() => { setOpen(false); setLabel(''); setValue(''); setError(''); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 7,
            border: `1px solid ${C.grisCL}`, background: C.blanc,
            color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <IconX /> Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function TicketsSettingsApp() {
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch(`${API}/statuses`);
      const data = await res.json();
      if (data.success) setStatuses(data.statuses);
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  const handleSave = async (id, payload) => {
    const res = await fetch(`${API}/statuses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      invalidateStatusCache();
      setStatuses(prev => prev.map(s => s.id === id ? data.status : s));
    }
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/statuses/${id}`, { method: 'DELETE' });
    invalidateStatusCache();
    setStatuses(prev => prev.filter(s => s.id !== id));
  };

  const handleCreate = async (payload) => {
    const res = await fetch(`${API}/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur création';
    invalidateStatusCache();
    setStatuses(prev => [...prev, data.status]);
    return null;
  };

  return (
    <AppShell currentPath="/tickets/settings">
      <div style={{
        flex: 1, minWidth: 0, height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF,
        overflow: 'hidden',
      }}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 28px', height: 58,
          display: 'flex', alignItems: 'center', gap: 16,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(155deg, ${TICKETS_COLOR} 0%, #065f7e 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${TICKETS_COLOR}55`,
            }}>
              <TicketsIcon size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive", lineHeight: 1.1 }}>
                SAV / Tickets
              </div>
              <div style={{ fontSize: 11, color: C.grisM, fontWeight: 600 }}>Paramètres</div>
            </div>
          </div>
          <div style={{ height: 20, width: 1, background: C.grisCL, marginLeft: 4 }} />
          <button
            onClick={() => navigate('/tickets')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 7,
              border: `1px solid ${C.grisCL}`, background: C.grisTL,
              color: C.grisF, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ← Retour aux tickets
          </button>
        </header>

        {/* ── Corps ──────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>

            {/* Onglet unique : Statuts */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderBottom: `2px solid ${C.grisCL}` }}>
              <div style={{
                padding: '8px 20px 10px', fontSize: 13.5, fontWeight: 700,
                color: TICKETS_COLOR, borderBottom: `2px solid ${TICKETS_COLOR}`,
                marginBottom: -2, cursor: 'default',
              }}>
                Statuts des tickets
              </div>
            </div>

            {/* Description */}
            <div style={{
              background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`,
              border: `1px solid ${TICKETS_COLOR}30`,
              borderRadius: 10, padding: '14px 18px', marginBottom: 24,
              fontSize: 13, color: C.grisF, lineHeight: 1.6,
            }}>
              <strong style={{ color: C.grisTF }}>Statuts des tickets SAV</strong> — Définissez les états possibles pour vos tickets de support.
              Chaque statut possède un label affiché, une couleur de fond et une couleur de texte.
              Les statuts existants sur les tickets ne sont pas impactés par la suppression d'un statut ici.
            </div>

            {/* Liste des statuts */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM, fontSize: 14 }}>
                Chargement…
              </div>
            ) : error ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#DC2626', fontSize: 14 }}>
                {error}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {statuses.map(s => (
                  <StatusRow
                    key={s.id}
                    status={s}
                    onSave={handleSave}
                    onDelete={handleDelete}
                  />
                ))}

                {/* Formulaire création */}
                <div style={{ marginTop: 6 }}>
                  <CreateStatusForm onCreate={handleCreate} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
