import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import AppShell from '../components/AppShell';
import { Seo as SeoIcon } from '../components/AppIcons';

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

          {error && (
            <Card style={{ borderColor: C.rouge, marginBottom: 14 }}>
              <span style={{ color: C.rouge, fontSize: 14 }}>{error}</span>
            </Card>
          )}

          {status && !status.configured && <SetupPanel status={status} />}

          {status?.configured && (
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

          {hasData && (
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
