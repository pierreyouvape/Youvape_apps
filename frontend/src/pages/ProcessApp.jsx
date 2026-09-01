import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { AuthContext } from '../context/AuthContext';
import { Process as ProcessIcon } from '../components/AppIcons';
import ProcessAccessPanel from '../components/process/ProcessAccessPanel';
import {
  API_URL, C, STATUSES, statusInfo, prettyDateTime, initials,
} from '../components/process/processConstants';

/* ─── Pastille d'auteur ─────────────────────────────────────────────────── */
function AuthorChip({ name, email, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.grisF }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', background: C.processL, color: C.processF,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9.5, fontWeight: 800, flexShrink: 0,
      }}>
        {initials(name, email)}
      </span>
      {label}
    </span>
  );
}

/* ─── Gestion des catégories ────────────────────────────────────────────── */
function CategoryManager({ categories, onChanged, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#135E84');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/process/categories`, { name: name.trim(), color });
      setName('');
      onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la création');
    } finally { setBusy(false); }
  };

  const rename = async (cat) => {
    const next = window.prompt('Nouveau nom de la catégorie', cat.name);
    if (next === null || !next.trim() || next.trim() === cat.name) return;
    try {
      await axios.put(`${API_URL}/process/categories/${cat.id}`, { name: next.trim(), color: cat.color });
      onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur au renommage');
    }
  };

  const remove = async (cat) => {
    const warn = cat.processes_count > 0
      ? `\n\n${cat.processes_count} process y sont rattachés : ils ne seront pas supprimés, ils se retrouveront « sans catégorie ».`
      : '';
    if (!window.confirm(`Supprimer la catégorie « ${cat.name} » ?${warn}`)) return;
    try {
      await axios.delete(`${API_URL}/process/categories/${cat.id}`);
      onChanged();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur à la suppression');
    }
  };

  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12,
      padding: 18, marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: C.grisTF, margin: 0, flex: 1 }}>Catégories</h2>
        <button onClick={onClose} style={{ border: 'none', background: 'none', color: C.grisM, fontSize: 13, cursor: 'pointer' }}>
          Fermer
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {categories.map((cat) => (
          <div key={cat.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '6px 10px', background: C.grisTL,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: cat.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>{cat.name}</span>
            <span style={{ fontSize: 11.5, color: C.grisM }}>({cat.processes_count})</span>
            <button onClick={() => rename(cat)} title="Renommer"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.grisM, fontSize: 12 }}>✎</button>
            <button onClick={() => remove(cat)} title="Supprimer"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.rouge, fontSize: 13 }}>×</button>
          </div>
        ))}
        {categories.length === 0 && <span style={{ fontSize: 13, color: C.grisM }}>Aucune catégorie.</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          placeholder="Nouvelle catégorie"
          style={{ padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8, fontSize: 13, flex: 1, maxWidth: 260 }}
        />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
          style={{ width: 38, height: 34, border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: 2, cursor: 'pointer' }} />
        <button onClick={add} disabled={busy || !name.trim()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', background: C.process, color: '#fff',
            fontWeight: 700, fontSize: 13, cursor: busy || !name.trim() ? 'default' : 'pointer',
            opacity: busy || !name.trim() ? 0.5 : 1,
          }}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
const ProcessApp = () => {
  const navigate = useNavigate();
  // Créer un process, c'est décider qui le voit : réservé aux admins.
  const { isAdmin } = useContext(AuthContext);
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');       // '' = tout sauf archivés
  const [showCategories, setShowCategories] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', summary: '', category_id: '' });
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState([]);
  const [accessDraft, setAccessDraft] = useState({ visibility: 'restricted', access: [] });

  const fetchCategories = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/process/categories`);
      setCategories(res.data.data || []);
    } catch { /* la liste des process reste utilisable sans les catégories */ }
  }, []);

  const fetchProcesses = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_URL}/process`, {
        params: { q: q || undefined, category_id: categoryId || undefined, status: status || undefined },
      });
      setProcesses(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [q, categoryId, status]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // Liste des personnes à qui donner accès. Inutile de la charger pour un
  // non-admin : il ne voit jamais le sélecteur.
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/users/agents`);
        setAgents(res.data.users || []);
      } catch { /* le formulaire reste utilisable, sans sélecteur d'accès */ }
    })();
  }, [isAdmin]);

  // Recherche : on laisse retomber la frappe avant d'interroger le serveur.
  useEffect(() => {
    const t = setTimeout(fetchProcesses, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchProcesses, q]);

  const create = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const res = await axios.post(`${API_URL}/process`, {
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        category_id: form.category_id || null,
        visibility: accessDraft.visibility,
        access: accessDraft.access,
      });
      // On enchaîne directement sur la rédaction des étapes.
      navigate(`/process/${res.data.data.id}?edit=1`);
    } catch (err) {
      alert(err.response?.data?.error || "Erreur à la création");
      setSaving(false);
    }
  };

  // Regroupement par catégorie, dans l'ordre renvoyé par le serveur.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const p of processes) {
      const key = p.category_id || 'none';
      if (!map.has(key)) {
        map.set(key, {
          id: p.category_id,
          name: p.category_name || 'Sans catégorie',
          color: p.category_color || C.grisM,
          items: [],
        });
      }
      map.get(key).items.push(p);
    }
    return [...map.values()];
  }, [processes]);

  const inputStyle = {
    padding: '9px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };

  const chip = (active, color) => ({
    padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
    border: `1px solid ${active ? color : C.grisCL}`,
    background: active ? color : C.blanc,
    color: active ? '#fff' : C.grisF,
  });

  return (
    <AppShell currentPath="/process">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>

        {/* En-tête */}
        <section style={{ padding: '28px 40px 20px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12, background: C.process,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24,
            }}>
              <ProcessIcon size={26} />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Process
              </h1>
              <p style={{ fontSize: 13, color: C.grisM, margin: '3px 0 0' }}>
                Les procédures internes, étape par étape, avec les captures d'écran qui vont avec.
                Chaque modification est datée, signée et réversible.
              </p>
            </div>
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowCategories((v) => !v)}
                  style={{ padding: '10px 16px', borderRadius: 9, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  Catégories
                </button>
                <button
                  onClick={() => setShowForm((v) => !v)}
                  style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: C.process, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
                >
                  {showForm ? 'Annuler' : '+ Nouveau process'}
                </button>
              </>
            )}
          </div>

          {showForm && (
            <form onSubmit={create} style={{
              marginTop: 18, padding: 16, background: C.grisTL, borderRadius: 10,
            }}>
             <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 280px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Titre</span>
                <input
                  autoFocus value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ex. Supprimer un client sur WooCommerce"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 320px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Résumé (facultatif)</span>
                <input
                  value={form.summary}
                  onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                  placeholder="À quoi sert cette procédure, en une phrase"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.grisF }}>Catégorie</span>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
                  style={{ ...inputStyle, minWidth: 170 }}
                >
                  <option value="">Sans catégorie</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
             </div>

              <div style={{ marginTop: 16 }}>
                <ProcessAccessPanel
                  users={agents}
                  visibility={accessDraft.visibility}
                  access={accessDraft.access}
                  onChange={setAccessDraft}
                />
              </div>

              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={saving || !form.title.trim()}
                  style={{
                    padding: '10px 20px', borderRadius: 9, border: 'none', background: C.process, color: '#fff',
                    fontWeight: 700, fontSize: 13,
                    cursor: saving || !form.title.trim() ? 'default' : 'pointer',
                    opacity: saving || !form.title.trim() ? 0.5 : 1,
                  }}>
                  {saving ? 'Création…' : 'Créer et rédiger'}
                </button>
              </div>
            </form>
          )}
        </section>

        <section style={{ padding: '20px 40px 40px' }}>
          {showCategories && (
            <CategoryManager
              categories={categories}
              onChanged={() => { fetchCategories(); fetchProcesses(); }}
              onClose={() => setShowCategories(false)}
            />
          )}

          {/* Filtres */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher dans les titres et le contenu des étapes…"
              style={{ ...inputStyle, flex: '1 1 320px', maxWidth: 460 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span onClick={() => setCategoryId('')} style={chip(categoryId === '', C.process)}>Toutes</span>
              {categories.map((c) => (
                <span key={c.id} onClick={() => setCategoryId(String(c.id))} style={chip(categoryId === String(c.id), c.color)}>
                  {c.name}
                </span>
              ))}
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, minWidth: 150 }}>
              <option value="">Actifs (hors archivés)</option>
              {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              <option value="all">Tous, archivés compris</option>
            </select>
          </div>

          {error && (
            <div style={{ padding: 14, background: '#FDECEC', color: C.rouge, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              {error}
            </div>
          )}

          {loading && <p style={{ fontSize: 13, color: C.grisM }}>Chargement…</p>}

          {!loading && processes.length === 0 && (
            <div style={{
              padding: '48px 24px', textAlign: 'center', background: C.blanc,
              border: `1px dashed ${C.grisCL}`, borderRadius: 12,
            }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.grisTF, margin: '0 0 6px' }}>
                {q || categoryId || status ? 'Aucun process ne correspond' : 'Aucun process visible'}
              </p>
              <p style={{ fontSize: 13, color: C.grisM, margin: 0 }}>
                {q || categoryId || status
                  ? 'Essayez d\'élargir la recherche ou les filtres.'
                  : isAdmin
                    ? 'Commencez par « Nouveau process » : un titre, puis les étapes.'
                    : 'Aucun process ne vous a encore été partagé. Demandez un accès à un administrateur.'}
              </p>
            </div>
          )}

          {!loading && grouped.map((group) => (
            <div key={group.id || 'none'} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: group.color }} />
                <h2 style={{ fontSize: 14, fontWeight: 800, color: C.grisTF, margin: 0 }}>{group.name}</h2>
                <span style={{ fontSize: 12, color: C.grisM }}>{group.items.length}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                {group.items.map((p) => {
                  const st = statusInfo(p.status);
                  return (
                    <article
                      key={p.id}
                      onClick={() => navigate(`/process/${p.id}`)}
                      style={{
                        background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 12,
                        padding: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
                        borderLeft: `4px solid ${group.color}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: C.grisTF, margin: 0, flex: 1, lineHeight: 1.35 }}>
                          {p.title}
                        </h3>
                        <span style={{
                          padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 800,
                          background: `${st.color}1A`, color: st.color, whiteSpace: 'nowrap',
                        }}>
                          {st.label}
                        </span>
                      </div>

                      {p.summary && (
                        <p style={{ fontSize: 13, color: C.grisF, margin: 0, lineHeight: 1.5 }}>{p.summary}</p>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 6 }}>
                        <span style={{ fontSize: 12, color: C.grisM }}>
                          {p.steps_count} étape{p.steps_count > 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: 12, color: C.grisM }}>v{p.version_no}</span>
                        {isAdmin && (
                          <span
                            title={p.visibility === 'all'
                              ? 'Lisible par tous les détenteurs de l\'app'
                              : 'Visible uniquement par les personnes autorisées'}
                            style={{
                              fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                              background: p.visibility === 'all' ? C.grisTL : C.processL,
                              color: p.visibility === 'all' ? C.grisF : C.processF,
                            }}
                          >
                            {p.visibility === 'all'
                              ? 'Tout le monde'
                              : `${p.access_count} accès`}
                          </span>
                        )}
                        <AuthorChip
                          name={p.updated_by_name} email={null}
                          label={`MAJ ${prettyDateTime(p.updated_at)}`}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </main>
    </AppShell>
  );
};

export default ProcessApp;
