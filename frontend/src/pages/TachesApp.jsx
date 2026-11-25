import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { tachesApi, apiError, TACHES_COLOR } from '../components/taches/tachesShared';
import MineTab from '../components/taches/MineTab';
import BoardTab from '../components/taches/BoardTab';
import TemplatesTab from '../components/taches/TemplatesTab';
import SlackTab from '../components/taches/SlackTab';
import TaskModal from '../components/taches/TaskModal';
import NewTaskModal from '../components/taches/NewTaskModal';

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'taches';

const TABS = [
  { key: 'moi', label: 'Mes tâches', subtitle: 'Ce que vous avez à faire, avec les étapes avant et après.' },
  { key: 'tout', label: 'Toutes les tâches', subtitle: "Le tableau de toute l'équipe." },
  { key: 'modeles', label: 'Modèles', subtitle: 'Les enchaînements d\'étapes types, recopiés à la création.' },
  { key: 'slack', label: 'Slack', subtitle: 'Notifications dans #notifications-taches.', admin: true },
];

/**
 * App Tâches — remplace Monday + Make.
 * /taches/:tab, et /taches/tache/:id (lien des messages Slack) qui ouvre la
 * tâche par-dessus « Toutes les tâches ».
 */
export default function TachesApp() {
  const { tab, id } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin, isAdmin, user } = useContext(AuthContext);
  const canRead = useMemo(() => isSuperAdmin || permissions?.[PERM_KEY]?.read === true, [isSuperAdmin, permissions]);

  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(id ? Number(id) : null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadRefs = useCallback(async () => {
    try {
      const [m, l, t] = await Promise.all([tachesApi.members(), tachesApi.labels(), tachesApi.templates()]);
      setMembers(m);
      setLabels(l);
      setTemplates(t);
    } catch (e) {
      setError(apiError(e));
    }
  }, []);
  useEffect(() => { if (canRead) loadRefs(); }, [canRead, loadRefs]);
  useEffect(() => { if (id) setOpenId(Number(id)); }, [id]);

  const currentTab = id ? 'tout' : tab;
  const currentPath = `/taches/${currentTab || ''}`;

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: '#6B7280' }}>
          Vous n'avez pas accès aux Tâches. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  const visibleTabs = TABS.filter((t) => !t.admin || isAdmin || isSuperAdmin);
  const tabDef = visibleTabs.find((t) => t.key === currentTab);
  if (!tabDef) return <Navigate to="/taches/moi" replace />;

  const closeTask = () => {
    setOpenId(null);
    if (id) navigate('/taches/tout', { replace: true });
  };
  const changed = () => { setReloadKey((k) => k + 1); tachesApi.labels().then(setLabels).catch(() => {}); };

  return (
    <AppShell currentPath={currentPath}>
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: '#F2F6F8' }}>
        <div style={{ padding: '24px 32px 40px', margin: '0 auto', maxWidth: currentTab === 'tout' ? 'none' : 1200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ width: 10, height: 34, borderRadius: 5, background: TACHES_COLOR, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: TACHES_COLOR, margin: 0 }}>Tâches</h1>
              <p style={{ fontSize: 13, color: '#8A99A4', fontWeight: 500, margin: '2px 0 0' }}>{tabDef.subtitle}</p>
            </div>
            {currentTab === 'moi' && (
              <button type="button" onClick={() => setCreating(true)} style={{
                background: TACHES_COLOR, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>+ Nouvelle tâche</button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #E5E7EB', marginBottom: 18 }}>
            {visibleTabs.map((t) => {
              const active = t.key === currentTab;
              return (
                <button key={t.key} type="button" onClick={() => navigate(`/taches/${t.key}`)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '9px 14px', marginBottom: -1, fontSize: 14,
                  fontWeight: active ? 800 : 600, color: active ? TACHES_COLOR : '#6B7280',
                  borderBottom: `3px solid ${active ? TACHES_COLOR : 'transparent'}`,
                }}>
                  {t.label}
                </button>
              );
            })}
          </div>

          {error && <div style={{ padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}

          {currentTab === 'moi' && <MineTab members={members} reloadKey={reloadKey} onOpen={setOpenId} />}
          {currentTab === 'tout' && (
            <BoardTab members={members} labels={labels} reloadKey={reloadKey}
              onOpen={setOpenId} onNew={() => setCreating(true)} />
          )}
          {currentTab === 'modeles' && <TemplatesTab members={members} templates={templates} onChange={setTemplates} />}
          {currentTab === 'slack' && <SlackTab members={members} />}
        </div>
      </main>

      {openId && (
        <TaskModal taskId={openId} members={members} labels={labels} onClose={closeTask}
          onChanged={changed} focusUserId={currentTab === 'moi' ? user?.id : null} />
      )}
      {creating && (
        <NewTaskModal templates={templates} members={members} labels={labels}
          onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); changed(); setOpenId(t.id); }} />
      )}
    </AppShell>
  );
}
