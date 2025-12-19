import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import { getCountryLabel } from '../utils/countries';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

const CustomerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);

  const [customer, setCustomer] = useState(null);
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersByMonth, setOrdersByMonth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});

  useEffect(() => {
    fetchCustomerDetail();
    fetchOrdersByMonth();
  }, [id]);

  const fetchCustomerDetail = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/customers/${id}/detail`);
      if (response.data.success) {
        setCustomer(response.data.data.customer);
        setStats(response.data.data.stats);
        setOrders(response.data.data.orders);
      }
    } catch (error) {
      console.error('Error fetching customer detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersByMonth = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/customers/${id}/orders-by-month`);
      if (response.data.success) {
        // Transform data for chart: YYYY-MM → "Jan 2024"
        const chartData = response.data.data.map(item => ({
          month: formatMonthLabel(item.month),
          orders: item.order_count
        }));
        setOrdersByMonth(chartData);
      }
    } catch (error) {
      console.error('Error fetching orders by month:', error);
    }
  };

  const formatMonthLabel = (monthString) => {
    // monthString format: "2024-01"
    const [year, month] = monthString.split('-');
    const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return `${months[parseInt(month) - 1]} ${year}`;
  };

  const calculateCustomerSince = (firstOrderDate) => {
    if (!firstOrderDate) return 'N/A';

    const first = new Date(firstOrderDate);
    const now = new Date();

    const diffTime = Math.abs(now - first);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffMonths / 12);
    const remainingMonths = diffMonths % 12;

    if (diffDays === 0) return "Aujourd'hui";
    if (diffMonths < 1) return "Moins d'un mois";
    if (diffYears === 0) return `${diffMonths} mois`;
    if (remainingMonths === 0) return diffYears === 1 ? "1 an" : `${diffYears} ans`;
    return `${diffYears} an${diffYears > 1 ? 's' : ''} et ${remainingMonths} mois`;
  };

  const fetchOrderDetails = async (orderId) => {
    if (orderDetails[orderId]) return;

    try {
      const response = await axios.get(`${API_BASE_URL}/customers/orders/${orderId}/details`);
      if (response.data.success) {
        setOrderDetails(prev => ({ ...prev, [orderId]: response.data.data }));
      }
    } catch (error) {
      console.error('Error fetching order details:', error);
    }
  };

  const handleOrderRowClick = (orderId) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
    } else {
      setExpandedOrderId(orderId);
      fetchOrderDetails(orderId);
    }
  };

  const handleOrderIdClick = (e, orderId) => {
    e.stopPropagation();
    navigate(`/orders/${orderId}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackHome = () => {
    navigate('/home');
  };

  const handleBackToList = () => {
    navigate('/stats');
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPrice = (price) => {
    return parseFloat(price || 0).toFixed(2) + ' €';
  };

  const getStatusLabel = (status) => {
    const statusMap = {
      'wc-completed': { label: 'Terminée', color: '#28a745' },
      'wc-processing': { label: 'En cours', color: '#007bff' },
      'wc-on-hold': { label: 'En attente', color: '#ffc107' },
      'wc-pending': { label: 'En attente paiement', color: '#ffc107' },
      'wc-cancelled': { label: 'Annulée', color: '#dc3545' },
      'wc-refunded': { label: 'Remboursée', color: '#6c757d' },
      'wc-failed': { label: 'Échouée', color: '#dc3545' },
      'wc-shipped': { label: 'Expédiée', color: '#17a2b8' },
      'wc-delivered': { label: 'Livrée', color: '#28a745' },
    };
    const statusInfo = statusMap[status] || { label: status, color: '#6c757d' };
    return statusInfo;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          backgroundColor: '#135E84',
          padding: '20px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <img src="/images/logo.svg" alt="YouVape" style={{ height: '60px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p>Client non trouvé</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
        <div style={{ position: 'absolute', right: '20px', display: 'flex', gap: '10px' }}>
          <button
            onClick={handleBackToList}
            style={{
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
            ← Retour à la liste
          </button>
          <button
            onClick={handleBackHome}
            style={{
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
            Accueil
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Déconnexion
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1400px', margin: '30px auto', padding: '20px', width: '100%' }}>
        {/* Top Section: Info + Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '30px', marginBottom: '30px' }}>
          {/* Left: Customer Info */}
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', color: '#333' }}>
              {customer.first_name} {customer.last_name}
            </h2>

            <div style={{ marginBottom: '15px' }}>
              <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Email</p>
              <p style={{ fontSize: '14px', color: '#333' }}>{customer.email}</p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Pays</p>
              <p style={{ fontSize: '14px', color: '#333' }}>
                {customer.billing_address?.country ? getCountryLabel(customer.billing_address.country) : 'N/A'}
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Inscrit le</p>
              <p style={{ fontSize: '14px', color: '#333' }}>
                {customer.user_registered ? new Date(customer.user_registered).toLocaleDateString('fr-FR') : 'N/A'}
              </p>
            </div>

            {customer.billing_address && (
              <div style={{ marginBottom: '15px' }}>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Adresse de facturation</p>
                <p style={{ fontSize: '14px', color: '#333', lineHeight: '1.5' }}>
                  {customer.billing_address.address_1}<br />
                  {customer.billing_address.postcode} {customer.billing_address.city}<br />
                  {getCountryLabel(customer.billing_address.country)}
                </p>
              </div>
            )}

            {customer.billing_address?.phone && (
              <div style={{ marginBottom: '15px' }}>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Téléphone</p>
                <p style={{ fontSize: '14px', color: '#333' }}>{customer.billing_address.phone}</p>
              </div>
            )}
          </div>

          {/* Right: Stats */}
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px', color: '#333' }}>Statistiques</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Total dépensé</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#007bff' }}>{formatPrice(stats?.total_spent)}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Commande moyenne</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{formatPrice(stats?.avg_order)}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Commandes</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{stats?.order_count || 0}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Produits différents</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>{stats?.unique_products || 0}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Coût</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc3545' }}>{formatPrice(stats?.total_cost)}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Bénéfice</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>{formatPrice(stats?.profit)}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Marge</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>{stats?.margin?.toFixed(1) || 0}%</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Avis laissés</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffc107' }}>{stats?.reviews_count || 0}</p>
              </div>
              <div>
                <p style={{ fontSize: '12px', color: '#6c757d', marginBottom: '5px' }}>Client depuis</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#135E84' }}>{calculateCustomerSince(stats?.first_order_date)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Chart: Orders by month */}
        {ordersByMonth.length > 0 && (
          <div style={{ backgroundColor: 'white', padding: '25px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px', color: '#333' }}>Commandes par mois</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={ordersByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="orders"
                  stroke="#135E84"
                  fill="#135E84"
                  fillOpacity={0.6}
                  name="Commandes"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}


        {/* Orders List */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid #dee2e6' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: '#333' }}>Commandes</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Commande</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Total</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Coupon</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Avis</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const statusInfo = getStatusLabel(order.post_status);
                  const isExpanded = expandedOrderId === order.wp_order_id;
                  const details = orderDetails[order.wp_order_id];

                  return (
                    <>
                      <tr
                        key={order.wp_order_id}
                        onClick={() => handleOrderRowClick(order.wp_order_id)}
                        style={{ borderTop: '1px solid #dee2e6', cursor: 'pointer', backgroundColor: isExpanded ? '#f8f9fa' : 'white' }}
                      >
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <span
                            onClick={(e) => handleOrderIdClick(e, order.wp_order_id)}
                            style={{ fontWeight: 'bold', color: '#007bff', cursor: 'pointer' }}
                          >
                            #{order.wp_order_id}
                          </span>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{formatDate(order.post_date)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            backgroundColor: statusInfo.color + '20',
                            color: statusInfo.color
                          }}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold' }}>{formatPrice(order.order_total)}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>{order.items_count} article{order.items_count > 1 ? 's' : ''}</td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          {order.coupons ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '600',
                              backgroundColor: '#ff730020',
                              color: '#ff7300'
                            }}>
                              {order.coupons}
                            </span>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '15px', fontSize: '14px' }}>
                          {order.has_review && <span style={{ fontSize: '18px' }}>⭐</span>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${order.wp_order_id}-details`}>
                          <td colSpan={7} style={{ padding: '0', backgroundColor: '#f8f9fa' }}>
                            <div style={{ padding: '20px 30px' }}>
                              {!details ? (
                                <p style={{ color: '#6c757d' }}>Chargement...</p>
                              ) : (
                                <>
                                  {/* Articles */}
                                  <div style={{ marginBottom: '20px' }}>
                                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px', color: '#333' }}>Articles commandés</h4>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '6px', overflow: 'hidden' }}>
                                      <thead>
                                        <tr style={{ backgroundColor: '#e9ecef' }}>
                                          <th style={{ padding: '10px', textAlign: 'left', fontSize: '12px', color: '#6c757d' }}>Produit</th>
                                          <th style={{ padding: '10px', textAlign: 'left', fontSize: '12px', color: '#6c757d' }}>SKU</th>
                                          <th style={{ padding: '10px', textAlign: 'center', fontSize: '12px', color: '#6c757d' }}>Qté</th>
                                          <th style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: '#6c757d' }}>Prix unitaire</th>
                                          <th style={{ padding: '10px', textAlign: 'right', fontSize: '12px', color: '#6c757d' }}>Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {details.items.map((item, idx) => (
                                          <tr key={idx} style={{ borderTop: '1px solid #dee2e6' }}>
                                            <td style={{ padding: '10px', fontSize: '13px' }}>{item.product_name || item.order_item_name}</td>
                                            <td style={{ padding: '10px', fontSize: '13px', color: '#6c757d' }}>{item.sku || '-'}</td>
                                            <td style={{ padding: '10px', fontSize: '13px', textAlign: 'center' }}>{item.qty}</td>
                                            <td style={{ padding: '10px', fontSize: '13px', textAlign: 'right' }}>{formatPrice(item.line_total / item.qty)}</td>
                                            <td style={{ padding: '10px', fontSize: '13px', textAlign: 'right', fontWeight: 'bold' }}>{formatPrice(item.line_total)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>

                                  {/* Shipping */}
                                  <div>
                                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px', color: '#333' }}>Expédition</h4>
                                    <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '6px' }}>
                                      <p style={{ fontSize: '13px', margin: '0 0 5px 0' }}>
                                        <strong>Méthode :</strong> {details.shipping_method || 'N/A'}
                                      </p>
                                      {details.order && (
                                        <p style={{ fontSize: '13px', margin: '0' }}>
                                          <strong>Frais :</strong> {formatPrice(details.order.order_shipping)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {orders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucune commande
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        textAlign: 'center',
        color: 'white'
      }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default CustomerDetail;
