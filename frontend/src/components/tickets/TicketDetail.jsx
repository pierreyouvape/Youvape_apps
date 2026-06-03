import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { useTicketStatuses } from './useTicketStatuses';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';
import { AuthContext } from '../../context/AuthContext';
import { useOpenTickets } from '../../context/OpenTicketsContext';
import OrderCard from './OrderCard';
import { buildPlaceholderContext, applyPlaceholders } from './macroPlaceholders';

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

// ─── Rendu texte avec liens markdown ──────────────────────────────────────────
function renderBody(text) {
  if (!text) return null;
  // Découpe sur les liens markdown [texte](url)
  const parts = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let last = 0, match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a key={match.index} href={match[2]} target="_blank" rel="noopener noreferrer"
        style={{ color: TICKETS_COLOR, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-all' }}>
        {match[1]}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── Message style messagerie ─────────────────────────────────────────────────
function Message({ msg, ticketId }) {
  const atts = msg.attachments || [];
  const isPrivate = !!msg.is_private;
  const isAgent = !!msg.is_agent;
  const sendFailed = !!msg.send_failed;

  // Message système (fusion de tickets, etc.) : séparateur centré discret.
  if (msg.is_system) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 20px' }}>
        <div style={{ flex: 1, height: 1, background: C.grisCL }} />
        <span style={{
          fontSize: 11.5, fontWeight: 700, color: C.grisM,
          background: C.grisTL, border: `1px solid ${C.grisCL}`,
          borderRadius: 20, padding: '4px 12px', whiteSpace: 'nowrap',
        }}>
          🔀 {msg.body?.replace(/^—\s*|\s*—$/g, '') || 'Fusion'}
        </span>
        <div style={{ flex: 1, height: 1, background: C.grisCL }} />
      </div>
    );
  }

  // Couleurs bulle
  let bgBubble, borderBubble, boxShadowBubble;
  if (sendFailed) {
    bgBubble = '#FDEAEA'; borderBubble = '#E89A9A';
    boxShadowBubble = '0 1px 4px rgba(183,29,29,0.12)';
  } else if (isPrivate) {
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
          {sendFailed && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#B71D1D',
              background: '#FFE5E5', border: '1px solid #E89A9A',
              borderRadius: 4, padding: '1px 6px',
            }}>⚠ Non envoyé</span>
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
          {renderBody(msg.body)}
        </div>
        {sendFailed && msg.error && (
          <div style={{
            marginTop: 4, fontSize: 11.5, color: '#B71D1D', fontWeight: 600,
            alignSelf: isAgent ? 'flex-end' : 'flex-start',
          }}>
            Ce message n'a pas été envoyé — {msg.error}
          </div>
        )}
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

// ─── Emojis fréquents ─────────────────────────────────────────────────────────
const EMOJIS = ['😊','👍','🙏','😔','✅','❌','⚠️','📦','🚚','🔄','💡','📞','✉️','🎁','⏳','💰','🔍','📋','👋','😅'];

// ─── Composer ─────────────────────────────────────────────────────────────────
function ReplyComposer({
  ticketId, demandeur, agentName, agent, ticket, currentStatus,
  onReplySent, onSendFailed, onStatusChange,
  playMode = false, afterActionMode = 'next', onChangeAfterActionMode, onAdvance,
  onApplyMacroSubject,
}) {
  const [body, setBody] = useState(() => localStorage.getItem(`yv.tickets.draft.${ticketId}`) || '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkSelection, setLinkSelection] = useState({ start: 0, end: 0 });
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);
  const [statusOpen, setStatusOpen] = useState(false);
  const [afterOpen, setAfterOpen] = useState(false);
  const [macros, setMacros] = useState([]);
  const [macroOpen, setMacroOpen] = useState(false);
  const [applyingMacro, setApplyingMacro] = useState(false);
  const { statuses, statusMap } = useTicketStatuses();
  const fileRef = useRef();
  const modeRef = useRef();
  const textareaRef = useRef();
  const emojiRef = useRef();
  const linkRef = useRef();
  const statusRef = useRef();
  const afterRef = useRef();
  const macroRef = useRef();

  // Charger les macros au montage
  useEffect(() => {
    fetch('/api/sav/macros')
      .then(r => r.json())
      .then(d => { if (d.success) setMacros(d.macros || []); })
      .catch(() => {});
  }, []);

  // Fermer dropdown macros si clic extérieur
  useEffect(() => {
    if (!macroOpen) return;
    const handler = (e) => { if (macroRef.current && !macroRef.current.contains(e.target)) setMacroOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [macroOpen]);

  // Application d'une macro :
  // - body et sujet : substitue les balises {{...}} avec les valeurs du ticket
  // - remplace body, applique sujet (si défini), présélectionne le statut
  // - télécharge la PJ et l'ajoute aux fichiers du composer
  const applyMacro = async (macro) => {
    setMacroOpen(false);
    setApplyingMacro(true);
    setError('');
    try {
      // Construire le contexte de substitution depuis le ticket + agent
      const ctx = buildPlaceholderContext({ ticket, agent, statusMap });

      // Body : remplace (avec balises substituées)
      if (typeof macro.body === 'string') setBody(applyPlaceholders(macro.body, ctx));
      // Sujet : applique via parent si défini sur la macro (avec balises substituées)
      if (macro.subject && onApplyMacroSubject) onApplyMacroSubject(applyPlaceholders(macro.subject, ctx));
      // Statut : présélectionne
      if (macro.sav_status) setSelectedStatus(macro.sav_status);
      // PJ : télécharge et ajoute à files (sans écraser ce que l'agent avait déjà)
      if (macro.attachment_url) {
        try {
          const res = await fetch(macro.attachment_url);
          const blob = await res.blob();
          const file = new File(
            [blob],
            macro.attachment_original_name || 'piece-jointe',
            { type: macro.attachment_mime || blob.type || 'application/octet-stream' }
          );
          setFiles(prev => [...prev, file]);
        } catch {
          setError('Pièce jointe de la macro indisponible');
        }
      }
    } finally {
      setApplyingMacro(false);
    }
  };

  // Fermer dropdown "Prochain ticket / Rester" si clic extérieur
  useEffect(() => {
    if (!afterOpen) return;
    const handler = (e) => { if (afterRef.current && !afterRef.current.contains(e.target)) setAfterOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [afterOpen]);

  // Resynchroniser le statut sélectionné quand le ticket change
  useEffect(() => { setSelectedStatus(currentStatus); }, [currentStatus, ticketId]);

  // Fermer dropdown statut si clic extérieur
  useEffect(() => {
    if (!statusOpen) return;
    const handler = (e) => { if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [statusOpen]);

  // Fermer emoji picker si clic extérieur
  useEffect(() => {
    if (!showEmojis) return;
    const handler = (e) => { if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmojis(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojis]);

  // Fermer lien input si clic extérieur
  useEffect(() => {
    if (!showLinkInput) return;
    const handler = (e) => { if (linkRef.current && !linkRef.current.contains(e.target)) setShowLinkInput(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLinkInput]);

  // Insérer un emoji à la position du curseur
  const insertEmoji = (emoji) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newBody = body.slice(0, start) + emoji + body.slice(end);
    setBody(newBody);
    setShowEmojis(false);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + emoji.length, start + emoji.length); }, 0);
  };

  // Ouvrir le popup lien — capturer la sélection avant que le focus parte
  const openLinkInput = () => {
    const ta = textareaRef.current;
    const start = ta ? ta.selectionStart : 0;
    const end = ta ? ta.selectionEnd : 0;
    const selected = body.slice(start, end);
    setLinkSelection({ start, end });
    setLinkText(selected);
    setLinkUrl('');
    setShowLinkInput(true);
  };

  // Insérer le lien à la position mémorisée
  const insertLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    const display = linkText.trim() || url;
    const { start, end } = linkSelection;
    const insertion = `[${display}](${url})`;
    const newBody = body.slice(0, start) + insertion + body.slice(end);
    setBody(newBody);
    setLinkUrl('');
    setLinkText('');
    setShowLinkInput(false);
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(start + insertion.length, start + insertion.length); }
    }, 0);
  };

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

  // Envoi : si message/PJ -> POST reply, puis si OK et statut a changé -> PUT status.
  // Si pas de message ni PJ -> juste changer le statut (si différent).
  const handleSend = async () => {
    const hasContent = body.trim().length > 0 || files.length > 0;
    const statusChanged = selectedStatus && selectedStatus !== currentStatus;

    if (!hasContent && !statusChanged) return;

    setSending(true); setError('');

    // Cas 1 : pas de message, juste un changement de statut
    if (!hasContent && statusChanged) {
      try {
        await onStatusChange(selectedStatus);
        // Mode Play + "Prochain ticket disponible" -> on avance
        if (playMode && afterActionMode === 'next' && onAdvance) onAdvance();
      } catch (e) {
        setError(e.message || 'Erreur changement statut');
      } finally {
        setSending(false);
      }
      return;
    }

    // Cas 2 : envoi du message (+ éventuel changement de statut ensuite)
    try {
      const fd = new FormData();
      fd.append('body', body);
      fd.append('agent_name', agentName || 'SAV Youvape');
      fd.append('is_private', isPrivate ? 'true' : 'false');
      files.forEach(f => fd.append('attachments', f));
      const res = await fetch(`${API}/${ticketId}/reply`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur envoi');

      // Reply OK → vider composer
      setBody(''); setFiles([]);
      localStorage.removeItem(`yv.tickets.draft.${ticketId}`);
      onReplySent(data.ticket);

      // Si statut a changé → l'appliquer maintenant
      if (statusChanged) {
        try { await onStatusChange(selectedStatus); } catch { /* erreur silencieuse, le reply a réussi */ }
      }
      // Mode Play + "Prochain ticket disponible" -> on avance
      if (playMode && afterActionMode === 'next' && onAdvance) onAdvance();
    } catch (e) {
      // Reply échoué : on n'applique PAS le changement de statut, on remonte un message local "Non envoyé"
      onSendFailed?.({
        from: agentName || 'SAV Youvape',
        body,
        is_agent: true,
        is_private: isPrivate,
        date: new Date().toISOString(),
        attachments: [],
        send_failed: true,
        error: e.message,
      });
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const hasContent = body.trim().length > 0 || files.length > 0;
  const statusChanged = selectedStatus && selectedStatus !== currentStatus;
  const canSend = hasContent || statusChanged;
  const currentStatusLabel = statusMap[selectedStatus]?.label || selectedStatus || '—';
  const sendBtnLabel = !hasContent && statusChanged
    ? `Marquer ${currentStatusLabel}`
    : `Envoyer comme ${currentStatusLabel}`;

  // Couleurs selon le mode
  const borderColor = body.length > 0
    ? (isPrivate ? '#F6C613' : TICKETS_COLOR)
    : C.grisCL;
  const bgColor = isPrivate ? '#FFFDE7' : '#FCFEFF';
  const headerBg = isPrivate ? '#FFF8E1' : C.blanc;

  return (
    <div style={{
      background: C.blanc, borderTop: `1px solid ${C.grisCL}`,
      padding: '14px 28px 16px',
      display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 12, background: bgColor, transition: 'all 0.2s',
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden',
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

        {/* Textarea — flex pour remplir l'espace disponible, scroll interne */}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={isPrivate ? 'Ajouter une note interne…' : 'Tapez votre réponse…'}
          style={{
            width: '100%', flex: 1, minHeight: 0,
            padding: '14px 14px 10px',
            border: 'none', outline: 'none', resize: 'none',
            fontFamily: 'Lato, sans-serif', fontSize: 14, color: C.grisTF,
            background: 'transparent', boxSizing: 'border-box',
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
        <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.grisCL}`, position: 'relative' }}>
          <button style={iconBtn()} title="Joindre un fichier" onClick={() => fileRef.current.click()}>
            <Ic.Attach />
          </button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />

          {/* Bouton lien */}
          <div style={{ position: 'relative' }} ref={linkRef}>
            <button
              style={{ ...iconBtn(), background: showLinkInput ? C.grisTL : 'transparent' }}
              title="Insérer un lien"
              onClick={() => showLinkInput ? setShowLinkInput(false) : openLinkInput()}
            >
              <span style={{ fontSize: 13, color: showLinkInput ? TICKETS_COLOR : C.grisF }}>🔗</span>
            </button>
            {showLinkInput && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, zIndex: 200,
                background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
                boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '12px 14px',
                marginBottom: 6, minWidth: 300,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: C.grisF, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Insérer un lien
                </div>
                {/* Champ texte affiché */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
                    Texte affiché
                  </label>
                  <input
                    type="text"
                    value={linkText}
                    onChange={e => setLinkText(e.target.value)}
                    placeholder="ex. Suivre ma commande"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setShowLinkInput(false); }}
                    style={{
                      width: '100%', padding: '7px 10px', border: `1px solid ${C.grisCL}`,
                      borderRadius: 6, fontSize: 13, fontFamily: 'Lato, sans-serif',
                      outline: 'none', color: C.grisTF, boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
                    onBlur={e => e.target.style.borderColor = C.grisCL}
                  />
                </div>
                {/* Champ URL */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
                    URL
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setShowLinkInput(false); }}
                    style={{
                      width: '100%', padding: '7px 10px', border: `1px solid ${C.grisCL}`,
                      borderRadius: 6, fontSize: 13, fontFamily: 'Lato, sans-serif',
                      outline: 'none', color: C.grisTF, boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
                    onBlur={e => e.target.style.borderColor = C.grisCL}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowLinkInput(false)}
                    style={{
                      padding: '7px 12px', background: 'transparent', color: C.grisF,
                      border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    }}
                  >Annuler</button>
                  <button
                    onClick={insertLink}
                    style={{
                      padding: '7px 14px', background: TICKETS_COLOR, color: '#fff',
                      border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    }}
                  >Insérer</button>
                </div>
              </div>
            )}
          </div>

          {/* Bouton emoji */}
          <div style={{ position: 'relative' }} ref={emojiRef}>
            <button
              style={{ ...iconBtn(), background: showEmojis ? C.grisTL : 'transparent' }}
              title="Emoji"
              onClick={() => setShowEmojis(o => !o)}
            >
              <span style={{ fontSize: 14 }}>😀</span>
            </button>
            {showEmojis && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, zIndex: 200,
                background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
                boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '10px',
                marginBottom: 6,
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 4,
                }}>
                  {EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => insertEmoji(emoji)}
                      style={{
                        width: 36, height: 36, background: 'transparent',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                        fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: C.vert, boxShadow: '0 0 0 3px rgba(74,184,102,0.18)' }} />
        </div>
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: '#B71D1D' }}>{error}</div>}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        {/* Bouton Macros + dropdown */}
        <div style={{ position: 'relative' }} ref={macroRef}>
          <button
            onClick={() => setMacroOpen(o => !o)}
            disabled={applyingMacro}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: macroOpen ? C.grisTL : C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
              borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 700,
              cursor: applyingMacro ? 'wait' : 'pointer', fontFamily: 'Lato, sans-serif',
            }}
            title={macros.length === 0 ? 'Aucune macro — créez-en dans Paramètres' : 'Appliquer une macro'}
          >
            ⚡ {applyingMacro ? 'Application…' : 'Appliquer une macro'} <Ic.Chev color={C.grisM} />
          </button>
          {macroOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 200,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
              boxShadow: '0 -6px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
              minWidth: 320, maxWidth: 420, maxHeight: 380, overflowY: 'auto',
            }}>
              {macros.length === 0 ? (
                <div style={{ padding: 14, fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>
                  Aucune macro disponible.<br />
                  <span style={{ fontSize: 11.5 }}>Créez-en dans Paramètres → Macros</span>
                </div>
              ) : macros.map(m => {
                const statusObj = m.sav_status ? statusMap[m.sav_status] : null;
                return (
                  <button
                    key={m.id}
                    onClick={() => applyMacro(m)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '10px 14px',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      fontFamily: 'Lato, sans-serif', display: 'block',
                      borderBottom: `1px solid ${C.grisCL}50`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>{m.name}</span>
                      {m.attachment_filename && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.grisM }}>📎</span>
                      )}
                      {statusObj && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, background: statusObj.bg, color: statusObj.color, padding: '1px 6px', borderRadius: 99 }}>
                          → {statusObj.label}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <div style={{ fontSize: 11.5, color: C.grisF, lineHeight: 1.3 }}>{m.description}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />

        {/* Dropdown "Prochain ticket / Rester sur le ticket" — visible uniquement en mode Play */}
        {playMode && (
          <div style={{ position: 'relative' }} ref={afterRef}>
            <button
              onClick={() => setAfterOpen(o => !o)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 12.5, color: C.grisF, fontWeight: 700,
                fontFamily: 'Lato, sans-serif', padding: '4px 6px',
              }}
              title="Comportement après envoi"
            >
              {afterActionMode === 'stay' ? 'Rester sur le ticket' : 'Prochain ticket'}
              <span style={{ display: 'inline-flex', transform: afterOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
                <Ic.Chev color={C.grisM} />
              </span>
            </button>
            {afterOpen && (
              <div style={{
                position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, zIndex: 200,
                background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
                boxShadow: '0 -6px 24px rgba(0,0,0,0.12)', overflow: 'hidden', minWidth: 260,
              }}>
                <button
                  onClick={() => { onChangeAfterActionMode?.('next'); setAfterOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: afterActionMode === 'next' ? `${TICKETS_COLOR}10` : 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    fontSize: 13, color: C.grisTF, fontWeight: afterActionMode === 'next' ? 700 : 500,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = afterActionMode === 'next' ? `${TICKETS_COLOR}10` : 'transparent'}
                >
                  <span style={{ width: 14, color: TICKETS_COLOR, fontWeight: 800 }}>
                    {afterActionMode === 'next' ? '✓' : ''}
                  </span>
                  <div>
                    <div>Prochain ticket disponible</div>
                    <div style={{ fontSize: 11, color: C.grisM, fontWeight: 400 }}>
                      Après envoi, passer au ticket suivant
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => { onChangeAfterActionMode?.('stay'); setAfterOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: afterActionMode === 'stay' ? `${TICKETS_COLOR}10` : 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                    fontSize: 13, color: C.grisTF, fontWeight: afterActionMode === 'stay' ? 700 : 500,
                    display: 'flex', alignItems: 'center', gap: 8,
                    borderTop: `1px solid ${C.grisCL}`,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = afterActionMode === 'stay' ? `${TICKETS_COLOR}10` : 'transparent'}
                >
                  <span style={{ width: 14, color: TICKETS_COLOR, fontWeight: 800 }}>
                    {afterActionMode === 'stay' ? '✓' : ''}
                  </span>
                  <div>
                    <div>Rester sur le ticket</div>
                    <div style={{ fontSize: 11, color: C.grisM, fontWeight: 400 }}>
                      Après envoi, ne pas changer de ticket
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Ignorer : visible uniquement en mode Play, skip toujours vers le suivant */}
        {playMode && (
          <button
            onClick={() => onAdvance?.()}
            style={{
              background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            }}
            title="Passer au ticket suivant sans envoyer ni changer le statut"
          >
            Ignorer
          </button>
        )}

        {/* ── Split-button : Envoyer comme [Statut] ▾ ─────────────────────── */}
        <div style={{ position: 'relative', display: 'inline-flex' }} ref={statusRef}>
          {/* Partie gauche : envoi */}
          <button
            onClick={handleSend}
            disabled={sending || !canSend}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: (sending || !canSend) ? C.grisM : `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
              color: '#fff', border: 'none', borderRadius: '8px 0 0 8px', padding: '8px 16px',
              fontSize: 13, fontWeight: 700, cursor: (sending || !canSend) ? 'not-allowed' : 'pointer',
              fontFamily: 'Lato, sans-serif',
              boxShadow: (sending || !canSend) ? 'none' : `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
              borderRight: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            <Ic.Send /> {sending ? 'Envoi…' : (
              <span>
                {hasContent ? 'Envoyer comme ' : 'Marquer '}
                <strong style={{ fontWeight: 800 }}>{currentStatusLabel}</strong>
              </span>
            )}
          </button>
          {/* Partie droite : flèche dropdown */}
          <button
            onClick={() => setStatusOpen(o => !o)}
            disabled={sending}
            style={{
              background: sending ? C.grisM : `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
              color: '#fff', border: 'none', borderRadius: '0 8px 8px 0',
              padding: '8px 10px', cursor: sending ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center',
              boxShadow: sending ? 'none' : `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
            }}
            title="Changer le statut"
          >
            <span style={{ display: 'inline-flex', transform: statusOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
              <Ic.Chev color="#fff" size={12} />
            </span>
          </button>

          {/* Dropdown statuts (ouvre vers le HAUT) */}
          {statusOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, zIndex: 200,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
              boxShadow: '0 -6px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
              minWidth: 280, maxHeight: 380, overflowY: 'auto',
            }}>
              {statuses.length === 0 && (
                <div style={{ padding: 14, fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>Aucun statut disponible</div>
              )}
              {statuses.map(s => {
                const isSelected = s.value === selectedStatus;
                return (
                  <button
                    key={s.value}
                    onClick={() => { setSelectedStatus(s.value); setStatusOpen(false); }}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '10px 14px', background: isSelected ? `${TICKETS_COLOR}10` : 'transparent',
                      border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                      fontSize: 13.5, color: C.grisTF, fontWeight: isSelected ? 700 : 500,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                    onMouseLeave={e => e.currentTarget.style.background = isSelected ? `${TICKETS_COLOR}10` : 'transparent'}
                  >
                    <span style={{
                      width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                      background: s.bg_color || '#F0F0F0', border: `1px solid ${s.text_color || C.grisCL}40`,
                    }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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

  const trackingNum = ticket.order_tracking || ticket.order_tracking_from_order || '';
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
const COMPOSER_HEIGHT_KEY = 'yv.tickets.composerHeight';
const COMPOSER_MIN_HEIGHT = 180;
const COMPOSER_DEFAULT_HEIGHT = 280;

function ConversationPanel({ ticket, onReplySent, onStatusChange, playMode, afterActionMode, onChangeAfterActionMode, onAdvance, onApplyMacroSubject }) {
  const { user } = useContext(AuthContext);
  const bottomRef = useRef();
  const sectionRef = useRef();
  const messages = ticket.messages || [];
  const [failedMessages, setFailedMessages] = useState([]); // messages locaux non envoyés

  // Hauteur du composer (persistée localStorage)
  const [composerHeight, setComposerHeight] = useState(() => {
    const raw = parseInt(localStorage.getItem(COMPOSER_HEIGHT_KEY), 10);
    return Number.isFinite(raw) && raw > 0 ? raw : COMPOSER_DEFAULT_HEIGHT;
  });
  useEffect(() => {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(composerHeight));
  }, [composerHeight]);

  // Drag de la poignée
  const dragStateRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDragStart = (e) => {
    e.preventDefault();
    const sectionHeight = sectionRef.current?.getBoundingClientRect().height || window.innerHeight;
    dragStateRef.current = {
      startY: e.clientY,
      startHeight: composerHeight,
      maxHeight: Math.max(COMPOSER_MIN_HEIGHT, sectionHeight - 120), // garde au moins 120px pour le thread
    };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      // drag vers le haut (deltaY négatif) -> composer plus grand
      const delta = st.startY - e.clientY;
      const next = Math.min(st.maxHeight, Math.max(COMPOSER_MIN_HEIGHT, st.startHeight + delta));
      setComposerHeight(next);
    };
    const handleUp = () => { dragStateRef.current = null; setDragging(false); };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  // Vider les messages échoués quand on change de ticket
  useEffect(() => { setFailedMessages([]); }, [ticket.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, failedMessages.length]);

  const source = ticket.source === 'gravity_form' ? 'formulaire' : 'e-mail';

  const handleSendFailed = (msg) => {
    setFailedMessages(prev => [...prev, msg]);
  };

  return (
    <section ref={sectionRef} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: C.grisTL, overflow: 'hidden' }}>
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
      </div>

      {/* Thread */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 16px' }}>
        {ticket.description && (
          <Message
            msg={{ from: ticket.customer_name || ticket.customer_email, body: ticket.description, is_agent: false, date: ticket.created_at, attachments: [] }}
            ticketId={ticket.id}
          />
        )}
        {messages.map((msg, i) => <Message key={i} msg={msg} ticketId={ticket.id} />)}
        {failedMessages.map((msg, i) => <Message key={`failed-${i}`} msg={msg} ticketId={ticket.id} />)}
        <div ref={bottomRef} />
      </div>

      {/* Poignée d'agrandissement (drag vers le haut = composer plus grand) */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: 7, flexShrink: 0, cursor: 'ns-resize',
          background: dragging ? `${TICKETS_COLOR}30` : C.grisCL,
          borderTop: `1px solid ${C.grisCL}`,
          borderBottom: `1px solid ${C.grisCL}`,
          position: 'relative',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!dragging) e.currentTarget.style.background = `${TICKETS_COLOR}40`; }}
        onMouseLeave={e => { if (!dragging) e.currentTarget.style.background = C.grisCL; }}
        title="Glisser pour redimensionner le composer"
      >
        {/* 3 petits points pour signaler la poignée */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          display: 'flex', gap: 3, pointerEvents: 'none',
        }}>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.grisM }} />
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.grisM }} />
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.grisM }} />
        </div>
      </div>

      {/* Composer — hauteur fixe pilotée par la poignée */}
      <div style={{ height: composerHeight, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ReplyComposer
          ticketId={ticket.id}
          demandeur={ticket.customer_name || ticket.customer_email}
          agentName={user?.name || 'SAV Youvape'}
          agent={user}
          ticket={ticket}
          currentStatus={ticket.sav_status}
          onReplySent={onReplySent}
          onSendFailed={handleSendFailed}
          onStatusChange={onStatusChange}
          playMode={playMode}
          afterActionMode={afterActionMode}
          onChangeAfterActionMode={onChangeAfterActionMode}
          onAdvance={onAdvance}
          onApplyMacroSubject={onApplyMacroSubject}
        />
      </div>
    </section>
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

// ─── Modale de fusion de tickets ──────────────────────────────────────────────
// Façon Zendesk : on fusionne le ticket courant (source) DANS un ticket cible.
// La cible peut être choisie parmi les doublons détectés ou par recherche libre.
function MergeModal({ ticket, onClose, onMerged }) {
  const candidates = Array.isArray(ticket.duplicate_candidates) ? ticket.duplicate_candidates : [];
  const [targetId, setTargetId] = useState(candidates[0]?.id ? String(candidates[0].id) : '');
  const [searchResults, setSearchResults] = useState([]);
  const [query, setQuery] = useState('');
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef();

  // Recherche de tickets cible par ID / email / nom / sujet (debounce 350ms)
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}?search=${encodeURIComponent(query.trim())}&limit=8`);
        const data = await res.json();
        if (data.success) {
          // Exclure le ticket source et les tickets déjà fusionnés
          setSearchResults((data.tickets || []).filter(t => t.id !== ticket.id && !t.merged_into_id));
        }
      } catch { /* silencieux */ }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, ticket.id]);

  const targetNum = parseInt(targetId);
  const canMerge = !Number.isNaN(targetNum) && targetNum !== ticket.id && !merging;

  const doMerge = async () => {
    if (!canMerge) return;
    setMerging(true);
    setError('');
    try {
      const res = await fetch(`${API}/${ticket.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetNum }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur de fusion');
      onMerged(data.ticket);
    } catch (e) {
      setError(e.message);
      setMerging(false);
    }
  };

  const Pick = ({ t }) => {
    const selected = String(t.id) === String(targetId);
    return (
      <button
        onClick={() => { setTargetId(String(t.id)); setError(''); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          background: selected ? '#EAF2FF' : C.blanc,
          border: `1px solid ${selected ? C.bleu : C.grisCL}`,
          borderRadius: 8, padding: '8px 11px', cursor: 'pointer',
          fontFamily: 'Lato, sans-serif', marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 800, color: selected ? C.bleu : C.grisF }}>#{t.id}</span>
        <span style={{ fontSize: 12, color: C.grisF, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.subject || '—'}
        </span>
        {t.customer_name && (
          <span style={{ fontSize: 11, color: C.grisM, whiteSpace: 'nowrap' }}>{t.customer_name}</span>
        )}
        {selected && <span style={{ fontSize: 13, color: C.bleu }}>✓</span>}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.blanc, borderRadius: 14, width: 'min(520px, 92vw)',
          maxHeight: '86vh', overflow: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,0.3)',
          fontFamily: 'Lato, sans-serif', padding: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <strong style={{ fontSize: 16, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>
            Fusionner le ticket #{ticket.id}
          </strong>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: C.grisM, lineHeight: 1 }}
          >×</button>
        </div>
        <p style={{ fontSize: 12.5, color: C.grisF, lineHeight: 1.5, margin: '6px 0 16px' }}>
          Les messages et pièces jointes de ce ticket seront déplacés dans le ticket cible.
          Ce ticket sera <strong>fermé</strong> et renverra vers la cible. Action irréversible.
        </p>

        {candidates.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Doublons détectés
            </div>
            {candidates.map(c => <Pick key={c.id} t={c} />)}
          </>
        )}

        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 8px' }}>
          Rechercher un autre ticket
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="ID, nom, email ou sujet…"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '9px 12px',
            border: `1px solid ${C.grisCL}`, borderRadius: 8, fontSize: 13,
            fontFamily: 'Lato, sans-serif', marginBottom: 8, outline: 'none',
          }}
        />
        {searchResults.map(t => <Pick key={t.id} t={t} />)}

        {error && (
          <div style={{ fontSize: 12.5, color: '#B71D1D', fontWeight: 600, margin: '8px 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              background: C.grisTL, border: `1px solid ${C.grisCL}`, borderRadius: 8,
              padding: '9px 16px', fontSize: 13, fontWeight: 700, color: C.grisF,
              cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            }}
          >Annuler</button>
          <button
            onClick={doMerge}
            disabled={!canMerge}
            style={{
              background: canMerge ? C.bleu : C.grisCL, border: 'none', borderRadius: 8,
              padding: '9px 18px', fontSize: 13, fontWeight: 800, color: '#fff',
              cursor: canMerge ? 'pointer' : 'not-allowed', fontFamily: 'Lato, sans-serif',
            }}
          >
            {merging ? 'Fusion…' : targetNum ? `Fusionner dans #${targetNum}` : 'Choisir une cible'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panneau DROIT ────────────────────────────────────────────────────────────
function CustomerPanel({ ticket, onAssignOrder, onUnassignOrder, onMerge }) {
  const navigate = useNavigate();
  const tabsCtx = useOpenTickets();

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

      {/* Bannière doublon potentiel */}
      {ticket.has_duplicate_warning && Array.isArray(ticket.duplicate_candidates) && ticket.duplicate_candidates.length > 0 && (
        <div style={{
          marginTop: 14,
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 10,
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <strong style={{ fontSize: 12.5, color: '#B71D1D', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Doublon potentiel
            </strong>
          </div>
          <div style={{ fontSize: 12.5, color: '#7F1D1D', marginBottom: 8, lineHeight: 1.4 }}>
            Ce client a {ticket.duplicate_candidates.length} autre{ticket.duplicate_candidates.length > 1 ? 's' : ''} ticket{ticket.duplicate_candidates.length > 1 ? 's' : ''} récent{ticket.duplicate_candidates.length > 1 ? 's' : ''} ouvert{ticket.duplicate_candidates.length > 1 ? 's' : ''}{ticket.order_id ? ' sur la même commande' : ''}.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {ticket.duplicate_candidates.map(dup => (
              <button
                key={dup.id}
                onClick={() => {
                  if (tabsCtx) tabsCtx.openTicket(dup);
                  else navigate(`/tickets/${dup.id}`);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: C.blanc, border: '1px solid #FECACA',
                  borderRadius: 7, padding: '6px 10px',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'Lato, sans-serif', width: '100%',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#FEF2F2'}
                onMouseLeave={e => e.currentTarget.style.background = C.blanc}
              >
                <span style={{ fontSize: 12, fontWeight: 800, color: '#B71D1D' }}>#{dup.id}</span>
                <span style={{ fontSize: 11.5, color: C.grisF, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dup.subject || '—'}
                </span>
                <span style={{ fontSize: 10.5, color: C.grisM }}>
                  {dup.created_at ? formatDate(dup.created_at) : ''}
                </span>
              </button>
            ))}
          </div>
          {!ticket.merged_into_id && (
            <button
              onClick={onMerge}
              style={{
                marginTop: 10, width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                background: '#B71D1D', border: 'none', borderRadius: 8,
                padding: '8px 12px', fontSize: 12.5, fontWeight: 800, color: '#fff',
                cursor: 'pointer', fontFamily: 'Lato, sans-serif',
              }}
            >🔀 Fusionner ce ticket…</button>
          )}
        </div>
      )}

      {/* Bandeau : ce ticket a été fusionné dans un autre */}
      {ticket.merged_into_id && (
        <button
          onClick={() => {
            const dest = { id: ticket.merged_into_id };
            if (tabsCtx) tabsCtx.openTicket(dest);
            else navigate(`/tickets/${ticket.merged_into_id}`);
          }}
          style={{
            marginTop: 14, width: '100%', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#EAF2FF', border: `1px solid ${C.bleu}`,
            borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
            fontFamily: 'Lato, sans-serif',
          }}
        >
          <span style={{ fontSize: 16 }}>🔀</span>
          <span style={{ flex: 1, fontSize: 12.5, color: C.grisF, fontWeight: 600 }}>
            Ce ticket a été fusionné dans le ticket <strong style={{ color: C.bleu }}>#{ticket.merged_into_id}</strong>.
          </span>
          <Ic.External color={C.bleu} />
        </button>
      )}

      {/* Commande concernée */}
      {currentOrder && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Commande concernée</SectionLabel>
          <OrderCard
            order={currentOrder}
            highlighted
            onUnassign={onUnassignOrder}
          />
        </div>
      )}

      {/* Historique commandes */}
      {pastOrders.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel right={`${pastOrders.length} commandes`}>Historique</SectionLabel>
          {pastOrders.map(o => (
            <OrderCard
              key={o.wp_order_id}
              order={o}
              canAssign={!ticket.order_id}
              onAssign={onAssignOrder}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function TicketDetail({ ticketId }) {
  const navigate = useNavigate();
  const { user, token } = useContext(AuthContext);
  const tabsCtx = useOpenTickets(); // peut être null si rendu hors provider
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [mergeOpen, setMergeOpen] = useState(false);
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

  // Sync les méta dans la barre d'onglets quand le ticket change (titre, statut)
  useEffect(() => {
    if (!ticket || !tabsCtx) return;
    tabsCtx.updateTicketMeta(ticket.id, {
      subject: ticket.subject,
      customer_name: ticket.customer_name,
      sav_status: ticket.sav_status,
    });
  }, [ticket?.id, ticket?.subject, ticket?.customer_name, ticket?.sav_status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bouton retour : vers liste si dans onglets, sinon navigate
  const handleBack = useCallback(() => {
    if (tabsCtx) tabsCtx.setActiveTab('list');
    else navigate('/tickets');
  }, [tabsCtx, navigate]);

  // Charger la liste des agents (utilisateurs de l'app)
  useEffect(() => {
    if (!token) return;
    fetch('/api/users/agents', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success && d.users) setUsers(d.users); })
      .catch(() => {});
  }, [token]);

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

  const handleStatusChange = useCallback(async (newStatus) => {
    const res = await fetch(`${API}/${ticketId}/status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sav_status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur changement statut');
    // Conserver les champs enrichis (order_items, customer_*) qui ne reviennent pas du endpoint /status
    setTicket(t => ({ ...t, ...data.ticket }));
    return data.ticket;
  }, [ticketId]);

  // Lier/délier une commande au ticket : PATCH puis refetch pour récupérer
  // les enrichissements (order_items, order_status, order_total, etc.)
  const handleAssignOrder = useCallback(async (wpOrderId) => {
    try {
      await fetch(`${API}/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: String(wpOrderId) }),
      });
      await fetchTicket();
    } catch { /* silencieux */ }
  }, [ticketId, fetchTicket]);

  const handleUnassignOrder = useCallback(async () => {
    try {
      await fetch(`${API}/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: null }),
      });
      await fetchTicket();
    } catch { /* silencieux */ }
  }, [ticketId, fetchTicket]);

  // Fusion réussie : le ticket courant (source) est désormais fermé.
  // On bascule vers le ticket cible. Dans la barre d'onglets, on ferme
  // l'onglet source et on ouvre la cible ; sinon on navigue.
  const handleMerged = useCallback((targetTicket) => {
    setMergeOpen(false);
    if (!targetTicket) { fetchTicket(); return; }
    if (tabsCtx) {
      tabsCtx.openTicket(targetTicket);
      tabsCtx.closeTicket?.(ticketId);
    } else {
      navigate(`/tickets/${targetTicket.id}`);
    }
  }, [tabsCtx, ticketId, navigate, fetchTicket]);

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
            onClick={handleBack}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
              color: '#fff', border: 'none', borderRadius: 8, padding: '7px 13px',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Lato, sans-serif', flexShrink: 0,
              boxShadow: `0 2px 6px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.35) inset`,
            }}
          ><Ic.Back /> Liste</button>

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
          {!ticket.merged_into_id && (
            <button
              onClick={() => setMergeOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: C.grisTL, border: `1px solid ${C.grisCL}`, borderRadius: 8,
                padding: '7px 13px', fontSize: 13, fontWeight: 700, color: C.grisF,
                cursor: 'pointer', fontFamily: 'Lato, sans-serif',
              }}
              title="Fusionner ce ticket dans un autre"
            >🔀 Fusionner</button>
          )}
        </div>
      </header>

      {/* ── 3 colonnes ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <TicketFieldsPanel ticket={ticket} onFieldChange={handleFieldChange} users={users} />
        <ConversationPanel
          ticket={ticket}
          onReplySent={(updatedTicket) => setTicket(t => ({ ...t, ...updatedTicket }))}
          onStatusChange={handleStatusChange}
          playMode={!!tabsCtx?.isPlayActive && tabsCtx?.playTicketId === ticket.id}
          afterActionMode={tabsCtx?.afterActionMode || 'next'}
          onChangeAfterActionMode={tabsCtx?.setAfterActionMode}
          onAdvance={tabsCtx?.advancePlay}
          onApplyMacroSubject={(subject) => handleFieldChange('subject', subject)}
        />
        <CustomerPanel
          ticket={ticket}
          onAssignOrder={handleAssignOrder}
          onUnassignOrder={handleUnassignOrder}
          onMerge={() => setMergeOpen(true)}
        />
      </div>

      {mergeOpen && (
        <MergeModal
          ticket={ticket}
          onClose={() => setMergeOpen(false)}
          onMerged={handleMerged}
        />
      )}
    </div>
  );
}
