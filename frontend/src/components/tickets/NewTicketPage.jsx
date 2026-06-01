import { useState, useEffect, useRef, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { useOpenTickets } from '../../context/OpenTicketsContext';
import { useTicketStatuses } from './useTicketStatuses';
import { TICKETS_COLOR } from './ticketConstants';
import CustomerAutocomplete from './CustomerAutocomplete';
import OrderCard from './OrderCard';

const C = {
  orange: '#E28F00', vert: '#4AB866', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const DRAFT_KEY = 'yv.tickets.draftNew';

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return '#' + adj(r).toString(16).padStart(2, '0') + adj(g).toString(16).padStart(2, '0') + adj(b).toString(16).padStart(2, '0');
}

// ─── Icônes ────────────────────────────────────────────────────────────────────
const Ic = {
  Send: ({ size = 14, color = '#fff' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  ),
  Chev: ({ size = 11, color = 'currentColor' }) => (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Attach: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  User: ({ size = 14, color = C.grisF }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

// ─── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, size = 34 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.25)})`,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(10, size * 0.38), fontWeight: 800, flexShrink: 0,
      boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
    }}>{initials}</div>
  );
}

// ─── Validation email ──────────────────────────────────────────────────────────
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
}

// ─── Styles partagés ───────────────────────────────────────────────────────────
const fieldInputBase = {
  width: '100%', border: `1px solid ${C.grisCL}`, background: '#fff',
  borderRadius: 8, padding: '9px 12px', fontSize: 13.5,
  fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box',
};

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: C.grisF, letterSpacing: '0.02em', textTransform: 'uppercase' }}>
          {label}{required && <span style={{ color: '#B71D1D', marginLeft: 3 }}>*</span>}
        </label>
      </div>
      {children}
    </div>
  );
}

function FieldInput({ value, onChange, placeholder, type = 'text', invalid }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type} value={value || ''} onChange={onChange}
      placeholder={placeholder || '—'}
      style={{
        ...fieldInputBase,
        borderColor: invalid ? '#B71D1D' : (focused ? TICKETS_COLOR : C.grisCL),
        boxShadow: focused ? `0 0 0 3px ${invalid ? 'rgba(183,29,29,0.15)' : 'rgba(8,145,178,0.16)'}` : 'none',
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function FieldDivider() {
  return <div style={{ height: 1, background: C.grisCL, margin: '6px 0 18px' }} />;
}

// ─── Charge brouillon ─────────────────────────────────────────────────────────
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function NewTicketPage() {
  const { user, token } = useContext(AuthContext);
  const { convertDraftToTicket, closeNewDraft } = useOpenTickets();
  const { statuses, statusMap } = useTicketStatuses();

  // Brouillon
  const initial = loadDraft() || {
    customer_id: null,
    first_name: '', last_name: '',
    customer_email: '', customer_phone: '',
    order_id: '',
    assigned_to_id: null,
    subject: '',
    body: '',
    is_private: false,
    sav_status: null,
  };

  const [form, setForm] = useState(initial);
  const [users, setUsers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [searchValue, setSearchValue] = useState(
    initial.customer_email || `${initial.first_name || ''} ${initial.last_name || ''}`.trim()
  );
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({ email: false, subject: false, body: false });

  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const statusRef = useRef();
  const assignRef = useRef();
  const modeRef = useRef();
  const fileRef = useRef();

  // Initialiser le statut par défaut au premier statut de la liste
  useEffect(() => {
    if (form.sav_status || statuses.length === 0) return;
    setForm(f => ({ ...f, sav_status: statuses[0].value }));
  }, [statuses, form.sav_status]);

  // Persister le brouillon
  useEffect(() => { saveDraft(form); }, [form]);

  // Charger la liste des agents
  useEffect(() => {
    if (!token) return;
    fetch('/api/users/agents', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success && d.users) setUsers(d.users); })
      .catch(() => {});
  }, [token]);

  // Charger historique commandes quand un client est sélectionné via autocomplete
  useEffect(() => {
    if (!selectedCustomer?.wp_user_id) { setCustomerOrders([]); return; }
    let cancelled = false;
    setLoadingOrders(true);
    fetch(`/api/sav/customer-orders/${selectedCustomer.wp_user_id}?limit=6`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.success) setCustomerOrders(d.orders || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingOrders(false); });
    return () => { cancelled = true; };
  }, [selectedCustomer?.wp_user_id]);

  // Fermeture des dropdowns au clic extérieur
  useEffect(() => {
    if (!statusOpen) return;
    const h = (e) => { if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [statusOpen]);
  useEffect(() => {
    if (!assignOpen) return;
    const h = (e) => { if (assignRef.current && !assignRef.current.contains(e.target)) setAssignOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [assignOpen]);
  useEffect(() => {
    if (!modeOpen) return;
    const h = (e) => { if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [modeOpen]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Sélection client via autocomplete
  const handleSelectCustomer = (c) => {
    setSelectedCustomer(c);
    setSearchValue(`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email);
    setForm(f => ({
      ...f,
      customer_id: c.id,
      first_name: c.first_name || '',
      last_name: c.last_name || '',
      customer_email: c.email || '',
      customer_phone: c.billing_phone || c.customer_phone || '',
    }));
  };

  // Validation
  const errors = {
    email: !form.customer_email || !isValidEmail(form.customer_email),
    subject: !form.subject || !form.subject.trim(),
    body: !form.body || !form.body.trim(),
  };
  const canSend = !errors.email && !errors.subject && !errors.body && !!form.sav_status;

  const handleSend = async () => {
    setTouched({ email: true, subject: true, body: true });
    if (!canSend) {
      setError('Veuillez corriger les champs en rouge avant d\'envoyer.');
      return;
    }
    setSending(true); setError('');
    try {
      const fd = new FormData();
      fd.append('customer_email', form.customer_email.trim().toLowerCase());
      fd.append('customer_name', `${form.first_name} ${form.last_name}`.trim());
      if (form.customer_phone) fd.append('customer_phone', form.customer_phone);
      if (form.order_id) fd.append('order_id', form.order_id);
      fd.append('subject', form.subject.trim());
      fd.append('body', form.body);
      fd.append('is_private', form.is_private ? 'true' : 'false');
      fd.append('sav_status', form.sav_status);
      if (form.assigned_to_id) fd.append('assigned_to_id', String(form.assigned_to_id));
      fd.append('agent_name', user?.name || 'SAV Youvape');
      files.forEach(f => fd.append('attachments', f));

      const res = await fetch('/api/sav', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erreur création');

      // Transforme le brouillon en onglet ticket réel
      convertDraftToTicket(data.ticket);
    } catch (e) {
      setError(e.message || 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    const oversized = selected.filter(f => f.size > 25 * 1024 * 1024);
    if (oversized.length) { setError(`Fichier trop lourd (max 25 Mo) : ${oversized.map(f => f.name).join(', ')}`); return; }
    if (files.length + selected.length > 10) { setError('Maximum 10 fichiers'); return; }
    setError('');
    setFiles(prev => [...prev, ...selected]);
  };

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const assignedUser = users.find(u => u.id === form.assigned_to_id) || null;
  const fullName = `${form.first_name || ''} ${form.last_name || ''}`.trim();

  // Couleurs composer
  const borderColor = form.body.length > 0
    ? (form.is_private ? '#F6C613' : TICKETS_COLOR)
    : C.grisCL;
  const bgColor = form.is_private ? '#FFFDE7' : '#FCFEFF';
  const headerBg = form.is_private ? '#FFF8E1' : C.blanc;

  const currentStatusLabel = statusMap[form.sav_status]?.label || form.sav_status || '—';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      {/* Top bar */}
      <header style={{
        background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
        padding: '0 24px', minHeight: 58, display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, color: C.grisM, fontWeight: 600 }}>Tickets / </span>
        <strong style={{ fontSize: 14.5, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>
          Nouveau ticket
        </strong>
      </header>

      {/* 3 colonnes */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* ─── GAUCHE ─────────────────────────────────────────────────────── */}
        <aside style={{
          width: 300, minWidth: 300, flexShrink: 0,
          background: C.blanc, borderRight: `1px solid ${C.grisCL}`,
          height: '100%', overflowY: 'auto', padding: '20px 20px',
        }}>
          {/* Recherche client */}
          <Field label="Rechercher un client">
            <CustomerAutocomplete
              value={searchValue}
              onChange={(v) => {
                setSearchValue(v);
                // Si on modifie le champ après une sélection, on délie le client
                if (selectedCustomer) {
                  setSelectedCustomer(null);
                  setForm(f => ({ ...f, customer_id: null }));
                }
              }}
              onSelect={handleSelectCustomer}
            />
          </Field>

          {/* Demandeur (lecture seule, dérivé) */}
          <Field label="Demandeur">
            <div style={{ ...fieldInputBase, display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar name={fullName} size={22} />
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: fullName ? C.grisTF : C.grisM }}>
                {fullName || '—'}
              </span>
            </div>
          </Field>

          {/* Assigné */}
          <Field label="Assigné">
            <div style={{ position: 'relative' }} ref={assignRef}>
              <div
                onClick={() => setAssignOpen(o => !o)}
                style={{
                  ...fieldInputBase,
                  display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
                  borderColor: assignOpen ? TICKETS_COLOR : C.grisCL,
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
                    style={{ padding: '9px 14px', fontSize: 13.5, color: C.grisM, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >Non assigné</div>
                  {users.map(u => (
                    <div
                      key={u.id}
                      onClick={() => { set('assigned_to_id', u.id); setAssignOpen(false); }}
                      style={{
                        padding: '9px 14px', fontSize: 13.5, color: C.grisTF, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 9,
                        background: form.assigned_to_id === u.id ? `${TICKETS_COLOR}12` : 'transparent',
                        fontWeight: form.assigned_to_id === u.id ? 700 : 400,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                      onMouseLeave={e => e.currentTarget.style.background = form.assigned_to_id === u.id ? `${TICKETS_COLOR}12` : 'transparent'}
                    >
                      <Avatar name={u.name} size={22} />{u.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <FieldDivider />

          <Field label="Prénom"><FieldInput value={form.first_name} onChange={e => set('first_name', e.target.value)} /></Field>
          <Field label="Nom du client"><FieldInput value={form.last_name} onChange={e => set('last_name', e.target.value)} /></Field>

          <Field label="Email" required>
            <FieldInput
              type="email" value={form.customer_email}
              onChange={e => set('customer_email', e.target.value)}
              invalid={touched.email && errors.email}
            />
            {touched.email && errors.email && (
              <div style={{ fontSize: 11, color: '#B71D1D', marginTop: 4, fontWeight: 600 }}>
                Email valide requis
              </div>
            )}
          </Field>

          <Field label="Téléphone">
            <FieldInput value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} />
          </Field>

          <FieldDivider />

          <Field label="N° de commande">
            <FieldInput value={form.order_id} onChange={e => set('order_id', e.target.value)} placeholder="ex. 1222924" />
          </Field>
        </aside>

        {/* ─── CENTRE ─────────────────────────────────────────────────────── */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: C.grisTL, overflow: 'hidden' }}>
          {/* Sujet */}
          <div style={{
            padding: '20px 28px 16px', background: C.blanc,
            borderBottom: `1px solid ${C.grisCL}`,
          }}>
            <label style={{
              fontSize: 11, fontWeight: 700, color: C.grisM, letterSpacing: '0.05em', textTransform: 'uppercase',
              display: 'block', marginBottom: 6,
            }}>Sujet du ticket *</label>
            <input
              type="text"
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, subject: true }))}
              placeholder="Sujet du ticket"
              style={{
                width: '100%', border: 'none', outline: 'none',
                fontSize: 19, fontWeight: 800, color: C.grisTF,
                fontFamily: "'Tilt Warp', cursive", letterSpacing: '-0.2px',
                padding: '4px 0', boxSizing: 'border-box',
                background: 'transparent',
              }}
            />
            {touched.subject && errors.subject && (
              <div style={{ fontSize: 11.5, color: '#B71D1D', marginTop: 2, fontWeight: 600 }}>
                Sujet requis
              </div>
            )}
          </div>

          {/* Zone thread vide */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: C.grisM, fontSize: 13.5, maxWidth: 320 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✉️</div>
              <div style={{ fontWeight: 700, color: C.grisF, marginBottom: 4 }}>Nouveau ticket</div>
              <div>Renseignez les informations du demandeur à gauche puis rédigez le premier message ci-dessous.</div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ background: C.blanc, borderTop: `1px solid ${C.grisCL}`, padding: '14px 28px 16px' }}>
            <div style={{
              border: `1px solid ${touched.body && errors.body ? '#B71D1D' : borderColor}`,
              borderRadius: 12, background: bgColor, transition: 'all 0.2s',
            }}>
              {/* Header composer : choix mode */}
              <div style={{
                padding: '10px 14px', borderBottom: `1px solid ${form.is_private ? '#F6C61340' : C.grisCL}`,
                display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
                background: headerBg, borderRadius: '12px 12px 0 0',
              }}>
                <div style={{ position: 'relative' }} ref={modeRef}>
                  <button
                    onClick={() => setModeOpen(o => !o)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontWeight: 700, color: form.is_private ? '#92650A' : C.grisTF,
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'Lato, sans-serif', fontSize: 13, padding: 0,
                    }}
                  >
                    {form.is_private ? '🔒 Note privée' : '✉️ Réponse publique'}
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
                        onClick={() => { set('is_private', false); setModeOpen(false); }}
                        style={{
                          width: '100%', textAlign: 'left', padding: '10px 14px',
                          background: !form.is_private ? `${TICKETS_COLOR}12` : 'transparent',
                          border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                          fontSize: 13, color: C.grisTF, fontWeight: !form.is_private ? 700 : 400,
                        }}
                      >✉️ Réponse publique</button>
                      <button
                        onClick={() => { set('is_private', true); setModeOpen(false); }}
                        style={{
                          width: '100%', textAlign: 'left', padding: '10px 14px',
                          background: form.is_private ? '#FFF8E1' : 'transparent',
                          border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                          fontSize: 13, color: C.grisTF, fontWeight: form.is_private ? 700 : 400,
                          borderTop: `1px solid ${C.grisCL}`,
                        }}
                      >🔒 Note privée</button>
                    </div>
                  )}
                </div>
                {!form.is_private && form.customer_email && (
                  <>
                    <span style={{ color: C.grisF }}>À</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 8px 3px 10px', background: C.blanc, border: `1px solid ${C.grisCL}`,
                      borderRadius: 99, fontSize: 12, fontWeight: 600, color: C.grisF,
                    }}>{form.customer_email}</span>
                  </>
                )}
              </div>

              {/* Textarea */}
              <textarea
                value={form.body}
                onChange={e => set('body', e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, body: true }))}
                placeholder={form.is_private ? 'Note interne au sujet de ce client…' : 'Premier message envoyé au client…'}
                style={{
                  width: '100%', minHeight: 100, padding: '14px 14px 10px',
                  border: 'none', outline: 'none', resize: 'vertical',
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
              <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.grisCL}` }}>
                <button
                  onClick={() => fileRef.current?.click()}
                  title="Joindre un fichier"
                  style={{
                    width: 32, height: 32, borderRadius: 7, background: 'transparent', border: 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
                  }}
                >
                  <Ic.Attach />
                </button>
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
            </div>

            {touched.body && errors.body && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: '#B71D1D', fontWeight: 600 }}>
                Message requis
              </div>
            )}
            {error && <div style={{ marginTop: 8, fontSize: 12.5, color: '#B71D1D' }}>{error}</div>}

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                onClick={closeNewDraft}
                style={{
                  background: C.blanc, color: C.grisF, border: `1px solid ${C.grisCL}`,
                  borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                }}
              >Annuler</button>

              <div style={{ flex: 1 }} />

              {/* Split-button Envoyer comme [Statut] ▾ */}
              <div style={{ position: 'relative', display: 'inline-flex' }} ref={statusRef}>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    background: sending ? C.grisM : `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
                    color: '#fff', border: 'none', borderRadius: '8px 0 0 8px', padding: '8px 16px',
                    fontSize: 13, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer',
                    fontFamily: 'Lato, sans-serif',
                    boxShadow: sending ? 'none' : `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
                    borderRight: '1px solid rgba(255,255,255,0.25)',
                  }}
                >
                  <Ic.Send /> {sending ? 'Création…' : (
                    <span>Envoyer comme <strong style={{ fontWeight: 800 }}>{currentStatusLabel}</strong></span>
                  )}
                </button>
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
                {statusOpen && (
                  <div style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, zIndex: 200,
                    background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
                    boxShadow: '0 -6px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
                    minWidth: 280, maxHeight: 380, overflowY: 'auto',
                  }}>
                    {statuses.map(s => {
                      const isSel = s.value === form.sav_status;
                      return (
                        <button
                          key={s.value}
                          onClick={() => { set('sav_status', s.value); setStatusOpen(false); }}
                          style={{
                            width: '100%', textAlign: 'left',
                            padding: '10px 14px',
                            background: isSel ? `${TICKETS_COLOR}10` : 'transparent',
                            border: 'none', cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                            fontSize: 13.5, color: C.grisTF, fontWeight: isSel ? 700 : 500,
                            display: 'flex', alignItems: 'center', gap: 10,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                          onMouseLeave={e => e.currentTarget.style.background = isSel ? `${TICKETS_COLOR}10` : 'transparent'}
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
        </section>

        {/* ─── DROITE ─────────────────────────────────────────────────────── */}
        <aside style={{
          width: 360, minWidth: 360, flexShrink: 0,
          background: C.grisTL, borderLeft: `1px solid ${C.grisCL}`,
          height: '100%', overflowY: 'auto', padding: '20px 18px',
        }}>
          {selectedCustomer ? (
            <>
              <CustomerPreview customer={selectedCustomer} />

              {/* Commande liée (si form.order_id correspond à une commande de l'historique) */}
              {(() => {
                const linkedOrder = form.order_id
                  ? customerOrders.find(o => String(o.wp_order_id) === String(form.order_id))
                  : null;
                const historyOrders = linkedOrder
                  ? customerOrders.filter(o => String(o.wp_order_id) !== String(form.order_id))
                  : customerOrders;
                return (
                  <>
                    {linkedOrder && (
                      <div style={{ marginTop: 18 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
                          <span style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Commande concernée
                          </span>
                        </div>
                        <OrderCard
                          order={linkedOrder}
                          highlighted
                          onUnassign={() => set('order_id', '')}
                        />
                      </div>
                    )}

                    {/* Historique commandes */}
                    <div style={{ marginTop: 18 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {linkedOrder ? 'Autres commandes' : 'Historique commandes'}
                        </span>
                        {historyOrders.length > 0 && (
                          <span style={{ fontSize: 11, color: C.grisM, fontWeight: 600 }}>
                            {historyOrders.length} commande{historyOrders.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {loadingOrders ? (
                        <div style={{ padding: 14, textAlign: 'center', color: C.grisM, fontSize: 12.5 }}>Chargement…</div>
                      ) : historyOrders.length === 0 ? (
                        <div style={{
                          background: C.blanc, borderRadius: 10, border: `1px solid ${C.grisCL}`,
                          padding: '14px', textAlign: 'center', color: C.grisM, fontSize: 12.5,
                        }}>
                          {linkedOrder ? 'Aucune autre commande' : 'Aucune commande'}
                        </div>
                      ) : (
                        historyOrders.map(o => (
                          <OrderCard
                            key={o.wp_order_id}
                            order={o}
                            canAssign={!form.order_id}
                            onAssign={(wpOrderId) => set('order_id', String(wpOrderId))}
                          />
                        ))
                      )}
                    </div>
                  </>
                );
              })()}
            </>
          ) : (
            <div style={{
              background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
              padding: '24px 20px', textAlign: 'center', color: C.grisM, fontSize: 13.5,
            }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>👤</div>
              <div style={{ fontWeight: 700, color: C.grisF, marginBottom: 4 }}>Aucun client lié</div>
              <div style={{ fontSize: 12.5 }}>
                Recherchez un client à gauche pour afficher sa fiche.<br />
                Vous pouvez aussi saisir un email manuellement ; si l'email existe en BDD, le client sera lié automatiquement à la création.
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ─── Aperçu fiche client (panneau droit) ──────────────────────────────────────
function CustomerPreview({ customer }) {
  const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || '—';
  const ordersCount = customer.order_count || 0;
  const totalSpent = customer.total_spent ? parseFloat(customer.total_spent).toFixed(2) : '0.00';

  const Meta = ({ label, value }) => (
    <div>
      <div style={{ fontSize: 10.5, color: C.grisM, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.grisTF, fontWeight: 600 }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
      padding: '18px 18px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar name={name} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive", letterSpacing: '-0.2px' }}>
            {name}
          </div>
          <div style={{ fontSize: 12.5, color: C.bleu, marginTop: 2 }}>
            {customer.email || '—'}
          </div>
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px',
        paddingTop: 14, borderTop: `1px solid ${C.grisCL}`,
      }}>
        <Meta label="Commandes" value={
          <span><strong style={{ fontSize: 17, color: TICKETS_COLOR, fontWeight: 800 }}>{ordersCount}</strong>{' '}<span style={{ fontSize: 11, color: C.grisM }}>total</span></span>
        } />
        <Meta label="CA généré" value={
          <span><strong style={{ fontSize: 14, color: C.grisTF, fontWeight: 800 }}>{totalSpent}</strong> €</span>
        } />
      </div>
      {customer.wp_user_id && (
        <a
          href={`/customers/${customer.wp_user_id}`}
          style={{
            display: 'block', textAlign: 'center', marginTop: 12,
            padding: '6px 0', background: 'none', border: `1px solid ${C.grisCL}`,
            borderRadius: 6, fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 600,
            textDecoration: 'none',
          }}
        >Voir fiche client →</a>
      )}
    </div>
  );
}
