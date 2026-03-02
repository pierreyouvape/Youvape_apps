import { useState, useEffect, useContext } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import CopyButton from '../components/CopyButton';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const WC_ADMIN_URL = 'https://youvape.com/wp-admin/post.php';

const CatalogProductDetail = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const { id } = useParams();
  const headers = { Authorization: `Bearer ${token}` };

  const [product, setProduct] = useState(null);
  const [needs, setNeeds] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('general');
  const [expandedSupplier, setExpandedSupplier] = useState(null);
  const [supplierHistory, setSupplierHistory] = useState({});
  const [editingSupplier, setEditingSupplier] = useState({});
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) fetchAll();
  }, [id]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // Fetch product first to get wp_product_id for needs
      const [productRes, suppliersRes] = await Promise.all([
        axios.get(`${API_URL}/products/${id}/catalog`, { headers }),
        axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers })
      ]);
      if (productRes.data.success) {
        const prod = productRes.data.data;
        setProduct(prod);
        // Needs uses wp_product_id (order_items.product_id = wp_product_id)
        try {
          const needsRes = await axios.get(`${API_URL}/purchases/needs/${prod.wp_product_id}`, { headers });
          if (needsRes.data?.data) setNeeds(needsRes.data.data);
        } catch (e) { /* needs may not exist */ }
      }
      if (suppliersRes.data.success) setSuppliers(suppliersRes.data.data);
    } catch (err) {
      console.error('Error fetching product:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllSuppliers = async () => {
    try {
      const res = await axios.get(`${API_URL}/purchases/suppliers`, { headers });
      if (res.data.success) setAllSuppliers(res.data.data);
    } catch (err) {
      console.error('Error fetching suppliers:', err);
    }
  };

  const fetchSupplierHistory = async (supplierId) => {
    try {
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers/${supplierId}/history`, { headers });
      if (res.data.success) {
        setSupplierHistory(prev => ({ ...prev, [supplierId]: res.data.data }));
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const handleToggleExpand = (supplierId) => {
    if (expandedSupplier === supplierId) {
      setExpandedSupplier(null);
    } else {
      setExpandedSupplier(supplierId);
      if (!supplierHistory[supplierId]) {
        fetchSupplierHistory(supplierId);
      }
    }
  };

  const handleEditChange = (supplierId, field, value) => {
    setEditingSupplier(prev => ({
      ...prev,
      [supplierId]: { ...(prev[supplierId] || {}), [field]: value }
    }));
  };

  const handleSaveSupplier = async (supplierId) => {
    const data = editingSupplier[supplierId];
    if (!data) return;
    setSaving(true);
    try {
      await axios.put(`${API_URL}/purchases/suppliers/${supplierId}/products/${id}`, data, { headers });
      setEditingSupplier(prev => { const n = { ...prev }; delete n[supplierId]; return n; });
      // Refresh suppliers
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {
      console.error('Error saving supplier:', err);
      alert('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSupplier = async (supplierId, supplierName) => {
    if (!confirm(`Retirer ${supplierName} de ce produit ?`)) return;
    try {
      await axios.delete(`${API_URL}/purchases/suppliers/${supplierId}/products/${id}`, { headers });
      setSuppliers(prev => prev.filter(s => s.id !== supplierId));
    } catch (err) {
      console.error('Error removing supplier:', err);
      alert('Erreur lors de la suppression');
    }
  };

  const handleSetPrimary = async (supplierId) => {
    try {
      await axios.put(`${API_URL}/purchases/products/${id}/primary-supplier`, { supplier_id: supplierId }, { headers });
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {
      console.error('Error setting primary:', err);
    }
  };

  const handleAddSupplier = async () => {
    if (!newSupplierId) return;
    try {
      await axios.post(`${API_URL}/purchases/suppliers/${newSupplierId}/products`, {
        product_id: parseInt(id),
        is_primary: suppliers.length === 0
      }, { headers });
      setAddingSupplier(false);
      setNewSupplierId('');
      const res = await axios.get(`${API_URL}/purchases/products/${id}/suppliers`, { headers });
      if (res.data.success) setSuppliers(res.data.data);
    } catch (err) {
      console.error('Error adding supplier:', err);
      alert('Erreur lors de l\'ajout');
    }
  };

  const getEditValue = (supplier, field) => {
    if (editingSupplier[supplier.id] && editingSupplier[supplier.id][field] !== undefined) {
      return editingSupplier[supplier.id][field];
    }
    return supplier[field] ?? '';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = dateStr.substring(0, 10).split('-');
    return `${d[2]}/${d[1]}/${d[0]}`;
  };

  const statusLabels = {
    draft: 'Brouillon', sent: 'Envoyee', confirmed: 'Attendu',
    shipped: 'Expediee', partial: 'Partielle', received: 'Recue', cancelled: 'Annulee'
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6b7280' }}>Chargement...</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#ef4444' }}>Produit non trouve</p>
      </div>
    );
  }

  const tabStyle = (tab) => ({
    padding: '10px 24px',
    border: 'none',
    borderBottom: activeTab === tab ? '3px solid #135E84' : '3px solid transparent',
    backgroundColor: 'transparent',
    color: activeTab === tab ? '#135E84' : '#6b7280',
    fontWeight: activeTab === tab ? '600' : '400',
    fontSize: '15px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  });

  const cardStyle = {
    backgroundColor: '#fff',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    padding: '20px',
    marginBottom: '16px'
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button
          onClick={() => navigate('/catalog')}
          style={{
            position: 'absolute', left: '20px', padding: '10px 20px',
            backgroundColor: '#fff', color: '#135E84', border: 'none',
            borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600'
          }}
        >
          Retour
        </button>
      </div>

      {/* Product Header */}
      <div style={{ maxWidth: '1200px', margin: '30px auto 0', padding: '0 20px', width: '100%' }}>
        <div style={{ ...cardStyle, display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
          {/* Image */}
          <div style={{ flexShrink: 0 }}>
            {product.image_url ? (
              <img src={product.image_url} alt="" style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px' }} />
            ) : (
              <div style={{
                width: '120px', height: '120px', backgroundColor: '#e5e7eb', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '32px'
              }}>?</div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: '22px', color: '#111827' }}>{product.post_title}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '15px', color: '#6b7280' }}>{product.sku}</span>
              <CopyButton text={product.sku} size={14} />
            </div>
            <a
              href={`${WC_ADMIN_URL}?post=${product.wp_product_id}&action=edit`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', padding: '6px 14px', backgroundColor: '#7c3aed',
                color: '#fff', borderRadius: '4px', fontSize: '13px', textDecoration: 'none'
              }}
            >
              Voir sur WooCommerce
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '20px' }}>
          <button style={tabStyle('general')} onClick={() => setActiveTab('general')}>General</button>
          <button style={tabStyle('suppliers')} onClick={() => { setActiveTab('suppliers'); if (allSuppliers.length === 0) fetchAllSuppliers(); }}>Fournisseurs</button>
        </div>

        {/* Tab: General */}
        {activeTab === 'general' && (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Stock</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Arrivages prevus</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Besoin theorique</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', color: '#6b7280', fontSize: '13px', fontWeight: '600' }}>Besoin suppose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{
                    padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700',
                    color: parseInt(product.stock) <= 0 ? '#ef4444' : '#111827'
                  }}>
                    {parseInt(product.stock) || 0}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: product.incoming_qty > 0 ? '#059669' : '#6b7280' }}>
                    {product.incoming_qty || 0}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
                    {needs?.theoretical_need ?? '-'}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#111827' }}>
                    {needs?.supposed_need ?? '-'}
                  </td>
                </tr>
              </tbody>
            </table>
            {needs && (
              <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: '#f3f4f6', borderRadius: '6px', fontSize: '13px', color: '#6b7280' }}>
                Ventes moyennes/mois : <strong>{needs.avg_monthly_sales}</strong> |
                Tendance : <strong>{needs.trend_coefficient}x</strong> ({needs.trend_direction === 'up' ? 'hausse' : needs.trend_direction === 'down' ? 'baisse' : 'stable'}) |
                Max commande : <strong>{needs.max_order_qty_12m}</strong>
              </div>
            )}
          </div>
        )}

        {/* Tab: Suppliers */}
        {activeTab === 'suppliers' && (
          <div>
            {/* Add supplier button */}
            {!addingSupplier ? (
              <button
                onClick={() => { setAddingSupplier(true); if (allSuppliers.length === 0) fetchAllSuppliers(); }}
                style={{
                  padding: '8px 16px', backgroundColor: '#059669', color: '#fff',
                  border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '16px'
                }}
              >
                + Ajouter un fournisseur
              </button>
            ) : (
              <div style={{ ...cardStyle, display: 'flex', gap: '12px', alignItems: 'center' }}>
                <select
                  value={newSupplierId}
                  onChange={(e) => setNewSupplierId(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', flex: 1 }}
                >
                  <option value="">Selectionner un fournisseur...</option>
                  {allSuppliers
                    .filter(s => !suppliers.find(ps => ps.id === s.id))
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                  }
                </select>
                <button onClick={handleAddSupplier} disabled={!newSupplierId} style={{
                  padding: '8px 16px', backgroundColor: newSupplierId ? '#059669' : '#d1d5db',
                  color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: newSupplierId ? 'pointer' : 'not-allowed'
                }}>Ajouter</button>
                <button onClick={() => { setAddingSupplier(false); setNewSupplierId(''); }} style={{
                  padding: '8px 16px', backgroundColor: '#6b7280', color: '#fff',
                  border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
                }}>Annuler</button>
              </div>
            )}

            {suppliers.length === 0 && !addingSupplier && (
              <div style={{ ...cardStyle, textAlign: 'center', color: '#6b7280' }}>
                Aucun fournisseur associe a ce produit
              </div>
            )}

            {suppliers.map(supplier => (
              <div key={supplier.id} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                {/* Supplier row */}
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  {/* Name + badges */}
                  <div style={{ minWidth: '160px' }}>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
                      {supplier.name}
                      {supplier.is_primary && (
                        <span style={{
                          marginLeft: '8px', padding: '2px 8px', backgroundColor: '#dbeafe',
                          color: '#1d4ed8', borderRadius: '4px', fontSize: '11px', fontWeight: '600'
                        }}>Principal</span>
                      )}
                    </div>
                  </div>

                  {/* Editable fields */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Ref fournisseur
                      <input
                        type="text"
                        value={getEditValue(supplier, 'supplier_sku')}
                        onChange={(e) => handleEditChange(supplier.id, 'supplier_sku', e.target.value)}
                        style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '130px', marginTop: '2px' }}
                      />
                    </label>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Pack qty
                      <input
                        type="number"
                        min="1"
                        value={getEditValue(supplier, 'pack_qty')}
                        onChange={(e) => handleEditChange(supplier.id, 'pack_qty', parseInt(e.target.value) || 1)}
                        style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '80px', marginTop: '2px' }}
                      />
                    </label>
                    <label style={{ fontSize: '12px', color: '#6b7280' }}>
                      Prix HT
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={getEditValue(supplier, 'supplier_price')}
                        onChange={(e) => handleEditChange(supplier.id, 'supplier_price', e.target.value)}
                        style={{ display: 'block', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', width: '100px', marginTop: '2px' }}
                      />
                    </label>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {editingSupplier[supplier.id] && (
                      <button
                        onClick={() => handleSaveSupplier(supplier.id)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px', backgroundColor: '#059669', color: '#fff',
                          border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
                        }}
                      >Sauvegarder</button>
                    )}
                    {!supplier.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(supplier.id)}
                        title="Definir comme principal"
                        style={{
                          padding: '6px 12px', backgroundColor: '#3b82f6', color: '#fff',
                          border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
                        }}
                      >Principal</button>
                    )}
                    <button
                      onClick={() => handleToggleExpand(supplier.id)}
                      style={{
                        padding: '6px 12px', backgroundColor: '#f3f4f6', color: '#374151',
                        border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
                      }}
                    >{expandedSupplier === supplier.id ? 'Replier' : 'Historique'}</button>
                    <button
                      onClick={() => handleRemoveSupplier(supplier.id, supplier.name)}
                      style={{
                        padding: '6px 12px', backgroundColor: '#fee2e2', color: '#dc2626',
                        border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer'
                      }}
                    >Retirer</button>
                  </div>
                </div>

                {/* Expanded: History */}
                {expandedSupplier === supplier.id && (
                  <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 20px', backgroundColor: '#f9fafb' }}>
                    {!supplierHistory[supplier.id] ? (
                      <p style={{ color: '#6b7280', fontSize: '13px' }}>Chargement...</p>
                    ) : supplierHistory[supplier.id].length === 0 ? (
                      <p style={{ color: '#6b7280', fontSize: '13px' }}>Aucun historique de commande</p>
                    ) : (
                      <>
                        {/* Price evolution mini chart (text-based for now) */}
                        <div style={{ marginBottom: '16px' }}>
                          <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#374151' }}>Evolution du prix d'achat</h4>
                          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            {supplierHistory[supplier.id]
                              .filter(h => h.unit_price)
                              .slice(0, 10)
                              .reverse()
                              .map((h, i) => (
                                <div key={i} style={{ textAlign: 'center', fontSize: '11px', color: '#6b7280' }}>
                                  <div style={{ fontWeight: '600', color: '#111827', fontSize: '13px' }}>
                                    {parseFloat(h.unit_price).toFixed(2)} EUR
                                  </div>
                                  <div>{formatDate(h.order_date)}</div>
                                </div>
                              ))
                            }
                          </div>
                        </div>

                        {/* Orders table */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Date</th>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Reference</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Cmd</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Recu</th>
                              <th style={{ padding: '8px 10px', textAlign: 'right', color: '#6b7280', fontWeight: '600' }}>Prix unit.</th>
                              <th style={{ padding: '8px 10px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Statut</th>
                            </tr>
                          </thead>
                          <tbody>
                            {supplierHistory[supplier.id].map((h, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '8px 10px' }}>{formatDate(h.order_date)}</td>
                                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{h.order_number || h.bms_reference || '-'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.qty_ordered}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.qty_received}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                  {h.unit_price ? `${parseFloat(h.unit_price).toFixed(2)} EUR` : '-'}
                                </td>
                                <td style={{ padding: '8px 10px' }}>
                                  <span style={{
                                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                                    backgroundColor: h.status === 'received' ? '#dcfce7' : h.status === 'partial' ? '#fef3c7' : '#f3f4f6',
                                    color: h.status === 'received' ? '#166534' : h.status === 'partial' ? '#92400e' : '#374151'
                                  }}>
                                    {statusLabels[h.status] || h.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        textAlign: 'center',
        color: 'white',
        marginTop: 'auto'
      }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits reserves</p>
      </div>
    </div>
  );
};

export default CatalogProductDetail;
