import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const C = {
  orange: '#E28F00', saphir: '#135E84', saphirF: '#003A56',
  grisCL: '#E2E2E2', grisTL: '#F2F6F8', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#FFFFFF', vert: '#4AB866',
};

// Intl utilise une espace fine insécable (U+202F) comme séparateur de milliers,
// peu lisible -> on la remplace par une espace normale.
const NBSP = /[\u202f\u00a0]/g;
const eur = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0).replace(NBSP, ' ') + ' €';
const eur0 = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0).replace(NBSP, ' ') + ' €';
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS_FR[parseInt(m) - 1]} ${y.slice(2)}`; };
const fmtDate = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';

export default function SpendingTab({ token }) {
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [year, setYear] = useState('all');
  const [sel, setSel] = useState(null); // { supplier, month }

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

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`, borderTop: `3px solid ${color}`, padding: '14px 18px', minWidth: 150 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.grisTF, marginTop: 4 }}>{value}</div>
    </div>
  );
}
