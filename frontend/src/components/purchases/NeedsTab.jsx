import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const STORAGE_KEY = 'purchases_needs_filters';

const ANALYSIS_PERIOD_OPTIONS = [
  { value: 7, unit: 'days', label: '7 derniers jours' },
  { value: 15, unit: 'days', label: '15 derniers jours' },
  { value: 30, unit: 'days', label: '30 derniers jours' },
  { value: 60, unit: 'days', label: '60 derniers jours' },
  { value: 1, unit: 'months', label: 'Le mois dernier' },
  { value: 3, unit: 'months', label: 'Les 3 derniers mois' },
  { value: 6, unit: 'months', label: 'Les 6 derniers mois' },
  { value: 'custom', unit: null, label: 'Période personnalisée' }
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
 * Le backend renvoie les ventes par jour (daily_sales) — on filtre ici selon la période choisie.
 *
 * Preset : fenêtre glissante des N derniers jours (exclut aujourd'hui)
 *          ou N derniers mois calendaires complets
 * Custom : plage fixe entre analysisStartDate et analysisEndDate
 */
const computeProductNeeds = (product, periodDays, coverageMonths, isCustomPeriod, analysisStartDate, analysisEndDate, periodUnit) => {
  const { daily_sales = [], stock = 0, incoming_qty = 0 } = product;

  let salesData;
  let actualDays = periodDays;

  if (isCustomPeriod && analysisStartDate && analysisEndDate) {
    const start = new Date(analysisStartDate + 'T00:00:00');
    const end = new Date(analysisEndDate + 'T23:59:59');
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= start && d <= end;
    });
    actualDays = Math.max(Math.ceil((end - start) / (1000 * 60 * 60 * 24)), 1);
  } else if (periodUnit === 'months') {
    // N derniers mois calendaires COMPLETS — exclure le mois en cours
    const now = new Date();
    const endExclusive = new Date(now.getFullYear(), now.getMonth(), 1);
    const startInclusive = new Date(endExclusive);
    startInclusive.setMonth(startInclusive.getMonth() - Math.round(periodDays / 30));
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= startInclusive && d < endExclusive;
    });
    actualDays = Math.max(Math.ceil((endExclusive - startInclusive) / (1000 * 60 * 60 * 24)), 1);
  } else {
    // N derniers jours — exclure aujourd'hui (jour incomplet)
    const now = new Date();
    const endExclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startInclusive = new Date(endExclusive);
    startInclusive.setDate(startInclusive.getDate() - periodDays);
    salesData = daily_sales.filter(m => {
      const d = new Date(m.date);
      return d >= startInclusive && d < endExclusive;
    });
    actualDays = periodDays;
  }

  const salesInPeriod = salesData.reduce((sum, m) => sum + (parseInt(m.total_qty) || 0), 0);
  const max_order_qty = parseInt(product.max_order_qty_12m) || 0;

  // Convertir en moyenne mensuelle (30 jours = 1 mois)
  const periodInMonths = actualDays / 30;
  const avgMonthlySales = periodInMonths > 0 ? salesInPeriod / periodInMonths : 0;

  // Tendance : agréger par semaine pour avoir des points exploitables
  const weeklyMap = new Map();
  for (const d of salesData) {
    const date = new Date(d.date);
    // Clé = lundi de la semaine (ISO)
    const dayOfWeek = (date.getDay() + 6) % 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - dayOfWeek);
    const key = monday.toISOString().slice(0, 10);
    weeklyMap.set(key, (weeklyMap.get(key) || 0) + (parseInt(d.total_qty) || 0));
  }
  const weeklySales = [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, qty]) => ({ total_qty: qty }));
  const trendResult = calculateTrendCoefficient(weeklySales);
  const trendCoefficient = trendResult.coefficient;

  const fifteenDaysSales = avgMonthlySales / 2;
  const projectedMonthlySales = avgMonthlySales * trendCoefficient;
  const fifteenDaysProjected = projectedMonthlySales / 2;

  const theoreticalCoverage = avgMonthlySales * coverageMonths;
  const theoreticalSafety = max_order_qty + fifteenDaysSales;
  const theoreticalNeed = Math.max(theoreticalCoverage, theoreticalSafety);

  const supposedCoverage = projectedMonthlySales * coverageMonths;
  const supposedSafety = max_order_qty + fifteenDaysProjected;
  const supposedNeed = Math.max(supposedCoverage, supposedSafety);

  const effectiveStock = stock + incoming_qty;
  const theoreticalProposal = Math.max(0, Math.ceil(theoreticalNeed) - effectiveStock);
  const supposedProposal = Math.max(0, Math.ceil(supposedNeed) - effectiveStock);

  return {
    sales_in_period: salesInPeriod,
    avg_monthly_sales: Math.round(avgMonthlySales * 100) / 100,
    trend_coefficient: Math.round(trendCoefficient * 100) / 100,
    trend_direction: trendCoefficient > 1.1 ? 'up' : trendCoefficient < 0.9 ? 'down' : 'stable',
    theoretical_need: Math.ceil(theoreticalNeed),
    supposed_need: Math.ceil(supposedNeed),
    theoretical_proposal: theoreticalProposal,
    supposed_proposal: supposedProposal
  };
};

// ==================== FORMATAGE ====================

const fmtInt = (v) => (parseInt(v) || 0).toLocaleString('fr-FR');
const fmtNum = (v) => (parseFloat(v) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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

const NEEDS_COLUMNS = [
  { key: 'weight',              label: 'Poids' },
  { key: 'stock',               label: 'Stock' },
  { key: 'arrivage',            label: 'Arrivage' },
  { key: 'sales_in_period',     label: 'Ventes période' },
  { key: 'avg_monthly_sales',   label: 'Ventes/mois' },
  { key: 'tendance',            label: 'Tendance' },
  { key: 'theoretical_need',    label: 'Besoin théo.' },
  { key: 'supposed_need',       label: 'Besoin supp.' },
  { key: 'theoretical_proposal',label: 'Prop. théo.' },
  { key: 'supposed_proposal',   label: 'Prop. supp.' },
];

const NeedsTab = ({ token, onCompactChange }) => {
  // Cache des données brutes (chargé une fois par fournisseur)
  const [allProducts, setAllProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Préférences colonnes
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [compact, setCompact] = useState(false);
  const [showColumnPanel, setShowColumnPanel] = useState(false);

  const savedFilters = loadSavedFilters();

  const [supplierId, setSupplierId] = useState(savedFilters?.supplierId || '');
  const [brandFilter, setBrandFilter] = useState(savedFilters?.brandFilter || '');
  const [search, setSearch] = useState('');

  // Période d'analyse
  const [analysisPeriodType, setAnalysisPeriodType] = useState(savedFilters?.analysisPeriodType || 'preset');
  const [analysisPeriod, setAnalysisPeriod] = useState(savedFilters?.analysisPeriod || 30);
  const [analysisPeriodUnit, setAnalysisPeriodUnit] = useState(savedFilters?.analysisPeriodUnit || 'days');
  const [analysisStartDate, setAnalysisStartDate] = useState(savedFilters?.analysisStartDate || '');
  const [analysisEndDate, setAnalysisEndDate] = useState(savedFilters?.analysisEndDate || '');

  // Couverture cible
  const [coverageMonths, setCoverageMonths] = useState(savedFilters?.coverageMonths || 1);

  // Filtres 3 états : null = tout, true = oui seulement, false = non seulement
  const [withSalesOnly, setWithSalesOnly] = useState(savedFilters?.withSalesOnly ?? null);
  const [zeroStockState, setZeroStockState] = useState(savedFilters?.zeroStockState ?? null);

  // Pagination locale
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

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
      brandFilter,
      analysisPeriodType,
      analysisPeriod,
      analysisPeriodUnit,
      analysisStartDate,
      analysisEndDate,
      coverageMonths,
      withSalesOnly,
      zeroStockState
    });
  }, [supplierId, brandFilter, analysisPeriodType, analysisPeriod, analysisPeriodUnit, analysisStartDate, analysisEndDate, coverageMonths, withSalesOnly, zeroStockState]);

  // Charger les préférences de colonnes
  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/preferences/needs`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.success) {
          setHiddenColumns(res.data.hiddenColumns || []);
          const c = res.data.compact || false;
          setCompact(c);
          if (onCompactChange) onCompactChange(c);
        }
      } catch (err) {
        console.error('Erreur chargement préférences colonnes:', err);
      }
    };
    load();
  }, [token]);

  const savePreferences = async (cols, cmp) => {
    try {
      await axios.put(`${API_URL}/preferences/needs`, { hiddenColumns: cols, compact: cmp }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Erreur sauvegarde préférences colonnes:', err);
    }
  };

  const toggleColumn = (key) => {
    const next = hiddenColumns.includes(key)
      ? hiddenColumns.filter(k => k !== key)
      : [...hiddenColumns, key];
    setHiddenColumns(next);
    savePreferences(next, compact);
  };

  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    if (onCompactChange) onCompactChange(next);
    savePreferences(hiddenColumns, next);
  };

  const isVisible = (key) => !hiddenColumns.includes(key);

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
  // Chargement unique au montage — tout l'historique, pas de filtre
  const loadRawData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}/purchases/needs/raw`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAllProducts(response.data.data || []);
    } catch (err) {
      console.error('Erreur chargement données brutes:', err);
      setError('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadRawData();
  }, [loadRawData]);

  // Période d'analyse effective en jours
  const effectivePeriodDays = useMemo(() => {
    if (analysisPeriodType === 'custom' && analysisStartDate && analysisEndDate) {
      const start = new Date(analysisStartDate);
      const end = new Date(analysisEndDate);
      return Math.max(Math.ceil((end - start) / (1000 * 60 * 60 * 24)), 1);
    }
    if (analysisPeriodUnit === 'months') {
      return Math.round(analysisPeriod * 30);
    }
    return analysisPeriod; // déjà en jours
  }, [analysisPeriodType, analysisPeriod, analysisPeriodUnit, analysisStartDate, analysisEndDate]);

  const isCustomPeriod = analysisPeriodType === 'custom';

  // Calcul des besoins sur tous les produits (recalculé quand les paramètres changent, jamais sur rechargement)
  const computedProducts = useMemo(() => {
    return allProducts.map(p => {
      const needs = computeProductNeeds(
        p, effectivePeriodDays, coverageMonths,
        isCustomPeriod, analysisStartDate, analysisEndDate, analysisPeriodUnit
      );
      return { ...p, ...needs };
    });
  }, [allProducts, effectivePeriodDays, coverageMonths, isCustomPeriod, analysisStartDate, analysisEndDate, analysisPeriodUnit]);

  // Marques distinctes extraites des produits chargés
  const brands = useMemo(() => {
    const set = new Set();
    allProducts.forEach(p => p.brand && set.add(p.brand));
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [allProducts]);

  // Normalise une chaîne pour la recherche : minuscules, sans ponctuation, sans accents, espaces simplifiés
  const normalize = (str) => (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_.,;:!?()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Filtrage local — tout en JS sur le cache
  const filteredProducts = useMemo(() => {
    const searchNorm = normalize(search);
    const searchWords = searchNorm.length >= 2 ? searchNorm.split(' ').filter(Boolean) : [];
    const hasSearch = searchWords.length > 0;

    // Pour le filtre fournisseur : collecter les wp_parent_id dont au moins une variation a ce fournisseur
    // Ainsi toutes les variations d'un même parent sont affichées si l'une d'elles correspond
    const isRealParentId = (id) => id && id !== '0' && id !== 0;

    const parentIdsWithSupplier = supplierId
      ? new Set(
          computedProducts
            .filter(p => isRealParentId(p.wp_parent_id) && String(p.supplier_id) === String(supplierId))
            .map(p => p.wp_parent_id)
        )
      : null;

    return computedProducts.filter(p => {
      // Filtre fournisseur
      if (supplierId) {
        const matchesDirect = String(p.supplier_id) === String(supplierId);
        const matchesViaParent = isRealParentId(p.wp_parent_id) && parentIdsWithSupplier.has(p.wp_parent_id);
        if (!matchesDirect && !matchesViaParent) return false;
      }
      // Filtre marque
      if (brandFilter && p.brand !== brandFilter) return false;

      // Si recherche active, on affiche tous les correspondants (bypass filtre propositions)
      if (hasSearch) {
        const haystack = normalize(`${p.post_title} ${p.sku} ${p.brand} ${p.sub_brand}`);
        return searchWords.every(w => haystack.includes(w));
      }

      // Filtre "avec ventes"
      if (withSalesOnly === true && p.avg_monthly_sales <= 0) return false;
      if (withSalesOnly === false && p.avg_monthly_sales > 0) return false;

      // Filtre "stock nul/négatif"
      if (zeroStockState === true && p.stock > 0) return false;
      if (zeroStockState === false && p.stock <= 0) return false;

      // Par défaut : n'afficher que les produits avec une proposition
      if (p.theoretical_proposal <= 0 && p.supposed_proposal <= 0) return false;

      return true;
    });
  }, [computedProducts, search, supplierId, brandFilter, withSalesOnly, zeroStockState]);

  // Regrouper par parent : variations sous leur parent, simples seuls
  const groupedProducts = useMemo(() => {
    const groups = new Map(); // wp_parent_id → { parent info, children[] }
    const standalone = []; // produits simples

    for (const p of filteredProducts) {
      if (p.product_type === 'variation' && p.wp_parent_id) {
        if (!groups.has(p.wp_parent_id)) {
          groups.set(p.wp_parent_id, {
            parent_id: p.wp_parent_id,
            parent_title: p.parent_title || p.post_title.replace(/ - [^-]+$/, ''),
            image_url: p.image_url,
            children: []
          });
        }
        groups.get(p.wp_parent_id).children.push(p);
      } else {
        standalone.push({ parent_id: null, children: [p] });
      }
    }

    return [...groups.values(), ...standalone];
  }, [filteredProducts]);

  // Tri par groupe : position du groupe basee sur max (desc) ou min (asc) des enfants
  const sortedGroups = useMemo(() => {
    if (!sortColumn) return groupedProducts;
    return [...groupedProducts].sort((a, b) => {
      const getGroupVal = (group) => {
        const vals = group.children.map(c => c[sortColumn] ?? 0);
        if (typeof vals[0] === 'string') {
          return sortDirection === 'asc'
            ? vals.sort((x, y) => x.localeCompare(y))[0]
            : vals.sort((x, y) => y.localeCompare(x))[0];
        }
        return sortDirection === 'asc' ? Math.min(...vals) : Math.max(...vals);
      };
      const aVal = getGroupVal(a);
      const bVal = getGroupVal(b);
      if (typeof aVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [groupedProducts, sortColumn, sortDirection]);

  // Aplatir les groupes en lignes pour la pagination
  const flatRows = useMemo(() => {
    const rows = [];
    for (const group of sortedGroups) {
      if (group.parent_id && group.children.length > 0) {
        // Ligne parent
        const totalStock = group.children.reduce((s, c) => s + (c.stock || 0), 0);
        const firstChildSku = group.children[0]?.sku || '';
        const parentSku = firstChildSku.includes('-') ? firstChildSku.split('-')[0] : null;
        rows.push({
          _isParent: true,
          wp_product_id: group.parent_id,
          parent_title: group.parent_title,
          image_url: group.image_url,
          totalStock,
          parentSku
        });
        // Trier les enfants dans le groupe aussi
        const sortedChildren = [...group.children].sort((a, b) => {
          const aVal = a[sortColumn] ?? 0;
          const bVal = b[sortColumn] ?? 0;
          if (typeof aVal === 'string') {
            return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
          }
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
        for (const child of sortedChildren) {
          rows.push({ ...child, _isParent: false, _isVariation: true });
        }
      } else {
        rows.push({ ...group.children[0], _isParent: false, _isVariation: false });
      }
    }
    return rows;
  }, [sortedGroups, sortColumn, sortDirection]);

  // Pagination locale
  const totalFiltered = flatRows.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(flatRows.length / pageSize));
  const pagedProducts = useMemo(() => {
    if (pageSize === 0) return flatRows; // "Tout"
    const start = (page - 1) * pageSize;
    return flatRows.slice(start, start + pageSize);
  }, [flatRows, page, pageSize]);

  // Reset page quand les filtres changent (mais pas la sélection)
  useEffect(() => {
    setPage(1);
  }, [supplierId, brandFilter, withSalesOnly, zeroStockState, effectivePeriodDays, coverageMonths, analysisStartDate, analysisEndDate, pageSize]);

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
      const option = ANALYSIS_PERIOD_OPTIONS.find(o => String(o.value) === value);
      setAnalysisPeriod(parseFloat(value));
      setAnalysisPeriodUnit(option?.unit || 'days');
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
    if (stock === null || stock === undefined) return 'N/A';
    return fmtInt(stock);
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
    <div className="needs-tab" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div className="purchases-card" style={{ flexShrink: 0 }}>

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
            <label>Marque</label>
            <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="">Toutes les marques</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
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
                  ≈ {effectivePeriodDays} jours
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

          <div className="filter-group" style={{ marginLeft: 'auto', position: 'relative' }}>
            <label>&nbsp;</label>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowColumnPanel(p => !p)}
              style={{ whiteSpace: 'nowrap' }}
            >
              ⚙ Colonnes
            </button>
            {showColumnPanel && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 100,
                backgroundColor: '#fff', border: '1px solid #d1d5db',
                borderRadius: '8px', padding: '14px 16px', minWidth: '200px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)'
              }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '10px', color: '#374151' }}>
                  Colonnes visibles
                </div>
                {NEEDS_COLUMNS.map(col => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={isVisible(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '10px', paddingTop: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={compact}
                      onChange={toggleCompact}
                    />
                    Vue compacte
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Ligne secondaire : filtres 3 états + recherche + boutons */}
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

          <input
            type="text"
            placeholder="Rechercher produit ou SKU..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              padding: '6px 12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '13px',
              width: '220px'
            }}
          />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
              style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={0}>Tout</option>
            </select>
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
              <strong>{fmtInt(selectedCount)}</strong> produit(s) sélectionné(s) —
              <strong> {fmtInt(selectedTotal)}</strong> unités au total
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
      <div className="purchases-card" style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: 0 }}>
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
                  <th style={{ width: '40px' }}></th>
                  <th>Produit</th>
                  <th style={{ width: '30px' }}></th>
                  <th>SKU</th>
                  {isVisible('weight') && <th className="text-right">Poids</th>}
                  {isVisible('stock') && <SortableHeader column="stock" label="Stock" className="text-right" />}
                  {isVisible('arrivage') && <th className="text-right">Arrivage</th>}
                  {isVisible('sales_in_period') && <SortableHeader column="sales_in_period" label="Ventes période" className="text-right" />}
                  {isVisible('avg_monthly_sales') && <SortableHeader column="avg_monthly_sales" label="Ventes/mois" className="text-right" />}
                  {isVisible('tendance') && <th className="text-center">Tendance</th>}
                  {isVisible('theoretical_need') && <SortableHeader column="theoretical_need" label="Besoin théo." className="text-right" />}
                  {isVisible('supposed_need') && <SortableHeader column="supposed_need" label="Besoin supp." className="text-right" />}
                  {isVisible('theoretical_proposal') && <SortableHeader column="theoretical_proposal" label="Prop. théo." className="text-right" />}
                  {isVisible('supposed_proposal') && <SortableHeader column="supposed_proposal" label="Prop. supp." className="text-right" />}
                  <th className="text-right">À commander</th>
                </tr>
              </thead>
              <tbody>
                {(() => { let varIdx = 0; let simpleIdx = 0; return pagedProducts.map((row, idx) => { if (row._isParent) { varIdx = 0; } else if (row._isVariation) { varIdx++; } else { simpleIdx++; } return row._isParent ? (
                  <tr key={`parent-${row.parent_title}-${idx}`} className="row-parent" style={{ backgroundColor: '#135E84', color: '#ffffff', fontWeight: 600 }}>
                    <td>
                      {row.image_url ? (
                        <img src={row.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                      ) : <div style={{ width: '40px', height: '40px', backgroundColor: '#1e6fa0', borderRadius: '4px' }} />}
                    </td>
                    <td><a href={`/products/${row.wp_product_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} onMouseEnter={e => e.target.style.textDecoration = 'underline'} onMouseLeave={e => e.target.style.textDecoration = 'none'}>{row.parent_title}</a></td>
                    <td>
                      {row.parentSku && (
                        <a
                          href={`https://app.metorik.com/products/${row.parentSku}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Voir sur Metorik"
                          style={{ display: 'inline-flex', opacity: 0.7 }}
                          onMouseOver={e => e.currentTarget.style.opacity = 1}
                          onMouseOut={e => e.currentTarget.style.opacity = 0.7}
                        >
                          <img src="https://metorik.com/img/brand/logo-icon.png" alt="Metorik" style={{ width: '18px', height: '18px' }} />
                        </a>
                      )}
                    </td>
                    <td></td>
                    {isVisible('weight') && <td></td>}
                    {isVisible('stock') && <td className="text-right">{fmtInt(row.totalStock)}</td>}
                    {(() => { const span = ['arrivage','sales_in_period','avg_monthly_sales','tendance','theoretical_need','supposed_need','theoretical_proposal','supposed_proposal'].filter(k => isVisible(k)).length + 1; return <td colSpan={span}></td>; })()}
                  </tr>
                ) : (
                  <tr key={row.id} style={{ backgroundColor: row._isVariation ? (varIdx % 2 === 1 ? '#dbeafe' : '#eff6ff') : (simpleIdx % 2 === 1 ? '#ffffff' : '#f3f4f6') }}>
                    <td>
                      {row.image_url ? (
                        <img src={row.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                      ) : (
                        <div style={{ width: '40px', height: '40px', backgroundColor: '#e2e8f0', borderRadius: '4px' }} />
                      )}
                    </td>
                    <td>
                      <div style={{ maxWidth: '250px', paddingLeft: row._isVariation ? '30px' : 0 }}>
                        <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                          <a href={`/products/${row.wp_product_id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }} onMouseEnter={e => e.target.style.textDecoration = 'underline'} onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                            {row._isVariation ? row.post_title.replace(row.parent_title + ' - ', '').replace(row.parent_title, '') || row.post_title : row.post_title}
                          </a>
                        </div>
                        {row.supplier_name && (
                          <small style={{ color: '#666' }}>{row.supplier_name}</small>
                        )}
                      </div>
                    </td>
                    <td>
                      {!row._isVariation && row.sku && (
                        <a
                          href={`https://app.metorik.com/products/${row.sku}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Voir sur Metorik"
                          style={{ display: 'inline-flex', opacity: 0.7 }}
                          onMouseOver={e => e.currentTarget.style.opacity = 1}
                          onMouseOut={e => e.currentTarget.style.opacity = 0.7}
                        >
                          <img src="https://metorik.com/img/brand/logo-icon.png" alt="Metorik" style={{ width: '18px', height: '18px' }} />
                        </a>
                      )}
                    </td>
                    <td><code style={{ fontSize: '12px' }}>{row.sku || '-'}</code></td>
                    {isVisible('weight') && <td className="text-right" style={{ color: '#6b7280' }}>{row.weight ? parseFloat(row.weight).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }) : '-'}</td>}
                    {isVisible('stock') && <td className="text-right">{fmtInt(row.stock)}</td>}
                    {isVisible('arrivage') && <td className="text-right">{row.incoming_qty > 0 ? fmtInt(row.incoming_qty) : '-'}</td>}
                    {isVisible('sales_in_period') && <td className="text-right">{fmtInt(row.sales_in_period)}</td>}
                    {isVisible('avg_monthly_sales') && <td className="text-right">{fmtNum(row.avg_monthly_sales)}</td>}
                    {isVisible('tendance') && <td className="text-center">{renderTrend(row.trend_direction, row.trend_coefficient)}</td>}
                    {isVisible('theoretical_need') && <td className="text-right">{fmtInt(row.theoretical_need)}</td>}
                    {isVisible('supposed_need') && <td className="text-right">{fmtInt(row.supposed_need)}</td>}
                    {isVisible('theoretical_proposal') && <td className="text-right">{row.theoretical_proposal > 0 ? fmtInt(row.theoretical_proposal) : '-'}</td>}
                    {isVisible('supposed_proposal') && <td className="text-right">{row.supposed_proposal > 0 ? fmtInt(row.supposed_proposal) : '-'}</td>}
                    <td className="text-right">
                      <input
                        type="number"
                        className="qty-input"
                        min="0"
                        value={selectedProducts[row.id] || ''}
                        onChange={(e) => handleQtyChange(row.id, parseInt(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ); }); })()}
              </tbody>
            </table>

            {pageSize > 0 && totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  ← Précédent
                </button>
                <span className="pagination-info">Page {page} / {totalPages} ({filteredProducts.length} produits, {totalFiltered} lignes)</span>
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
