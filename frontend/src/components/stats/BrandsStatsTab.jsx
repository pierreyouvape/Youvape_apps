import { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatPriceEur } from '../../utils/formatNumber';
import { AuthContext } from '../../context/AuthContext';
import { useColumnPreferences } from '../../hooks/useColumnPreferences';
import ColumnPanel from '../ColumnPanel';
import { LinkBox } from '../../utils/navHelpers';
import PeriodFilter, { computeDateRange, dateParams } from './PeriodFilter';
import { CategoryScopeSelect, useCatalogOptions, scopeToParams, scopeLabel } from './ScopeFilter';
import MonthlyPivotTable from './MonthlyPivotTable';

const API_BASE_URL = '/api';

// Sans aucune vente sur la période : ligne masquée (n'apporte rien)
const hasSales = (row) => parseFloat(row.ca_ttc || 0) !== 0 || (parseInt(row.qty_sold) || 0) !== 0;

// Répartition France / autres pays (pays de livraison), en TTC
const withCountrySplit = (row) => {
  const ca = parseFloat(row.ca_ttc || 0);
  const fr = parseFloat(row.ca_ttc_fr || 0);
  return { ...row, ca_fr: fr, ca_abroad: ca - fr, abroad_percent: ca > 0 ? ((ca - fr) / ca) * 100 : null };
};

const BRANDS_COLUMNS = [
  { key: 'product_count',  label: 'Produits' },
  { key: 'sub_brand_count',label: 'Sous-marques' },
  { key: 'qty_sold',       label: 'Qte Vendue' },
  { key: 'ca_ttc',         label: 'CA TTC' },
  { key: 'ca_ht',          label: 'CA HT' },
  { key: 'cost_ht',        label: 'Cout HT' },
  { key: 'margin_ht',      label: 'Marge HT' },
  { key: 'margin_percent', label: '% Marge' },
  { key: 'ca_fr',          label: 'CA France TTC' },
  { key: 'ca_abroad',      label: 'CA hors France TTC' },
  { key: 'abroad_percent', label: '% hors France' },
];

const BrandsStatsTab = () => {
  const { token } = useContext(AuthContext);
  const { isVisible, compact, showColumnPanel, setShowColumnPanel, toggleColumn, toggleCompact } = useColumnPreferences('brands', token);
  const navigate = useNavigate();
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedBrandName, setExpandedBrandName] = useState(null);
  const [subBrands, setSubBrands] = useState({});
  const [sortBy, setSortBy] = useState('ca_ttc');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('totals'); // 'totals' | 'monthly'
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [scope, setScope] = useState('');
  const scopeOptions = useCatalogOptions();

  const dateRange = useMemo(() => computeDateRange(period, customStart, customEnd), [period, customStart, customEnd]);
  // Mêmes params pour la liste, la vue par mois et le dépliage des sous-marques
  const queryParams = useMemo(() => ({ ...dateParams(dateRange), ...scopeToParams(scope) }), [dateRange, scope]);

  useEffect(() => {
    // Les sous-marques déjà chargées l'ont été pour l'ancien périmètre
    setSubBrands({});
    setExpandedBrandName(null);
    if (view === 'monthly') fetchMonthly();
    else fetchBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dateRange.dateFrom, dateRange.dateTo, scope]);

  const fetchMonthly = async () => {
    setMonthlyLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/brands/monthly`, { params: queryParams });
      if (response.data.success) {
        setMonthlyRows(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching monthly brands:', error);
    } finally {
      setMonthlyLoading(false);
    }
  };

  const fetchBrands = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/brands`, { params: queryParams });
      if (response.data.success) {
        setBrands(response.data.data.map(withCountrySplit));
      }
    } catch (error) {
      console.error('Error fetching brands:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubBrands = async (brandName) => {
    if (subBrands[brandName]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/brands/${encodeURIComponent(brandName)}`, { params: queryParams });
      if (response.data.success) {
        setSubBrands(prev => ({
          ...prev,
          [brandName]: (response.data.data.sub_brands || []).map(withCountrySplit)
        }));
      }
    } catch (error) {
      console.error('Error fetching sub-brands:', error);
    }
  };

  const handleRowClick = (brand) => {
    if (brand.sub_brand_count > 0) {
      if (expandedBrandName === brand.brand) {
        setExpandedBrandName(null);
      } else {
        setExpandedBrandName(brand.brand);
        fetchSubBrands(brand.brand);
      }
    }
  };

  const handleBrandNameClick = (e, brandName) => {
    e.stopPropagation();
    navigate(`/brands/${encodeURIComponent(brandName)}`);
  };

  const handleSubBrandNameClick = (e, subBrandName) => {
    e.stopPropagation();
    navigate(`/sub-brands/${encodeURIComponent(subBrandName)}`);
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(column);
      setSortOrder('DESC');
    }
  };

  // Filtrer par recherche
  const withSales = brands.filter(hasSales);
  const filteredBrands = withSales.filter(b => {
    if (!searchTerm) return true;
    const normalize = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = normalize(searchTerm).split(/\s+/).filter(Boolean);
    const haystack = normalize(b.brand);
    return words.every(w => haystack.includes(w));
  });

  const sortedBrands = [...filteredBrands].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'brand') {
      aVal = aVal?.toLowerCase() || '';
      bVal = bVal?.toLowerCase() || '';
    } else {
      aVal = parseFloat(aVal) || 0;
      bVal = parseFloat(bVal) || 0;
    }

    if (sortOrder === 'ASC') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  const handleExport = () => {
    const csv = [
      ...(scope ? [[`Perimetre : ${scopeLabel(scope)}`]] : []),
      ['Marque', 'Nb Produits', 'Nb Sous-marques', 'Qte Vendue', 'CA TTC', 'CA HT', 'Cout HT', 'Marge HT', '% Marge', 'CA France TTC', 'CA hors France TTC', '% hors France'],
      ...sortedBrands.map(b => [
        b.brand || '',
        b.product_count || 0,
        b.sub_brand_count || 0,
        b.qty_sold || 0,
        parseFloat(b.ca_ttc || 0).toFixed(2),
        parseFloat(b.ca_ht || 0).toFixed(2),
        parseFloat(b.cost_ht || 0).toFixed(2),
        parseFloat(b.margin_ht || 0).toFixed(2),
        parseFloat(b.margin_percent || 0).toFixed(1),
        parseFloat(b.ca_fr || 0).toFixed(2),
        parseFloat(b.ca_abroad || 0).toFixed(2),
        b.abroad_percent === null ? '' : b.abroad_percent.toFixed(1)
      ])
    ].map(row => row.join(';')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    const scopeSlug = scope ? '_' + scopeLabel(scope).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
    link.download = `marques_stats${scopeSlug}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const formatPrice = (price) => formatPriceEur(price);
  const formatPercent = (percent) => parseFloat(percent || 0).toFixed(1) + '%';
  const formatNumber = (num) => new Intl.NumberFormat('fr-FR').format(num || 0);

  const getSortIcon = (column) => {
    if (sortBy !== column) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  };

  const headerStyle = (column) => ({
    padding: '15px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#8A99A4',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: sortBy === column ? '#e9ecef' : '#F2F6F8',
    transition: 'background-color 0.2s'
  });

  // Calcul des totaux (sur les marques filtrées)
  const totals = filteredBrands.reduce((acc, b) => ({
    product_count: acc.product_count + (b.product_count || 0),
    sub_brand_count: acc.sub_brand_count + (b.sub_brand_count || 0),
    qty_sold: acc.qty_sold + (b.qty_sold || 0),
    ca_ttc: acc.ca_ttc + parseFloat(b.ca_ttc || 0),
    ca_fr: acc.ca_fr + (b.ca_fr || 0),
    margin_ht: acc.margin_ht + parseFloat(b.margin_ht || 0)
  }), { product_count: 0, sub_brand_count: 0, qty_sold: 0, ca_ttc: 0, ca_fr: 0, margin_ht: 0 });

  return (
    <div style={compact ? { maxWidth: '1400px', margin: '0 auto' } : {}}>
      {/* Header avec recherche et bouton export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher une marque..."
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px',
              flex: 1,
              minWidth: '250px',
              maxWidth: '400px'
            }}
          />
          <PeriodFilter
            period={period}
            setPeriod={setPeriod}
            customStart={customStart}
            setCustomStart={setCustomStart}
            customEnd={customEnd}
            setCustomEnd={setCustomEnd}
          />
          <CategoryScopeSelect scope={scope} setScope={setScope} options={scopeOptions} />
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: '6px', overflow: 'hidden' }}>
            {[{ id: 'totals', label: 'Totaux' }, { id: 'monthly', label: 'Par mois' }].map(v => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                style={{
                  padding: '8px 14px', border: 'none', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                  backgroundColor: view === v.id ? '#135E84' : '#fff',
                  color: view === v.id ? '#fff' : '#374151'
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'totals' && (<>
          <button
            onClick={handleExport}
            style={{
              padding: '6px 12px',
              backgroundColor: '#8A99A4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            CSV
          </button>
          <ColumnPanel
            columns={BRANDS_COLUMNS}
            isVisible={isVisible}
            toggleColumn={toggleColumn}
            compact={compact}
            toggleCompact={toggleCompact}
            show={showColumnPanel}
            setShow={setShowColumnPanel}
          />
          </>)}
        </div>
      </div>

      {view === 'monthly' ? (
        monthlyLoading ? (
          <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
        ) : (
          <MonthlyPivotTable
            rows={monthlyRows}
            groupKey="brand"
            groupLabel="Marque"
            linkPrefix="/brands/"
            dateRange={dateRange}
            searchTerm={searchTerm}
            exportName="marques"
          />
        )
      ) : (<>
      {/* Cards de statistiques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '15px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>{scope ? `Marques · ${scopeLabel(scope)}` : 'Marques'}</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{filteredBrands.length}{searchTerm && ` / ${withSales.length}`}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Sous-marques</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{totals.sub_brand_count}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Qte vendue</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#2a2e38', margin: 0 }}>{formatNumber(totals.qty_sold)}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>CA TTC Total</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#4AB866', margin: 0 }}>{formatPrice(totals.ca_ttc)}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Marge HT Totale</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: totals.margin_ht >= 0 ? '#4AB866' : '#DE2020', margin: 0 }}>{formatPrice(totals.margin_ht)}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Part hors France</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#2a2e38', margin: 0 }}>{totals.ca_ttc > 0 ? formatPercent((1 - totals.ca_fr / totals.ca_ttc) * 100) : '–'}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={headerStyle('brand')} onClick={() => handleSort('brand')}>Marque{getSortIcon('brand')}</th>
                  {isVisible('product_count') && <th style={headerStyle('product_count')} onClick={() => handleSort('product_count')}>Produits{getSortIcon('product_count')}</th>}
                  {isVisible('sub_brand_count') && <th style={headerStyle('sub_brand_count')} onClick={() => handleSort('sub_brand_count')}>Sous-marques{getSortIcon('sub_brand_count')}</th>}
                  {isVisible('qty_sold') && <th style={headerStyle('qty_sold')} onClick={() => handleSort('qty_sold')}>Qte Vendue{getSortIcon('qty_sold')}</th>}
                  {isVisible('ca_ttc') && <th style={headerStyle('ca_ttc')} onClick={() => handleSort('ca_ttc')}>CA TTC{getSortIcon('ca_ttc')}</th>}
                  {isVisible('ca_ht') && <th style={headerStyle('ca_ht')} onClick={() => handleSort('ca_ht')}>CA HT{getSortIcon('ca_ht')}</th>}
                  {isVisible('cost_ht') && <th style={headerStyle('cost_ht')} onClick={() => handleSort('cost_ht')}>Cout HT{getSortIcon('cost_ht')}</th>}
                  {isVisible('margin_ht') && <th style={headerStyle('margin_ht')} onClick={() => handleSort('margin_ht')}>Marge HT{getSortIcon('margin_ht')}</th>}
                  {isVisible('margin_percent') && <th style={headerStyle('margin_percent')} onClick={() => handleSort('margin_percent')}>% Marge{getSortIcon('margin_percent')}</th>}
                  {isVisible('ca_fr') && <th style={headerStyle('ca_fr')} onClick={() => handleSort('ca_fr')}>CA France{getSortIcon('ca_fr')}</th>}
                  {isVisible('ca_abroad') && <th style={headerStyle('ca_abroad')} onClick={() => handleSort('ca_abroad')}>CA hors France{getSortIcon('ca_abroad')}</th>}
                  {isVisible('abroad_percent') && <th style={headerStyle('abroad_percent')} onClick={() => handleSort('abroad_percent')} title="Part du CA TTC livrée hors de France">% hors France{getSortIcon('abroad_percent')}</th>}
                </tr>
              </thead>
              <tbody>
                {sortedBrands.map((brand) => {
                  const isExpanded = expandedBrandName === brand.brand;
                  const hasSubBrands = brand.sub_brand_count > 0;
                  const brandSubBrandsLoaded = subBrands[brand.brand] !== undefined;
                  const brandSubBrands = (subBrands[brand.brand] || []).filter(hasSales);

                  return (
                    <>
                      <tr
                        key={brand.brand}
                        onClick={() => handleRowClick(brand)}
                        style={{
                          borderTop: '1px solid #E2E2E2',
                          cursor: hasSubBrands ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#F2F6F8' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasSubBrands) e.currentTarget.style.backgroundColor = '#F2F6F8'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasSubBrands && (
                              <span style={{ color: '#8A99A4', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <LinkBox
                              to={`/brands/${encodeURIComponent(brand.brand)}`}
                              display="inline"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontWeight: 'bold', color: '#135E84' }}
                            >
                              {brand.brand}
                            </LinkBox>
                          </div>
                        </td>
                        {isVisible('product_count') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatNumber(brand.product_count)}</td>}
                        {isVisible('sub_brand_count') && <td style={{ padding: '15px', fontSize: '14px' }}>{brand.sub_brand_count}</td>}
                        {isVisible('qty_sold') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatNumber(brand.qty_sold)}</td>}
                        {isVisible('ca_ttc') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_ttc)}</td>}
                        {isVisible('ca_ht') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_ht)}</td>}
                        {isVisible('cost_ht') && <td style={{ padding: '15px', fontSize: '14px', color: '#DE2020' }}>{formatPrice(brand.cost_ht)}</td>}
                        {isVisible('margin_ht') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: brand.margin_ht >= 0 ? '#4AB866' : '#DE2020' }}>{formatPrice(brand.margin_ht)}</td>}
                        {isVisible('margin_percent') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: brand.margin_percent >= 30 ? '#4AB866' : brand.margin_percent >= 15 ? '#E28F00' : '#DE2020' }}>{formatPercent(brand.margin_percent)}</td>}
                        {isVisible('ca_fr') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_fr)}</td>}
                        {isVisible('ca_abroad') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(brand.ca_abroad)}</td>}
                        {isVisible('abroad_percent') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: brand.abroad_percent > 50 ? '#c2410c' : '#2a2e38' }}>{brand.abroad_percent === null ? '–' : formatPercent(brand.abroad_percent)}</td>}
                      </tr>
                      {isExpanded && brandSubBrands.length > 0 && brandSubBrands.map((sb) => (
                        <tr key={sb.sub_brand} style={{ backgroundColor: '#F2F6F8', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '10px 15px 10px 45px', fontSize: '13px' }}>
                            <LinkBox
                              to={`/sub-brands/${encodeURIComponent(sb.sub_brand)}`}
                              display="inline"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: '#135E84' }}
                            >
                              ↳ {sb.sub_brand}
                            </LinkBox>
                          </td>
                          {isVisible('product_count') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#8A99A4' }}>{formatNumber(sb.product_count)}</td>}
                          {isVisible('sub_brand_count') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#8A99A4' }}>-</td>}
                          {isVisible('qty_sold') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatNumber(sb.qty_sold)}</td>}
                          {isVisible('ca_ttc') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_ttc)}</td>}
                          {isVisible('ca_ht') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_ht)}</td>}
                          {isVisible('cost_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#DE2020' }}>{formatPrice(sb.cost_ht)}</td>}
                          {isVisible('margin_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sb.margin_ht >= 0 ? '#4AB866' : '#DE2020' }}>{formatPrice(sb.margin_ht)}</td>}
                          {isVisible('margin_percent') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sb.margin_percent >= 30 ? '#4AB866' : sb.margin_percent >= 15 ? '#E28F00' : '#DE2020' }}>{formatPercent(sb.margin_percent)}</td>}
                          {isVisible('ca_fr') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_fr)}</td>}
                          {isVisible('ca_abroad') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sb.ca_abroad)}</td>}
                          {isVisible('abroad_percent') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sb.abroad_percent > 50 ? '#c2410c' : '#2a2e38' }}>{sb.abroad_percent === null ? '–' : formatPercent(sb.abroad_percent)}</td>}
                        </tr>
                      ))}
                      {isExpanded && brandSubBrands.length === 0 && (
                        <tr key={`${brand.brand}-loading`} style={{ backgroundColor: '#F2F6F8' }}>
                          <td colSpan={1 + BRANDS_COLUMNS.filter(c => isVisible(c.key)).length} style={{ padding: '15px 45px', fontSize: '13px', color: '#8A99A4' }}>
                            {brandSubBrandsLoaded ? 'Aucune vente sur la période' : 'Chargement des sous-marques...'}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {withSales.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#8A99A4' }}>
              Aucune marque trouvee
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  );
};

export default BrandsStatsTab;
