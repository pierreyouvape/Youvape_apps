import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import {
  tachesApi, apiError, TACHES_COLOR, inputStyle, btn, M, PRIORITY, PRIORITY_ORDER, TASK_STATUS, TASK_STATUS_ORDER,
} from '../components/taches/tachesShared';
import MineTab from '../components/taches/MineTab';
import DashboardTab from '../components/taches/DashboardTab';
import TableView from '../components/taches/TableView';
import KanbanView from '../components/taches/KanbanView';
import GanttView from '../components/taches/GanttView';
import CalendarView from '../components/taches/CalendarView';
import TemplatesTab from '../components/taches/TemplatesTab';
import SlackTab from '../components/taches/SlackTab';
import TaskModal from '../components/taches/TaskModal';
import NewTaskModal from '../components/taches/NewTaskModal';
import SearchResults from '../components/taches/SearchResults';
import NotificationsPanel from '../components/taches/NotificationsPanel';
import ViewModal from '../components/taches/ViewModal';
import { Popover } from '../components/taches/tachesUi';
import { THEME_CSS, useTachesTheme } from '../components/taches/tachesTheme';

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'taches';

/** Vues d'un tableau (onglets du haut, comme Monday). Les personnes s'ajoutent après le Calendrier. */
const BOARD_TABS = [
  { key: 'tableau', label: 'Tableau principal', subtitle: 'Toutes les tâches, par groupe. Glisser ⠿ pour changer l\'ordre.' },
  { key: 'kanban', label: 'Kanban', subtitle: 'Glisser une carte d\'une colonne à l\'autre la modifie.' },
  { key: 'gantt', label: 'Gantt', subtitle: 'Planning : glisser une barre la déplace, tirer son bord droit l\'allonge.' },
  { key: 'calendrier', label: 'Calendrier', subtitle: 'Échéances du mois : glisser une tâche sur un autre jour la décale.' },
];
const PAGES = {
  moi: { title: 'Mes tâches', subtitle: 'Ce que vous avez à faire, avec les étapes avant et après.' },
  bord: { title: 'Tableau de bord', subtitle: 'Combien de choses à faire, en cours, bloquées, faites — en tout et par personne.' },
  modeles: { title: 'Modèles', subtitle: 'Les enchaînements d\'étapes types, recopiés à la création.' },
  slack: { title: 'Slack', subtitle: 'Notifications dans #notifications-taches.', admin: true },
};
const BOARD_KEY = 'yv.taches.board';
const EMPTY_FILTERS = { q: '', labels: [], notLabels: [], priority: '', status: '', person: null, openOnly: false, hideDone: false };

/**
 * App Tâches — remplace Monday + Make.
 *
 * Colonne de gauche (comme le menu « Contenu » de Monday) : Mes tâches, les
 * tableaux, les vues enregistrées (listes filtrées, ex. « SEO (Jib) »),
 * Modèles, Slack. En haut, les vues du tableau choisi : Tableau principal,
 * Kanban, Gantt, Calendrier, une par personne.
 *
 * Adresses : /taches/:tab, /taches/vue/:vid (vue enregistrée),
 * /taches/tache/:id (lien des messages Slack : ouvre la tâche).
 */
export default function TachesApp() {
  const { tab, id, vid } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin, isAdmin, user } = useContext(AuthContext);
  const canRead = useMemo(() => isSuperAdmin || permissions?.[PERM_KEY]?.read === true, [isSuperAdmin, permissions]);
  const canWrite = isSuperAdmin || permissions?.[PERM_KEY]?.write === true;
  const admin = isAdmin || isSuperAdmin;

  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [boards, setBoards] = useState([]);
  const [views, setViews] = useState([]);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [boardId, setBoardId] = useState(() => localStorage.getItem(BOARD_KEY) || '');
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(id ? Number(id) : null);
  const [creating, setCreating] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [theme, toggleTheme] = useTachesTheme();
  const [unread, setUnread] = useState(0);
  const [viewModal, setViewModal] = useState(null); // { view } : null = création

  // Filtres communs aux vues
  const [f, setF] = useState(EMPTY_FILTERS);
  const setFilter = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));
  const [hits, setHits] = useState(null);
  const [archived, setArchived] = useState(false);

  // Où sommes-nous ?
  const view = vid ? views.find((v) => String(v.id) === String(vid)) : null;
  const currentTab = id ? 'tableau' : vid ? 'vue' : tab;
  const personTabs = members.filter((m) => m.has_app !== false).map((m) => ({
    key: `p-${m.id}`, label: m.name, person: m.id,
    subtitle: `Ce que ${m.name} a à faire maintenant dans ce tableau (choisissez le tableau à gauche ; décochez la case pour tout voir).`,
  }));
  const boardTabs = [...BOARD_TABS, ...personTabs];
  const boardTab = boardTabs.find((t) => t.key === currentTab);
  const page = PAGES[currentTab];
  const isList = Boolean(boardTab) || currentTab === 'vue' || /^p-\d+$/.test(currentTab || '');
  const forcedPerson = boardTab?.person || null;
  const who = forcedPerson || f.person;

  const loadRefs = useCallback(async () => {
    try {
      const [m, l, t, b, v] = await Promise.all([
        tachesApi.members(), tachesApi.labels(), tachesApi.templates(), tachesApi.boards(), tachesApi.views(),
      ]);
      setMembers(m);
      setLabels(l);
      setTemplates(t);
      setBoards(b);
      setViews(v);
      setRefsLoaded(true);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);
  useEffect(() => { if (canRead) loadRefs(); }, [canRead, loadRefs]);

  // Cloche : nombre de notifications non lues, relu chaque minute et au retour sur l'onglet.
  const loadUnread = useCallback(() => {
    tachesApi.notificationCount().then((d) => setUnread(d.unread)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!canRead) return undefined;
    loadUnread();
    window.addEventListener('focus', loadUnread);
    const timer = setInterval(loadUnread, 60000);
    return () => { window.removeEventListener('focus', loadUnread); clearInterval(timer); };
  }, [canRead, loadUnread, reloadKey]);
  useEffect(() => { if (id) setOpenId(Number(id)); }, [id]);

  // Onglet d'une personne : seulement ce qu'elle a à faire, par défaut.
  useEffect(() => {
    if (forcedPerson) setF((cur) => ({ ...cur, openOnly: true }));
  }, [forcedPerson]);

  // Vue enregistrée : ses filtres et son tableau.
  useEffect(() => {
    if (!view) return;
    const vf = view.filters || {};
    setF({ ...EMPTY_FILTERS, ...vf, labels: vf.labels || (vf.label ? [vf.label] : []), notLabels: vf.notLabels || [], person: vf.person || null });
    setBoardId(vf.board_id ? String(vf.board_id) : 'all');
  }, [view]);

  // Tableau retenu d'une visite à l'autre ; à défaut le premier.
  const board = boards.find((b) => String(b.id) === String(boardId)) || null;
  useEffect(() => {
    if (boards.length && boardId !== 'all' && !board) setBoardId(String(boards[0].id));
  }, [boards, boardId, board]);
  useEffect(() => { if (boardId && !vid) localStorage.setItem(BOARD_KEY, boardId); }, [boardId, vid]);

  const loadTasks = useCallback(async () => {
    if (!boardId) return;
    try {
      setTasks(await tachesApi.board({ board: boardId === 'all' ? undefined : boardId, archived: archived ? 1 : 0 }));
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, [boardId, archived]);
  useEffect(() => { if (canRead && isList) loadTasks(); }, [canRead, isList, loadTasks, reloadKey]);
  useEffect(() => {
    if (!isList) return undefined;
    const onFocus = () => loadTasks();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(loadTasks, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [isList, loadTasks]);

  // Recherche plein texte (titres, étapes, notes, commentaires…), côté serveur.
  useEffect(() => {
    const term = f.q.trim();
    if (term.length < 2) { setHits(null); return undefined; }
    const timer = setTimeout(() => {
      tachesApi.search(term).then(setHits).catch((e) => setError(apiError(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [f.q, reloadKey]);

  const filtered = useMemo(() => {
    if (!tasks) return null;
    const ids = hits ? new Set(hits.map((h) => h.task_id)) : null;
    return tasks.filter((t) => {
      if (ids && !ids.has(t.id)) return false;
      if (f.labels.length && !f.labels.some((l) => t.labels.includes(l))) return false;
      if (f.notLabels.some((l) => t.labels.includes(l))) return false;
      if (f.priority && (t.priority || 'none') !== f.priority) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.hideDone && t.status === 'fait') return false;
      if (who) {
        const steps = t.steps.filter((s) => s.owners.includes(who));
        const own = t.people.includes(who);
        if (!steps.length && !own) return false;
        if (f.openOnly) {
          const stepOpen = steps.some((s) => s.status !== 'fait' && s.status !== 'bloque');
          const taskOpen = own && !t.steps.length && t.status !== 'fait';
          if (!stepOpen && !taskOpen) return false;
        }
      }
      return true;
    });
  }, [tasks, hits, f, who]);

  if (permissions && !canRead) {
    return (
      <AppShell currentPath="/taches"><Themed theme={theme}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: 'var(--tk-sub)' }}>
          Vous n'avez pas accès aux Tâches. Contactez un administrateur.
        </div>
      </Themed></AppShell>
    );
  }
  // Onglet d'une personne ou vue : attendre les listes avant de juger l'adresse.
  if ((/^p-\d+$/.test(currentTab || '') && !members.length) || (vid && !refsLoaded && !error)) {
    return <AppShell currentPath="/taches"><Themed theme={theme}><div style={{ flex: 1, padding: 40, color: M.sub, background: 'var(--tk-surface)', minHeight: '100vh' }}>Chargement…</div></Themed></AppShell>;
  }
  const known = boardTab || (page && (!page.admin || admin)) || (currentTab === 'vue' && view);
  if (!known) return <Navigate to="/taches/moi" replace />;

  const closeTask = () => {
    setOpenId(null);
    if (id) navigate('/taches/tableau', { replace: true });
  };
  const changed = () => {
    setReloadKey((k) => k + 1);
    tachesApi.labels().then(setLabels).catch(() => {});
  };
  const replaceTask = (t) => setTasks((list) => (list ? list.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : list));
  const goBoard = (bid) => {
    setBoardId(String(bid));
    setF(EMPTY_FILTERS);
    navigate('/taches/tableau');
  };
  const currentFilters = () => ({ ...f, board_id: boardId === 'all' ? null : Number(boardId), person: f.person || forcedPerson || null });
  const saveAsView = () => setViewModal({ view: null });
  // Fenêtre « Nouvelle vue » / « Modifier la vue » : renvoie un message d'erreur, ou rien si c'est fait.
  const submitView = async (form) => {
    const target = viewModal.view;
    try {
      if (target) {
        setViews(await tachesApi.updateView(target.id, { ...form, filters: target.filters }));
      } else {
        const before = new Set(views.map((v) => v.id));
        const list = await tachesApi.createView({ ...form, filters: currentFilters() });
        setViews(list);
        const created = list.find((v) => !before.has(v.id));
        if (created) navigate(`/taches/vue/${created.id}`);
      }
      setViewModal(null);
      return null;
    } catch (e) { return apiError(e); }
  };
  const viewAction = async (fn) => {
    try { setViews(await fn()); } catch (e) { setError(apiError(e)); }
  };

  const viewProps = {
    tasks: filtered || [], loading: filtered === null, board, boards, members, labels, canWrite,
    hideEmptyGroups: Boolean(filtered && tasks && filtered.length !== tasks.length),
    // Onglet d'une personne = liste personnelle : sous-éléments « Fait » masqués par défaut.
    focusUserId: who, hideDoneSteps: Boolean(forcedPerson), onOpen: setOpenId, onTaskChange: replaceTask, onError: setError,
    onReload: changed, onBoardsChange: setBoards,
    onNew: (preset = {}) => setCreating(preset),
  };

  const title = currentTab === 'vue' ? view.name
    : forcedPerson ? `Tâches de ${boardTab.label}`
      : boardTab ? (board?.name || (boardId === 'all' ? 'Tous les tableaux' : 'Tâches')) : page.title;
  const subtitle = currentTab === 'vue'
    ? (view.mine
      ? `Vue ${view.shared_all ? 'partagée avec toute l\'équipe' : view.shared_with?.length ? `partagée avec ${view.shared_with.map((pid) => members.find((m) => m.id === pid)?.name).filter(Boolean).join(', ')}` : 'personnelle'} — ${board ? board.name : 'tous les tableaux'}. Modifiez les filtres puis « Enregistrer la vue » pour la mettre à jour.`
      : `Vue partagée par ${view.created_by_name || 'un collègue'} — ${board ? board.name : 'tous les tableaux'}. Vous pouvez changer les filtres pour vous, sans modifier la vue.`)
    : (boardTab || page).subtitle;
  const viewChanged = currentTab === 'vue' && view.mine && JSON.stringify(cleanForCompare(view.filters, board)) !== JSON.stringify(cleanForCompare(currentFilters(), board));

  return (
    <AppShell currentPath="/taches/moi"><Themed theme={theme}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', height: '100vh', background: 'var(--tk-surface)', fontFamily: M.font, color: M.text }}>
        {viewModal && (
          <ViewModal view={viewModal.view} members={members} meId={user?.id} onClose={() => setViewModal(null)} onSave={submitView} />
        )}
        <Sidebar {...{
          currentTab, boards, board, boardId, views, vid, admin, canWrite, user,
          onMine: () => navigate('/taches/moi'),
          onBoard: goBoard,
          onAll: () => { setBoardId('all'); setF(EMPTY_FILTERS); navigate('/taches/tableau'); },
          onView: (v) => navigate(`/taches/vue/${v.id}`),
          onSaveView: saveAsView, canSaveView: isList,
          onPage: (k) => navigate(`/taches/${k}`),
          onRenameView: (v) => setViewModal({ view: v }),
          onDeleteView: (v) => {
            if (!window.confirm(`Supprimer la vue « ${v.name} » ? Les tâches ne sont pas touchées.`)) return;
            viewAction(() => tachesApi.deleteView(v.id)).then(() => { if (String(vid) === String(v.id)) navigate('/taches/moi'); });
          },
        }} />

        <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <div style={{ padding: '22px 28px 40px', margin: '0 auto', maxWidth: page && currentTab !== 'moi' && currentTab !== 'bord' ? 1200 : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ fontSize: 28, fontWeight: 600, color: M.text, margin: 0 }}>{title}</h1>
                <p style={{ fontSize: 14, color: M.sub, margin: '2px 0 0' }}>{subtitle}</p>
              </div>
              {viewChanged && (
                <button type="button" style={btn(true)}
                  onClick={() => viewAction(() => tachesApi.updateView(view.id, { name: view.name, filters: currentFilters() }))}>
                  Enregistrer la vue
                </button>
              )}
              <button type="button" onClick={toggleTheme} title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
                style={{ background: 'none', border: `1px solid ${M.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 13, padding: '6px 10px', color: M.text, fontFamily: 'inherit' }}>
                {theme === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre'}
              </button>
              <button type="button" onClick={() => setBellOpen(true)} title="Notifications"
                style={{ position: 'relative', background: bellOpen ? 'var(--tk-sel)' : 'none', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 22, padding: '4px 8px', lineHeight: 1 }}>
                🔔
                {unread > 0 && (
                  <span style={{
                    position: 'absolute', top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9, background: '#E2445C', color: '#fff',
                    fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  }}>{unread > 99 ? '99+' : unread}</span>
                )}
              </button>
              {currentTab !== 'slack' && currentTab !== 'modeles' && (
                <button type="button" onClick={() => setCreating({})} style={{
                  background: TACHES_COLOR, color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px',
                  fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                }}>+ Nouvelle tâche</button>
              )}
            </div>

            {boardTab && (
              <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${M.border}`, marginBottom: 14, flexWrap: 'wrap' }}>
                {boardTabs.map((t, i) => {
                  const active = t.key === currentTab;
                  return (
                    <Fragmentish key={t.key} sep={i === BOARD_TABS.length}>
                      <button type="button" onClick={() => navigate(`/taches/${t.key}`)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '9px 12px', marginBottom: -1,
                        fontSize: 14, color: active ? M.text : M.sub, borderBottom: `2px solid ${active ? TACHES_COLOR : 'transparent'}`,
                      }}>{t.person ? `👤 ${t.label}` : t.label}</button>
                    </Fragmentish>
                  );
                })}
              </div>
            )}

            {error && (
              <div style={{ padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13, marginBottom: 10, display: 'flex' }}>
                <span style={{ flex: 1 }}>{error}</span>
                <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: 'var(--tk-danger)', cursor: 'pointer' }}>×</button>
              </div>
            )}

            {isList && (
              <FilterBar {...{
                f, setFilter, members, labels, who, lockedPerson: Boolean(forcedPerson), archived, setArchived,
                count: filtered ? `${filtered.length} / ${tasks.length}` : '',
              }} />
            )}
            {isList && hits && <SearchResults hits={hits} q={f.q} boardId={boardId} onOpen={setOpenId} />}

            {currentTab === 'bord' && (
              <DashboardTab boards={boards} members={members} onError={setError} onOpenPerson={(pid) => navigate(`/taches/p-${pid}`)} />
            )}
            {currentTab === 'moi' && <MineTab members={members} reloadKey={reloadKey} onOpen={setOpenId} onError={setError} />}
            {(currentTab === 'tableau' || forcedPerson || currentTab === 'vue') && <TableView {...viewProps} />}
            {currentTab === 'kanban' && <KanbanView {...viewProps} />}
            {currentTab === 'gantt' && <GanttView {...viewProps} />}
            {currentTab === 'calendrier' && <CalendarView {...viewProps} />}
            {currentTab === 'modeles' && <TemplatesTab members={members} labels={labels} templates={templates} onChange={setTemplates} />}
            {currentTab === 'slack' && <SlackTab members={members} />}
          </div>
        </main>
      </div>

      {openId && (
        <TaskModal taskId={openId} members={members} labels={labels} boards={boards} canWrite={canWrite}
          onClose={closeTask} onChanged={changed} onOpenTask={setOpenId} focusUserId={currentTab === 'moi' ? user?.id : who} />
      )}
      {bellOpen && <NotificationsPanel onClose={() => setBellOpen(false)} onOpen={setOpenId} onUnread={setUnread} />}
      {creating && (
        <NewTaskModal templates={templates} members={members} labels={labels} boards={boards}
          preset={{ board_id: board?.id || boards[0]?.id, ...creating }}
          onClose={() => setCreating(null)}
          onCreated={(t) => { setCreating(null); changed(); setOpenId(t.id); }} />
      )}
    </Themed></AppShell>
  );
}

/** Pour comparer une vue enregistrée aux filtres en cours (clés vides retirées). */
function cleanForCompare(fl = {}, board) {
  const out = {};
  ['priority', 'status', 'q'].forEach((k) => { if (fl[k]) out[k] = fl[k]; });
  const labels = fl.labels || (fl.label ? [fl.label] : []);
  if (labels.length) out.labels = [...labels].sort();
  if (fl.notLabels?.length) out.notLabels = [...fl.notLabels].sort();
  if (fl.person) out.person = Number(fl.person);
  if (fl.openOnly) out.openOnly = true;
  if (fl.hideDone) out.hideDone = true;
  out.board_id = fl.board_id ? Number(fl.board_id) : (board ? board.id : null);
  return out;
}

/** Séparateur fin avant les onglets « personnes ». */
function Fragmentish({ sep, children }) {
  return (
    <>
      {sep && <span style={{ width: 1, background: M.border, margin: '8px 6px' }} />}
      {children}
    </>
  );
}

const sideItem = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', borderRadius: 6, cursor: 'pointer',
  background: active ? 'var(--tk-sel2)' : 'transparent', color: M.text, padding: '7px 10px', fontSize: 14, fontFamily: 'inherit',
  textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});
const sideTitle = { fontSize: 12, fontWeight: 700, color: M.sub, padding: '14px 10px 4px', display: 'flex', alignItems: 'center' };

/** Menu de gauche, comme « Contenu » dans Monday. */
function Sidebar({
  currentTab, boards, board, boardId, views, vid, admin, user,
  onMine, onBoard, onAll, onView, onSaveView, canSaveView, onPage, onRenameView, onDeleteView, canWrite,
}) {
  const onBoardPage = ['tableau', 'kanban', 'gantt', 'calendrier'].includes(currentTab) || /^p-\d+$/.test(currentTab || '');
  return (
    <nav style={{ width: 230, flexShrink: 0, borderRight: `1px solid ${M.border}`, padding: '18px 10px', overflowY: 'auto', background: 'var(--tk-bg2)' }}>
      <button type="button" style={{ ...sideItem(currentTab === 'moi'), fontWeight: 600 }} onClick={onMine}>✓ Mes tâches</button>
      <button type="button" style={{ ...sideItem(currentTab === 'bord'), fontWeight: 600 }} onClick={() => onPage('bord')}>📊 Tableau de bord</button>

      <div style={sideTitle}>Tableaux</div>
      {boards.map((b) => (
        <button key={b.id} type="button" style={sideItem(onBoardPage && board?.id === b.id)} onClick={() => onBoard(b.id)} title={b.name}>
          ▦ {b.name}
        </button>
      ))}
      <button type="button" style={{ ...sideItem(onBoardPage && boardId === 'all'), color: M.sub }} onClick={onAll}>▦ Tous les tableaux</button>

      <div style={sideTitle}>
        <span style={{ flex: 1 }}>Vues</span>
        {canSaveView && (
          <button type="button" onClick={onSaveView} title="Enregistrer les filtres actuels comme une vue"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-link)', fontSize: 18, lineHeight: 1, padding: 0 }}>+</button>
        )}
      </div>
      {views.map((v) => {
        const active = String(vid) === String(v.id);
        return (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button type="button" style={{ ...sideItem(active), flex: 1, minWidth: 0 }} onClick={() => onView(v)}
              title={v.mine ? `${v.name}${v.shared_all || v.shared_with?.length ? ' — partagée' : ' — personnelle'}` : `${v.name} — partagée par ${v.created_by_name || 'un collègue'}`}>
              ◫ {v.name}
              {v.mine && (v.shared_all || v.shared_with?.length > 0) && <span style={{ marginLeft: 4, fontSize: 11 }}>👥</span>}
              {!v.mine && <span style={{ marginLeft: 4, fontSize: 11, color: M.sub }}>· {v.created_by_name || 'partagée'}</span>}
            </button>
            {active && (
              <span style={{ display: 'flex', flexShrink: 0 }}>
                {v.mine && <button type="button" title="Renommer ou partager" onClick={() => onRenameView(v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 12 }}>✎</button>}
                {(canWrite || v.created_by === user?.id) && (
                  <button type="button" title="Supprimer la vue" onClick={() => onDeleteView(v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 12 }}>🗑</button>
                )}
              </span>
            )}
          </div>
        );
      })}
      {!views.length && (
        <div style={{ fontSize: 12, color: M.sub, padding: '4px 10px', lineHeight: 1.4 }}>
          Filtrez un tableau (étiquette, personne…) puis « + » pour l'enregistrer ici.
        </div>
      )}

      <div style={sideTitle}>Réglages</div>
      <button type="button" style={sideItem(currentTab === 'modeles')} onClick={() => onPage('modeles')}>⧉ Modèles</button>
      {admin && <button type="button" style={sideItem(currentTab === 'slack')} onClick={() => onPage('slack')}># Slack</button>}
    </nav>
  );
}

const chip = (active) => ({
  border: `1px solid ${active ? TACHES_COLOR : 'var(--tk-border)'}`, background: active ? TACHES_COLOR : 'var(--tk-surface)', color: active ? '#fff' : 'var(--tk-text2)',
  borderRadius: 999, padding: '4px 11px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
});
const check = { fontSize: 13, color: 'var(--tk-text2)', display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' };

/**
 * Filtre d'étiquettes, comme les filtres avancés de Monday : pour chaque
 * étiquette, « inclure » (la tâche en a au moins une) ou « exclure » (elle
 * n'en a aucune). Ex. SEO (Jib) : inclure SEO, exclure Blog.
 */
function LabelFilter({ labels, include, exclude, onChange }) {
  const [anchor, setAnchor] = useState(null);
  const n = include.length + exclude.length;
  const summary = !n ? 'Toutes les étiquettes'
    : [...include, ...exclude.map((l) => `sauf ${l}`)].join(', ');
  const toggle = (l, mode) => {
    const inc = include.filter((x) => x !== l);
    const exc = exclude.filter((x) => x !== l);
    if (mode === 'in' && !include.includes(l)) inc.push(l);
    if (mode === 'out' && !exclude.includes(l)) exc.push(l);
    onChange(inc, exc);
  };
  const pill = (on, color) => ({
    border: `1px solid ${on ? color : 'var(--tk-border)'}`, background: on ? color : 'var(--tk-surface)', color: on ? '#fff' : M.sub,
    borderRadius: 4, padding: '2px 7px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  });
  return (
    <>
      <button type="button" onClick={(e) => setAnchor(e.currentTarget)} title={summary} style={{
        ...inputStyle, width: 180, height: 34, padding: '0 8px', fontSize: 13, lineHeight: '32px', textAlign: 'left', cursor: 'pointer',
        background: 'var(--tk-surface)', color: M.text, display: 'block',
        fontWeight: n ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {summary} ▾
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={300}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 6px', borderBottom: `1px solid ${M.grid}`, marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 12, color: M.sub }}>Inclure = au moins une · Exclure = aucune</span>
            {n > 0 && <button type="button" onClick={() => onChange([], [])} style={{ background: 'none', border: 'none', color: 'var(--tk-link)', cursor: 'pointer', fontSize: 12 }}>Effacer</button>}
          </div>
          {labels.map((l) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px' }}>
              <span style={{ flex: 1, fontSize: 13, color: M.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</span>
              <button type="button" style={pill(include.includes(l), '#00C875')} onClick={() => toggle(l, include.includes(l) ? null : 'in')}>Inclure</button>
              <button type="button" style={pill(exclude.includes(l), '#E2445C')} onClick={() => toggle(l, exclude.includes(l) ? null : 'out')}>Exclure</button>
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}

/** Filtres communs : recherche, étiquette, priorité, statut, personne… */
function FilterBar({ f, setFilter, members, labels, who, lockedPerson, archived, setArchived, count }) {
  const sel = { ...inputStyle, padding: '7px 8px', fontSize: 13 };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ position: 'relative' }}>
          <input value={f.q} onChange={(e) => setFilter('q')(e.target.value)} placeholder="🔍 Chercher un mot ou #ID (titres, étapes, commentaires…)"
            style={{ ...sel, width: 270, paddingRight: 26 }} />
          {f.q && (
            <button type="button" onClick={() => setFilter('q')('')} title="Effacer"
              style={{ position: 'absolute', right: 6, top: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-muted)', fontSize: 16 }}>×</button>
          )}
        </div>
        <LabelFilter labels={labels} include={f.labels} exclude={f.notLabels}
          onChange={(inc, exc) => { setFilter('labels')(inc); setFilter('notLabels')(exc); }} />
        <select value={f.priority} onChange={(e) => setFilter('priority')(e.target.value)} style={{ ...sel, width: 140, fontWeight: f.priority ? 700 : 400 }}>
          <option value="">Toutes les priorités</option>
          {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
          <option value="none">Sans priorité</option>
        </select>
        <select value={f.status} onChange={(e) => setFilter('status')(e.target.value)} style={{ ...sel, width: 130, fontWeight: f.status ? 700 : 400 }}>
          <option value="">Tous les statuts</option>
          {TASK_STATUS_ORDER.map((k) => <option key={k} value={k}>{TASK_STATUS[k].label}</option>)}
        </select>
        <label style={check}><input type="checkbox" checked={f.hideDone} onChange={(e) => setFilter('hideDone')(e.target.checked)} /> Masquer les terminées</label>
        <label style={check}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archives</label>
        <span style={{ fontSize: 12, color: M.sub, marginLeft: 'auto' }}>{count} tâches</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {!lockedPerson && <button type="button" style={chip(!f.person)} onClick={() => setFilter('person')(null)}>Tout le monde</button>}
        {!lockedPerson && members.filter((m) => m.has_app !== false).map((m) => (
          <button key={m.id} type="button" style={chip(f.person === m.id)} onClick={() => setFilter('person')(m.id)}>{m.name}</button>
        ))}
        {who && (
          <label style={{ ...check, marginLeft: lockedPerson ? 0 : 8, fontWeight: 600, color: M.text }}>
            <input type="checkbox" checked={f.openOnly} onChange={(e) => setFilter('openOnly')(e.target.checked)} />
            Seulement ce qui est à faire maintenant
          </label>
        )}
      </div>
    </div>
  );
}

/** Tout l'écran (fenêtres comprises) lit les couleurs du thème choisi. */
function Themed({ theme, children }) {
  return (
    <div className="tk-root" data-theme={theme} style={{ display: 'contents' }}>
      <style>{THEME_CSS}</style>
      {children}
    </div>
  );
}
