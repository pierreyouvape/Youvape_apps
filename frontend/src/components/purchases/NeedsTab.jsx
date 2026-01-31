import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const NeedsTab = ({ token }) => {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [supplierId, setSupplierId] = useState('');
  const [zeroStock, setZeroStock] = useState(false);
  const [search, setSearch] = useState('');
  const [coverageMonths, setCoverageMonths] = useState(1);
  const [analysisPeriod, setAnalysisPeriod] = useState(1);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Order creation
  const [selectedProducts, setSelectedProducts] = useState({});
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Load suppliers for filter
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

  // Load products with needs
  const loadNeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: ((page - 1) * limit).toString()
      });

      if (supplierId) params.append('supplier_id', supplierId);
      if (zeroStock) params.append('zero_stock', 'true');
      if (search) params.append('search', search);
      if (coverageMonths) params.append('coverage_months', coverageMonths.toString());
      if (analysisPeriod) params.append('analysis_period', analysisPeriod.toString());

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
  }, [token, page, supplierId, zeroStock, search, coverageMonths, analysisPeriod]);

  useEffect(() => {
    loadNeeds();
  }, [loadNeeds]);

  // Handle search with debounce
  const [searchTimeout, setSearchTimeout] = useState(null);
  const handleSearchChange = (value) => {
    setSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    setSearchTimeout(setTimeout(() => {
      setPage(1);
    }, 500));
  };

  // Handle quantity change for order
  const handleQtyChange = (productId, qty) => {
    if (qty > 0) {
      setSelectedProducts(prev => ({
        ...prev,
        [productId]: qty
      }));
    } else {
      setSelectedProducts(prev => {
        const newSelected = { ...prev };
        delete newSelected[productId];
        return newSelected;
      });
    }
  };

  // Auto-fill with theoretical proposal
  const fillTheoreticalProposals = () => {
    const newSelected = {};
    products.forEach(p => {
      if (p.theoretical_proposal > 0) {
        newSelected[p.id] = p.theoretical_proposal;
      }
    });
    setSelectedProducts(newSelected);
  };

  // Auto-fill with supposed proposal
  const fillSupposedProposals = () => {
    const newSelected = {};
    products.forEach(p => {
      if (p.supposed_proposal > 0) {
        newSelected[p.id] = p.supposed_proposal;
      }
    });
    setSelectedProducts(newSelected);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedProducts({});
  };

  // Create order from selection
  const createOrder = async () => {
    const selectedCount = Object.keys(selectedProducts).length;
    if (selectedCount === 0) {
      alert('Aucun produit sélectionné');
      return;
    }

    if (!supplierId) {
      alert('Veuillez sélectionner un fournisseur');
      return;
    }

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
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

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

  // Render trend indicator
  const renderTrend = (direction, coefficient) => {
    if (direction === 'up') {
      return <span className="trend-up">↗ ×{coefficient}</span>;
    } else if (direction === 'down') {
      return <span className="trend-down">↘ ×{coefficient}</span>;
    }
    return <span className="trend-stable">→</span>;
  };

  // Render stock with color
  const renderStock = (stock) => {
    if (stock === null || stock === undefined) {
      return <span className="stock-zero">N/A</span>;
    }
    if (stock <= 0) {
      return <span className="stock-zero">{stock}</span>;
    }
    if (stock < 5) {
      return <span className="stock-critical">{stock}</span>;
    }
    if (stock < 20) {
      return <span className="stock-low">{stock}</span>;
    }
    return <span className="stock-ok">{stock}</span>;
  };

  const selectedCount = Object.keys(selectedProducts).length;
  const selectedTotal = Object.values(selectedProducts).reduce((a, b) => a + b, 0);

  return (
    <div className="needs-tab">
      {/* Filters */}
      <div className="purchases-card">
        <div className="filters-bar">
          <div className="filter-group">
            <label>Fournisseur</label>
            <select
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); setPage(1); }}
            >
              <option value="">Tous les fournisseurs</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
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
            <select
              value={analysisPeriod}
              onChange={(e) => { setAnalysisPeriod(parseFloat(e.target.value)); setPage(1); }}
            >
              <option value="0.5">15 jours</option>
              <option value="1">1 mois</option>
              <option value="2">2 mois</option>
              <option value="3">3 mois</option>
              <option value="6">6 mois</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Couverture cible</label>
            <select
              value={coverageMonths}
              onChange={(e) => { setCoverageMonths(parseFloat(e.target.value)); setPage(1); }}
            >
              <option value="0.5">15 jours</option>
              <option value="1">1 mois</option>
              <option value="1.5">1.5 mois</option>
              <option value="2">2 mois</option>
              <option value="3">3 mois</option>
            </select>
          </div>

          <div className="filter-group">
            <label>&nbsp;</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={zeroStock}
                onChange={(e) => { setZeroStock(e.target.checked); setPage(1); }}
              />
              Stock nul/négatif
            </label>
          </div>
        </div>

        <div className="filters-bar" style={{ marginTop: '10px', justifyContent: 'flex-end' }}>
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

        {/* Selection summary */}
        {selectedCount > 0 && (
          <div style={{
            background: '#fef3c7',
            padding: '10px 15px',
            borderRadius: '6px',
            marginBottom: '15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>
              <strong>{selectedCount}</strong> produit(s) sélectionné(s) -
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
                  <th className="text-right">Stock</th>
                  <th className="text-right">Arrivage</th>
                  <th className="text-right">Ventes/mois</th>
                  <th className="text-center">Tendance</th>
                  <th className="text-right">Besoin théo.</th>
                  <th className="text-right">Besoin supp.</th>
                  <th className="text-right">Prop. théo.</th>
                  <th className="text-right">Prop. supp.</th>
                  <th className="text-right">À commander</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id}>
                    <td>
                      <div style={{ maxWidth: '250px' }}>
                        <div style={{ fontWeight: 500, marginBottom: '2px' }}>
                          {product.post_title}
                        </div>
                        {product.supplier_name && (
                          <small style={{ color: '#666' }}>
                            🏭 {product.supplier_name}
                          </small>
                        )}
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: '12px' }}>{product.sku || '-'}</code>
                    </td>
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
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                          {product.theoretical_proposal}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="text-right">
                      {product.supposed_proposal > 0 ? (
                        <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                          {product.supposed_proposal}
                        </span>
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

            {/* Pagination */}
            <div className="pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Précédent
              </button>
              <span className="pagination-info">
                Page {page} / {totalPages} ({total} produits)
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
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
