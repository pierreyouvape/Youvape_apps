import { useMemo, useState } from 'react';
import { formatPriceEur } from '../../utils/formatNumber';
import { LinkBox } from '../../utils/navHelpers';
import { localFmt } from './PeriodFilter';

// Vue « Par mois » : une ligne par groupe (marque, catégorie…), une colonne par mois,
// chaque cellule = valeur du mois + % d'évolution vs le mois précédent,
// puis la répartition France / autres pays (pays de livraison).

const METRICS = [
  { key: 'ca_ttc', label: 'CA TTC', format: (v) => formatPriceEur(v) },
  { key: 'ca_ht', label: 'CA HT', format: (v) => formatPriceEur(v) },
  { key: 'qty_sold', label: 'Qté vendue', format: (v) => new Intl.NumberFormat('fr-FR').format(v || 0) }
];

const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
};

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Mois 'YYYY-MM' continus de from à to (inclus)
const monthRange = (from, to) => {
  const out = [];
  for (let cur = from; cur <= to && out.length < 240; cur = nextMonth(cur)) out.push(cur);
  return out;
};

const lastDayOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return localFmt(new Date(y, m, 0));
};

const evolution = (cur, prev) => {
  if (!prev) return cur > 0 ? { label: 'nouveau', color: '#0d6efd' } : null;
  const pct = ((cur - prev) / prev) * 100;
  return {
    label: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
    color: pct > 0 ? '#28a745' : pct < 0 ? '#dc3545' : '#6c757d'
  };
};

const normalize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MonthlyPivotTable = ({ rows, groupKey, groupLabel, linkPrefix, dateRange, searchTerm, exportName }) => {
  const [metric, setMetric] = useState('ca_ttc');
  const [sortCol, setSortCol] = useState('total');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [showCountry, setShowCountry] = useState(true);

  const metricDef = METRICS.find(m => m.key === metric);

  const { months, groups } = useMemo(() => {
    const byGroup = {};
    let minMonth = null;
    let maxMonth = null;
    for (const r of rows) {
      const g = r[groupKey];
      if (!byGroup[g]) byGroup[g] = {};
      byGroup[g][r.month] = r;
      if (!minMonth || r.month < minMonth) minMonth = r.month;
      if (!maxMonth || r.month > maxMonth) maxMonth = r.month;
    }
    const from = dateRange.dateFrom ? dateRange.dateFrom.slice(0, 7) : minMonth;
    const to = dateRange.dateTo ? dateRange.dateTo.slice(0, 7) : (maxMonth || localFmt(new Date()).slice(0, 7));
    return {
      months: from && to ? monthRange(from, to) : [],
      groups: Object.entries(byGroup).map(([name, byMonth]) => ({ name, byMonth }))
    };
  }, [rows, groupKey, dateRange.dateFrom, dateRange.dateTo]);

  // Mois incomplets : premier mois démarré en cours de route, mois en cours / dernier mois tronqué
  const today = localFmt(new Date());
  const isPartial = (ym) => {
    const first = `${ym}-01`;
    const last = lastDayOfMonth(ym);
    if (dateRange.dateFrom && dateRange.dateFrom > first) return true;
    const end = dateRange.dateTo && dateRange.dateTo < today ? dateRange.dateTo : today;
    return end < last;
  };

  const value = (g, ym) => parseFloat(g.byMonth[ym]?.[metric] || 0);
  const valueFr = (g, ym) => parseFloat(g.byMonth[ym]?.[`${metric}_fr`] || 0);
  const shareAbroad = (total, fr) => (total > 0 ? ((total - fr) / total) * 100 : null);

  const tableRows = useMemo(() => {
    const words = normalize(searchTerm).split(/\s+/).filter(Boolean);
    const filtered = groups
      .filter(g => words.every(w => normalize(g.name).includes(w)))
      .map(g => {
        const total = months.reduce((s, ym) => s + value(g, ym), 0);
        const totalFr = months.reduce((s, ym) => s + valueFr(g, ym), 0);
        return { ...g, total, totalFr, abroad: shareAbroad(total, totalFr) };
      });
    const dir = sortOrder === 'ASC' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortCol === 'name') return dir * a.name.localeCompare(b.name, 'fr');
      if (sortCol === 'abroad') return dir * ((a.abroad ?? -1) - (b.abroad ?? -1));
      const av = sortCol === 'total' ? a.total : value(a, sortCol);
      const bv = sortCol === 'total' ? b.total : value(b, sortCol);
      return dir * (av - bv);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, months, metric, searchTerm, sortCol, sortOrder]);

  const monthTotals = months.map(ym => tableRows.reduce((s, g) => s + value(g, ym), 0));
  const monthTotalsFr = months.map(ym => tableRows.reduce((s, g) => s + valueFr(g, ym), 0));
  const grandTotal = monthTotals.reduce((s, v) => s + v, 0);
  const grandTotalFr = monthTotalsFr.reduce((s, v) => s + v, 0);

  const handleSort = (col) => {
    if (sortCol === col) setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    else { setSortCol(col); setSortOrder(col === 'name' ? 'ASC' : 'DESC'); }
  };
  const sortIcon = (col) => (sortCol === col ? (sortOrder === 'ASC' ? ' ▲' : ' ▼') : '');

  const handleExport = () => {
    const header = [groupLabel];
    months.forEach(ym => {
      header.push(`${monthLabel(ym)} ${metricDef.label}`, `${monthLabel(ym)} évol. %`, `${monthLabel(ym)} FR`, `${monthLabel(ym)} Autres pays`);
    });
    header.push(`Total ${metricDef.label}`, 'Total FR', 'Total Autres pays', '% hors FR');
    const lines = tableRows.map(g => {
      const line = [g.name];
      months.forEach((ym, i) => {
        const cur = value(g, ym);
        const prev = i > 0 ? value(g, months[i - 1]) : null;
        line.push(cur.toFixed(2).replace('.', ','));
        line.push(prev ? (((cur - prev) / prev) * 100).toFixed(1).replace('.', ',') : '');
        const fr = valueFr(g, ym);
        line.push(fr.toFixed(2).replace('.', ','), (cur - fr).toFixed(2).replace('.', ','));
      });
      line.push(g.total.toFixed(2).replace('.', ','), g.totalFr.toFixed(2).replace('.', ','), (g.total - g.totalFr).toFixed(2).replace('.', ','));
      line.push(g.abroad === null ? '' : g.abroad.toFixed(1).replace('.', ','));
      return line;
    });
    const csv = [header, ...lines].map(row => row.join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportName}_mensuel_${metric}_${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const th = (col, extra = {}) => ({
    padding: '12px 14px',
    textAlign: 'right',
    fontSize: '12px',
    fontWeight: 600,
    color: '#6c757d',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    backgroundColor: sortCol === col ? '#e9ecef' : '#f8f9fa',
    ...extra
  });
  const stickyCell = { position: 'sticky', left: 0, zIndex: 1, textAlign: 'left', minWidth: '180px', borderRight: '1px solid #dee2e6' };

  // Lignes « FR » / « Autres pays » sous la valeur, avec leur part du total de la cellule
  const renderCountry = (cur, fr) => {
    if (!showCountry || !cur) return null;
    const other = cur - fr;
    const pct = (v) => `${Math.round((v / cur) * 100)}%`;
    const line = (label, v, highlight) => (
      <div style={{ fontSize: '11px', color: highlight ? '#c2410c' : '#6c757d', fontWeight: highlight ? 600 : 400 }}>
        {label} {metricDef.format(v)} <span style={{ opacity: 0.8 }}>· {pct(v)}</span>
      </div>
    );
    return (
      <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed #e5e7eb' }}>
        {line('FR', fr, false)}
        {line('Autres', other, other > fr)}
      </div>
    );
  };

  const renderCell = (cur, prev, fr, key, bold = false) => {
    const evo = prev === null ? null : evolution(cur, prev);
    return (
      <td key={key} style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: '14px', verticalAlign: 'top' }}>
        <div style={{ fontWeight: bold ? 700 : 400, color: cur ? '#333' : '#adb5bd' }}>{metricDef.format(cur)}</div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: evo ? evo.color : '#adb5bd', minHeight: '14px' }}>
          {evo ? evo.label : (prev === null ? '' : '–')}
        </div>
        {renderCountry(cur, fr)}
      </td>
    );
  };

  const renderTotalCells = (total, totalFr) => {
    const abroad = shareAbroad(total, totalFr);
    return (<>
      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 700, borderLeft: '1px solid #dee2e6', verticalAlign: 'top' }}>
        {metricDef.format(total)}
        <div style={{ minHeight: '14px' }} />
        {renderCountry(total, totalFr)}
      </td>
      <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 700, verticalAlign: 'top', color: abroad === null ? '#adb5bd' : abroad > 50 ? '#c2410c' : '#333' }}>
        {abroad === null ? '–' : `${abroad.toFixed(1)}%`}
      </td>
    </>);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                padding: '7px 14px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                border: '1px solid #d1d5db',
                backgroundColor: metric === m.key ? '#135E84' : '#fff',
                color: metric === m.key ? '#fff' : '#374151'
              }}
            >
              {m.label}
            </button>
          ))}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', marginLeft: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCountry} onChange={(e) => setShowCountry(e.target.checked)} />
            Détail France / autres pays
          </label>
        </div>
        <button
          onClick={handleExport}
          style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
        >
          CSV
        </button>
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th('name', stickyCell)} onClick={() => handleSort('name')}>{groupLabel}{sortIcon('name')}</th>
                {months.map(ym => (
                  <th key={ym} style={th(ym)} onClick={() => handleSort(ym)} title={isPartial(ym) ? 'Mois incomplet sur la période choisie' : ''}>
                    {monthLabel(ym)}{isPartial(ym) ? '*' : ''}{sortIcon(ym)}
                  </th>
                ))}
                <th style={th('total', { borderLeft: '1px solid #dee2e6' })} onClick={() => handleSort('total')}>Total{sortIcon('total')}</th>
                <th style={th('abroad')} onClick={() => handleSort('abroad')} title="Part du total réalisée hors de France (pays de livraison)">% hors FR{sortIcon('abroad')}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(g => (
                <tr key={g.name} style={{ borderTop: '1px solid #dee2e6' }}>
                  <td style={{ ...stickyCell, padding: '10px 14px', fontSize: '14px', backgroundColor: 'white', verticalAlign: 'top' }}>
                    <LinkBox to={`${linkPrefix}${encodeURIComponent(g.name)}`} display="inline" style={{ fontWeight: 'bold', color: '#007bff' }}>
                      {g.name}
                    </LinkBox>
                  </td>
                  {months.map((ym, i) => renderCell(value(g, ym), i > 0 ? value(g, months[i - 1]) : null, valueFr(g, ym), ym))}
                  {renderTotalCells(g.total, g.totalFr)}
                </tr>
              ))}
              {tableRows.length > 0 && (
                <tr style={{ borderTop: '2px solid #adb5bd', backgroundColor: '#f8f9fa' }}>
                  <td style={{ ...stickyCell, padding: '10px 14px', fontSize: '14px', fontWeight: 700, backgroundColor: '#f8f9fa', verticalAlign: 'top' }}>
                    Total ({tableRows.length})
                  </td>
                  {months.map((ym, i) => renderCell(monthTotals[i], i > 0 ? monthTotals[i - 1] : null, monthTotalsFr[i], ym, true))}
                  {renderTotalCells(grandTotal, grandTotalFr)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {tableRows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>Aucune vente sur la période</div>
        )}
      </div>
      <p style={{ fontSize: '12px', color: '#6c757d', marginTop: '10px' }}>
        % = évolution par rapport au mois précédent. FR / Autres = pays de livraison (à défaut, de facturation), avec leur part du mois ; en orange quand l'étranger dépasse la France. * mois incomplet sur la période choisie (ex. mois en cours) : son évolution n'est pas comparable à un mois entier.
      </p>
    </div>
  );
};

export default MonthlyPivotTable;
