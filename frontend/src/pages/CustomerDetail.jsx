import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const CustomerDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [orders, setOrders] = useState([]);
  const [favoriteProducts, setFavoriteProducts] = useState([]);
  const [stats, setStats] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) fetchCustomerData();
  }, [id]);

  const fetchCustomerData = async () => {
    setLoading(true);
    try {
      // Requêtes critiques - doivent réussir
      const customerRes = await axios.get(`${API_URL}/customers/${id}`);
      setCustomer(customerRes.data.data);

      // Requêtes optionnelles - peuvent échouer sans bloquer l'affichage
      try {
        const [ordersRes, favoritesRes, statsRes, couponsRes, notesRes] = await Promise.all([
          axios.get(`${API_URL}/customers/${id}/orders`, { params: { limit: 20 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/customers/${id}/favorite-products`, { params: { limit: 10 } }).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/customers/${id}/stats`).catch(() => ({ data: { data: null } })),
          axios.get(`${API_URL}/customers/${id}/coupons`).catch(() => ({ data: { data: [] } })),
          axios.get(`${API_URL}/customers/${id}/notes`).catch(() => ({ data: { data: [] } }))
        ]);

        setOrders(ordersRes.data.data || []);
        setFavoriteProducts(favoritesRes.data.data || []);
        setStats(statsRes.data.data);
        setCoupons(couponsRes.data.data || []);
        setNotes(notesRes.data.data || []);
      } catch (err) {
        console.error('Error fetching optional customer data:', err);
      }
    } catch (err) {
      console.error('Error fetching customer:', err);
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await axios.post(`${API_URL}/customers/${id}/notes`, { note: newNote, created_by: 'admin' });
      setNewNote('');
      const notesRes = await axios.get(`${API_URL}/customers/${id}/notes`);
      setNotes(notesRes.data.data);
    } catch (err) {
      console.error('Error adding note:', err);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await axios.delete(`${API_URL}/customers/notes/${noteId}`);
      setNotes(notes.filter(n => n.id !== noteId));
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const formatCurrency = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const formatNumber = (value) => new Intl.NumberFormat('fr-FR').format(value);
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
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

  if (!customer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ fontSize: '18px', color: '#666', marginBottom: '20px' }}>Client introuvable</div>
          <button onClick={() => navigate('/stats')} style={{ padding: '10px 20px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            ← Retour
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        <button onClick={() => navigate('/stats')} style={{ position: 'absolute', left: '20px', padding: '10px 20px', backgroundColor: '#fff', color: '#135E84', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>
          ← Retour
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '0 20px', width: '100%' }}>
        {/* Customer Info */}
        <div style={{ backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <h1 style={{ margin: '0 0 20px 0', color: '#135E84' }}>{customer.first_name} {customer.last_name}</h1>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
            <div><strong>Email:</strong> {customer.email}</div>
            <div><strong>Téléphone:</strong> {customer.phone || '-'}</div>
            <div><strong>Pays:</strong> {customer.shipping_country || '-'}</div>
            <div><strong>Client depuis:</strong> {formatDate(customer.date_created)}</div>
          </div>
        </div>

        {/* KPIs */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '30px' }}>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>TOTAL DÉPENSÉ</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745' }}>{formatCurrency(stats.total_spent)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>TOTAL COMMANDES</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#135E84' }}>{stats.total_orders}</div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>PANIER MOYEN</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#8b5cf6' }}>{formatCurrency(stats.avg_order_value)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>JOURS ENTRE COMMANDES</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#ff6b6b' }}>{Math.round(stats.avg_days_between_orders || 0)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>PROFIT TOTAL</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#007bff' }}>{formatCurrency(stats.total_profit || 0)}</div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>MARGE</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: '#fd7e14' }}>{(stats.margin_percent || 0).toFixed(1)}%</div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {/* Orders */}
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🛒 Commandes récentes</h2>
            {orders.length > 0 ? (
              <div>
                {orders.slice(0, 5).map((order) => (
                  <div key={order.wp_order_id} onClick={() => navigate(`/orders/${order.wp_order_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontWeight: '600' }}>#{order.order_number}</span>
                      <span style={{ color: '#28a745', fontWeight: '600' }}>{formatCurrency(order.order_total)}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>{formatDate(order.post_date)} • {order.post_status}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>Aucune commande</div>
            )}
          </div>

          {/* Favorite Products */}
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📦 Produits favoris</h2>
            {favoriteProducts.length > 0 ? (
              <div>
                {favoriteProducts.slice(0, 5).map((product) => (
                  <div key={product.product_id} onClick={() => navigate(`/products/${product.product_id}`)} style={{ padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontWeight: '600' }}>{product.name}</span>
                      <span style={{ color: '#135E84', fontWeight: '600' }}>x{product.total_quantity}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>CA: {formatCurrency(product.total_spent)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>Aucun produit</div>
            )}
          </div>
        </div>

        {/* Coupons Used */}
        {coupons.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
            <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>🎟️ {coupons.length} coupons utilisés</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              {coupons.map((coupon) => (
                <div key={coupon.code} style={{ padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                  <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '5px' }}>{coupon.code}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>Utilisé {coupon.usage_count}x</div>
                  <div style={{ fontSize: '13px', color: '#dc3545', fontWeight: '600', marginTop: '5px' }}>-{formatCurrency(coupon.total_discount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Private Notes */}
        <div style={{ backgroundColor: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: '30px' }}>
          <h2 style={{ marginTop: 0, color: '#333', fontSize: '18px' }}>📝 Notes privées</h2>
          <div style={{ marginBottom: '20px' }}>
            <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Ajouter une note privée..." style={{ width: '100%', padding: '10px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '6px', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit' }} />
            <button onClick={handleAddNote} disabled={!newNote.trim()} style={{ marginTop: '10px', padding: '10px 20px', backgroundColor: newNote.trim() ? '#135E84' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: newNote.trim() ? 'pointer' : 'not-allowed', fontWeight: '600' }}>
              Ajouter la note
            </button>
          </div>
          {notes.length > 0 ? (
            <div>
              {notes.map((note) => (
                <div key={note.id} style={{ padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', marginBottom: '10px', position: 'relative' }}>
                  <div style={{ fontSize: '14px', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{note.note}</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    Par {note.created_by} • {formatDate(note.created_at)}
                  </div>
                  <button onClick={() => handleDeleteNote(note.id)} style={{ position: 'absolute', top: '10px', right: '10px', padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>Aucune note</div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ backgroundColor: '#135E84', padding: '20px 0', textAlign: 'center', color: 'white' }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default CustomerDetail;
