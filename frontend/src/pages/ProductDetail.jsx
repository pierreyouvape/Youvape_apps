import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const ProductDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [salesHistory, setSalesHistory] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingCost, setEditingCost] = useState(false);
  const [newCost, setNewCost] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      fetchProductData();
    }
  }, [id]);

  const fetchProductData = async () => {
    setLoading(true);
    setError('');

    try {
      const [productRes, salesRes, customersRes, relatedRes] = await Promise.all([
        axios.get(`${API_URL}/products/${id}`),
        axios.get(`${API_URL}/products/${id}/sales-history`, { params: { limit: 20 } }),
        axios.get(`${API_URL}/products/${id}/customers`, { params: { limit: 10 } }),
        axios.get(`${API_URL}/products/${id}/related`, { params: { limit: 5 } })
      ]);

      setProduct(productRes.data.data);
      setSalesHistory(salesRes.data.data);
      setCustomers(customersRes.data.data);
      setRelatedProducts(relatedRes.data.data);
      setNewCost(productRes.data.data.cost_price_custom || productRes.data.data.cost_price || '');
    } catch (err) {
      console.error('Error fetching product data:', err);
      setError('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCost = async () => {
    if (!newCost || isNaN(newCost)) {
      alert('Veuillez entrer un coût valide');
      return;
    }

    setSaving(true);
    try {
      await axios.put(`${API_URL}/products/${id}/cost`, {
        cost_price_custom: parseFloat(newCost)
      });

      alert('Coût mis à jour avec succès !');
      setEditingCost(false);
      fetchProductData();
    } catch (err) {
      console.error('Error updating cost:', err);
      alert('Erreur lors de la mise à jour du coût');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('fr-FR').format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏳</div>
          <div style={{ fontSize: '18px', color: '#666' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>{error || 'Produit introuvable'}</div>
          <button
            onClick={() => navigate('/products')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#135E84',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            ← Retour à la liste
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div
        style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
      >
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button
          onClick={() => navigate('/products')}
          style={{
            position: 'absolute',
            left: '20px',
            padding: '10px 20px',
            backgroundColor: '#fff',
            color: '#135E84',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: '600'
          }}
        >
          ← Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Product Info */}
        <div
          style={{
            backgroundColor: '#fff',
            padding: '30px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            marginBottom: '30px'
          }}
        >
          <h1 style={{ margin: '0 0 20px 0', color: '#135E84' }}>{product.name}</h1>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>SKU</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{product.sku}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Catégorie</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{product.category || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Prix de vente</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatCurrency(product.price)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Stock</div>
              <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatNumber(product.stock_quantity || 0)}</div>
            </div>
          </div>

          {/* Cost Editing Section */}
          <div
            style={{
              marginTop: '30px',
              padding: '20px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              border: '1px solid #e0e0e0'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '15px', fontSize: '16px' }}>💰 Gestion des coûts</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Coût WooCommerce</div>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>{formatCurrency(product.cost_price || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Coût personnalisé</div>
                {editingCost ? (
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={newCost}
                      onChange={(e) => setNewCost(e.target.value)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '14px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        width: '100px'
                      }}
                    />
                    <button
                      onClick={handleSaveCost}
                      disabled={saving}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontWeight: '600'
                      }}
                    >
                      {saving ? '...' : '💾 Sauver'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingCost(false);
                        setNewCost(product.cost_price_custom || product.cost_price || '');
                      }}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '600'
                      }}
                    >
                      ✖
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600' }}>
                      {formatCurrency(product.cost_price_custom || product.cost_price || 0)}
                    </div>
                    <button
                      onClick={() => setEditingCost(true)}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: '#135E84',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: '600'
                      }}
                    >
                      ✏️ Modifier
                    </button>
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Marge unitaire</div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: product.unit_margin > 0 ? '#28a745' : '#dc3545'
                  }}
                >
                  {formatCurrency(product.unit_margin || 0)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
            marginBottom: '30px'
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>📦</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#135E84', marginBottom: '5px' }}>
              {formatNumber(product.total_quantity_sold || 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Quantité vendue</div>
          </div>

          <div
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>💰</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', marginBottom: '5px' }}>
              {formatCurrency(product.total_revenue || 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>CA Total</div>
          </div>

          <div
            style={{
              backgroundColor: '#fff',
              padding: '20px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>🛒</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#8b5cf6', marginBottom: '5px' }}>
              {formatNumber(product.orders_count || 0)}
            </div>
            <div style={{ fontSize: '12px', color: '#999', textTransform: 'uppercase' }}>Commandes</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px' }}>
          {/* Sales History */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              📋 Historique des ventes
            </h2>
            {salesHistory.length > 0 ? (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {salesHistory.map((sale) => (
                  <div
                    key={sale.order_id}
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <div style={{ fontWeight: '600' }}>Commande #{sale.order_number}</div>
                      <div style={{ color: '#999' }}>{formatDate(sale.date_created)}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                      <div>Qté: {sale.quantity}</div>
                      <div>{formatCurrency(sale.total)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Aucune vente</div>
            )}
          </div>

          {/* Customers */}
          <div
            style={{
              backgroundColor: '#fff',
              padding: '25px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
              👥 Clients ayant acheté
            </h2>
            {customers.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.customer_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td
                        style={{ padding: '12px 5px', fontSize: '14px', cursor: 'pointer' }}
                        onClick={() => navigate(`/customers/${customer.customer_id}`)}
                      >
                        <div style={{ fontWeight: '600' }}>
                          {customer.first_name} {customer.last_name}
                        </div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{customer.email}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 5px', fontSize: '13px' }}>
                        <div style={{ fontWeight: '600' }}>{formatNumber(customer.total_quantity)} unités</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{formatCurrency(customer.total_spent)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Aucun client</div>
            )}
          </div>

          {/* Related Products */}
          {relatedProducts.length > 0 && (
            <div
              style={{
                backgroundColor: '#fff',
                padding: '25px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
              }}
            >
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333', fontSize: '20px' }}>
                🔗 Produits liés (achetés ensemble)
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {relatedProducts.map((related) => (
                  <div
                    key={related.product_id}
                    style={{
                      padding: '12px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onClick={() => navigate(`/products/${related.product_id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8f9fa')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '5px' }}>{related.name}</div>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      Acheté {related.times_bought_together}× ensemble
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          textAlign: 'center',
          color: 'white',
          marginTop: '50px'
        }}
      >
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default ProductDetail;
