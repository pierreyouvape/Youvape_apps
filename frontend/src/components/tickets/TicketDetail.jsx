import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR, TICKET_STATUS_LIST } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
  orange: '#E28F00',
};

const API = '/api/sav';

// ─── Icônes ───────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Avatar({ name, isAgent, size = 34 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: isAgent ? TICKETS_COLOR : C.grisM,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

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
      borderRadius: 6, fontSize: 12, color: TICKETS_COLOR,
      textDecoration: 'none', fontWeight: 600,
    }}>
      📎 {att.original_name} {sizeKb && <span style={{ color: C.grisM, fontWeight: 400 }}>({sizeKb})</span>}
    </a>
  );
}

// ─── Bulle de message ─────────────────────────────────────────────────────────
function MessageBubble({ msg, ticketId }) {
  const isAgent = msg.is_agent;
  const atts = msg.attachments || [];

  return (
    <div style={{
      display: 'flex', gap: 10,
      flexDirection: isAgent ? 'row-reverse' : 'row',
      marginBottom: 20,
    }}>
      <Avatar name={msg.from} isAgent={isAgent} />
      <div style={{ maxWidth: '72%' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          flexDirection: isAgent ? 'row-reverse' : 'row',
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>{msg.from}</span>
          <span style={{ fontSize: 11.5, color: C.grisM }}>{formatDate(msg.date, { time: true })}</span>
        </div>
        <div style={{
          background: isAgent ? TICKETS_COLOR : C.blanc,
          color: isAgent ? '#fff' : C.grisTF,
          borderRadius: isAgent ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          padding: '12px 16px',
          border: isAgent ? 'none' : `1px solid ${C.grisCL}`,
          fontSize: 13.5, lineHeight: 1.55,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {msg.body}
        </div>
        {atts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: isAgent ? 'flex-end' : 'flex-start' }}>
            {atts.map((a, i) => <AttachmentItem key={i} att={a} ticketId={ticketId} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Composer de réponse ──────────────────────────────────────────────────────
function ReplyComposer({ ticketId, onReplySent }) {
  const [body, setBody] = useState(() => localStorage.getItem(`yv.tickets.draft.${ticketId}`) || '');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  // Persister le brouillon
  useEffect(() => {
    localStorage.setItem(`yv.tickets.draft.${ticketId}`, body);
  }, [body, ticketId]);

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    const MAX = 25 * 1024 * 1024;
    const oversized = selected.filter(f => f.size > MAX);
    if (oversized.length) { setError(`Fichier trop lourd (max 25 Mo) : ${oversized.map(f => f.name).join(', ')}`); return; }
    if (files.length + selected.length > 10) { setError('Maximum 10 fichiers par message'); return; }
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

  return (
    <div style={{
      borderTop: `1px solid ${C.grisCL}`,
      background: C.blanc, padding: 16,
    }}>
      {/* Textarea */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Écrire une réponse au client…"
        rows={4}
        style={{
          width: '100%', resize: 'vertical',
          border: `1px solid ${C.grisCL}`, borderRadius: 10,
          padding: '10px 14px', fontSize: 13.5,
          fontFamily: 'Lato, sans-serif', color: C.grisTF,
          outline: 'none', lineHeight: 1.5,
        }}
        onFocus={e => e.target.style.borderColor = C.orange}
        onBlur={e => e.target.style.borderColor = C.grisCL}
      />

      {/* Preview fichiers */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', background: C.grisTL,
              border: `1px solid ${C.grisCL}`, borderRadius: 6,
              fontSize: 12, color: C.grisF,
            }}>
              📎 {f.name} <span style={{ color: C.grisM }}>({(f.size / 1024).toFixed(0)} Ko)</span>
              <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.grisM, padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: '#B71D1D' }}>{error}</div>}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <button
          onClick={() => fileRef.current.click()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.grisM, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          📎 Joindre un fichier
        </button>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        <button
          onClick={handleSend}
          disabled={sending || (!body.trim() && files.length === 0)}
          style={{
            background: sending ? C.grisM : TICKETS_COLOR,
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '9px 22px', fontSize: 14, fontWeight: 700,
            cursor: sending ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {sending ? 'Envoi…' : 'Envoyer →'}
        </button>
      </div>
    </div>
  );
}

// ─── Panneau droit — infos client + commande ──────────────────────────────────
function InfoPanel({ ticket, onStatusChange, onNoteSave }) {
  const navigate = useNavigate();
  const [notes, setNotes] = useState(ticket.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const handleStatusChange = async (newStatus) => {
    setChangingStatus(true);
    try {
      const res = await fetch(`${API}/${ticket.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sav_status: newStatus }),
      });
      const data = await res.json();
      if (data.success) onStatusChange(data.ticket);
    } finally { setChangingStatus(false); }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await fetch(`${API}/${ticket.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      onNoteSave(notes);
    } finally { setSavingNotes(false); }
  };

  const Block = ({ title, children }) => (
    <div style={{ borderBottom: `1px solid ${C.grisCL}`, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );

  const Row = ({ label, value, link }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 13 }}>
      <span style={{ color: C.grisM }}>{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: TICKETS_COLOR, fontWeight: 600, textDecoration: 'none' }}>{value}</a>
      ) : (
        <span style={{ color: C.grisTF, fontWeight: 600, textAlign: 'right', maxWidth: 160, wordBreak: 'break-word' }}>{value || '—'}</span>
      )}
    </div>
  );

  return (
    <aside style={{
      width: 300, flexShrink: 0,
      background: C.blanc,
      borderLeft: `1px solid ${C.grisCL}`,
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* Statut */}
      <Block title="Statut">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TICKET_STATUS_LIST.map(s => (
            <button
              key={s.value}
              onClick={() => handleStatusChange(s.value)}
              disabled={changingStatus}
              style={{
                padding: '5px 12px', borderRadius: 99,
                border: `2px solid ${ticket.sav_status === s.value ? s.color : C.grisCL}`,
                background: ticket.sav_status === s.value ? s.bg : C.blanc,
                color: ticket.sav_status === s.value ? s.color : C.grisF,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Block>

      {/* Client */}
      <Block title="Client">
        <Row label="Nom" value={ticket.customer_name} />
        <Row label="Email" value={ticket.customer_email} />
        {ticket.customer_phone && <Row label="Tél." value={ticket.customer_phone} />}
        {ticket.customer_id && (
          <button
            onClick={() => navigate(`/customers/${ticket.customer_id}`)}
            style={{ width: '100%', marginTop: 6, padding: '6px 0', background: 'none', border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 600, cursor: 'pointer' }}
          >
            Voir fiche client →
          </button>
        )}
      </Block>

      {/* Commande */}
      {ticket.order_id && (
        <Block title="Commande">
          <Row label="N°" value={`#${ticket.order_id}`} />
          {ticket.order_total && <Row label="Total" value={`${parseFloat(ticket.order_total).toFixed(2)} €`} />}
          {ticket.order_status && <Row label="Statut" value={ticket.order_status.replace('wc-', '')} />}
          {ticket.order_date && <Row label="Date" value={formatDate(ticket.order_date)} />}
          <button
            onClick={() => navigate(`/commandes?order=${ticket.order_id}`)}
            style={{ width: '100%', marginTop: 6, padding: '6px 0', background: 'none', border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 600, cursor: 'pointer' }}
          >
            Voir commande →
          </button>
        </Block>
      )}

      {/* Notes internes */}
      <Block title="Note interne">
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Note visible uniquement par l'équipe…"
          rows={4}
          style={{
            width: '100%', resize: 'vertical',
            border: `1px solid ${C.grisCL}`, borderRadius: 8,
            padding: '8px 10px', fontSize: 13,
            fontFamily: 'Lato, sans-serif', color: C.grisTF,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSaveNotes}
          disabled={savingNotes}
          style={{
            marginTop: 8, width: '100%', padding: '7px 0',
            background: savingNotes ? C.grisM : C.orange,
            color: '#fff', border: 'none', borderRadius: 6,
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {savingNotes ? 'Sauvegarde…' : 'Sauvegarder la note'}
        </button>
      </Block>

      {/* Méta */}
      <Block title="Informations">
        <Row label="Ticket" value={`#${ticket.id}`} />
        <Row label="Source" value={ticket.source === 'gravity_form' ? 'Formulaire' : 'Email'} />
        <Row label="Créé le" value={formatDate(ticket.created_at, { time: true })} />
        <Row label="Mis à jour" value={formatDate(ticket.updated_at, { time: true })} />
      </Block>
    </aside>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function TicketDetail({ ticketId }) {
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef();

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`${API}/${ticketId}`);
      const data = await res.json();
      if (data.success) setTicket(data.ticket);
      else setError('Ticket introuvable');
    } catch {
      setError('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { fetchTicket(); }, [fetchTicket]);

  // Scroll vers le bas quand les messages changent
  useEffect(() => {
    if (ticket?.messages?.length) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ticket?.messages?.length]);

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

  const messages = ticket.messages || [];

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* ── Centre : conversation ──────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header ticket */}
        <div style={{
          padding: '14px 20px',
          background: C.blanc,
          borderBottom: `1px solid ${C.grisCL}`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <button
            onClick={() => navigate('/tickets')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.grisM, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginTop: 2, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            ← Tickets
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: C.grisTF }}>{ticket.subject}</span>
              <StatusBadge status={ticket.sav_status} />
            </div>
            <div style={{ fontSize: 12, color: C.grisM, marginTop: 3 }}>
              #{ticket.id} · {ticket.customer_name} · {formatDate(ticket.created_at)}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: C.grisTL }}>
          {/* Message initial (description du formulaire) */}
          {ticket.description && messages.length === 0 && (
            <MessageBubble
              msg={{ from: ticket.customer_name || ticket.customer_email, body: ticket.description, is_agent: false, date: ticket.created_at, attachments: [] }}
              ticketId={ticket.id}
            />
          )}
          {ticket.description && messages.length > 0 && (
            <MessageBubble
              msg={{ from: ticket.customer_name || ticket.customer_email, body: ticket.description, is_agent: false, date: ticket.created_at, attachments: [] }}
              ticketId={ticket.id}
            />
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} ticketId={ticket.id} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <ReplyComposer
          ticketId={ticket.id}
          onReplySent={(updatedTicket) => setTicket(updatedTicket)}
        />
      </div>

      {/* ── Panneau droit ─────────────────────────────────────────── */}
      <InfoPanel
        ticket={ticket}
        onStatusChange={(updated) => setTicket(updated)}
        onNoteSave={(notes) => setTicket(t => ({ ...t, notes }))}
      />
    </div>
  );
}
