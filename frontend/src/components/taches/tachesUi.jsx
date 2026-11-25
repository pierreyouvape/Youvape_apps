import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  STEP_STATUS, STEP_STATUS_ORDER, PRIORITY, PRIORITY_ORDER, TASK_STATUS, TASK_STATUS_ORDER, avatarColor, initials, labelChip,
} from './tachesShared';

/* Petites briques d'écran de l'app Tâches (pastilles, avatars, menus). */

/** Menu flottant ancré sous un élément, en position fixe (pas coupé par un tableau qui défile). */
export function Popover({ anchor, onClose, children, width = 200 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    setPos(below > 260 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  return (
    <div ref={ref} data-taches-popover style={{
      position: 'fixed', ...pos, width, zIndex: 3500, background: '#fff', borderRadius: 10,
      boxShadow: '0 10px 30px rgba(15,23,42,0.18)', border: '1px solid #E5E7EB', padding: 6,
      maxHeight: 320, overflowY: 'auto',
    }}>
      {children}
    </div>
  );
}

/**
 * Cellule de couleur pleine, façon Monday (statut, priorité) : occupe toute la
 * case du tableau, sans arrondi. La pastille arrondie reste pour les menus.
 */
const cellStyle = (bg, ink = '#fff') => ({
  background: bg, color: ink, border: 'none', borderRadius: 0, width: '100%', height: 36, padding: '0 6px',
  fontSize: 13, fontWeight: 400, fontFamily: 'inherit', textAlign: 'center', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
});

const pillStyle = (bg, ink = '#fff') => ({
  background: bg, color: ink, border: 'none', borderRadius: 4, padding: '6px 10px', minWidth: 96,
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit', textAlign: 'center', whiteSpace: 'nowrap',
});

const menuItem = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 'none',
  background: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
};

/** Pastille de statut d'étape, cliquable pour changer. */
export function StepStatusPill({ status, onChange, disabled, cell = false }) {
  const [anchor, setAnchor] = useState(null);
  const s = STEP_STATUS[status] || STEP_STATUS.a_faire;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        style={{ ...(cell ? cellStyle(s.bg, s.ink) : pillStyle(s.bg, s.ink)), cursor: disabled ? 'default' : 'pointer', width: '100%' }}
      >
        {s.label}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={190}>
          {STEP_STATUS_ORDER.map((k) => (
            <button key={k} type="button" style={{ ...menuItem, padding: 3 }}
              onClick={() => { setAnchor(null); if (k !== status) onChange(k); }}>
              <span style={{ ...pillStyle(STEP_STATUS[k].bg), width: '100%', opacity: k === status ? 0.55 : 1 }}>
                {STEP_STATUS[k].label}
              </span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/**
 * Statut d'une tâche. Avec `onChange` (tâche sans étape) : cliquable.
 * Sans : calculé depuis les étapes, en lecture seule.
 */
export function TaskStatusPill({ status, onChange, cell = false }) {
  const [anchor, setAnchor] = useState(null);
  const s = TASK_STATUS[status] || TASK_STATUS.a_faire;
  return (
    <>
      <button type="button" disabled={!onChange}
        title={onChange ? 'Changer le statut' : 'Calculé à partir des étapes'}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        style={{ ...(cell ? cellStyle(s.bg) : pillStyle(s.bg)), cursor: onChange ? 'pointer' : 'default' }}>
        {s.label}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={160}>
          {TASK_STATUS_ORDER.map((k) => (
            <button key={k} type="button" style={{ ...menuItem, padding: 3 }}
              onClick={() => { setAnchor(null); if (k !== status) onChange(k); }}>
              <span style={{ ...pillStyle(TASK_STATUS[k].bg), width: '100%', opacity: k === status ? 0.55 : 1 }}>
                {TASK_STATUS[k].label}
              </span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Menu « ⋯ » : [{ label, onClick, danger, hidden }]. */
export function DotsMenu({ items, title = 'Actions', size = 16 }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <button type="button" title={title} onClick={(e) => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: size, padding: '2px 6px', borderRadius: 6, lineHeight: 1 }}>
        ⋯
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={210}>
          {items.filter((i) => !i.hidden).map((i) => (
            <button key={i.label} type="button" style={{ ...menuItem, color: i.danger ? '#B91C1C' : '#374151', fontWeight: 600 }}
              onClick={() => { setAnchor(null); i.onClick(); }}>
              {i.label}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Étiquettes multiples : pastilles retirables + champ (Entrée pour ajouter). */
export function LabelsInput({ value = [], suggestions = [], onChange, compact = false }) {
  const [draft, setDraft] = useState('');
  const add = (v) => {
    const l = v.trim();
    if (l && !value.includes(l)) onChange([...value, l]);
    setDraft('');
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', border: compact ? 'none' : '1px solid #E5E7EB', borderRadius: 6, padding: compact ? 0 : '4px 6px' }}>
      {value.map((l) => (
        <span key={l} style={{ ...labelChip, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {l}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== l))} title="Retirer"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
        </span>
      ))}
      <input list="taches-labels-all" value={draft} placeholder={value.length ? '' : 'Ajouter une étiquette…'}
        onChange={(e) => {
          // Choisir une suggestion de la liste l'ajoute directement.
          if (suggestions.includes(e.target.value) && e.nativeEvent?.inputType !== 'insertText') add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        onBlur={() => { if (draft.trim()) add(draft); }}
        style={{ border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 13, minWidth: 110, flex: 1, padding: '3px 0' }} />
      <datalist id="taches-labels-all">{suggestions.filter((l) => !value.includes(l)).map((l) => <option key={l} value={l} />)}</datalist>
    </div>
  );
}

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dm = (d) => ({ d: Number(d.slice(8)), m: MONTHS_SHORT[Number(d.slice(5, 7)) - 1], y: d.slice(0, 4) });
/** « 12 - 15 nov. », « 28 oct. - 3 nov. », « 15 nov. » */
function rangeLabel(start, end) {
  const s = start || end;
  const e = end || start;
  if (!s) return '';
  const a = dm(s);
  const b = dm(e);
  const year = a.y !== String(new Date().getFullYear()) || b.y !== a.y ? ` ${b.y}` : '';
  if (s === e) return `${a.d} ${a.m}${year}`;
  return a.m === b.m && a.y === b.y ? `${a.d} - ${b.d} ${b.m}${year}` : `${a.d} ${a.m} - ${b.d} ${b.m}${year}`;
}

/**
 * Période façon colonne « Timeline » de Monday : pastille sombre avec la part
 * déjà écoulée en bleu, rouge si l'échéance est passée. Clic = début / fin.
 */
export function DateRange({ start, end, onChange, late = false }) {
  const [anchor, setAnchor] = useState(null);
  const s = start || end;
  const e = end || start;
  let pct = 0;
  if (s) {
    const t0 = new Date(`${s}T00:00:00`).getTime();
    const t1 = new Date(`${e}T23:59:59`).getTime();
    pct = Math.max(0, Math.min(100, ((Date.now() - t0) / Math.max(1, t1 - t0)) * 100));
  }
  const bg = !s ? '#E6E9EF' : late ? '#DF2F4A' : `linear-gradient(90deg, #579BFC ${pct}%, #333333 ${pct}%)`;
  const input = { border: '1px solid #D0D4E4', borderRadius: 6, padding: '5px 6px', fontFamily: 'inherit', fontSize: 13, width: '100%' };
  return (
    <>
      <button type="button" onClick={(ev) => setAnchor(anchor ? null : ev.currentTarget)} title={s ? `${s} → ${e}` : 'Choisir des dates'}
        style={{
          background: bg, color: s ? '#fff' : '#9699A6', border: 'none', borderRadius: 12, height: 24, minWidth: 110, maxWidth: '100%',
          padding: '0 10px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
        {s ? rangeLabel(start, end) : '—'}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={230}>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#676879' }}>Début
              <input type="date" value={start || ''} style={input} onChange={(ev) => onChange({ start_date: ev.target.value || null })} />
            </label>
            <label style={{ fontSize: 12, color: '#676879' }}>Fin
              <input type="date" value={end || ''} style={input} onChange={(ev) => onChange({ due_date: ev.target.value || null })} />
            </label>
            {s && (
              <button type="button" onClick={() => { setAnchor(null); onChange({ start_date: null, due_date: null }); }}
                style={{ background: 'none', border: 'none', color: '#DF2F4A', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textAlign: 'left', padding: '2px 0' }}>
                Effacer les dates
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

export function PriorityPill({ priority, onChange, cell = false }) {
  const [anchor, setAnchor] = useState(null);
  const p = PRIORITY[priority];
  let style = p ? pillStyle(p.bg) : { ...pillStyle('#F3F4F6', '#9CA3AF'), fontWeight: 600 };
  if (cell) style = p ? cellStyle(p.bg) : cellStyle('#C4C4C4');
  return (
    <>
      <button type="button" disabled={!onChange}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        style={{ ...style, cursor: onChange ? 'pointer' : 'default' }}>
        {p ? p.label : (cell ? '' : '—')}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={150}>
          {[...PRIORITY_ORDER, null].map((k) => (
            <button key={k || 'none'} type="button" style={{ ...menuItem, padding: 3 }}
              onClick={() => { setAnchor(null); onChange(k); }}>
              <span style={{ ...(k ? pillStyle(PRIORITY[k].bg) : pillStyle('#F3F4F6', '#6B7280')), width: '100%' }}>
                {k ? PRIORITY[k].label : 'Aucune'}
              </span>
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

export function Avatar({ id, name, size = 28, title }) {
  return (
    <span title={title || name} style={{
      width: size, height: size, borderRadius: '50%', background: avatarColor(id), color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      fontSize: Math.round(size * 0.4), fontWeight: 800, border: '2px solid #fff',
    }}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ ids, members, size = 28, emptyLabel = '' }) {
  const byId = new Map(members.map((m) => [m.id, m]));
  if (!ids?.length) {
    return (
      <span style={{
        width: size, height: size, borderRadius: '50%', border: '1.5px dashed #CBD5E1', color: '#CBD5E1',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
      }} title={emptyLabel}>+</span>
    );
  }
  return (
    <span style={{ display: 'inline-flex' }}>
      {ids.map((id, i) => (
        <span key={id} style={{ marginLeft: i ? -8 : 0 }}>
          <Avatar id={id} name={byId.get(id)?.name || '?'} size={size} />
        </span>
      ))}
    </span>
  );
}

/** Choix de plusieurs personnes (avatars, menu à cases). */
export function PeoplePicker({ value = [], members, onChange, title }) {
  const [anchor, setAnchor] = useState(null);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <>
      <button type="button" title={title}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
        <AvatarStack ids={value} members={members} emptyLabel={title} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={210}>
          {title && <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', padding: '4px 8px', textTransform: 'uppercase' }}>{title}</div>}
          {members.map((m) => (
            <label key={m.id} style={{ ...menuItem, cursor: 'pointer' }}>
              <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} />
              <Avatar id={m.id} name={m.name} size={22} />
              <span style={{ fontWeight: 600, color: '#374151' }}>{m.name}</span>
            </label>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Barre de progression façon Monday : une part par statut d'étape. */
export function ProgressBar({ counts, width = 130 }) {
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  if (!total) return <span style={{ display: 'inline-block', width, height: 22, background: '#F3F4F6', borderRadius: 3 }} />;
  const done = counts.fait || 0;
  return (
    <span title={`${done} / ${total} étapes faites`} style={{ display: 'inline-flex', width, height: 22, borderRadius: 3, overflow: 'hidden' }}>
      {['fait', 'en_cours', 'attente_correction', 'suivi_google', 'a_faire', 'bloque'].map((k) => (counts[k] ? (
        <span key={k} style={{ flex: counts[k], background: STEP_STATUS[k].bg }} />
      ) : null))}
    </span>
  );
}

/** Texte modifiable en place : clic pour éditer, Entrée / sortie du champ pour enregistrer. */
export function InlineText({ value, onSave, placeholder, style, multiline = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if ((draft || '').trim() !== (value || '').trim()) onSave(draft.trim());
  };
  if (!editing) {
    return (
      <span onClick={() => setEditing(true)} title="Cliquer pour modifier"
        style={{ cursor: 'text', minHeight: 20, display: 'inline-block', ...style, color: value ? style?.color : '#9CA3AF' }}>
        {value || placeholder}
      </span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag autoFocus value={draft} rows={multiline ? 4 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
      }}
      style={{
        width: '100%', font: 'inherit', ...style, border: '1px solid #93C5FD', borderRadius: 6,
        padding: '4px 6px', outline: 'none', resize: multiline ? 'vertical' : undefined,
      }} />
  );
}
