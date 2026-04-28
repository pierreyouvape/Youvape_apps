import { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

/* ─── PALETTE ───────────────────────────────────────────── */
const C = {
  orange: '#E28F00', jaune: '#F6C613', rouge: '#DE2020',
  vert: '#4AB866', bleu: '#0071EB', saphir: '#135E84',
  saphirF: '#003A56', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', gris: '#697485', grisF: '#626E85',
  grisTF: '#2a2e38', blanc: '#FFFFFF', violet: '#9B59B6',
};

/* ─── UTILS ─────────────────────────────────────────────── */
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0));
const fmtEur = (n) => fmt(n) + ' €';
const fmtPct = (n) => (n || 0).toFixed(1) + ' %';

function getDateRange(period) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (period === 'today') {
    const s = fmt(now);
    return { dateFrom: s, dateTo: s };
  }
  if (period === 'week') {
    const day = now.getDay() || 7;
    const mon = new Date(now); mon.setDate(now.getDate() - day + 1);
    return { dateFrom: fmt(mon), dateTo: fmt(now) };
  }
  if (period === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: fmt(first), dateTo: fmt(now) };
  }
  return null;
}

/* ─── SPARKLINE ─────────────────────────────────────────── */
function Sparkline({ data, color, width = 80, height = 36 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = path + ` L${width},${height} L0,${height} Z`;
  const gradId = `sg${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── KPI CARD ───────────────────────────────────────────── */
function KpiCard({ label, value, unit, color, sparkData }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: C.blanc, borderRadius: 14,
        padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: hovered
          ? '0 4px 18px rgba(0,0,0,0.11), 0 0 0 1px rgba(0,0,0,0.06)'
          : '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)',
        borderTop: `3px solid ${color}`,
        transition: 'box-shadow 0.2s',
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: C.grisM, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <span style={{ fontSize: 26, fontWeight: 800, color: C.grisTF, letterSpacing: '-0.5px' }}>{value}</span>
          {unit && <span style={{ fontSize: 14, fontWeight: 600, color: C.grisM, marginLeft: 4 }}>{unit}</span>}
        </div>
        {sparkData && <Sparkline data={sparkData} color={color} />}
      </div>
    </div>
  );
}

/* ─── MAIN CHART ─────────────────────────────────────────── */
function MainChart({ series }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 800, H = 120, PL = 60, PR = 16, PT = 16, PB = 40;
  const cW = W - PL - PR, cH = H - PT - PB;

  if (!series || series.length === 0) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.grisM }}>
      Aucune donnée
    </div>
  );

  const maxCA = Math.max(...series.map(p => p.ca_ht), 1);
  const maxY = Math.ceil(maxCA / 1000) * 1000 || 1000;

  const toX = (i) => PL + (i / Math.max(series.length - 1, 1)) * cW;
  const toY = (v) => PT + cH - (v / maxY) * cH;

  const caPath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.ca_ht).toFixed(1)}`).join(' ');
  const prPath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.profit_ht).toFixed(1)}`).join(' ');
  const caArea = caPath + ` L${toX(series.length - 1)},${PT + cH} L${PL},${PT + cH} Z`;
  const prArea = prPath + ` L${toX(series.length - 1)},${PT + cH} L${PL},${PT + cH} Z`;

  const handleMove = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = (clientX - rect.left) / rect.width * W;
    const idx = Math.round((x - PL) / cW * (series.length - 1));
    if (idx >= 0 && idx < series.length) setHover(idx);
  }, [series.length]);

  const formatPeriodLabel = (p) => {
    if (!p) return '';
    const d = new Date(p);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }}
        onMouseMove={handleMove}
        onTouchMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id="caGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.saphir} stopOpacity="0.18" />
            <stop offset="100%" stopColor={C.saphir} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="prGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.vert} stopOpacity="0.18" />
            <stop offset="100%" stopColor={C.vert} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grille */}
        {Array.from({ length: 6 }, (_, i) => {
          const y = PT + (i / 5) * cH;
          const val = Math.round(maxY * (1 - i / 5));
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={C.grisCL} strokeWidth="1" />
              <text x={PL - 8} y={y + 4} textAnchor="end" fontSize="11" fill={C.grisM} fontFamily="Lato, sans-serif">
                {val >= 1000 ? (val / 1000) + 'k' : val}
              </text>
            </g>
          );
        })}

        {/* Labels X */}
        {series.map((p, i) => {
          const every = Math.ceil(series.length / 8);
          if (i % every !== 0 && i !== series.length - 1) return null;
          return (
            <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={C.grisM} fontFamily="Lato, sans-serif">
              {formatPeriodLabel(p.period)}
            </text>
          );
        })}

        {/* Areas */}
        <path d={caArea} fill="url(#caGrad)" />
        <path d={prArea} fill="url(#prGrad)" />

        {/* Lignes */}
        <path d={caPath} fill="none" stroke={C.saphir} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={prPath} fill="none" stroke={C.vert} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover */}
        {hover !== null && (
          <g>
            <line x1={toX(hover)} y1={PT} x2={toX(hover)} y2={PT + cH} stroke={C.grisCL} strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx={toX(hover)} cy={toY(series[hover].ca_ht)} r="5" fill={C.blanc} stroke={C.saphir} strokeWidth="2.5" />
            <circle cx={toX(hover)} cy={toY(series[hover].profit_ht)} r="5" fill={C.blanc} stroke={C.vert} strokeWidth="2.5" />
          </g>
        )}
      </svg>

      {hover !== null && (
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          background: C.blanc, border: `1px solid ${C.grisCL}`,
          borderRadius: 10, padding: '8px 14px', pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          display: 'flex', gap: 16, alignItems: 'center', fontSize: 13,
          whiteSpace: 'nowrap',
        }}>
          <span style={{ color: C.grisM, fontWeight: 500 }}>{formatPeriodLabel(series[hover].period)}</span>
          <span><span style={{ color: C.saphir, fontWeight: 700 }}>CA HT </span><span style={{ fontWeight: 600 }}>{fmtEur(series[hover].ca_ht)}</span></span>
          <span><span style={{ color: C.vert, fontWeight: 700 }}>Profit </span><span style={{ fontWeight: 600 }}>{fmtEur(series[hover].profit_ht)}</span></span>
        </div>
      )}
    </div>
  );
}

/* ─── COST BAR ───────────────────────────────────────────── */
function CostBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total * 100) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.grisF }}>{label}</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>{fmtEur(value)}</span>
          <span style={{ fontSize: 12, color: C.grisM, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
        </div>
      </div>
      <div style={{ height: 6, background: C.grisTL, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 99, transition: 'width 0.7s cubic-bezier(0.34,1.56,0.64,1)' }} />
      </div>
    </div>
  );
}

/* ─── SIDEBAR ────────────────────────────────────────────── */
function Sidebar({ open }) {
  return (
    <aside style={{
      width: open ? 220 : 0, minWidth: open ? 220 : 0,
      overflow: 'hidden', background: C.saphirF,
      height: '100vh', position: 'sticky', top: 0, flexShrink: 0,
      transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1), min-width 0.28s cubic-bezier(0.4,0,0.2,1)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '28px 20px 16px', borderBottom: `1px solid rgba(255,255,255,0.08)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <YouvapeLogo size={46} light />
        </div>
      </div>
      <nav style={{ padding: '12px 10px', flex: 1 }}>
        <SidebarItem icon="▦" active />
      </nav>
    </aside>
  );
}

function SidebarItem({ icon, active }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 9, marginBottom: 2,
        background: active ? 'rgba(255,255,255,0.10)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: active ? C.blanc : hovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)',
        fontSize: 16, cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
    </div>
  );
}

/* ─── LOGO ───────────────────────────────────────────────── */
function YouvapeLogo({ size = 40, light = false }) {
  const stroke = light ? '#fff' : C.bleu;
  const fill = light ? '#fff' : C.saphirF;
  const bg = light ? 'rgba(255,255,255,0.08)' : 'transparent';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
      <circle cx="50" cy="50" r="46" fill={bg} stroke={stroke} strokeWidth="5.5" />
      <text x="50" y="43" textAnchor="middle" fontFamily="'Tilt Warp', cursive" fontWeight="900" fontSize="28" fill={fill} letterSpacing="-0.5">YOU</text>
      <text x="50" y="68" textAnchor="middle" fontFamily="'Tilt Warp', cursive" fontWeight="900" fontSize="28" fill={fill} letterSpacing="-0.5">VAPE</text>
      <path d="M36 78 Q50 86 64 78" fill="none" stroke={stroke} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/* ─── PERIOD SELECTOR ────────────────────────────────────── */
const PERIODS = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: 'Cette semaine' },
  { key: 'month', label: 'Ce mois' },
  { key: 'custom', label: 'Personnalisé' },
];

/* ─── MAIN APP ───────────────────────────────────────────── */
export default function FinancierApp() {
  const { token } = useContext(AuthContext);
  const [period, setPeriod] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [windowW, setWindowW] = useState(window.innerWidth);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onResize = () => {
      setWindowW(window.innerWidth);
      if (window.innerWidth < 768) setSidebarOpen(false);
    };
    window.addEventListener('resize', onResize);
    if (window.innerWidth < 768) setSidebarOpen(false);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const fetchData = useCallback(async (p, cFrom, cTo, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      let range = p === 'custom' ? { dateFrom: cFrom, dateTo: cTo } : getDateRange(p);
      if (!range) return;

      const res = await axios.post(
        `${API_URL}/financier/dashboard`,
        range,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData(period, customFrom, customTo);
  }, [period, fetchData]);

  // Refresh automatique toutes les 60s sur les périodes dynamiques
  useEffect(() => {
    if (period === 'custom') return;
    const id = setInterval(() => fetchData(period, '', '', true), 60000);
    return () => clearInterval(id);
  }, [period, fetchData]);

  const handleApplyCustom = () => {
    if (customFrom && customTo) fetchData('custom', customFrom, customTo);
  };

  const kpis = data ? [
    { label: 'CA TTC Brut', value: fmtEur(data.kpis.ca_ttc_brut), color: C.orange, sparkData: data.series.map(s => s.ca_ttc_brut) },
    { label: 'CA HT Net', value: fmtEur(data.kpis.ca_ht_net), color: C.saphir, sparkData: data.series.map(s => s.ca_ht) },
    { label: 'Profit HT', value: fmtEur(data.kpis.profit_ht), color: C.vert, sparkData: data.series.map(s => s.profit_ht) },
    { label: 'Marge', value: fmtPct(data.kpis.marge_ht), color: C.violet, sparkData: null },
    { label: 'Nb Commandes', value: fmt(data.kpis.orders_count), color: C.bleu, sparkData: data.series.map(s => s.orders_count) },
    { label: 'Panier moyen HT', value: fmtEur(data.kpis.panier_moyen_ht), color: C.orange, sparkData: null },
    { label: 'Commandes remboursées', value: fmt(data.kpis.refunds_count), color: C.rouge, sparkData: null },
    { label: 'Remboursements TTC', value: fmtEur(data.kpis.remboursements_ttc), color: C.rouge, sparkData: null },
  ] : [];

  const gridCols = windowW >= 900 ? 3 : windowW >= 560 ? 2 : 1;

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '100vh', background: C.grisTL, fontFamily: 'Lato, sans-serif', color: C.grisTF }}>
      <Sidebar open={sidebarOpen} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>

        {/* Header */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 24px', height: 58, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 30, gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, color: C.gris, fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center' }}
            >☰</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <YouvapeLogo size={34} />
              <span style={{ color: C.grisM, fontWeight: 500, fontSize: 13 }}>/ Dashboard</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.grisM, fontWeight: 500 }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </header>

        {/* Main */}
        <main style={{ padding: 24, flex: 1 }}>

          {/* Sélecteur de période */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: C.blanc, borderRadius: 10, border: `1px solid ${C.grisCL}`, padding: 3, gap: 2 }}>
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  style={{
                    background: period === p.key ? C.orange : 'transparent',
                    color: period === p.key ? C.blanc : C.grisF,
                    border: 'none', borderRadius: 8,
                    padding: '6px 14px', fontSize: 13,
                    fontWeight: period === p.key ? 700 : 500,
                    cursor: 'pointer', transition: 'all 0.18s', fontFamily: 'Lato, sans-serif',
                    whiteSpace: 'nowrap',
                  }}
                >{p.label}</button>
              ))}
            </div>

            {period === 'custom' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'Lato', color: C.grisTF, background: C.blanc }} />
                <span style={{ color: C.grisM, fontSize: 13 }}>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'Lato', color: C.grisTF, background: C.blanc }} />
                <button onClick={handleApplyCustom}
                  style={{ background: C.saphir, color: C.blanc, border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'Lato' }}>
                  Appliquer
                </button>
              </div>
            )}
          </div>

          {/* Erreur */}
          {error && (
            <div style={{ background: '#fff0f0', border: `1px solid ${C.rouge}30`, borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: C.rouge, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Skeleton / loading */}
          {loading && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 14, marginBottom: 24 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ background: C.blanc, borderRadius: 14, height: 96, boxShadow: '0 1px 3px rgba(0,0,0,0.07)', borderTop: `3px solid ${C.grisCL}`, animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          )}

          {/* KPI Grid */}
          {!loading && data && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 14, marginBottom: 24 }}>
                {kpis.map(k => <KpiCard key={k.label} {...k} />)}
              </div>

              {/* Graphique */}
              <div style={{ background: C.blanc, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)', marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF }}>Évolution financière</div>
                    <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>CA HT vs Profit HT sur la période</div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 3, borderRadius: 99, background: C.saphir }} />
                      <span style={{ fontSize: 12, color: C.grisM, fontWeight: 600 }}>CA HT</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 3, borderRadius: 99, background: C.vert }} />
                      <span style={{ fontSize: 12, color: C.grisM, fontWeight: 600 }}>Profit HT</span>
                    </div>
                  </div>
                </div>
                <MainChart series={data.series} />
              </div>

              {/* Bas de page : breakdown + récap */}
              <div style={{ display: 'grid', gridTemplateColumns: windowW >= 860 ? '1fr 1fr' : '1fr', gap: 14 }}>

                {/* Décomposition des coûts */}
                <div style={{ background: C.blanc, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF }}>Décomposition des coûts</div>
                    <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>Sur le CA HT net de la période</div>
                  </div>
                  <CostBar label="Coût produits" value={data.kpis.cout_produits} total={data.kpis.ca_ht_net} color={C.saphir} />
                  <CostBar label="Frais de port réels" value={data.kpis.frais_port_reel} total={data.kpis.ca_ht_net} color={C.orange} />
                  <CostBar label="Frais de paiement" value={data.kpis.frais_paiement} total={data.kpis.ca_ht_net} color={C.bleu} />
                  <div style={{ borderTop: `1px solid ${C.grisCL}`, paddingTop: 14, marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.grisF }}>Total coûts</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: C.grisTF }}>
                      {fmtEur(data.kpis.cout_produits + data.kpis.frais_port_reel + data.kpis.frais_paiement)}
                    </span>
                  </div>
                </div>

                {/* Récapitulatif */}
                <div style={{ background: C.blanc, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.grisTF }}>Récapitulatif</div>
                    <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>Résumé de la période sélectionnée</div>
                  </div>
                  {[
                    { label: 'CA TTC Brut', value: fmtEur(data.kpis.ca_ttc_brut), color: C.orange },
                    { label: 'Remboursements TTC', value: '− ' + fmtEur(data.kpis.remboursements_ttc), color: C.rouge },
                    { label: 'TVA', value: '− ' + fmtEur(data.kpis.tva), color: C.grisM },
                    { label: 'CA HT Net', value: fmtEur(data.kpis.ca_ht_net), color: C.saphir, bold: true },
                    { label: '— Coût produits', value: '− ' + fmtEur(data.kpis.cout_produits), color: C.grisF },
                    { label: '— Frais port réels', value: '− ' + fmtEur(data.kpis.frais_port_reel), color: C.grisF },
                    { label: '— Frais paiement', value: '− ' + fmtEur(data.kpis.frais_paiement), color: C.grisF },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, color: C.grisF, fontWeight: row.bold ? 700 : 500 }}>{row.label}</span>
                      <span style={{ fontSize: 13, fontWeight: row.bold ? 800 : 600, color: row.color }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: `1px solid ${C.grisCL}`, paddingTop: 14, marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.grisTF }}>Profit HT</span>
                      <span style={{ fontSize: 11, color: C.grisM, marginLeft: 8 }}>marge {fmtPct(data.kpis.marge_ht)}</span>
                    </div>
                    <span style={{ fontSize: 17, fontWeight: 800, color: data.kpis.profit_ht >= 0 ? C.vert : C.rouge }}>
                      {fmtEur(data.kpis.profit_ht)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.grisCL}; border-radius: 3px; }
      `}</style>
    </div>
  );
}
