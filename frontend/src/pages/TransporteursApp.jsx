import { useState, useContext, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  primary: '#334155', accent: '#4F46E5', accentL: '#EEF2FF',
  green: '#16A34A', red: '#DC2626', orange: '#EA580C',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280',
  dark: '#111827', white: '#FFFFFF',
};

const CARRIER_LIST = ['colissimo', 'chronopost', 'lettre_suivie', 'mondial_relay'];
const CARRIERS = {
  colissimo:     { label: 'Colissimo',     color: '#D96000' },
  chronopost:    { label: 'Chronopost',    color: '#0D7FA8' },
  lettre_suivie: { label: 'Lettre Suivie', color: '#FFB000' },
  mondial_relay: { label: 'Mondial Relay', color: '#9C2462' },
};

const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', NL: 'Pays-Bas', DE: 'Allemagne', IT: 'Italie',
  ES: 'Espagne', PT: 'Portugal', LU: 'Luxembourg', AT: 'Autriche', DK: 'Danemark', SE: 'Suède',
  FI: 'Finlande', NO: 'Norvège', IE: 'Irlande', GB: 'Royaume-Uni', PL: 'Pologne', CZ: 'Tchéquie',
  SK: 'Slovaquie', HU: 'Hongrie', RO: 'Roumanie', BG: 'Bulgarie', GR: 'Grèce', HR: 'Croatie',
  SI: 'Slovénie', LT: 'Lituanie', LV: 'Lettonie', EE: 'Estonie', CY: 'Chypre', MT: 'Malte',
  MC: 'Monaco', AD: 'Andorre', LI: 'Liechtenstein', SM: 'Saint-Marin',
  RE: 'Réunion', MQ: 'Martinique', GP: 'Guadeloupe', GF: 'Guyane', YT: 'Mayotte',
  PF: 'Polynésie fr.', NC: 'Nouvelle-Calédonie', PM: 'St-Pierre-et-M.', BL: 'St-Barthélemy', MF: 'St-Martin',
  CA: 'Canada', US: 'États-Unis', AU: 'Australie', ZA: 'Afrique du Sud', MA: 'Maroc',
  TN: 'Tunisie', DZ: 'Algérie', SA: 'Arabie S.', AE: 'Émirats', JP: 'Japon', CN: 'Chine', BZ: 'Belize',
  '—': 'Non identifié',
};

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const fmtEur = v => {
  if (v === null || v === undefined || v === '') return '—';
  const n = parseFloat(v);
  if (!isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} €`;
};
const fmtColis = n => (n || 0).toLocaleString('en-US').replace(/,/g, ' ');

function countryEntries(inv) {
  const colisTot = parseInt(inv.total_parcels || 0, 10);
  const htTot = parseFloat(inv.total_ht || 0);
  if (inv.carrier === 'mondial_relay') return [[inv.mr_pays || '—', { colis: colisTot, ht: htTot }]];
  if (inv.carrier === 'lettre_suivie') return [['France', { colis: colisTot, ht: htTot }]];
  const ct = inv.country_totals || {};
  const out = Object.entries(ct).map(([code, v]) => [COUNTRY_NAMES[code] || code, { colis: parseInt(v.colis || 0, 10), ht: parseFloat(v.ht || 0) }]);
  return out.length ? out : [['—', { colis: colisTot, ht: htTot }]];
}

function Th({ label, align = 'left' }) {
  return <th style={{ padding: '9px 12px', textAlign: align, fontWeight: 700, color: C.dark, fontSize: 11.5, borderBottom: `2px solid ${C.greyB}`, background: C.grey, whiteSpace: 'nowrap' }}>{label}</th>;
}
function Td({ children, align = 'left', color, bold, bg }) {
  return <td style={{ padding: '8px 12px', textAlign: align, color: color || C.dark, fontWeight: bold ? 700 : 400, borderBottom: `1px solid ${C.greyB}`, fontSize: 13, background: bg }}>{children}</td>;
}

function Kpi({ value, label, color }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.white, borderRadius: 12, border: `1px solid ${C.greyB}`, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || C.primary }}>{value}</div>
      <div style={{ fontSize: 12, color: C.greyT, marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function TransporteursApp() {
  const { token } = useContext(AuthContext);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadTotals() {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/transporteurs/totals`, { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setTotals(data);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }
  useEffect(() => { loadTotals(); }, []);

  const agg = useMemo(() => {
    const carrierMap = {};   // carrier -> { invoices, colis, ht }
    const monthMap = {};     // monthKey -> { perCarrier:{carrier:{ht,colis}}, totalHt, totalColis }
    const yearMap = {};      // year -> idem
    const countryMap = {};   // name -> { colis, ht }
    let grandColis = 0, grandHt = 0, grandInv = 0;

    for (const inv of (totals?.invoices || [])) {
      const carrier = inv.carrier;
      const parts = (inv.date || '').split('/');
      if (parts.length !== 3) continue;
      const [, m, y] = parts;
      const monthKey = `${y}-${m}`;
      const ht = parseFloat(inv.total_ht || 0);
      const colis = parseInt(inv.total_parcels || 0, 10);

      const cm = carrierMap[carrier] = carrierMap[carrier] || { invoices: 0, colis: 0, ht: 0 };
      cm.invoices += 1; cm.colis += colis; cm.ht += ht;
      grandColis += colis; grandHt += ht; grandInv += 1;

      const mm = monthMap[monthKey] = monthMap[monthKey] || { perCarrier: {}, totalHt: 0, totalColis: 0 };
      mm.perCarrier[carrier] = mm.perCarrier[carrier] || { ht: 0, colis: 0 };
      mm.perCarrier[carrier].ht += ht; mm.perCarrier[carrier].colis += colis;
      mm.totalHt += ht; mm.totalColis += colis;

      const ym = yearMap[y] = yearMap[y] || { perCarrier: {}, totalHt: 0, totalColis: 0 };
      ym.perCarrier[carrier] = ym.perCarrier[carrier] || { ht: 0, colis: 0 };
      ym.perCarrier[carrier].ht += ht; ym.perCarrier[carrier].colis += colis;
      ym.totalHt += ht; ym.totalColis += colis;

      for (const [name, v] of countryEntries(inv)) {
        const ce = countryMap[name] = countryMap[name] || { colis: 0, ht: 0 };
        ce.colis += v.colis; ce.ht += v.ht;
      }
    }

    const byCarrier = CARRIER_LIST.filter(c => carrierMap[c]).map(c => ({ carrier: c, ...CARRIERS[c], ...carrierMap[c] }));
    const monthKeysAsc = Object.keys(monthMap).sort();
    const chartData = monthKeysAsc.map(key => {
      const [y, m] = key.split('-');
      const row = { label: `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y}` };
      for (const c of CARRIER_LIST) row[c] = +(monthMap[key].perCarrier[c]?.ht || 0).toFixed(2);
      row.total = +monthMap[key].totalHt.toFixed(2);
      return row;
    });
    const chartDataColis = monthKeysAsc.map(key => {
      const [y, m] = key.split('-');
      const row = { label: `${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y}` };
      for (const c of CARRIER_LIST) row[c] = monthMap[key].perCarrier[c]?.colis || 0;
      row.total = monthMap[key].totalColis;
      return row;
    });
    const byMonth = monthKeysAsc.slice().reverse().map(key => { const [y, m] = key.split('-'); return { key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`, ...monthMap[key] }; });
    const byYear = Object.keys(yearMap).sort().reverse().map(y => ({ year: y, ...yearMap[y] }));
    const byCountry = Object.entries(countryMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.colis - a.colis);

    return { byCarrier, chartData, chartDataColis, byMonth, byYear, byCountry, grandColis, grandHt, grandInv };
  }, [totals]);

  const { byCarrier, chartData, chartDataColis, byMonth, byYear, byCountry, grandColis, grandHt, grandInv } = agg;
  const avgPerColis = grandColis ? grandHt / grandColis : 0;

  return (
    <AppShell currentPath="/transporteurs">
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: C.dark, margin: 0 }}>Transporteurs — vue consolidée</h1>
            <p style={{ color: C.greyT, margin: '5px 0 0', fontSize: 13 }}>Croisement de toutes les données Colissimo, Chronopost, Lettre Suivie et Mondial Relay.</p>
          </div>
          <button onClick={loadTotals} style={{ background: 'none', border: `1px solid ${C.greyB}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: C.greyT }}>↻ Actualiser</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.greyT }}>Chargement…</div>
        ) : !totals || grandInv === 0 ? (
          <div style={{ textAlign: 'center', padding: 50, color: C.greyT }}>Aucune donnée. Importez des factures dans les apps transporteurs.</div>
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <Kpi value={fmtColis(grandColis)} label="Colis (tous transporteurs)" />
              <Kpi value={fmtEur(grandHt)} label="Total facturé HT" color={C.accent} />
              <Kpi value={fmtEur(avgPerColis)} label="Coût moyen / colis" color={C.orange} />
              <Kpi value={fmtColis(grandInv)} label="Factures analysées" color={C.green} />
            </div>

            {/* Par transporteur */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par transporteur</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr><Th label="Transporteur" /><Th label="Factures" align="right" /><Th label="Colis" align="right" /><Th label="Total HT" align="right" /><Th label="€ / colis" align="right" /><Th label="Part HT" align="right" /></tr></thead>
                <tbody>{byCarrier.map((c, i) => (
                  <tr key={c.carrier} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                    <Td bold><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: c.color, marginRight: 8 }} />{c.label}</Td>
                    <Td align="right" color={C.greyT}>{fmtColis(c.invoices)}</Td>
                    <Td align="right">{fmtColis(c.colis)}</Td>
                    <Td align="right" bold>{fmtEur(c.ht)}</Td>
                    <Td align="right">{fmtEur(c.colis ? c.ht / c.colis : 0)}</Td>
                    <Td align="right" color={C.greyT}>{grandHt ? `${(c.ht / grandHt * 100).toFixed(1)} %` : '—'}</Td>
                  </tr>
                ))}</tbody>
                <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                  <Td bold>Total</Td>
                  <Td align="right" bold>{fmtColis(grandInv)}</Td>
                  <Td align="right" bold>{fmtColis(grandColis)}</Td>
                  <Td align="right" bold color={C.accent}>{fmtEur(grandHt)}</Td>
                  <Td align="right" bold>{fmtEur(avgPerColis)}</Td>
                  <Td align="right" bold>100 %</Td>
                </tr></tfoot>
              </table>
            </div>

            {/* Évolution mensuelle */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Évolution mensuelle du coût HT par transporteur</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v} €`} />
                  <Tooltip formatter={(v, n) => [fmtEur(v), n === 'total' ? 'Total' : (CARRIERS[n]?.label || n)]} />
                  <Legend formatter={n => n === 'total' ? 'Total' : (CARRIERS[n]?.label || n)} />
                  {CARRIER_LIST.map(c => <Line key={c} type="monotone" dataKey={c} stroke={CARRIERS[c].color} strokeWidth={2} dot={{ r: 2 }} />)}
                  <Line type="monotone" dataKey="total" stroke={C.dark} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Par année et par transporteur */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par année et par transporteur (HT)</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><Th label="Année" />{CARRIER_LIST.map(c => <Th key={c} label={CARRIERS[c].label} align="right" />)}<Th label="Colis" align="right" /><Th label="Total HT" align="right" /></tr></thead>
                  <tbody>{byYear.map((r, i) => (
                    <tr key={r.year} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{r.year}</Td>
                      {CARRIER_LIST.map(c => <Td key={c} align="right">{r.perCarrier[c] ? fmtEur(r.perCarrier[c].ht) : '—'}</Td>)}
                      <Td align="right" color={C.greyT}>{fmtColis(r.totalColis)}</Td>
                      <Td align="right" bold color={C.accent}>{fmtEur(r.totalHt)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <Td bold>Total</Td>
                    {CARRIER_LIST.map(c => <Td key={c} align="right" bold>{fmtEur(byYear.reduce((s, r) => s + (r.perCarrier[c]?.ht || 0), 0))}</Td>)}
                    <Td align="right" bold>{fmtColis(grandColis)}</Td>
                    <Td align="right" bold color={C.accent}>{fmtEur(grandHt)}</Td>
                  </tr></tfoot>
                </table>
              </div>
            </div>

            {/* Par mois et par transporteur */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois et par transporteur (HT)</h3>
              <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0 }}><tr><Th label="Mois" />{CARRIER_LIST.map(c => <Th key={c} label={CARRIERS[c].label} align="right" />)}<Th label="Colis" align="right" /><Th label="Total HT" align="right" /></tr></thead>
                  <tbody>{byMonth.map((r, i) => (
                    <tr key={r.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td>{r.label}</Td>
                      {CARRIER_LIST.map(c => <Td key={c} align="right">{r.perCarrier[c] ? fmtEur(r.perCarrier[c].ht) : '—'}</Td>)}
                      <Td align="right" color={C.greyT}>{fmtColis(r.totalColis)}</Td>
                      <Td align="right" bold>{fmtEur(r.totalHt)}</Td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            {/* Évolution mensuelle du nombre de colis */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Évolution mensuelle du nombre de colis par transporteur</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartDataColis} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.greyB} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [fmtColis(v), n === 'total' ? 'Total' : (CARRIERS[n]?.label || n)]} />
                  <Legend formatter={n => n === 'total' ? 'Total' : (CARRIERS[n]?.label || n)} />
                  {CARRIER_LIST.map(c => <Line key={c} type="monotone" dataKey={c} stroke={CARRIERS[c].color} strokeWidth={2} dot={{ r: 2 }} />)}
                  <Line type="monotone" dataKey="total" stroke={C.dark} strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Par mois et par transporteur (colis) */}
            <div style={{ marginBottom: 26 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 10 }}>Par mois et par transporteur (nombre de colis)</h3>
              <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto', border: `1px solid ${C.greyB}`, borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0 }}><tr><Th label="Mois" />{CARRIER_LIST.map(c => <Th key={c} label={CARRIERS[c].label} align="right" />)}<Th label="Total colis" align="right" /></tr></thead>
                  <tbody>{byMonth.map((r, i) => (
                    <tr key={r.key} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td>{r.label}</Td>
                      {CARRIER_LIST.map(c => <Td key={c} align="right">{r.perCarrier[c] ? fmtColis(r.perCarrier[c].colis) : '—'}</Td>)}
                      <Td align="right" bold color={C.accent}>{fmtColis(r.totalColis)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <Td bold>Total</Td>
                    {CARRIER_LIST.map(c => <Td key={c} align="right" bold>{fmtColis(byMonth.reduce((s, r) => s + (r.perCarrier[c]?.colis || 0), 0))}</Td>)}
                    <Td align="right" bold color={C.accent}>{fmtColis(grandColis)}</Td>
                  </tr></tfoot>
                </table>
              </div>
            </div>

            {/* Par pays consolidé */}
            <div style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 4 }}>Par pays de destination (tous transporteurs)</h3>
              <p style={{ margin: '0 0 10px', color: C.greyT, fontSize: 12 }}>Nombre de colis et coût HT par pays, agrégés sur les 4 transporteurs.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr><Th label="Pays" /><Th label="Colis" align="right" /><Th label="Part colis" align="right" /><Th label="Coût HT" align="right" /></tr></thead>
                  <tbody>{byCountry.map((r, i) => (
                    <tr key={r.name} style={{ background: i % 2 === 0 ? C.white : C.grey }}>
                      <Td bold>{r.name}</Td>
                      <Td align="right">{fmtColis(r.colis)}</Td>
                      <Td align="right" color={C.greyT}>{grandColis ? `${(r.colis / grandColis * 100).toFixed(1)} %` : '—'}</Td>
                      <Td align="right" bold>{fmtEur(r.ht)}</Td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr style={{ borderTop: `2px solid ${C.greyB}`, fontWeight: 700 }}>
                    <Td bold>Total</Td>
                    <Td align="right" bold>{fmtColis(byCountry.reduce((s, r) => s + r.colis, 0))}</Td>
                    <Td align="right" bold>100 %</Td>
                    <Td align="right" bold color={C.accent}>{fmtEur(byCountry.reduce((s, r) => s + r.ht, 0))}</Td>
                  </tr></tfoot>
                </table>
              </div>
              <p style={{ margin: '8px 0 0', color: C.greyT, fontSize: 11.5 }}>Note : pour Colissimo/Chronopost le coût HT par pays = coût des colis (hors charges globales/suppléments non rattachés à un pays) ; pour Mondial Relay/Lettre Suivie = total HT de la facture.</p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
