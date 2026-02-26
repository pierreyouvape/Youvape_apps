import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

const CreateOrderPage = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [orderItems, setOrderItems] = useState([]);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);

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

  // Search products
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
        // Use the new endpoint that returns variants only
        const response = await axios.get(`${API_URL}/purchases/products/search?q=${encodeURIComponent(value)}&limit=30`, {
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

  // Create order
  const handleCreateOrder = async (sendToBMS = false) => {
    if (!supplierId) {
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
        supplier_id: parseInt(supplierId),
        items,
        send_to_bms: sendToBMS
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Commande ${response.data.data?.order_number || ''} créée avec ${items.length} article(s)${sendToBMS ? ' et envoyée à BMS' : ''}`);
      navigate('/purchases?tab=orders');
    } catch (err) {
      console.error('Erreur création commande:', err);
      alert(err.response?.data?.error || 'Erreur lors de la création de la commande');
    } finally {
      setCreatingOrder(false);
    }
  };

  const totalQty = orderItems.reduce((sum, item) => sum + item.qty_ordered, 0);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#f59e0b', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button
            onClick={() => navigate('/purchases?tab=orders')}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            ← Retour aux commandes
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Créer une commande</h1>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '0 20px' }}>
        {/* Supplier selection */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
            Fournisseur *
          </label>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            style={{ width: '100%', maxWidth: '400px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
          >
            <option value="">-- Sélectionner un fournisseur --</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Product search */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '10px', fontSize: '16px' }}>
            Ajouter des produits
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Rechercher par nom ou SKU..."
              value={productSearch}
              onChange={e => handleProductSearch(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '15px' }}
            />
            {searchLoading && (
              <div style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}>
                Recherche...
              </div>
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
                maxHeight: '350px',
                overflowY: 'auto',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
              }}>
                {searchResults.map(product => (
                  <div
                    key={product.id}
                    onClick={() => addProductToOrder(product)}
                    style={{
                      padding: '12px 15px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #eee',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, marginBottom: '4px' }}>{product.post_title}</div>
                      <div style={{ fontSize: '13px', color: '#666', display: 'flex', gap: '15px' }}>
                        <span>SKU: <code>{product.sku || '-'}</code></span>
                        <span>Stock: <strong style={{ color: product.stock <= 0 ? '#ef4444' : 'inherit' }}>{product.stock ?? 'N/A'}</strong></span>
                      </div>
                    </div>
                    <span style={{ color: '#10b981', fontSize: '24px', fontWeight: 'bold', marginLeft: '15px' }}>+</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Order items */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              Articles ({orderItems.length})
            </h3>
            {orderItems.length > 0 && (
              <span style={{ color: '#666' }}>
                Total: <strong>{totalQty}</strong> unités
              </span>
            )}
          </div>

          {orderItems.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', background: '#f9fafb', borderRadius: '6px', color: '#666' }}>
              Aucun produit ajouté. Utilisez la recherche ci-dessus pour ajouter des produits.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600 }}>Produit</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontWeight: 600, width: '120px' }}>SKU</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '80px' }}>Stock</th>
                  <th style={{ textAlign: 'center', padding: '10px', fontWeight: 600, width: '120px' }}>Quantité</th>
                  <th style={{ width: '60px' }}></th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map(item => (
                  <tr key={item.product_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '12px 10px' }}>{item.product_name}</td>
                    <td style={{ padding: '12px 10px' }}><code style={{ fontSize: '13px' }}>{item.sku || '-'}</code></td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <span style={{ color: item.stock <= 0 ? '#ef4444' : 'inherit', fontWeight: 500 }}>
                        {item.stock ?? '-'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <input
                        type="number"
                        min="1"
                        value={item.qty_ordered}
                        onChange={e => updateItemQty(item.product_id, parseInt(e.target.value) || 1)}
                        style={{ width: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', textAlign: 'center', fontSize: '14px' }}
                      />
                    </td>
                    <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                      <button
                        onClick={() => removeProductFromOrder(item.product_id)}
                        style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '16px' }}
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

        {/* Actions */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/purchases?tab=orders')}
            style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', padding: '12px 24px', cursor: 'pointer', fontSize: '15px', fontWeight: 500 }}
          >
            Annuler
          </button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleCreateOrder(false)}
              disabled={creatingOrder || !supplierId || orderItems.length === 0}
              style={{
                background: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '12px 24px',
                cursor: creatingOrder || !supplierId || orderItems.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '15px',
                fontWeight: 500,
                opacity: creatingOrder || !supplierId || orderItems.length === 0 ? 0.6 : 1
              }}
            >
              {creatingOrder ? 'Création...' : 'Sauvegarder (Brouillon)'}
            </button>
            <button
              onClick={() => handleCreateOrder(true)}
              disabled={creatingOrder || !supplierId || orderItems.length === 0}
              style={{
                background: '#6366f1',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '12px 24px',
                cursor: creatingOrder || !supplierId || orderItems.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: '15px',
                fontWeight: 500,
                opacity: creatingOrder || !supplierId || orderItems.length === 0 ? 0.6 : 1
              }}
            >
              {creatingOrder ? 'Création...' : 'Créer dans BMS'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateOrderPage;
