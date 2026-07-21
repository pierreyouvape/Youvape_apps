import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../CopyButton';
import { formatPriceEur, formatInt } from '../../utils/formatNumber';
import { AuthContext } from '../../context/AuthContext';
import { useColumnPreferences } from '../../hooks/useColumnPreferences';
import ColumnPanel from '../ColumnPanel';
import { LinkBox } from '../../utils/navHelpers';
import ProductSegmentBuilder from './ProductSegmentBuilder';

const API_BASE_URL = '/api';

const PRODUCTS_COLUMNS = [
  { key: 'sku',           label: 'SKU' },
  { key: 'stock',         label: 'Stock' },
  { key: 'qty_sold',      label: 'Vendu' },
  { key: 'velocity',      label: 'Ventes/j' },
  { key: 'coverage_days', label: 'Couv. (j)' },
  { key: 'last_sold',     label: 'Dern. vente' },
  { key: 'first_sold',    label: '1ère vente' },
  { key: 'ca_ttc',        label: 'CA TTC' },
  { key: 'ca_ht',         label: 'CA HT' },
  { key: 'cost_ht',       label: 'Cout HT' },
  { key: 'margin_ht',     label: 'Marge HT' },
  { key: 'margin_percent',label: '% Marge' },
];

const PERIOD_OPTIONS = [
  { value: '7d', label: '7 derniers jours' },
  { value: '15d', label: '15 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: '60d', label: '60 derniers jours' },
  { value: '90d', label: '90 derniers jours' },
  { value: '180d', label: '180 derniers jours' },
  { value: '1m', label: 'Le mois dernier' },
  { value: '3m', label: 'Les 3 derniers mois' },
  { value: '6m', label: 'Les 6 derniers mois' },
  { value: 'custom', label: 'Période personnalisée' }
];

// Formate une date SQL en JJ/MM/AAAA (ou '—' si jamais vendu)
const formatDateFr = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

// Formate une Date en 'YYYY-MM-DD' en heure LOCALE (pas UTC).
// Indispensable : toISOString() renverrait la veille en soirée (heure Paris),
// ce qui casse les filtres "temps réel" (cf. commit 968bf4e).
const localFmt = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const computeDateRange = (period, customStart, customEnd) => {
  if (period === 'custom') {
    return {
      dateFrom: customStart || null,
      dateTo: customEnd ? customEnd + 'T23:59:59' : null
    };
  }

  const now = new Date();

  if (period.endsWith('d')) {
    const days = parseInt(period);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    return {
      dateFrom: localFmt(start),
      dateTo: localFmt(today)
    };
  }

  if (period.endsWith('m')) {
    const months = parseInt(period);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
    return {
      dateFrom: localFmt(start),
      dateTo: localFmt(today)
    };
  }

  return { dateFrom: null, dateTo: null };
};

const ProductsStatsTab = () => {
  const navigate = useNavigate();
  const { token } = useContext(AuthContext);
  const { isVisible, compact, showColumnPanel, setShowColumnPanel, toggleColumn, toggleCompact } = useColumnPreferences('products_stats', token);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 50,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('qty_sold');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [variations, setVariations] = useState({});

  // Période
  const [period, setPeriod] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Pays
  const [country, setCountry] = useState('');
  const [countries, setCountries] = useState([]);

  // Constructeur de segments : brouillon (édité) vs appliqué (utilisé pour le fetch/export)
  const [showBuilder, setShowBuilder] = useState(false);
  const [filters, setFilters] = useState([]);            // brouillon
  const [matchType, setMatchType] = useState('all');     // brouillon
  const [appliedFilters, setAppliedFilters] = useState([]);
  const [appliedMatchType, setAppliedMatchType] = useState('all');

  const dateRange = useMemo(() => computeDateRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const hasActiveFilters = appliedFilters.length > 0;

  // Paramètres partagés listing + export (utilise les filtres APPLIQUÉS)
  const buildParams = useCallback((extra = {}) => {
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
    return clean({
      search: searchTerm,
      sortBy, sortOrder,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      country,
      matchType: appliedMatchType,
      filters: appliedFilters.length > 0 ? JSON.stringify(appliedFilters) : '',
      ...extra,
    });
  }, [searchTerm, sortBy, sortOrder, dateRange.dateFrom, dateRange.dateTo, country, appliedFilters, appliedMatchType]);

  const applyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setAppliedMatchType(matchType);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [filters, matchType]);

  const clearFilters = useCallback(() => {
    setFilters([]); setMatchType('all');
    setAppliedFilters([]); setAppliedMatchType('all');
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const loadSegment = useCallback(({ filters: f, matchType: m }) => {
    const nf = f || []; const nm = m || 'all';
    setFilters(nf); setMatchType(nm);
    setAppliedFilters(nf); setAppliedMatchType(nm);
    setShowBuilder(true);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  // Charge la liste des pays une fois
  useEffect(() => {
    axios.get(`${API_BASE_URL}/products/stats-countries`)
      .then(res => { if (res.data.success) setCountries(res.data.data); })
      .catch(err => console.error('Error fetching countries:', err));
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const offset = pagination.pageIndex * pagination.pageSize;
      const response = await axios.get(`${API_BASE_URL}/products/stats-list`, {
        params: buildParams({ limit: pagination.pageSize, offset }),
      });

      if (response.data.success) {
        setData(response.data.data);
        setTotalCount(response.data.pagination.total);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageIndex, pagination.pageSize, buildParams]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Reset variations cache quand la période / le pays change
  useEffect(() => {
    setVariations({});
    setExpandedProductId(null);
  }, [dateRange.dateFrom, dateRange.dateTo, country]);

  const fetchVariations = async (productId) => {
    if (variations[productId]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/products/${productId}/variations-stats`, {
        params: {
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
          country: country || undefined,
        }
      });
      if (response.data.success) {
        setVariations(prev => ({ ...prev, [productId]: response.data.data }));
      }
    } catch (error) {
      console.error('Error fetching variations:', error);
    }
  };

  const handleRowClick = (product) => {
    if (product.product_type === 'variable' && product.variations_count > 0) {
      if (expandedProductId === product.wp_product_id) {
        setExpandedProductId(null);
      } else {
        setExpandedProductId(product.wp_product_id);
        fetchVariations(product.wp_product_id);
      }
    }
  };

  const handleNameClick = (e, productId) => {
    e.stopPropagation();
    navigate(`/products/${productId}`);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortBy(column);
      setSortOrder('DESC');
    }
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handlePeriodChange = (value) => {
    setPeriod(value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    if (value === 'custom' && !customEnd) {
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      setCustomEnd(end.toISOString().split('T')[0]);
      setCustomStart(start.toISOString().split('T')[0]);
    }
  };

  const handleCountryChange = (value) => {
    setCountry(value);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  // Export serveur : télécharge l'ensemble filtré (toutes les lignes), pas juste la page
  const handleExport = async (format) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/stats-list/export`, {
        params: buildParams({ format }),
        responseType: 'blob',
      });
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `produits_stats_${new Date().toISOString().split('T')[0]}.${format === 'xlsx' ? 'xls' : 'csv'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error exporting:', error);
      alert('Erreur lors de l\'export des données');
    }
  };

  const goToPage = (page) => setPagination((prev) => ({ ...prev, pageIndex: page }));
  const nextPage = () => {
    if (pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex + 1 }));
    }
  };
  const previousPage = () => {
    if (pagination.pageIndex > 0) {
      setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex - 1 }));
    }
  };

  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex < Math.ceil(totalCount / pagination.pageSize) - 1;
  const pageCount = Math.ceil(totalCount / pagination.pageSize);

  const formatPrice = (price) => formatPriceEur(price);
  const formatPercent = (percent) => parseFloat(percent || 0).toFixed(1) + '%';
  const formatVelocity = (v) => (v == null ? '—' : parseFloat(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // Couverture stock : peu de jours = tourne vite (vert), beaucoup = surstock (rouge → candidat solde)
  const coverageColor = (days) => {
    if (days == null) return { bg: '#e9ecef', fg: '#6c757d' };      // jamais vendu sur la période
    if (days > 180) return { bg: '#f8d7da', fg: '#721c24' };        // gros surstock
    if (days > 90)  return { bg: '#fff3cd', fg: '#856404' };        // surstock
    return { bg: '#d1e7dd', fg: '#0f5132' };                         // sain / tourne bien
  };
  const formatCoverage = (days) => (days == null ? '∞' : formatInt(days) + ' j');

  const getSortIcon = (column) => {
    if (sortBy !== column) return '';
    return sortOrder === 'ASC' ? ' ▲' : ' ▼';
  };

  const headerStyle = (column) => ({
    padding: '15px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6c757d',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: sortBy === column ? '#e9ecef' : '#f8f9fa',
    transition: 'background-color 0.2s'
  });

  return (
    <div style={compact ? { maxWidth: '1400px', margin: '0 auto' } : {}}>
      {/* Header avec filtres */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Rechercher par nom, SKU..."
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              minWidth: '220px',
              flex: 1,
              maxWidth: '350px'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: '#6c757d', whiteSpace: 'nowrap' }}>Période :</label>
            <select
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              {PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: '#6c757d', whiteSpace: 'nowrap' }}>Pays :</label>
            <select
              value={country}
              onChange={(e) => handleCountryChange(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              <option value="">Tous les pays</option>
              {countries.map(c => (
                <option key={c.country} value={c.country}>{c.country} ({formatInt(c.orders)})</option>
              ))}
            </select>
          </div>
          {period === 'custom' && (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(e) => { setCustomStart(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => { setCustomEnd(e.target.value); setPagination(p => ({ ...p, pageIndex: 0 })); }}
                style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
              />
            </>
          )}
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
            🎯 Segments{hasActiveFilters ? ` (${appliedFilters.length})` : ''}
          </button>
          <button
            onClick={() => handleExport('csv')}
            style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
          >
            CSV
          </button>
          <button
            onClick={() => handleExport('xlsx')}
            style={{ padding: '6px 12px', backgroundColor: '#1D6F42', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
          >
            Excel
          </button>
          <ColumnPanel
            columns={PRODUCTS_COLUMNS}
            isVisible={isVisible}
            toggleColumn={toggleColumn}
            compact={compact}
            toggleCompact={toggleCompact}
            show={showColumnPanel}
            setShow={setShowColumnPanel}
          />
        </div>
      </div>

      {/* Constructeur de segments (filtres dynamiques + segments enregistrés) */}
      {showBuilder && (
        <ProductSegmentBuilder
          filters={filters}
          matchType={matchType}
          onFiltersChange={setFilters}
          onMatchTypeChange={setMatchType}
          onApply={applyFilters}
          onClear={clearFilters}
          onLoadSegment={loadSegment}
        />
      )}

      {/* Card de statistique */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'inline-block' }}>
          <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>{hasActiveFilters ? 'Produits du segment' : 'Total produits'}</p>
          <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{formatInt(totalCount)}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle('name'), width: '50px', cursor: 'default' }}></th>
                  <th style={headerStyle('name')} onClick={() => handleSort('name')}>Nom{getSortIcon('name')}</th>
                  {isVisible('sku') && <th style={headerStyle('sku')} onClick={() => handleSort('sku')}>SKU{getSortIcon('sku')}</th>}
                  {isVisible('stock') && <th style={headerStyle('stock')} onClick={() => handleSort('stock')}>Stock{getSortIcon('stock')}</th>}
                  {isVisible('qty_sold') && <th style={headerStyle('qty_sold')} onClick={() => handleSort('qty_sold')}>Vendu{getSortIcon('qty_sold')}</th>}
                  {isVisible('velocity') && <th style={headerStyle('velocity')} onClick={() => handleSort('velocity')} title="Ventes moyennes par jour sur la période">Ventes/j{getSortIcon('velocity')}</th>}
                  {isVisible('coverage_days') && <th style={headerStyle('coverage_days')} onClick={() => handleSort('coverage_days')} title="Jours de stock restants au rythme actuel (stock ÷ ventes/j). Élevé = surstock.">Couv.{getSortIcon('coverage_days')}</th>}
                  {isVisible('last_sold') && <th style={headerStyle('last_sold')} onClick={() => handleSort('last_sold')}>Dern. vente{getSortIcon('last_sold')}</th>}
                  {isVisible('first_sold') && <th style={headerStyle('first_sold')} onClick={() => handleSort('first_sold')}>1ère vente{getSortIcon('first_sold')}</th>}
                  {isVisible('ca_ttc') && <th style={headerStyle('ca_ttc')} onClick={() => handleSort('ca_ttc')}>CA TTC{getSortIcon('ca_ttc')}</th>}
                  {isVisible('ca_ht') && <th style={headerStyle('ca_ht')} onClick={() => handleSort('ca_ht')}>CA HT{getSortIcon('ca_ht')}</th>}
                  {isVisible('cost_ht') && <th style={headerStyle('cost_ht')} onClick={() => handleSort('cost_ht')}>Coût HT{getSortIcon('cost_ht')}</th>}
                  {isVisible('margin_ht') && <th style={headerStyle('margin_ht')} onClick={() => handleSort('margin_ht')}>Marge HT{getSortIcon('margin_ht')}</th>}
                  {isVisible('margin_percent') && <th style={headerStyle('margin_percent')} onClick={() => handleSort('margin_percent')}>% Marge{getSortIcon('margin_percent')}</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((product) => {
                  const isExpanded = expandedProductId === product.wp_product_id;
                  const hasVariations = product.product_type === 'variable' && product.variations_count > 0;
                  const productVariations = variations[product.wp_product_id] || [];

                  return (
                    <>
                      <tr
                        key={product.wp_product_id}
                        onClick={() => handleRowClick(product)}
                        style={{
                          borderTop: '1px solid #dee2e6',
                          cursor: hasVariations ? 'pointer' : 'default',
                          backgroundColor: isExpanded ? '#f8f9fa' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => { if (hasVariations) e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '8px 10px', width: '50px' }}>
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt=""
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                            />
                          ) : (
                            <div style={{ width: '40px', height: '40px', backgroundColor: '#f0f0f0', borderRadius: '4px' }} />
                          )}
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {hasVariations && (
                              <span style={{ color: '#6c757d', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            )}
                            <LinkBox
                              to={`/products/${product.wp_product_id}`}
                              display="inline"
                              onClick={(e) => e.stopPropagation()}
                              style={{ fontWeight: 'bold', color: '#007bff' }}
                            >
                              {product.post_title}
                            </LinkBox>
                          </div>
                        </td>
                        {isVisible('sku') && (
                          <td style={{ padding: '15px', fontSize: '14px', color: '#6c757d' }}>
                            {product.sku ? (
                              <>
                                <a
                                  href={`https://www.youvape.fr/wp-admin/post.php?post=${product.wp_product_id}&action=edit`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: '#135E84', textDecoration: 'none' }}
                                  onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                  onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                >
                                  {product.sku}
                                </a>
                                <CopyButton text={product.sku} size={12} />
                              </>
                            ) : '-'}
                          </td>
                        )}
                        {isVisible('stock') && (
                          <td style={{ padding: '15px', fontSize: '14px' }}>
                            <span style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              backgroundColor: product.stock > 10 ? '#d1e7dd' : product.stock > 0 ? '#fff3cd' : '#f8d7da',
                              color: product.stock > 10 ? '#0f5132' : product.stock > 0 ? '#856404' : '#721c24'
                            }}>
                              {product.stock}
                            </span>
                          </td>
                        )}
                        {isVisible('qty_sold') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatInt(product.qty_sold)}</td>}
                        {isVisible('velocity') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatVelocity(product.velocity)}</td>}
                        {isVisible('coverage_days') && (
                          <td style={{ padding: '15px', fontSize: '14px' }}>
                            <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', backgroundColor: coverageColor(product.coverage_days).bg, color: coverageColor(product.coverage_days).fg }}>
                              {formatCoverage(product.coverage_days)}
                            </span>
                          </td>
                        )}
                        {isVisible('last_sold') && <td style={{ padding: '15px', fontSize: '13px', color: '#6c757d', whiteSpace: 'nowrap' }}>{formatDateFr(product.last_sold)}</td>}
                        {isVisible('first_sold') && <td style={{ padding: '15px', fontSize: '13px', color: '#6c757d', whiteSpace: 'nowrap' }}>{formatDateFr(product.first_sold)}</td>}
                        {isVisible('ca_ttc') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(product.ca_ttc)}</td>}
                        {isVisible('ca_ht') && <td style={{ padding: '15px', fontSize: '14px' }}>{formatPrice(product.ca_ht)}</td>}
                        {isVisible('cost_ht') && <td style={{ padding: '15px', fontSize: '14px', color: '#dc3545' }}>{formatPrice(product.cost_ht)}</td>}
                        {isVisible('margin_ht') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#28a745' }}>{formatPrice(product.margin_ht)}</td>}
                        {isVisible('margin_percent') && <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: product.margin_percent >= 30 ? '#28a745' : product.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>{formatPercent(product.margin_percent)}</td>}
                      </tr>
                      {isExpanded && productVariations.length > 0 && productVariations.map((variation) => (
                        <tr key={variation.wp_product_id} style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e9ecef' }}>
                          <td style={{ padding: '8px 10px', width: '50px' }}></td>
                          <td style={{ padding: '10px 15px 10px 15px', fontSize: '13px', color: '#6c757d' }}>
                            ↳ {variation.post_title}
                          </td>
                          {isVisible('sku') && (
                            <td style={{ padding: '10px 15px', fontSize: '13px', color: '#6c757d' }}>
                              {variation.sku ? (
                                <>
                                  <a
                                    href={`https://www.youvape.fr/wp-admin/post.php?post=${variation.wp_product_id}&action=edit`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#135E84', textDecoration: 'none' }}
                                    onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                    onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                  >
                                    {variation.sku}
                                  </a>
                                  <CopyButton text={variation.sku} size={11} />
                                </>
                              ) : '-'}
                            </td>
                          )}
                          {isVisible('stock') && (
                            <td style={{ padding: '10px 15px', fontSize: '13px' }}>
                              <span style={{
                                padding: '3px 8px',
                                borderRadius: '10px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                backgroundColor: variation.stock > 10 ? '#d1e7dd' : variation.stock > 0 ? '#fff3cd' : '#f8d7da',
                                color: variation.stock > 10 ? '#0f5132' : variation.stock > 0 ? '#856404' : '#721c24'
                              }}>
                                {variation.stock}
                              </span>
                            </td>
                          )}
                          {isVisible('qty_sold') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatInt(variation.qty_sold)}</td>}
                          {isVisible('velocity') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatVelocity(variation.velocity)}</td>}
                          {isVisible('coverage_days') && (
                            <td style={{ padding: '10px 15px', fontSize: '13px' }}>
                              <span style={{ padding: '3px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold', backgroundColor: coverageColor(variation.coverage_days).bg, color: coverageColor(variation.coverage_days).fg }}>
                                {formatCoverage(variation.coverage_days)}
                              </span>
                            </td>
                          )}
                          {isVisible('last_sold') && <td style={{ padding: '10px 15px', fontSize: '12px', color: '#6c757d', whiteSpace: 'nowrap' }}>{formatDateFr(variation.last_sold)}</td>}
                          {isVisible('first_sold') && <td style={{ padding: '10px 15px', fontSize: '12px', color: '#6c757d', whiteSpace: 'nowrap' }}>{formatDateFr(variation.first_sold)}</td>}
                          {isVisible('ca_ttc') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(variation.ca_ttc)}</td>}
                          {isVisible('ca_ht') && <td style={{ padding: '10px 15px', fontSize: '13px' }}>{formatPrice(variation.ca_ht)}</td>}
                          {isVisible('cost_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#dc3545' }}>{formatPrice(variation.cost_ht)}</td>}
                          {isVisible('margin_ht') && <td style={{ padding: '10px 15px', fontSize: '13px', color: '#28a745' }}>{formatPrice(variation.margin_ht)}</td>}
                          {isVisible('margin_percent') && <td style={{ padding: '10px 15px', fontSize: '13px', color: variation.margin_percent >= 30 ? '#28a745' : variation.margin_percent >= 15 ? '#ffc107' : '#dc3545' }}>{formatPercent(variation.margin_percent)}</td>}
                        </tr>
                      ))}
                      {isExpanded && productVariations.length === 0 && (
                        <tr key={`${product.wp_product_id}-loading`} style={{ backgroundColor: '#f8f9fa' }}>
                          <td colSpan={2 + PRODUCTS_COLUMNS.filter(c => isVisible(c.key)).length} style={{ padding: '15px 45px', fontSize: '13px', color: '#6c757d' }}>
                            Chargement des variations...
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun produit trouvé
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && data.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', backgroundColor: 'white', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { label: '« Début', onClick: () => goToPage(0), disabled: !canPreviousPage },
              { label: '‹ Précédent', onClick: previousPage, disabled: !canPreviousPage },
              { label: 'Suivant ›', onClick: nextPage, disabled: !canNextPage },
              { label: 'Fin »', onClick: () => goToPage(pageCount - 1), disabled: !canNextPage },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.onClick}
                disabled={b.disabled}
                style={{
                  padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: '6px',
                  backgroundColor: b.disabled ? '#f1f3f5' : '#fff',
                  color: b.disabled ? '#adb5bd' : '#135E84',
                  cursor: b.disabled ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '14px', color: '#6c757d' }}>
            Page <strong>{pagination.pageIndex + 1}</strong> sur <strong>{pageCount}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: '#6c757d' }}>Afficher:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => setPagination((prev) => ({ ...prev, pageSize: Number(e.target.value), pageIndex: 0 }))}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsStatsTab;
