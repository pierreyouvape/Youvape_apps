import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const ReviewsApp = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/auth', '') || 'http://localhost:3000/api';

  // Onglet actif
  const [activeTab, setActiveTab] = useState('config');

  // Configuration
  const [config, setConfig] = useState({
    api_key: '',
    review_type: 'site',
    limit: 100,
    product_id: '',
    interval: 'once_daily'
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  // Test API
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testError, setTestError] = useState('');

  // Avis stockés
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [expandedReview, setExpandedReview] = useState(null);

  // Logs
  const [logs, setLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  // Charger la config au montage
  useEffect(() => {
    loadConfig();
  }, []);

  // Charger les avis stockés quand on ouvre l'onglet
  useEffect(() => {
    if (activeTab === 'reviews') {
      fetchStoredReviews();
    } else if (activeTab === 'logs') {
      fetchLogs();
    }
  }, [activeTab]);

  const loadConfig = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/reviews/config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.data.success && response.data.config) {
        setConfig({
          api_key: response.data.config.api_key || '',
          review_type: response.data.config.review_type || 'site',
          limit: parseInt(response.data.config.limit) || 100,
          product_id: response.data.config.product_id || '',
          interval: response.data.config.interval || 'once_daily'
        });
      }
    } catch (err) {
      console.error('Erreur lors du chargement de la config:', err);
    }
  };

  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    setConfigMessage('');

    try {
      const response = await axios.post(
        `${API_BASE_URL}/reviews/config`,
        config,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (response.data.success) {
        setConfigMessage('✅ Configuration sauvegardée avec succès');
        setTimeout(() => setConfigMessage(''), 3000);
      }
    } catch (err) {
      setConfigMessage('❌ ' + (err.response?.data?.error || 'Erreur lors de la sauvegarde'));
    } finally {
      setConfigSaving(false);
    }
  };

  const handleTestAPI = async () => {
    setTestLoading(true);
    setTestError('');
    setTestResult(null);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/reviews/fetch`,
        {
          api_key: config.api_key,
          review_type: config.review_type,
          limit: config.limit,
          product_id: config.product_id || undefined,
          page: 1
        },
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      setTestResult(response.data);
    } catch (err) {
      setTestError(err.response?.data?.error || err.response?.data?.message || 'Erreur lors de l\'appel API');
      setTestResult(err.response?.data || null);
    } finally {
      setTestLoading(false);
    }
  };

  const fetchStoredReviews = async () => {
    setReviewsLoading(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/reviews/stored`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      setReviews(response.data.reviews || []);
    } catch (err) {
      console.error('Erreur lors du chargement des avis:', err);
    } finally {
      setReviewsLoading(false);
    }
  };

  const fetchLogs = async (date = '') => {
    setLogsLoading(true);
    try {
      const url = date
        ? `${API_BASE_URL}/reviews/logs?date=${date}`
        : `${API_BASE_URL}/reviews/logs`;

      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      setLogs(response.data.logs || []);
    } catch (err) {
      console.error('Erreur lors du chargement des logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleDateFilter = (e) => {
    const date = e.target.value;
    setSelectedDate(date);
    fetchLogs(date);
  };

  const handleExportLogs = async () => {
    try {
      const url = selectedDate
        ? `${API_BASE_URL}/reviews/logs/export?date=${selectedDate}`
        : `${API_BASE_URL}/reviews/logs/export`;

      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `reviews_logs_${selectedDate || 'all'}.csv`;
      link.click();
    } catch (err) {
      alert('Erreur lors de l\'export des logs');
      console.error(err);
    }
  };

  const renderStars = (rating) => {
    return '⭐'.repeat(Math.min(rating, 5));
  };

  const handleDeleteAllReviews = async () => {
    if (!window.confirm('⚠️ Êtes-vous sûr de vouloir supprimer TOUS les avis ? Cette action est irréversible.')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/reviews/stored`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      alert('✅ Tous les avis ont été supprimés');
      fetchStoredReviews();
    } catch (err) {
      alert('❌ Erreur lors de la suppression des avis');
      console.error(err);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackHome = () => {
    navigate('/home');
  };

  const tabStyle = (tabName) => ({
    padding: '12px 24px',
    cursor: 'pointer',
    backgroundColor: activeTab === tabName ? '#007bff' : '#e9ecef',
    color: activeTab === tabName ? 'white' : '#000',
    border: '1px solid #ddd',
    borderBottom: activeTab === tabName ? 'none' : '1px solid #ddd',
    fontWeight: activeTab === tabName ? 'bold' : 'normal',
    borderRadius: '8px 8px 0 0',
    marginRight: '4px'
  });

  return (
    <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>Application Avis Garantis</h1>
        <div>
          <button onClick={handleBackHome} style={{ padding: '10px 20px', marginRight: '10px' }}>
            Retour
          </button>
          <button onClick={handleLogout} style={{ padding: '10px 20px' }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', borderBottom: '2px solid #ddd', marginBottom: '20px' }}>
        <div onClick={() => setActiveTab('config')} style={tabStyle('config')}>
          Configuration
        </div>
        <div onClick={() => setActiveTab('reviews')} style={tabStyle('reviews')}>
          Avis récupérés
        </div>
        <div onClick={() => setActiveTab('logs')} style={tabStyle('logs')}>
          Logs
        </div>
      </div>

      {/* Contenu des onglets */}
      {activeTab === 'config' && (
        <div>
          {/* Formulaire de configuration */}
          <div style={{ backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
            <h2>Configuration</h2>
            <form onSubmit={handleSaveConfig}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>API Key *</label>
                <input
                  type="text"
                  name="api_key"
                  value={config.api_key}
                  onChange={handleConfigChange}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Type d'avis *</label>
                <select
                  name="review_type"
                  value={config.review_type}
                  onChange={handleConfigChange}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="site">Site</option>
                  <option value="product">Produit</option>
                  <option value="both">Les deux</option>
                </select>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Limite (max 1000) *</label>
                <input
                  type="number"
                  name="limit"
                  value={config.limit}
                  onChange={handleConfigChange}
                  min="1"
                  max="1000"
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Product ID (optionnel)</label>
                <input
                  type="text"
                  name="product_id"
                  value={config.product_id}
                  onChange={handleConfigChange}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px' }}>Intervalle de récupération automatique *</label>
                <select
                  name="interval"
                  value={config.interval}
                  onChange={handleConfigChange}
                  required
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="once_daily">Une fois/jour (00:00)</option>
                  <option value="twice_daily">2 fois/jour (00:00-12:00)</option>
                  <option value="4_times">4 fois/jour (toutes les 6h)</option>
                  <option value="8_times">8 fois/jour (toutes les 3h)</option>
                  <option value="10_times">10 fois/jour (toutes les 2h24)</option>
                  <option value="12_times">12 fois/jour (toutes les 2h)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={configSaving}
                style={{
                  padding: '10px 30px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: configSaving ? 'not-allowed' : 'pointer',
                  marginRight: '10px'
                }}
              >
                {configSaving ? 'Sauvegarde...' : 'Enregistrer la configuration'}
              </button>

              {configMessage && (
                <span style={{ marginLeft: '10px', color: configMessage.startsWith('✅') ? 'green' : 'red' }}>
                  {configMessage}
                </span>
              )}
            </form>
          </div>

          {/* Test API */}
          <div style={{ backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
            <h2>Tester l'API maintenant</h2>
            <p>Teste l'API avec les paramètres ci-dessus et récupère les avis immédiatement.</p>
            <button
              onClick={handleTestAPI}
              disabled={testLoading || !config.api_key}
              style={{
                padding: '10px 30px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: (testLoading || !config.api_key) ? 'not-allowed' : 'pointer'
              }}
            >
              {testLoading ? 'Chargement...' : 'Tester l\'API maintenant'}
            </button>

            {testError && (
              <div style={{ backgroundColor: '#fee', padding: '15px', borderRadius: '8px', marginTop: '20px', color: '#c00' }}>
                <strong>Erreur :</strong> {testError}
              </div>
            )}

            {testResult && (
              <div style={{ backgroundColor: '#efe', padding: '20px', borderRadius: '8px', marginTop: '20px' }}>
                <h3>Résultats</h3>
                <p><strong>Statut :</strong> {testResult.success ? '✅ Succès' : '❌ Échec'}</p>
                {testResult.reviewsCount !== undefined && (
                  <p><strong>Avis récupérés :</strong> {testResult.reviewsCount}</p>
                )}
                {testResult.insertedCount !== undefined && (
                  <p><strong>Nouveaux avis insérés :</strong> {testResult.insertedCount}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div style={{ backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>Avis récupérés ({reviews.length})</h2>
            <div>
              <button
                onClick={fetchStoredReviews}
                style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' }}
              >
                🔄 Actualiser
              </button>
              <button
                onClick={handleDeleteAllReviews}
                style={{ padding: '8px 16px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                🗑️ Vider tous les avis
              </button>
            </div>
          </div>

          {reviewsLoading ? (
            <p>Chargement des avis...</p>
          ) : reviews.length === 0 ? (
            <p>Aucun avis récupéré pour le moment</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                <thead>
                  <tr style={{ backgroundColor: '#007bff', color: 'white' }}>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Date</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Client</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Email</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Note</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Type</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Commentaire</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Publication</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Récompense</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.id}>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {review.review_date ? new Date(review.review_date).toLocaleDateString('fr-FR') : 'N/A'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {review.customer_name || 'Anonyme'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {review.customer_email || '-'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {renderStars(review.rating)}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {review.review_type === 'site' ? 'Site' : 'Produit'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', maxWidth: '300px' }}>
                        {review.comment ? (
                          expandedReview === review.id ? (
                            <div>
                              {review.comment}
                              <button
                                onClick={() => setExpandedReview(null)}
                                style={{ marginLeft: '10px', color: '#007bff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                Réduire
                              </button>
                            </div>
                          ) : (
                            <div>
                              {review.comment.length > 100 ? `${review.comment.substring(0, 100)}...` : review.comment}
                              {review.comment.length > 100 && (
                                <button
                                  onClick={() => setExpandedReview(review.id)}
                                  style={{ marginLeft: '10px', color: '#007bff', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  Voir plus
                                </button>
                              )}
                            </div>
                          )
                        ) : '-'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          backgroundColor: review.review_status === 1 ? '#d4edda' : '#f8d7da',
                          color: review.review_status === 1 ? '#155724' : '#721c24',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          {review.review_status === 1 ? '✓ Publié' : '✗ Non publié'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          backgroundColor: review.rewarded ? '#d4edda' : '#e9ecef',
                          color: review.rewarded ? '#155724' : '#6c757d',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          {review.rewarded ? '✓ Récompensé' : 'En attente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div style={{ backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>Historique des logs (30 derniers jours)</h2>
            <div>
              <input
                type="date"
                value={selectedDate}
                onChange={handleDateFilter}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', marginRight: '10px' }}
              />
              <button
                onClick={handleExportLogs}
                style={{ padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Télécharger CSV
              </button>
            </div>
          </div>

          {logsLoading ? (
            <p>Chargement des logs...</p>
          ) : logs.length === 0 ? (
            <p>Aucun log disponible</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                <thead>
                  <tr style={{ backgroundColor: '#007bff', color: 'white' }}>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Date</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Type</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Limite</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Product ID</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Page</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Statut</th>
                    <th style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd' }}>Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        {new Date(log.created_at).toLocaleString('fr-FR')}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>{log.review_type}</td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>{log.limit_value}</td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>{log.product_id || '-'}</td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>{log.page}</td>
                      <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: log.response_status >= 200 && log.response_status < 300 ? '#d4edda' : '#f8d7da',
                          color: log.response_status >= 200 && log.response_status < 300 ? '#155724' : '#721c24'
                        }}>
                          {log.response_status || 'N/A'}
                        </span>
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #ddd', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.error_message || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReviewsApp;
