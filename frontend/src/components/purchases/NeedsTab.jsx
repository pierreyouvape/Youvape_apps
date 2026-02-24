import { useState, useEffect, useCallback } from 'react';
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

// Cycle 3 états : null → true → false → null
const cycleTriState = (current) => {
  if (current === null) return true;
  if (current === true) return false;
  return null;
};

// Rendu du bouton 3 états
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

const NeedsTab = ({ token }) => {
  const [products, setProducts] = useState([]);
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

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Order creation
  const [selectedProducts, setSelectedProducts] = useState({});
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Tri des colonnes
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

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

  // Load suppliers
  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const response = await axios.get(`${API_URL}/purchases/suppliers`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSuppliers(response.data.data || []);
      } catch (err) {
        console.error('Erreur chargement fournisseurs:', err);
      }
    };
    loadSuppliers();
  }, [token]);

  const getEffectiveAnalysisPeriod = useCallback(() => {
    if (analysisPeriodType === 'custom' && analysisStartDate && analysisEndDate) {
      const start = new Date(analysisStartDate);
      const end = new Date(analysisEndDate);
      const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      return diffDays / 30;
    }
    return analysisPeriod;
  }, [analysisPeriodType, analysisPeriod, analysisStartDate, analysisEndDate]);

  const loadNeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: ((page - 1) * limit).toString()
      });

      if (supplierId) params.append('supplier_id', supplierId);
      if (search) params.append('search', search);

      // Filtres 3 états
      if (withSalesOnly === true) params.append('with_sales_only', 'true');
      if (withSalesOnly === false) params.append('with_sales_only', 'false');
      if (zeroStockState === true) params.append('zero_stock', 'true');
      if (zeroStockState === false) params.append('zero_stock', 'false');

      const effectivePeriod = getEffectiveAnalysisPeriod();
      params.append('analysis_period', effectivePeriod.toString());

      if (analysisPeriodType === 'custom' && analysisStartDate && analysisEndDate) {
        params.append('analysis_start_date', analysisStartDate);
        params.append('analysis_end_date', analysisEndDate);
      }

      params.append('coverage_months', coverageMonths.toString());

      const response = await axios.get(`${API_URL}/purchases/needs?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setProducts(response.data.data || []);
      setTotal(response.data.pagination?.total || 0);
      setTotalPages(response.data.pagination?.pages || 1);
    } catch (err) {
      console.error('Erreur chargement besoins:', err);
      setError('Erreur lors du chargement des besoins');
    } finally {
      setLoading(false);
    }
  }, [token, page, supplierId, search, coverageMonths, getEffectiveAnalysisPeriod, analysisPeriodType, analysisStartDate, analysisEndDate, withSalesOnly, zeroStockState]);

  useEffect(() => {
    loadNeeds();
  }, [loadNeeds]);

  const [searchTimeout, setSearchTimeout] = useState(null);
  const handleSearchChange = (value) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => setPage(1), 500));
  };

  const handleAnalysisPeriodChange = (value) => {
    if (value === 'custom') {
      setAnalysisPeriodType('custom');
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      setAnalysisEndDate(end.toISOString().split('T')[0]);
      setAnalysisStartDate(start.toISOString().split('T')[0]);
    } else {
      setAnalysisPeriodType('preset');
      setAnalysisPeriod(parseFloat(value));
    }
    setPage(1);
  };

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
    const next = {};
    products.forEach(p => { if (p.theoretical_proposal > 0) next[p.id] = p.theoretical_proposal; });
    setSelectedProducts(next);
  };

  const fillSupposedProposals = () => {
    const next = {};
    products.forEach(p => { if (p.supposed_proposal > 0) next[p.id] = p.supposed_proposal; });
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
        const product = products.find(p => p.id === parseInt(productId));
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
      loadNeeds();
    } catch (err) {
      console.error('Erreur création commande:', err);
      alert('Erreur lors de la création de la commande');
    } finally {
      setCreatingOrder(false);
    }
  };

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
      setSortDirection('asc');
    }
  };

  const sortedProducts = [...products].sort((a, b) => {
    if (!sortColumn) return 0;
    const aVal = a[sortColumn] ?? 0;
    const bVal = b[sortColumn] ?? 0;
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });

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
            <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPage(1); }}>
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
                  onChange={(e) => { setAnalysisStartDate(e.target.value); setPage(1); }}
                />
              </div>
              <div className="filter-group">
                <label>Date fin</label>
                <input
                  type="date"
                  value={analysisEndDate}
                  onChange={(e) => { setAnalysisEndDate(e.target.value); setPage(1); }}
                />
              </div>
              <div className="filter-group" style={{ justifyContent: 'flex-end' }}>
                <label>&nbsp;</label>
                <span style={{ fontSize: '13px', color: '#888', padding: '8px 0' }}>
                  ≈ {Math.round(getEffectiveAnalysisPeriod() * 10) / 10} mois
                </span>
              </div>
            </>
          )}

          <div className="filter-group">
            <label>Couverture cible</label>
            <select value={coverageMonths} onChange={(e) => { setCoverageMonths(parseFloat(e.target.value)); setPage(1); }}>
              {COVERAGE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>

        {/* Ligne secondaire : filtres 3 états + boutons */}
        <div className="filters-bar" style={{ marginTop: '10px', marginBottom: 0 }}>
          <TriStateCheckbox
            value={withSalesOnly}
            onChange={(v) => { setWithSalesOnly(v); setPage(1); }}
            label="Avec ventes"
          />
          <TriStateCheckbox
            value={zeroStockState}
            onChange={(v) => { setZeroStockState(v); setPage(1); }}
            label="Stock nul/négatif"
          />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
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
            <p>Chargement des besoins...</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p style={{ color: '#ef4444' }}>{error}</p>
            <button className="btn btn-primary" onClick={loadNeeds}>Réessayer</button>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p>Aucun produit trouvé</p>
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
                  <SortableHeader column="effective_theoretical_need" label="Besoin théo." className="text-right" />
                  <SortableHeader column="effective_supposed_need" label="Besoin supp." className="text-right" />
                  <SortableHeader column="theoretical_proposal" label="Prop. théo." className="text-right" />
                  <SortableHeader column="supposed_proposal" label="Prop. supp." className="text-right" />
                  <th className="text-right">À commander</th>
                </tr>
              </thead>
              <tbody>
                {sortedProducts.map(product => (
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
                    <td className="text-right">{product.effective_theoretical_need || 0}</td>
                    <td className="text-right">{product.effective_supposed_need || 0}</td>
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

            <div className="pagination">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                ← Précédent
              </button>
              <span className="pagination-info">Page {page} / {totalPages} ({total} produits)</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Suivant →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NeedsTab;
