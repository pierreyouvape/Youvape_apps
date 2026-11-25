import { useState } from 'react';
import { formatDateTime } from './tachesShared';

/** Met en gras le mot cherché (sans tenir compte des accents ni de la casse). */
function Highlight({ text, q }) {
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = String(text || '');
  const i = fold(t).indexOf(fold(q.trim()));
  if (i < 0 || !q.trim()) return t;
  const n = q.trim().length;
  return <>{t.slice(0, i)}<mark style={{ background: '#FEF08A', padding: 0 }}>{t.slice(i, i + n)}</mark>{t.slice(i + n)}</>;
}

/**
 * Où le mot a été trouvé : une ligne par tâche, avec chaque endroit (titre,
 * étape, note, commentaire…) et son extrait. Les tâches d'autres tableaux et
 * les archives sont listées aussi (la vue, elle, reste filtrée sur le tableau).
 */
export default function SearchResults({ hits, q, boardId, onOpen }) {
  const [open, setOpen] = useState(true);
  const byTask = new Map();
  hits.forEach((h) => {
    if (!byTask.has(h.task_id)) byTask.set(h.task_id, { ...h, places: [] });
    byTask.get(h.task_id).places.push(h);
  });
  const list = [...byTask.values()];
  const elsewhere = list.filter((t) => t.archived || (boardId !== 'all' && String(t.board_id) !== String(boardId))).length;

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, marginBottom: 12 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{
        width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        padding: '10px 14px', fontSize: 14, fontWeight: 700, color: '#1F2937',
      }}>
        {open ? '▾' : '▸'} « {q.trim()} » trouvé dans {list.length} tâche{list.length > 1 ? 's' : ''}
        {elsewhere > 0 && <span style={{ fontWeight: 500, color: '#6B7280' }}> (dont {elsewhere} dans un autre tableau ou archivée{elsewhere > 1 ? 's' : ''})</span>}
        {hits.length >= 300 && <span style={{ fontWeight: 500, color: '#B45309' }}> — 300 premiers résultats, précisez la recherche</span>}
      </button>
      {open && list.length > 0 && (
        <div style={{ maxHeight: 280, overflowY: 'auto', borderTop: '1px solid #EEF0F3' }}>
          {list.map((t) => (
            <button key={t.task_id} type="button" onClick={() => onOpen(t.task_id)} style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #F3F4F6',
              cursor: 'pointer', fontFamily: 'inherit', padding: '8px 14px',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1F2937' }}>
                <Highlight text={t.title} q={q} />
                <span style={{ fontSize: 12, fontWeight: 500, color: '#9CA3AF' }}> · {t.board_name}{t.archived ? ' · archivée' : ''}</span>
              </div>
              {t.places.filter((p) => p.field !== 'titre').slice(0, 3).map((p, i) => (
                <div key={i} style={{ fontSize: 13, color: '#4B5563', marginTop: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#6B7280', textTransform: 'uppercase', marginRight: 6 }}>
                    {p.field}{p.by ? ` de ${p.by}` : ''}{p.at ? ` · ${formatDateTime(p.at)}` : ''}
                  </span>
                  <Highlight text={p.snippet} q={q} />
                </div>
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
