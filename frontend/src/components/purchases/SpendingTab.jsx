import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from 'recharts';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  orange: '#E28F00', saphir: '#135E84', saphirF: '#003A56',
  grisCL: '#E2E2E2', grisTL: '#F2F6F8', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', vert: '#4AB866',
};

// Palette catégorielle : ordre FIXE (jamais recyclé), validée pour le daltonisme
// sur fond blanc (pire paire adjacente : ΔE CVD 9,1 / vision normale 19,6).
// Au-delà, les fournisseurs sont repliés dans « Autres » (gris neutre, volontairement discret).
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER_COLOR = '#7C8B96';
const BAR_COLOR = '#2a78d6';
const TOP_STACK = 6;   // fournisseurs colorés dans le graphe mensuel
const TOP_RANK = 14;   // barres du classement

// Intl utilise une espace fine insécable (U+202F) comme séparateur de milliers,
// peu lisible -> on la remplace par une espace normale.
const NBSP = /[\u202f\u00a0]/g;
const eur = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0).replace(NBSP, ' ') + ' €';
const eur0 = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0).replace(NBSP, ' ') + ' €';
const eurAxis = (n) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)} k€` : `${Math.round(n)} €`);
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS_FR[parseInt(m) - 1]} ${y.slice(2)}`; };
const fmtDate = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
const ellips = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function SpendingTab({ token }) {
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [year, setYear] = useState('all');
  const [sel, setSel] = useState(null); // { supplier, month }
  const [hidden, setHidden] = useState(() => new Set()); // clés de séries masquées via la légende

  const fetchData = async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${API_URL}/purchases/bms-spending${refresh ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success) setOrders(res.data.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur de chargement des achats BMS');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };
  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => {
    const s = new Set((orders || []).map(o => (o.order_date || '').slice(0, 4)).filter(Boolean));
    return [...s].sort().reverse();
  }, [orders]);

  const filtered = useMemo(() => (orders || []).filter(o => {
    if (!o.order_date) return false;
    return year === 'all' || o.order_date.slice(0, 4) === year;
  }), [orders, year]);

  const { suppliers, months, cell, supTotal, monthTotal, grand } = useMemo(() => {
    const monthsSet = new Set(), supSet = new Set();
    const cell = {}, supTotal = {}, monthTotal = {};
    const grand = { ht: 0, ttc: 0, count: 0 };
    const add = (acc, o) => { acc.ht += o.ht; acc.ttc += o.ttc; acc.count++; };
    for (const o of filtered) {
      const ym = o.order_date.slice(0, 7);
      monthsSet.add(ym); supSet.add(o.supplier_name);
      const k = o.supplier_name + '||' + ym;
      add(cell[k] = cell[k] || { ht: 0, ttc: 0, count: 0 }, o);
      add(supTotal[o.supplier_name] = supTotal[o.supplier_name] || { ht: 0, ttc: 0, count: 0 }, o);
      add(monthTotal[ym] = monthTotal[ym] || { ht: 0, ttc: 0, count: 0 }, o);
      add(grand, o);
    }
    const months = [...monthsSet].sort();
    const suppliers = [...supSet].sort((a, b) => supTotal[b].ht - supTotal[a].ht);
    return { suppliers, months, cell, supTotal, monthTotal, grand };
  }, [filtered]);

  // Classement : total HT par fournisseur, le reste replié dans « Autres ».
  const rankData = useMemo(() => {
    const rows = suppliers.slice(0, TOP_RANK).map(s => ({
      name: s, label: ellips(s, 24), ht: supTotal[s].ht, ttc: supTotal[s].ttc, count: supTotal[s].count,
    }));
    const rest = suppliers.slice(TOP_RANK);
    if (rest.length) {
      rows.push({
        name: `Autres (${rest.length})`, label: `Autres (${rest.length})`, isOther: true,
        ht: rest.reduce((a, s) => a + supTotal[s].ht, 0),
        ttc: rest.reduce((a, s) => a + supTotal[s].ttc, 0),
        count: rest.reduce((a, s) => a + supTotal[s].count, 0),
      });
    }
    return rows;
  }, [suppliers, supTotal]);

  // Empilement mensuel : une série par fournisseur du top, plus « Autres ».
  // Les clés sont indexées (s0, s1…) pour ne pas entrer en collision avec un
  // nom de fournisseur qui vaudrait « total » ou « ym ».
  const stack = useMemo(() => {
    const top = suppliers.slice(0, TOP_STACK);
    const rest = suppliers.slice(TOP_STACK);
    const series = top.map((name, i) => ({ key: `s${i}`, name, color: SERIES_COLORS[i] }));
    if (rest.length) series.push({ key: 'other', name: `Autres (${rest.length})`, color: OTHER_COLOR, isOther: true });
    const data = months.map(ym => {
      const row = { ym, label: monthLabel(ym), total: monthTotal[ym].ht };
      top.forEach((name, i) => { row[`s${i}`] = cell[name + '||' + ym]?.ht || 0; });
      if (rest.length) row.other = rest.reduce((a, name) => a + (cell[name + '||' + ym]?.ht || 0), 0);
      return row;
    });
    return { series, data };
  }, [suppliers, months, cell, monthTotal]);

  // On n'estompe les courbes que si la sélection courante y est représentée.
  const selInChart = !!sel && stack.series.some(s => !s.isOther && s.name === sel.supplier);

  const selOrders = useMemo(() => {
    if (!sel) return [];
    return filtered
      .filter(o => o.supplier_name === sel.supplier && o.order_date.slice(0, 7) === sel.month)
      .sort((a, b) => (a.order_date < b.order_date ? 1 : -1));
  }, [sel, filtered]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.grisM }}>Chargement des achats BMS…</div>;
  if (error) return <div style={{ padding: 20, color: '#b91c1c', background: '#fef2f2', borderRadius: 10 }}>{error}</div>;

  const th = { padding: '10px 12px', fontSize: 11, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.03em', position: 'sticky', top: 0, background: C.grisTL, whiteSpace: 'nowrap' };
  const cellStyle = { padding: '8px 12px', borderBottom: `1px solid ${C.grisTL}`, fontSize: 12.5, whiteSpace: 'nowrap' };

  return (
    <div>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.grisTF }}>Dépenses par fournisseur</div>
          <div style={{ fontSize: 12, color: C.grisM, marginTop: 2 }}>
            Bons de commande BMS « complète » + « vérifiée », regroupés par mois (date de commande)
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={year} onChange={e => { setYear(e.target.value); setSel(null); }}
            style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.grisCL}`, fontSize: 13, color: C.grisTF, cursor: 'pointer' }}>
            <option value="all">Toutes les années</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => fetchData(true)} disabled={refreshing}
            style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            {refreshing ? 'Actualisation…' : '↻ Actualiser'}
          </button>
        </div>
      </div>

      {/* Total global */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total HT" value={eur(grand.ht)} color={C.saphir} />
        <StatCard label="Total TTC" value={eur(grand.ttc)} color={C.orange} />
        <StatCard label="Commandes" value={grand.count} color={C.vert} />
        <StatCard label="Fournisseurs" value={suppliers.length} color={C.grisF} />
      </div>

      {/* Graphique 1 — classement des fournisseurs */}
      {suppliers.length > 0 && (
        <ChartCard title="Total HT par fournisseur"
          footer="Montants HT, toutes périodes affichées confondues">
          <ResponsiveContainer width="100%" height={Math.max(180, rankData.length * 30 + 40)}>
            <BarChart data={rankData} layout="vertical" margin={{ top: 4, right: 80, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grisTL} horizontal={false} />
              <XAxis type="number" tickFormatter={eurAxis} stroke={C.grisM} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={170} stroke={C.grisF} fontSize={11.5}
                tickLine={false} axisLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'rgba(19,94,132,0.06)' }} content={<RankTooltip total={grand.ht} />} />
              <Bar dataKey="ht" name="Total HT" fill={BAR_COLOR} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                {rankData.map(r => <Cell key={r.name} fill={r.isOther ? OTHER_COLOR : BAR_COLOR} />)}
                <LabelList dataKey="ht" position="right" formatter={eur0}
                  fill={C.grisF} fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Graphique 2 — évolution mensuelle */}
      {suppliers.length > 0 && months.length > 0 && (
        <ChartCard title="Évolution des dépenses HT par mois"
          footer="Montants HT — cliquez un point pour voir le détail des commandes, ou une entrée de légende pour masquer la courbe">
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={stack.data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grisTL} vertical={false} />
              <XAxis dataKey="label" stroke={C.grisM} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={eurAxis} stroke={C.grisM} fontSize={11} tickLine={false} axisLine={false} width={62} />
              <Tooltip content={<MonthTooltip />} />
              <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 11.5, paddingTop: 6, cursor: 'pointer' }}
                onClick={(e) => {
                  const key = e?.dataKey;
                  if (!key) return;
                  setHidden(cur => {
                    const next = new Set(cur);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  });
                }} />
              {stack.series.map(s => (
                <Line key={s.key} dataKey={s.key} name={s.name} type="linear"
                  stroke={s.color} strokeWidth={2} dot={false} hide={hidden.has(s.key)}
                  strokeOpacity={selInChart && sel.supplier !== s.name ? 0.22 : 1}
                  isAnimationActive={false}
                  activeDot={{
                    r: 5, strokeWidth: 2, stroke: C.blanc, cursor: s.isOther ? 'default' : 'pointer',
                    onClick: (_, e) => {
                      if (s.isOther) return;
                      const ym = e?.payload?.ym ?? e?.payload?.payload?.ym;
                      if (!ym) return;
                      setSel(cur => (cur && cur.supplier === s.name && cur.month === ym) ? null : { supplier: s.name, month: ym });
                    },
                  }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {suppliers.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.grisM, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}` }}>
          Aucune commande complète et vérifiée sur cette période.
        </div>
      ) : (
        <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', left: 0, zIndex: 2 }}>Fournisseur</th>
                  {months.map(ym => <th key={ym} style={{ ...th, textAlign: 'right' }}>{monthLabel(ym)}</th>)}
                  <th style={{ ...th, textAlign: 'right', background: '#EAF0F4' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(sup => (
                  <tr key={sup}>
                    <td style={{ ...cellStyle, fontWeight: 700, color: C.grisTF, position: 'sticky', left: 0, background: C.blanc }}>{sup}</td>
                    {months.map(ym => {
                      const c = cell[sup + '||' + ym];
                      const isSel = sel && sel.supplier === sup && sel.month === ym;
                      return (
                        <td key={ym}
                          onClick={() => c && setSel(isSel ? null : { supplier: sup, month: ym })}
                          style={{ ...cellStyle, textAlign: 'right', cursor: c ? 'pointer' : 'default', background: isSel ? '#E3F0FF' : 'transparent' }}>
                          {c ? (
                            <>
                              <div style={{ fontWeight: 700, color: C.grisTF }}>{eur0(c.ht)}</div>
                              <div style={{ fontSize: 11, color: C.grisM }}>{eur0(c.ttc)} TTC</div>
                            </>
                          ) : <span style={{ color: C.grisCL }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ ...cellStyle, textAlign: 'right', background: '#F4F8FB' }}>
                      <div style={{ fontWeight: 800, color: C.saphir }}>{eur0(supTotal[sup].ht)}</div>
                      <div style={{ fontSize: 11, color: C.grisM }}>{eur0(supTotal[sup].ttc)} TTC</div>
                    </td>
                  </tr>
                ))}
                {/* Ligne total par mois */}
                <tr>
                  <td style={{ ...cellStyle, fontWeight: 800, color: C.grisTF, position: 'sticky', left: 0, background: '#EAF0F4' }}>Total</td>
                  {months.map(ym => (
                    <td key={ym} style={{ ...cellStyle, textAlign: 'right', background: '#EAF0F4' }}>
                      <div style={{ fontWeight: 800, color: C.grisTF }}>{eur0(monthTotal[ym].ht)}</div>
                      <div style={{ fontSize: 11, color: C.grisM }}>{eur0(monthTotal[ym].ttc)} TTC</div>
                    </td>
                  ))}
                  <td style={{ ...cellStyle, textAlign: 'right', background: '#DCE7EE' }}>
                    <div style={{ fontWeight: 800, color: C.saphir }}>{eur0(grand.ht)}</div>
                    <div style={{ fontSize: 11, color: C.grisM }}>{eur0(grand.ttc)} TTC</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Détail des commandes d'une cellule */}
      {sel && (
        <div style={{ marginTop: 18, background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.grisTL}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.grisTF }}>
              {sel.supplier} — {monthLabel(sel.month)}
            </div>
            <span style={{ fontSize: 12, color: C.grisM }}>{selOrders.length} commande{selOrders.length > 1 ? 's' : ''}</span>
            <button onClick={() => setSel(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.grisM, cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Référence BMS</th>
                <th style={{ ...th, textAlign: 'left' }}>Date</th>
                <th style={{ ...th, textAlign: 'right' }}>HT</th>
                <th style={{ ...th, textAlign: 'right' }}>TTC</th>
              </tr>
            </thead>
            <tbody>
              {selOrders.map(o => (
                <tr key={o.id}>
                  <td style={{ ...cellStyle, fontWeight: 700 }}>
                    {o.bms_url ? (
                      <a href={o.bms_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: C.saphir, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                        title="Ouvrir la commande (et sa facture) dans BMS">
                        {o.reference || `#${o.id}`}<span style={{ fontSize: 11 }}>↗</span>
                      </a>
                    ) : (
                      <span style={{ color: C.saphir }}>{o.reference || `#${o.id}`}</span>
                    )}
                  </td>
                  <td style={cellStyle}>{fmtDate(o.order_date)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 700 }}>{eur(o.ht)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', color: C.grisF }}>{eur(o.ttc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TIP_BOX = {
  background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
  padding: '10px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.08)', fontSize: 12, minWidth: 190,
};

function RankTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const part = total ? (d.ht / total) * 100 : 0;
  return (
    <div style={TIP_BOX}>
      <div style={{ fontWeight: 800, color: C.grisTF, marginBottom: 6 }}>{d.name}</div>
      <TipRow label="HT" value={eur(d.ht)} strong />
      <TipRow label="TTC" value={eur(d.ttc)} />
      <TipRow label="Commandes" value={d.count} />
      <TipRow label="Part des achats" value={`${part.toFixed(1)} %`} />
    </div>
  );
}

function MonthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter(p => p.value > 0).slice().sort((a, b) => b.value - a.value);
  if (!rows.length) return null;
  const total = rows.reduce((a, p) => a + p.value, 0);
  return (
    <div style={TIP_BOX}>
      <div style={{ fontWeight: 800, color: C.grisTF, marginBottom: 6 }}>{label}</div>
      {rows.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flex: '0 0 auto' }} />
          <span style={{ color: C.grisF, flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: C.grisTF }}>{eur0(p.value)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.grisTL}` }}>
        <span style={{ color: C.grisF, flex: 1, fontWeight: 700 }}>Total</span>
        <span style={{ fontWeight: 800, color: C.saphir }}>{eur0(total)}</span>
      </div>
    </div>
  );
}

function TipRow({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '2px 0' }}>
      <span style={{ color: C.grisF, flex: 1 }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 700, color: strong ? C.saphir : C.grisTF }}>{value}</span>
    </div>
  );
}

function ChartCard({ title, footer, children }) {
  return (
    <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, padding: '16px 18px 10px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.grisTF, marginBottom: 10 }}>{title}</div>
      {children}
      <div style={{ fontSize: 11, color: C.grisM, marginTop: 2 }}>{footer}</div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, borderTop: `3px solid ${color}`, padding: '14px 18px', minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.grisTF, marginTop: 4 }}>{value}</div>
    </div>
  );
}
