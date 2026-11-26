import { useCallback, useEffect, useMemo, useState } from 'react';
import { tachesApi, apiError, todayStr, addDays, M, inputStyle, mTable, mTh, mTd } from './tachesShared';
import { Avatar } from './tachesUi';

/*
 * Tableau de bord : combien de choses à faire, en cours, bloquées, faites —
 * en tout et par personne. Couleurs = statuts Monday (état, jamais seules :
 * légende + tableau chiffré). Le gris « À faire » est foncé ici pour se voir
 * sur fond blanc.
 */
const BUCKETS = [
  { key: 'a_faire', label: 'À faire', color: '#9699A6', ink: '#fff' },
  { key: 'en_cours', label: 'En cours', color: '#FDAB3D', ink: '#0b0b0b' },
  { key: 'bloque', label: 'Bloqué', color: '#DF2F4A', ink: '#fff' },
  { key: 'fait', label: 'Fait', color: '#00C875', ink: '#0b0b0b' },
];
/** Périodes : `phrase` sert dans les textes (« 3 faites · cette année »). */
const PERIODS = [
  { key: '7', label: '7 jours', phrase: '7 derniers jours' },
  { key: '30', label: '30 jours', phrase: '30 derniers jours' },
  { key: '90', label: '90 jours', phrase: '90 derniers jours' },
  { key: 'mois', label: 'Ce mois-ci', phrase: 'ce mois-ci' },
  { key: 'annee', label: 'Cette année', phrase: 'cette année' },
  { key: 'annee-1', label: 'L\'année dernière', phrase: 'l\'année dernière' },
];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Bornes de la période [from, to[ en YYYY-MM-DD. */
function periodRange(key, today) {
  const y = Number(today.slice(0, 4));
  if (key === 'mois') return { from: `${today.slice(0, 7)}-01`, to: addDays(today, 1) };
  if (key === 'annee') return { from: `${y}-01-01`, to: addDays(today, 1) };
  if (key === 'annee-1') return { from: `${y - 1}-01-01`, to: `${y}-01-01` };
  return { from: addDays(today, -Number(key)), to: addDays(today, 1) };
}

/** Colonnes du graphique : les 12 mois de l'année pour une période annuelle, sinon les 8 dernières semaines. */
function rhythmBuckets(key, today) {
  if (key === 'annee' || key === 'annee-1') {
    const y = Number(today.slice(0, 4)) - (key === 'annee-1' ? 1 : 0);
    return Array.from({ length: 12 }, (_, m) => {
      const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const to = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, '0')}-01`;
      return { from, to, n: 0, label: MONTHS[m], current: today >= from && today < to, future: from > today };
    });
  }
  const wd = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(addDays(today, -wd), -7 * 7);
  return Array.from({ length: 8 }, (_, i) => {
    const from = addDays(start, 7 * i);
    return {
      from, to: addDays(from, 7), n: 0, current: i === 7,
      label: i === 7 ? 'Cette sem.' : new Date(`${from}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    };
  });
}
const ACTIVE = ['en_cours', 'attente_correction', 'suivi_google', 'longue'];

/** « Unité de travail » d'une personne : une étape à son nom, ou une tâche sans étape dont elle est la personne. */
function workItems(tasks) {
  const out = [];
  tasks.forEach((t) => {
    if (t.steps.length) {
      t.steps.forEach((s) => out.push({
        task: t, name: s.name, people: s.owners, status: s.status, due: s.due_date, doneAt: s.done_at,
      }));
    } else {
      out.push({
        task: t, name: t.title, people: t.people, status: t.status, due: t.due_date,
        doneAt: t.status === 'fait' ? t.updated_at : null, // pas d'horodatage « fait » pour une tâche sans étape
      });
    }
  });
  return out;
}
const bucketOf = (st) => (st === 'fait' ? 'fait' : st === 'bloque' ? 'bloque' : ACTIVE.includes(st) ? 'en_cours' : 'a_faire');

export default function DashboardTab({ boards, members, onOpenPerson, onError }) {
  const [tasks, setTasks] = useState(null);
  const [boardId, setBoardId] = useState('all');
  const [period, setPeriod] = useState('30');
  const [tip, setTip] = useState(null); // { x, y, text }

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.board({ board: boardId === 'all' ? undefined : boardId }));
    } catch (e) { onError(apiError(e)); }
  }, [boardId, onError]);
  useEffect(() => { load(); }, [load]);

  const today = todayStr();
  const range = periodRange(period, today);
  const yearly = period === 'annee' || period === 'annee-1';

  const stats = useMemo(() => {
    if (!tasks) return null;
    const items = workItems(tasks);
    const inPeriod = (it) => it.status === 'fait' && it.doneAt && it.doneAt.slice(0, 10) >= range.from && it.doneAt.slice(0, 10) < range.to;
    const count = (list) => {
      const c = { a_faire: 0, en_cours: 0, bloque: 0, fait: 0, late: 0, open: 0 };
      list.forEach((it) => {
        const b = bucketOf(it.status);
        if (b === 'fait') { if (inPeriod(it)) c.fait += 1; return; }
        c[b] += 1;
        c.open += 1;
        if (it.due && it.due < today) c.late += 1;
      });
      return c;
    };
    // Tâches (niveau tâche)
    const t = { total: tasks.length, fait: 0, en_cours: 0, a_faire: 0, bloque: 0, late: 0, doneInPeriod: 0 };
    tasks.forEach((x) => {
      const b = x.status === 'longue' ? 'en_cours' : x.status;
      t[b] = (t[b] || 0) + 1;
      if (x.status !== 'fait' && x.due_date && x.due_date < today) t.late += 1;
    });
    t.doneInPeriod = new Set(items.filter(inPeriod).map((it) => it.task.id)).size;
    const people = members.filter((m) => m.has_app !== false).map((m) => ({
      ...m, c: count(items.filter((it) => it.people.includes(m.id))),
    })).sort((a, b) => b.c.open - a.c.open);
    const nobody = count(items.filter((it) => !it.people.length));
    // Faits par semaine (8 dernières semaines, lundi → dimanche)
    const weeks = rhythmBuckets(period, today);
    items.forEach((it) => {
      if (it.status !== 'fait' || !it.doneAt) return;
      const d = it.doneAt.slice(0, 10);
      const w = weeks.find((x) => d >= x.from && d < x.to);
      if (w) w.n += 1;
    });
    const undated = items.filter((it) => it.status === 'fait' && !it.doneAt).length;
    // Par étiquette (ouvert)
    const byLabel = new Map();
    tasks.filter((x) => x.status !== 'fait').forEach((x) => x.labels.forEach((l) => byLabel.set(l, (byLabel.get(l) || 0) + 1)));
    return {
      t, people, nobody, weeks, undated, all: count(items),
      labels: [...byLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [tasks, members, range.from, range.to, period, today]);

  if (!stats) return <div style={{ color: M.sub, padding: 20 }}>Chargement…</div>;

  // Axe du graphique hebdomadaire : maximum « rond », graduations entières à leur vraie hauteur.
  const rawMax = Math.max(1, ...stats.weeks.map((w) => w.n));
  const step = rawMax <= 4 ? 1 : 10 ** Math.floor(Math.log10(rawMax / 2)) * ([1, 2, 5].find((k) => k * 10 ** Math.floor(Math.log10(rawMax / 2)) * 2 >= rawMax / 2) || 10);
  const maxWeek = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(maxWeek / step) }, (_, i) => (i + 1) * step).filter((v, i, a) => a.length <= 4 || i % 2 === 1 || v === maxWeek);
  const show = (e, text) => setTip({ x: e.clientX, y: e.clientY, text });
  const hide = () => setTip(null);
  const periodLabel = PERIODS.find((p) => p.key === period).phrase;
  const fmtWeek = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const all = stats.all;
  const allTotal = BUCKETS.reduce((a, b) => a + all[b.key], 0) || 1;

  return (
    <div style={{ fontFamily: M.font, color: M.text, background: BG, margin: '-8px -28px -40px', padding: '20px 28px 40px', minHeight: '100%' }} onMouseLeave={hide}>
      {/* Filtres : une ligne, au-dessus de tout */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)}
          style={{ ...inputStyle, width: 230, padding: '8px 10px', fontSize: 13, background: '#fff', border: 'none', boxShadow: SHADOW, borderRadius: 10 }}>
          <option value="all">Tous les tableaux</option>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div style={{ display: 'flex', background: '#fff', borderRadius: 10, padding: 3, boxShadow: SHADOW }}>
          {PERIODS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPeriod(p.key)} style={{
              border: 'none', padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8,
              background: period === p.key ? '#0073EA' : 'transparent', color: period === p.key ? '#fff' : M.sub, fontWeight: period === p.key ? 600 : 400,
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Chiffres clés */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Tile icon="◎" tint="#0073EA" label="Tâches actives" value={stats.t.total - stats.t.fait} hint={`sur ${stats.t.total.toLocaleString('fr-FR')} au total`} />
        <Tile icon="○" tint="#7C7F8E" label="À faire" value={stats.t.a_faire} hint="pas encore commencées" />
        <Tile icon="◔" tint="#E8930C" label="En cours" value={stats.t.en_cours} hint="dont tâches de fond" />
        <Tile icon="⛔" tint="#DF2F4A" label="Bloquées" value={stats.t.bloque} hint="en attente de quelqu'un" />
        <Tile icon="⏰" tint="#B91C1C" label="En retard" value={stats.t.late} hint="échéance dépassée" alert={stats.t.late > 0} />
        <Tile icon="✓" tint="#00A65A" label="Ont avancé" value={stats.t.doneInPeriod} hint={`étape faite · ${periodLabel}`} spark={stats.weeks.map((w) => w.n)} />
      </div>

      {/* Répartition globale */}
      <Card title="Où en est le travail ?" sub={`Toutes les étapes et tâches simples · « Fait » = sur ${periodLabel}`} style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', height: 34, gap: 2, borderRadius: 8, overflow: 'hidden' }}>
          {BUCKETS.filter((b) => all[b.key]).map((b) => {
            const pct = Math.round((all[b.key] / allTotal) * 100);
            return (
              <div key={b.key} onMouseMove={(e) => show(e, `${b.label} : ${all[b.key]} (${pct} %)`)} onMouseLeave={hide}
                style={{ flex: all[b.key], background: b.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: b.ink, fontSize: 13, fontWeight: 600, minWidth: 4 }}>
                {pct >= 7 ? `${pct} %` : ''}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
          {BUCKETS.map((b) => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 4, background: b.color }} />
              <span style={{ fontSize: 13, color: M.sub }}>{b.label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: M.text }}>{all[b.key].toLocaleString('fr-FR')}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Par personne */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '26px 0 12px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>L'équipe</h2>
        <span style={{ fontSize: 13, color: M.sub }}>Étapes à son nom et tâches simples · cliquez une carte pour voir ses tâches</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {stats.people.map((p) => {
          const total = BUCKETS.reduce((a, b) => a + p.c[b.key], 0);
          return (
            <button key={p.id} type="button" onClick={() => onOpenPerson(p.id)} title={`Voir les tâches de ${p.name}`}
              style={{ ...cardStyle, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 'none', transition: 'transform .12s, box-shadow .12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = SHADOW_HOVER; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = SHADOW; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar id={p.id} name={p.name} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: M.text }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: M.sub }}>{p.c.fait} faite{p.c.fait > 1 ? 's' : ''} · {periodLabel}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: M.text }}>{p.c.open}</div>
                  <div style={{ fontSize: 11, color: M.sub }}>ouvertes</div>
                </div>
              </div>
              <div style={{ display: 'flex', height: 10, gap: 2, borderRadius: 5, overflow: 'hidden', background: '#EEF0F5', margin: '14px 0 10px' }}>
                {BUCKETS.filter((b) => p.c[b.key]).map((b) => (
                  <div key={b.key} onMouseMove={(e) => show(e, `${p.name} · ${b.label} : ${p.c[b.key]}`)} onMouseLeave={hide}
                    style={{ flex: p.c[b.key], background: b.color, minWidth: 4 }} />
                ))}
                {!total && <div style={{ flex: 1 }} />}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {[['À faire', p.c.a_faire, '#7C7F8E'], ['En cours', p.c.en_cours, '#E8930C'], ['Bloqué', p.c.bloque, '#DF2F4A']].map(([l, n, c]) => (
                  <div key={l} style={{ background: '#F6F7FB', borderRadius: 8, padding: '6px 8px' }}>
                    <div style={{ fontSize: 11, color: M.sub, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />{l}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: M.text }}>{n}</div>
                  </div>
                ))}
              </div>
              {p.c.late > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: '#B91C1C', background: '#FEF2F2', borderRadius: 8, padding: '5px 8px' }}>
                  ⏰ {p.c.late} en retard
                </div>
              )}
            </button>
          );
        })}
      </div>
      {stats.nobody.open > 0 && (
        <div style={{ fontSize: 13, color: M.sub, marginTop: 10 }}>
          + {stats.nobody.open} élément{stats.nobody.open > 1 ? 's' : ''} ouvert{stats.nobody.open > 1 ? 's' : ''} sans responsable.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginTop: 26 }}>
        {/* Rythme : étapes faites par semaine */}
        <Card title={yearly ? `Étapes faites par mois · ${range.from.slice(0, 4)}` : 'Étapes faites par semaine'}
          sub={`${yearly ? 'Janvier à décembre' : '8 dernières semaines'}${stats.undated > 0 ? ` · ${stats.undated.toLocaleString('fr-FR')} étapes importées de Monday sans date n'y figurent pas` : ''}`}>
          <div style={{ position: 'relative', height: 170, marginLeft: 22, borderBottom: `1px solid ${M.border}`, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {ticks.map((v) => (
              <div key={v} style={{ position: 'absolute', left: 0, right: 0, bottom: `${(v / maxWeek) * 140}px`, borderTop: `1px solid ${M.grid}` }}>
                <span style={{ position: 'absolute', right: '100%', marginRight: 6, top: -8, fontSize: 11, color: M.sub }}>{v}</span>
              </div>
            ))}
            {stats.weeks.map((w) => {
              const { current } = w;
              return (
                <div key={w.from} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', position: 'relative', zIndex: 1 }}
                  onMouseMove={(e) => show(e, `${yearly ? `${w.label} ${w.from.slice(0, 4)}` : `Semaine du ${fmtWeek(w.from)}`} : ${w.n} étape${w.n > 1 ? 's' : ''} faite${w.n > 1 ? 's' : ''}`)} onMouseLeave={hide}>
                  <span style={{ fontSize: 12, fontWeight: current ? 700 : 400, color: M.text, marginBottom: 3 }}>{w.n || ''}</span>
                  <div style={{ width: yearly ? 18 : 24, height: `${(w.n / maxWeek) * 140}px`, background: current ? '#0073EA' : '#A9CCF5', borderRadius: '4px 4px 0 0', minHeight: w.n ? 2 : 0 }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 22, paddingTop: 5 }}>
            {stats.weeks.map((w) => (
              <span key={w.from} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: w.current ? M.text : w.future ? '#C3C6D4' : M.sub, fontWeight: w.current ? 600 : 400 }}>
                {w.label}
              </span>
            ))}
          </div>
        </Card>

        {/* Étiquettes */}
        <Card title="Tâches ouvertes par étiquette" sub="Les 10 étiquettes les plus chargées">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {stats.labels.map(([l, n]) => (
              <div key={l} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 34px', alignItems: 'center', gap: 10 }}
                onMouseMove={(e) => show(e, `${l} : ${n} tâche${n > 1 ? 's' : ''} ouverte${n > 1 ? 's' : ''}`)} onMouseLeave={hide}>
                <span style={{ fontSize: 13, color: M.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l}</span>
                <div style={{ height: 12, background: '#EEF0F5', borderRadius: 6 }}>
                  <div style={{ height: '100%', width: `${(n / stats.labels[0][1]) * 100}%`, background: '#579BFC', borderRadius: 6, minWidth: 4 }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: M.text, textAlign: 'right' }}>{n}</span>
              </div>
            ))}
            {!stats.labels.length && <span style={{ fontSize: 13, color: M.sub }}>Aucune étiquette sur les tâches ouvertes.</span>}
          </div>
        </Card>
      </div>

      {/* Le détail chiffré (lecture sans couleurs, accessibilité) */}
      <Card title="Le détail par personne" sub="Les mêmes chiffres, en tableau" style={{ marginTop: 14 }}>
        <table style={{ ...mTable, tableLayout: 'auto' }}>
          <thead>
            <tr>
              {['Personne', 'À faire', 'En cours', 'Bloquées', 'En retard', `Faites (${periodLabel})`, 'Total ouvert'].map((h, i) => (
                <th key={h} style={{ ...mTh, textAlign: i ? 'center' : 'left', borderRight: i === 6 ? 'none' : mTh.borderRight }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...stats.people, ...(stats.nobody.open ? [{ id: 'none', name: 'Sans responsable', c: stats.nobody }] : [])].map((p) => (
              <tr key={p.id} style={{ cursor: p.id === 'none' ? 'default' : 'pointer' }} onClick={() => p.id !== 'none' && onOpenPerson(p.id)}
                onMouseEnter={(e) => { e.currentTarget.style.background = M.hover; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <td style={{ ...mTd, textAlign: 'left', fontStyle: p.id === 'none' ? 'italic' : 'normal', color: p.id === 'none' ? M.sub : M.text }}>{p.name}</td>
                <td style={mTd}>{p.c.a_faire}</td>
                <td style={mTd}>{p.c.en_cours}</td>
                <td style={mTd}>{p.c.bloque}</td>
                <td style={{ ...mTd, color: p.c.late ? '#B91C1C' : M.text, fontWeight: p.c.late ? 700 : 400 }}>{p.c.late}</td>
                <td style={mTd}>{p.c.fait}</td>
                <td style={{ ...mTd, fontWeight: 700, borderRight: 'none' }}>{p.c.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {tip && (
        <div style={{
          position: 'fixed', left: tip.x + 12, top: tip.y + 12, background: '#1F2433', color: '#fff', fontSize: 12,
          padding: '7px 10px', borderRadius: 8, pointerEvents: 'none', zIndex: 4000, whiteSpace: 'nowrap', boxShadow: '0 6px 18px rgba(0,0,0,.2)',
        }}>{tip.text}</div>
      )}
    </div>
  );
}

const BG = '#F3F5F9';
const SHADOW = '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)';
const SHADOW_HOVER = '0 8px 24px rgba(16,24,40,.12)';
const cardStyle = { background: '#fff', borderRadius: 14, padding: '16px 18px', boxShadow: SHADOW };

function Card({ title, sub, children, style }) {
  return (
    <section style={{ ...cardStyle, ...style }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: M.text }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: M.sub, marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </section>
  );
}

/** Chiffre clé : icône teintée, grand nombre, libellé ; mini-courbe facultative (8 semaines). */
function Tile({ icon, tint, label, value, hint, alert = false, spark }) {
  const max = spark ? Math.max(1, ...spark) : 1;
  const pts = spark ? spark.map((v, i) => `${(i / (spark.length - 1)) * 100},${28 - (v / max) * 24}`).join(' ') : '';
  return (
    <div style={{ ...cardStyle, padding: '14px 16px', position: 'relative', overflow: 'hidden', outline: alert ? '2px solid #FCA5A5' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 34, height: 34, borderRadius: 10, background: `${tint}1A`, color: tint, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700,
        }}>{icon}</span>
        <span style={{ fontSize: 13, color: M.sub, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: alert ? '#B91C1C' : M.text, marginTop: 8, lineHeight: 1.1 }}>
        {value.toLocaleString('fr-FR')}
      </div>
      <div style={{ fontSize: 12, color: M.sub, marginTop: 2 }}>{hint}</div>
      {spark && (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ position: 'absolute', right: 14, top: 58, width: 60, height: 28 }} aria-hidden="true">
          <polyline points={pts} fill="none" stroke={tint} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
