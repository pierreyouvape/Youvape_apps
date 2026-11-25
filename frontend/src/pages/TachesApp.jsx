import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { tachesApi, apiError, TACHES_COLOR, inputStyle } from '../components/taches/tachesShared';
import MineTab from '../components/taches/MineTab';
import TableView from '../components/taches/TableView';
import KanbanView from '../components/taches/KanbanView';
import GanttView from '../components/taches/GanttView';
import CalendarView from '../components/taches/CalendarView';
import TemplatesTab from '../components/taches/TemplatesTab';
import SlackTab from '../components/taches/SlackTab';
import TaskModal from '../components/taches/TaskModal';
import NewTaskModal from '../components/taches/NewTaskModal';
import SearchResults from '../components/taches/SearchResults';

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'taches';

const TABS = [
  { key: 'moi', label: 'Mes tâches', subtitle: 'Ce que vous avez à faire, avec les étapes avant et après.' },
  { key: 'tableau', label: 'Tableau', subtitle: 'Toutes les tâches, par groupe.', view: true },
  { key: 'kanban', label: 'Kanban', subtitle: 'Glisser une carte d\'une colonne à l\'autre la modifie.', view: true },
  { key: 'gantt', label: 'Gantt', subtitle: 'Planning : glisser une barre la déplace, tirer son bord droit l\'allonge.', view: true },
  { key: 'calendrier', label: 'Calendrier', subtitle: 'Échéances du mois : glisser une tâche sur un autre jour la décale.', view: true },
  { key: 'modeles', label: 'Modèles', subtitle: 'Les enchaînements d\'étapes types, recopiés à la création.' },
  { key: 'slack', label: 'Slack', subtitle: 'Notifications dans #notifications-taches.', admin: true },
];
const BOARD_KEY = 'yv.taches.board';

/**
 * App Tâches — remplace Monday + Make.
 * /taches/:tab, et /taches/tache/:id (lien des messages Slack) qui ouvre la
 * tâche par-dessus le Tableau.
 *
 * Les vues (Tableau, Kanban, Gantt, Calendrier) partagent les mêmes données et
 * les mêmes filtres : chargés ici, une fois.
 */
export default function TachesApp() {
  const { tab, id } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin, isAdmin, user } = useContext(AuthContext);
  const canRead = useMemo(() => isSuperAdmin || permissions?.[PERM_KEY]?.read === true, [isSuperAdmin, permissions]);
  const canWrite = isSuperAdmin || permissions?.[PERM_KEY]?.write === true;

  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(() => localStorage.getItem(BOARD_KEY) || '');
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(id ? Number(id) : null);
  const [creating, setCreating] = useState(null); // null | { group_id?, start_date?, due_date? }
  const [reloadKey, setReloadKey] = useState(0);

  // Filtres communs aux vues
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [person, setPerson] = useState(null);
  const [openOnly, setOpenOnly] = useState(false);
  const [label, setLabel] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [archived, setArchived] = useState(false);

  const currentTab = id ? 'tableau' : tab;
  const tabDef = TABS.find((t) => t.key === currentTab);
  const isView = Boolean(tabDef?.view);

  const loadRefs = useCallback(async () => {
    try {
      const [m, l, t, b] = await Promise.all([tachesApi.members(), tachesApi.labels(), tachesApi.templates(), tachesApi.boards()]);
      setMembers(m);
      setLabels(l);
      setTemplates(t);
      setBoards(b);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);
  useEffect(() => { if (canRead) loadRefs(); }, [canRead, loadRefs]);
  useEffect(() => { if (id) setOpenId(Number(id)); }, [id]);

  // Tableau retenu d'une visite à l'autre ; à défaut le premier.
  const board = boards.find((b) => String(b.id) === String(boardId)) || null;
  useEffect(() => {
    if (boards.length && boardId !== 'all' && !board) setBoardId(String(boards[0].id));
  }, [boards, boardId, board]);
  useEffect(() => { if (boardId) localStorage.setItem(BOARD_KEY, boardId); }, [boardId]);

  const loadTasks = useCallback(async () => {
    if (!boardId) return;
    try {
      setTasks(await tachesApi.board({ board: boardId === 'all' ? undefined : boardId, archived: archived ? 1 : 0 }));
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, [boardId, archived]);
  useEffect(() => { if (canRead && isView) loadTasks(); }, [canRead, isView, loadTasks, reloadKey]);
  useEffect(() => {
    if (!isView) return undefined;
    const onFocus = () => loadTasks();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(loadTasks, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [isView, loadTasks]);

  // Recherche plein texte (titres, étapes, notes, commentaires…), côté serveur.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return undefined; }
    const timer = setTimeout(() => {
      tachesApi.search(term).then(setHits).catch((e) => setError(apiError(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, reloadKey]);

  const filtered = useMemo(() => {
    if (!tasks) return null;
    const ids = hits ? new Set(hits.map((h) => h.task_id)) : null;
    return tasks.filter((t) => {
      if (ids && !ids.has(t.id)) return false;
      if (label && !t.labels.includes(label)) return false;
      if (hideDone && t.status === 'fait') return false;
      if (person) {
        const steps = t.steps.filter((s) => s.owners.includes(person));
        const own = t.people.includes(person);
        if (!steps.length && !own) return false;
        if (openOnly) {
          const stepOpen = steps.some((s) => s.status !== 'fait' && s.status !== 'bloque');
          const taskOpen = own && !t.steps.length && t.status !== 'fait';
          if (!stepOpen && !taskOpen) return false;
        }
      }
      return true;
    });
  }, [tasks, hits, label, hideDone, person, openOnly]);

  if (permissions && !canRead) {
    return (
      <AppShell currentPath="/taches">
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: '#6B7280' }}>
          Vous n'avez pas accès aux Tâches. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }
  const visibleTabs = TABS.filter((t) => !t.admin || isAdmin || isSuperAdmin);
  if (!tabDef || !visibleTabs.includes(tabDef)) return <Navigate to="/taches/moi" replace />;

  const closeTask = () => {
    setOpenId(null);
    if (id) navigate('/taches/tableau', { replace: true });
  };
  const changed = () => {
    setReloadKey((k) => k + 1);
    tachesApi.labels().then(setLabels).catch(() => {});
  };
  const replaceTask = (t) => setTasks((list) => (list ? list.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : list));
  const refreshBoards = (b) => setBoards(b);

  const viewProps = {
    tasks: filtered || [], loading: filtered === null, board, boards, members, labels, canWrite,
    focusUserId: person, onOpen: setOpenId, onTaskChange: replaceTask, onError: setError,
    onReload: changed, onBoardsChange: refreshBoards,
    onNew: (preset = {}) => setCreating(preset),
  };

  return (
    <AppShell currentPath={`/taches/${currentTab}`}>
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: '#F2F6F8' }}>
        <div style={{ padding: '22px 28px 40px', margin: '0 auto', maxWidth: isView ? 'none' : 1200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ width: 10, height: 34, borderRadius: 5, background: TACHES_COLOR, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: TACHES_COLOR, margin: 0 }}>
                Tâches{isView && board ? <span style={{ color: '#1F2937' }}> · {board.name}</span> : ''}
                {isView && boardId === 'all' ? <span style={{ color: '#1F2937' }}> · Tous les tableaux</span> : ''}
              </h1>
              <p style={{ fontSize: 13, color: '#8A99A4', fontWeight: 500, margin: '2px 0 0' }}>{tabDef.subtitle}</p>
            </div>
            {isView && (
              <select value={boardId} onChange={(e) => setBoardId(e.target.value)} style={{ ...inputStyle, width: 240, fontWeight: 700 }}>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                <option value="all">Tous les tableaux</option>
              </select>
            )}
            {currentTab !== 'slack' && currentTab !== 'modeles' && (
              <button type="button" onClick={() => setCreating({})} style={{
                background: TACHES_COLOR, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>+ Nouvelle tâche</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E5E7EB', marginBottom: 14, flexWrap: 'wrap' }}>
            {visibleTabs.map((t) => {
              const active = t.key === currentTab;
              return (
                <button key={t.key} type="button" onClick={() => navigate(`/taches/${t.key}`)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '9px 13px', marginBottom: -1, fontSize: 14,
                  fontWeight: active ? 800 : 600, color: active ? TACHES_COLOR : '#6B7280',
                  borderBottom: `3px solid ${active ? TACHES_COLOR : 'transparent'}`,
                }}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {error && (
            <div style={{ padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13, marginBottom: 10, display: 'flex' }}>
              <span style={{ flex: 1 }}>{error}</span>
              <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer' }}>×</button>
            </div>
          )}

          {isView && (
            <FilterBar {...{
              q, setQ, members, person, setPerson, openOnly, setOpenOnly, labels, label, setLabel,
              hideDone, setHideDone, archived, setArchived,
              count: filtered ? `${filtered.length} / ${tasks.length}` : '',
            }} />
          )}
          {isView && hits && (
            <SearchResults hits={hits} q={q} boardId={boardId} onOpen={setOpenId} />
          )}

          {currentTab === 'moi' && <MineTab members={members} reloadKey={reloadKey} onOpen={setOpenId} onError={setError} />}
          {currentTab === 'tableau' && <TableView {...viewProps} />}
          {currentTab === 'kanban' && <KanbanView {...viewProps} />}
          {currentTab === 'gantt' && <GanttView {...viewProps} />}
          {currentTab === 'calendrier' && <CalendarView {...viewProps} />}
          {currentTab === 'modeles' && <TemplatesTab members={members} labels={labels} templates={templates} onChange={setTemplates} />}
          {currentTab === 'slack' && <SlackTab members={members} />}
        </div>
      </main>

      {openId && (
        <TaskModal taskId={openId} members={members} labels={labels} boards={boards} canWrite={canWrite}
          onClose={closeTask} onChanged={changed} focusUserId={currentTab === 'moi' ? user?.id : person} />
      )}
      {creating && (
        <NewTaskModal templates={templates} members={members} labels={labels} boards={boards}
          preset={{ board_id: board?.id || boards[0]?.id, ...creating }}
          onClose={() => setCreating(null)}
          onCreated={(t) => { setCreating(null); changed(); setOpenId(t.id); }} />
      )}
    </AppShell>
  );
}

const chip = (active) => ({
  border: `1px solid ${active ? TACHES_COLOR : '#D1D5DB'}`, background: active ? TACHES_COLOR : '#fff', color: active ? '#fff' : '#374151',
  borderRadius: 999, padding: '4px 11px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});
const check = { fontSize: 13, color: '#4B5563', display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' };

/** Filtres communs : recherche, personne (remplace les onglets par personne de Monday), étiquette… */
function FilterBar({
  q, setQ, members, person, setPerson, openOnly, setOpenOnly, labels, label, setLabel,
  hideDone, setHideDone, archived, setArchived, count,
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ position: 'relative' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Chercher un mot (titres, étapes, notes, commentaires…)"
            style={{ ...inputStyle, width: 380, paddingRight: 28 }} />
          {q && (
            <button type="button" onClick={() => setQ('')} title="Effacer"
              style={{ position: 'absolute', right: 6, top: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16 }}>×</button>
          )}
        </div>
        <select value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, width: 190 }}>
          <option value="">Toutes les étiquettes</option>
          {labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <label style={check}><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Masquer les terminées</label>
        <label style={check}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Voir les archives</label>
        <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>{count} tâches</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={chip(!person)} onClick={() => setPerson(null)}>Tout le monde</button>
        {members.map((m) => (
          <button key={m.id} type="button" style={chip(person === m.id)} onClick={() => setPerson(m.id)}>{m.name}</button>
        ))}
        {person && (
          <label style={{ ...check, marginLeft: 8 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Seulement ce qui est à faire maintenant
          </label>
        )}
      </div>
    </div>
  );
}
