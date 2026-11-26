import { useState } from 'react';
import { M, formatDay, inputStyle, btn } from './tachesShared';
import { Popover, InlineText, PeoplePicker, DateRange } from './tachesUi';

/* Colonnes ajoutées au Tableau : un rendu par type, et le menu « + ». */

const COLUMN_TYPES = [
  { type: 'text', label: 'Texte', icon: 'T' },
  { type: 'number', label: 'Nombre', icon: '#' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'period', label: 'Période (début → fin)', icon: '↔' },
  { type: 'link', label: 'Lien', icon: '🔗' },
  { type: 'people', label: 'Personnes (une ou plusieurs)', icon: '👤' },
  { type: 'checkbox', label: 'Case à cocher', icon: '☑' },
  { type: 'select', label: 'Liste de choix (statut, catégorie…)', icon: '▤' },
];

const shortUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '');
const cellBtn = {
  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: M.text,
  width: '100%', height: 34, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

/** Valeur d'une tâche dans une colonne ajoutée. `onChange(value)` ; null efface. */
export function CustomCell({ column, value, onChange, members }) {
  const [anchor, setAnchor] = useState(null);
  const [draft, setDraft] = useState({});
  const close = () => setAnchor(null);

  switch (column.type) {
    case 'text':
      return <InlineText value={value || ''} placeholder="" onSave={(v) => onChange(v || null)} style={{ display: 'block', width: '100%', minHeight: 20, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />;
    case 'number':
      return (
        <InlineText value={value === undefined || value === null ? '' : String(value).replace('.', ',')} placeholder=""
          onSave={(v) => onChange(v === '' ? null : v)} style={{ display: 'block', width: '100%', minHeight: 20, textAlign: 'right' }} />
      );
    case 'checkbox':
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />;
    case 'people':
      return <PeoplePicker title={column.name} value={Array.isArray(value) ? value : []} members={members} onChange={(ids) => onChange(ids.length ? ids : null)} />;
    case 'period':
      return (
        <DateRange start={value?.start} end={value?.end}
          onChange={(b) => {
            const next = { start: value?.start || null, end: value?.end || null };
            if ('start_date' in b) next.start = b.start_date;
            if ('due_date' in b) next.end = b.due_date;
            onChange(next.start || next.end ? next : null);
          }} />
      );
    case 'date':
      return (
        <>
          <button type="button" style={{ ...cellBtn, color: value ? M.text : '#C3C6D4' }} onClick={(e) => setAnchor(e.currentTarget)}>
            {value ? formatDay(`${value}T12:00:00`) : '—'}
          </button>
          {anchor && (
            <Popover anchor={anchor} onClose={close} width={200}>
              <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input type="date" defaultValue={value || ''} style={{ ...inputStyle, padding: '5px 6px' }}
                  onChange={(e) => { onChange(e.target.value || null); close(); }} />
                {value && <button type="button" style={{ ...btn(), color: '#DF2F4A' }} onClick={() => { onChange(null); close(); }}>Effacer</button>}
              </div>
            </Popover>
          )}
        </>
      );
    case 'link':
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
          {value?.url ? (
            <a href={value.url} target="_blank" rel="noreferrer" title={value.url}
              style={{ flex: 1, minWidth: 0, color: '#0073EA', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
              {value.text || shortUrl(value.url)}
            </a>
          ) : <span style={{ flex: 1 }} />}
          <button type="button" title="Modifier le lien" onClick={(e) => { setDraft({ url: value?.url || '', text: value?.text || '' }); setAnchor(e.currentTarget); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C3C6D4', fontSize: 13, flexShrink: 0 }}>✎</button>
          {anchor && (
            <Popover anchor={anchor} onClose={close} width={280}>
              <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input autoFocus placeholder="https://…" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} style={{ ...inputStyle, padding: '5px 6px' }} />
                <input placeholder="Texte affiché (facultatif)" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} style={{ ...inputStyle, padding: '5px 6px' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={btn(true)} onClick={() => { onChange(draft.url.trim() ? draft : null); close(); }}>Enregistrer</button>
                  {value?.url && <button type="button" style={{ ...btn(), color: '#DF2F4A' }} onClick={() => { onChange(null); close(); }}>Effacer</button>}
                </div>
              </div>
            </Popover>
          )}
        </span>
      );
    case 'select': {
      const options = column.settings?.options || [];
      const opt = options.find((o) => o.label === value);
      return (
        <>
          <button type="button" onClick={(e) => setAnchor(e.currentTarget)} style={{
            border: 'none', width: '100%', height: 36, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            background: opt ? opt.color : '#C4C4C4', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{opt ? opt.label : ''}</button>
          {anchor && (
            <Popover anchor={anchor} onClose={close} width={190}>
              {options.map((o) => (
                <button key={o.label} type="button" onClick={() => { onChange(o.label); close(); }} style={{
                  display: 'block', width: '100%', margin: '3px 0', border: 'none', background: o.color, color: '#fff', padding: '6px 8px',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, opacity: o.label === value ? 0.55 : 1,
                }}>{o.label}</button>
              ))}
              <button type="button" onClick={() => { onChange(null); close(); }}
                style={{ display: 'block', width: '100%', margin: '3px 0', border: '1px dashed #C4C4C4', background: '#fff', color: M.sub, padding: '5px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                Vide
              </button>
              {!options.length && <div style={{ fontSize: 12, color: M.sub, padding: 6 }}>Aucun choix : menu ⋯ de la colonne → « Modifier les choix ».</div>}
            </Popover>
          )}
        </>
      );
    }
    default:
      return null;
  }
}

/**
 * Menu « + » au bout des en-têtes : réafficher une colonne de base masquée, ou
 * créer une colonne d'un type au choix (nom demandé, puis ajoutée à droite).
 */
export function AddColumnButton({ hidden, onShow, onCreate }) {
  const [anchor, setAnchor] = useState(null);
  const [type, setType] = useState(null);
  const [name, setName] = useState('');
  const [choices, setChoices] = useState('');
  const close = () => { setAnchor(null); setType(null); setName(''); setChoices(''); };
  const item = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', background: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', textAlign: 'left', color: M.text,
  };
  return (
    <>
      <button type="button" title="Ajouter une colonne" onClick={(e) => setAnchor(e.currentTarget)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 20, width: '100%', height: 36, lineHeight: 1 }}>+</button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={290}>
          {!type ? (
            <>
              {hidden.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 800, color: M.sub, padding: '4px 8px', textTransform: 'uppercase' }}>Réafficher</div>
                  {hidden.map((h) => (
                    <button key={h.key} type="button" style={item} onClick={() => { onShow(h.key); close(); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = M.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                      ↺ {h.label}
                    </button>
                  ))}
                </>
              )}
              <div style={{ fontSize: 11, fontWeight: 800, color: M.sub, padding: '8px 8px 4px', textTransform: 'uppercase' }}>Nouvelle colonne</div>
              {COLUMN_TYPES.map((t) => (
                <button key={t.type} type="button" style={item} onClick={() => setType(t)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = M.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                  <span style={{ width: 22, textAlign: 'center' }}>{t.icon}</span>{t.label}
                </button>
              ))}
            </>
          ) : (
            <form style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                onCreate({ name: name.trim(), type: type.type, settings: type.type === 'select' ? { options: choices.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) } : {} });
                close();
              }}>
              <div style={{ fontSize: 13, color: M.sub }}>{type.icon} {type.label}</div>
              <input autoFocus placeholder="Nom de la colonne" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, padding: '6px 8px' }} />
              {type.type === 'select' && (
                <textarea rows={3} placeholder="Choix, séparés par des virgules (ex. Site, Instagram, Newsletter)" value={choices}
                  onChange={(e) => setChoices(e.target.value)} style={{ ...inputStyle, padding: '6px 8px', resize: 'vertical' }} />
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" style={btn(true)} disabled={!name.trim()}>Ajouter</button>
                <button type="button" style={btn()} onClick={() => setType(null)}>Retour</button>
              </div>
            </form>
          )}
        </Popover>
      )}
    </>
  );
}
