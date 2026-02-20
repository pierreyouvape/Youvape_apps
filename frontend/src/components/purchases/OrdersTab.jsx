import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const OrdersTab = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filters
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create order modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSupplierId, setCreateSupplierId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [orderItems, setOrderItems] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);

  const statusLabels = {
    draft: 'Brouillon',
    sent: 'Envoyée',
    confirmed: 'Confirmée',
    shipped: 'Expédiée',
    partial: 'Partielle',
    received: 'Reçue',
    cancelled: 'Annulée'
  };

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

  // Load orders
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSupplier) params.append('supplier_id', filterSupplier);
      if (filterStatus) params.append('status', filterStatus);

      const response = await axios.get(`${API_URL}/purchases/orders?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setOrders(response.data.data || []);
    } catch (err) {
      console.error('Erreur chargement commandes:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [token, filterSupplier, filterStatus]);

  // Open detail modal
  const openDetail = async (orderId) => {
    try {
      const response = await axios.get(`${API_URL}/purchases/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedOrder(response.data.data);
      setShowDetailModal(true);
    } catch (err) {
      console.error('Erreur chargement détail:', err);
    }
  };

  // Update order status
  const updateStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API_URL}/purchases/orders/${orderId}/status`, {
        status: newStatus
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadOrders();
      if (selectedOrder?.id === orderId) {
        openDetail(orderId);
      }
    } catch (err) {
      console.error('Erreur mise à jour statut:', err);
      alert('Erreur lors de la mise à jour du statut');
    }
  };

  // Delete draft order
  const deleteOrder = async (orderId) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce brouillon ?')) return;

    try {
      await axios.delete(`${API_URL}/purchases/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadOrders();
      setShowDetailModal(false);
    } catch (err) {
      console.error('Erreur suppression:', err);
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  // Export CSV
  const exportOrder = async (orderId, format) => {
    try {
      const response = await axios.get(`${API_URL}/purchases/orders/${orderId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${format}_PO-${orderId}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Erreur export:', err);
      alert('Erreur lors de l\'export');
    }
  };

  // Update received qty
  const updateReceivedQty = async (orderId, itemId, qty) => {
    try {
      await axios.put(`${API_URL}/purchases/orders/${orderId}/items/${itemId}/received`, {
        qty_received: qty
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      openDetail(orderId);
      loadOrders();
    } catch (err) {
      console.error('Erreur mise à jour réception:', err);
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Search products for create modal
  const handleProductSearch = (value) => {
    setProductSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);

    if (value.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchTimeout(setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await axios.get(`${API_URL}/products/search?q=${encodeURIComponent(value)}&limit=20`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        // Filter out products already in orderItems
        const existingIds = orderItems.map(item => item.product_id);
        const filtered = (response.data.data || []).filter(p => !existingIds.includes(p.id));
        setSearchResults(filtered);
      } catch (err) {
        console.error('Erreur recherche produits:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300));
  };

  // Add product to order
  const addProductToOrder = (product) => {
    setOrderItems(prev => [...prev, {
      product_id: product.id,
      product_name: product.post_title,
      sku: product.sku,
      stock: product.stock,
      qty_ordered: 1,
      unit_price: product.cost_price || null
    }]);
    setProductSearch('');
    setSearchResults([]);
  };

  // Remove product from order
  const removeProductFromOrder = (productId) => {
    setOrderItems(prev => prev.filter(item => item.product_id !== productId));
  };

  // Update quantity
  const updateItemQty = (productId, qty) => {
    setOrderItems(prev => prev.map(item =>
      item.product_id === productId ? { ...item, qty_ordered: Math.max(1, qty) } : item
    ));
  };

  // Create order from modal
  const handleCreateOrder = async (sendToBMS = false) => {
    if (!createSupplierId) {
      alert('Veuillez sélectionner un fournisseur');
      return;
    }
    if (orderItems.length === 0) {
      alert('Veuillez ajouter au moins un produit');
      return;
    }

    setCreatingOrder(true);
    try {
      const items = orderItems.map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        qty_ordered: item.qty_ordered,
        stock_before: item.stock || 0,
        supplier_sku: item.supplier_sku || null,
        unit_price: item.unit_price || null
      }));

      const response = await axios.post(`${API_URL}/purchases/orders`, {
        supplier_id: parseInt(createSupplierId),
        items,
        send_to_bms: sendToBMS
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Commande ${response.data.data?.order_number || ''} créée avec ${items.length} article(s)${sendToBMS ? ' et envoyée à BMS' : ''}`);
      setShowCreateModal(false);
      setCreateSupplierId('');
      setOrderItems([]);
      setProductSearch('');
      loadOrders();
    } catch (err) {
      console.error('Erreur création commande:', err);
      alert(err.response?.data?.error || 'Erreur lors de la création de la commande');
    } finally {
      setCreatingOrder(false);
    }
  };

  // Open create modal
  const openCreateModal = () => {
    setCreateSupplierId('');
    setOrderItems([]);
    setProductSearch('');
    setSearchResults([]);
    setShowCreateModal(true);
  };

  return (
    <div className="orders-tab">
      <div className="purchases-card">
        {/* Filters */}
        <div className="filters-bar" style={{ marginBottom: '20px' }}>
          <div className="filter-group">
            <label>Fournisseur</label>
            <select
              value={filterSupplier}
              onChange={e => setFilterSupplier(e.target.value)}
            >
              <option value="">Tous</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Statut</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
            >
              <option value="">Tous</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-secondary"
            onClick={loadOrders}
            style={{ marginLeft: 'auto' }}
          >
            🔄 Actualiser
          </button>
          <button
            className="btn btn-primary"
            onClick={openCreateModal}
          >
            + Créer une commande
          </button>
        </div>

        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p>Aucune commande</p>
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Créer une commande
            </button>
          </div>
        ) : (
          <table className="purchases-table">
            <thead>
              <tr>
                <th>N° Commande</th>
                <th>Fournisseur</th>
                <th className="text-center">Articles</th>
                <th className="text-center">Quantité</th>
                <th className="text-right">Montant</th>
                <th className="text-center">Statut</th>
                <th>Date création</th>
                <th>Date envoi</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <tr key={order.id}>
                  <td>
                    <strong style={{ color: '#f59e0b', cursor: 'pointer' }} onClick={() => openDetail(order.id)}>
                      {order.order_number}
                    </strong>
                  </td>
                  <td>{order.supplier_name}</td>
                  <td className="text-center">{order.total_items}</td>
                  <td className="text-center">{order.total_qty}</td>
                  <td className="text-right">
                    {order.total_amount > 0 ? `${parseFloat(order.total_amount).toFixed(2)} €` : '-'}
                  </td>
                  <td className="text-center">
                    <span className={`status-badge status-${order.status}`}>
                      {statusLabels[order.status]}
                    </span>
                  </td>
                  <td>{formatDate(order.created_at)}</td>
                  <td>{formatDate(order.order_date)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => openDetail(order.id)}
                        title="Détail"
                      >
                        👁️
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => exportOrder(order.id, 'supplier')}
                        title="Export fournisseur"
                      >
                        📄
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Order Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Créer une commande</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {/* Supplier selection */}
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label style={{ fontWeight: 600 }}>Fournisseur *</label>
                <select
                  value={createSupplierId}
                  onChange={e => setCreateSupplierId(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
                >
                  <option value="">-- Sélectionner un fournisseur --</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Product search */}
              <div className="form-group" style={{ marginBottom: '20px', position: 'relative' }}>
                <label style={{ fontWeight: 600 }}>Ajouter des produits</label>
                <input
                  type="text"
                  placeholder="Rechercher par nom ou SKU..."
                  value={productSearch}
                  onChange={e => handleProductSearch(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
                />
                {searchLoading && (
                  <div style={{ position: 'absolute', right: '10px', top: '35px', color: '#666' }}>...</div>
                )}
                {/* Search results dropdown */}
                {searchResults.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '0 0 6px 6px',
                    maxHeight: '250px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                  }}>
                    {searchResults.map(product => (
                      <div
                        key={product.id}
                        onClick={() => addProductToOrder(product)}
                        style={{
                          padding: '10px 15px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #eee',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{product.post_title}</div>
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            SKU: {product.sku || '-'} | Stock: {product.stock ?? 'N/A'}
                          </div>
                        </div>
                        <span style={{ color: '#10b981', fontSize: '18px' }}>+</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order items */}
              <div style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '10px' }}>Articles ({orderItems.length})</h4>
                {orderItems.length === 0 ? (
                  <div style={{ padding: '30px', textAlign: 'center', background: '#f9fafb', borderRadius: '6px', color: '#666' }}>
                    Aucun produit ajouté
                  </div>
                ) : (
                  <table className="purchases-table">
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th>SKU</th>
                        <th className="text-center">Stock</th>
                        <th className="text-center" style={{ width: '100px' }}>Quantité</th>
                        <th style={{ width: '50px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map(item => (
                        <tr key={item.product_id}>
                          <td style={{ maxWidth: '250px' }}>{item.product_name}</td>
                          <td><code>{item.sku || '-'}</code></td>
                          <td className="text-center">{item.stock ?? '-'}</td>
                          <td className="text-center">
                            <input
                              type="number"
                              className="qty-input"
                              min="1"
                              value={item.qty_ordered}
                              onChange={e => updateItemQty(item.product_id, parseInt(e.target.value) || 1)}
                              style={{ width: '70px' }}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => removeProductFromOrder(item.product_id)}
                              title="Retirer"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Summary */}
              {orderItems.length > 0 && (
                <div style={{ marginTop: '15px', padding: '10px 15px', background: '#fef3c7', borderRadius: '6px' }}>
                  <strong>{orderItems.length}</strong> produit(s) -
                  <strong> {orderItems.reduce((sum, item) => sum + item.qty_ordered, 0)}</strong> unités au total
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Annuler
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleCreateOrder(false)}
                disabled={creatingOrder || !createSupplierId || orderItems.length === 0}
              >
                {creatingOrder ? 'Création...' : '💾 Sauvegarder (Brouillon)'}
              </button>
              <button
                className="btn"
                onClick={() => handleCreateOrder(true)}
                disabled={creatingOrder || !createSupplierId || orderItems.length === 0}
                style={{ background: '#6366f1', color: 'white', border: 'none' }}
              >
                {creatingOrder ? 'Création...' : '🚀 Créer dans BMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedOrder && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content" style={{ maxWidth: '900px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Commande {selectedOrder.order_number}</h3>
              <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
            </div>
            <div className="modal-body">
              {/* Order info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div>
                  <strong>Fournisseur</strong>
                  <div>{selectedOrder.supplier_name}</div>
                </div>
                <div>
                  <strong>Statut</strong>
                  <div>
                    <span className={`status-badge status-${selectedOrder.status}`}>
                      {statusLabels[selectedOrder.status]}
                    </span>
                  </div>
                </div>
                <div>
                  <strong>Créée le</strong>
                  <div>{formatDate(selectedOrder.created_at)}</div>
                </div>
              </div>

              {/* Status actions */}
              <div style={{ marginBottom: '20px', padding: '10px', background: '#f8f9fa', borderRadius: '6px' }}>
                <strong style={{ marginRight: '15px' }}>Changer le statut :</strong>
                {selectedOrder.status === 'draft' && (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => updateStatus(selectedOrder.id, 'sent')}>
                      📤 Marquer envoyée
                    </button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: '10px' }} onClick={() => deleteOrder(selectedOrder.id)}>
                      🗑️ Supprimer
                    </button>
                  </>
                )}
                {selectedOrder.status === 'sent' && (
                  <>
                    <button className="btn btn-sm btn-success" onClick={() => updateStatus(selectedOrder.id, 'confirmed')}>
                      ✓ Confirmée
                    </button>
                    <button className="btn btn-sm btn-secondary" style={{ marginLeft: '10px' }} onClick={() => updateStatus(selectedOrder.id, 'cancelled')}>
                      ✗ Annuler
                    </button>
                  </>
                )}
                {selectedOrder.status === 'confirmed' && (
                  <button className="btn btn-sm btn-primary" onClick={() => updateStatus(selectedOrder.id, 'shipped')}>
                    🚚 Expédiée
                  </button>
                )}
                {(selectedOrder.status === 'shipped' || selectedOrder.status === 'partial') && (
                  <button className="btn btn-sm btn-success" onClick={() => updateStatus(selectedOrder.id, 'received')}>
                    ✓ Tout reçu
                  </button>
                )}
              </div>

              {/* Items */}
              <h4 style={{ marginBottom: '10px' }}>Articles ({selectedOrder.items?.length || 0})</h4>
              <table className="purchases-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Réf.</th>
                    <th className="text-right">Commandé</th>
                    <th className="text-right">Reçu</th>
                    <th className="text-right">Prix unit.</th>
                    <th>Stock avant</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map(item => (
                    <tr key={item.id}>
                      <td style={{ maxWidth: '300px' }}>{item.product_name}</td>
                      <td><code>{item.supplier_sku || item.product_sku || '-'}</code></td>
                      <td className="text-right">{item.qty_ordered}</td>
                      <td className="text-right">
                        {['shipped', 'partial'].includes(selectedOrder.status) ? (
                          <input
                            type="number"
                            className="qty-input"
                            min="0"
                            max={item.qty_ordered}
                            value={item.qty_received}
                            onChange={e => updateReceivedQty(selectedOrder.id, item.id, parseInt(e.target.value) || 0)}
                          />
                        ) : (
                          item.qty_received
                        )}
                      </td>
                      <td className="text-right">
                        {item.unit_price ? `${parseFloat(item.unit_price).toFixed(2)} €` : '-'}
                      </td>
                      <td>{item.stock_before ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Notes */}
              {selectedOrder.notes && (
                <div style={{ marginTop: '20px', padding: '10px', background: '#fef3c7', borderRadius: '6px' }}>
                  <strong>Notes :</strong> {selectedOrder.notes}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => exportOrder(selectedOrder.id, 'supplier')}>
                📄 Export fournisseur
              </button>
              <button className="btn btn-secondary" onClick={() => exportOrder(selectedOrder.id, 'warehouse')}>
                📦 Export warehouse
              </button>
              <button className="btn btn-primary" onClick={() => setShowDetailModal(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersTab;
