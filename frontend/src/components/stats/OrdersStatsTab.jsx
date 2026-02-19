import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import CopyButton from '../CopyButton';

const API_BASE_URL = 'http://54.37.156.233:3000/api';

// Mapping des codes pays vers noms
const COUNTRY_NAMES = {
  FR: 'France', BE: 'Belgique', CH: 'Suisse', DE: 'Allemagne', ES: 'Espagne',
  IT: 'Italie', NL: 'Pays-Bas', PT: 'Portugal', GB: 'Royaume-Uni', LU: 'Luxembourg',
  AT: 'Autriche', IE: 'Irlande', PL: 'Pologne', CZ: 'Tchequie', DK: 'Danemark',
  SE: 'Suede', NO: 'Norvege', FI: 'Finlande', GR: 'Grece', HU: 'Hongrie',
  RO: 'Roumanie', BG: 'Bulgarie', HR: 'Croatie', SK: 'Slovaquie', SI: 'Slovenie',
  EE: 'Estonie', LV: 'Lettonie', LT: 'Lituanie', MT: 'Malte', CY: 'Chypre',
  US: 'Etats-Unis', CA: 'Canada', AU: 'Australie', JP: 'Japon', CN: 'Chine',
  GP: 'Guadeloupe', MQ: 'Martinique', GF: 'Guyane', RE: 'Reunion', YT: 'Mayotte',
  NC: 'Nouvelle-Caledonie', PF: 'Polynesie', MC: 'Monaco', MA: 'Maroc', TN: 'Tunisie',
  DZ: 'Algerie', SN: 'Senegal', CI: 'Cote d\'Ivoire'
};

// Mapping des statuts
const STATUS_LABELS = {
  'wc-completed': 'Expediee',
  'wc-delivered': 'Livree',
  'wc-processing': 'En cours',
  'wc-on-hold': 'En attente',
  'wc-pending': 'En attente paiement',
  'wc-cancelled': 'Annulee',
  'wc-refunded': 'Remboursee',
  'wc-failed': 'Echouee',
  'wc-being-delivered': 'En livraison',
  'trash': 'Corbeille'
};

const STATUS_COLORS = {
  'wc-completed': '#135E84',
  'wc-delivered': '#28a745',
  'wc-processing': '#ffc107',
  'wc-on-hold': '#fd7e14',
  'wc-pending': '#6c757d',
  'wc-cancelled': '#dc3545',
  'wc-refunded': '#6f42c1',
  'wc-failed': '#dc3545',
  'wc-being-delivered': '#17a2b8',
  'trash': '#6c757d'
};

const OrdersStatsTab = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, limit: 100, offset: 0, hasMore: false });

  // Filtres
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState([]);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [shippingMethod, setShippingMethod] = useState('');
  const [category, setCategory] = useState('');

  // Listes pour les dropdowns
  const [countries, setCountries] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [shippingMethods, setShippingMethods] = useState([]);
  const [categories, setCategories] = useState([]);

  // Ligne depliee
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState({});

  useEffect(() => {
    fetchFilterOptions();
    fetchOrders();
  }, []);

  const fetchFilterOptions = async () => {
    try {
      const [countriesRes, statusesRes, shippingRes, categoriesRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/orders/countries/list`),
        axios.get(`${API_BASE_URL}/orders/statuses/list`),
        axios.get(`${API_BASE_URL}/orders/shipping-methods/list`),
        axios.get(`${API_BASE_URL}/orders/categories/list`)
      ]);

      if (countriesRes.data.success) setCountries(countriesRes.data.data);
      if (statusesRes.data.success) setStatuses(statusesRes.data.data);
      if (shippingRes.data.success) setShippingMethods(shippingRes.data.data);
      if (categoriesRes.data.success) setCategories(categoriesRes.data.data);
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchOrders = async (offset = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (country) params.append('country', country);
      if (status.length > 0) params.append('status', status.join(','));
      if (minAmount) params.append('minAmount', minAmount);
      if (maxAmount) params.append('maxAmount', maxAmount);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (shippingMethod) params.append('shippingMethod', shippingMethod);
      if (category) params.append('category', category);
      params.append('limit', '100');
      params.append('offset', offset.toString());

      const response = await axios.get(`${API_BASE_URL}/orders/filter?${params.toString()}`);
      if (response.data.success) {
        setOrders(response.data.data);
        setPagination(response.data.pagination);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    fetchOrders(0);
  };

  const handleReset = () => {
    setSearch('');
    setCountry('');
    setStatus([]);
    setMinAmount('');
    setMaxAmount('');
    setDateFrom('');
    setDateTo('');
    setShippingMethod('');
    setCategory('');
    setTimeout(() => fetchOrders(0), 0);
  };

  const handleStatusChange = (s) => {
    if (status.includes(s)) {
      setStatus(status.filter(st => st !== s));
    } else {
      setStatus([...status, s]);
    }
  };

  const toggleOrderDetails = async (orderId) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(orderId);

    if (!orderDetails[orderId]) {
      try {
        const response = await axios.get(`${API_BASE_URL}/orders/${orderId}/details`);
        if (response.data.success) {
          setOrderDetails(prev => ({
            ...prev,
            [orderId]: response.data.data
          }));
        }
      } catch (error) {
        console.error('Error fetching order details:', error);
      }
    }
  };

  const formatPrice = (price) => parseFloat(price || 0).toFixed(2) + ' €';
  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleExport = () => {
    const csv = [
      ['N° Commande', 'Date', 'Client', 'Email', 'Pays', 'Montant TTC', 'Statut', 'Transporteur', 'Nb Articles', 'Coupon'],
      ...orders.map(o => [
        o.wp_order_id,
        formatDate(o.post_date),
        `${o.billing_first_name || ''} ${o.billing_last_name || ''}`.trim(),
        o.billing_email || '',
        COUNTRY_NAMES[o.billing_country] || o.billing_country || '',
        parseFloat(o.order_total || 0).toFixed(2),
        STATUS_LABELS[o.post_status] || o.post_status,
        o.shipping_method || '',
        o.items_count || 0,
        o.coupons || ''
      ])
    ].map(row => row.join(';')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `commandes_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div>
      {/* Filtres */}
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
        {/* Ligne 1: Recherche */}
        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="N° commande, nom, prenom, email..."
            style={{ flex: 2, minWidth: '250px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          />
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{ flex: 1, minWidth: '150px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          >
            <option value="">Tous les pays</option>
            {countries.map(c => (
              <option key={c.country} value={c.country}>
                {COUNTRY_NAMES[c.country] || c.country} ({c.count})
              </option>
            ))}
          </select>
          <select
            value={shippingMethod}
            onChange={(e) => setShippingMethod(e.target.value)}
            style={{ flex: 1, minWidth: '180px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          >
            <option value="">Tous les transporteurs</option>
            {shippingMethods.map(s => (
              <option key={s.shipping_method} value={s.shipping_method}>
                {s.shipping_method} ({s.count})
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ flex: 1, minWidth: '180px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
          >
            <option value="">Toutes les categories</option>
            {categories.map(c => (
              <option key={c.category} value={c.category}>
                {c.category}
              </option>
            ))}
          </select>
        </div>

        {/* Ligne 2: Dates et montants */}
        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>Du</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>Au</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>Montant min</span>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="0"
              style={{ width: '100px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: '#666' }}>Montant max</span>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="9999"
              style={{ width: '100px', padding: '10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
        </div>

        {/* Ligne 3: Statuts */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: '#666' }}>Statuts:</span>
          {statuses.map(s => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={status.includes(s)}
                onChange={() => handleStatusChange(s)}
              />
              <span style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: status.includes(s) ? (STATUS_COLORS[s] || '#6c757d') : '#f8f9fa',
                color: status.includes(s) ? 'white' : '#333'
              }}>
                {STATUS_LABELS[s] || s}
              </span>
            </label>
          ))}
        </div>

        {/* Boutons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleSearch}
            style={{ padding: '10px 25px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Rechercher
          </button>
          <button
            onClick={handleReset}
            style={{ padding: '10px 25px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}
          >
            Reinitialiser
          </button>
          <button
            onClick={handleExport}
            style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto' }}
          >
            CSV
          </button>
        </div>
      </div>

      {/* Resultats */}
      <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '15px' }}>
        <span style={{ fontSize: '14px', color: '#666' }}>
          {pagination.total} commande{pagination.total > 1 ? 's' : ''} trouvee{pagination.total > 1 ? 's' : ''}
        </span>
      </div>

      {/* Tableau */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>N°</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Client</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Pays</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Montant</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Statut</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Transporteur</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Articles</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Avis</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Coupon</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isExpanded = expandedOrderId === order.wp_order_id;
                  const details = orderDetails[order.wp_order_id];

                  return (
                    <>
                      <tr
                        key={order.wp_order_id}
                        onClick={() => toggleOrderDetails(order.wp_order_id)}
                        style={{
                          borderTop: '1px solid #dee2e6',
                          cursor: 'pointer',
                          backgroundColor: isExpanded ? '#f8f9fa' : 'white',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#6c757d', fontSize: '12px' }}>{isExpanded ? '▼' : '▶'}</span>
                            <span
                              style={{ fontWeight: 'bold', color: '#007bff', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.wp_order_id}`); }}
                            >
                              #{order.wp_order_id}
                            </span>
                            <CopyButton text={String(order.wp_order_id)} size={12} />
                          </div>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px', color: '#666' }}>{formatDate(order.post_date)}</td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>
                          <div>{order.billing_first_name} {order.billing_last_name}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>{order.billing_email}</div>
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px' }}>{COUNTRY_NAMES[order.billing_country] || order.billing_country}</td>
                        <td style={{ padding: '12px', fontSize: '14px', textAlign: 'right', fontWeight: 'bold', color: '#28a745' }}>{formatPrice(order.order_total)}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: STATUS_COLORS[order.post_status] || '#6c757d',
                            color: 'white'
                          }}>
                            {STATUS_LABELS[order.post_status] || order.post_status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>{order.shipping_method || '-'}</td>
                        <td style={{ padding: '12px', fontSize: '14px', textAlign: 'center' }}>{order.items_count}</td>
                        <td style={{ padding: '12px', fontSize: '14px', textAlign: 'center' }}>
                          {order.has_review && <span title="Avis laisse">⭐</span>}
                        </td>
                        <td style={{ padding: '12px', fontSize: '14px', textAlign: 'center' }}>
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
                      </tr>

                      {/* Ligne depliable */}
                      {isExpanded && (
                        <tr key={`${order.wp_order_id}-details`}>
                          <td colSpan={10} style={{ padding: '0', backgroundColor: '#f8f9fa' }}>
                            <div style={{ padding: '20px', borderTop: '1px solid #e9ecef' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                                {/* Infos client */}
                                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                                  <h4 style={{ margin: '0 0 10px 0', color: '#135E84', fontSize: '14px' }}>Informations Client</h4>
                                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                    <div><strong>{order.billing_first_name} {order.billing_last_name}</strong></div>
                                    <div>{order.billing_email}</div>
                                    <div>{order.billing_phone}</div>
                                  </div>
                                </div>

                                {/* Adresse de facturation */}
                                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                                  <h4 style={{ margin: '0 0 10px 0', color: '#135E84', fontSize: '14px' }}>Adresse de Facturation</h4>
                                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                    <div>{order.billing_address_1}</div>
                                    <div>{order.billing_postcode} {order.billing_city}</div>
                                    <div>{COUNTRY_NAMES[order.billing_country] || order.billing_country}</div>
                                  </div>
                                </div>

                                {/* Adresse de livraison */}
                                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                                  <h4 style={{ margin: '0 0 10px 0', color: '#135E84', fontSize: '14px' }}>Adresse de Livraison</h4>
                                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                    <div>{order.shipping_first_name} {order.shipping_last_name}</div>
                                    <div>{order.shipping_address_1}</div>
                                    <div>{order.shipping_postcode} {order.shipping_city}</div>
                                    <div>{COUNTRY_NAMES[order.shipping_country] || order.shipping_country}</div>
                                  </div>
                                </div>

                                {/* Infos commande */}
                                <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                                  <h4 style={{ margin: '0 0 10px 0', color: '#135E84', fontSize: '14px' }}>Details Commande</h4>
                                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                    <div>Paiement: {order.payment_method_title || '-'}</div>
                                    <div>Frais de port: {formatPrice(order.order_shipping)}</div>
                                    <div>Transporteur: {details?.shipping_carrier || order.shipping_method || '-'}</div>
                                    {details?.tracking_number && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        Suivi: <span style={{ fontWeight: '600' }}>{details.tracking_number}</span>
                                        <CopyButton text={details.tracking_number} size={12} />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Produits commandes */}
                              <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                                <h4 style={{ margin: '0 0 15px 0', color: '#135E84', fontSize: '14px' }}>Produits commandes</h4>
                                {!details ? (
                                  <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Chargement...</div>
                                ) : (
                                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                                        <th style={{ padding: '10px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>Produit</th>
                                        <th style={{ padding: '10px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>SKU</th>
                                        <th style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>Qte</th>
                                        <th style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>Prix unit.</th>
                                        <th style={{ padding: '10px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {details.items.map((item, idx) => (
                                        <tr key={idx} style={{ borderTop: '1px solid #e9ecef' }}>
                                          <td style={{ padding: '10px', fontSize: '13px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                              {item.image_url && (
                                                <img src={item.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                                              )}
                                              <div>
                                                <div
                                                  style={{ fontWeight: '500', color: '#007bff', cursor: 'pointer' }}
                                                  onClick={(e) => { e.stopPropagation(); navigate(`/products/${item.product_id || item.variation_id}`); }}
                                                >
                                                  {item.product_title || item.order_item_name}
                                                </div>
                                                {item.brand && <div style={{ fontSize: '11px', color: '#999' }}>{item.brand}</div>}
                                              </div>
                                            </div>
                                          </td>
                                          <td style={{ padding: '10px', fontSize: '12px', color: '#666' }}>
                                            {item.sku ? (
                                              <>
                                                <a
                                                  href={`https://www.youvape.fr/wp-admin/post.php?post=${item.variation_id || item.product_id}&action=edit`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  onClick={(e) => e.stopPropagation()}
                                                  style={{ color: '#135E84', textDecoration: 'none' }}
                                                  onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                  onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                >
                                                  {item.sku}
                                                </a>
                                                <CopyButton text={item.sku} size={11} />
                                              </>
                                            ) : '-'}
                                          </td>
                                          <td style={{ padding: '10px', fontSize: '13px', textAlign: 'right', fontWeight: '600' }}>{item.qty}</td>
                                          <td style={{ padding: '10px', fontSize: '13px', textAlign: 'right' }}>{formatPrice(item.line_subtotal / item.qty)}</td>
                                          <td style={{ padding: '10px', fontSize: '13px', textAlign: 'right', fontWeight: '600', color: '#28a745' }}>{formatPrice(item.line_total)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>

                              {/* Bouton voir commande complete */}
                              <div style={{ marginTop: '15px', textAlign: 'right' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.wp_order_id}`); }}
                                  style={{ padding: '10px 20px', backgroundColor: '#135E84', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: '600' }}
                                >
                                  Voir la commande complete
                                </button>
                              </div>
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

          {/* Pagination */}
          {pagination.total > pagination.limit && (
            <div style={{ padding: '15px', borderTop: '1px solid #dee2e6', display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                onClick={() => fetchOrders(Math.max(0, pagination.offset - pagination.limit))}
                disabled={pagination.offset === 0}
                style={{
                  padding: '8px 15px',
                  backgroundColor: pagination.offset === 0 ? '#e9ecef' : '#135E84',
                  color: pagination.offset === 0 ? '#6c757d' : 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: pagination.offset === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                Precedent
              </button>
              <span style={{ padding: '8px 15px', color: '#666' }}>
                Page {Math.floor(pagination.offset / pagination.limit) + 1} / {Math.ceil(pagination.total / pagination.limit)}
              </span>
              <button
                onClick={() => fetchOrders(pagination.offset + pagination.limit)}
                disabled={!pagination.hasMore}
                style={{
                  padding: '8px 15px',
                  backgroundColor: !pagination.hasMore ? '#e9ecef' : '#135E84',
                  color: !pagination.hasMore ? '#6c757d' : 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: !pagination.hasMore ? 'not-allowed' : 'pointer'
                }}
              >
                Suivant
              </button>
            </div>
          )}

          {orders.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucune commande trouvee
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OrdersStatsTab;
