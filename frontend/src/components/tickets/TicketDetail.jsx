import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  orange: '#E28F00', rouge: '#DE2020',
  vert: '#4AB866', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav';

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return '#' + adj(r).toString(16).padStart(2, '0') + adj(g).toString(16).padStart(2, '0') + adj(b).toString(16).padStart(2, '0');
}

// ─── Icônes ───────────────────────────────────────────────────────────────────
const Ic = {
  Back: ({ size = 14, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
    </svg>
  ),
  Mail: ({ size = 13, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" />
    </svg>
  ),
  Chev: ({ size = 11, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  More: ({ size = 16, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  ),
  History: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  External: ({ size = 12, color = C.bleu }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  ),
  Copy: ({ size = 12, color = C.grisM }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  Pin: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" /><path d="M9 2h6l-1 7 4 4H6l4-4z" />
    </svg>
  ),
  Send: ({ size = 14, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  ),
  Attach: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  Truck: ({ size = 12, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="14" height="11" rx="1" /><path d="M15 9h4l3 4v4h-7z" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" />
    </svg>
  ),
  User: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

function iconBtn() {
  return {
    width: 32, height: 32, borderRadius: 7,
    background: 'transparent', border: 'none',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', padding: 0, transition: 'background 0.12s',
  };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 34 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.25)})`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(10, size * 0.38), fontWeight: 800, flexShrink: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
    }}>
      {initials}
    </div>
  );
}

// ─── Pièce jointe ─────────────────────────────────────────────────────────────
function AttachmentItem({ att, ticketId }) {
  const isImage = att.mime?.startsWith('image/');
  const url = att.url || `/api/sav/attachments/${ticketId}/${att.filename}`;
  const sizeKb = att.size ? `${(att.size / 1024).toFixed(0)} Ko` : '';
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginRight: 8, marginTop: 6 }}>
        <img src={url} alt={att.original_name} style={{ height: 80, borderRadius: 6, border: `1px solid ${C.grisCL}`, objectFit: 'cover' }} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', marginRight: 6, marginTop: 6,
      background: C.grisTL, border: `1px solid ${C.grisCL}`,
      borderRadius: 6, fontSize: 12, color: TICKETS_COLOR, textDecoration: 'none', fontWeight: 600,
    }}>
      📎 {att.original_name} {sizeKb && <span style={{ color: C.grisM, fontWeight: 400 }}>({sizeKb})</span>}
    </a>
  );
}

// ─── Message style messagerie ─────────────────────────────────────────────────
function Message({ msg, ticketId }) {
  const atts = msg.attachments || [];
  const isPrivate = !!msg.is_private;
  const isAgent = !!msg.is_agent;

  // Couleurs bulle
  let bgBubble, borderBubble, boxShadowBubble;
  if (isPrivate) {
    bgBubble = '#FFFDE7'; borderBubble = '#F6C613';
    boxShadowBubble = '0 1px 4px rgba(246,198,19,0.15)';
  } else if (isAgent) {
    bgBubble = '#EAF2FF'; borderBubble = '#B8D4FF';
    boxShadowBubble = '0 1px 3px rgba(0,0,0,0.06)';
  } else {
    bgBubble = C.blanc; borderBubble = C.grisCL;
    boxShadowBubble = '0 1px 3px rgba(0,0,0,0.04)';
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: isAgent ? 'row-reverse' : 'row',
      gap: 10,
      marginBottom: 20,
      paddingLeft: isAgent ? 60 : 0,
      paddingRight: isAgent ? 0 : 60,
    }}>
      <Avatar name={msg.from} size={34} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isAgent ? 'flex-end' : 'flex-start' }}>
        {/* Nom + badges + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap', flexDirection: isAgent ? 'row-reverse' : 'row' }}>
          <strong style={{ fontSize: 13, color: C.grisF }}>{msg.from}</strong>
          {!isAgent && <Ic.Mail color={C.grisM} size={12} />}
          {isPrivate && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#92650A',
              background: '#FFF8E1', border: '1px solid #F6C613',
              borderRadius: 4, padding: '1px 6px',
            }}>Note privée</span>
          )}
          <span style={{ fontSize: 11, color: C.grisM }}>{formatDate(msg.date, { time: true })}</span>
        </div>
        {/* Bulle */}
        <div style={{
          background: bgBubble,
          border: `1px solid ${borderBubble}`,
          borderRadius: isAgent ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
          padding: '12px 16px',
          fontSize: 14, color: C.grisTF, lineHeight: 1.55,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: boxShadowBubble,
          maxWidth: '100%',
        }}>
          {msg.body}
        </div>
        {/* Pièces jointes */}
        {atts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 4, justifyContent: isAgent ? 'flex-end' : 'flex-start' }}>
            {atts.map((a, i) => <AttachmentItem key={i} att={a} ticketId={ticketId} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────
function ReplyComposer({ ticketId, demandeur, onReplySent }) {
  const [body, setBody] = useState(() => localStorage.getItem(`yv.tickets.draft.${ticketId}`) || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const modeRef = useRef();

  useEffect(() => {
    localStorage.setItem(`yv.tickets.draft.${ticketId}`, body);
  }, [body, ticketId]);

  // Fermer le dropdown mode si clic extérieur
  useEffect(() => {
    if (!modeOpen) return;
    const handler = (e) => { if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modeOpen]);

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    const oversized = selected.filter(f => f.size > 25 * 1024 * 1024);
    if (oversized.length) { setError(`Fichier trop lourd (max 25 Mo) : ${oversized.map(f => f.name).join(', ')}`); return; }
    if (files.length + selected.length > 10) { setError('Maximum 10 fichiers'); return; }
    setError('');
    setFiles(prev => [...prev, ...selected]);
  };

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const handleSend = async () => {
    if (!body.trim() && files.length === 0) return;
    setSending(true); setError('');
    try {
      const fd = new FormData();
      fd.append('body', body);
      fd.append('agent_name', 'SAV Youvape');
      fd.append('is_private', isPrivate ? 'true' : 'false');
      files.forEach(f => fd.append('attachments', f));
      const res = await fetch(`${API}/${ticketId}/reply`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur envoi');
      setBody(''); setFiles([]);
      localStorage.removeItem(`yv.tickets.draft.${ticketId}`);
      onReplySent(data.ticket);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const canSend = body.trim().length > 0 || files.length > 0;

  // Couleurs selon le mode
  const borderColor = body.length > 0
    ? (isPrivate ? '#F6C613' : TICKETS_COLOR)
    : C.grisCL;
  const bgColor = isPrivate ? '#FFFDE7' : '#FCFEFF';
  const headerBg = isPrivate ? '#FFF8E1' : C.blanc;

  return (
    <div style={{ background: C.blanc, borderTop: `1px solid ${C.grisCL}`, padding: '14px 28px 16px' }}>
      <div style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 12, background: bgColor, transition: 'all 0.2s',
      }}>
        {/* Header composer */}
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${isPrivate ? '#F6C61340' : C.grisCL}`,
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: C.grisF, flexWrap: 'wrap',
          background: headerBg, borderRadius: '12px 12px 0 0', transition: 'background 0.2s',
        }}>
          {/* Dropdown mode */}
          <div style={{ position: 'relative' }} ref={modeRef}>
            <button
              onClick={() => setModeOpen(o => !o)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontWeight: 700, color: isPrivate ? '#92650A' : C.grisTF,
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'Lato, sans-serif', fontSize: 13, padding: 0,
              }}
            >
              <Ic.Back size={11} color={isPrivate ? '#92650A' : C.grisTF} />
              {isPrivate ? '🔒 Note privée' : 'Réponse publique'}
              <Ic.Chev color={C.grisM} />
            </button>
            {modeOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 100,
                background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 6,
                minWidth: 200, overflow: 'hidden',
              }}>
                <button
                  onClick={() => { setIsPrivate(false); setModeOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: !isPrivate ? `${TICKETS_COLOR}12` : 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    fontSize: 13, fontWeight: !isPrivate ? 700 : 400, color: C.grisTF,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = !isPrivate ? `${TICKETS_COLOR}12` : 'transparent'}
                >
                  <span style={{ fontSize: 15 }}>✉️</span>
                  <div>
                    <div>Réponse publique</div>
                    <div style={{ fontSize: 11, color: C.grisM, fontWeight: 400 }}>Envoyée au client par email</div>
                  </div>
                </button>
                <button
                  onClick={() => { setIsPrivate(true); setModeOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: isPrivate ? '#FFF8E1' : 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    fontSize: 13, fontWeight: isPrivate ? 700 : 400, color: C.grisTF,
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderTop: `1px solid ${C.grisCL}`,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FFF8E1'}
                  onMouseLeave={e => e.currentTarget.style.background = isPrivate ? '#FFF8E1' : 'transparent'}
                >
                  <span style={{ fontSize: 15 }}>🔒</span>
                  <div>
                    <div>Note privée</div>
                    <div style={{ fontSize: 11, color: C.grisM, fontWeight: 400 }}>Visible uniquement par l'équipe</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {!isPrivate && (
            <>
              <span>À</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 8px 3px 10px', background: C.blanc, border: `1px solid ${C.grisCL}`,
                borderRadius: 99, fontSize: 12, fontWeight: 600, color: C.grisF,
              }}>
                <Avatar name={demandeur} size={16} />{demandeur}
              </span>
            </>
          )}
          <div style={{ flex: 1 }} />
          {!isPrivate && (
            <a href="#" onClick={e => e.preventDefault()} style={{ color: C.bleu, textDecoration: 'none', fontWeight: 700, fontSize: 12.5 }}>CC</a>
          )}
        </div>

        {/* Textarea */}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={isPrivate ? 'Ajouter une note interne…' : 'Tapez votre réponse…'}
          style={{
            width: '100%', minHeight: 80, padding: '14px 14px 10px',
            border: 'none', outline: 'none', resize: 'vertical',
            fontFamily: 'Lato, sans-serif', fontSize: 14, color: C.grisTF,
            background: 'transparent',
          }}
        />

        {/* Fichiers en attente */}
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 14px 8px' }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '3px 10px', background: C.grisTL, border: `1px solid ${C.grisCL}`,
                borderRadius: 6, fontSize: 12, color: C.grisF,
              }}>
                📎 {f.name} <span style={{ color: C.grisM }}>({(f.size / 1024).toFixed(0)} Ko)</span>
                <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.grisM, padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.grisCL}` }}>
          <button style={iconBtn()} title="Joindre un fichier" onClick={() => fileRef.current.click()}>
            <Ic.Attach />
          </button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <button style={iconBtn()} title="Lien"><span style={{ fontSize: 13, color: C.grisF }}>🔗</span></button>
          <button style={iconBtn()} title="Emoji"><span style={{ fontSize: 14 }}>😀</span></button>
          <div style={{ flex: 1 }} />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.vert, boxShadow: '0 0 0 3px rgba(74,184,102,0.18)' }} />
        </div>
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: '#B71D1D' }}>{error}</div>}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
          borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lato, sans-serif',
        }}>⚡ Appliquer une macro <Ic.Chev color={C.grisM} /></button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: C.grisF, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Prochain ticket <Ic.Chev color={C.grisM} />
        </span>
        <button style={{
          background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
          borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lato, sans-serif',
        }}>Ignorer</button>
        <button
          onClick={handleSend}
          disabled={sending || !canSend}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: (sending || !canSend) ? C.grisM : `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
            color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px',
            fontSize: 13, fontWeight: 800, cursor: (sending || !canSend) ? 'not-allowed' : 'pointer',
            fontFamily: 'Lato, sans-serif',
            boxShadow: (sending || !canSend) ? 'none' : `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
          }}
        >
          <Ic.Send /> {sending ? 'Envoi…' : 'Envoyer →'}
        </button>
      </div>
    </div>
  );
}

// ─── Styles field-input ───────────────────────────────────────────────────────
const fieldInputBase = {
  width: '100%', border: `1px solid ${C.grisCL}`, background: '#fff',
  borderRadius: 8, padding: '9px 12px', fontSize: 13.5,
  fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box',
};

function Field({ label, hint, hintAction, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: C.grisF, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          {label}
        </label>
        {hint && (
          <a href="#" onClick={e => { e.preventDefault(); hintAction?.(); }}
            style={{ fontSize: 11.5, color: C.bleu, fontWeight: 600, textDecoration: 'none' }}>
            {hint}
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldInput({ value, onChange, placeholder, type = 'text', suffix }) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = focused || hovered;
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={type} value={value || ''} onChange={onChange}
        placeholder={placeholder || '—'}
        style={{
          ...fieldInputBase,
          borderColor: active ? C.orange : C.grisCL,
          boxShadow: focused ? '0 0 0 3px rgba(226,143,0,0.16)' : 'none',
          paddingRight: suffix ? 36 : 12,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {suffix && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function FieldDivider() {
  return <div style={{ height: 1, background: C.grisCL, margin: '6px 0 18px' }} />;
}

// ─── Panneau GAUCHE ───────────────────────────────────────────────────────────
function TicketFieldsPanel({ ticket, onFieldChange, users }) {
  const navigate = useNavigate();
  const set = (k, v) => onFieldChange(k, v);

  const customerName = ticket.customer_name || '';
  const parts = customerName.trim().split(' ');
  const prenom = parts[0] || '';
  const nom = parts.slice(1).join(' ') || '';

  const trackingNum = ticket.order_tracking || '';
  const trackingUrl = trackingNum ? `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNum}` : null;

  const [assignOpen, setAssignOpen] = useState(false);
  const assignRef = useRef();

  // Fermer dropdown assigné si clic extérieur
  useEffect(() => {
    if (!assignOpen) return;
    const handler = (e) => { if (assignRef.current && !assignRef.current.contains(e.target)) setAssignOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [assignOpen]);

  const assignedUser = users.find(u => u.id === ticket.assigned_to_id) || null;

  return (
    <aside style={{
      width: 300, minWidth: 300, flexShrink: 0,
      background: C.blanc, borderRight: `1px solid ${C.grisCL}`,
      height: '100%', overflowY: 'auto', padding: '20px 20px',
    }}>
      {/* Demandeur */}
      <Field label="Demandeur">
        <div style={{ ...fieldInputBase, display: 'flex', alignItems: 'center', gap: 9, cursor: 'default' }}>
          <Avatar name={ticket.customer_name} size={22} />
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: C.grisTF }}>
            {ticket.customer_name || '—'}
          </span>
        </div>
      </Field>

      {/* Assigné — dropdown utilisateurs */}
      <Field label="Assigné" hint={assignedUser ? null : "me l'affecter"} hintAction={() => {
        // Affecter à l'utilisateur courant (on prend le 1er pour l'instant)
        if (users.length > 0) set('assigned_to_id', users[0].id);
      }}>
        <div style={{ position: 'relative' }} ref={assignRef}>
          <div
            onClick={() => setAssignOpen(o => !o)}
            style={{
              ...fieldInputBase,
              display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
              borderColor: assignOpen ? C.orange : C.grisCL,
            }}
          >
            {assignedUser ? (
              <>
                <Avatar name={assignedUser.name} size={22} />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: C.grisTF }}>{assignedUser.name}</span>
              </>
            ) : (
              <>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', background: C.grisTL,
                  border: `1px dashed ${C.grisCL}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Ic.User size={12} color={C.grisM} />
                </span>
                <span style={{ flex: 1, fontSize: 13.5, color: C.grisM }}>Non assigné</span>
              </>
            )}
            <Ic.Chev color={C.grisM} />
          </div>
          {assignOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden',
            }}>
              <div
                onClick={() => { set('assigned_to_id', null); setAssignOpen(false); }}
                style={{ padding: '9px 14px', fontSize: 13.5, color: C.grisM, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}
                onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: C.grisTL, border: `1px dashed ${C.grisCL}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Ic.User size={12} color={C.grisM} />
                </span>
                Non assigné
              </div>
              {users.map(u => (
                <div
                  key={u.id}
                  onClick={() => { set('assigned_to_id', u.id); setAssignOpen(false); }}
                  style={{
                    padding: '9px 14px', fontSize: 13.5, color: C.grisTF, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 9,
                    background: ticket.assigned_to_id === u.id ? `${TICKETS_COLOR}12` : 'transparent',
                    fontWeight: ticket.assigned_to_id === u.id ? 700 : 400,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = ticket.assigned_to_id === u.id ? `${TICKETS_COLOR}12` : 'transparent'}
                >
                  <Avatar name={u.name} size={22} />
                  {u.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>

      <FieldDivider />

      {/* Prénom */}
      <Field label="Prénom">
        <FieldInput
          value={prenom}
          onChange={e => set('customer_name', `${e.target.value} ${nom}`.trim())}
        />
      </Field>

      {/* Nom */}
      <Field label="Nom du client">
        <FieldInput
          value={nom}
          onChange={e => set('customer_name', `${prenom} ${e.target.value}`.trim())}
        />
      </Field>

      {/* Email */}
      <Field label="Email" hint="copier" hintAction={() => navigator.clipboard?.writeText(ticket.customer_email || '')}>
        <FieldInput type="email" value={ticket.customer_email} onChange={e => set('customer_email', e.target.value)} />
      </Field>

      <FieldDivider />

      {/* N° commande */}
      <Field
        label="N° de commande"
        hint={ticket.order_id ? 'voir' : null}
        hintAction={() => ticket.order_id && navigate(`/orders/${ticket.order_id}`)}
      >
        <FieldInput
          value={ticket.order_id}
          onChange={e => set('order_id', e.target.value)}
          placeholder="ex. 1222924"
          suffix={ticket.order_id
            ? <a href={`/orders/${ticket.order_id}`} onClick={e => { e.stopPropagation(); }} style={{ display: 'flex' }}><Ic.External color={C.bleu} /></a>
            : null}
        />
      </Field>

      {/* N° suivi */}
      <Field
        label="N° de suivi"
        hint={trackingNum ? 'suivre' : null}
        hintAction={() => trackingUrl && window.open(trackingUrl, '_blank')}
      >
        <FieldInput
          value={trackingNum}
          onChange={e => set('order_tracking', e.target.value)}
          placeholder="—"
          suffix={trackingNum
            ? <a href={trackingUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex' }}><Ic.Truck size={12} color={TICKETS_COLOR} /></a>
            : null}
        />
      </Field>
    </aside>
  );
}

// ─── Panneau CENTRE ───────────────────────────────────────────────────────────
function ConversationPanel({ ticket, onReplySent }) {
  const bottomRef = useRef();
  const messages = ticket.messages || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const source = ticket.source === 'gravity_form' ? 'formulaire' : 'e-mail';

  return (
    <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: C.grisTL, overflow: 'hidden' }}>
      {/* En-tête sujet */}
      <div style={{
        padding: '20px 28px 16px', background: C.blanc,
        borderBottom: `1px solid ${C.grisCL}`,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <h1 style={{
            fontSize: 19, fontWeight: 800, color: C.grisTF,
            fontFamily: "'Tilt Warp', cursive", letterSpacing: '-0.2px', lineHeight: 1.25, margin: 0,
          }}>{ticket.subject}</h1>
          <div style={{ fontSize: 12.5, color: C.grisM, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            Via <Ic.Mail size={12} /> {source} · ouvert le{' '}
            <strong style={{ color: C.grisF }}>{formatDate(ticket.created_at)}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button style={iconBtn()}><Ic.Pin /></button>
          <button style={iconBtn()}><Ic.History /></button>
          <button style={iconBtn()}><Ic.More /></button>
        </div>
      </div>

      {/* Thread */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 16px' }}>
        {ticket.description && (
          <Message
            msg={{ from: ticket.customer_name || ticket.customer_email, body: ticket.description, is_agent: false, date: ticket.created_at, attachments: [] }}
            ticketId={ticket.id}
          />
        )}
        {messages.map((msg, i) => <Message key={i} msg={msg} ticketId={ticket.id} />)}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <ReplyComposer
        ticketId={ticket.id}
        demandeur={ticket.customer_name || ticket.customer_email}
        onReplySent={onReplySent}
      />
    </section>
  );
}

// ─── OrderCard dépliable ──────────────────────────────────────────────────────
function OrderCard({ order, highlighted }) {
  const [open, setOpen] = useState(!!highlighted);

  const orderNum = order.wp_order_id || order.order_id;
  const orderDate = order.post_date || order.order_date;
  const orderTotal = order.order_total;
  const orderStatus = order.post_status || order.order_status;
  const trackingNum = order.tracking_number;
  const items = order.items || [];

  const trackingUrl = trackingNum ? `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNum}` : null;

  const statusLabel = (s) => {
    const map = {
      'wc-completed': 'Livrée', 'wc-processing': 'En cours',
      'wc-shipped': 'Expédiée', 'wc-cancelled': 'Annulée',
      'wc-refunded': 'Remboursée', 'wc-on-hold': 'En attente', 'wc-pending': 'En attente',
    };
    return map[s] || (s?.replace('wc-', '') || '—');
  };

  const statusColors = (s) => {
    if (!s) return { bg: C.grisTL, color: C.grisF };
    if (s.includes('complete')) return { bg: '#E5F4EB', color: '#2A8049' };
    if (s.includes('shipped')) return { bg: '#E5EEF6', color: '#2C5F80' };
    if (s.includes('process')) return { bg: '#FFF1D6', color: '#8B5A00' };
    if (s.includes('cancel') || s.includes('fail')) return { bg: '#FDEAEA', color: '#B71D1D' };
    if (s.includes('refund')) return { bg: '#F1ECFB', color: '#5D49D6' };
    return { bg: C.grisTL, color: C.grisF };
  };
  const sc = statusColors(orderStatus);

  // URL de la commande dans l'app — ouvrable avec cmd+clic
  const orderUrl = `/orders/${orderNum}`;

  return (
    <div style={{
      background: C.blanc,
      border: `1px solid ${highlighted ? TICKETS_COLOR + '60' : C.grisCL}`,
      borderRadius: 10, marginBottom: 8,
      boxShadow: highlighted ? `0 2px 8px ${TICKETS_COLOR}20` : '0 1px 2px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      {/* Header dépliable */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer', background: open ? '#F6FAFC' : 'transparent', transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#FAFCFD'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? '#F6FAFC' : 'transparent'; }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {/* Lien cliquable (et cmd+clic = nouvel onglet) */}
            <a
              href={orderUrl}
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 14, fontWeight: 800, color: TICKETS_COLOR, textDecoration: 'none' }}
            >#{orderNum}</a>
            <span style={{ fontSize: 11.5, color: C.grisM, fontWeight: 600 }}>{formatDate(orderDate)}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF, fontVariantNumeric: 'tabular-nums' }}>
              {orderTotal ? `${parseFloat(orderTotal).toFixed(2)} €` : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-block', background: sc.bg, color: sc.color,
              padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            }}>{statusLabel(orderStatus)}</span>
            {trackingNum && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#EAF3FB', color: C.bleu, border: '1px solid #BFDCEF',
                  borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 700,
                  cursor: 'pointer', textDecoration: 'none',
                }}
              >
                <Ic.Truck color={C.bleu} />{trackingNum}<Ic.External color={C.bleu} />
              </a>
            )}
          </div>
        </div>
        <span style={{ display: 'inline-flex', transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <Ic.Chev color={C.grisM} />
        </span>
      </div>

      {/* Contenu déplié */}
      {open && (
        <div style={{ padding: '4px 14px 14px', borderTop: `1px solid ${C.grisCL}`, background: '#FAFCFD' }}>
          {items.length > 0 ? items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: i === items.length - 1 ? 'none' : `1px solid ${C.grisCL}50`,
            }}>
              {it.image_url ? (
                <img src={it.image_url} alt={it.order_item_name || it.name}
                  style={{ width: 36, height: 36, borderRadius: 7, objectFit: 'cover', border: `1px solid ${C.grisCL}`, flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 36, height: 36, borderRadius: 7, background: '#F2F4F7', border: `1px solid ${C.grisCL}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0,
                }}>🧪</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.grisTF, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.order_item_name || it.name}
                </div>
                {it.sku && <div style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace', marginTop: 1 }}>SKU: {it.sku}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: C.grisF, fontWeight: 700 }}>×{it.qty}</div>
                {it.line_total && (
                  <div style={{ fontSize: 12, color: C.grisTF, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {parseFloat(it.line_total).toFixed(2)} €
                  </div>
                )}
              </div>
            </div>
          )) : (
            <div style={{ padding: '10px 0', fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>Aucun article</div>
          )}

          {highlighted && (
            <div style={{ marginTop: 10 }}>
              {/* Lien natif = cmd+clic fonctionne */}
              <a
                href={orderUrl}
                style={{
                  display: 'block', textAlign: 'center', textDecoration: 'none',
                  background: C.blanc, color: TICKETS_COLOR,
                  border: `1px solid ${TICKETS_COLOR}40`, borderRadius: 7,
                  padding: '7px 12px', fontSize: 12.5, fontWeight: 700,
                }}
              >Ouvrir la commande</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Note interne ─────────────────────────────────────────────────────────────
function NoteField({ ticketId, initialNotes }) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef();

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/${ticketId}/notes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      setSaved(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Note visible uniquement par l'équipe…"
        rows={3}
        style={{ ...fieldInputBase, resize: 'vertical' }}
        onMouseEnter={e => e.target.style.borderColor = C.orange}
        onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderColor = C.grisCL; }}
        onFocus={e => { e.target.style.borderColor = C.orange; e.target.style.boxShadow = '0 0 0 3px rgba(226,143,0,0.16)'; }}
        onBlur={e => { e.target.style.borderColor = C.grisCL; e.target.style.boxShadow = 'none'; }}
      />
      <button
        onClick={handleSave} disabled={saving}
        style={{
          marginTop: 8, width: '100%', padding: '7px 0',
          background: saved ? C.vert : (saving ? C.grisM : C.orange),
          color: '#fff', border: 'none', borderRadius: 6,
          fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Lato, sans-serif',
        }}
      >
        {saving ? 'Sauvegarde…' : saved ? '✓ Sauvegardé' : 'Sauvegarder'}
      </button>
    </>
  );
}

// ─── Panneau DROIT ────────────────────────────────────────────────────────────
function CustomerPanel({ ticket }) {
  const navigate = useNavigate();

  const firstName = ticket.customer_first_name || (ticket.customer_name || '').split(' ')[0] || '';
  const lastName = ticket.customer_last_name || (ticket.customer_name || '').split(' ').slice(1).join(' ') || '';
  const email = ticket.customer_email_db || ticket.customer_email || '';
  const since = ticket.customer_since ? formatDate(ticket.customer_since) : '—';
  const ordersCount = ticket.customer_orders_count ?? 0;
  const totalSpent = ticket.customer_total_spent ? parseFloat(ticket.customer_total_spent).toFixed(2) : '0.00';

  const SectionLabel = ({ children, right }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{children}</span>
      {right && <span style={{ fontSize: 11, color: C.grisM, fontWeight: 600 }}>{right}</span>}
    </div>
  );

  const Meta = ({ label, value }) => (
    <div>
      <div style={{ fontSize: 10.5, color: C.grisM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.grisTF, fontWeight: 600 }}>{value}</div>
    </div>
  );

  const currentOrder = ticket.order_id ? {
    wp_order_id: ticket.order_id,
    post_date: ticket.order_date,
    post_status: ticket.order_status,
    order_total: ticket.order_total,
    tracking_number: ticket.order_tracking,
    items: ticket.order_items || [],
  } : null;

  const pastOrders = (ticket.customer_orders_history || []).map(o => ({
    ...o,
    items: o.items || [],
  }));

  return (
    <aside style={{
      width: 360, minWidth: 360, flexShrink: 0,
      background: C.grisTL, borderLeft: `1px solid ${C.grisCL}`,
      height: '100%', overflowY: 'auto', padding: '20px 18px',
    }}>
      {/* Fiche client */}
      <div style={{
        background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
        padding: '18px 18px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <Avatar name={`${firstName} ${lastName}`} size={48} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive", letterSpacing: '-0.2px' }}>
              {firstName} {lastName}
            </div>
            <a href={`mailto:${email}`} onClick={e => e.preventDefault()}
              style={{ fontSize: 12.5, color: C.bleu, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <Ic.Mail size={11} color={C.bleu} />{email || '—'}
            </a>
          </div>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px',
          paddingTop: 14, borderTop: `1px solid ${C.grisCL}`,
        }}>
          <Meta label="Client depuis" value={since} />
          <Meta label="Pays" value="🇫🇷 France" />
          <Meta label="Commandes validées" value={
            <span>
              <strong style={{ fontSize: 17, color: TICKETS_COLOR, fontWeight: 800 }}>{ordersCount}</strong>
              {' '}<span style={{ fontSize: 11, color: C.grisM }}>total</span>
            </span>
          } />
          <Meta label="CA généré" value={
            <span>
              <strong style={{ fontSize: 14, color: C.grisTF, fontWeight: 800 }}>{totalSpent}</strong> €
            </span>
          } />
        </div>
        {ticket.customer_wp_id && (
          /* Lien natif = cmd+clic fonctionne */
          <a
            href={`/customers/${ticket.customer_wp_id}`}
            style={{
              display: 'block', textAlign: 'center', marginTop: 12,
              padding: '6px 0', background: 'none', border: `1px solid ${C.grisCL}`,
              borderRadius: 6, fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 600,
              textDecoration: 'none',
            }}
          >Voir fiche client →</a>
        )}
      </div>

      {/* Note interne */}
      <div style={{ marginTop: 14 }}>
        <SectionLabel>Note interne</SectionLabel>
        <div style={{ background: C.blanc, borderRadius: 10, border: `1px solid ${C.grisCL}`, padding: '14px 14px 12px' }}>
          <NoteField ticketId={ticket.id} initialNotes={ticket.notes} />
        </div>
      </div>

      {/* Commande concernée */}
      {currentOrder && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Commande concernée</SectionLabel>
          <OrderCard order={currentOrder} highlighted />
        </div>
      )}

      {/* Historique commandes */}
      {pastOrders.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel right={`${pastOrders.length} commandes`}>Historique</SectionLabel>
          {pastOrders.map(o => (
            <OrderCard key={o.wp_order_id} order={o} />
          ))}
        </div>
      )}
    </aside>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function TicketDetail({ ticketId }) {
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const saveTimerRef = useRef();

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`${API}/${ticketId}`);
      const data = await res.json();
      if (data.success) setTicket(data.ticket);
      else setError('Ticket introuvable');
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, [ticketId]);

  // Charger la liste des agents (utilisateurs de l'app)
  useEffect(() => {
    fetch('/api/users/agents')
      .then(r => r.json())
      .then(d => { if (d.success && d.users) setUsers(d.users); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTicket(); }, [fetchTicket]);

  // Autosave PATCH avec debounce 600ms
  const handleFieldChange = useCallback((key, value) => {
    setTicket(t => ({ ...t, [key]: value }));
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${API}/${ticketId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        });
      } catch { /* silencieux */ }
    }, 600);
  }, [ticketId]);

  const handleStatusChange = async (newStatus) => {
    try {
      const res = await fetch(`${API}/${ticketId}/status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sav_status: newStatus }),
      });
      const data = await res.json();
      if (data.success) setTicket(data.ticket);
    } catch { /* silencieux */ }
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grisM, fontSize: 14 }}>
      Chargement…
    </div>
  );

  if (error || !ticket) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#B71D1D', fontSize: 14 }}>
      {error || 'Ticket introuvable'}
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <header style={{
        background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
        padding: '0 24px', minHeight: 58, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0, zIndex: 30,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button
            onClick={() => navigate('/tickets')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
              color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Lato, sans-serif', flexShrink: 0,
              boxShadow: `0 2px 6px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.35) inset`,
            }}
          ><Ic.Back /> À traiter</button>

          <span style={{ fontSize: 13, color: C.grisM, fontWeight: 600, whiteSpace: 'nowrap' }}>Tickets / À traiter /</span>
          <strong style={{ fontSize: 14.5, color: C.grisTF, fontFamily: "'Tilt Warp', cursive", whiteSpace: 'nowrap' }}>
            #{ticket.id}
          </strong>
          <button
            onClick={() => navigator.clipboard?.writeText(`#${ticket.id}`)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
            title="Copier l'ID"
          ><Ic.Copy color={C.grisM} /></button>
          <StatusBadge status={ticket.sav_status} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => handleStatusChange('terminé')}
            style={{
              background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
              borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            }}
          >Marquer résolu</button>
          <button style={{
            background: C.vert, color: '#fff', border: 'none',
            borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            boxShadow: '0 2px 6px rgba(74,184,102,0.35), 0 1px 0 rgba(255,255,255,0.3) inset',
          }}>Soumettre</button>
        </div>
      </header>

      {/* ── 3 colonnes ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <TicketFieldsPanel ticket={ticket} onFieldChange={handleFieldChange} users={users} />
        <ConversationPanel ticket={ticket} onReplySent={(updatedTicket) => setTicket(updatedTicket)} />
        <CustomerPanel ticket={ticket} />
      </div>
    </div>
  );
}
