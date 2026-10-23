import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTableauInbox } from '../../context/TableauInboxContext';
import StickyNote from './StickyNote';
import ImageItem from './ImageItem';
import NoteReminderDialog from './NoteReminderDialog';
import TableauModal from './TableauModal';
import {
  tableauApi, apiError, NOTE_COLORS, noteColor, TABLEAU_COLOR, previewText, imageFilesOf, copyImageToClipboard,
} from './tableauShared';

/** Taille d'affichage maximale d'une image collée (elle se redimensionne ensuite). */
const IMAGE_MAX = 360;

/** Saisie en cours (post-it, champ) : le collage et les touches lui reviennent. */
const isTyping = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Dimensions naturelles d'une image, ramenées à IMAGE_MAX. HEIC illisible ici : format par défaut. */
async function displaySize(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, IMAGE_MAX / Math.max(bmp.width, bmp.height));
    return { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) };
  } catch {
    return { width: 320, height: 240 };
  }
}

const btn = (primary) => ({
  border: 'none', borderRadius: 8, padding: '7px 13px', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
  background: primary ? TABLEAU_COLOR : '#F3F4F6', color: primary ? '#fff' : '#374151',
});

const preview = (html) => previewText(html);

/** Onglet Épinglé : surface libre de post-its et d'images + boîte de réception des envois. */
export default function PinBoard() {
  const { inbox, refresh } = useTableauInbox();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(null); // { note, mode }
  const [selectedId, setSelectedId] = useState(null); // image seule sélectionnée
  const [reminderFor, setReminderFor] = useState(null); // post-it dont on règle le rappel
  const [flashId, setFlashId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const boardRef = useRef(null);
  const pointerRef = useRef(null); // dernière position de la souris sur le tableau

  const load = useCallback(async () => {
    try {
      setNotes(await tableauApi.notes());
      setError(null);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Un envoi refusé ramène le post-it chez l'expéditeur : relire dès que la
  // réponse arrive dans la boîte.
  const answersKey = inbox.answers.map((a) => a.id).join(',');
  useEffect(() => { if (answersKey) load(); }, [answersKey, load]);

  // Rappel arrivé (ou fermé ailleurs) : le cadre rouge du post-it suit
  const remindersKey = inbox.noteReminders.map((r) => r.id).join(',');
  useEffect(() => { load(); }, [remindersKey, load]);

  // « Voir » depuis une notification de rappel : /tableau/epingle?note=ID
  const focusId = Number(searchParams.get('note')) || null;
  useEffect(() => {
    if (!focusId || !notes.some((n) => n.id === focusId)) return undefined;
    document.getElementById(`tableau-note-${focusId}`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    setFlashId(focusId);
    setSearchParams({}, { replace: true });
    const t = setTimeout(() => setFlashId(null), 2600);
    return () => clearTimeout(t);
  }, [focusId, notes, setSearchParams]);

  const patchLocal = (id, patch) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const save = (id, patch) => tableauApi.updateNote(id, patch).catch((e) => setError(apiError(e)));

  const bringToFront = (id) => {
    const ns = notesRef.current;
    const note = ns.find((n) => n.id === id);
    const maxZ = Math.max(0, ...ns.map((n) => n.z));
    if (!note || (note.z === maxZ && ns.filter((n) => n.z === maxZ).length === 1)) return;
    patchLocal(id, { z: maxZ + 1 });
    save(id, { z: maxZ + 1 });
  };

  const addNote = async (color) => {
    const offset = (notes.length % 6) * 28;
    try {
      const note = await tableauApi.createNote({ color, x: 40 + offset, y: 40 + offset });
      setNotes((ns) => [...ns, note]);
    } catch (e) {
      setError(apiError(e));
    }
  };

  const removeNote = async (note) => {
    if (note.kind === 'note' && note.content.trim() && !window.confirm('Supprimer ce post-it ?')) return;
    try {
      await tableauApi.deleteNote(note.id);
      setNotes((ns) => ns.filter((n) => n.id !== note.id));
    } catch (e) {
      setError(apiError(e));
    }
  };

  // Image collée sur le tableau : posée là où est la souris (sinon en haut à gauche)
  const addImages = async (files) => {
    let { x, y } = pointerRef.current || { x: 40 + (notes.length % 6) * 28, y: 40 + (notes.length % 6) * 28 };
    for (const file of files) {
      try {
        const size = await displaySize(file);
        const item = await tableauApi.createImage(file, { x, y, ...size });
        setNotes((ns) => [...ns, item]);
        setSelectedId(item.id);
        x += 24;
        y += 24;
      } catch (e) {
        setError(apiError(e));
      }
    }
  };
  const addImagesRef = useRef(addImages);
  addImagesRef.current = addImages;

  const selectedRef = useRef(null);
  selectedRef.current = notes.find((n) => n.id === selectedId && n.kind === 'image') || null;

  useEffect(() => {
    // Cmd+V hors d'un post-it : l'image se pose seule sur le tableau
    const onPaste = (e) => {
      if (isTyping(document.activeElement)) return;
      const files = imageFilesOf(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      addImagesRef.current(files);
    };
    // Image sélectionnée : Cmd+C la copie, Suppr l'efface, Échap la désélectionne
    const onKey = (e) => {
      const item = selectedRef.current;
      if (!item || isTyping(document.activeElement)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        copyImageToClipboard(item.image_url).catch((err) => setError(apiError(err)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeRef.current(item);
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const removeRef = useRef(removeNote);
  removeRef.current = removeNote;

  const trackPointer = (e) => {
    const r = boardRef.current?.getBoundingClientRect();
    if (r) pointerRef.current = { x: Math.max(0, Math.round(e.clientX - r.left)), y: Math.max(0, Math.round(e.clientY - r.top)) };
  };

  // Action de la boîte : on relit le tableau ET la boîte (pastilles, toasts)
  const act = (fn) => async () => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
    load();
    refresh();
  };

  // La surface grandit avec les post-its les plus éloignés
  const boardWidth = Math.max(0, ...notes.map((n) => n.x + n.width)) + 40;
  const boardHeight = Math.max(560, ...notes.map((n) => n.y + n.height + 80));

  return (
    <div>
      <style>{`
        @keyframes tableauFlash { 0%, 100% { transform: scale(1); } 25%, 75% { transform: scale(1.04); } 50% { transform: scale(0.98); } }
        .tableau-flash { animation: tableauFlash 0.65s ease-in-out 3; }
      `}</style>
      <InboxPanel inbox={inbox} act={act} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Nouveau post-it :</span>
        {Object.entries(NOTE_COLORS).map(([key, col]) => (
          <button
            key={key}
            onClick={() => addNote(key)}
            title={`Post-it ${key}`}
            style={{
              width: 30, height: 30, borderRadius: 7, background: col.bar, color: col.ink,
              border: '1px solid rgba(0,0,0,0.10)', cursor: 'pointer', fontSize: 18, fontWeight: 800, lineHeight: 1,
            }}
          >
            +
          </button>
        ))}
        <span style={{ fontSize: 12.5, color: '#8A99A4' }}>
          Cmd+V sur le tableau pour y coller une image, ou dans un post-it pour l'ajouter à son texte.
        </span>
        {error && <span style={{ fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>{error}</span>}
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #E5E7EB' }}>
        <div
          ref={boardRef}
          onPointerMove={trackPointer}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
          style={{
          position: 'relative', minWidth: '100%', width: boardWidth, height: boardHeight,
          backgroundColor: '#FBFAF7',
          backgroundImage: 'radial-gradient(#E3DED3 1px, transparent 1px)', backgroundSize: '22px 22px',
        }}>
          {!loading && notes.length === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#9CA3AF', fontSize: 14, pointerEvents: 'none',
            }}>
              Aucun post-it. Choisissez une couleur ci-dessus pour en créer un.
            </div>
          )}
          {notes.map((n) => (n.kind === 'image' ? (
            <ImageItem
              key={n.id}
              item={n}
              selected={selectedId === n.id}
              onSelect={() => { setSelectedId(n.id); bringToFront(n.id); }}
              onLocalChange={(patch) => patchLocal(n.id, patch)}
              onSave={(patch) => { patchLocal(n.id, patch); save(n.id, patch); }}
              onDelete={() => { removeNote(n); setSelectedId(null); }}
              onError={setError}
            />
          ) : (
            <StickyNote
              key={n.id}
              note={n}
              onLocalChange={(patch) => patchLocal(n.id, patch)}
              onSave={(patch) => { patchLocal(n.id, patch); save(n.id, patch); }}
              onFront={() => { bringToFront(n.id); setSelectedId(null); }}
              onColor={(color) => { patchLocal(n.id, { color }); save(n.id, { color }); }}
              onDelete={() => removeNote(n)}
              onSend={(mode) => setSending({ note: n, mode })}
              onReminder={() => setReminderFor(n)}
              flash={flashId === n.id}
              onError={setError}
            />
          )))}
        </div>
      </div>

      {reminderFor && (
        <NoteReminderDialog
          note={notes.find((n) => n.id === reminderFor.id) || reminderFor}
          onClose={() => setReminderFor(null)}
          onSaved={(note) => { setReminderFor(null); setNotes((ns) => ns.map((n) => (n.id === note.id ? note : n))); refresh(); }}
        />
      )}

      {sending && (
        <SendDialog
          note={sending.note}
          mode={sending.mode}
          onClose={() => setSending(null)}
          onSent={() => { setSending(null); load(); refresh(); }}
        />
      )}
    </div>
  );
}

/* ─── Envoi ─────────────────────────────────────────────── */

function SendDialog({ note, mode, onClose, onSent }) {
  const [recipients, setRecipients] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    tableauApi.recipients().then(setRecipients).catch((e) => setError(apiError(e)));
  }, []);

  const send = async (userId) => {
    setBusy(true);
    try {
      await tableauApi.send(note.id, userId, mode);
      onSent();
    } catch (e) {
      setError(apiError(e));
      setBusy(false);
    }
  };

  return (
    <TableauModal title={mode === 'copy' ? 'Envoyer une copie à…' : 'Envoyer à…'} onClose={onClose}>
      <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 14px' }}>
        {mode === 'copy'
          ? 'Une copie lui est proposée ; votre post-it reste ici.'
          : 'Le post-it quitte votre tableau. S\'il le refuse, il revient à sa place et vous êtes prévenu.'}
      </p>
      <div style={{
        background: noteColor(note.color).bg, color: noteColor(note.color).ink, borderRadius: 8,
        padding: '10px 12px', fontSize: 13, marginBottom: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {preview(note.content)}
      </div>
      {recipients === null && !error && <div style={{ fontSize: 13, color: '#9CA3AF' }}>Chargement…</div>}
      {recipients?.length === 0 && (
        <div style={{ fontSize: 13, color: '#6B7280' }}>
          Personne d'autre n'a encore accès à l'app Tableau (droit à cocher dans Réglages).
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {recipients?.map((r) => (
          <button
            key={r.id}
            disabled={busy}
            onClick={() => send(r.id)}
            style={{
              ...btn(false), textAlign: 'left', padding: '10px 14px', fontSize: 14,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {r.name}
          </button>
        ))}
      </div>
      {error && <div style={{ fontSize: 13, color: '#B91C1C', marginTop: 10 }}>{error}</div>}
    </TableauModal>
  );
}

/* ─── Boîte de réception ────────────────────────────────── */

function InboxCard({ color, title, body, children }) {
  const c = color ? noteColor(color) : null;
  return (
    <div style={{
      width: 260, background: '#fff', borderRadius: 10, overflow: 'hidden',
      border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 800, color: '#1F2937', borderBottom: '1px solid #F3F4F6' }}>
        {title}
      </div>
      <div style={{
        background: c ? c.bg : '#F9FAFB', color: c ? c.ink : '#374151', padding: '8px 12px',
        fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1,
      }}>
        {body}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

function InboxPanel({ inbox, act }) {
  const { incoming, answers, sent } = inbox;
  if (!incoming.length && !answers.length && !sent.length) return null;

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
      {incoming.map((t) => (
        <InboxCard
          key={`in-${t.id}`}
          color={t.color}
          title={`${t.from_name} vous envoie ${t.mode === 'copy' ? 'une copie' : 'un post-it'}`}
          body={preview(t.content)}
        >
          <button style={btn(false)} onClick={act(() => tableauApi.refuse(t.id))}>Refuser</button>
          <button style={btn(true)} onClick={act(() => tableauApi.accept(t.id))}>Accepter</button>
        </InboxCard>
      ))}
      {answers.map((t) => (
        <InboxCard
          key={`ans-${t.id}`}
          color={t.color}
          title={`${t.to_name} a ${t.status === 'accepted' ? 'accepté' : 'refusé'} votre ${t.mode === 'copy' ? 'copie' : 'post-it'}`}
          body={t.status === 'refused' && t.mode === 'move'
            ? `Revenu sur votre tableau.\n${preview(t.content)}`
            : preview(t.content)}
        >
          <button style={btn(true)} onClick={act(() => tableauApi.seen(t.id))}>OK</button>
        </InboxCard>
      ))}
      {sent.map((t) => (
        <InboxCard
          key={`sent-${t.id}`}
          color={t.color}
          title={`En attente chez ${t.to_name}${t.mode === 'copy' ? ' (copie)' : ''}`}
          body={preview(t.content)}
        >
          <button style={btn(false)} onClick={act(() => tableauApi.cancel(t.id))}>Annuler l'envoi</button>
        </InboxCard>
      ))}
    </div>
  );
}
