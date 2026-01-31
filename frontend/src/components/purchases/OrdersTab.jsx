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
        </div>

        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <p>Aucune commande</p>
            <p style={{ color: '#666', fontSize: '14px' }}>
              Créez une commande depuis l'onglet Besoins
            </p>
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
