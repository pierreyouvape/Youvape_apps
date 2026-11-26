import { Fragment, useMemo, useState } from 'react';
import {
  tachesApi, apiError, ago, todayStr, formatDay, labelChip, inputStyle, btn, M, mTable, mTh, mTd, mCell, ellipsis,
} from './tachesShared';
import {
  ProgressBar, PriorityPill, TaskStatusPill, Avatar, PeoplePicker, DotsMenu, DateRange, InlineText, SortMark, EdgeResizer,
} from './tachesUi';
import { useSort, sortRows, useKeyedWidths } from './tachesColumns';
import { CustomCell, AddColumnButton, DateCell } from './CustomCells';
import StepsTable from './StepsTable';
import CommentsPopup from './CommentsThread';

const th = mTh;
const td = mTd;
const COLLAPSE_KEY = 'yv.taches.collapsed';
const PALETTE = ['#579BFC', '#00C875', '#FDAB3D', '#A25DDC', '#E2445C', '#037F4C', '#784BD1', '#FF158A', '#C4C4C4'];
const shortUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '');

/** Colonnes de base (clés identiques au serveur, tachesModel.BUILTIN_COLUMNS). */
const BUILTIN = {
  id: { label: 'ID', w: 70 },
  title: { label: 'Tâche', w: 380, left: true },
  people: { label: 'Personne', w: 90 },
  link: { label: 'Lien produit', w: 170 },
  progress: { label: 'Sous-éléments', w: 130 },
  labels: { label: 'Étiquettes', w: 160 },
  created: { label: 'Créée le', w: 120 },
  updated: { label: 'Mise à jour', w: 130 },
  priority: { label: 'Priorité', w: 120, full: true },
  status: { label: 'Statut', w: 120, full: true },
  due: { label: 'Échéances', w: 150 },
  start: { label: 'Date début', w: 120 },
  end: { label: 'Date fin', w: 120 },
};
const DEFAULT_LAYOUT = ['id', 'title', 'link', 'progress', 'labels', 'created', 'updated', 'priority', 'status', 'due'];
const CUSTOM_W = { checkbox: 90, people: 110, select: 130, number: 110 };
const STRUCT_W = 34 + 40; // case à cocher + poignée / flèche, toujours juste avant « Tâche »

const loadCollapsed = () => {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
};

/**
 * Tableau principal : les tâches par groupe (comme Monday), dépliables en étapes.
 * Colonnes : disposition du tableau (commune à l'équipe) — glisser un en-tête
 * pour le déplacer, « ⋯ » pour masquer / renommer / supprimer, « + » pour
 * ajouter une colonne (texte, nombre, date, période, lien, personnes, case,
 * liste de choix). Cases à cocher pour archiver / déplacer / supprimer en masse.
 */
export default function TableView({
  tasks, loading, board, boards, members, canWrite, focusUserId, hideEmptyGroups = false,
  onOpen, onTaskChange, onError, onReload, onBoardsChange,
}) {
  const [commentsId, setCommentsId] = useState(null);
  const widths = useKeyedWidths('table');
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [selected, setSelected] = useState(() => new Set());
  const [moveTo, setMoveTo] = useState('');
  const [quick, setQuick] = useState({});
  const today = todayStr();
  const { sort, toggle } = useSort('table');
  // Glisser-déposer des lignes : `drag` = tâche saisie, `over` = { id, before }.
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  // Glisser-déposer des colonnes : clé saisie et position visée.
  const [colDrag, setColDrag] = useState(null);
  const [colOver, setColOver] = useState(null);
  const [hoverCol, setHoverCol] = useState(null);

  const editable = Boolean(board); // « Tous les tableaux » : disposition par défaut, non modifiable
  const layout = board?.layout || DEFAULT_LAYOUT;
  const customCols = useMemo(() => new Map((board?.columns || []).map((c) => [`c${c.id}`, c])), [board]);
  const name = (id) => members.find((m) => m.id === id)?.name || '';

  const defOf = (key) => {
    if (BUILTIN[key]) return { key, ...BUILTIN[key] };
    const c = customCols.get(key);
    return c ? { key, label: c.name, w: CUSTOM_W[c.type] || 150, custom: c, full: c.type === 'select' } : null;
  };
  const columns = layout.map(defOf).filter(Boolean);
  const width = (d) => widths.map[d.key] ?? d.w;
  const totalWidth = STRUCT_W + columns.reduce((a, d) => a + width(d), 0) + (editable ? 44 : 0);
  const span = columns.length + 2 + (editable ? 1 : 0);

  // Tri : valeur comparable de chaque colonne
  const accessor = useMemo(() => {
    const base = {
      title: (t) => t.title,
      id: (t) => t.id,
      people: (t) => t.people.map(name).join(', '),
      link: (t) => t.link_url || '',
      progress: (t) => (t.steps.length ? t.counts.fait / t.steps.length : ''),
      labels: (t) => t.labels.join(', '),
      due: (t) => t.due_date || t.start_date || '',
      start: (t) => t.start_date || '',
      end: (t) => t.due_date || '',
      created: (t) => t.created_at,
      updated: (t) => t.updated_at,
      priority: (t) => (t.priority ? ['critique', 'haute', 'moyenne', 'basse'].indexOf(t.priority) : ''),
      status: (t) => ['a_faire', 'en_cours', 'bloque', 'longue', 'fait'].indexOf(t.status),
    };
    customCols.forEach((c, key) => {
      base[key] = (t) => {
        const v = t.values?.[c.id];
        if (v === undefined || v === null) return '';
        switch (c.type) {
          case 'period': return v.start || '';
          case 'link': return v.text || v.url || '';
          case 'people': return v.map(name).join(', ');
          case 'checkbox': return v ? 1 : '';
          case 'select': return (c.settings?.options || []).findIndex((o) => o.label === v);
          default: return v;
        }
      };
    });
    return base;
  }, [customCols, members]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sections : les groupes du tableau (ou de tous les tableaux), puis « Sans groupe ».
  // Le tri (clic sur un en-tête) s'applique dans chaque groupe, comme sur Monday.
  const sections = useMemo(() => {
    const list = board ? [board] : boards;
    const out = list.flatMap((b) => b.groups.map((g) => ({
      ...g, boardName: board ? null : b.name, tasks: sortRows(tasks.filter((t) => t.group_id === g.id), sort, accessor),
    })));
    const orphans = tasks.filter((t) => !out.some((g) => g.id === t.group_id));
    if (orphans.length) out.push({ id: 'none', name: 'Sans groupe', color: '#C4C4C4', tasks: sortRows(orphans, sort, accessor) });
    return out;
  }, [tasks, board, boards, sort, accessor]);

  const allGroups = boards.flatMap((b) => b.groups.map((g) => ({ ...g, label: boards.length > 1 ? `${b.name} › ${g.name}` : g.name })));
  const toggleSet = (setter, key) => setter((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const toggleCollapse = (gid) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(gid)) n.delete(gid); else n.add(gid);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n]));
    return n;
  });
  // Un groupe « terminé » est replié tant qu'on ne l'a jamais ouvert.
  const isCollapsed = (g) => (collapsed.has(g.id) ? true : collapsed.has(`open:${g.id}`) ? false : /termin/i.test(g.name));
  const flip = (g) => {
    if (/termin/i.test(g.name) && !collapsed.has(g.id)) toggleCollapse(`open:${g.id}`);
    else toggleCollapse(g.id);
  };

  const save = async (t, body) => {
    try { onTaskChange(await tachesApi.updateTask(t.id, body)); } catch (e) { onError(apiError(e)); }
  };
  const saveValue = async (t, c, value) => {
    try { onTaskChange(await tachesApi.setValue(t.id, c.id, value)); } catch (e) { onError(apiError(e)); }
  };
  const bulk = async (action, extra = {}) => {
    const ids = [...selected];
    if (action === 'delete' && !window.confirm(`Supprimer définitivement ${ids.length} tâche(s), leurs étapes et commentaires ?`)) return;
    try {
      await tachesApi.bulk({ ids, action, ...extra });
      setSelected(new Set());
      onReload();
    } catch (e) { onError(apiError(e)); }
  };
  /** Range la tâche saisie avant / après `target` (ou en fin de groupe) et enregistre l'ordre du groupe. */
  const dropOn = async (g, targetId, before) => {
    const moving = drag;
    setDrag(null);
    setOver(null);
    if (!moving || moving.id === targetId || g.id === 'none') return;
    const ids = g.tasks.map((x) => x.id).filter((x) => x !== moving.id);
    let at = targetId ? ids.indexOf(targetId) : ids.length;
    if (targetId && !before) at += 1;
    ids.splice(at < 0 ? ids.length : at, 0, moving.id);
    try {
      await tachesApi.reorderTasks(g.id, ids);
      onReload();
    } catch (e) { onError(apiError(e)); }
  };
  const canDrag = !sort;

  const boardAction = async (fn) => {
    try { onBoardsChange(await fn()); } catch (e) { onError(apiError(e)); }
  };
  const groupAction = boardAction;
  const saveLayout = (next) => boardAction(() => tachesApi.setLayout(board.id, next));
  const moveCol = (key, target, before) => {
    if (key === target) return;
    const next = layout.filter((k) => k !== key);
    let at = next.indexOf(target);
    if (!before) at += 1;
    next.splice(at, 0, key);
    saveLayout(next);
  };
  const shiftCol = (key, dir) => {
    const i = layout.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    saveLayout(next);
  };
  const colMenu = (d) => {
    const c = d.custom;
    return [
      { label: '← Déplacer à gauche', onClick: () => shiftCol(d.key, -1) },
      { label: 'Déplacer à droite →', onClick: () => shiftCol(d.key, 1) },
      { label: '✎ Renommer', hidden: !c, onClick: () => {
        const n = window.prompt('Nom de la colonne', c.name);
        if (n && n.trim()) boardAction(() => tachesApi.updateColumn(c.id, { name: n.trim() }));
      } },
      { label: '▤ Modifier les choix', hidden: c?.type !== 'select', onClick: () => {
        const cur = (c.settings?.options || []).map((o) => o.label).join(', ');
        const n = window.prompt('Choix, séparés par des virgules', cur);
        if (n === null) return;
        const keep = new Map((c.settings?.options || []).map((o) => [o.label, o.color]));
        const options = n.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((label) => ({ label, color: keep.get(label) }));
        boardAction(() => tachesApi.updateColumn(c.id, { settings: { options } }));
      } },
      { label: '🙈 Masquer la colonne', hidden: !!c || d.key === 'title', onClick: () => saveLayout(layout.filter((k) => k !== d.key)) },
      { label: '🗑 Supprimer la colonne', danger: true, hidden: !c || !canWrite, onClick: () => {
        if (window.confirm(`Supprimer la colonne « ${c.name} » et toutes ses valeurs ? C'est définitif.`)) {
          boardAction(() => tachesApi.deleteColumn(c.id)).then(onReload);
        }
      } },
    ];
  };
  const hiddenBuiltins = Object.keys(BUILTIN).filter((k) => k !== 'title' && !layout.includes(k)).map((k) => ({ key: k, label: BUILTIN[k].label }));

  const quickAdd = async (g) => {
    const title = (quick[g.id] || '').trim();
    if (!title) return;
    try {
      await tachesApi.createTask({ title, board_id: g.board_id, group_id: g.id });
      setQuick((s) => ({ ...s, [g.id]: '' }));
      onReload();
    } catch (e) { onError(apiError(e)); }
  };

  /** Cellule d'une colonne pour une tâche. */
  const cell = (d, t, late) => {
    if (d.custom) {
      const c = d.custom;
      return (
        <td key={d.key} style={d.full ? mCell : { ...td, textAlign: c.type === 'text' || c.type === 'link' ? 'left' : 'center' }}>
          <CustomCell column={c} value={t.values?.[c.id]} members={members} onChange={(v) => saveValue(t, c, v)} />
        </td>
      );
    }
    switch (d.key) {
      case 'id': return <td key="id" style={{ ...td, color: M.sub, fontSize: 13 }}>#{t.id}</td>;
      case 'title': return (
        <td key="title" style={{ ...td, textAlign: 'left', cursor: 'pointer' }} title={t.title} onClick={() => onOpen(t.id)}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" style={{
              ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 14, color: M.text, textAlign: 'left', flex: '0 1 auto', minWidth: 0,
            }}>{t.title}</button>
            {t.steps.length > 0 && <span style={{ fontSize: 12, color: M.sub, background: '#E6E9EF', borderRadius: 4, padding: '0 5px', flexShrink: 0 }}>{t.steps.length}</span>}
            {t.archived_at && <span style={{ fontSize: 11, color: '#B45309', fontWeight: 700, flexShrink: 0 }}>ARCHIVÉE</span>}
            <span style={{ flex: 1 }} />
            <button type="button" title="Voir les commentaires" onClick={(e) => { e.stopPropagation(); setCommentsId(t.id); }}
              style={{ background: 'none', border: 'none', padding: '2px 4px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: t.comment_count ? '#0073EA' : '#C3C6D4', flexShrink: 0 }}>💬{t.comment_count ? ` ${t.comment_count}` : ''}</button>
          </span>
        </td>
      );
      case 'people': return <td key="people" style={td}><PeoplePicker title="Personne(s) de la tâche" value={t.people} members={members} onChange={(people) => save(t, { people })} /></td>;
      case 'link': return (
        <td key="link" style={{ ...td, textAlign: 'left' }}>
          {t.link_url && <a href={t.link_url} target="_blank" rel="noreferrer" style={{ ...ellipsis, fontSize: 13, color: '#0073EA' }} title={t.link_url}>{shortUrl(t.link_url)}</a>}
        </td>
      );
      case 'progress': return <td key="progress" style={td}>{t.steps.length > 0 ? <ProgressBar counts={t.counts} width={Math.min(110, width(d) - 16)} /> : ''}</td>;
      case 'labels': return (
        <td key="labels" style={td}>
          <span style={{ display: 'flex', gap: 3, justifyContent: 'center', overflow: 'hidden' }} title={t.labels.join(', ')}>
            {t.labels.map((l) => <span key={l} style={{ ...labelChip, background: '#E6E9EF', color: M.text, fontWeight: 400, borderRadius: 3 }}>{l}</span>)}
          </span>
        </td>
      );
      case 'created': return <td key="created" style={{ ...td, fontSize: 13, color: M.sub }} title={t.created_at}>{formatDay(t.created_at)}</td>;
      case 'updated': return (
        <td key="updated" style={{ ...td, fontSize: 13, color: M.sub }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {t.updated_by && <Avatar id={t.updated_by} name={t.updated_by_name} size={22} />}
            {ago(t.updated_at)}
          </span>
        </td>
      );
      case 'priority': return <td key="priority" style={mCell}><PriorityPill cell priority={t.priority} onChange={(priority) => save(t, { priority })} /></td>;
      case 'status': return (
        <td key="status" style={mCell}>
          <TaskStatusPill cell status={t.status} onChange={t.steps.length ? undefined : (manual_status) => save(t, { manual_status })} />
        </td>
      );
      case 'due': return <td key="due" style={td}><DateRange start={t.start_date} end={t.due_date} late={late} onChange={(b) => save(t, b)} /></td>;
      case 'start': return <td key="start" style={{ ...td, padding: 0 }}><DateCell value={t.start_date} onChange={(v) => save(t, { start_date: v })} /></td>;
      case 'end': return <td key="end" style={{ ...td, padding: 0 }}><DateCell value={t.due_date} late={late} onChange={(v) => save(t, { due_date: v })} /></td>;
      default: return <td key={d.key} style={td} />;
    }
  };

  /** En-tête d'une colonne : tri au clic, glisser pour déplacer, ⋯ pour le reste, bord droit pour la largeur. */
  const header = (d) => (
    <th key={d.key} draggable={editable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.key); setColDrag(d.key); }}
      onDragEnd={() => { setColDrag(null); setColOver(null); }}
      onDragOver={(e) => {
        if (!colDrag) return;
        e.preventDefault();
        const r0 = e.currentTarget.getBoundingClientRect();
        setColOver({ key: d.key, before: e.clientX < r0.left + r0.width / 2 });
      }}
      onDrop={(e) => {
        if (!colDrag) return;
        e.preventDefault();
        moveCol(colDrag, d.key, colOver?.before !== false);
        setColDrag(null);
        setColOver(null);
      }}
      onClick={() => toggle(d.key)}
      onMouseEnter={() => setHoverCol(d.key)}
      onMouseLeave={() => setHoverCol((k) => (k === d.key ? null : k))}
      title={editable ? 'Cliquer pour trier · glisser pour déplacer la colonne' : 'Trier'}
      style={{
        ...th, textAlign: d.left ? 'left' : 'center', cursor: editable ? 'grab' : 'pointer', userSelect: 'none',
        opacity: colDrag === d.key ? 0.4 : 1,
        boxShadow: colOver?.key === d.key ? `inset ${colOver.before ? 3 : -3}px 0 0 #0073EA` : 'none',
      }}>
      {d.label}<SortMark sort={sort} col={d.key} />
      {editable && hoverCol === d.key && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 6, top: 6, background: '#fff' }}>
          <DotsMenu title="Colonne" size={14} items={colMenu(d)} />
        </span>
      )}
      <EdgeResizer width={width(d)} onResize={(w) => widths.set(d.key, w)} onReset={() => widths.reset(d.key)} />
    </th>
  );

  if (loading) return <div style={{ color: '#9CA3AF', padding: 20 }}>Chargement…</div>;

  const titleIdx = columns.findIndex((d) => d.key === 'title');

  return (
    <div>
      {commentsId && <CommentsPopup taskId={commentsId} members={members} onClose={() => setCommentsId(null)} onChanged={onTaskChange} onOpenTask={onOpen} />}
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#1E3A8A', color: '#fff', borderRadius: 10, padding: '8px 12px', marginBottom: 10,
        }}>
          <strong>{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</strong>
          <button type="button" style={btn()} onClick={() => bulk('archive')}>Archiver</button>
          <button type="button" style={btn()} onClick={() => bulk('unarchive')}>Désarchiver</button>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ ...inputStyle, width: 230, padding: '6px 8px' }}>
            <option value="">Déplacer vers…</option>
            {allGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <button type="button" style={btn()} disabled={!moveTo} onClick={() => { bulk('move', { group_id: Number(moveTo) }); setMoveTo(''); }}>Déplacer</button>
          {canWrite && <button type="button" style={{ ...btn(), color: '#B91C1C' }} onClick={() => bulk('delete')}>Supprimer</button>}
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btn(), background: 'transparent', color: '#fff', borderColor: '#93C5FD' }} onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}

      {sections.filter((g) => !hideEmptyGroups || g.tasks.length).map((g) => {
        const shut = isCollapsed(g);
        const ids = g.tasks.map((t) => t.id);
        const allChecked = ids.length > 0 && ids.every((i) => selected.has(i));
        const done = g.tasks.filter((t) => t.status === 'fait').length;
        const structHead = [
          <th key="_sel" style={{ ...th, width: 34 }}>
            <input type="checkbox" checked={allChecked} title="Tout sélectionner"
              onChange={() => setSelected((s) => {
                const n = new Set(s);
                ids.forEach((i) => (allChecked ? n.delete(i) : n.add(i)));
                return n;
              })} />
          </th>,
          <th key="_drag" style={{ ...th, width: 40 }} />,
        ];
        return (
          <div key={g.id} style={{ marginBottom: 22 }}
            onDragOver={(e) => { if (drag && !g.tasks.length) { e.preventDefault(); setOver({ group: g.id }); } }}
            onDrop={(e) => { if (drag && !g.tasks.length) { e.preventDefault(); dropOn(g, null, false); } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button type="button" onClick={() => flip(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: g.color, fontSize: 14 }}>
                {shut ? '▶' : '▼'}
              </button>
              {g.boardName && <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 700 }}>{g.boardName} ›</span>}
              {canWrite && g.id !== 'none' ? (
                <InlineText value={g.name} onSave={(nm) => groupAction(() => tachesApi.updateGroup(g.id, { name: nm }))}
                  style={{ fontSize: 18, fontWeight: 500, color: g.color }} />
              ) : (
                <span style={{ fontSize: 18, fontWeight: 500, color: g.color }}>{g.name}</span>
              )}
              <span style={{ fontSize: 14, color: M.sub }}>{g.tasks.length} tâche{g.tasks.length > 1 ? 's' : ''}{done ? ` · ${done} terminée${done > 1 ? 's' : ''}` : ''}</span>
              {canWrite && g.id !== 'none' && (
                <DotsMenu items={[
                  { label: '↑ Monter le groupe', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { direction: 'up' })) },
                  { label: '↓ Descendre le groupe', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { direction: 'down' })) },
                  { label: '🎨 Changer la couleur', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { color: PALETTE[(PALETTE.indexOf(g.color) + 1) % PALETTE.length] })) },
                  { label: '🗑 Supprimer le groupe', danger: true, onClick: () => {
                    if (window.confirm(`Supprimer le groupe « ${g.name} » ? Ses tâches passent dans un autre groupe du tableau.`)) {
                      groupAction(() => tachesApi.deleteGroup(g.id)).then(onReload);
                    }
                  } },
                ]} />
              )}
            </div>

            {!shut && (
              <div style={{ background: '#fff', borderLeft: `6px solid ${g.color}`, borderRadius: '6px 0 0 6px', overflowX: 'auto', fontFamily: M.font }}>
                <table style={{ ...mTable, width: totalWidth }}>
                  <colgroup>
                    {columns.map((d, i) => (
                      <Fragment key={d.key}>
                        {i === titleIdx && <><col style={{ width: 34 }} /><col style={{ width: 40 }} /></>}
                        <col style={{ width: width(d) }} />
                      </Fragment>
                    ))}
                    {editable && <col style={{ width: 44 }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      {columns.map((d, i) => (
                        <Fragment key={d.key}>
                          {i === titleIdx && structHead}
                          {header(d)}
                        </Fragment>
                      ))}
                      {editable && (
                        <th style={{ ...th, borderRight: 'none', padding: 0 }}>
                          <AddColumnButton hidden={hiddenBuiltins}
                            onShow={(k) => saveLayout([...layout, k])}
                            onCreate={(body) => boardAction(() => tachesApi.createColumn(board.id, body))} />
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {g.tasks.map((t) => {
                      const open = expanded.has(t.id);
                      const late = t.due_date && t.status !== 'fait' && t.due_date < today;
                      const struct = [
                        <td key="_sel" style={{ ...td, padding: 0 }}><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSet(setSelected, t.id)} /></td>,
                        <td key="_drag" style={{ ...td, padding: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', height: 36 }}>
                            <span draggable={canDrag}
                              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); setDrag({ id: t.id, group: g.id }); }}
                              onDragEnd={() => { setDrag(null); setOver(null); }}
                              title={canDrag ? 'Glisser pour déplacer (aussi vers un autre groupe)' : 'Retirez le tri (clic sur l\'en-tête trié) pour réordonner'}
                              style={{ cursor: canDrag ? 'grab' : 'not-allowed', color: '#C3C6D4', fontSize: 13, padding: '0 2px', userSelect: 'none' }}>⠿</span>
                            {t.steps.length > 0 && (
                              <button type="button" onClick={() => toggleSet(setExpanded, t.id)} title={open ? 'Replier' : 'Voir les étapes'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 10, padding: 0, height: 36, flex: 1 }}>{open ? '▼' : '▶'}</button>
                            )}
                          </span>
                        </td>,
                      ];
                      return (
                        <Fragment key={t.id}>
                          <tr
                            onDragOver={(e) => {
                              if (!drag) return;
                              e.preventDefault();
                              const r0 = e.currentTarget.getBoundingClientRect();
                              setOver({ id: t.id, before: e.clientY < r0.top + r0.height / 2 });
                            }}
                            onDrop={(e) => { if (!drag) return; e.preventDefault(); dropOn(g, t.id, over?.before !== false); }}
                            style={{
                              background: selected.has(t.id) ? '#CCE5FF' : open ? M.hover : '#fff',
                              opacity: t.archived_at || drag?.id === t.id ? 0.5 : 1,
                              boxShadow: over?.id === t.id ? `inset 0 ${over.before ? 2 : -2}px 0 #0073EA` : 'none',
                            }}>
                            {columns.map((d, i) => (
                              <Fragment key={d.key}>
                                {i === titleIdx && struct}
                                {cell(d, t, late)}
                              </Fragment>
                            ))}
                            {editable && <td style={{ ...td, borderRight: 'none' }} />}
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={span} style={{ padding: '8px 12px 14px 40px', borderBottom: `1px solid ${M.grid}`, background: M.hover }}>
                                <StepsTable task={t} members={members} onChange={onTaskChange} onError={onError} focusUserId={focusUserId} color={g.color} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {g.id !== 'none' && (
                      <tr>
                        <td colSpan={span} style={{ ...td, textAlign: 'left', paddingLeft: 82, borderRight: 'none' }}>
                          <input value={quick[g.id] || ''} onChange={(e) => setQuick((s) => ({ ...s, [g.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(g); }}
                            placeholder="+ Ajouter tâche"
                            style={{ border: 'none', outline: 'none', width: '100%', fontSize: 14, fontFamily: 'inherit', color: M.text }} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {canWrite && board && (
        <button type="button" style={btn()} onClick={() => {
          const nm = window.prompt('Nom du nouveau groupe ?');
          if (nm) groupAction(() => tachesApi.createGroup(board.id, { name: nm }));
        }}>+ Ajouter un groupe</button>
      )}
      {!tasks.length && <div style={{ color: '#9CA3AF', padding: 10 }}>Aucune tâche ne correspond.</div>}
    </div>
  );
}
