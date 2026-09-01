import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { AuthContext } from '../context/AuthContext';
import ProcessReader from '../components/process/ProcessReader';
import ProcessEditorPanel from '../components/process/ProcessEditorPanel';
import ProcessHistory from '../components/process/ProcessHistory';
import ProcessAccessDrawer from '../components/process/ProcessAccessDrawer';
import { API_URL, C, prettyDateTime } from '../components/process/processConstants';

const ProcessDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin } = useContext(AuthContext);

  const [process, setProcess] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState(searchParams.get('edit') === '1');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  // Snapshot d'une ancienne version consultée depuis l'historique.
  const [previewVersion, setPreviewVersion] = useState(null);

  const fetchProcess = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_URL}/process/${id}`);
      setProcess(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchProcess(); }, [fetchProcess]);

  // Un ?edit=1 collé dans la barre d'adresse ne doit pas ouvrir l'éditeur sur
  // un process qu'on n'a le droit que de lire.
  useEffect(() => {
    if (process && !process.my_can_write) setEditing(false);
  }, [process]);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/process/categories`);
        setCategories(res.data.data || []);
      } catch { /* l'édition reste possible sans la liste des catégories */ }
    })();
  }, []);

  // Droit d'écriture sur CE process, calculé côté serveur (accès nominatif ou
  // statut admin). L'interface s'y conforme ; le backend le revérifie.
  const canWrite = !!process?.my_can_write;

  const openEditor = () => {
    setPreviewVersion(null);
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    if (searchParams.get('edit')) {
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const save = async (payload) => {
    setSaving(true);
    try {
      const res = await axios.put(`${API_URL}/process/${id}`, payload);
      setProcess(res.data.data);
      closeEditor();
    } catch (err) {
      alert(err.response?.data?.error || "L'enregistrement a échoué");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(
      `Supprimer définitivement « ${process.title} » ?\n\n`
      + `Les ${process.version_no} versions de l'historique et les photos partent avec.`
    )) return;
    try {
      await axios.delete(`${API_URL}/process/${id}`);
      navigate('/process');
    } catch (err) {
      alert(err.response?.data?.error || 'La suppression a échoué');
    }
  };

  // Une version figée se lit avec le même composant que la version courante :
  // on lui donne la même forme d'objet.
  const previewAsProcess = useMemo(() => {
    if (!previewVersion || !process) return null;
    return {
      title: previewVersion.title,
      summary: previewVersion.summary,
      status: previewVersion.status,
      version_no: previewVersion.version_no,
      category_name: previewVersion.category_name,
      category_color: previewVersion.category_color,
      created_by_name: process.created_by_name,
      created_by_email: process.created_by_email,
      created_at: process.created_at,
      // Pour une version, « dernière MAJ » = qui l'a enregistrée, et quand.
      updated_by_name: previewVersion.author_name,
      updated_by_email: previewVersion.author_email,
      updated_at: previewVersion.created_at,
      steps: previewVersion.steps || [],
    };
  }, [previewVersion, process]);

  const btn = (variant) => ({
    padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    border: variant === 'primary' ? 'none' : `1px solid ${C.grisCL}`,
    background: variant === 'primary' ? C.process : C.blanc,
    color: variant === 'primary' ? '#fff' : (variant === 'danger' ? C.rouge : C.grisF),
  });

  return (
    <AppShell currentPath="/process">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>

        {/* Barre d'actions — le titre est dans la fiche, pour qu'une ancienne
            version affiche bien le sien lorsqu'on la prévisualise. */}
        <section style={{
          padding: '16px 40px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          position: 'sticky', top: 0, zIndex: 5,
        }}>
          <Link to="/process" style={{ fontSize: 13, fontWeight: 700, color: C.grisM, textDecoration: 'none' }}>
            ← Process
          </Link>
          <div style={{ flex: 1 }} />

          {process && !editing && (
            <>
              <button onClick={() => setHistoryOpen(true)} style={btn()}>
                Historique · v{process.version_no}
              </button>
              {isAdmin && (
                <button onClick={() => setAccessOpen(true)} style={btn()}>
                  Accès{process.visibility === 'all' ? ' · tout le monde' : ''}
                </button>
              )}
              {isAdmin && <button onClick={remove} style={btn('danger')}>Supprimer</button>}
              {canWrite
                ? <button onClick={openEditor} style={btn('primary')}>Modifier</button>
                : <span style={{ fontSize: 12.5, color: C.grisM }}>Lecture seule</span>}
            </>
          )}
          {editing && (
            <span style={{ fontSize: 13, fontWeight: 700, color: C.process }}>Mode édition</span>
          )}
        </section>

        <section style={{ padding: '26px 40px 60px' }}>
          {loading && <p style={{ fontSize: 13, color: C.grisM }}>Chargement…</p>}

          {error && (
            <div style={{ padding: 14, background: '#FDECEC', color: C.rouge, borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          {!loading && !error && process && (
            editing && canWrite ? (
              <ProcessEditorPanel
                process={process}
                categories={categories}
                onSave={save}
                onCancel={closeEditor}
                saving={saving}
              />
            ) : (
              <>
                {previewVersion && (
                  <div style={{
                    maxWidth: 860, marginBottom: 18, padding: '12px 16px', borderRadius: 10,
                    background: '#FDF4E3', borderLeft: `4px solid ${C.orange}`,
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 13, color: C.grisTF, flex: 1 }}>
                      Vous consultez la <strong>version {previewVersion.version_no}</strong>, enregistrée
                      par {previewVersion.author_name || 'un auteur inconnu'} le {prettyDateTime(previewVersion.created_at)}.
                      Ce n'est pas la version en vigueur.
                    </span>
                    <button onClick={() => setPreviewVersion(null)} style={btn()}>
                      Revenir à la v{process.version_no}
                    </button>
                  </div>
                )}

                <ProcessReader process={previewAsProcess || process} />
              </>
            )
          )}
        </section>

        {process && isAdmin && (
          <ProcessAccessDrawer
            open={accessOpen}
            onClose={() => setAccessOpen(false)}
            processId={process.id}
            onChanged={fetchProcess}
          />
        )}

        {process && (
          <ProcessHistory
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            processId={process.id}
            currentVersionNo={process.version_no}
            canWrite={canWrite}
            onPreview={setPreviewVersion}
            onRestored={() => { setPreviewVersion(null); fetchProcess(); }}
          />
        )}
      </main>
    </AppShell>
  );
};

export default ProcessDetail;
