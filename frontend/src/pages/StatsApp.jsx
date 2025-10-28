import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const StatsApp = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ customers: 0, products: 0, orders: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Charger les statistiques au montage du composant
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_URL}/sync/stats`);
      if (response.data.success) {
        setStats(response.data.stats);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleDownload = async (type) => {
    setLoading(true);
    setMessage('');

    try {
      const response = await axios.get(`${API_URL}/sync/logs/${type}`, {
        responseType: 'blob'
      });

      // Créer un lien de téléchargement
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${type}_logs_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setMessage(`✓ Logs ${type} téléchargés avec succès !`);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      if (error.response?.status === 404) {
        setMessage(`⚠️ Aucune donnée disponible pour ${type}`);
      } else {
        setMessage(`❌ Erreur lors du téléchargement: ${error.message}`);
      }
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer tous les logs ?')) {
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await axios.delete(`${API_URL}/sync/logs`);
      if (response.data.success) {
        setMessage('✓ Tous les logs ont été supprimés');
        setStats({ customers: 0, products: 0, orders: 0 });
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (error) {
      setMessage(`❌ Erreur: ${error.message}`);
      setTimeout(() => setMessage(''), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchStats();
    setMessage('✓ Statistiques rafraîchies');
    setTimeout(() => setMessage(''), 2000);
  };

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
        <img
          src="/images/logo.svg"
          alt="YouVape"
          style={{ height: '60px' }}
        />
        <button
          onClick={() => navigate('/home')}
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
      <div style={{ flex: 1, maxWidth: '1000px', margin: '50px auto', padding: '20px', width: '100%' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '30px'
        }}>
          <h1 style={{ color: '#135E84', margin: 0 }}>📊 Statistiques WooCommerce</h1>
          <button
            onClick={handleRefresh}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            🔄 Rafraîchir
          </button>
        </div>

        {/* Message de feedback */}
        {message && (
          <div style={{
            padding: '15px',
            marginBottom: '20px',
            backgroundColor: message.includes('❌') ? '#f8d7da' : '#d4edda',
            border: `1px solid ${message.includes('❌') ? '#f5c6cb' : '#c3e6cb'}`,
            borderRadius: '6px',
            color: message.includes('❌') ? '#721c24' : '#155724',
            textAlign: 'center',
            fontWeight: '500'
          }}>
            {message}
          </div>
        )}

        {/* Statistiques */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '20px',
          marginBottom: '40px'
        }}>
          <div style={{
            padding: '25px',
            backgroundColor: '#f8f9fa',
            borderRadius: '12px',
            border: '2px solid #dee2e6',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>👥</div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#007bff', marginBottom: '5px' }}>
              {stats.customers}
            </div>
            <div style={{ fontSize: '14px', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Clients
            </div>
          </div>

          <div style={{
            padding: '25px',
            backgroundColor: '#f8f9fa',
            borderRadius: '12px',
            border: '2px solid #dee2e6',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>📦</div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#28a745', marginBottom: '5px' }}>
              {stats.products}
            </div>
            <div style={{ fontSize: '14px', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Produits
            </div>
          </div>

          <div style={{
            padding: '25px',
            backgroundColor: '#f8f9fa',
            borderRadius: '12px',
            border: '2px solid #dee2e6',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>🛒</div>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#8b5cf6', marginBottom: '5px' }}>
              {stats.orders}
            </div>
            <div style={{ fontSize: '14px', color: '#6c757d', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Commandes
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div style={{
          padding: '20px',
          backgroundColor: '#e7f3ff',
          border: '1px solid #b3d9ff',
          borderRadius: '8px',
          marginBottom: '30px'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#004085' }}>ℹ️ Instructions</h3>
          <ol style={{ margin: 0, paddingLeft: '20px', color: '#004085' }}>
            <li>Depuis votre WordPress, allez dans <strong>WooCommerce → YouVape Sync</strong></li>
            <li>Dans l'onglet <strong>"Test"</strong>, envoyez un échantillon (ex: 5-5-5)</li>
            <li>Les données apparaîtront ici et vous pourrez télécharger les logs JSON</li>
            <li>Analysez les fichiers JSON pour préparer le schéma de base de données</li>
          </ol>
        </div>

        {/* Téléchargements */}
        <div style={{
          padding: '30px',
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          <h2 style={{ marginTop: 0, color: '#333' }}>📥 Télécharger les logs</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '30px' }}>
            <button
              onClick={() => handleDownload('customers')}
              disabled={loading || stats.customers === 0}
              style={{
                padding: '15px 25px',
                backgroundColor: stats.customers === 0 ? '#e9ecef' : '#007bff',
                color: stats.customers === 0 ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: stats.customers === 0 ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'transform 0.2s'
              }}
              onMouseEnter={(e) => {
                if (stats.customers > 0) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span>👥 Télécharger logs Clients</span>
              <span style={{
                padding: '4px 12px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                fontSize: '14px'
              }}>
                {stats.customers} items
              </span>
            </button>

            <button
              onClick={() => handleDownload('products')}
              disabled={loading || stats.products === 0}
              style={{
                padding: '15px 25px',
                backgroundColor: stats.products === 0 ? '#e9ecef' : '#28a745',
                color: stats.products === 0 ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: stats.products === 0 ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'transform 0.2s'
              }}
              onMouseEnter={(e) => {
                if (stats.products > 0) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span>📦 Télécharger logs Produits</span>
              <span style={{
                padding: '4px 12px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                fontSize: '14px'
              }}>
                {stats.products} items
              </span>
            </button>

            <button
              onClick={() => handleDownload('orders')}
              disabled={loading || stats.orders === 0}
              style={{
                padding: '15px 25px',
                backgroundColor: stats.orders === 0 ? '#e9ecef' : '#8b5cf6',
                color: stats.orders === 0 ? '#6c757d' : 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: stats.orders === 0 ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'transform 0.2s'
              }}
              onMouseEnter={(e) => {
                if (stats.orders > 0) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              <span>🛒 Télécharger logs Commandes</span>
              <span style={{
                padding: '4px 12px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                fontSize: '14px'
              }}>
                {stats.orders} items
              </span>
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #dee2e6', margin: '20px 0' }} />

          <button
            onClick={handleClearLogs}
            disabled={loading || (stats.customers === 0 && stats.products === 0 && stats.orders === 0)}
            style={{
              padding: '12px 25px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              opacity: loading || (stats.customers === 0 && stats.products === 0 && stats.orders === 0) ? 0.5 : 1
            }}
          >
            🗑️ Supprimer tous les logs
          </button>
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

export default StatsApp;
