import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import AppShell from '../components/AppShell';
import { Stories as StoriesIcon } from '../components/AppIcons';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  story: '#E11D48', storyF: '#9F1239',
  vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const STATUSES = {
  awaiting_upload: { label: 'Envoi à faire', color: '#8A99A4' },
  uploaded: { label: 'En file', color: '#0071EB' },
  processing: { label: 'Compression…', color: '#E28F00' },
  ready: { label: 'Prête', color: '#4AB866' },
  error: { label: 'Erreur', color: '#DE2020' },
  archived: { label: 'Archivée', color: '#626E85' },
};

const FORMATS = {
  portrait: 'Story verticale (9:16)',
  landscape: 'Vidéo horizontale (16:9)',
};

const mo = (bytes) => (bytes ? `${(Number(bytes) / 1e6).toFixed(1).replace('.', ',')} Mo` : '—');
const duree = (s) => {
  const n = Math.round(Number(s) || 0);
  if (!n) return '—';
  return `${Math.floor(n / 60)} min ${String(n % 60).padStart(2, '0')}`;
};
const gain = (src, out) => {
  if (!src || !out) return null;
  return Math.round((1 - Number(out) / Number(src)) * 100);
};

/**
 * Envoi direct du fichier à R2 par l'URL signée. XMLHttpRequest plutôt qu'axios :
 * on veut la progression, et surtout PAS le jeton de l'app que l'intercepteur
 * axios ajouterait (R2 refuserait la requête signée).
 */
const putToR2 = (url, file, contentType, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', url);
  xhr.setRequestHeader('Content-Type', contentType);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
    ? resolve()
    : reject(new Error(`R2 a refusé l'envoi (HTTP ${xhr.status})`)));
  // status 0 = requête bloquée avant d'atteindre R2 : presque toujours la règle CORS absente.
  xhr.onerror = () => reject(new Error(
    "Envoi bloqué avant d'arriver sur R2. Vérifiez la règle CORS du bucket youvape-videos-sources (origine https://apps.youvape.fr).",
  ));
  xhr.send(file);
});

const copy = async (text) => {
  try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copiez ce lien :', text); }
};

const StoriesApp = () => {
  const [stories, setStories] = useState([]);
  const [r2Missing, setR2Missing] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', format: 'portrait', description: '', file: null });
  const [uploads, setUploads] = useState({}); // id → pourcentage envoyé
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const fileInput = useRef(null);
  const replaceInput = useRef(null);
  const replaceTarget = useRef(null);

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/stories`, { params: showArchived ? { archived: 1 } : {} });
      setStories(res.data.data || []);
      setR2Missing(res.data.r2_missing || []);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Tant qu'une compression est en file ou en cours, on rafraîchit toutes les 4 s.
  const pending = stories.some((s) => s.status === 'uploaded' || s.status === 'processing');
  useEffect(() => {
    if (!pending) return undefined;
    const t = setInterval(() => fetchData({ quiet: true }), 4000);
    return () => clearInterval(t);
  }, [pending, fetchData]);

  // Garde la fenêtre de détail à jour pendant que la liste se rafraîchit.
  useEffect(() => {
    if (!selected) return;
    const fresh = stories.find((s) => s.id === selected.id);
    if (fresh && fresh.updated_at !== selected.updated_at) setSelected((cur) => ({ ...fresh, ...pickEdits(cur) }));
  }, [stories, selected]);

  /** Envoie le fichier vers l'URL signée puis signale la fin au backend. */
  const sendFile = async (prepared, file) => {
    const id = prepared.story.id;
    setUploads((u) => ({ ...u, [id]: 0 }));
    try {
      await putToR2(prepared.upload_url, file, prepared.content_type,
        (p) => setUploads((u) => ({ ...u, [id]: p })));
      await axios.post(`${API_URL}/stories/${id}/uploaded`);
    } finally {
      setUploads((u) => { const n = { ...u }; delete n[id]; return n; });
      fetchData({ quiet: true });
    }
  };

  const createStory = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.file) return;
    setBusy(true);
    try {
      const file = form.file;
      const res = await axios.post(`${API_URL}/stories`, {
        title: form.title.trim(),
        format: form.format,
        description: form.description || null,
        filename: file.name,
        content_type: file.type || 'video/mp4',
        size: file.size,
      });
      setForm({ title: '', format: form.format, description: '', file: null });
      if (fileInput.current) fileInput.current.value = '';
      setShowForm(false);
      await fetchData({ quiet: true });
      await sendFile(res.data.data, file);
    } catch (err) {
      alert(err.response?.data?.error || err.message || "Erreur pendant l'envoi");
      fetchData({ quiet: true });
    } finally {
      setBusy(false);
    }
  };

  const askReplace = (story) => {
    replaceTarget.current = story;
    replaceInput.current?.click();
  };

  const replaceSource = async (e) => {
    const file = e.target.files?.[0];
    const story = replaceTarget.current;
    e.target.value = '';
    if (!file || !story) return;
    try {
      const res = await axios.post(`${API_URL}/stories/${story.id}/source`, {
        filename: file.name, content_type: file.type || 'video/mp4', size: file.size,
      });
      await sendFile(res.data.data, file);
    } catch (err) {
      alert(err.response?.data?.error || err.message || "Erreur pendant l'envoi");
      fetchData({ quiet: true });
    }
  };

  const action = async (story, verb, body = {}) => {
    try {
      await axios.post(`${API_URL}/stories/${story.id}/${verb}`, body);
      fetchData({ quiet: true });
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const saveDetails = async () => {
    if (!selected) return;
    try {
      const res = await axios.put(`${API_URL}/stories/${selected.id}`, pickEdits(selected));
      setSelected(res.data.data);
      fetchData({ quiet: true });
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };
  const label = { fontSize: 11, fontWeight: 600, color: C.grisM };
  const th = { padding: '10px 12px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: C.grisM, borderBottom: `1px solid ${C.grisCL}` };
  const td = { padding: '10px 12px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisCL}`, verticalAlign: 'middle' };
  const smallBtn = (color = C.grisTF) => ({
    padding: '5px 10px', marginLeft: 6, borderRadius: 7, border: `1px solid ${C.grisCL}`,
    background: C.blanc, color, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap',
  });

  return (
    <AppShell currentPath="/stories">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        <section style={{ padding: '28px 40px 20px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: C.story, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24 }}>
              <StoriesIcon />
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.grisTF, margin: 0, fontFamily: "'Tilt Warp', cursive" }}>
                Stories & Vidéos
              </h1>
              <p style={{ fontSize: 13, color: C.grisM, margin: '3px 0 0' }}>
                Envoyez une vidéo : elle est compressée automatiquement et publiée sur videos.youvape.fr,
                avec son image d'aperçu et son GIF pour les e-mails Probance.
              </p>
            </div>
            <label style={{ fontSize: 12, color: C.grisM, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Archivées
            </label>
            <button
              onClick={() => setShowForm((v) => !v)}
              disabled={r2Missing.length > 0}
              style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: C.story, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: r2Missing.length ? 0.5 : 1 }}
            >
              {showForm ? 'Annuler' : '+ Nouvelle vidéo'}
            </button>
          </div>
        </section>

        {showForm && (
          <section style={{ padding: '18px 40px', background: C.blanc, borderBottom: `1px solid ${C.grisCL}` }}>
            <form onSubmit={createStory} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
                <span style={label}>Titre *</span>
                <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="ex : Puff JNR AeroX 32K – découverte" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={label}>Format</span>
                <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} style={inputStyle}>
                  {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
                <span style={label}>Fichier vidéo *</span>
                <input ref={fileInput} type="file" accept="video/*"
                  onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} style={{ fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
                <span style={label}>Description (optionnel)</span>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
              </div>
              <button type="submit" disabled={busy || !form.title.trim() || !form.file}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: C.story, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy || !form.title.trim() || !form.file ? 0.5 : 1 }}>
                {busy ? 'Envoi…' : 'Envoyer'}
              </button>
            </form>
            {form.file && (
              <div style={{ fontSize: 12, color: C.grisM, marginTop: 8 }}>
                {form.file.name} — {mo(form.file.size)}. L'envoi part directement vers R2 : gardez cette page ouverte jusqu'à la fin.
              </div>
            )}
          </section>
        )}

        <input ref={replaceInput} type="file" accept="video/*" style={{ display: 'none' }} onChange={replaceSource} />

        <section style={{ padding: '24px 40px 60px' }}>
          {r2Missing.length > 0 && (
            <div style={{ padding: 14, borderRadius: 10, background: '#FFF4E5', color: C.orange, marginBottom: 16, fontSize: 13 }}>
              Stockage R2 non configuré sur le serveur (variables manquantes : {r2Missing.join(', ')}).
            </div>
          )}
          {error && (
            <div style={{ padding: 14, borderRadius: 10, background: '#FEE', color: C.rouge, marginBottom: 16, fontSize: 13 }}>{error}</div>
          )}

          {loading ? (
            <div style={{ color: C.grisM, fontSize: 14 }}>Chargement…</div>
          ) : stories.length === 0 ? (
            <div style={{ background: C.blanc, border: `1px dashed ${C.grisCL}`, borderRadius: 14, padding: 40, textAlign: 'center', color: C.grisM }}>
              Aucune vidéo pour le moment. Cliquez sur « + Nouvelle vidéo » pour envoyer la première.
            </div>
          ) : (
            <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 64 }} />
                    <th style={th}>Vidéo</th>
                    <th style={th}>Statut</th>
                    <th style={{ ...th, textAlign: 'right' }}>Durée</th>
                    <th style={{ ...th, textAlign: 'right' }}>Source → diffusée</th>
                    <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stories.map((s) => {
                    const st = STATUSES[s.status] || STATUSES.awaiting_upload;
                    const sending = uploads[s.id];
                    const g = gain(s.source_size, s.video_size);
                    return (
                      <tr key={s.id}>
                        <td style={td}>
                          {s.thumb_url ? (
                            <img src={s.thumb_url} alt="" width={48} height={48}
                              style={{ borderRadius: '50%', objectFit: 'cover', display: 'block', border: `2px solid ${C.story}` }} />
                          ) : (
                            <div style={{ width: 48, height: 48, borderRadius: '50%', background: C.grisTL, border: `2px dashed ${C.grisCL}` }} />
                          )}
                        </td>
                        <td style={td}>
                          <div style={{ fontWeight: 700 }}>{s.title}</div>
                          <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>
                            {s.slug} · {FORMATS[s.format] || s.format}{s.version > 1 ? ` · v${s.version}` : ''}
                          </div>
                        </td>
                        <td style={td}>
                          {sending !== undefined ? (
                            <div style={{ minWidth: 140 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.bleu, marginBottom: 4 }}>Envoi {sending} %</div>
                              <div style={{ height: 6, borderRadius: 3, background: C.grisTL }}>
                                <div style={{ width: `${sending}%`, height: 6, borderRadius: 3, background: C.bleu }} />
                              </div>
                            </div>
                          ) : (
                            <>
                              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: '#fff', background: st.color }}>
                                {st.label}
                              </span>
                              {s.status === 'error' && s.error && (
                                <div style={{ fontSize: 11, color: C.rouge, marginTop: 4, maxWidth: 320 }}>{s.error}</div>
                              )}
                            </>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{duree(s.duration_s)}</td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {mo(s.source_size)} → {mo(s.video_size)}
                          {g !== null && <div style={{ fontSize: 11, color: C.vert, fontWeight: 700 }}>−{g} %</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {s.video_url && <button style={smallBtn(C.story)} onClick={() => setSelected(s)}>Voir</button>}
                          {s.gif_url && <button style={smallBtn()} onClick={() => copy(s.gif_url)} title="URL du GIF animé, à coller dans Probance">GIF Probance</button>}
                          {sending === undefined && s.status !== 'processing' && s.status !== 'archived' && (
                            <button style={smallBtn()} onClick={() => askReplace(s)}>
                              {s.status === 'awaiting_upload' ? 'Envoyer la vidéo' : 'Remplacer'}
                            </button>
                          )}
                          {(s.status === 'ready' || s.status === 'error') && s.source_size && (
                            <button style={smallBtn()} onClick={() => action(s, 'reprocess')}>Recompresser</button>
                          )}
                          {s.status === 'archived' ? (
                            <button style={smallBtn()} onClick={() => action(s, 'archive', { archived: false })}>Restaurer</button>
                          ) : s.status !== 'processing' && (
                            <button style={smallBtn(C.rouge)} onClick={() => {
                              if (window.confirm(`Archiver « ${s.title} » ? Les fichiers restent en ligne (e-mails déjà envoyés).`)) action(s, 'archive');
                            }}>Archiver</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected && (
          <div onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,32,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: C.blanc, borderRadius: 16, maxWidth: 960, width: '100%', maxHeight: '92vh', overflowY: 'auto', display: 'flex', gap: 24, padding: 24, flexWrap: 'wrap' }}>
              <video key={selected.video_url} src={selected.video_url} poster={selected.poster_url || undefined} controls playsInline
                style={{ width: selected.format === 'landscape' ? 480 : 300, maxWidth: '100%', borderRadius: 12, background: '#000', alignSelf: 'flex-start' }} />
              <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 16, color: C.grisTF }}>{selected.slug}</strong>
                  <button onClick={() => setSelected(null)} style={{ ...smallBtn(), marginLeft: 0 }}>Fermer</button>
                </div>
                <Field label="Titre" value={selected.title} onChange={(v) => setSelected({ ...selected, title: v })} style={inputStyle} labelStyle={label} />
                <Field label="Description" value={selected.description} multiline onChange={(v) => setSelected({ ...selected, description: v })} style={inputStyle} labelStyle={label} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <Field label="Texte du bouton" value={selected.cta_label} placeholder="DÉCOUVRIR" onChange={(v) => setSelected({ ...selected, cta_label: v })} style={inputStyle} labelStyle={label} />
                  <Field label="ID produit WooCommerce" value={selected.wp_product_id} placeholder="ex : 1174152" onChange={(v) => setSelected({ ...selected, wp_product_id: v })} style={inputStyle} labelStyle={label} />
                </div>
                <Field label="Lien du bouton" value={selected.cta_url} placeholder="https://www.youvape.fr/produit/…" onChange={(v) => setSelected({ ...selected, cta_url: v })} style={inputStyle} labelStyle={label} />
                <button onClick={saveDetails}
                  style={{ alignSelf: 'flex-start', padding: '9px 18px', borderRadius: 8, border: 'none', background: C.story, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Enregistrer
                </button>
                <div style={{ borderTop: `1px solid ${C.grisCL}`, paddingTop: 12, fontSize: 12, color: C.grisM, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <strong style={{ color: C.grisTF }}>Fichiers publiés (version {selected.version})</strong>
                  <LinkRow label={`Vidéo MP4 — ${mo(selected.video_size)}`} url={selected.video_url} />
                  <LinkRow label="Image d'aperçu" url={selected.poster_url} />
                  <LinkRow label="Vignette (bulle)" url={selected.thumb_url} />
                  <LinkRow label={`GIF e-mail Probance — ${mo(selected.gif_size)}`} url={selected.gif_url} />
                  {selected.gif_url && <img src={selected.gif_url} alt="GIF e-mail" style={{ width: 135, borderRadius: 8, marginTop: 4 }} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
};

/** Champs modifiables envoyés au backend (le reste de la story est en lecture seule). */
const pickEdits = (s) => ({
  title: s.title,
  description: s.description ?? '',
  cta_label: s.cta_label ?? '',
  cta_url: s.cta_url ?? '',
  wp_product_id: s.wp_product_id ?? '',
});

const Field = ({ label, value, onChange, placeholder, multiline, style, labelStyle }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
    <span style={labelStyle}>{label}</span>
    {multiline ? (
      <textarea rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ ...style, resize: 'vertical', fontFamily: 'inherit' }} />
    ) : (
      <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={style} />
    )}
  </label>
);

const LinkRow = ({ label, url }) => (url ? (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ flex: 1 }}>{label}</span>
    <a href={url} target="_blank" rel="noreferrer" style={{ color: '#0071EB' }}>Ouvrir</a>
    <button onClick={() => copy(url)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #E2E2E2', background: '#fff', cursor: 'pointer', fontSize: 11 }}>
      Copier
    </button>
  </div>
) : null);

export default StoriesApp;
