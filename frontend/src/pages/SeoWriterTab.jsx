import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';

/*
 * Onglet « Rédaction SEO » de l'app Suivi SEO : une page à la fois.
 * Données (page en ligne, Search Console, Google Ads) → rédaction (brief ou
 * génération) → vérification de la page publiée → suivi des positions daté.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', violet: '#7C3AED',
};
const LINE_COLORS = ['#135E84', '#E28F00', '#7C3AED', '#059669', '#DE2020', '#0EA5A5', '#B45309', '#4F46E5', '#64748B', '#DB2777'];

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);
const fmtPos = (p) => (p === null || p === undefined || p === '' ? '—' : Number(p).toFixed(1).replace('.', ','));
const shortDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '');
const longDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');
const pathOf = (url) => (url || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/';
const errMsg = (e) => e.response?.data?.error || e.message;

const STATUSES = [
  { value: 'analyse', label: 'Données', color: '#64748B' },
  { value: 'redaction', label: 'En rédaction', color: C.bleu },
  { value: 'avocat', label: 'Chez l’avocat', color: C.orange },
  { value: 'publie', label: 'Publié', color: C.vert },
  { value: 'abandon', label: 'Abandonné', color: C.grisM },
];
const statusOf = (v) => STATUSES.find((s) => s.value === v) || STATUSES[0];

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: C.grisM, fontWeight: 600, borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}` };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const btn = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 };
const btnPrimary = { ...btn, border: 'none', background: C.saphir, color: C.blanc };
const input = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13 };

function Card({ children, style }) {
  return (
    <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px', ...style }}>
      {children}
    </div>
  );
}

function PosDelta({ current, previous }) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return <span style={{ color: C.grisM }}>—</span>;
  }
  const gain = Number(previous) - Number(current);
  if (Math.abs(gain) < 0.05) return <span style={{ color: C.grisM }}>=</span>;
  const up = gain > 0;
  return (
    <span style={{ color: up ? C.vert : C.rouge, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {up ? '▲' : '▼'} {Math.abs(gain).toFixed(1).replace('.', ',')}
    </span>
  );
}

function StatusBadge({ value }) {
  const s = statusOf(value);
  return <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: s.color, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>{s.label}</span>;
}

function CopyButton({ text, label = 'Copier' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* presse-papiers refusé */ }
  };
  return <button type="button" onClick={copy} style={{ ...btn, padding: '4px 10px', fontSize: 12 }}>{done ? 'Copié ✓' : label}</button>;
}

const IDLE_WARNING_S = 45;

/* Avancement d'une analyse : étape, fiche en cours, temps écoulé, alerte si rien ne bouge. */
function AnalysisProgress({ progress, name = 'Analyse' }) {
  if (!progress) return null;
  const { step = 0, steps = 4, label, done, total, current, elapsed = 0, idle = 0, error } = progress;
  const inStep = total ? (done || 0) / total : 0;
  const pct = Math.min(100, Math.round(((Math.max(step, 1) - 1 + inStep) / steps) * 100));
  const stuck = idle >= IDLE_WARNING_S;
  return (
    <Card style={{ marginBottom: 14, borderColor: error || stuck ? C.rouge : C.violet }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        {!error && (
          <span style={{
            width: 16, height: 16, borderRadius: '50%', border: `3px solid ${C.grisCL}`, borderTopColor: C.violet,
            display: 'inline-block', animation: 'seo-spin 0.9s linear infinite',
          }} />
        )}
        <b style={{ fontSize: 14, color: error ? C.rouge : C.saphirF }}>
          {error ? `${name} en échec : ${error}` : `${name} — étape ${Math.max(step, 1)} sur ${steps} : ${label || 'démarrage'}`}
        </b>
        {total ? <span style={{ fontSize: 13, color: C.grisF }}>{done} / {total}{current ? ` · ${current}` : ''}</span> : null}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.grisM }}>{elapsed} s</span>
      </div>
      {!error && (
        <div style={{ height: 8, background: C.grisTL, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.violet, transition: 'width 0.6s ease' }} />
        </div>
      )}
      {stuck && !error && (
        <div style={{ fontSize: 12, color: C.rouge, marginTop: 8 }}>
          Aucune avancée depuis {idle} s : une page du site ne répond peut-être pas. Patientez encore un peu, ou relancez.
        </div>
      )}
      <style>{'@keyframes seo-spin { to { transform: rotate(360deg); } }'}</style>
    </Card>
  );
}

/* Interroge l'avancement d'une tâche de fond chaque seconde tant qu'elle tourne. */
function useJobProgress(id, kind, initial, onDone) {
  const [progress, setProgress] = useState(null);
  const running = !!(progress?.running || (progress === null && initial?.running));
  useEffect(() => {
    if (!running) return undefined;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const { data } = await axios.get(`${API_URL}/seo/writer/${id}/progress`, { params: { kind } });
        if (cancelled) return;
        setProgress(data);
        if (!data.running) onDone(data);
      } catch { /* le prochain tour réessaie */ }
    }, 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [running, id, kind, onDone]);
  return [progress, setProgress, running];
}

function PageLink({ url }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ color: C.bleu, textDecoration: 'none', wordBreak: 'break-all' }}>{pathOf(url)}</a>
  );
}

/* ─── 1. Données ────────────────────────────────────────── */

function DataPanel({ page, onSaved, onAnalyze, setMsg }) {
  const [terms, setTerms] = useState(page.topic_terms || '');
  const [onlyQuestions, setOnlyQuestions] = useState(false);
  const busy = !!page.progress?.running;
  const p = page.page || {};
  const d = page.data || {};
  const targets = new Set(page.target_queries || []);

  useEffect(() => { setTerms(page.topic_terms || ''); }, [page.topic_terms]);

  const reanalyze = async () => {
    setMsg(null);
    try {
      if (terms !== (page.topic_terms || '')) await axios.patch(`${API_URL}/seo/writer/${page.id}`, { topic_terms: terms });
      await onAnalyze();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const toggleTarget = async (query) => {
    const next = targets.has(query) ? [...targets].filter((q) => q !== query) : [...targets, query];
    try {
      const { data } = await axios.patch(`${API_URL}/seo/writer/${page.id}`, { target_queries: next });
      onSaved(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const uploadAds = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const { data } = await axios.post(`${API_URL}/seo/writer/${page.id}/ads`, form);
      onSaved(data.page);
      setMsg(`${data.added} mot(s)-clé(s) importé(s), ${data.total} au total.`);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const clearAds = async () => {
    try {
      const { data } = await axios.delete(`${API_URL}/seo/writer/${page.id}/ads`);
      onSaved(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const topic = (d.topic || []).filter((q) => !onlyQuestions || q.question);
  const ads = page.ads_view || [];

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15, color: C.saphirF }}>Page en ligne</h3>
        {!page.page && <div style={{ fontSize: 13, color: C.grisM }}>Pas encore analysée.</div>}
        {page.page && (
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 12px', fontSize: 13, color: C.grisTF }}>
            <b>Type</b><span>{p.type}</span>
            <b>Robots</b>
            <span style={{ color: /noindex/.test(p.robots || '') ? C.rouge : C.grisTF }}>{p.robots || '—'}</span>
            <b>Title</b><span>{p.title || '—'}</span>
            <b>Méta</b><span>{p.meta_description || '—'}</span>
            <b>H1</b><span>{p.h1 || '—'}</span>
            <b>Intro</b><span>{p.intro_html ? p.intro_html.replace(/<[^>]+>/g, '') : 'vide'}</span>
            <b>Bas de page</b><span>{p.word_count} mots · {p.h2?.length || 0} H2 · FAQ {p.has_faq ? 'oui' : 'non'}</span>
            <b>Produits listés</b><span>{p.products?.length || 0} (dont {d.facts?.length || 0} fiches lues pour les caractéristiques)</span>
            <b>Lien de menu</b>
            <span style={{ color: p.menu_masked ? C.rouge : C.grisTF }}>
              {p.menu_masked ? 'masqué (span obfusqué) : Google ne le suit pas, à passer en lien normal si la page est indexable' : 'normal ou absent'}
            </span>
          </div>
        )}
        {page.analyzed_at && (
          <div style={{ fontSize: 12, color: C.grisM, marginTop: 10 }}>
            Analyse du {new Date(page.analyzed_at).toLocaleString('fr-FR')}
            {d.range ? ` · Search Console du ${longDate(d.range.from)} au ${longDate(d.range.to)} (tous pays)` : ''}
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 14, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '14px 16px 8px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Requêtes du sujet</h3>
          <span style={{ fontSize: 12, color: C.grisM }}>Termes :</span>
          <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="ex. jnr + liquid|50ml" style={{ ...input, width: 240 }} />
          <button type="button" disabled={busy} onClick={reanalyze} style={btnPrimary}>{busy ? 'Analyse…' : 'Réanalyser'}</button>
          <label style={{ fontSize: 13, color: C.grisF, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyQuestions} onChange={(e) => setOnlyQuestions(e.target.checked)} /> Questions seulement
          </label>
        </div>
        <div style={{ padding: '0 16px 10px', fontSize: 12, color: C.grisM }}>
          Chaque groupe séparé par « + » doit figurer dans la requête, un mot au choix dans le groupe (séparé par « | »), sans accents.
          Cochez « Suivre » pour les requêtes visées : elles alimentent le suivi des positions.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Suivre</th>
            <th style={th}>Requête</th>
            <th style={{ ...th, textAlign: 'right' }}>Impr. 90 j</th>
            <th style={{ ...th, textAlign: 'right' }}>/ mois</th>
            <th style={{ ...th, textAlign: 'right' }}>Clics</th>
            <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
            <th style={th}>Page affichée par Google</th>
            <th style={th}>Remarque</th>
          </tr></thead>
          <tbody>
            {topic.map((q) => (
              <tr key={q.query} style={{ opacity: q.excluded ? 0.55 : 1 }}>
                <td style={td}><input type="checkbox" checked={targets.has(q.query)} onChange={() => toggleTarget(q.query)} /></td>
                <td style={td}>{q.query}</td>
                <td style={tdNum}>{fmtInt(q.impressions)}</td>
                <td style={tdNum}>{fmtInt(q.per_month)}</td>
                <td style={tdNum}>{fmtInt(q.clicks)}</td>
                <td style={tdNum}>{fmtPos(q.position)}</td>
                <td style={{ ...td, fontSize: 12 }}>
                  {q.this_page ? <b style={{ color: C.vert }}>cette page</b> : q.top_page ? <PageLink url={q.top_page} /> : '—'}
                </td>
                <td style={{ ...td, fontSize: 12, color: C.grisF }}>
                  {[q.question ? 'question' : null, q.excluded ? `écartée (${q.excluded})` : null, q.caution].filter(Boolean).join(' · ')}
                </td>
              </tr>
            ))}
            {topic.length === 0 && <tr><td style={td} colSpan={8}>Aucune requête pour ces termes.</td></tr>}
          </tbody>
        </table>
      </Card>

      {d.competitors?.length > 0 && (
        <Card style={{ marginBottom: 14, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 8px' }}>
            <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Autres pages du site qui captent ces requêtes</h3>
            <div style={{ fontSize: 12, color: C.grisM, marginTop: 4 }}>Sources naturelles d&apos;un lien vers la page (ancre = requête visée).</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Page</th><th style={{ ...th, textAlign: 'right' }}>Impr. 90 j</th><th style={th}>Robots</th><th style={th}>Requêtes</th>
            </tr></thead>
            <tbody>
              {d.competitors.map((c) => (
                <tr key={c.url}>
                  <td style={{ ...td, fontSize: 12 }}><PageLink url={c.url} /></td>
                  <td style={tdNum}>{fmtInt(c.impressions)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{c.robots || 'non relevé'}</td>
                  <td style={{ ...td, fontSize: 12, color: C.grisF }}>{c.queries.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {d.tables?.length > 0 && (
        <Card style={{ marginBottom: 14, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 16px 8px' }}>
            <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Tableaux automatiques possibles</h3>
            <div style={{ fontSize: 12, color: C.grisM, marginTop: 4 }}>
              Shortcode [product_table] du thème : une marque × une catégorie, 10 produits au plus (au-delà, les 10 plus vendus). Il se remplit depuis les fiches et se met à jour tout seul.
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Marque</th><th style={th}>Catégorie</th><th style={{ ...th, textAlign: 'right' }}>Produits</th><th style={th}>Shortcode</th><th style={th} />
            </tr></thead>
            <tbody>
              {d.tables.map((g) => (
                <tr key={`${g.brand}|${g.category}`}>
                  <td style={td}>
                    {g.brand_name || 'inconnue'}
                    {g.brand && !g.brand_ok && <div style={{ fontSize: 11, color: C.rouge }}>page marque introuvable : slug à vérifier</div>}
                  </td>
                  <td style={td}>{g.category || '—'}</td>
                  <td style={tdNum}>{g.count}{g.count > 10 ? ' (10 affichés)' : ''}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: C.grisF }}>{g.shortcode || 'impossible : tableau HTML'}</td>
                  <td style={td}>{g.shortcode && <CopyButton text={g.shortcode} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card style={{ marginBottom: 14, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '14px 16px 8px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Google Ads (volumes de recherche)</h3>
          <label style={{ ...btnPrimary, display: 'inline-block' }}>
            Importer un export CSV
            <input type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }}
              onChange={(e) => { uploadAds(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {ads.length > 0 && <button type="button" onClick={clearAds} style={btn}>Vider</button>}
          {page.ads_at && <span style={{ fontSize: 12, color: C.grisM }}>{page.ads_filename} · {new Date(page.ads_at).toLocaleString('fr-FR')}</span>}
        </div>
        <div style={{ padding: '0 16px 10px', fontSize: 12, color: C.grisM, lineHeight: 1.6 }}>
          Google Ads → Outils → Planificateur de mots-clés → <b>« Découvrir de nouveaux mots-clés »</b> (et non « Obtenir le volume »),
          mots de départ du sujet, France, français → Télécharger les idées de mots-clés (CSV). Aucune campagne n&apos;est nécessaire ;
          sans campagne active, Google arrondit les volumes par paliers. Plusieurs exports s&apos;additionnent.
        </div>
        {page.ads_seeds?.length > 0 && (
          <div style={{ margin: '0 16px 12px', padding: '10px 12px', background: C.grisTL, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 13, color: C.saphirF }}>Mots-clés à saisir dans le Planificateur pour cette page</b>
              <span style={{ marginLeft: 'auto' }}><CopyButton text={page.ads_seeds.join(', ')} label="Copier les mots-clés" /></span>
            </div>
            <div style={{ fontSize: 13, color: C.grisTF }}>{page.ads_seeds.join(', ')}</div>
            <div style={{ fontSize: 12, color: C.grisM, marginTop: 6 }}>
              {page.ads_seeds_from === 'suivies'
                ? 'Vos requêtes cochées « Suivre » (une par formulation, sans les requêtes écartées ni les questions) : la liste suit vos cases.'
                : 'Aucune requête cochée : les requêtes du sujet les plus vues (une par formulation). Cochez « Suivre » sur celles que la page doit viser, la liste suivra.'}
              {' '}Le Planificateur accepte 10 mots de départ au plus. Importez ensuite l&apos;export ici : il sera repris dans le brief de rédaction.
            </div>
          </div>
        )}
        {ads.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Mot-clé</th>
              <th style={{ ...th, textAlign: 'right' }}>Recherches / mois</th>
              <th style={{ ...th, textAlign: 'right' }}>Vos impressions / mois</th>
              <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
              <th style={th}>Lecture</th>
            </tr></thead>
            <tbody>
              {ads.map((a) => {
                const absent = !a.gsc_per_month;
                const share = a.volume ? a.gsc_per_month / a.volume : null;
                return (
                  <tr key={a.keyword} style={{ opacity: a.excluded ? 0.55 : 1 }}>
                    <td style={td}>{a.keyword}</td>
                    <td style={tdNum}>{a.volume === null ? '—' : fmtInt(a.volume)}</td>
                    <td style={tdNum}>{absent ? '—' : fmtInt(a.gsc_per_month)}</td>
                    <td style={tdNum}>{fmtPos(a.position)}</td>
                    <td style={{ ...td, fontSize: 12, color: absent ? C.rouge : C.grisF }}>
                      {a.excluded ? `écarté (${a.excluded})`
                        : absent ? 'absent de Google'
                          : share !== null && share < 0.25 ? 'peu visible (page 2 ou plus)' : 'visible'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/* ─── 2. Rédaction ──────────────────────────────────────── */

const DRAFT_BLOCKS = [
  { key: 'title', label: 'Title Yoast', rows: 1, hint: '70 caractères maximum' },
  { key: 'meta', label: 'Méta-description', rows: 2, hint: '160 caractères maximum' },
  { key: 'h1', label: 'H1', rows: 1 },
  { key: 'intro_html', label: 'Introduction (champ « Description » du terme)', rows: 4 },
  { key: 'body_html', label: 'Bas de page (texte complet)', rows: 22 },
];

function DraftPanel({ page, onSaved, setMsg }) {
  const [draft, setDraft] = useState(page.draft || {});
  const [dirty, setDirty] = useState(false);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  useEffect(() => { setDraft(page.draft || {}); setDirty(false); }, [page.draft]);

  const edit = (key, value) => { setDraft({ ...draft, [key]: value }); setDirty(true); };

  const save = async () => {
    try {
      const body = Object.fromEntries(DRAFT_BLOCKS.map((b) => [b.key, draft[b.key] || '']));
      const { data } = await axios.patch(`${API_URL}/seo/writer/${page.id}`, { draft: body });
      onSaved(data);
      setMsg('Proposition enregistrée et recontrôlée.');
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const generate = async () => {
    try {
      await axios.post(`${API_URL}/seo/writer/${page.id}/generate`);
      setMsg('Rédaction lancée (1 à 3 minutes). La page se met à jour toute seule.');
      onSaved({ ...page, gen_status: 'running' });
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const copyBrief = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/seo/writer/${page.id}/brief`);
      await navigator.clipboard.writeText(data.text);
      setMsg(`Brief copié (${fmtInt(data.text.length)} caractères). Ouvrez une NOUVELLE conversation sur claude.ai, collez-le tel quel, puis copiez le bloc json de sa réponse (bouton « Copier » du bloc) et collez-le ci-dessous.`);
      setShowPaste(true);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const importPasted = async () => {
    try {
      const { data } = await axios.post(`${API_URL}/seo/writer/${page.id}/draft-import`, { text: pasted });
      onSaved(data);
      setPasted('');
      setShowPaste(false);
      setMsg('Réponse importée.');
    } catch (e) {
      setMsg(`Réponse illisible (${errMsg(e)}) : recopiez uniquement le bloc json de la réponse, en entier. Si l’erreur persiste, demandez à Claude « Redonne uniquement l’objet JSON valide, guillemets échappés ».`);
    }
  };

  const followTargets = async () => {
    try {
      const { data } = await axios.patch(`${API_URL}/seo/writer/${page.id}`, { target_queries: draft.requetes_visees || [] });
      onSaved(data);
      setMsg('Requêtes visées ajoutées au suivi.');
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const running = page.gen_status === 'running';
  const lintColor = { error: C.rouge, warn: C.orange, info: C.grisF, ok: C.vert };
  const lintIcon = { error: '✗', warn: '!', info: 'i', ok: '✓' };

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {page.aiConfigured ? (
            <button type="button" disabled={running || !page.data} onClick={generate} style={btnPrimary}>
              {running ? 'Rédaction en cours…' : page.draft ? 'Rédiger une nouvelle proposition' : 'Rédiger la proposition'}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: C.grisF }}>
              Génération automatique inactive (clé d&apos;API Claude à poser sur le serveur).
            </span>
          )}
          <button type="button" disabled={!page.data} onClick={copyBrief} style={btn}>Copier le brief</button>
          <button type="button" onClick={() => setShowPaste(!showPaste)} style={btn}>Coller une réponse</button>
          {page.gen_status === 'error' && <span style={{ fontSize: 13, color: C.rouge }}>Échec : {page.gen_error}</span>}
          {draft.generated_at && (
            <span style={{ fontSize: 12, color: C.grisM, marginLeft: 'auto' }}>
              {draft.source === 'api' ? `Rédigée par ${draft.model}` : 'Réponse collée'} le {new Date(draft.generated_at).toLocaleString('fr-FR')}
              {draft.edited_at ? ` · modifiée par ${page.draft_edited_by_name || draft.edited_by || '—'} le ${new Date(draft.edited_at).toLocaleString('fr-FR')}` : ''}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.grisM, marginTop: 8 }}>
          Le brief réunit la méthode (structure, code du thème, règles DNF) et toutes les données de l&apos;onglet Données :
          il sert aussi bien à la génération qu&apos;à une rédaction dans Claude. Tout texte passe par l&apos;avocat avant la mise en ligne.
        </div>
        {showPaste && (
          <div style={{ marginTop: 10 }}>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder="Réponse JSON de Claude"
              style={{ ...input, width: '100%', fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box' }} />
            <button type="button" disabled={!pasted.trim()} onClick={importPasted} style={{ ...btnPrimary, marginTop: 6 }}>Importer</button>
          </div>
        )}
      </Card>

      {page.lint?.length > 0 && page.draft && (
        <Card style={{ marginBottom: 14 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15, color: C.saphirF }}>Contrôle de la proposition</h3>
          {page.lint.map((l, i) => (
            <div key={i} style={{ fontSize: 13, color: lintColor[l.level], marginBottom: 4 }}>
              <b style={{ display: 'inline-block', width: 16 }}>{lintIcon[l.level]}</b>{l.text}
            </div>
          ))}
        </Card>
      )}

      {page.draft && (
        <>
          {(draft.analyse || draft.indexation) && (
            <Card style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, color: C.saphirF }}>Analyse</h3>
              {draft.analyse && <p style={{ fontSize: 13, color: C.grisTF, whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: '0 0 8px' }}>{draft.analyse}</p>}
              {draft.indexation && (
                <div style={{ fontSize: 13 }}>
                  <b>Indexation : {draft.indexation.decision}</b>{draft.indexation.raison ? ` — ${draft.indexation.raison}` : ''}
                </div>
              )}
            </Card>
          )}

          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Texte à coller</h3>
              <button type="button" disabled={!dirty} onClick={save} style={{ ...btnPrimary, marginLeft: 'auto' }}>
                Enregistrer les modifications
              </button>
            </div>
            {DRAFT_BLOCKS.map((b) => (
              <div key={b.key} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <b style={{ fontSize: 13, color: C.grisTF }}>{b.label}</b>
                  {b.hint && (
                    <span style={{ fontSize: 12, color: (draft[b.key] || '').length > parseInt(b.hint, 10) ? C.rouge : C.grisM }}>
                      {(draft[b.key] || '').length} car. · {b.hint}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto' }}><CopyButton text={draft[b.key]} /></span>
                </div>
                <textarea value={draft[b.key] || ''} onChange={(e) => edit(b.key, e.target.value)} rows={b.rows}
                  style={{ ...input, width: '100%', boxSizing: 'border-box', fontFamily: b.rows > 2 ? 'monospace' : 'inherit', fontSize: b.rows > 2 ? 12 : 13 }} />
              </div>
            ))}
          </Card>

          {draft.liens_a_ajouter?.length > 0 && (
            <Card style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 15, color: C.saphirF }}>Liens à ajouter sur d&apos;autres pages</h3>
              {draft.liens_a_ajouter.map((l, i) => (
                <div key={i} style={{ borderTop: i ? `1px solid ${C.grisTL}` : 'none', padding: '8px 0', fontSize: 13 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>Depuis <PageLink url={l.depuis?.startsWith('http') ? l.depuis : `https://www.youvape.fr${l.depuis || ''}`} /></span>
                    <span style={{ color: C.grisF }}>ancre « {l.ancre} »</span>
                    <span style={{ marginLeft: 'auto' }}><CopyButton text={l.html} label="Copier le HTML" /></span>
                  </div>
                  <code style={{ display: 'block', fontSize: 12, color: C.grisF, marginTop: 4, whiteSpace: 'pre-wrap' }}>{l.html}</code>
                </div>
              ))}
            </Card>
          )}

          {(draft.requetes_visees?.length > 0 || draft.requetes_ecartees?.length > 0 || draft.points_a_verifier?.length > 0) && (
            <Card style={{ marginBottom: 14, fontSize: 13, color: C.grisTF, lineHeight: 1.6 }}>
              {draft.requetes_visees?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <b>Requêtes visées :</b> {draft.requetes_visees.join(', ')}{' '}
                  <button type="button" onClick={followTargets} style={{ ...btn, padding: '3px 8px', fontSize: 12, marginLeft: 6 }}>Les suivre</button>
                </div>
              )}
              {draft.requetes_ecartees?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <b>Requêtes écartées :</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {draft.requetes_ecartees.map((q, i) => <li key={i}>{q.requete} — {q.raison}</li>)}
                  </ul>
                </div>
              )}
              {draft.points_a_verifier?.length > 0 && (
                <div>
                  <b style={{ color: C.orange }}>Points à vérifier avant publication :</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {draft.points_a_verifier.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}

/* ─── 3. Vérification ───────────────────────────────────── */

function VerifyPanel({ page, onReload, onPublish, setMsg }) {
  const check = page.live_check;
  const onDone = useCallback((p) => {
    onReload();
    if (p.error) setMsg(`Vérification en échec : ${p.error}`);
    else if (!p.finished) setMsg('La vérification a été interrompue (redémarrage du serveur) : relancez-la.');
  }, [onReload, setMsg]);
  const [progress, setProgress, busy] = useJobProgress(page.id, 'verify', page.verify_progress, onDone);

  const run = async () => {
    setMsg(null);
    try {
      const { data } = await axios.post(`${API_URL}/seo/writer/${page.id}/verify`);
      setProgress(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Vérification de la page en ligne</h3>
        <button type="button" disabled={busy} onClick={run} style={btnPrimary}>{busy ? 'Vérification…' : 'Vérifier maintenant'}</button>
        {page.checked_at && <span style={{ fontSize: 12, color: C.grisM }}>dernière le {new Date(page.checked_at).toLocaleString('fr-FR')}</span>}
      </div>
      {(busy || progress?.error) && <AnalysisProgress progress={progress || page.verify_progress} name="Vérification" />}
      {!busy && check?.checks?.length > 0 && page.status !== 'publie' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: C.grisTL, borderRadius: 8, padding: '10px 12px', marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.grisTF }}>
            {check.checks.every((c) => c.ok) ? 'Tous les contrôles sont bons.' : 'Des contrôles sont encore en rouge.'}
            {' '}Une fois le texte en ligne, passez la page en « Publié » : la date du jour devient le repère du suivi des positions.
          </span>
          <button type="button" onClick={onPublish} style={{ ...btnPrimary, background: C.vert, marginLeft: 'auto' }}>Passer en Publié</button>
        </div>
      )}
      <div style={{ fontSize: 12, color: C.grisM, marginBottom: 10 }}>
        Relit la page publiée (sans cache) : indexation, canonical, title et méta comparés à la proposition, mots interdits, liens relatifs,
        lien de menu masqué, et liens attendus depuis les autres pages. Ensuite : demander l&apos;indexation dans la Search Console
        (Inspection de l&apos;URL) — les étiquettes ne sont pas dans le sitemap.
      </div>
      {check?.checks?.map((c, i) => (
        <div key={i} style={{ fontSize: 13, marginBottom: 5, color: c.ok ? C.grisTF : C.rouge }}>
          <b style={{ color: c.ok ? C.vert : C.rouge, display: 'inline-block', width: 18 }}>{c.ok ? '✓' : '✗'}</b>
          {c.label}{c.detail ? <span style={{ color: C.grisF }}> — {c.detail}</span> : null}
        </div>
      ))}
    </Card>
  );
}

/* ─── 4. Suivi ──────────────────────────────────────────── */

function TrackPanel({ page, onSaved, setMsg }) {
  const [data, setData] = useState(null);
  const [weeks, setWeeks] = useState(26);
  const [eventAt, setEventAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [eventNote, setEventNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}/seo/writer/${page.id}/positions`, { params: { weeks } })
      .then(({ data: d }) => !cancelled && setData(d))
      .catch((e) => !cancelled && setMsg(errMsg(e)));
    return () => { cancelled = true; };
  }, [page.id, weeks, page.target_queries, page.published_at, page.events?.length, setMsg]);

  const addEvent = async () => {
    try {
      const { data: d } = await axios.post(`${API_URL}/seo/writer/${page.id}/events`, { at: eventAt, note: eventNote });
      setEventNote('');
      onSaved(d);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const delEvent = async (id) => {
    try {
      const { data: d } = await axios.delete(`${API_URL}/seo/writer/${page.id}/events/${id}`);
      onSaved(d);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  if (!data) return <Card><span style={{ fontSize: 13, color: C.grisM }}>Chargement…</span></Card>;

  // Une date tombe dans la semaine glissante qui la contient (fin de semaine ≥ date).
  const weekOf = (date) => data.weeks.find((w) => w >= date) || null;
  const markers = [
    ...(data.published_at ? [{ week: weekOf(data.published_at), label: 'Publication', color: C.vert }] : []),
    ...data.events.map((e) => ({ week: weekOf(e.at), label: e.note.slice(0, 24), color: C.orange })),
  ].filter((m) => m.week);
  const rows = data.weeks.map((w, i) => {
    const r = { week: w };
    for (const q of data.queries) r[q.query] = q.series[i].position;
    return r;
  });
  const pageRows = data.page.map((x) => ({ ...x }));
  const firstAfter = data.published_at ? data.weeks.findIndex((w) => w >= data.published_at) : -1;

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, color: C.saphirF }}>Positions des requêtes suivies</h3>
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={input}>
            {[12, 26, 52].map((w) => <option key={w} value={w}>{w} semaines</option>)}
          </select>
          <span style={{ fontSize: 12, color: C.grisM }}>
            Semaines glissantes de 7 jours, dernière au {longDate(data.dataTo)} (Google publie avec ~3 jours de retard). Tous pays.
          </span>
        </div>
        {data.queries.length === 0 ? (
          <div style={{ fontSize: 13, color: C.grisM }}>Aucune requête suivie : cochez-en dans l&apos;onglet Données.</div>
        ) : (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={C.grisTL} vertical={false} />
                <XAxis dataKey="week" tickFormatter={shortDate} tick={{ fontSize: 11, fill: C.grisM }} />
                <YAxis reversed allowDecimals={false} domain={[1, 'dataMax + 2']} tick={{ fontSize: 11, fill: C.grisM }} />
                <Tooltip labelFormatter={(w) => `Semaine au ${longDate(w)}`} formatter={(v) => fmtPos(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {markers.map((m, i) => (
                  <ReferenceLine key={i} x={m.week} stroke={m.color} strokeDasharray="4 3"
                    label={{ value: m.label, position: 'top', fontSize: 10, fill: m.color }} />
                ))}
                {data.queries.map((q, i) => (
                  <Line key={q.query} type="monotone" dataKey={q.query} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                    strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {data.queries.length > 0 && (
        <Card style={{ marginBottom: 14, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Requête</th>
              <th style={{ ...th, textAlign: 'right' }}>{firstAfter > 0 ? 'Semaine avant publication' : 'Il y a 4 semaines'}</th>
              <th style={{ ...th, textAlign: 'right' }}>Dernière semaine</th>
              <th style={th}>Évol.</th>
              <th style={{ ...th, textAlign: 'right' }}>Clics (dern. sem.)</th>
              <th style={{ ...th, textAlign: 'right' }}>Impr. (dern. sem.)</th>
            </tr></thead>
            <tbody>
              {data.queries.map((q) => {
                const last = q.series[q.series.length - 1];
                const ref = firstAfter > 0 ? q.series[firstAfter - 1] : q.series[Math.max(0, q.series.length - 5)];
                return (
                  <tr key={q.query}>
                    <td style={td}>{q.query}</td>
                    <td style={tdNum}>{fmtPos(ref?.position)}</td>
                    <td style={{ ...tdNum, fontWeight: 700 }}>{fmtPos(last?.position)}</td>
                    <td style={td}><PosDelta current={last?.position} previous={ref?.position} /></td>
                    <td style={tdNum}>{fmtInt(last?.clicks)}</td>
                    <td style={tdNum}>{fmtInt(last?.impressions)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Card style={{ marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: C.saphirF }}>Trafic Google de la page</h3>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <ComposedChart data={pageRows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grisTL} vertical={false} />
              <XAxis dataKey="week" tickFormatter={shortDate} tick={{ fontSize: 11, fill: C.grisM }} />
              <YAxis yAxisId="c" tick={{ fontSize: 11, fill: C.grisM }} />
              <YAxis yAxisId="i" orientation="right" tick={{ fontSize: 11, fill: C.grisM }} tickFormatter={fmtInt} />
              <Tooltip labelFormatter={(w) => `Semaine au ${longDate(w)}`} formatter={(v) => fmtInt(v)} />
              {markers.map((m, i) => <ReferenceLine key={i} yAxisId="c" x={m.week} stroke={m.color} strokeDasharray="4 3" />)}
              <Bar yAxisId="i" dataKey="impressions" name="Impressions" fill="#D9E2EA" isAnimationActive={false} />
              <Line yAxisId="c" type="monotone" dataKey="clicks" name="Clics" stroke={C.saphir} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: C.saphirF }}>Journal de la page</h3>
        <div style={{ fontSize: 12, color: C.grisM, marginBottom: 8 }}>
          Chaque modification (texte, title, indexation, lien ajouté, promo…) datée ici apparaît sur les graphiques, pour relier une variation à sa cause.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input type="date" value={eventAt} onChange={(e) => setEventAt(e.target.value)} style={input} />
          <input value={eventNote} onChange={(e) => setEventNote(e.target.value)} placeholder="ex. Title modifié, lien ajouté depuis /marque/jnr"
            style={{ ...input, flex: 1, minWidth: 240 }} />
          <button type="button" disabled={!eventNote.trim()} onClick={addEvent} style={btnPrimary}>Ajouter</button>
        </div>
        {page.events?.map((e) => (
          <div key={e.id} style={{ fontSize: 13, color: C.grisTF, padding: '5px 0', borderTop: `1px solid ${C.grisTL}`, display: 'flex', gap: 10 }}>
            <b style={{ minWidth: 86 }}>{longDate(e.at)}</b>
            <span style={{ flex: 1 }}>{e.note}</span>
            <span style={{ fontSize: 11, color: C.grisM }}>{e.created_by_name || e.created_by}</span>
            <button type="button" onClick={() => delEvent(e.id)} style={{ border: 'none', background: 'none', color: C.grisM, cursor: 'pointer' }}>✕</button>
          </div>
        ))}
      </Card>
    </>
  );
}

/* ─── Fiche d'une page ──────────────────────────────────── */

const SUB_TABS = [
  { key: 'donnees', label: '1. Données' },
  { key: 'redaction', label: '2. Rédaction' },
  { key: 'verification', label: '3. Vérification' },
  { key: 'suivi', label: '4. Suivi' },
];

function PageDetail({ id, onBack, onChanged }) {
  const [page, setPage] = useState(null);
  const [sub, setSub] = useState('donnees');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/seo/writer/${id}`);
      setPage(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Pendant une analyse, on suit l'avancement chaque seconde, puis on recharge la fiche.
  const onAnalyzed = useCallback(async (p) => {
    await load();
    onChanged();
    if (p.error) setMsg(`Analyse en échec : ${p.error}`);
    else if (!p.finished) setMsg('L’analyse a été interrompue (redémarrage du serveur) : relancez-la.');
  }, [load, onChanged]);
  const [progress, setProgress, analyzing] = useJobProgress(id, 'analyze', page?.progress, onAnalyzed);

  // Note rapide dans le journal, depuis n'importe quel onglet.
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteAt, setNoteAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [noteText, setNoteText] = useState('');
  const addNote = async () => {
    try {
      const { data } = await axios.post(`${API_URL}/seo/writer/${id}/events`, { at: noteAt, note: noteText });
      setNoteText('');
      setNoteOpen(false);
      saved(data);
      setMsg('Modification notée dans le journal : elle apparaît sur les courbes de l’onglet Suivi.');
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const startAnalyze = async () => {
    const { data } = await axios.post(`${API_URL}/seo/writer/${id}/analyze`);
    setProgress(data);
  };

  // Pendant une rédaction, la fiche se recharge toute seule.
  useEffect(() => {
    if (page?.gen_status !== 'running') return undefined;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [page?.gen_status, load]);

  const saved = (data) => { setPage({ ...data, progress: page?.progress }); onChanged(); };

  const patch = async (body) => {
    try {
      const { data } = await axios.patch(`${API_URL}/seo/writer/${id}`, body);
      saved(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  const remove = async () => {
    if (!window.confirm('Retirer cette page de la rédaction SEO ? Son historique et sa proposition seront perdus (la page du site n’est pas touchée).')) return;
    try {
      await axios.delete(`${API_URL}/seo/writer/${id}`);
      onChanged();
      onBack();
    } catch (e) {
      setMsg(errMsg(e));
    }
  };

  if (!page) return <Card>{msg || 'Chargement…'}</Card>;

  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={onBack} style={{ ...btn, padding: '5px 10px' }}>← Toutes les pages</button>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.saphirF }}>{page.label || pathOf(page.url)}</div>
            <PageLink url={page.url} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, color: C.grisM, fontWeight: 600 }}>Statut</span>
            <select value={page.status} onChange={(e) => patch({ status: e.target.value })}
              style={{ ...input, fontWeight: 700, color: '#fff', background: statusOf(page.status).color, border: 'none' }}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {page.status_by && (
              <span style={{ fontSize: 11, color: C.grisM }}>
                par {page.status_by_name || page.status_by}{page.status_at ? ` le ${new Date(page.status_at).toLocaleString('fr-FR')}` : ''}
              </span>
            )}
          </div>
          <label style={{ fontSize: 13, color: C.grisF, display: 'flex', gap: 6, alignItems: 'center' }}>
            Publiée le
            <input type="date" value={page.published_at || ''} onChange={(e) => patch({ published_at: e.target.value || null })} style={input} />
          </label>
          <button type="button" onClick={() => setNoteOpen(!noteOpen)} style={btnPrimary}>Noter une modification</button>
          <button type="button" onClick={remove} style={{ ...btn, borderColor: C.grisCL, color: C.grisM }}>Retirer</button>
        </div>
        {noteOpen && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" value={noteAt} onChange={(e) => setNoteAt(e.target.value)} style={input} />
            <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && noteText.trim() && addNote()}
              placeholder="ex. Lien vers e-liquides-jnr-avec-nicotine retiré" style={{ ...input, flex: 1, minWidth: 260 }} />
            <button type="button" disabled={!noteText.trim()} onClick={addNote} style={btnPrimary}>Ajouter au journal</button>
          </div>
        )}
        <div style={{ fontSize: 12, color: C.grisM, marginTop: 8 }}>
          Journal : {page.events?.length ? `${page.events.length} note(s), la dernière le ${longDate(page.events[0].at)} — « ${page.events[0].note.slice(0, 80)} »` : 'aucune note'}
          {page.events?.length > 0 && (
            <button type="button" onClick={() => setSub('suivi')} style={{ border: 'none', background: 'none', color: C.bleu, cursor: 'pointer', fontSize: 12 }}>
              voir le journal et les courbes
            </button>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {SUB_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setSub(t.key)}
            style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              border: `1px solid ${sub === t.key ? C.violet : C.grisCL}`,
              background: sub === t.key ? C.violet : C.blanc, color: sub === t.key ? C.blanc : C.grisTF, fontWeight: sub === t.key ? 700 : 500,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div style={{ fontSize: 13, color: C.grisF, marginBottom: 10 }}>{msg}</div>}

      {analyzing && <AnalysisProgress progress={progress || page.progress} />}
      {!analyzing && !page.analyzed_at && (
        <Card style={{ marginBottom: 14, borderColor: C.orange }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, color: C.grisTF }}>
              Cette page n&apos;a pas encore été analysée (analyse jamais lancée ou interrompue) : aucune donnée ni brief tant qu&apos;elle ne l&apos;est pas.
            </span>
            <button type="button" onClick={() => startAnalyze().catch((e) => setMsg(errMsg(e)))} style={{ ...btnPrimary, marginLeft: 'auto' }}>
              Lancer l&apos;analyse
            </button>
          </div>
        </Card>
      )}
      {!analyzing && progress?.error && <AnalysisProgress progress={progress} />}

      {sub === 'donnees' && <DataPanel page={{ ...page, progress: { running: analyzing } }} onSaved={saved} onAnalyze={startAnalyze} setMsg={setMsg} />}
      {sub === 'redaction' && <DraftPanel page={page} onSaved={saved} setMsg={setMsg} />}
      {sub === 'verification' && <VerifyPanel page={page} onReload={load} onPublish={() => patch({ status: 'publie' })} setMsg={setMsg} />}
      {sub === 'suivi' && <TrackPanel page={page} onSaved={saved} setMsg={setMsg} />}
    </>
  );
}

/* ─── Liste des pages ───────────────────────────────────── */

export default function SeoWriterTab() {
  const [list, setList] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [selected, setSelected] = useState(() => {
    try { return Number(localStorage.getItem('seo-writer-page')) || null; } catch { return null; }
  });

  const choose = (id) => {
    setSelected(id);
    try {
      if (id) localStorage.setItem('seo-writer-page', String(id));
      else localStorage.removeItem('seo-writer-page');
    } catch { /* navigation privée */ }
  };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/seo/writer`);
      setList(data);
    } catch (e) {
      setMsg(errMsg(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await axios.post(`${API_URL}/seo/writer`, { url });
      setUrl('');
      setMsg(null);
      await load();
      choose(data.id);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (selected) return <PageDetail id={selected} onBack={() => choose(null)} onChanged={load} />;

  const pages = list?.pages || [];

  return (
    <Card style={{ marginBottom: 16, padding: 0, overflowX: 'auto' }}>
      <div style={{ padding: '16px 18px 10px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 17, color: C.saphirF }}>Rédaction SEO</h2>
        <div style={{ fontSize: 13, color: C.grisF, marginBottom: 12 }}>
          Ajoutez l&apos;adresse d&apos;une page du site : l&apos;app relève la page et ses produits, réunit les requêtes de la Search Console
          (et les volumes Google Ads si vous importez un export), prépare le texte à coller, vérifie la publication puis suit les positions dans le temps.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && add()}
            placeholder="https://www.youvape.fr/etiquette-produit/… ou /marque/…" style={{ ...input, flex: 1, minWidth: 320 }} />
          <button type="button" disabled={busy || !url.trim()} onClick={add} style={btnPrimary}>{busy ? 'Ajout…' : 'Ajouter la page'}</button>
        </div>
        {msg && <div style={{ fontSize: 13, color: C.grisF, marginTop: 8 }}>{msg}</div>}
        {list && !list.aiConfigured && (
          <div style={{ fontSize: 12, color: C.grisM, marginTop: 8 }}>
            Génération automatique inactive : chaque page fournit un brief complet à coller dans Claude, dont la réponse se recolle dans l&apos;app.
          </div>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Page</th>
          <th style={th}>Statut</th>
          <th style={th}>Publiée le</th>
          <th style={th}>Requête principale</th>
          <th style={{ ...th, textAlign: 'right' }}>Pos. avant</th>
          <th style={{ ...th, textAlign: 'right' }}>Pos. 14 j</th>
          <th style={th}>Évol.</th>
          <th style={{ ...th, textAlign: 'right' }}>Clics 28 j</th>
          <th style={{ ...th, textAlign: 'right' }}>28 j avant</th>
        </tr></thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.id} onClick={() => choose(p.id)} style={{ cursor: 'pointer' }}>
              <td style={td}>
                <div style={{ fontWeight: 600, color: C.saphirF }}>{p.label || pathOf(p.url)}</div>
                <div style={{ fontSize: 12, color: C.grisM }}>{pathOf(p.url)}</div>
              </td>
              <td style={td}>
                <StatusBadge value={p.status} />
                {p.analyzing && <span style={{ fontSize: 11, color: C.violet, marginLeft: 6 }}>analyse…</span>}
                {p.gen_status === 'running' && <span style={{ fontSize: 11, color: C.bleu, marginLeft: 6 }}>rédaction…</span>}
                {p.status_by && (
                  <div style={{ fontSize: 11, color: C.grisM, marginTop: 3 }}>
                    par {p.status_by_name || p.status_by}{p.status_at ? ` le ${new Date(p.status_at).toLocaleDateString('fr-FR')}` : ''}
                  </div>
                )}
              </td>
              <td style={td}>{longDate(p.published_at)}</td>
              <td style={{ ...td, fontSize: 12 }}>{p.main_query || '—'}</td>
              <td style={tdNum}>{fmtPos(p.position_before)}</td>
              <td style={{ ...tdNum, fontWeight: 700 }}>{fmtPos(p.position_now)}</td>
              <td style={td}><PosDelta current={p.position_now} previous={p.position_before} /></td>
              <td style={tdNum}>{fmtInt(p.clicks_28)}</td>
              <td style={tdNum}>{fmtInt(p.clicks_prev_28)}</td>
            </tr>
          ))}
          {list && pages.length === 0 && <tr><td style={td} colSpan={9}>Aucune page pour l&apos;instant.</td></tr>}
        </tbody>
      </table>
      {list?.dataTo && (
        <div style={{ padding: '8px 18px 14px', fontSize: 12, color: C.grisM }}>
          « Pos. avant » : 14 jours précédant la publication ; « Pos. 14 j » : 14 derniers jours (au {longDate(list.dataTo)}). Clics : toutes requêtes de la page.
        </div>
      )}
    </Card>
  );
}
