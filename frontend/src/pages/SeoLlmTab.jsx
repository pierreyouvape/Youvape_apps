import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

/*
 * Onglet « IA » : visibilité de YouVape dans les réponses de Google AI Mode, Perplexity,
 * ChatGPT et Gemini. Historique repris de l'outil LLM Ranking d'Eskimoz (28/09 → 26/11/2026).
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  rouge: '#DE2020', vert: '#4AB866', orange: '#E28F00',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', violet: '#7C3AED',
};
// Une couleur par IA, ordre fixe (palette validée : séparation daltonisme et contraste).
const PROVIDER_COLOR = { 'ai-mode': '#0071EB', perplexity: '#C26E00', chatgpt: '#7C3AED', gemini: '#2E9E5B' };

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: C.grisM, fontWeight: 600, borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'top' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const btn = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 };
const btnPlein = { ...btn, background: C.saphir, color: C.blanc };

const longDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '—');
const shortDate = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : '');
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')} %`);
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function Card({ children, style }) {
  return <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px', marginBottom: 16, ...style }}>{children}</div>;
}

function Title({ children, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <b style={{ fontSize: 14, color: C.saphirF }}>{children}</b>
      {hint && <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>{hint}</span>}
    </div>
  );
}

// Taux de mention : fond bleu d'autant plus soutenu que le taux est haut (une seule teinte).
function RateCell({ s }) {
  if (!s || !s.n) return <td style={{ ...tdNum, color: C.grisM }}>—</td>;
  const v = s.mentionRate || 0;
  const alpha = v === 0 ? 0 : 0.08 + (0.5 * Math.min(v, 100)) / 100;
  return (
    <td style={{ ...tdNum, background: `rgba(0,113,235,${alpha})` }} title={`${s.mentions} mention(s) sur ${s.n} réponses · cité ${s.citations} fois`}>
      {fmtPct(s.mentionRate)}
    </td>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 150, padding: '10px 14px', borderRadius: 10, background: C.grisTL }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.grisF }}>
        {color && <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />}
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.saphirF, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.grisM }}>{sub}</div>}
    </div>
  );
}

// Texte de la réponse : les liens internes Google (/goto?url=…) sont chiffrés, on ne garde que leur texte.
const cleanResponse = (t) => String(t || '')
  .replace(/\[([^\]]*)\]\(\/goto\?url=[^)]*\)/g, '$1')
  .replace(/\[(\d+)\]\((https?:[^)]*)\)/g, '[$1 → $2]');

function ResponseView({ id, onClose }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setR(null);
    axios.get(`${API_URL}/seo/llm/responses/${id}`).then(({ data }) => setR(data)).catch((e) => setErr(e.response?.data?.error || e.message));
  }, [id]);
  return (
    <Card style={{ borderColor: C.saphir }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <b style={{ fontSize: 14, color: C.saphirF }}>Réponse complète</b>
        {r && <span style={{ fontSize: 12, color: C.grisF }}>{r.provider} · {longDate(r.date)} · {r.mention ? `YouVape mentionné${r.position ? ` (rang ${r.position})` : ''}` : 'YouVape absent'}{r.citation ? ' · youvape.fr cité en source' : ''}</span>}
        <button type="button" onClick={onClose} style={{ ...btn, marginLeft: 'auto' }}>Fermer</button>
      </div>
      {err && <div style={{ color: C.rouge, fontSize: 13 }}>{err}</div>}
      {r && (
        <>
          {r.competitors?.length > 0 && <div style={{ fontSize: 13, marginBottom: 8 }}><b>Concurrents cités :</b> {r.competitors.join(', ')}</div>}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, color: C.grisTF, maxHeight: 480, overflowY: 'auto', background: C.grisTL, padding: 12, borderRadius: 8 }}>
            {cleanResponse(r.response)}
          </div>
          {r.sources?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <b>Sources ({r.sources.length}) :</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {r.sources.map((u) => (
                  <li key={u}><a href={u} target="_blank" rel="noreferrer" style={{ color: /youvape\.fr/.test(u) ? C.vert : C.bleu, fontWeight: /youvape\.fr/.test(u) ? 700 : 400 }}>{shortUrl(u)}</a></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function PromptDetail({ id, provider, providers, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(null);
  const [openResp, setOpenResp] = useState(null);
  const [onlyMention, setOnlyMention] = useState(false);

  useEffect(() => {
    setD(null); setOpenResp(null); setSaved(null);
    axios.get(`${API_URL}/seo/llm/prompts/${id}`, { params: { provider } })
      .then(({ data }) => { setD(data); setNote(data.note || ''); })
      .catch((e) => setErr(e.response?.data?.error || e.message));
  }, [id, provider]);

  const saveNote = async () => {
    try {
      await axios.patch(`${API_URL}/seo/llm/prompts/${id}`, { note });
      setSaved('Note enregistrée.');
    } catch (e) { setSaved(e.response?.data?.error || e.message); }
  };

  if (err) return <Card><span style={{ color: C.rouge }}>{err}</span></Card>;
  if (!d) return <Card><span style={{ color: C.grisM, fontSize: 13 }}>Chargement…</span></Card>;
  const responses = onlyMention ? d.responses.filter((r) => r.mention) : d.responses;

  return (
    <>
      <Card style={{ borderColor: C.violet }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: C.saphirF, flex: 1 }}>{d.prompt}</h2>
          <button type="button" onClick={onClose} style={btn}>Fermer</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {providers.map((p) => {
            const s = d.byProvider[p.key];
            return (
              <Stat key={p.key} label={p.label} color={PROVIDER_COLOR[p.key]}
                value={s.n ? fmtPct(s.mentionRate) : '—'}
                sub={s.n ? `${s.mentions}/${s.n} mentions · cité ${s.citations}×${s.avgPosition ? ` · rang moy. ${String(s.avgPosition).replace('.', ',')}` : ''}` : 'aucune réponse'} />
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          <div>
            <Title hint="nombre de réponses qui citent la page">Pages sources les plus citées</Title>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {d.sources.map((s) => (
                  <tr key={s.url}>
                    <td style={{ ...td, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={s.url} target="_blank" rel="noreferrer" title={s.url}
                        style={{ color: s.self ? C.vert : C.bleu, fontWeight: s.self ? 700 : 400, textDecoration: 'none' }}>{shortUrl(s.url)}</a>
                    </td>
                    <td style={tdNum}>{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Title>Concurrents mentionnés</Title>
            {d.competitors.length === 0 ? <div style={{ fontSize: 13, color: C.grisM }}>Aucun.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
                <tbody>{d.competitors.map((c) => <tr key={c.name}><td style={td}>{c.name}</td><td style={tdNum}>{c.count}</td></tr>)}</tbody>
              </table>
            )}
            <Title hint="ce qu'on fait pour ce prompt">Note / action</Title>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(null); }} rows={5}
              style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <button type="button" onClick={saveNote} style={btnPlein}>Enregistrer</button>
              {saved && <span style={{ fontSize: 12, color: C.grisF }}>{saved}</span>}
            </div>
          </div>
        </div>
      </Card>

      {openResp && <ResponseView id={openResp} onClose={() => setOpenResp(null)} />}

      <Card style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
          <b style={{ fontSize: 14, color: C.saphirF }}>Réponses ({responses.length})</b>
          <label style={{ fontSize: 13, color: C.grisF, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={onlyMention} onChange={(e) => setOnlyMention(e.target.checked)} /> Seulement celles qui mentionnent YouVape
          </label>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Date</th><th style={th}>IA</th><th style={th}>YouVape</th>
            <th style={{ ...th, textAlign: 'right' }}>Rang</th><th style={{ ...th, textAlign: 'right' }}>Sentiment</th>
            <th style={th}>Cité en source</th><th style={th}>Concurrents</th><th style={th} />
          </tr></thead>
          <tbody>
            {responses.map((r) => (
              <tr key={r.id} style={{ background: openResp === r.id ? '#EEF4FF' : 'transparent' }}>
                <td style={td}>{longDate(r.date)}</td>
                <td style={td}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: PROVIDER_COLOR[r.provider], marginRight: 6 }} />{providers.find((p) => p.key === r.provider)?.label || r.provider}</td>
                <td style={{ ...td, color: r.mention ? C.vert : C.grisM, fontWeight: r.mention ? 700 : 400 }}>{r.mention ? 'Mentionné' : 'Absent'}</td>
                <td style={tdNum}>{r.position || '—'}</td>
                <td style={tdNum}>{r.sentiment ?? '—'}</td>
                <td style={td}>{r.citation ? 'Oui' : '—'}</td>
                <td style={{ ...td, fontSize: 12, color: C.grisF }}>{r.competitors.join(', ') || '—'}</td>
                <td style={td}><button type="button" style={btn} onClick={() => setOpenResp(r.id)}>Lire</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export default function SeoLlmTab() {
  const [provider, setProvider] = useState('all');
  const [measure, setMeasure] = useState('mentionRate');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState('mentionRate');
  const fileRef = useRef(null);
  const detailRef = useRef(null);

  const load = useCallback(() => {
    setErr(null);
    axios.get(`${API_URL}/seo/llm/overview`, { params: { provider } })
      .then(({ data: d }) => setData(d))
      .catch((e) => setErr(e.response?.data?.error || e.message));
  }, [provider]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data: r } = await axios.post(`${API_URL}/seo/llm/import`, fd);
      setImportMsg(`${r.inserted} réponse(s) ajoutée(s), ${r.skipped} déjà présente(s) ou ignorée(s), ${r.promptsCreated} nouveau(x) prompt(s).`);
      load();
    } catch (e) {
      setImportMsg(e.response?.data?.error || e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openPrompt = (id) => {
    setSelected(id);
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const providers = data?.providers || [];
  const empty = data && data.total.n === 0;
  const chartData = (data?.series || []).map((w) => {
    const point = { label: shortDate(w.week) };
    for (const p of providers) point[p.key] = w[p.key]?.n ? w[p.key][measure] : null;
    return point;
  });
  const prompts = [...(data?.prompts || [])].sort((a, b) => (
    sort === 'prompt' ? a.prompt.localeCompare(b.prompt) : (b[sort] ?? -1) - (a[sort] ?? -1)
  ));
  const shownProviders = provider === 'all' ? providers : providers.filter((p) => p.key === provider);

  return (
    <div>
      <Card style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: C.grisF }}>
          <div><b>Ce que mesure l&apos;onglet :</b> les questions qu&apos;un vapoteur pose aux IA, et si YouVape apparaît dans leurs réponses.</div>
          <div>
            <b>Données :</b> {data && !empty ? `${data.total.n} réponses du ${longDate(data.from)} au ${longDate(data.to)} (historique Eskimoz LLM Ranking)` : 'aucune pour l’instant'}
          </div>
          <div style={{ color: C.grisM, fontSize: 12 }}>Mentionné = YouVape nommé dans le texte · Cité = une page youvape.fr dans les sources.</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" disabled={importing} onClick={() => fileRef.current?.click()} style={btn}
            title="Export « prompt-responses_….csv » de l'outil LLM Ranking. Ré-importer le même fichier n'ajoute pas de doublon.">
            {importing ? 'Import en cours…' : 'Importer un export Eskimoz'}
          </button>
        </div>
        {importMsg && <div style={{ width: '100%', fontSize: 13, color: C.grisF }}>{importMsg}</div>}
      </Card>

      {err && <Card style={{ borderColor: C.rouge }}><span style={{ color: C.rouge, fontSize: 13 }}>{err}</span></Card>}

      {data && !empty && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); }}
              style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, fontSize: 13 }}>
              <option value="all">Toutes les IA</option>
              {providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>

          <Card>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Stat label="Toutes IA" value={fmtPct(data.total.mentionRate)} sub={`mentionné · cité ${fmtPct(data.total.citationRate)}`} />
              {providers.map((p) => {
                const s = data.byProvider[p.key];
                return (
                  <Stat key={p.key} label={p.label} color={PROVIDER_COLOR[p.key]} value={s.n ? fmtPct(s.mentionRate) : '—'}
                    sub={s.n ? `mentionné · cité ${fmtPct(s.citationRate)} · ${s.n} rép.` : 'aucune réponse'} />
                );
              })}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <b style={{ fontSize: 14, color: C.saphirF }}>Évolution par semaine</b>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {[{ k: 'mentionRate', l: 'Mentionné' }, { k: 'citationRate', l: 'Cité en source' }].map((m) => (
                  <button key={m.k} type="button" onClick={() => setMeasure(m.k)} style={measure === m.k ? btnPlein : btn}>{m.l}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.grisM, marginBottom: 8 }}>
              Part des réponses de la semaine (lundi indiqué). Peu de réponses par semaine et par IA : une variation de quelques points n&apos;est pas un signal.
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={C.grisTL} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.grisM }} />
                  <YAxis tick={{ fontSize: 11, fill: C.grisM }} tickFormatter={(v) => `${v} %`} domain={[0, 'auto']} />
                  <Tooltip formatter={(v, name) => [fmtPct(v), providers.find((p) => p.key === name)?.label || name]} />
                  <Legend formatter={(v) => providers.find((p) => p.key === v)?.label || v} wrapperStyle={{ fontSize: 12 }} />
                  {shownProviders.map((p) => (
                    <Line key={p.key} type="monotone" dataKey={p.key} stroke={PROVIDER_COLOR[p.key]} strokeWidth={2}
                      dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '12px 14px' }}>
              <b style={{ fontSize: 14, color: C.saphirF }}>Prompts suivis ({prompts.length})</b>
              <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>part des réponses qui mentionnent YouVape, par IA · cliquer une ligne pour le détail</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, cursor: 'pointer' }} onClick={() => setSort('prompt')}>Prompt</th>
                {shownProviders.map((p) => <th key={p.key} style={{ ...th, textAlign: 'right' }}>{p.label}</th>)}
                <th style={{ ...th, textAlign: 'right', cursor: 'pointer' }} onClick={() => setSort('mentionRate')}>Mentionné {sort === 'mentionRate' ? '▼' : ''}</th>
                <th style={{ ...th, textAlign: 'right', cursor: 'pointer' }} onClick={() => setSort('citationRate')}>Cité {sort === 'citationRate' ? '▼' : ''}</th>
                <th style={th}>Concurrents les plus cités</th>
              </tr></thead>
              <tbody>
                {prompts.map((p) => (
                  <tr key={p.id} onClick={() => openPrompt(p.id)} style={{ cursor: 'pointer', background: selected === p.id ? '#EEF4FF' : 'transparent' }}>
                    <td style={{ ...td, maxWidth: 420 }}>
                      {p.prompt}
                      {p.note && <div style={{ fontSize: 11, color: C.violet, marginTop: 2 }}>📝 {p.note.split('\n')[0].slice(0, 90)}</div>}
                    </td>
                    {shownProviders.map((pr) => <RateCell key={pr.key} s={p.providers[pr.key]} />)}
                    <td style={{ ...tdNum, fontWeight: 700 }}>{fmtPct(p.mentionRate)}</td>
                    <td style={tdNum}>{fmtPct(p.citationRate)}</td>
                    <td style={{ ...td, fontSize: 12, color: C.grisF }}>{p.competitors.map((c) => `${c.name} (${c.count})`).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div ref={detailRef}>
            {selected && <PromptDetail id={selected} provider={provider} providers={providers} onClose={() => setSelected(null)} />}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <Card style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ padding: '12px 14px' }}><Title hint="réponses qui nomment la marque">Marques mentionnées</Title></div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.competitors.map((c) => (
                    <tr key={c.name}>
                      <td style={{ ...td, fontWeight: c.self ? 700 : 400, color: c.self ? C.vert : C.grisTF }}>{c.name}</td>
                      <td style={tdNum}>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ padding: '12px 14px' }}><Title hint="réponses qui citent le site">Sites sources</Title></div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.domains.map((d) => (
                    <tr key={d.domain}>
                      <td style={{ ...td, fontWeight: d.self ? 700 : 400, color: d.self ? C.vert : C.grisTF }}>{d.domain}</td>
                      <td style={tdNum}>{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ padding: '12px 14px' }}><Title hint="réponses · prompts différents">Pages YouVape citées</Title></div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.youvapeUrls.map((u) => (
                    <tr key={u.url}>
                      <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={u.url} target="_blank" rel="noreferrer" title={u.url} style={{ color: C.bleu, textDecoration: 'none' }}>
                          {u.url.replace(/^https?:\/\/(www\.)?[^/]+/, '') || '/'}
                        </a>
                      </td>
                      <td style={tdNum}>{u.count}</td>
                      <td style={{ ...tdNum, color: C.grisM }}>{u.prompts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
