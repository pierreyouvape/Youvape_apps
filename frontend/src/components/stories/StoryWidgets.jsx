import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  story: '#E11D48',
  vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const LAYOUTS = {
  bubbles: 'Bulles (fiches produit)',
  cards: 'Carrousel de cartes (pages)',
};

const dateFr = (v) => (v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const errMsg = (err) => err.response?.data?.error || err.message || 'Erreur';

// Le style global de l'app peint tous les boutons en blanc sur bleu : chaque
// bouton d'ici fixe donc explicitement sa couleur de texte ET de fond.
const btn = (variant = 'ghost') => ({
  padding: '6px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  border: variant === 'primary' ? 'none' : `1px solid ${C.grisCL}`,
  background: variant === 'primary' ? C.story : C.blanc,
  color: variant === 'primary' ? '#fff' : variant === 'danger' ? C.rouge : C.grisTF,
  fontWeight: variant === 'primary' ? 700 : 400,
});
const inputStyle = {
  padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
  fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
};
const labelStyle = { fontSize: 11, fontWeight: 600, color: C.grisM };
const card = { background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: 18 };

const Thumb = ({ url, size = 36 }) => (url ? (
  <img src={url} alt="" width={size} height={size}
    style={{ borderRadius: '50%', objectFit: 'cover', border: `2px solid ${C.story}`, flexShrink: 0 }} />
) : (
  <div style={{ width: size, height: size, borderRadius: '50%', background: C.grisTL, border: `2px dashed ${C.grisCL}`, flexShrink: 0 }} />
));

/** Onglet « Widgets » : composer les bulles / carrousels et les publier sur le site. */
const StoryWidgets = ({ stories }) => {
  const [widgets, setWidgets] = useState([]);
  const [publication, setPublication] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null); // null = fermé
  const [selectedId, setSelectedId] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/stories/widgets`);
      setWidgets(res.data.data || []);
      setPublication(res.data.publication || null);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const createWidget = async (e) => {
    e.preventDefault();
    if (!form?.title?.trim()) return;
    try {
      const res = await axios.post(`${API_URL}/stories/widgets`, { title: form.title.trim(), layout: form.layout });
      setForm(null);
      await fetchList();
      setSelectedId(res.data.data.id);
    } catch (err) {
      alert(errMsg(err));
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const res = await axios.post(`${API_URL}/stories/publish`);
      setLastResult(res.data.data);
      fetchList();
    } catch (err) {
      alert(errMsg(err));
    } finally {
      setPublishing(false);
    }
  };

  const last = publication?.last;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ padding: 14, borderRadius: 10, background: '#FEE', color: C.rouge, fontSize: 13 }}>{error}</div>}

      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260, fontSize: 13, color: C.grisTF }}>
          <strong>Publication sur le site</strong>
          <div style={{ color: C.grisM, marginTop: 3 }}>
            {last
              ? `Dernière publication le ${dateFr(last.published_at)}${last.published_by_email ? ` par ${last.published_by_email}` : ''} — ${last.widgets_count} widget(s), ${last.stories_count} vidéo(s).`
              : 'Rien n’a encore été publié.'}
            {' '}Les modifications ne partent sur le site qu’après « Publier ».
          </div>
        </div>
        {publication?.pending && (
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#fff', background: C.orange }}>
            Modifications non publiées
          </span>
        )}
        <button onClick={publish} disabled={publishing} style={{ ...btn('primary'), padding: '10px 18px', fontSize: 13, opacity: publishing ? 0.6 : 1 }}>
          {publishing ? 'Publication…' : 'Publier sur le site'}
        </button>
        {lastResult && (
          <div style={{ width: '100%', fontSize: 12, color: C.vert }}>
            Publié : {lastResult.widgets} widget(s) sur {lastResult.products} fiche(s) produit et {lastResult.pages} page(s), {lastResult.stories} vidéo(s).
            {lastResult.empty_widgets?.length > 0 && (
              <span style={{ color: C.orange }}> Widgets vides non publiés : {lastResult.empty_widgets.join(', ')}.</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ flex: 1, fontSize: 15, color: C.grisTF }}>Widgets</strong>
        <button onClick={() => setForm(form ? null : { title: '', layout: 'bubbles' })} style={btn(form ? 'ghost' : 'primary')}>
          {form ? 'Annuler' : '+ Nouveau widget'}
        </button>
      </div>

      {form && (
        <form onSubmit={createWidget} style={{ ...card, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
            <span style={labelStyle}>Nom *</span>
            <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="ex : Puff AeroX 32K – découverte" style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Format</span>
            <select value={form.layout} onChange={(e) => setForm({ ...form, layout: e.target.value })} style={inputStyle}>
              {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!form.title.trim()} style={{ ...btn('primary'), padding: '9px 18px', opacity: form.title.trim() ? 1 : 0.5 }}>Créer</button>
        </form>
      )}

      {widgets.length === 0 ? (
        <div style={{ ...card, border: `1px dashed ${C.grisCL}`, textAlign: 'center', color: C.grisM, padding: 40 }}>
          Aucun widget. Un widget regroupe des vidéos dans l’ordre voulu et s’affiche sur des fiches produit ou des pages.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {widgets.map((w) => (
            <div key={w.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, outline: selectedId === w.id ? `2px solid ${C.story}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ flex: 1, fontSize: 14, color: C.grisTF }}>{w.title}</strong>
                <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#fff', background: w.status === 'published' ? C.vert : C.grisM }}>
                  {w.status === 'published' ? 'Publié' : 'Brouillon'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.grisM }}>{w.slug} · {LAYOUTS[w.layout]}</div>
              <div style={{ display: 'flex', gap: 4, minHeight: 36 }}>
                {(w.thumbs || []).map((t) => <Thumb key={t} url={t} />)}
              </div>
              <div style={{ fontSize: 12, color: C.grisTF }}>
                {w.stories_count} vidéo(s) · {w.placements_count} emplacement(s)
              </div>
              <button onClick={() => setSelectedId(selectedId === w.id ? null : w.id)} style={{ ...btn(), alignSelf: 'flex-start' }}>
                {selectedId === w.id ? 'Fermer' : 'Modifier'}
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <WidgetEditor
          key={selectedId}
          id={selectedId}
          stories={stories}
          onChanged={fetchList}
          onDeleted={() => { setSelectedId(null); fetchList(); }}
        />
      )}
    </div>
  );
};

/** Édition d'un widget : réglages, vidéos dans l'ordre, emplacements. */
const WidgetEditor = ({ id, stories, onChanged, onDeleted }) => {
  const [w, setW] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [addStory, setAddStory] = useState('');
  const [pagePath, setPagePath] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const searchTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/stories/widgets/${id}`);
      setW(res.data.data);
      setDraft({ title: res.data.data.title, layout: res.data.data.layout });
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const apply = (res) => { setW(res.data.data); onChanged(); };

  const run = async (fn) => {
    try { apply(await fn()); } catch (err) { alert(errMsg(err)); }
  };

  const saveSettings = (extra = {}) => run(() => axios.put(`${API_URL}/stories/widgets/${id}`, { ...draft, ...extra }));

  const setOrder = (ids) => run(() => axios.put(`${API_URL}/stories/widgets/${id}/stories`, { story_ids: ids }));

  const move = (index, delta) => {
    const ids = w.stories.map((s) => s.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    setOrder(ids);
  };

  const addPlacement = (target_type, target_ref) => run(
    () => axios.post(`${API_URL}/stories/widgets/${id}/placements`, { target_type, target_ref }),
  );

  // Recherche produit avec un petit délai, pour ne pas interroger à chaque lettre.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setResults([]); return undefined; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/stories/products/search`, { params: { q: query.trim() } });
        setResults(res.data.data || []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const remove = async () => {
    if (!window.confirm(`Supprimer le widget « ${w.title} » ? Il disparaîtra du site à la prochaine publication.`)) return;
    try {
      await axios.delete(`${API_URL}/stories/widgets/${id}`);
      onDeleted();
    } catch (err) {
      alert(errMsg(err));
    }
  };

  if (error) return <div style={{ ...card, color: C.rouge }}>{error}</div>;
  if (!w || !draft) return <div style={{ ...card, color: C.grisM }}>Chargement…</div>;

  const inWidget = new Set(w.stories.map((s) => s.id));
  const available = stories.filter((s) => s.status === 'ready' && !inWidget.has(s.id));
  const products = w.placements.filter((p) => p.target_type === 'product');
  const pages = w.placements.filter((p) => p.target_type === 'page');

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
          <span style={labelStyle}>Nom</span>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Format</span>
          <select value={draft.layout} onChange={(e) => setDraft({ ...draft, layout: e.target.value })} style={inputStyle}>
            {Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button onClick={() => saveSettings()} style={{ ...btn('primary'), padding: '9px 16px' }}>Enregistrer</button>
        {w.status === 'published' ? (
          <button onClick={() => saveSettings({ status: 'draft' })} style={btn()}>Repasser en brouillon</button>
        ) : (
          <button onClick={() => saveSettings({ status: 'published' })} style={{ ...btn(), color: C.vert, borderColor: C.vert }}>Marquer « Publié »</button>
        )}
        <button onClick={remove} style={btn('danger')}>Supprimer</button>
      </div>
      <div style={{ fontSize: 12, color: C.grisM }}>
        Code à insérer dans une page WordPress : <code style={{ background: C.grisTL, padding: '2px 6px', borderRadius: 4 }}>[yv_stories widget="{w.slug}"]</code>
        {' '}· Un widget « Brouillon » n’est jamais envoyé sur le site.
      </div>

      <section>
        <strong style={{ fontSize: 13, color: C.grisTF }}>Vidéos, dans l’ordre d’affichage</strong>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {w.stories.length === 0 && <div style={{ fontSize: 12, color: C.grisM }}>Aucune vidéo pour l’instant.</div>}
          {w.stories.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: C.grisTL }}>
              <span style={{ width: 18, fontSize: 12, color: C.grisM, textAlign: 'right' }}>{i + 1}</span>
              <Thumb url={s.thumb_url} />
              <div style={{ flex: 1, fontSize: 13, color: C.grisTF }}>
                {s.title}
                {s.status !== 'ready' && <span style={{ marginLeft: 8, fontSize: 11, color: C.orange }}>(pas prête : ne sera pas affichée)</span>}
              </div>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btn(), opacity: i === 0 ? 0.4 : 1 }} title="Monter">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === w.stories.length - 1} style={{ ...btn(), opacity: i === w.stories.length - 1 ? 0.4 : 1 }} title="Descendre">↓</button>
              <button onClick={() => setOrder(w.stories.filter((x) => x.id !== s.id).map((x) => x.id))} style={btn('danger')} title="Retirer du widget">Retirer</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <select value={addStory} onChange={(e) => setAddStory(e.target.value)} style={{ ...inputStyle, flex: 1, maxWidth: 420 }}>
            <option value="">Ajouter une vidéo prête…</option>
            {available.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <button disabled={!addStory} onClick={() => { setOrder([...w.stories.map((s) => s.id), Number(addStory)]); setAddStory(''); }}
            style={{ ...btn('primary'), opacity: addStory ? 1 : 0.5 }}>Ajouter</button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <div>
          <strong style={{ fontSize: 13, color: C.grisTF }}>Fiches produit</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {products.length === 0 && <div style={{ fontSize: 12, color: C.grisM }}>Aucune fiche produit.</div>}
            {products.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.grisTF }}>
                <span style={{ flex: 1 }}>
                  {p.post_title || `Produit #${p.target_ref}`}
                  <span style={{ color: C.grisM, fontSize: 11 }}> · #{p.target_ref}{p.post_status && p.post_status !== 'publish' ? ` · ${p.post_status}` : ''}</span>
                </span>
                <button onClick={() => run(() => axios.delete(`${API_URL}/stories/widgets/${id}/placements/${p.id}`))} style={btn('danger')}>Retirer</button>
              </div>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher un produit (nom, SKU ou ID)…"
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 10 }} />
          {results.length > 0 && (
            <div style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
              {results.map((r) => (
                <div key={r.wp_product_id} onClick={() => { addPlacement('product', r.wp_product_id); setQuery(''); setResults([]); }}
                  style={{ padding: '7px 10px', fontSize: 13, color: C.grisTF, cursor: 'pointer', borderBottom: `1px solid ${C.grisTL}` }}>
                  {r.post_title}
                  <span style={{ color: C.grisM, fontSize: 11 }}> · #{r.wp_product_id} · {r.product_type}{r.post_status !== 'publish' ? ` · ${r.post_status}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <strong style={{ fontSize: 13, color: C.grisTF }}>Pages</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {pages.length === 0 && <div style={{ fontSize: 12, color: C.grisM }}>Aucune page.</div>}
            {pages.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.grisTF }}>
                <span style={{ flex: 1, fontFamily: 'monospace' }}>{p.target_ref}</span>
                <button onClick={() => run(() => axios.delete(`${API_URL}/stories/widgets/${id}/placements/${p.id}`))} style={btn('danger')}>Retirer</button>
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (pagePath.trim()) { addPlacement('page', pagePath.trim()); setPagePath(''); } }}
            style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input value={pagePath} onChange={(e) => setPagePath(e.target.value)} placeholder="/youvape-awards ou l’adresse complète"
              style={{ ...inputStyle, flex: 1 }} />
            <button type="submit" disabled={!pagePath.trim()} style={{ ...btn('primary'), opacity: pagePath.trim() ? 1 : 0.5 }}>Ajouter</button>
          </form>
        </div>
      </section>
    </div>
  );
};

export default StoryWidgets;
