import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  atb: '#BE123C',        // couleur de l'app — série courante
  m1: '#E28F00',         // fantôme mois précédent
  n1: '#6366F1',         // fantôme année précédente
  vert: '#4AB866', rouge: '#DE2020',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);

const signPct = (v) => (v === null || v === undefined ? '—'
  : `${v > 0 ? '+' : ''}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v)} %`);

const deltaColor = (v) => (v === null || v === undefined ? C.grisM : v > 0 ? C.vert : v < 0 ? C.rouge : C.grisM);

/** Écart en % entre une valeur courante et sa référence. null si la référence est nulle. */
const pctDelta = (current, ref) => (!ref ? null : ((current - ref) / ref) * 100);

/* Date locale (heure Paris) → 'YYYY-MM-DD'. Jamais toISOString() : en soirée,
 * le passage par UTC renvoie la veille. */
function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → Date locale (pas de parsing ISO, qui serait interprété UTC). */
function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** '2026-09-07' → '07/09' */
const shortDay = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** '2026-09-07' → 'lundi 7 septembre 2026' */
function prettyDay(ymd) {
  const s = parseYmd(ymd).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ─── PRÉRÉGLAGES DE PÉRIODE ────────────────────────────── */
const PRESETS = [
  {
    key: '7j',
    label: '7 derniers jours',
    range: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 6); return [from, to]; },
  },
  {
    key: '30j',
    label: '30 derniers jours',
    range: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29); return [from, to]; },
  },
  {
    key: 'mois',
    label: 'Mois en cours',
    range: () => { const to = new Date(); const from = new Date(to.getFullYear(), to.getMonth(), 1); return [from, to]; },
  },
  {
    key: 'moisPrec',
    label: 'Mois précédent',
    range: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0); // jour 0 = dernier jour du mois précédent
      return [from, to];
    },
  },
  {
    key: '90j',
    label: '90 derniers jours',
    range: () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 89); return [from, to]; },
  },
];

/* ─── CARTE KPI ─────────────────────────────────────────── */
function StatCard({ label, value, sub, subColor, accent }) {
  return (
    <div style={{
      flex: 1, minWidth: 170, background: C.blanc, borderRadius: 14,
      border: `1px solid ${C.grisCL}`, padding: '16px 18px',
    }}>
      <div style={{ fontSize: 12, color: C.grisM, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: accent || C.grisTF, lineHeight: 1 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: subColor || C.grisM, marginTop: 7 }}>{sub}</div>
      )}
    </div>
  );
}

/* ─── INFOBULLE ─────────────────────────────────────────── */
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  const Line = ({ color, title, date, value, delta }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: C.grisM, minWidth: 34 }}>{title}</span>
      {date ? (
        <>
          <span style={{ fontSize: 12, color: C.grisM }}>{shortDay(date)}</span>
          <strong style={{ fontSize: 13.5, color: C.grisTF }}>{fmtInt(value)}</strong>
          {delta !== undefined && (
            <span style={{ fontSize: 12, fontWeight: 700, color: deltaColor(delta) }}>{signPct(delta)}</span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 12, color: C.grisM, fontStyle: 'italic' }}>pas d'équivalent</span>
      )}
    </div>
  );

  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
      padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.grisTF }}>{prettyDay(p.date)}</div>
      <Line color={C.atb} title="Période" date={p.date} value={p.orders} />
      <Line color={C.m1} title="M-1" date={p.m1Date} value={p.m1Orders} delta={pctDelta(p.orders, p.m1Orders)} />
      <Line color={C.n1} title="N-1" date={p.n1Date} value={p.n1Orders} delta={pctDelta(p.orders, p.n1Orders)} />
    </div>
  );
}

/* ─── MODULE ────────────────────────────────────────────── */
export default function DailyOrdersTab() {
  const [preset, setPreset] = useState('30j');

  const initial = PRESETS.find((p) => p.key === '30j').range();
  const [dateFrom, setDateFrom] = useState(localYmd(initial[0]));
  const [dateTo, setDateTo] = useState(localYmd(initial[1]));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showM1, setShowM1] = useState(true);
  const [showN1, setShowN1] = useState(true);

  const applyPreset = (key) => {
    const def = PRESETS.find((p) => p.key === key);
    if (!def) return;
    const [from, to] = def.range();
    setPreset(key);
    setDateFrom(localYmd(from));
    setDateTo(localYmd(to));
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/atb/orders/daily`, { params: { dateFrom, dateTo } });
      setData(res.data);
    } catch (err) {
      console.error('Erreur chargement commandes/jour (ATB):', err);
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const series = data?.series || [];
  const totals = data?.totals;

  /* Le chevauchement des barres est en pixels : il doit rétrécir quand le nombre
   * de jours augmente, sinon à 90 jours les trois barres se superposent en une. */
  const barGap = useMemo(() => {
    const n = series.length;
    if (n <= 14) return -9;
    if (n <= 31) return -5;
    if (n <= 62) return -3;
    return -2;
  }, [series.length]);

  /* Un label d'axe tous les k jours, pour ne pas empiler les dates. */
  const tickInterval = useMemo(() => Math.max(0, Math.ceil(series.length / 15) - 1), [series.length]);

  const avgPerDay = series.length ? Math.round(totals.current / series.length) : 0;

  const inputStyle = {
    padding: '8px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 8,
    fontSize: 13, color: C.grisTF, outline: 'none', background: C.blanc,
  };

  const chipStyle = (active) => ({
    padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${active ? C.atb : C.grisCL}`,
    background: active ? C.atb : C.blanc, color: active ? C.blanc : C.grisTF,
  });

  const legendChip = (color, label, on, toggle) => (
    <button
      onClick={toggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '5px 11px',
        borderRadius: 999, border: `1px solid ${C.grisCL}`, background: C.blanc,
        cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
        color: on ? C.grisTF : C.grisM, opacity: on ? 1 : 0.55,
      }}
    >
      <span style={{
        width: 11, height: 11, borderRadius: 3, flexShrink: 0,
        background: on ? color : 'transparent', border: `1.5px solid ${color}`,
      }} />
      {label}
    </button>
  );

  return (
    <div>
      {/* ── Sélection de période ── */}
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 18 }}>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => applyPreset(p.key)} style={chipStyle(preset === p.key)}>
            {p.label}
          </button>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Du</label>
          <input
            type="date" value={dateFrom} max={dateTo} style={inputStyle}
            onChange={(e) => { setDateFrom(e.target.value); setPreset('perso'); }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Au</label>
          <input
            type="date" value={dateTo} min={dateFrom} style={inputStyle}
            onChange={(e) => { setDateTo(e.target.value); setPreset('perso'); }}
          />
        </div>
      </section>

      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', color: C.rouge,
          borderRadius: 10, padding: '12px 14px', fontSize: 13.5, marginBottom: 18,
        }}>
          {error}
        </div>
      )}

      {/* ── KPI ── */}
      {totals && (
        <section style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
          <StatCard
            label="Commandes sur la période"
            value={fmtInt(totals.current)}
            sub={`${fmtInt(avgPerDay)} / jour en moyenne`}
            accent={C.atb}
          />
          <StatCard
            label="Mois précédent (M-1)"
            value={fmtInt(totals.m1)}
            sub={signPct(pctDelta(totals.currentForM1, totals.m1))}
            subColor={deltaColor(pctDelta(totals.currentForM1, totals.m1))}
          />
          <StatCard
            label="Année précédente (N-1)"
            value={fmtInt(totals.n1)}
            sub={signPct(pctDelta(totals.currentForN1, totals.n1))}
            subColor={deltaColor(pctDelta(totals.currentForN1, totals.n1))}
          />
        </section>
      )}

      {/* ── Graphique ── */}
      <section style={{
        background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 14, padding: '18px 20px 10px',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap', marginBottom: 14,
        }}>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, color: C.grisTF, margin: 0 }}>
              Commandes par jour
            </h2>
            <p style={{ fontSize: 12, color: C.grisM, margin: '3px 0 0' }}>
              Comparaison à date calendaire : le 7 septembre se compare au 7 août et au 7 septembre de l'an dernier —
              donc pas au même jour de la semaine.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {legendChip(C.m1, 'M-1', showM1, () => setShowM1((v) => !v))}
            {legendChip(C.n1, 'N-1', showN1, () => setShowN1((v) => !v))}
          </div>
        </div>

        {loading && !series.length ? (
          <div style={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grisM, fontSize: 13.5 }}>
            Chargement…
          </div>
        ) : !series.length ? (
          <div style={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grisM, fontSize: 13.5 }}>
            Aucune commande sur la période.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={series} barGap={barGap} barCategoryGap="18%" margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grisCL} vertical={false} />
              <XAxis
                dataKey="date" tickFormatter={shortDay} interval={tickInterval}
                tick={{ fontSize: 11, fill: C.grisM }} axisLine={{ stroke: C.grisCL }} tickLine={false}
              />
              <YAxis
                allowDecimals={false} width={44}
                tick={{ fontSize: 11, fill: C.grisM }} axisLine={false} tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: C.grisTL }} />

              {/* Ordre de déclaration = ordre gauche → droite dans la journée.
                * N-1 à gauche, la période au centre en plein, M-1 à droite : les
                * deux fantômes dépassent de part et d'autre du bâton principal. */}
              {showN1 && (
                <Bar dataKey="n1Orders" name="N-1" fill={C.n1} fillOpacity={0.34}
                     stroke={C.n1} strokeOpacity={0.55} strokeWidth={1} radius={[3, 3, 0, 0]} />
              )}
              <Bar dataKey="orders" name="Période" fill={C.atb} radius={[3, 3, 0, 0]} />
              {showM1 && (
                <Bar dataKey="m1Orders" name="M-1" fill={C.m1} fillOpacity={0.34}
                     stroke={C.m1} strokeOpacity={0.55} strokeWidth={1} radius={[3, 3, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
    </div>
  );
}
