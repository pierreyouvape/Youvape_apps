import { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatPriceEur } from '../../utils/formatNumber';
import { AuthContext } from '../../context/AuthContext';
import { useColumnPreferences } from '../../hooks/useColumnPreferences';
import ColumnPanel from '../ColumnPanel';
import { LinkBox } from '../../utils/navHelpers';
import PeriodFilter, { computeDateRange, dateParams } from './PeriodFilter';
import { BrandScopeSelect, useCatalogOptions, scopeToParams } from './ScopeFilter';
import ProductSegmentBuilder from './ProductSegmentBuilder';
import { CATEGORY_FILTER_FIELDS } from './segmentFields';
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

const CATEGORIES_COLUMNS = [
  { key: 'product_count',      label: 'Produits' },
  { key: 'sub_category_count', label: 'Sous-cat.' },
  { key: 'qty_sold',           label: 'Qte Vendue' },
  { key: 'ca_ttc',             label: 'CA TTC' },
  { key: 'ca_ht',              label: 'CA HT' },
  { key: 'cost_ht',            label: 'Cout HT' },
  { key: 'margin_ht',          label: 'Marge HT' },
  { key: 'margin_percent',     label: '% Marge' },
  { key: 'ca_fr',          label: 'CA France TTC' },
  { key: 'ca_abroad',      label: 'CA hors France TTC' },
  { key: 'abroad_percent', label: '% hors France' },
];

const CategoriesStatsTab = () => {
  const { token } = useContext(AuthContext);
  const { isVisible, compact, showColumnPanel, setShowColumnPanel, toggleColumn, toggleCompact } = useColumnPreferences('categories', token);
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedCategoryName, setExpandedCategoryName] = useState(null);
  const [subCategories, setSubCategories] = useState({});
  const [sortBy, setSortBy] = useState('ca_ttc');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('totals'); // 'totals' | 'monthly'
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [scope, setScope] = useState('');          // marque / sous-marque
  const scopeOptions = useCatalogOptions();
  // Filtres produits : brouillon (édité) vs appliqué (utilisé pour le fetch)
  const [showBuilder, setShowBuilder] = useState(false);
  const [filters, setFilters] = useState([]);
  const [matchType, setMatchType] = useState('all');
  const [appliedFilters, setAppliedFilters] = useState([]);
  const [appliedMatchType, setAppliedMatchType] = useState('all');

  const dateRange = useMemo(() => computeDateRange(period, customStart, customEnd), [period, customStart, customEnd]);

  // Mêmes paramètres pour la liste, la vue par mois et le dépliage
  const queryParams = useMemo(() => {
    const p = { ...dateParams(dateRange), ...scopeToParams(scope) };
    if (appliedFilters.length > 0) {
      p.filters = JSON.stringify(appliedFilters);
      p.matchType = appliedMatchType;
    }
    return p;
  }, [dateRange, scope, appliedFilters, appliedMatchType]);

  const filterKey = JSON.stringify(queryParams);
  const hasActiveFilters = appliedFilters.length > 0;

  useEffect(() => {
    // Les sous-catégories déjà chargées l'ont été pour l'ancien périmètre
    setSubCategories({});
    setExpandedCategoryName(null);
    if (view === 'monthly') fetchMonthly();
    else fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filterKey]);

  const fetchMonthly = async () => {
    setMonthlyLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/categories/monthly`, { params: queryParams });
      if (response.data.success) {
        setMonthlyRows(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching monthly categories:', error);
    } finally {
      setMonthlyLoading(false);
    }
  };

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/categories`, { params: queryParams });
      if (response.data.success) {
        setCategories(response.data.data.map(withCountrySplit));
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubCategories = async (categoryName) => {
    if (subCategories[categoryName]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/categories/${encodeURIComponent(categoryName)}`, { params: queryParams });
      if (response.data.success) {
        setSubCategories(prev => ({
          ...prev,
          [categoryName]: (response.data.data.sub_categories || []).map(withCountrySplit)
        }));
      }
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
  };

  const handleRowClick = (category) => {
    if (category.sub_category_count > 0) {
      if (expandedCategoryName === category.category) {
        setExpandedCategoryName(null);
      } else {
        setExpandedCategoryName(category.category);
        fetchSubCategories(category.category);
      }
    }
  };

  const handleCategoryNameClick = (e, categoryName) => {
    e.stopPropagation();
    navigate(`/categories/${encodeURIComponent(categoryName)}`);
  };

  const handleSubCategoryNameClick = (e, subCategoryName) => {
    e.stopPropagation();
    navigate(`/sub-categories/${encodeURIComponent(subCategoryName)}`);
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
  const withSales = categories.filter(hasSales);
  const filteredCategories = withSales.filter(c => {
    if (!searchTerm) return true;
    const normalize = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = normalize(searchTerm).split(/\s+/).filter(Boolean);
    const haystack = normalize(c.category);
    return words.every(w => haystack.includes(w));
  });

  const sortedCategories = [...filteredCategories].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];

    if (sortBy === 'category') {
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
      ['Categorie', 'Nb Produits', 'Nb Sous-categories', 'Qte Vendue', 'CA TTC', 'CA HT', 'Cout HT', 'Marge HT', '% Marge', 'CA France TTC', 'CA hors France TTC', '% hors France'],
      ...sortedCategories.map(c => [
        c.category || '',
        c.product_count || 0,
        c.sub_category_count || 0,
        c.qty_sold || 0,
        parseFloat(c.ca_ttc || 0).toFixed(2),
        parseFloat(c.ca_ht || 0).toFixed(2),
        parseFloat(c.cost_ht || 0).toFixed(2),
        parseFloat(c.margin_ht || 0).toFixed(2),
        parseFloat(c.margin_percent || 0).toFixed(1),
        parseFloat(c.ca_fr || 0).toFixed(2),
        parseFloat(c.ca_abroad || 0).toFixed(2),
        c.abroad_percent === null ? '' : c.abroad_percent.toFixed(1)
      ])
    ].map(row => row.join(';')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `categories_stats_${new Date().toISOString().split('T')[0]}.csv`;
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

  // Calcul des totaux (sur les categories filtrees)
  const totals = filteredCategories.reduce((acc, c) => ({
    product_count: acc.product_count + (c.product_count || 0),
    sub_category_count: acc.sub_category_count + (c.sub_category_count || 0),
    qty_sold: acc.qty_sold + (c.qty_sold || 0),
    ca_ttc: acc.ca_ttc + parseFloat(c.ca_ttc || 0),
    ca_fr: acc.ca_fr + (c.ca_fr || 0),
    margin_ht: acc.margin_ht + parseFloat(c.margin_ht || 0)
  }), { product_count: 0, sub_category_count: 0, qty_sold: 0, ca_ttc: 0, ca_fr: 0, margin_ht: 0 });

  return (
    <div style={compact ? { maxWidth: '1400px', margin: '0 auto' } : {}}>
      {/* Header avec recherche et bouton export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', flex: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher une categorie..."
            list="yv-categories-list"
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
          <datalist id="yv-categories-list">
            {[...new Set(categories.map((r) => r.category).filter(Boolean))].sort().map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <PeriodFilter
            period={period}
            setPeriod={setPeriod}
            customStart={customStart}
            setCustomStart={setCustomStart}
            customEnd={customEnd}
            setCustomEnd={setCustomEnd}
          />
          <BrandScopeSelect scope={scope} setScope={setScope} options={scopeOptions} />
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setShowBuilder(v => !v)}
            style={{
              padding: '8px 14px', backgroundColor: (showBuilder || hasActiveFilters) ? '#135E84' : '#fff',
              color: (showBuilder || hasActiveFilters) ? '#fff' : '#374151', border: '1px solid #d1d5db',
              borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600
            }}
          >
            🎯 Filtres{hasActiveFilters ? ` (${appliedFilters.length})` : ''}
          </button>
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
            columns={CATEGORIES_COLUMNS}
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

      {/* Filtres produits : restreignent les produits qui alimentent chaque catégorie */}
      {showBuilder && (
        <ProductSegmentBuilder
          filters={filters}
          matchType={matchType}
          onFiltersChange={setFilters}
          onMatchTypeChange={setMatchType}
          onApply={() => { setAppliedFilters(filters); setAppliedMatchType(matchType); }}
          onClear={() => { setFilters([]); setMatchType('all'); setAppliedFilters([]); setAppliedMatchType('all'); }}
          onLoadSegment={() => {}}
          fields={CATEGORY_FILTER_FIELDS}
          showSegments={false}
          emptyHint="Aucun filtre — chaque catégorie compte tous ses produits. Ajoute une condition (nom, attribut de déclinaison, marque…) ci-dessous."
        />
      )}

      {view === 'monthly' ? (
        monthlyLoading ? (
          <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
        ) : (
          <MonthlyPivotTable
            rows={monthlyRows}
            groupKey="category"
            groupLabel="Catégorie"
            linkPrefix="/categories/"
            dateRange={dateRange}
            searchTerm={searchTerm}
            exportName="categories"
          />
        )
      ) : (<>
      {/* Cards de statistiques */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '15px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Categories</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{filteredCategories.length}{searchTerm && ` / ${withSales.length}`}</p>
        </div>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', color: '#8A99A4', margin: '0 0 10px 0' }}>Sous-categories</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', margin: 0 }}>{totals.sub_category_count}</p>
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
                  <th style={headerStyle('category')} onClick={() => handleSort('category')}>Categorie{getSortIcon('category')}</th>
                  {isVisible('product_count') && <th style={headerStyle('product_count')} onClick={() => handleSort('product_count')}>Produits{getSortIcon('product_count')}</th>}
                  {isVisible('sub_category_count') && <th style={headerStyle('sub_category_count')} onClick={() => handleSort('sub_category_count')}>Sous-cat.{getSortIcon('sub_category_count')}</th>}
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
                {sortedCategories.map((category) => {
                  const isExpanded = expandedCategoryName === category.category;
                  const hasSubCategories = category.sub_category_count > 0;
                  const categorySubCategoriesLoaded = subCategories[category.category] !== undefined;
                  const categorySubCategories = (subCategories[category.category] || []).filter(hasSales);

                  return (
                    <>
                      <tr
                        key={category.category}
                        onClick={() => handleRowClick(category)}
                        style={{
                          borderTop: '1px solid #E2E2E2',
                          cursor: hasSubCategories ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#F2F6F8' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasSubCategories) e.currentTarget.style.backgroundColor = '#F2F6F8'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasSubCategories && (
                              <span style={{ color: '#8A99A4', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <LinkBox
                              to={`/categories/${encodeURIComponent(category.category)}`}
                              display="inline"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontWeight: 'bold', color: '#135E84' }}
                            >
                              {category.category}
                            </LinkBox>
                          </div>
                        </td>
                        {isVisible('product_count') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatNumber(category.product_count)}</td>}
                        {isVisible('sub_category_count') && <td style={{ padding: '15px', fontSize: '14px' }}>{category.sub_category_count}</td>}
                        {isVisible('qty_sold') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatNumber(category.qty_sold)}</td>}
                        {isVisible('ca_ttc') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_ttc)}</td>}
                        {isVisible('ca_ht') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_ht)}</td>}
                        {isVisible('cost_ht') && <td style={{ padding: '15px', fontSize: '14px', color: '#DE2020' }}>{formatPrice(category.cost_ht)}</td>}
                        {isVisible('margin_ht') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: category.margin_ht >= 0 ? '#4AB866' : '#DE2020' }}>{formatPrice(category.margin_ht)}</td>}
                        {isVisible('margin_percent') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: category.margin_percent >= 30 ? '#4AB866' : category.margin_percent >= 15 ? '#E28F00' : '#DE2020' }}>{formatPercent(category.margin_percent)}</td>}
                        {isVisible('ca_fr') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_fr)}</td>}
                        {isVisible('ca_abroad') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(category.ca_abroad)}</td>}
                        {isVisible('abroad_percent') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: category.abroad_percent > 50 ? '#c2410c' : '#2a2e38' }}>{category.abroad_percent === null ? '–' : formatPercent(category.abroad_percent)}</td>}
                      </tr>
                      {isExpanded && categorySubCategories.length > 0 && categorySubCategories.map((sc) => (
                        <tr key={sc.sub_category} style={{ backgroundColor: '#F2F6F8', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '10px 15px 10px 45px', fontSize: '13px' }}>
                            <LinkBox
                              to={`/sub-categories/${encodeURIComponent(sc.sub_category)}`}
                              display="inline"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: '#135E84' }}
                            >
                              ↳ {sc.sub_category}
                            </LinkBox>
                          </td>
                          {isVisible('product_count') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#8A99A4' }}>{formatNumber(sc.product_count)}</td>}
                          {isVisible('sub_category_count') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#8A99A4' }}>-</td>}
                          {isVisible('qty_sold') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatNumber(sc.qty_sold)}</td>}
                          {isVisible('ca_ttc') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_ttc)}</td>}
                          {isVisible('ca_ht') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_ht)}</td>}
                          {isVisible('cost_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#DE2020' }}>{formatPrice(sc.cost_ht)}</td>}
                          {isVisible('margin_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sc.margin_ht >= 0 ? '#4AB866' : '#DE2020' }}>{formatPrice(sc.margin_ht)}</td>}
                          {isVisible('margin_percent') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sc.margin_percent >= 30 ? '#4AB866' : sc.margin_percent >= 15 ? '#E28F00' : '#DE2020' }}>{formatPercent(sc.margin_percent)}</td>}
                          {isVisible('ca_fr') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_fr)}</td>}
                          {isVisible('ca_abroad') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(sc.ca_abroad)}</td>}
                          {isVisible('abroad_percent') && <td style={{ padding: '10px 15px', fontSize: '13px', color: sc.abroad_percent > 50 ? '#c2410c' : '#2a2e38' }}>{sc.abroad_percent === null ? '–' : formatPercent(sc.abroad_percent)}</td>}
                        </tr>
                      ))}
                      {isExpanded && categorySubCategories.length === 0 && (
                        <tr key={`${category.category}-loading`} style={{ backgroundColor: '#F2F6F8' }}>
                          <td colSpan={1 + CATEGORIES_COLUMNS.filter(c => isVisible(c.key)).length} style={{ padding: '15px 45px', fontSize: '13px', color: '#8A99A4' }}>
                            {categorySubCategoriesLoaded ? 'Aucune vente sur la période' : 'Chargement des sous-categories...'}
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
              Aucune categorie trouvee
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  );
};

export default CategoriesStatsTab;
