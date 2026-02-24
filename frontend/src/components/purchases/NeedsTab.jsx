import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const STORAGE_KEY = 'purchases_needs_filters';

const ANALYSIS_PERIOD_OPTIONS = [
  { value: 0.25, label: '7 jours' },
  { value: 0.5, label: '15 jours' },
  { value: 1, label: '1 mois' },
  { value: 2, label: '2 mois' },
  { value: 3, label: '3 mois' },
  { value: 4, label: '4 mois' },
  { value: 5, label: '5 mois' },
  { value: 6, label: '6 mois' },
  { value: 9, label: '9 mois' },
  { value: 12, label: '12 mois' },
  { value: 'custom', label: 'Plage personnalisée' }
];

const COVERAGE_OPTIONS = [
  { value: 0.25, label: '7 jours' },
  { value: 0.5, label: '15 jours' },
  { value: 1, label: '1 mois' },
  { value: 1.5, label: '1.5 mois' },
  { value: 2, label: '2 mois' },
  { value: 3, label: '3 mois' },
  { value: 4, label: '4 mois' },
  { value: 6, label: '6 mois' }
];

const loadSavedFilters = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
};

const saveFilters = (filters) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {}
};

// ==================== CALCULS JS (portés depuis le backend) ====================

const calculateLinearRegression = (sales) => {
  const n = sales.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += sales[i];
    sumXY += i * sales[i]; sumX2 += i * i;
  }
  const avgX = sumX / n;
  const avgY = sumY / n;
  const denominator = sumX2 - n * avgX * avgX;
  if (denominator === 0 || avgY === 0) return { coefficient: 1, rSquared: 0 };
  const slope = (sumXY - n * avgX * avgY) / denominator;
  const intercept = avgY - slope * avgX;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += Math.pow(sales[i] - (slope * i + intercept), 2);
    ssTot += Math.pow(sales[i] - avgY, 2);
  }
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
  const projectedValue = avgY + slope * (n - avgX);
  let coefficient = avgY === 0 ? (projectedValue > 0 ? 2 : 1) : projectedValue / avgY;
  coefficient = Math.max(0.1, Math.min(5, coefficient));
  return { coefficient, rSquared: Math.max(0, rSquared) };
};

const calculateWeightedMovingAverage = (sales) => {
  const n = sales.length;
  if (n < 2) return 1;
  let weightedSum = 0, totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const weight = i + 1;
    weightedSum += sales[i] * weight;
    totalWeight += weight;
  }
  const weightedAvg = weightedSum / totalWeight;
  const simpleAvg = sales.reduce((a, b) => a + b, 0) / n;
  if (simpleAvg === 0) return weightedAvg > 0 ? 1.5 : 1;
  return Math.max(0.1, Math.min(5, weightedAvg / simpleAvg));
};

const calculateTrendCoefficient = (monthlySales) => {
  if (!monthlySales || monthlySales.length < 2) {
    return { coefficient: 1, rSquared: null, method: 'insufficient_data' };
  }
  const sales = monthlySales.map(m => parseInt(m.total_qty) || 0);
  const regressionResult = calculateLinearRegression(sales);
  if (regressionResult.rSquared >= 0.7) {
    return {
      coefficient: regressionResult.coefficient,
      rSquared: Math.round(regressionResult.rSquared * 100) / 100,
      method: 'linear_regression'
    };
  }
  const wmaCoefficient = calculateWeightedMovingAverage(sales);
  return {
    coefficient: wmaCoefficient,
    rSquared: Math.round(regressionResult.rSquared * 100) / 100,
    method: 'weighted_moving_average'
  };
};

/**
 * Calcule les besoins d'un produit à partir de ses données brutes.
 * analysisPeriodMonths : durée en mois pour la période d'analyse
 * analysisStartDate / analysisEndDate : si custom, filtrer les monthly_sales (format YYYY-MM-DD)
 * coverageMonths : durée de couverture cible
 */
const computeProductNeeds = (product, analysisPeriodMonths, coverageMonths, analysisStartDate, analysisEndDate, isCustomPeriod) => {
  const { monthly_sales = [], max_order_qty_12m = 0, stock = 0, incoming_qty = 0 } = product;

  // Filtrer les ventes sur la période d'analyse
  let salesInPeriod = 0;
  let filteredMonthlySales;

  if (isCustomPeriod && analysisStartDate && analysisEndDate) {
    // Période personnalisée : filtrer par plage de dates
    const start = new Date(analysisStartDate);
    const end = new Date(analysisEndDate);
    filteredMonthlySales = monthly_sales.filter(m => {
      const monthDate = new Date(m.month);
      return monthDate >= start && monthDate <= end;
    });
    salesInPeriod = filteredMonthlySales.reduce((sum, m) => sum + (parseInt(m.total_qty) || 0), 0);
  } else {
    // Période preset : prendre les N derniers mois
    // monthly_sales contient les 12 derniers mois, triés par date
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - Math.ceil(analysisPeriodMonths));
    filteredMonthlySales = monthly_sales.filter(m => new Date(m.month) >= cutoffDate);
    salesInPeriod = filteredMonthlySales.reduce((sum, m) => sum + (parseInt(m.total_qty) || 0), 0);
  }

  const effectivePeriod = analysisPeriodMonths > 0 ? analysisPeriodMonths : 1;
  const avgMonthlySales = salesInPeriod / effectivePeriod;

  // Tendance sur les 12 derniers mois (on garde toutes les données pour la regression)
  const trendResult = calculateTrendCoefficient(monthly_sales);
  const trendCoefficient = trendResult.coefficient;

  const fifteenDaysSales = avgMonthlySales / 2;
  const projectedMonthlySales = avgMonthlySales * trendCoefficient;
  const fifteenDaysProjected = projectedMonthlySales / 2;

  const theoreticalCoverage = avgMonthlySales * coverageMonths;
  const theoreticalSafety = max_order_qty_12m + fifteenDaysSales;
  const theoreticalNeed = Math.max(theoreticalCoverage, theoreticalSafety);

  const supposedCoverage = projectedMonthlySales * coverageMonths;
  const supposedSafety = max_order_qty_12m + fifteenDaysProjected;
  const supposedNeed = Math.max(supposedCoverage, supposedSafety);

  const effectiveStock = stock + incoming_qty;
  const theoreticalProposal = Math.max(0, Math.ceil(theoreticalNeed) - effectiveStock);
  const supposedProposal = Math.max(0, Math.ceil(supposedNeed) - effectiveStock);

  return {
    avg_monthly_sales: Math.round(avgMonthlySales * 100) / 100,
    trend_coefficient: Math.round(trendCoefficient * 100) / 100,
    trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable',
    theoretical_need: Math.ceil(theoreticalNeed),
    supposed_need: Math.ceil(supposedNeed),
    theoretical_proposal: theoreticalProposal,
    supposed_proposal: supposedProposal
  };
};

// ==================== COMPOSANTS UI ====================

const cycleTriState = (current) => {
  if (current === null) return true;
  if (current === true) return false;
  return null;
};

const TriStateCheckbox = ({ value, onChange, label }) => {
  const icon = value === true ? '✓' : value === false ? '✕' : '';
  const cls = value === true ? 'tristate-yes' : value === false ? 'tristate-no' : 'tristate-all';
  return (
    <button
      type="button"
      className={`tristate-btn ${cls}`}
      onClick={() => onChange(cycleTriState(value))}
      title={value === null ? 'Tout afficher' : value === true ? 'Oui seulement' : 'Non seulement'}
    >
      <span className="tristate-box">{icon}</span>
      <span className="tristate-label">{label}</span>
    </button>
  );
};

// ==================== COMPOSANT PRINCIPAL ====================

const NeedsTab = ({ token }) => {
  // Cache des données brutes (chargé une fois par fournisseur)
  const [allProducts, setAllProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const savedFilters = loadSavedFilters();

  const [supplierId, setSupplierId] = useState(savedFilters?.supplierId || '');
  const [search, setSearch] = useState('');

  // Période d'analyse
  const [analysisPeriodType, setAnalysisPeriodType] = useState(savedFilters?.analysisPeriodType || 'preset');
  const [analysisPeriod, setAnalysisPeriod] = useState(savedFilters?.analysisPeriod || 1);
  const [analysisStartDate, setAnalysisStartDate] = useState(savedFilters?.analysisStartDate || '');
  const [analysisEndDate, setAnalysisEndDate] = useState(savedFilters?.analysisEndDate || '');

  // Couverture cible
  const [coverageMonths, setCoverageMonths] = useState(savedFilters?.coverageMonths || 1);

  // Filtres 3 états : null = tout, true = oui seulement, false = non seulement
  const [withSalesOnly, setWithSalesOnly] = useState(savedFilters?.withSalesOnly ?? null);
  const [zeroStockState, setZeroStockState] = useState(savedFilters?.zeroStockState ?? null);

  // Pagination locale
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Tri local
  const [sortColumn, setSortColumn] = useState('theoretical_proposal');
  const [sortDirection, setSortDirection] = useState('desc');

  // Sélection pour commande (jamais réinitialisée par les recalculs)
  const [selectedProducts, setSelectedProducts] = useState({});
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Ref pour gérer le debounce de la recherche
  const searchTimeoutRef = useRef(null);

  // Sauvegarder les filtres quand ils changent
  useEffect(() => {
    saveFilters({
      supplierId,
      analysisPeriodType,
      analysisPeriod,
      analysisStartDate,
      analysisEndDate,
      coverageMonths,
      withSalesOnly,
      zeroStockState
    });
  }, [supplierId, analysisPeriodType, analysisPeriod, analysisStartDate, analysisEndDate, coverageMonths, withSalesOnly, zeroStockState]);

  // Charger les fournisseurs
  useEffect(() => {
    const load = async () => {
      try {
        const response = await axios.get(`${API_URL}/purchases/suppliers`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSuppliers(response.data.data || []);
      } catch (err) {
        console.error('Erreur chargement fournisseurs:', err);
      }
    };
    load();
  }, [token]);

  // Charger toutes les données brutes (une fois par changement de fournisseur)
  const loadRawData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (supplierId) params.append('supplier_id', supplierId);

      const response = await axios.get(`${API_URL}/purchases/needs/raw?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAllProducts(response.data.data || []);
      setPage(1);
    } catch (err) {
      console.error('Erreur chargement données brutes:', err);
      setError('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  }, [token, supplierId]);

  useEffect(() => {
    loadRawData();
  }, [loadRawData]);

  // Période d'analyse effective en mois
  const effectivePeriodMonths = useMemo(() => {
    if (analysisPeriodType === 'custom' && analysisStartDate && analysisEndDate) {
      const start = new Date(analysisStartDate);
      const end = new Date(analysisEndDate);
      const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      return Math.max(diffDays / 30, 0.03); // min ~1 jour
    }
    return analysisPeriod;
  }, [analysisPeriodType, analysisPeriod, analysisStartDate, analysisEndDate]);

  const isCustomPeriod = analysisPeriodType === 'custom';

  // Calcul des besoins sur tous les produits (recalculé quand les paramètres changent)
  const computedProducts = useMemo(() => {
    return allProducts.map(p => {
      const needs = computeProductNeeds(
        p,
        effectivePeriodMonths,
        coverageMonths,
        analysisStartDate,
        analysisEndDate,
        isCustomPeriod
      );
      return { ...p, ...needs };
    });
  }, [allProducts, effectivePeriodMonths, coverageMonths, analysisStartDate, analysisEndDate, isCustomPeriod]);

  // Filtrage local
  const filteredProducts = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const hasSearch = searchLower.length >= 2;

    return computedProducts.filter(p => {
      // Si recherche active, on affiche tous les correspondants (bypass filtre propositions)
      if (hasSearch) {
        return (
          (p.post_title || '').toLowerCase().includes(searchLower) ||
          (p.sku || '').toLowerCase().includes(searchLower)
        );
      }

      // Filtre "avec ventes"
      if (withSalesOnly === true && p.avg_monthly_sales <= 0) return false;
      if (withSalesOnly === false && p.avg_monthly_sales > 0) return false;

      // Filtre "stock nul/négatif"
      if (zeroStockState === true && p.stock > 0) return false;
      if (zeroStockState === false && p.stock <= 0) return false;

      // Par défaut : n'afficher que les produits avec une proposition
      if (!hasSearch && p.theoretical_proposal <= 0 && p.supposed_proposal <= 0) return false;

      return true;
    });
  }, [computedProducts, search, withSalesOnly, zeroStockState]);

  // Tri local
  const sortedProducts = useMemo(() => {
    if (!sortColumn) return filteredProducts;
    return [...filteredProducts].sort((a, b) => {
      const aVal = a[sortColumn] ?? 0;
      const bVal = b[sortColumn] ?? 0;
      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [filteredProducts, sortColumn, sortDirection]);

  // Pagination locale
  const totalFiltered = sortedProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const pagedProducts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedProducts.slice(start, start + PAGE_SIZE);
  }, [sortedProducts, page]);

  // Reset page quand les filtres changent (mais pas la sélection)
  useEffect(() => {
    setPage(1);
  }, [supplierId, withSalesOnly, zeroStockState, effectivePeriodMonths, coverageMonths]);

  const handleSearchChange = (value) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setPage(1), 300);
  };

  const handleAnalysisPeriodChange = (value) => {
    if (value === 'custom') {
      setAnalysisPeriodType('custom');
      if (!analysisEndDate) {
        const end = new Date();
        const start = new Date();
        start.setMonth(start.getMonth() - 1);
        setAnalysisEndDate(end.toISOString().split('T')[0]);
        setAnalysisStartDate(start.toISOString().split('T')[0]);
      }
    } else {
      setAnalysisPeriodType('preset');
      setAnalysisPeriod(parseFloat(value));
    }
  };

  // Gestion de la sélection
  const handleQtyChange = (productId, qty) => {
    if (qty > 0) {
      setSelectedProducts(prev => ({ ...prev, [productId]: qty }));
    } else {
      setSelectedProducts(prev => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }
  };

  const fillTheoreticalProposals = () => {
    const next = { ...selectedProducts };
    // Remplir depuis tous les produits calculés (pas seulement la page visible)
    computedProducts.forEach(p => {
      if (p.theoretical_proposal > 0) next[p.id] = p.theoretical_proposal;
    });
    setSelectedProducts(next);
  };

  const fillSupposedProposals = () => {
    const next = { ...selectedProducts };
    computedProducts.forEach(p => {
      if (p.supposed_proposal > 0) next[p.id] = p.supposed_proposal;
    });
    setSelectedProducts(next);
  };

  const clearSelection = () => setSelectedProducts({});

  const createOrder = async () => {
    const selectedCount = Object.keys(selectedProducts).length;
    if (selectedCount === 0) { alert('Aucun produit sélectionné'); return; }
    if (!supplierId) { alert('Veuillez sélectionner un fournisseur'); return; }

    setCreatingOrder(true);
    try {
      const items = Object.entries(selectedProducts).map(([productId, qty]) => {
        const product = computedProducts.find(p => p.id === parseInt(productId));
        return {
          product_id: parseInt(productId),
          product_name: product?.post_title || '',
          qty_ordered: qty,
          stock_before: product?.stock || 0,
          theoretical_need: product?.theoretical_need || 0,
          supposed_need: product?.supposed_need || 0,
          supplier_sku: product?.supplier_sku || null,
          unit_price: product?.supplier_price || product?.cost_price || null
        };
      });

      await axios.post(`${API_URL}/purchases/orders`, {
        supplier_id: parseInt(supplierId),
        items
      }, { headers: { Authorization: `Bearer ${token}` } });

      alert(`Commande créée avec ${items.length} article(s)`);
      setSelectedProducts({});
      loadRawData(); // Recharger pour mettre à jour les arrivages
    } catch (err) {
      console.error('Erreur création commande:', err);
      alert('Erreur lors de la création de la commande');
    } finally {
      setCreatingOrder(false);
    }
  };

  // Rendu
  const renderTrend = (direction, coefficient) => {
    if (direction === 'up') return <span className="trend-up">↗ ×{coefficient}</span>;
    if (direction === 'down') return <span className="trend-down">↘ ×{coefficient}</span>;
    return <span className="trend-stable">→</span>;
  };

  const renderStock = (stock) => {
    if (stock === null || stock === undefined) return <span className="stock-zero">N/A</span>;
    if (stock <= 0) return <span className="stock-zero">{stock}</span>;
    if (stock < 5) return <span className="stock-critical">{stock}</span>;
    if (stock < 20) return <span className="stock-low">{stock}</span>;
    return <span className="stock-ok">{stock}</span>;
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const SortableHeader = ({ column, label, className }) => (
    <th
      className={`${className || ''} sortable-header`}
      onClick={() => handleSort(column)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      {label}
      <span style={{ marginLeft: '4px', opacity: sortColumn === column ? 1 : 0.3 }}>
        {sortColumn === column ? (sortDirection === 'asc' ? '▲' : '▼') : '▼'}
      </span>
    </th>
  );

  const selectedCount = Object.keys(selectedProducts).length;
  const selectedTotal = Object.values(selectedProducts).reduce((a, b) => a + b, 0);
  const analysisPeriodSelectValue = analysisPeriodType === 'custom' ? 'custom' : analysisPeriod;

  return (
    <div className="needs-tab">
      <div className="purchases-card">

        {/* Ligne de filtres principale */}
        <div className="filters-bar">
          <div className="filter-group">
            <label>Fournisseur</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Tous les fournisseurs</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <label>Recherche</label>
            <input
              type="text"
              placeholder="Nom ou SKU..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label>Période d'analyse</label>
            <select value={analysisPeriodSelectValue} onChange={(e) => handleAnalysisPeriodChange(e.target.value)}>
              {ANALYSIS_PERIOD_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Dates personnalisées — inline si custom */}
          {analysisPeriodType === 'custom' && (
            <>
              <div className="filter-group">
                <label>Date début</label>
                <input
                  type="date"
                  value={analysisStartDate}
                  onChange={(e) => setAnalysisStartDate(e.target.value)}
                />
              </div>
              <div className="filter-group">
                <label>Date fin</label>
                <input
                  type="date"
                  value={analysisEndDate}
                  onChange={(e) => setAnalysisEndDate(e.target.value)}
                />
              </div>
              <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
                <label>&nbsp;</label>
                <span style={{ fontSize: '13px', color: '#888', padding: '8px 0' }}>
                  ≈ {Math.round(effectivePeriodMonths * 10) / 10} mois
                </span>
              </div>
            </>
          )}

          <div className="filter-group">
            <label>Couverture cible</label>
            <select value={coverageMonths} onChange={(e) => setCoverageMonths(parseFloat(e.target.value))}>
              {COVERAGE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>

        {/* Ligne secondaire : filtres 3 états + boutons */}
        <div className="filters-bar" style={{ marginTop: '10px', marginBottom: 0 }}>
          <TriStateCheckbox
            value={withSalesOnly}
            onChange={setWithSalesOnly}
            label="Avec ventes"
          />
          <TriStateCheckbox
            value={zeroStockState}
            onChange={setZeroStockState}
            label="Stock nul/négatif"
          />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
            {allProducts.length > 0 && (
              <span style={{ fontSize: '13px', color: '#888' }}>
                {totalFiltered} / {allProducts.length} produits
              </span>
            )}
            <button className="btn btn-secondary btn-sm" onClick={fillTheoreticalProposals}>
              📥 Théorique
            </button>
            <button className="btn btn-secondary btn-sm" onClick={fillSupposedProposals}>
              📥 Supposé
            </button>
            <button className="btn btn-secondary btn-sm" onClick={clearSelection}>
              🗑️ Vider
            </button>
          </div>
        </div>

        {/* Résumé sélection */}
        {selectedCount > 0 && (
          <div style={{
            background: '#fef3c7',
            padding: '10px 15px',
            borderRadius: '6px',
            marginTop: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>
              <strong>{selectedCount}</strong> produit(s) sélectionné(s) —
              <strong> {selectedTotal}</strong> unités au total
            </span>
            <button
              className="btn btn-primary"
              onClick={createOrder}
              disabled={creatingOrder || !supplierId}
              title={!supplierId ? 'Sélectionnez un fournisseur pour créer une commande' : ''}
            >
              {creatingOrder ? 'Création...' : '📦 Créer la commande'}
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="purchases-card">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Chargement des produits...</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p style={{ color: '#ef4444' }}>{error}</p>
            <button className="btn btn-primary" onClick={loadRawData}>Réessayer</button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p>
              {allProducts.length === 0
                ? 'Aucun produit trouvé'
                : search.length >= 2
                  ? `Aucun résultat pour "${search}"`
                  : 'Aucun produit avec une proposition sur cette période'}
            </p>
            {allProducts.length > 0 && !search && (
              <p style={{ fontSize: '13px', color: '#aaa' }}>
                Essayez une période d'analyse plus longue ou utilisez les filtres "Avec ventes"
              </p>
            )}
          </div>
        ) : (
          <>
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>SKU</th>
                  <SortableHeader column="stock" label="Stock" className="text-right" />
                  <th className="text-right">Arrivage</th>
                  <SortableHeader column="avg_monthly_sales" label="Ventes/mois" className="text-right" />
                  <th className="text-center">Tendance</th>
                  <SortableHeader column="theoretical_need" label="Besoin théo." className="text-right" />
                  <SortableHeader column="supposed_need" label="Besoin supp." className="text-right" />
                  <SortableHeader column="theoretical_proposal" label="Prop. théo." className="text-right" />
                  <SortableHeader column="supposed_proposal" label="Prop. supp." className="text-right" />
                  <th className="text-right">À commander</th>
                </tr>
              </thead>
              <tbody>
                {pagedProducts.map(product => (
                  <tr key={product.id}>
                    <td>
                      <div style={{ maxWidth: '250px' }}>
                        <div style={{ fontWeight: 500, marginBottom: '2px' }}>{product.post_title}</div>
                        {product.supplier_name && (
                          <small style={{ color: '#666' }}>🏭 {product.supplier_name}</small>
                        )}
                      </div>
                    </td>
                    <td><code style={{ fontSize: '12px' }}>{product.sku || '-'}</code></td>
                    <td className="text-right">{renderStock(product.stock)}</td>
                    <td className="text-right">
                      {product.incoming_qty > 0 ? (
                        <span style={{ color: '#3b82f6' }}>+{product.incoming_qty}</span>
                      ) : '-'}
                    </td>
                    <td className="text-right">{product.avg_monthly_sales || 0}</td>
                    <td className="text-center">
                      {renderTrend(product.trend_direction, product.trend_coefficient)}
                    </td>
                    <td className="text-right">{product.theoretical_need || 0}</td>
                    <td className="text-right">{product.supposed_need || 0}</td>
                    <td className="text-right">
                      {product.theoretical_proposal > 0 ? (
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{product.theoretical_proposal}</span>
                      ) : '-'}
                    </td>
                    <td className="text-right">
                      {product.supposed_proposal > 0 ? (
                        <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{product.supposed_proposal}</span>
                      ) : '-'}
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        className="qty-input"
                        min="0"
                        value={selectedProducts[product.id] || ''}
                        onChange={(e) => handleQtyChange(product.id, parseInt(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Précédent
                </button>
                <span className="pagination-info">Page {page} / {totalPages} ({totalFiltered} produits)</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  Suivant →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default NeedsTab;
