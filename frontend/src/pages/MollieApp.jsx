import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import axios from 'axios';
import AppShell from '../components/AppShell';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#1E293B', accentL: '#F1F5F9',
  green: '#16A34A', greenL: '#DCFCE7',
  red: '#DC2626', redL: '#FEE2E2',
  orange: '#EA580C', orangeL: '#FFF7ED',
  blue: '#1457A8', blueL: '#E5EEFA',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280',
  dark: '#111827', white: '#FFFFFF',
};

// Ordre fixe des séries (une couleur par moyen de paiement, jamais par rang).
const METHODS = [
  { key: 'cards', label: 'Cartes', color: '#2a78d6' },
  { key: 'bancontact', label: 'Bancontact', color: '#eb6834' },
  { key: 'alma', label: 'Alma (3x/4x)', color: '#1baf7a' },
  { key: 'paybybank', label: 'Pay by Bank', color: '#eda100' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.key, m.label]));

const LEVELS = {
  error: { label: 'Anomalie', icon: '✕', color: C.red, bg: C.redL },
  warn: { label: 'À vérifier', icon: '!', color: C.orange, bg: C.orangeL },
  info: { label: 'Info', icon: 'i', color: C.blue, bg: C.blueL },
  ok: { label: 'Conforme', icon: '✓', color: C.green, bg: C.greenL },
};

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function fmtEur(v, digits = 2) {
  if (v === null || v === undefined || v === '' || !isFinite(v)) return '—';
  return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
}
const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString('fr-FR'));
const fmtPct = (v, d = 2) => (v == null || !isFinite(v) ? '—' : `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const monthLabel = (iso) => (iso ? `${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}` : '—');

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { /* navigateur ancien */ }
const countryName = (code) => {
  if (!code || code === '??') return 'Pays inconnu';
  try { return regionNames?.of(code) || code; } catch { return code; }
};

function StatCard({ value, label, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.white, borderRadius: 10, border: `1px solid ${C.greyB}`, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11.5, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.dark, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.greyT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ level, children }) {
  const l = LEVELS[level] || LEVELS.info;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, background: l.bg, color: l.color, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span aria-hidden>{l.icon}</span>{children || l.label}
    </span>
  );
}

function Card({ title, sub, children, right }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            {title && <div style={{ fontSize: 15, fontWeight: 700, color: C.dark }}>{title}</div>}
            {sub && <div style={{ fontSize: 12, color: C.greyT, marginTop: 2 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: C.greyT, fontWeight: 600, borderBottom: `1px solid ${C.greyB}`, whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, borderBottom: `1px solid ${C.greyB}`, color: C.dark };
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

function EurTooltip({ active, payload, label, pct }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: C.white, border: `1px solid ${C.greyB}`, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color }} />{p.name}
          </span>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct ? fmtPct(p.value) : fmtEur(p.value)}</span>
        </div>
      ))}
      {!pct && payload.length > 1 && (
        <div style={{ borderTop: `1px solid ${C.greyB}`, marginTop: 4, paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>Total</span><span>{fmtEur(total)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Tableau de bord ─────────────────────────────────────────── */

function Dashboard({ invoices, onOpen }) {
  const years = useMemo(() => [...new Set(invoices.map((i) => (i.periodStart || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [invoices]);
  const [year, setYear] = useState('all');
  const list = useMemo(() => invoices.filter((i) => year === 'all' || (i.periodStart || '').startsWith(year))
    .sort((a, b) => (a.periodStart || '').localeCompare(b.periodStart || '')), [invoices, year]);

  const monthly = list.map((i) => ({
    id: i.id,
    month: monthLabel(i.periodStart),
    ...Object.fromEntries(METHODS.map((m) => [m.key, i.byMethod?.[m.key]?.cost || 0])),
  }));
  const rates = list.map((i) => ({
    month: monthLabel(i.periodStart),
    ...Object.fromEntries(METHODS.map((m) => {
      const b = i.byMethod?.[m.key];
      return [m.key, b?.volume ? b.cost / b.volume * 100 : null];
    })),
  }));

  const sum = (f) => list.reduce((s, i) => s + (f(i) || 0), 0);
  const cost = sum((i) => i.totalHT);
  const volume = sum((i) => i.totals?.volume);
  const overcharge = sum((i) => i.totals?.overcharge);
  const errors = sum((i) => i.totals?.errors);
  const warnings = sum((i) => i.totals?.warnings);
  const estimated = sum((i) => i.totals?.estimatedByApp);

  const byMethod = METHODS.map((m) => {
    const agg = list.reduce((a, i) => {
      const b = i.byMethod?.[m.key] || {};
      return { cost: a.cost + (b.cost || 0), volume: a.volume + (b.volume || 0), tx: a.tx + (b.transactions || 0), threeds: a.threeds + (b.threeds || 0), refunds: a.refunds + (b.refunds || 0) };
    }, { cost: 0, volume: 0, tx: 0, threeds: 0, refunds: 0 });
    return { ...m, ...agg };
  });

  const countries = useMemo(() => {
    const acc = {};
    for (const i of list) {
      for (const [k, v] of Object.entries(i.byCountryMethod || {})) {
        const [c, m] = k.split('|');
        acc[c] = acc[c] || { code: c, total: 0 };
        acc[c][m] = (acc[c][m] || 0) + v;
        acc[c].total += v;
      }
    }
    return Object.values(acc).sort((a, b) => b.total - a.total);
  }, [list]);
  const topCountries = countries.slice(0, 8);
  const others = countries.slice(8);
  const countryChart = [
    ...topCountries.map((c) => ({ ...c, name: countryName(c.code) })),
    ...(others.length ? [{
      name: `Autres (${others.length})`,
      ...Object.fromEntries(METHODS.map((m) => [m.key, others.reduce((s, c) => s + (c[m.key] || 0), 0)])),
    }] : []),
  ];

  if (!invoices.length) {
    return <Card><div style={{ color: C.greyT, fontSize: 14, padding: 20, textAlign: 'center' }}>Aucune facture pour l'instant. Déposez les PDF Mollie avec le bouton en haut à droite.</div></Card>;
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: C.greyT }}>Période :</span>
        {['all', ...years].map((y) => (
          <button key={y} onClick={() => setYear(y)} style={{ padding: '5px 12px', borderRadius: 999, border: `1px solid ${year === y ? C.primary : C.greyB}`, background: year === y ? C.primary : C.white, color: year === y ? C.white : C.dark, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {y === 'all' ? 'Tout' : y}
          </button>
        ))}
        <span style={{ fontSize: 12, color: C.greyT, marginLeft: 6 }}>{list.length} facture{list.length > 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatCard label="Frais Mollie HT" value={fmtEur(cost)} sub={list.length ? `${fmtEur(cost / list.length, 0)} / mois en moyenne` : null} />
        <StatCard label="Encaissé via Mollie" value={fmtEur(volume, 0)} />
        <StatCard label="Taux effectif" value={fmtPct(volume ? cost / volume * 100 : null)} sub="frais ÷ montant encaissé" />
        <StatCard label="Surfacturation détectée" value={fmtEur(overcharge)} color={overcharge > 0 ? C.red : C.green}
          sub={errors || warnings ? `${errors} anomalie${errors > 1 ? 's' : ''}, ${warnings} point${warnings > 1 ? 's' : ''} à vérifier` : 'aucune anomalie'} />
        <StatCard label="Frais dans /financier" value={fmtEur(estimated)} sub={cost ? `${fmtEur(estimated - cost)} vs facturé` : null} color={C.greyT} />
      </div>

      <Card title="Frais Mollie par mois" sub="Hors TVA, par moyen de paiement (3DS et remboursements inclus dans leur moyen). Cliquer sur une barre ouvre la facture.">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%"
            onClick={(e) => { const id = e?.activePayload?.[0]?.payload?.id; if (id) onOpen(id); }}>
            <CartesianGrid strokeDasharray="0" stroke="#EEF0F3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.greyT }} axisLine={{ stroke: C.greyB }} tickLine={false} />
            <YAxis tickFormatter={(v) => `${Math.round(v).toLocaleString('fr-FR')} €`} tick={{ fontSize: 11.5, fill: C.greyT }} axisLine={false} tickLine={false} width={70} />
            <Tooltip content={<EurTooltip />} cursor={{ fill: 'rgba(15,23,42,0.05)' }} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12.5 }} />
            {METHODS.map((m, idx) => (
              <Bar key={m.key} dataKey={m.key} name={m.label} stackId="a" fill={m.color} stroke={C.white} strokeWidth={1}
                radius={idx === METHODS.length - 1 ? [4, 4, 0, 0] : 0} style={{ cursor: 'pointer' }} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Par moyen de paiement" sub="Taux effectif = tout ce que coûte le moyen (fixe + variable + 3DS + remboursements) ÷ montant encaissé.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Moyen</th><th style={{ ...th, ...num }}>Paiements</th><th style={{ ...th, ...num }}>Encaissé</th>
              <th style={{ ...th, ...num }}>Frais HT</th><th style={{ ...th, ...num }}>dont 3DS</th><th style={{ ...th, ...num }}>dont remb.</th>
              <th style={{ ...th, ...num }}>Coût / paiement</th><th style={{ ...th, ...num }}>Taux effectif</th><th style={{ ...th, ...num }}>Part</th>
            </tr></thead>
            <tbody>
              {byMethod.map((m) => (
                <tr key={m.key}>
                  <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />{m.label}</span></td>
                  <td style={{ ...td, ...num }}>{fmtNum(m.tx)}</td>
                  <td style={{ ...td, ...num }}>{fmtEur(m.volume, 0)}</td>
                  <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtEur(m.cost)}</td>
                  <td style={{ ...td, ...num, color: C.greyT }}>{m.threeds ? fmtEur(m.threeds) : '—'}</td>
                  <td style={{ ...td, ...num, color: C.greyT }}>{m.refunds ? fmtEur(m.refunds) : '—'}</td>
                  <td style={{ ...td, ...num }}>{m.tx ? fmtEur(m.cost / m.tx, 3) : '—'}</td>
                  <td style={{ ...td, ...num }}>{fmtPct(m.volume ? m.cost / m.volume * 100 : null)}</td>
                  <td style={{ ...td, ...num, color: C.greyT }}>{fmtPct(cost ? m.cost / cost * 100 : null, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rates.length > 1 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, marginBottom: 6 }}>Taux effectif par mois</div>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={rates} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#EEF0F3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.greyT }} axisLine={{ stroke: C.greyB }} tickLine={false} />
                <YAxis tickFormatter={(v) => `${v.toFixed(1)} %`} tick={{ fontSize: 11.5, fill: C.greyT }} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<EurTooltip pct />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />
                {METHODS.map((m) => (
                  <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2, stroke: C.white, fill: m.color }} activeDot={{ r: 5 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Par pays" sub="Estimation : chaque ligne de facture est répartie au prorata de nos commandes payées du même moyen et de la même zone (cartes françaises → France, cartes européennes → EEE, etc.). Frais fixes au nombre de commandes, frais variables au montant.">
        <ResponsiveContainer width="100%" height={Math.max(180, countryChart.length * 34 + 40)}>
          <BarChart data={countryChart} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke="#EEF0F3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `${Math.round(v).toLocaleString('fr-FR')} €`} tick={{ fontSize: 11.5, fill: C.greyT }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12.5, fill: C.dark }} axisLine={false} tickLine={false} width={120} />
            <Tooltip content={<EurTooltip />} cursor={{ fill: 'rgba(15,23,42,0.05)' }} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12.5 }} />
            {METHODS.map((m, idx) => (
              <Bar key={m.key} dataKey={m.key} name={m.label} stackId="c" fill={m.color} stroke={C.white} strokeWidth={1}
                radius={idx === METHODS.length - 1 ? [0, 4, 4, 0] : 0} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: C.blue, fontWeight: 600 }}>Tableau de tous les pays ({countries.length})</summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Pays</th>
                {METHODS.map((m) => <th key={m.key} style={{ ...th, ...num }}>{m.label}</th>)}
                <th style={{ ...th, ...num }}>Total</th><th style={{ ...th, ...num }}>Part</th>
              </tr></thead>
              <tbody>
                {countries.map((c) => (
                  <tr key={c.code}>
                    <td style={td}>{countryName(c.code)} <span style={{ color: C.greyT, fontSize: 11 }}>{c.code}</span></td>
                    {METHODS.map((m) => <td key={m.key} style={{ ...td, ...num, color: c[m.key] ? C.dark : C.greyT }}>{c[m.key] ? fmtEur(c[m.key]) : '—'}</td>)}
                    <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtEur(c.total)}</td>
                    <td style={{ ...td, ...num, color: C.greyT }}>{fmtPct(cost ? c.total / cost * 100 : null, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </>
  );
}

/* ─── Liste des factures ─────────────────────────────────────── */

function InvoiceList({ invoices, onOpen, onPdf, onDelete }) {
  if (!invoices.length) return <Card><div style={{ color: C.greyT, fontSize: 14, padding: 20, textAlign: 'center' }}>Aucune facture stockée.</div></Card>;
  return (
    <Card>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Période</th><th style={th}>Facture</th><th style={th}>Contrôle</th>
            <th style={{ ...th, ...num }}>Frais HT</th><th style={{ ...th, ...num }}>Encaissé</th><th style={{ ...th, ...num }}>Taux effectif</th>
            <th style={{ ...th, ...num }}>Surfacturé</th><th style={th} />
          </tr></thead>
          <tbody>
            {invoices.map((i) => {
              const t = i.totals || {};
              const level = t.errors ? 'error' : t.warnings ? 'warn' : 'ok';
              return (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(i.id)}>
                  <td style={{ ...td, fontWeight: 600 }}>{monthLabel(i.periodStart)}</td>
                  <td style={td}><div>{i.invoiceNumber}</div><div style={{ fontSize: 11.5, color: C.greyT }}>du {fmtDate(i.invoiceDate)}</div></td>
                  <td style={td}>
                    <Badge level={level}>{level === 'ok' ? 'Conforme' : [t.errors && `${t.errors} anomalie${t.errors > 1 ? 's' : ''}`, t.warnings && `${t.warnings} à vérifier`].filter(Boolean).join(', ')}</Badge>
                  </td>
                  <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtEur(i.totalHT)}</td>
                  <td style={{ ...td, ...num }}>{fmtEur(t.volume, 0)}</td>
                  <td style={{ ...td, ...num }}>{fmtPct(t.effectiveRate)}</td>
                  <td style={{ ...td, ...num, color: t.overcharge > 0 ? C.red : C.greyT, fontWeight: t.overcharge > 0 ? 700 : 400 }}>{t.overcharge > 0 ? fmtEur(t.overcharge) : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onPdf(i)} style={linkBtn}>PDF</button>
                    <button onClick={() => onDelete(i)} style={{ ...linkBtn, color: C.red }}>Supprimer</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const linkBtn = { background: 'none', border: 'none', color: C.blue, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 6px' };

/* ─── Détail d'une facture ───────────────────────────────────── */

function InvoiceDetail({ data, onBack, onPdf }) {
  const { invoice: inv, audit } = data;
  const t = audit.totals;
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  const checks = [...audit.checks].sort((a, b) => order[a.level] - order[b.level]);
  const countries = Object.entries(audit.byCountry).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ ...linkBtn, padding: 0, fontSize: 13.5 }}>← Retour</button>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>Facture {monthLabel(inv.periodStart)}</div>
        <span style={{ fontSize: 12.5, color: C.greyT }}>{inv.invoiceNumber} · du {fmtDate(inv.periodStart)} au {fmtDate(inv.periodEnd)} · grille : {audit.grids.join(' + ')}</span>
        <button onClick={() => onPdf({ id: inv.id, invoiceNumber: inv.invoiceNumber })} style={{ ...linkBtn, marginLeft: 'auto' }}>Ouvrir le PDF</button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatCard label="Frais HT" value={fmtEur(inv.totalHT)} sub={inv.prepaid != null ? `prélevé ${fmtEur(-inv.prepaid)}, reversé ${fmtEur(inv.credited || 0)}` : null} />
        <StatCard label="Encaissé via Mollie" value={fmtEur(t.volume, 0)} />
        <StatCard label="Taux effectif" value={fmtPct(t.effectiveRate)} />
        <StatCard label="Surfacturation" value={fmtEur(t.overcharge)} color={t.overcharge > 0 ? C.red : C.green} />
        <StatCard label="Tentatives 3DS" value={fmtNum(t.threedsAttempts)} sub={t.threedsRatio ? `${t.threedsRatio.toFixed(2).replace('.', ',')} par paiement carte` : null} />
        <StatCard label="Frais dans /financier" value={fmtEur(t.estimatedByApp)} sub={`${fmtEur(t.estimatedByApp - inv.totalHT)} vs facturé`} color={C.greyT} />
      </div>

      <Card title="Contrôles">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checks.map((c, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, background: LEVELS[c.level].bg }}>
              <Badge level={c.level} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.dark }}>{c.title}</div>
                <div style={{ fontSize: 12.5, color: '#374151', marginTop: 2 }}>{c.detail}</div>
              </div>
              {c.amount != null && <div style={{ fontWeight: 700, fontSize: 13.5, color: LEVELS[c.level].color, whiteSpace: 'nowrap' }}>{c.amount > 0 ? '+' : ''}{fmtEur(c.amount)}</div>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Rapprochement avec nos commandes" sub="Paiements et montants facturés par Mollie contre nos commandes payées de la période (date de paiement).">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Moyen</th>
              <th style={{ ...th, ...num }}>Paiements Mollie</th><th style={{ ...th, ...num }}>Nos commandes</th><th style={{ ...th, ...num }}>Écart</th>
              <th style={{ ...th, ...num }}>Montant Mollie</th><th style={{ ...th, ...num }}>Nos commandes</th><th style={{ ...th, ...num }}>Écart</th>
            </tr></thead>
            <tbody>
              {audit.reconciliation.map((r) => (
                <tr key={r.key}>
                  <td style={td}>{r.label}</td>
                  <td style={{ ...td, ...num }}>{fmtNum(r.mollieCount)}</td>
                  <td style={{ ...td, ...num }}>{fmtNum(r.ourCount)}</td>
                  <td style={{ ...td, ...num, color: r.diffCount > 0 ? C.orange : C.greyT }}>{r.diffCount > 0 ? '+' : ''}{fmtNum(r.diffCount)}</td>
                  <td style={{ ...td, ...num }}>{fmtEur(r.mollieVolume)}</td>
                  <td style={{ ...td, ...num }}>{fmtEur(r.ourVolume)}</td>
                  <td style={{ ...td, ...num, color: r.diffVolume > 0 ? C.orange : C.greyT }}>{r.diffVolume > 0 ? '+' : ''}{fmtEur(r.diffVolume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Lignes de la facture" sub="Taux attendu = contrat (ou tarif standard relevé pour Alma, Pay by Bank et remboursements). Mollie tronque chaque ligne au centime inférieur.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Ligne</th><th style={th}>Moyen</th><th style={{ ...th, ...num }}>Assiette</th>
              <th style={{ ...th, ...num }}>Taux facturé</th><th style={{ ...th, ...num }}>Taux attendu</th>
              <th style={{ ...th, ...num }}>Montant</th><th style={{ ...th, ...num }}>Écart</th><th style={th}>Statut</th>
            </tr></thead>
            <tbody>
              {audit.lines.map((l, idx) => {
                const unit = l.rateUnit === 'pct' ? ' %' : ' €';
                const bad = l.issues.some((s) => /supérieur|faux|anormal|non reconnue/.test(s));
                return (
                  <tr key={idx} style={{ background: bad ? '#FFF5F5' : undefined }}>
                    <td style={{ ...td, fontSize: 12.5 }}>{l.label}</td>
                    <td style={{ ...td, fontSize: 12.5, color: C.greyT }}>{l.cls ? METHOD_LABEL[l.cls.method] : '—'}</td>
                    <td style={{ ...td, ...num }}>{l.rateUnit === 'pct' ? fmtEur(l.base) : fmtNum(l.base)}</td>
                    <td style={{ ...td, ...num }}>{String(l.rate).replace('.', ',')}{unit}</td>
                    <td style={{ ...td, ...num, color: C.greyT }}>{l.expectedRate != null ? `${String(l.expectedRate).replace('.', ',')}${unit}` : '—'}</td>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{fmtEur(l.amount)}</td>
                    <td style={{ ...td, ...num, color: l.rateGap > 0 ? C.red : l.rateGap < 0 ? C.green : C.greyT }}>{l.rateGap ? `${l.rateGap > 0 ? '+' : ''}${fmtEur(l.rateGap)}` : '—'}</td>
                    <td style={td}>{l.issues.length ? <Badge level={bad ? 'error' : 'info'}>{l.issues[0]}</Badge> : <Badge level="ok">OK</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={5}>Total hors TVA</td>
              <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtEur(inv.totalHT)}</td><td style={td} colSpan={2} />
            </tr></tfoot>
          </table>
        </div>
      </Card>

      <Card title="Répartition estimée par pays">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
          {countries.map(([code, v]) => (
            <div key={code} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: C.grey, borderRadius: 6, fontSize: 13 }}>
              <span>{countryName(code)}</span><span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtEur(v)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ─── Contrat ─────────────────────────────────────────────────── */

function ContractTab({ contract }) {
  if (!contract) return null;
  const { contract: k, grids, reference, labels } = contract;
  const contractKeys = ['cb', 'card_consumer', 'card_commercial', 'card_non_eea', 'amex', 'bancontact', 'threeds'];
  const refKeys = [...new Set(reference.flatMap((g) => Object.keys(g.rates)))];
  const fmtRate = (r) => (r ? [r.fixed != null && `${String(r.fixed).replace('.', ',')} €`, r.pct != null && `${String(r.pct).replace('.', ',')} %`].filter(Boolean).join(' + ') : '—');
  const today = new Date().toISOString().slice(0, 10);
  const dates = [
    ['Signé le', k.signedAt],
    ['Fin de la période ferme (18 mois)', k.endsAt],
    ['Résiliation possible jusqu\'au (préavis 3 mois)', k.noticeDeadline],
    ['Hausse « inflation » possible au plus tôt', k.inflationEarliest],
  ];
  return (
    <>
      <Card title="Échéances du contrat" sub="Sans résiliation avant la date limite, le contrat est renouvelé pour 12 mois. Montant minimum de facture : 0 €.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {dates.map(([l, d]) => (
            <div key={l} style={{ padding: '10px 12px', background: C.grey, borderRadius: 8 }}>
              <div style={{ fontSize: 11.5, color: C.greyT }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: d < today ? C.greyT : C.dark }}>{fmtDate(d)}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Grille du contrat" sub="Hors TVA (autoliquidation). Toute hausse avant le 01/01/2027 est hors contrat, sauf hausse imposée par les banques et notifiée 1 mois avant.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Moyen</th>{grids.map((g) => <th key={g.label} style={{ ...th, ...num }}>{g.label}<div style={{ fontWeight: 400 }}>{g.from === '2000-01-01' ? '' : `dès le ${fmtDate(g.from)}`}</div></th>)}</tr></thead>
            <tbody>
              {contractKeys.map((key) => (
                <tr key={key}><td style={td}>{labels[key]}</td>{grids.map((g) => <td key={g.label} style={{ ...td, ...num }}>{fmtRate(g.rates[key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Hors contrat (tarif standard Mollie)" sub="Relevé sur les factures puis daté à chaque changement annoncé par Mollie. Un écart en notre défaveur après une annonce écrite est une anomalie.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Moyen</th>{reference.map((g) => <th key={g.label} style={{ ...th, ...num }}>{g.label}<div style={{ fontWeight: 400 }}>{g.from === '2000-01-01' ? '' : `dès le ${fmtDate(g.from)}`}</div></th>)}</tr></thead>
            <tbody>
              {refKeys.map((key) => (
                <tr key={key}><td style={td}>{labels[key]}</td>{reference.map((g) => <td key={g.label} style={{ ...td, ...num, color: g.rates[key] ? C.dark : C.greyT }}>{g.rates[key] ? fmtRate(g.rates[key]) : 'inchangé'}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ─── Frais des commandes (/financier) ───────────────────────── */

const GROUP_LABELS = {
  'cards|FR': 'Cartes — France', 'cards|EEA': 'Cartes — Europe (EEE)', 'cards|NON_EEA': 'Cartes — hors EEE',
  'bancontact|ALL': 'Bancontact', 'alma|FR': 'Alma — France', 'alma|BE': 'Alma — Belgique', 'paybybank|ALL': 'Pay by Bank',
};

function CostsPanel({ preview, busy, done, onApply, onClose }) {
  const rows = preview.months;
  const tot = (k) => rows.reduce((s, m) => s + (m[k] || 0), 0);
  return (
    <Card title="Ajuster les frais de paiement des commandes"
      sub="Mois facturés : la facture est répartie au centime sur les commandes du mois (fixe + 3DS + remboursements au nombre, variable au montant, par moyen et zone). Commandes plus récentes : tarif recalé sur la dernière facture, au tarif du jour. Le résultat alimente /financier et résiste aux resynchronisations."
      right={<button onClick={onClose} style={linkBtn}>Fermer</button>}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Période</th><th style={th}>Source</th><th style={{ ...th, ...num }}>Commandes</th>
            <th style={{ ...th, ...num }}>Frais actuels</th><th style={{ ...th, ...num }}>Frais ajustés</th><th style={{ ...th, ...num }}>Écart</th>
          </tr></thead>
          <tbody>
            {rows.map((m, idx) => (
              <tr key={idx}>
                <td style={td}>{m.kind === 'facture' ? monthLabel(m.periodStart) : `du ${fmtDate(m.periodStart)} au ${fmtDate(m.periodEnd)}`}</td>
                <td style={{ ...td, fontSize: 12.5, color: C.greyT }}>
                  {m.kind === 'facture' ? `facture ${m.invoiceNumber}` : 'tarif recalé (pas encore de facture)'}
                  {m.unallocated?.length > 0 && <div style={{ color: C.orange }}>non réparti : {m.unallocated.map((u) => `${u.label} (${fmtEur(u.amount)})`).join(', ')}</div>}
                </td>
                <td style={{ ...td, ...num }}>{fmtNum(m.orders)}</td>
                <td style={{ ...td, ...num }}>{fmtEur(m.before)}</td>
                <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtEur(m.after)}</td>
                <td style={{ ...td, ...num, color: m.after - m.before > 0 ? C.red : C.green }}>{m.after - m.before > 0 ? '+' : ''}{fmtEur(m.after - m.before)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td style={{ ...td, fontWeight: 700 }} colSpan={3}>Total</td>
            <td style={{ ...td, ...num }}>{fmtEur(tot('before'))}</td>
            <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtEur(tot('after'))}</td>
            <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtEur(tot('after') - tot('before'))}</td>
          </tr></tfoot>
        </table>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, margin: '16px 0 6px' }}>Tarif recalé sur {preview.sourceInvoice} (commandes à venir)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
        {Object.entries(preview.rates).map(([g, r]) => (
          <div key={g} style={{ padding: '8px 10px', background: C.grey, borderRadius: 6, fontSize: 12.5 }}>
            <div style={{ color: C.greyT }}>{GROUP_LABELS[g] || g}</div>
            <div style={{ fontWeight: 700 }}>{fmtEur(r.fixed, 3)} + {fmtPct(r.pct, 3)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        {done ? (
          <Badge level="ok">{`Appliqué : ${fmtNum(done.exactOrders)} commandes au coût facturé, ${fmtNum(done.estimatedOrders)} au tarif recalé`}</Badge>
        ) : (
          <button onClick={onApply} disabled={busy}
            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: C.primary, color: C.white, fontWeight: 700, fontSize: 13.5, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Mise à jour…' : `Mettre à jour ${fmtNum(preview.exactOrders + preview.estimatedOrders)} commandes`}
          </button>
        )}
        <span style={{ fontSize: 12, color: C.greyT }}>Seules les commandes payées par Mollie sont touchées (PayPal et Systempay gardent leur tarif).</span>
      </div>
    </Card>
  );
}

/* ─── Page ────────────────────────────────────────────────────── */

export default function MollieApp() {
  const [tab, setTab] = useState('dashboard');
  const [invoices, setInvoices] = useState([]);
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [costs, setCosts] = useState(null); // { preview, busy, done }
  const fileRef = useRef(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [inv, ctr] = await Promise.all([axios.get(`${API_URL}/mollie/invoices`), axios.get(`${API_URL}/mollie/contract`)]);
      setInvoices(inv.data.invoices || []);
      setContract(ctr.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function openInvoice(id) {
    try {
      const { data } = await axios.get(`${API_URL}/mollie/invoices/${id}`);
      setDetail(data);
      window.scrollTo(0, 0);
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function handleFiles(files) {
    if (!files?.length) return;
    setUploading(true); setUploadResult(null); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('pdfs', f);
      const { data } = await axios.post(`${API_URL}/mollie/upload`, fd, { timeout: 300000 });
      setUploadResult(data.results);
      await load();
      const ok = data.results.filter((r) => r.id);
      if (ok.length === 1) openInvoice(ok[0].id);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function openPdf(inv) {
    // Par axios (pas un lien direct) : l'intercepteur pose le jeton.
    axios.get(`${API_URL}/mollie/invoices/${inv.id}/pdf`, { responseType: 'blob' })
      .then(({ data }) => window.open(URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), '_blank'))
      .catch((e) => setError(e.response?.status === 404 ? 'PDF non disponible' : e.message));
  }

  async function deleteInvoice(inv) {
    if (!window.confirm(`Supprimer la facture ${inv.invoiceNumber} (${monthLabel(inv.periodStart)}) ?`)) return;
    try {
      await axios.delete(`${API_URL}/mollie/invoices/${inv.id}`);
      if (detail?.invoice?.id === inv.id) setDetail(null);
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function previewCosts() {
    setError(null); setDetail(null);
    setCosts({ preview: null, busy: true, done: null });
    try {
      const { data } = await axios.post(`${API_URL}/mollie/apply-costs/preview`, {}, { timeout: 300000 });
      setCosts({ preview: data, busy: false, done: null });
    } catch (e) {
      setCosts(null);
      setError(e.response?.data?.error || e.message);
    }
  }

  async function applyCosts() {
    setCosts((c) => ({ ...c, busy: true }));
    try {
      const { data } = await axios.post(`${API_URL}/mollie/apply-costs`, {}, { timeout: 300000 });
      setCosts({ preview: data, busy: false, done: data });
      load();
    } catch (e) {
      setCosts((c) => ({ ...c, busy: false }));
      setError(e.response?.status === 403 ? 'Droit d\'écriture « Factures Mollie » nécessaire' : (e.response?.data?.error || e.message));
    }
  }

  const tabs = [['dashboard', 'Tableau de bord'], ['invoices', `Factures (${invoices.length})`], ['contract', 'Contrat']];

  return (
    <AppShell currentPath="/mollie">
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: C.dark, margin: 0 }}>Factures Mollie</h1>
            <div style={{ fontSize: 13, color: C.greyT, marginTop: 4 }}>Contrôle contre le contrat du 29/01/2026, rapprochement avec nos commandes et suivi des coûts.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={previewCosts} disabled={!invoices.length || costs?.busy}
              title="Recaler les frais de paiement des commandes (/financier) sur les factures Mollie"
              style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.primary}`, background: C.white, color: C.primary, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', opacity: !invoices.length ? 0.5 : 1 }}>
              Ajuster les frais des commandes
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={(e) => handleFiles([...e.target.files])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: C.primary, color: C.white, fontWeight: 700, fontSize: 13.5, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
              {uploading ? 'Lecture en cours…' : 'Déposer des factures PDF'}
            </button>
          </div>
        </div>

        {error && <div style={{ background: C.redL, color: C.red, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13.5 }}>{error}</div>}
        {uploadResult && (
          <div style={{ background: C.white, border: `1px solid ${C.greyB}`, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {uploadResult.map((r, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '3px 0' }}>
                <Badge level={r.status === 'error' ? 'error' : r.totals?.errors ? 'error' : r.totals?.warnings ? 'warn' : 'ok'}>
                  {r.status === 'error' ? 'Illisible' : r.status === 'already' ? 'Déjà enregistrée' : 'Enregistrée'}
                </Badge>
                <span>{r.file}</span>
                {r.status === 'error' ? <span style={{ color: C.red }}>{r.error}</span>
                  : <button style={linkBtn} onClick={() => openInvoice(r.id)}>{r.invoiceNumber} — voir le contrôle</button>}
              </div>
            ))}
          </div>
        )}

        {costs && !costs.preview && <div style={{ color: C.greyT, fontSize: 13.5, marginBottom: 14 }}>Calcul des frais des commandes…</div>}
        {costs?.preview && (
          <CostsPanel preview={costs.preview} busy={costs.busy} done={costs.done} onApply={applyCosts} onClose={() => setCosts(null)} />
        )}

        {detail ? (
          <InvoiceDetail data={detail} onBack={() => setDetail(null)} onPdf={openPdf} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.greyB}`, marginBottom: 18 }}>
              {tabs.map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: tab === k ? C.dark : C.greyT, borderBottom: `2px solid ${tab === k ? C.dark : 'transparent'}`, marginBottom: -1 }}>{l}</button>
              ))}
            </div>
            {loading ? <div style={{ color: C.greyT, fontSize: 14 }}>Chargement…</div> : (
              <Fragment>
                {tab === 'dashboard' && <Dashboard invoices={invoices} onOpen={openInvoice} />}
                {tab === 'invoices' && <InvoiceList invoices={invoices} onOpen={openInvoice} onPdf={openPdf} onDelete={deleteInvoice} />}
                {tab === 'contract' && <ContractTab contract={contract} />}
              </Fragment>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
