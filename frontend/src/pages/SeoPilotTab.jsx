import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ResponsiveContainer, LineChart, Line, YAxis, ReferenceLine } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  orange: '#E28F00', rouge: '#DE2020', vert: '#4AB866', vertF: '#15803d',
  bleu: '#0071EB', saphir: '#135E84', saphirF: '#003A56',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', violet: '#7C3AED',
};
const SITE = 'https://www.youvape.fr';

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0));
const fmt1 = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toFixed(1).replace('.', ','));
const pct = (n) => (n === null || n === undefined ? '—' : `${fmt1(n)} %`);
const frDate = (ymd) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('/') : '—');
const pathOf = (u) => (u || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/';
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: C.grisM, fontWeight: 600, borderBottom: `1px solid ${C.grisCL}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, color: C.grisTF, borderBottom: `1px solid ${C.grisTL}`, verticalAlign: 'top' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const btn = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.saphir}`, background: C.blanc, color: C.saphir, cursor: 'pointer', fontSize: 13 };
const btnPlein = { ...btn, background: C.saphir, color: C.blanc };
const input = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13 };

function Card({ children, style }) {
  return <div style={{ background: C.blanc, borderRadius: 14, border: `1px solid ${C.grisCL}`, padding: '16px 18px', marginBottom: 16, ...style }}>{children}</div>;
}

function Pill({ color, children, title }) {
  return (
    <span title={title} style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

const VERDICT_COLORS = { gagnee: C.vertF, attente: C.orange, revoir: C.rouge, vide: C.grisM };

function PageLink({ url, onOpen }) {
  const path = pathOf(url);
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <button type="button" onClick={() => onOpen(path)} title="Ouvrir la fiche page"
        style={{ border: 'none', background: 'none', padding: 0, color: C.bleu, cursor: 'pointer', fontSize: 13, textAlign: 'left', wordBreak: 'break-all', whiteSpace: 'normal' }}>
        {path}
      </button>
      <a href={`${SITE}${path === '/' ? '' : path}`} target="_blank" rel="noreferrer" title="Voir en ligne" style={{ marginLeft: 6, color: C.grisM, textDecoration: 'none', fontSize: 12 }}>↗</a>
    </span>
  );
}

/* ─── PAGES CIBLES ──────────────────────────────────────── */

const EMPTY_TARGET = { label: '', pattern: '', target_url: '', decided_at: todayYmd(), note: '' };

function TargetForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(initial || EMPTY_TARGET);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      if (f.id) await axios.put(`${API_URL}/seo/pilot/targets/${f.id}`, f);
      else await axios.post(`${API_URL}/seo/pilot/targets`, f);
      onSaved();
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div style={{ background: C.grisTL, borderRadius: 10, padding: 12, margin: '10px 0', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      <label style={{ fontSize: 12, color: C.grisF }}>Requête (libellé)<input style={{ ...input, width: '100%' }} value={f.label} onChange={set('label')} placeholder="cigarette électronique" /></label>
      <label style={{ fontSize: 12, color: C.grisF }}>Page cible<input style={{ ...input, width: '100%' }} value={f.target_url} onChange={set('target_url')} placeholder="/categorie-produit/e-cigarettes" /></label>
      <label style={{ fontSize: 12, color: C.grisF }}>Requêtes couvertes (expression régulière)<input style={{ ...input, width: '100%', fontFamily: 'monospace' }} value={f.pattern} onChange={set('pattern')} placeholder="^cigarettes? (é|e)lectroniques?$" /></label>
      <label style={{ fontSize: 12, color: C.grisF }}>Décidée le<input type="date" style={{ ...input, width: '100%' }} value={f.decided_at} onChange={set('decided_at')} /></label>
      <label style={{ fontSize: 12, color: C.grisF, gridColumn: '1 / -1' }}>Note<input style={{ ...input, width: '100%' }} value={f.note || ''} onChange={set('note')} /></label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', gridColumn: '1 / -1' }}>
        <button type="button" style={btnPlein} disabled={busy} onClick={save}>{busy ? 'Calcul…' : 'Enregistrer et mesurer'}</button>
        <button type="button" style={btn} onClick={onCancel}>Annuler</button>
        {msg && <span style={{ color: C.rouge, fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}

function TargetRow({ t, seuil, onOpen, onEdit }) {
  const [open, setOpen] = useState(false);
  const s = t.stats || {};
  const b = s.baseline || {};
  const l = s.last28 || {};
  const since = s.since;
  const color = VERDICT_COLORS[t.verdict?.code] || C.grisM;
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <td style={td}><span style={{ color: C.grisM, marginRight: 6 }}>{open ? '▾' : '▸'}</span><b>{t.label}</b></td>
        <td style={td} onClick={(e) => e.stopPropagation()}><PageLink url={t.target_url} onOpen={onOpen} /></td>
        <td style={tdNum}>{fmtInt(l.impressions)}</td>
        <td style={tdNum}>{pct(b.target_share)}</td>
        <td style={{ ...tdNum, fontWeight: 700, color: (l.target_share ?? 0) >= seuil ? C.vertF : C.grisTF }}>{pct(l.target_share)}</td>
        <td style={tdNum}>{fmt1(b.target_position)} → <b>{fmt1(l.target_position)}</b></td>
        <td style={{ ...td, width: 130, padding: '2px 10px' }}>
          <div style={{ width: 120, height: 30 }}>
            <ResponsiveContainer>
              <LineChart data={s.weeks || []}>
                <YAxis hide domain={[0, 100]} />
                <ReferenceLine y={seuil} stroke={C.grisCL} strokeDasharray="3 3" />
                <Line type="linear" dataKey="target_share" stroke={C.violet} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </td>
        <td style={td}>
          <Pill color={color}>{t.verdict?.label}</Pill>
          {t.repos_until && <div style={{ fontSize: 11, color: C.grisM, marginTop: 3 }}>au repos jusqu&apos;au {frDate(t.repos_until)}</div>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ ...td, background: '#FAFBFC' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: C.grisF, marginBottom: 8 }}>
              <span>Décidée le {frDate(t.decided_at)}{t.decided_by ? ` par ${t.decided_by}` : ''}</span>
              <span>Départ : du {frDate(b.from)} au {frDate(b.to)}</span>
              {since && <span>Depuis la décision : {pct(since.target_share)} des {fmtInt(since.impressions)} impressions (du {frDate(since.from)} au {frDate(since.to)})</span>}
              <span>{fmtInt(s.queries)} requêtes couvertes, <code>{t.pattern}</code></span>
              <button type="button" style={{ ...btn, padding: '3px 10px', fontSize: 12 }} onClick={() => onEdit(t)}>Modifier</button>
            </div>
            {t.note && <div style={{ fontSize: 12, color: C.grisF, marginBottom: 8 }}>{t.note}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}>
              {[['Au départ', b], ['28 derniers jours', l]].map(([title, agg]) => (
                <div key={title}>
                  <b style={{ fontSize: 13, color: C.saphirF }}>{title}</b>
                  <span style={{ fontSize: 12, color: C.grisM, marginLeft: 6 }}>{fmtInt(agg.impressions)} impressions, {fmtInt(agg.pages_count)} pages</span>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                    <thead><tr><th style={th}>Page</th><th style={{ ...th, textAlign: 'right' }}>Part</th><th style={{ ...th, textAlign: 'right' }}>Pos.</th><th style={{ ...th, textAlign: 'right' }}>Clics</th></tr></thead>
                    <tbody>
                      {(agg.pages || []).slice(0, 6).map((p) => (
                        <tr key={p.page} style={{ background: pathOf(p.page) === t.target_path ? '#F3EEFF' : 'transparent' }}>
                          <td style={td}><PageLink url={p.page} onOpen={onOpen} /></td>
                          <td style={tdNum}>{pct(p.share)}</td>
                          <td style={tdNum}>{fmt1(p.position)}</td>
                          <td style={tdNum}>{fmtInt(p.clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function TargetsTab({ onOpenPage }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: d } = await axios.get(`${API_URL}/seo/pilot/targets`);
      setData(d);
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data: d } = await axios.post(`${API_URL}/seo/pilot/targets/refresh`);
      setData(d);
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };
  const targets = data?.targets || [];
  const computed = targets.find((t) => t.computed_at)?.computed_at;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: C.saphirF }}>Pages cibles</h2>
        <span style={{ fontSize: 12, color: C.grisM }}>
          une page décidée par requête importante · France{computed ? ` · mesuré le ${new Date(computed).toLocaleString('fr-FR')}` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" style={btn} disabled={busy} onClick={refresh}>{busy ? 'Mesure…' : 'Mesurer maintenant'}</button>
          <button type="button" style={btnPlein} onClick={() => setEditing({ ...EMPTY_TARGET })}>Ajouter une cible</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.grisM, marginBottom: 10 }}>
        « Part » = part des impressions de ces requêtes que Google donne à la page cible, parmi toutes nos pages. Une requête est gagnée au-delà de {data?.seuil ?? 80} %.
        Les recommandations de cannibalisation suivent ces décisions. Une page modifiée reste au repos {data?.repos ?? 28} jours avant d&apos;être jugée.
      </div>
      {msg && <div style={{ color: C.rouge, fontSize: 13, marginBottom: 8 }}>{msg}</div>}
      {editing && <TargetForm initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Requête</th><th style={th}>Page cible</th><th style={{ ...th, textAlign: 'right' }}>Impr. 28 j</th>
            <th style={{ ...th, textAlign: 'right' }}>Part au départ</th><th style={{ ...th, textAlign: 'right' }}>Part 28 j</th>
            <th style={{ ...th, textAlign: 'right' }}>Position cible</th><th style={th}>Part sur 16 sem.</th><th style={th}>Verdict</th>
          </tr></thead>
          <tbody>
            {targets.map((t) => (
              <TargetRow key={t.id} t={t} seuil={data.seuil} onOpen={onOpenPage}
                onEdit={(x) => setEditing({ id: x.id, label: x.label, pattern: x.pattern, target_url: x.target_path, decided_at: x.decided_at, note: x.note || '' })} />
            ))}
          </tbody>
        </table>
      </div>
      {data && targets.length === 0 && <div style={{ fontSize: 13, color: C.grisM }}>Aucune page cible.</div>}
    </Card>
  );
}

/* ─── FICHE PAGE ────────────────────────────────────────── */

const CHECK_STYLE = {
  ok: { color: C.vertF, label: 'OK' },
  warn: { color: C.orange, label: 'À revoir' },
  ko: { color: C.rouge, label: 'À corriger' },
};

function actionsAsText(fiche) {
  const rows = fiche.checks.filter((c) => c.status !== 'ok');
  const lines = [`Page : ${SITE}${fiche.path === '/' ? '' : fiche.path}`, `Requête principale : ${fiche.main_query || '—'}`, ''];
  rows.forEach((c, i) => lines.push(`${i + 1}. ${c.element}\n   Actuellement : ${c.actuel}\n   À faire : ${c.action}`));
  fiche.recommendations.forEach((r) => lines.push(`\nRecommandation : ${r.title}\n${r.action || ''}`));
  return lines.join('\n');
}

function JournalBlock({ fiche, onChanged }) {
  const [date, setDate] = useState(todayYmd());
  const [summary, setSummary] = useState('');
  const [msg, setMsg] = useState(null);
  const add = async () => {
    setMsg(null);
    try {
      await axios.post(`${API_URL}/seo/pilot/journal`, { url: fiche.path, date, summary });
      setSummary('');
      onChanged();
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    }
  };
  const del = async (id) => {
    try { await axios.delete(`${API_URL}/seo/pilot/journal/${id}`); onChanged(); } catch (e) { setMsg(e.response?.data?.error || e.message); }
  };
  return (
    <Card>
      <b style={{ fontSize: 14, color: C.saphirF }}>Journal de la page</b>
      <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>
        noter chaque publication : la page reste ensuite au repos 4 semaines, le temps de mesurer.
      </span>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
        <input type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
        <input style={{ ...input, flex: 1, minWidth: 260 }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Ce qui a été modifié (title, intro, FAQ, liens…)" />
        <button type="button" style={btnPlein} onClick={add}>Noter</button>
      </div>
      {msg && <div style={{ color: C.rouge, fontSize: 13 }}>{msg}</div>}
      {fiche.journal.length === 0 ? <div style={{ fontSize: 13, color: C.grisM }}>Aucune modification notée.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {fiche.journal.map((j) => (
              <tr key={`${j.source}-${j.id}`}>
                <td style={{ ...td, whiteSpace: 'nowrap', width: 90 }}>{frDate(j.date)}</td>
                <td style={td}>{j.summary}{j.source === 'redaction' ? ' (Rédaction SEO)' : ''}</td>
                <td style={{ ...td, color: C.grisM, fontSize: 12, whiteSpace: 'nowrap' }}>{j.created_by || ''}</td>
                <td style={{ ...td, width: 30 }}>
                  {j.source === 'journal' && <button type="button" onClick={() => del(j.id)} title="Supprimer" style={{ border: 'none', background: 'none', color: C.grisM, cursor: 'pointer' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function PageTab({ url, onOpenPage }) {
  const [value, setValue] = useState(url || '');
  const [fiche, setFiche] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (u) => {
    if (!u) return;
    setLoading(true); setMsg(null);
    try {
      const { data } = await axios.get(`${API_URL}/seo/pilot/page`, { params: { url: u } });
      setFiche(data);
    } catch (e) {
      setMsg(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (url) { setValue(url); load(url); } }, [url, load]);

  const copy = async () => {
    const text = actionsAsText(fiche);
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setMsg('Copie refusée par le navigateur.'); }
  };

  const todo = fiche ? fiche.checks.filter((c) => c.status !== 'ok') : [];
  return (
    <>
      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 17, color: C.saphirF }}>Fiche page</h2>
          <span style={{ fontSize: 12, color: C.grisM }}>tout ce qu&apos;il faut faire sur une page, en une seule passe</span>
          <form style={{ marginLeft: 'auto', display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v === url) load(v); else onOpenPage(v); }}>
            <input style={{ ...input, width: 380 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="/categorie-produit/e-cigarettes ou adresse complète" />
            <button type="submit" style={btnPlein} disabled={loading}>{loading ? 'Relevé…' : 'Analyser'}</button>
          </form>
        </div>
        {msg && <div style={{ color: C.rouge, fontSize: 13, marginTop: 8 }}>{msg}</div>}
        {fiche && (
          <div style={{ marginTop: 12, display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: C.grisF, alignItems: 'center' }}>
            <span><b style={{ color: C.saphirF }}>{fiche.path}</b> <a href={`${SITE}${fiche.path === '/' ? '' : fiche.path}`} target="_blank" rel="noreferrer" style={{ color: C.grisM, textDecoration: 'none' }}>↗</a> · {fiche.kind}</span>
            <span>Requête principale : <b>{fiche.main_query || '—'}</b></span>
            {fiche.own_targets.length > 0 && (
              <span>Page cible de : {fiche.own_targets.map((t) => `${t.label} (${pct(t.share)})`).join(' · ')}</span>
            )}
            {fiche.repos_until
              ? <Pill color={C.orange} title={`Dernière modification le ${frDate(fiche.last_change)}`}>Au repos jusqu&apos;au {frDate(fiche.repos_until)}</Pill>
              : fiche.last_change && <span>Dernière modification : {frDate(fiche.last_change)}</span>}
          </div>
        )}
      </Card>

      {fiche && (
        <>
          {fiche.repos_until && (
            <Card style={{ borderColor: C.orange, background: '#FFF8EC' }}>
              <span style={{ fontSize: 13, color: C.grisTF }}>
                Cette page a été modifiée le {frDate(fiche.last_change)}. Sauf erreur bloquante (en rouge), attendre le {frDate(fiche.repos_until)} avant de la retoucher : sinon on ne saura pas ce qui a fonctionné.
              </span>
            </Card>
          )}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14, color: C.saphirF }}>Contrôles</b>
              <span style={{ fontSize: 12, color: C.grisM }}>
                page relevée à l&apos;instant · {todo.length ? `${todo.length} point(s) à traiter` : 'rien à corriger'} · liens reçus relevés sur les ~150 pages les plus vues
              </span>
              {todo.length > 0 && (
                <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={copy}>{copied ? 'Copié' : 'Copier la liste des actions'}</button>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Élément</th><th style={th}>Statut</th><th style={th}>Actuellement</th><th style={th}>À faire</th></tr></thead>
                <tbody>
                  {fiche.checks.map((c, i) => {
                    const st = CHECK_STYLE[c.status];
                    return (
                      <tr key={`${c.element}-${i}`}>
                        <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{c.element}</td>
                        <td style={td}><Pill color={st.color}>{st.label}</Pill></td>
                        <td style={{ ...td, color: C.grisF }}>{c.actuel}</td>
                        <td style={td}>{c.action}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {fiche.recommendations.length > 0 && (
            <Card>
              <b style={{ fontSize: 14, color: C.saphirF }}>Recommandations ouvertes sur cette page</b>
              {fiche.recommendations.map((r) => (
                <div key={r.id} style={{ borderTop: `1px solid ${C.grisTL}`, padding: '8px 0', fontSize: 13 }}>
                  <b>{r.title}</b> <span style={{ color: C.grisM, fontSize: 12 }}>· {r.type} · {r.status === 'doing' ? 'en cours' : 'à faire'}</span>
                  <div style={{ whiteSpace: 'pre-wrap', color: C.grisF, marginTop: 4 }}>{r.action}</div>
                </div>
              ))}
            </Card>
          )}

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '12px 14px' }}>
              <b style={{ fontSize: 14, color: C.saphirF }}>Requêtes qui mènent à cette page</b>
              <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>France, du {frDate(fiche.period.from)} au {frDate(fiche.period.to)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>Requête</th><th style={{ ...th, textAlign: 'right' }}>Impr.</th><th style={{ ...th, textAlign: 'right' }}>Clics</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pos.</th><th style={{ ...th, textAlign: 'right' }}>Part ici</th><th style={th}>Page cible</th><th style={th}>Autres pages</th>
                </tr></thead>
                <tbody>
                  {fiche.queries.map((q) => (
                    <tr key={q.query} style={{ background: q.target && !q.target.isThis ? '#FFF1F1' : 'transparent' }}>
                      <td style={td}>{q.query}</td>
                      <td style={tdNum}>{fmtInt(q.impressions)}</td>
                      <td style={tdNum}>{fmtInt(q.clicks)}</td>
                      <td style={tdNum}>{fmt1(q.position)}</td>
                      <td style={tdNum}>{pct(q.share)}</td>
                      <td style={{ ...td, fontSize: 12 }}>
                        {!q.target ? <span style={{ color: C.grisM }}>—</span> : q.target.isThis
                          ? <span style={{ color: C.vertF, fontWeight: 600 }}>cette page</span>
                          : <PageLink url={q.target.path} onOpen={onOpenPage} />}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: C.grisF }}>
                        {q.rivals.map((r) => <div key={r.page}><PageLink url={r.page} onOpen={onOpenPage} /> {pct(r.share)}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fiche.queries.length === 0 && <div style={{ padding: '0 14px 14px', fontSize: 13, color: C.grisM }}>Aucune impression sur la période.</div>}
          </Card>

          <Card style={{ padding: 0 }}>
            <div style={{ padding: '12px 14px' }}>
              <b style={{ fontSize: 14, color: C.saphirF }}>Liens reçus (dans le contenu)</b>
              <span style={{ fontSize: 12, color: C.grisM, marginLeft: 8 }}>{fiche.incoming.length} lien(s) trouvé(s)</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Depuis</th><th style={th}>Ancre</th></tr></thead>
              <tbody>
                {fiche.incoming.map((l, i) => (
                  <tr key={`${l.from}-${i}`}><td style={td}><PageLink url={l.from} onOpen={onOpenPage} /></td><td style={td}>{l.anchor || <span style={{ color: C.grisM }}>(sans texte)</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <JournalBlock fiche={fiche} onChanged={() => load(fiche.path)} />
        </>
      )}
    </>
  );
}
