import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import AppShell from '../components/AppShell';
import { Seo as SeoIcon } from '../components/AppIcons';
import SeoWriterTab from './SeoWriterTab';
import { TargetsTab, PageTab } from './SeoPilotTab';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);
const fmtPos = (p) => (p === null || p === undefined || p === '' ? '—' : Number(p).toFixed(1).replace('.', ','));
const shortDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '');
const longDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');

const COUNTRIES = [
  { value: 'all', label: 'Tous pays' },
  { value: 'fra', label: 'France' },
  { value: 'bel', label: 'Belgique' },
];
const WEEKS = [8, 12, 26, 52];
const DETAIL_DAYS = [7, 28, 90];

/* Évolution de position : une baisse du chiffre est un gain de places. */
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

function Card({ children, style }) {
  return (
    <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px', ...style }}>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, fontSize: 13 }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: C.grisM, fontWeight: 600, borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}` };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

/* ─── RECOMMANDATIONS ───────────────────────────────────── */
const REC_TYPES = {
  redirection: { label: 'Redirection', color: '#DE2020' },
  cannibalisation: { label: 'Cannibalisation', color: '#B45309' },
  creation: { label: 'Création de page', color: '#7C3AED' },
  modification: { label: 'Modifier une page', color: '#4F46E5' },
  texte: { label: 'Texte / title', color: '#0071EB' },
  snippet: { label: 'Résultat peu cliqué', color: '#0EA5A5' },
  faq: { label: 'FAQ', color: '#059669' },
  indexation: { label: 'Indexation / crawl', color: '#475569' },
  baisse: { label: 'En baisse', color: '#BE123C' },
  liens: { label: 'Liens à corriger', color: '#0369A1' },
};
const REC_STATUSES = [
  { value: 'todo', label: 'À faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'done', label: 'Fait' },
  { value: 'ignored', label: 'Ignoré' },
];
const STATUS_FILTERS = [
  { value: 'todo', label: 'À faire' },
  { value: 'doing', label: 'En cours' },
  { value: 'done', label: 'Faites' },
  { value: 'ignored', label: 'Ignorées' },
  { value: 'todo,doing,done,ignored', label: 'Toutes' },
];

/* Texte d'une carte : paragraphes séparés, adresses du site en liens bleus. */
const SITE = 'https://www.youvape.fr';
const LINK_RE = /(https?:\/\/[^\s«»"',;)]+)|(?<=^|[\s(«])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\/?)/gim;

function Linkified({ text }) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const href = m[1] || `${SITE}${m[2]}`;
    parts.push(
      <a key={`${m.index}-${href}`} href={href} target="_blank" rel="noreferrer" style={{ color: C.bleu, textDecoration: 'none', wordBreak: 'break-all' }}>
        {m[0]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function RichText({ text, boxed }) {
  return (
    <div style={boxed ? { background: C.grisTL, borderRadius: 8, padding: '12px 14px', marginTop: 6 } : { marginTop: 6 }}>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
          <Linkified text={para} />
        </p>
      ))}
    </div>
  );
}

function RecCard({ rec, rank, onStatus, onOpenPage }) {
  const [open, setOpen] = useState(false);
  const t = REC_TYPES[rec.type] || { label: rec.type, color: C.grisM };
  const queries = Array.isArray(rec.queries) ? rec.queries : [];
  return (
    <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, borderLeft: `4px solid ${t.color}`, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span style={{ color: C.grisM, fontSize: 12, width: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, color: C.grisM, fontSize: 13, minWidth: 24 }}>#{rank}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: t.color, borderRadius: 6, padding: '2px 8px' }}>{t.label}</span>
        <span style={{ fontWeight: 600, color: C.saphirF, fontSize: 14, flex: 1, minWidth: 260 }}>{rec.title}</span>
        <span style={{ fontSize: 12, color: C.grisF, whiteSpace: 'nowrap', textAlign: 'right' }}>
          <b style={{ color: C.vert }}>≈ +{fmtInt(rec.est_clicks)} clics/mois</b>
          {rec.delay ? ` · effet en ${rec.delay}` : ''} · effort {rec.effort}
        </span>
        {rec.repos_until && (
          <span title={`Page modifiée le ${longDate(rec.last_change)} : attendre la mesure`}
            style={{ fontSize: 11, fontWeight: 700, color: C.orange, border: `1px solid ${C.orange}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
            au repos jusqu&apos;au {longDate(rec.repos_until)}
          </span>
        )}
        {rec.status_by && rec.status !== 'todo' && (
          <span style={{ fontSize: 11, color: C.grisM, whiteSpace: 'nowrap' }}
            title={`Statut posé le ${new Date(rec.status_at).toLocaleString('fr-FR')}`}>
            par {rec.status_by_name || rec.status_by} · {new Date(rec.status_at).toLocaleDateString('fr-FR')}
          </span>
        )}
        <select value={rec.status} onClick={(e) => e.stopPropagation()} onChange={(e) => onStatus(rec, e.target.value)}
          style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.grisCL}`, fontSize: 12 }}>
          {REC_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {open && (
        <div style={{ marginTop: 10, fontSize: 13, color: C.grisTF, lineHeight: 1.55 }}>
          {rec.reason && (
            <div style={{ margin: '0 0 14px' }}>
              <b>Pourquoi</b>
              <RichText text={rec.reason} />
            </div>
          )}
          {rec.action && (
            <div style={{ margin: '0 0 14px' }}>
              <b>Action proposée</b>
              <RichText text={rec.action} />
            </div>
          )}
          {rec.proposal && (
            <div style={{ margin: '0 0 14px' }}>
              <b>Proposition de contenu</b>
              <RichText text={rec.proposal} boxed />
            </div>
          )}
          {rec.urls?.length > 0 && (
            <div style={{ margin: '0 0 8px' }}>
              <b>Pages :</b>{' '}
              {rec.urls.map((u) => (
                <span key={u} style={{ marginRight: 14, whiteSpace: 'nowrap' }}>
                  <a href={u} target="_blank" rel="noreferrer" style={{ color: C.bleu, textDecoration: 'none' }}>
                    {u.replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/'}
                  </a>
                  {onOpenPage && (
                    <button type="button" onClick={() => onOpenPage(u.replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/')}
                      style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.saphir, cursor: 'pointer' }}>
                      fiche page
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {queries.length > 0 && (
            <table style={{ borderCollapse: 'collapse', marginTop: 4 }}>
              <thead><tr>
                <th style={th}>Requête</th>
                <th style={{ ...th, textAlign: 'right' }}>Impr. 28 j</th>
                <th style={{ ...th, textAlign: 'right' }}>Clics</th>
                <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
                {queries.some((q) => q.role) && <th style={th}>Rôle dans la recommandation</th>}
              </tr></thead>
              <tbody>
                {queries.map((q) => (
                  <tr key={q.query}>
                    <td style={td}>{q.query}</td>
                    <td style={tdNum}>{fmtInt(q.i)}</td>
                    <td style={tdNum}>{fmtInt(q.c)}</td>
                    <td style={tdNum}>{fmtPos(q.p)}</td>
                    {queries.some((x) => x.role) && <td style={{ ...td, fontSize: 12, color: C.grisF }}><Linkified text={q.role || ''} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rec.status_by && (
            <div style={{ fontSize: 11, color: C.grisM, marginTop: 6 }}>
              Statut posé par {rec.status_by_name || rec.status_by} le {new Date(rec.status_at).toLocaleString('fr-FR')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Recommendations({ onOpenPage }) {
  const [data, setData] = useState(null);
  const [statusFilter, setStatusFilter] = useState('todo');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showRepos, setShowRepos] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await axios.get(`${API_URL}/seo/recommendations`, { params: { status: statusFilter } });
      setData(d);
      return d;
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
      return null;
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Pendant un recalcul, on recharge toutes les 10 secondes.
  useEffect(() => {
    if (!data?.running) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const refresh = async () => {
    setMsg(null);
    try {
      await axios.post(`${API_URL}/seo/recommendations/refresh`);
      setMsg('Recalcul lancé : relevé des pages puis analyse (1 à 3 minutes).');
      setTimeout(load, 2000);
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    }
  };

  const setStatus = async (rec, status) => {
    try {
      await axios.patch(`${API_URL}/seo/recommendations/${rec.id}`, { status });
      load();
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    }
  };

  const needle = search.trim().toLowerCase();
  const all = (data?.recommendations || []).filter((r) => typeFilter === 'all' || r.type === typeFilter);
  const enRepos = all.filter((r) => r.repos_until);
  const recs = all
    .filter((r) => showRepos || !r.repos_until)
    .filter((r) => !needle
      || r.title.toLowerCase().includes(needle)
      || (r.urls || []).some((u) => u.toLowerCase().includes(needle))
      || (Array.isArray(r.queries) ? r.queries : []).some((q) => q.query.includes(needle)));
  const shown = showAll ? recs : recs.slice(0, 30);
  const types = [...new Set((data?.recommendations || []).map((r) => r.type))];
  const run = data?.lastRun;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: C.saphirF }}>Recommandations</h2>
        <span style={{ fontSize: 12, color: C.grisM }}>
          classées par gain de clics estimé (France, 28 derniers jours)
          {run?.finished_at ? ` · calculées le ${new Date(run.finished_at).toLocaleString('fr-FR')}` : ''}
          {data?.running ? ' · recalcul en cours…' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrer (ex. jnr)"
            style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13, width: 150 }} />
          <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
          <Select value={typeFilter} onChange={setTypeFilter}
            options={[{ value: 'all', label: 'Tous les types' }, ...types.map((x) => ({ value: x, label: REC_TYPES[x]?.label || x }))]} />
          <button type="button" disabled={data?.running} onClick={refresh}
            style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 }}>
            Recalculer
          </button>
        </div>
      </div>
      {msg && <div style={{ fontSize: 13, color: C.grisF, marginBottom: 8 }}>{msg}</div>}
      {run?.status === 'error' && <div style={{ fontSize: 13, color: C.rouge, marginBottom: 8 }}>Dernier calcul en échec : {run.error}</div>}
      <div style={{ fontSize: 12, color: C.grisM, marginBottom: 10 }}>
        Cliquez sur une ligne pour voir le pourquoi, l&apos;action et les requêtes concernées. Le gain estimé suppose la remontée visée (quelques places) et un taux de clic moyen : c&apos;est un ordre de grandeur pour prioriser, pas une promesse.
        Tout texte proposé reste factuel et passe par l&apos;avocat avant mise en ligne.
      </div>
      {enRepos.length > 0 && (
        <div style={{ fontSize: 13, color: C.grisF, background: '#FFF8EC', border: `1px solid ${C.orange}`, borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
          {enRepos.length} recommandation(s) portent sur des pages modifiées depuis moins de 4 semaines : elles sont mises de côté le temps de mesurer l&apos;effet.{' '}
          <button type="button" onClick={() => setShowRepos(!showRepos)}
            style={{ border: 'none', background: 'none', color: C.bleu, cursor: 'pointer', fontSize: 13, padding: 0 }}>
            {showRepos ? 'Les masquer' : 'Les afficher'}
          </button>
        </div>
      )}
      {data && recs.length === 0 && <div style={{ fontSize: 13, color: C.grisM }}>Aucune recommandation pour ces filtres.</div>}
      {shown.map((r, i) => <RecCard key={r.id} rec={r} rank={i + 1} onStatus={setStatus} onOpenPage={onOpenPage} />)}
      {recs.length > shown.length && (
        <button type="button" onClick={() => setShowAll(true)}
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, cursor: 'pointer', fontSize: 13, color: C.saphir }}>
          Afficher les {recs.length - shown.length} autres recommandations
        </button>
      )}
    </Card>
  );
}

/* ─── NON CONFIGURÉ ─────────────────────────────────────── */
function SetupPanel({ status }) {
  return (
    <Card>
      <h2 style={{ margin: '0 0 8px', fontSize: 17, color: C.saphirF }}>Connexion à la Search Console à faire</h2>
      <p style={{ margin: '0 0 12px', fontSize: 14, color: C.grisF }}>
        L&apos;app lit la Search Console avec un compte technique Google en lecture seule.
        Aucun mot de passe de compte Google n&apos;est utilisé.
      </p>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: C.grisTF, lineHeight: 1.7 }}>
        <li>Dans Google Cloud, créer un projet et y activer l&apos;« API Google Search Console ».</li>
        <li>Créer un compte de service, puis télécharger sa clé au format JSON.</li>
        <li>Dans la Search Console : Paramètres &gt; Utilisateurs et autorisations &gt; ajouter l&apos;adresse du compte de service avec le droit « Restreint ».</li>
        <li>Faire déposer la clé sur le serveur des apps par la personne qui gère le serveur.</li>
      </ol>
      {status?.siteError && (
        <p style={{ marginTop: 12, color: C.rouge, fontSize: 13 }}>{status.siteError}</p>
      )}
    </Card>
  );
}

/* ─── APP ───────────────────────────────────────────────── */
export default function SeoApp() {
  const [status, setStatus] = useState(null);
  const [country, setCountry] = useState('fra');
  const [weeks, setWeeks] = useState(12);
  const [series, setSeries] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailDays, setDetailDays] = useState(28);
  const [detail, setDetail] = useState(null);
  const [newQueries, setNewQueries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('seo-tab') || 'suivi'; } catch { return 'suivi'; }
  });
  const chooseTab = (t) => {
    setTab(t);
    try { localStorage.setItem('seo-tab', t); } catch { /* navigation privée */ }
  };
  // Fiche page ouverte depuis une cible, une recommandation ou une requête.
  const [pageUrl, setPageUrl] = useState(() => {
    try { return localStorage.getItem('seo-page') || ''; } catch { return ''; }
  });
  const openPage = (u) => {
    setPageUrl(u);
    try { localStorage.setItem('seo-page', u); } catch { /* navigation privée */ }
    chooseTab('page');
  };

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/seo/status`);
      setStatus(data);
      return data;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      return null;
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Pendant une reprise, on suit l'avancement toutes les 5 secondes.
  useEffect(() => {
    if (!status?.sync?.running) return undefined;
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, [status?.sync?.running, loadStatus]);

  const hasData = !!status?.dataTo;

  useEffect(() => {
    if (!hasData) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      axios.get(`${API_URL}/seo/groups`, { params: { weeks, country } }),
      axios.get(`${API_URL}/seo/new-queries`, { params: { days: 7, country } }),
    ])
      .then(([g, n]) => {
        if (cancelled) return;
        setSeries(g.data);
        setNewQueries(n.data);
        if (!selected && g.data.groups?.length) setSelected(g.data.groups[1]?.slug || g.data.groups[0].slug);
      })
      .catch((e) => !cancelled && setError(e.response?.data?.error || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // `selected` n'est lu que pour la sélection initiale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, weeks, country, status?.dataTo]);

  useEffect(() => {
    if (!hasData || !selected) return;
    let cancelled = false;
    axios.get(`${API_URL}/seo/groups/${selected}`, { params: { days: detailDays, country } })
      .then(({ data }) => !cancelled && setDetail(data))
      .catch((e) => !cancelled && setError(e.response?.data?.error || e.message));
    return () => { cancelled = true; };
  }, [hasData, selected, detailDays, country, status?.dataTo]);

  const startSync = async (days) => {
    setSyncMsg(null);
    try {
      const { data } = await axios.post(`${API_URL}/seo/sync`, { days });
      setSyncMsg(`Reprise lancée du ${longDate(data.dateFrom)} au ${longDate(data.dateTo)}.`);
      setTimeout(loadStatus, 1500);
    } catch (e) {
      setSyncMsg(e.response?.data?.error || e.message);
    }
  };

  const rows = useMemo(() => (series?.groups || []).map((g) => {
    const last = g.series[g.series.length - 1];
    const prev = g.series[g.series.length - 2];
    return { ...g, last, prev };
  }), [series]);

  const selectedGroup = rows.find((g) => g.slug === selected);
  const chartData = (selectedGroup?.series || []).map((w) => ({
    label: shortDate(w.weekEnd),
    position: w.position,
    impressions: w.impressions,
    clics: w.clicks,
  }));

  const lastRun = status?.lastRuns?.[0];
  const sync = status?.sync;

  return (
    <AppShell currentPath="/seo">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grisTL }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SeoIcon size={24} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: C.saphirF }}>Suivi SEO</h1>
              <div style={{ fontSize: 13, color: C.grisM }}>Positions Google par groupe de requêtes (Search Console)</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.grisCL}`, marginBottom: 16 }}>
            {[{ key: 'suivi', label: 'Suivi des positions' }, { key: 'cibles', label: 'Pages cibles' }, { key: 'page', label: 'Fiche page' }, { key: 'reco', label: 'Recommandations' }, { key: 'redaction', label: 'Rédaction SEO' }].map((t) => (
              <button key={t.key} type="button" onClick={() => chooseTab(t.key)}
                style={{
                  padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14,
                  fontWeight: tab === t.key ? 700 : 500, color: tab === t.key ? C.saphirF : C.grisM,
                  borderBottom: `3px solid ${tab === t.key ? '#7C3AED' : 'transparent'}`, marginBottom: -1,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {error && (
            <Card style={{ borderColor: C.rouge, marginBottom: 14 }}>
              <span style={{ color: C.rouge, fontSize: 14 }}>{error}</span>
            </Card>
          )}

          {status && !status.configured && <SetupPanel status={status} />}

          {status?.configured && tab === 'suivi' && (
            <Card style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: C.grisF }}>
                <div><b>Propriété :</b> {status.site || '—'}</div>
                <div><b>Données :</b> {hasData ? `du ${longDate(status.dataFrom)} au ${longDate(status.dataTo)}` : 'aucune pour l’instant'}</div>
                <div>
                  <b>Dernière synchro :</b>{' '}
                  {lastRun ? `${new Date(lastRun.started_at).toLocaleString('fr-FR')} (${lastRun.status === 'done' ? 'terminée' : lastRun.status === 'error' ? `échec : ${lastRun.error}` : 'en cours'})` : 'jamais'}
                </div>
                {sync?.running && (
                  <div style={{ color: C.bleu }}>
                    Synchro en cours : {sync.progress?.done || 0} jour(s) traités{sync.progress?.current ? `, jusqu'au ${longDate(sync.progress.current)}` : ''}…
                  </div>
                )}
                {status.siteError && <div style={{ color: C.rouge }}>{status.siteError}</div>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={sync?.running} onClick={() => startSync(90)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 }}>
                  Reprendre 90 jours
                </button>
                <button type="button" disabled={sync?.running} onClick={() => startSync(480)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: C.saphir, color: C.blanc, cursor: 'pointer', fontSize: 13 }}>
                  Reprendre 16 mois
                </button>
              </div>
              {syncMsg && <div style={{ width: '100%', fontSize: 13, color: C.grisF }}>{syncMsg}</div>}
            </Card>
          )}

          {hasData && tab === 'cibles' && <TargetsTab onOpenPage={openPage} />}

          {hasData && tab === 'page' && <PageTab url={pageUrl} onOpenPage={openPage} />}

          {hasData && tab === 'reco' && <Recommendations onOpenPage={openPage} />}

          {hasData && tab === 'redaction' && <SeoWriterTab />}

          {hasData && tab === 'suivi' && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <Select value={country} onChange={setCountry} options={COUNTRIES} />
                <Select value={String(weeks)} onChange={(v) => setWeeks(Number(v))}
                  options={WEEKS.map((w) => ({ value: String(w), label: `${w} semaines` }))} />
                {loading && <span style={{ fontSize: 13, color: C.grisM }}>Chargement…</span>}
                <span style={{ fontSize: 12, color: C.grisM, marginLeft: 'auto' }}>
                  Semaines glissantes de 7 jours, la dernière se termine le {longDate(series?.dataTo)}. Position moyenne pondérée par les impressions.
                </span>
              </div>

              <Card style={{ padding: 0, overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Groupe de requêtes</th>
                      <th style={{ ...th, textAlign: 'right' }}>Position</th>
                      <th style={th}>vs sem. préc.</th>
                      <th style={{ ...th, textAlign: 'right' }}>Clics (7 j)</th>
                      <th style={{ ...th, textAlign: 'right' }}>Impressions (7 j)</th>
                      <th style={th}>Position sur {weeks} semaines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.slug} onClick={() => setSelected(g.slug)}
                        style={{ cursor: 'pointer', background: g.slug === selected ? '#EEF4FF' : 'transparent' }}>
                        <td style={{ ...td, fontWeight: g.slug === selected ? 700 : 500 }}>{g.name}</td>
                        <td style={{ ...tdNum, fontWeight: 700 }}>{fmtPos(g.last?.position)}</td>
                        <td style={td}><PosDelta current={g.last?.position} previous={g.prev?.position} /></td>
                        <td style={tdNum}>{fmtInt(g.last?.clicks)}</td>
                        <td style={tdNum}>{fmtInt(g.last?.impressions)}</td>
                        <td style={{ ...td, width: 200, padding: '2px 10px' }}>
                          <div style={{ width: 180, height: 34 }}>
                            <ResponsiveContainer>
                              <LineChart data={g.series}>
                                <YAxis hide reversed domain={['dataMin - 1', 'dataMax + 1']} />
                                <Line type="monotone" dataKey="position" stroke={C.saphir} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {selectedGroup && (
                <Card style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    <h2 style={{ margin: 0, fontSize: 17, color: C.saphirF }}>{selectedGroup.name}</h2>
                    <code style={{ fontSize: 11, color: C.grisM }}>{selectedGroup.pattern}</code>
                  </div>
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke={C.grisTL} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.grisM }} />
                        <YAxis yAxisId="pos" reversed allowDecimals={false} domain={[1, 'dataMax + 2']} tick={{ fontSize: 11, fill: C.grisM }}
                          label={{ value: 'Position', angle: -90, position: 'insideLeft', fontSize: 11, fill: C.grisM }} />
                        <YAxis yAxisId="imp" orientation="right" tick={{ fontSize: 11, fill: C.grisM }} tickFormatter={fmtInt} />
                        <Tooltip formatter={(v, name) => (name === 'position' ? fmtPos(v) : fmtInt(v))} />
                        <Bar yAxisId="imp" dataKey="impressions" fill="#D9E2EA" isAnimationActive={false} />
                        <Line yAxisId="pos" type="monotone" dataKey="position" stroke={C.saphir} strokeWidth={2.2} connectNulls isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: 12, color: C.grisM }}>Ligne : position moyenne (en haut = mieux). Barres grises : impressions.</div>
                </Card>
              )}

              {detail && selectedGroup && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 16, marginBottom: 16 }}>
                  <Card style={{ padding: 0, overflowX: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
                      <b style={{ fontSize: 14, color: C.saphirF }}>Requêtes</b>
                      <Select value={String(detailDays)} onChange={(v) => setDetailDays(Number(v))}
                        options={DETAIL_DAYS.map((d) => ({ value: String(d), label: `${d} derniers jours` }))} />
                      <span style={{ fontSize: 12, color: C.grisM }}>vs les {detailDays} jours d&apos;avant</span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Requête</th>
                        <th style={{ ...th, textAlign: 'right' }}>Clics</th>
                        <th style={{ ...th, textAlign: 'right' }}>Impr.</th>
                        <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
                        <th style={th}>Évol.</th>
                      </tr></thead>
                      <tbody>
                        {detail.queries.map((q) => (
                          <tr key={q.key}>
                            <td style={td}>{q.key}</td>
                            <td style={tdNum}>{fmtInt(q.clicks)}</td>
                            <td style={tdNum}>{fmtInt(q.impressions)}</td>
                            <td style={tdNum}>{fmtPos(q.position)}</td>
                            <td style={td}><PosDelta current={q.position} previous={q.prev_position} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                  <Card style={{ padding: 0, overflowX: 'auto' }}>
                    <div style={{ padding: '12px 14px' }}><b style={{ fontSize: 14, color: C.saphirF }}>Pages qui se classent</b></div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Page</th>
                        <th style={{ ...th, textAlign: 'right' }}>Clics</th>
                        <th style={{ ...th, textAlign: 'right' }}>Impr.</th>
                        <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
                        <th style={th}>Évol.</th>
                      </tr></thead>
                      <tbody>
                        {detail.pages.map((p) => (
                          <tr key={p.key}>
                            <td style={{ ...td, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <a href={p.key} target="_blank" rel="noreferrer" style={{ color: C.bleu, textDecoration: 'none' }} title={p.key}>
                                {p.key.replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/'}
                              </a>
                            </td>
                            <td style={tdNum}>{fmtInt(p.clicks)}</td>
                            <td style={tdNum}>{fmtInt(p.impressions)}</td>
                            <td style={tdNum}>{fmtPos(p.position)}</td>
                            <td style={td}><PosDelta current={p.position} previous={p.prev_position} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </div>
              )}

              {newQueries && (
                <Card style={{ padding: 0, overflowX: 'auto' }}>
                  <div style={{ padding: '12px 14px' }}>
                    <b style={{ fontSize: 14, color: C.saphirF }}>Nouvelles requêtes « jnr »</b>
                    <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>
                      vues du {longDate(newQueries.from)} au {longDate(newQueries.to)}, absentes les 28 jours d&apos;avant
                    </span>
                  </div>
                  {newQueries.queries.length === 0 ? (
                    <div style={{ padding: '0 14px 14px', fontSize: 13, color: C.grisM }}>Aucune nouvelle requête.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>
                        <th style={th}>Requête</th>
                        <th style={{ ...th, textAlign: 'right' }}>Impr.</th>
                        <th style={{ ...th, textAlign: 'right' }}>Clics</th>
                        <th style={{ ...th, textAlign: 'right' }}>Pos.</th>
                        <th style={th}>Page affichée</th>
                      </tr></thead>
                      <tbody>
                        {newQueries.queries.map((q) => (
                          <tr key={q.query}>
                            <td style={td}>{q.query}</td>
                            <td style={tdNum}>{fmtInt(q.impressions)}</td>
                            <td style={tdNum}>{fmtInt(q.clicks)}</td>
                            <td style={tdNum}>{fmtPos(q.position)}</td>
                            <td style={{ ...td, fontSize: 12, color: C.grisF }}>{(q.top_page || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
