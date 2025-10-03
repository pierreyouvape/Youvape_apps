import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const RewardsApp = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const API_URL = import.meta.env.VITE_API_URL?.replace('/auth', '') || 'http://localhost:3000/api';

  const [activeTab, setActiveTab] = useState('config');

  // Configuration state
  const [config, setConfig] = useState({
    woocommerce_url: '',
    consumer_key: '',
    consumer_secret: '',
    points_site: 50,
    points_product: 100,
    enabled: true
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Manual reward state
  const [manualReviewId, setManualReviewId] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDateFilter, setHistoryDateFilter] = useState('');

  // Logs state
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsDateFilter, setLogsDateFilter] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    } else if (activeTab === 'logs') {
      loadLogs();
    }
  }, [activeTab, historyDateFilter, logsDateFilter]);

  const loadConfig = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/rewards/config`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.config) {
        setConfig(response.data.config);
      }
    } catch (error) {
      console.error('Erreur lors du chargement de la configuration:', error);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveConfig = async () => {
    try {
      setConfigLoading(true);
      setTestResult(null);

      const response = await axios.post(`${API_URL}/api/rewards/config`, config, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(response.data.message || 'Configuration sauvegardée avec succès');
      await loadConfig();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      alert('Erreur lors de la sauvegarde de la configuration');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTestLoading(true);
      setTestResult(null);

      const response = await axios.post(`${API_URL}/api/rewards/test-connection`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setTestResult({ success: true, message: response.data.message });
    } catch (error) {
      console.error('Erreur lors du test:', error);
      setTestResult({
        success: false,
        message: error.response?.data?.error || 'Erreur lors du test de connexion'
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleProcessRewards = async () => {
    if (!confirm('Voulez-vous lancer le processus de récompense manuellement ?')) {
      return;
    }

    try {
      setProcessLoading(true);

      const response = await axios.post(`${API_URL}/api/rewards/process`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Processus terminé:\n- ${response.data.stats.processed} avis traités\n- ${response.data.stats.rewarded} avis récompensés\n- ${response.data.stats.errors} erreurs`);

      if (activeTab === 'history') {
        await loadHistory();
      }
    } catch (error) {
      console.error('Erreur lors du processus:', error);
      alert('Erreur lors du processus de récompense');
    } finally {
      setProcessLoading(false);
    }
  };

  const handleManualReward = async () => {
    if (!manualReviewId.trim()) {
      alert('Veuillez entrer un ID d\'avis');
      return;
    }

    try {
      setManualLoading(true);
      setManualResult(null);

      const response = await axios.post(`${API_URL}/api/rewards/manual`, {
        review_id: manualReviewId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setManualResult({ success: true, message: response.data.message });
      setManualReviewId('');

      if (activeTab === 'history') {
        await loadHistory();
      }
    } catch (error) {
      console.error('Erreur lors de la récompense manuelle:', error);
      setManualResult({
        success: false,
        message: error.response?.data?.error || 'Erreur lors de la récompense'
      });
    } finally {
      setManualLoading(false);
    }
  };

  const handleToggleEnabled = async () => {
    try {
      const response = await axios.post(`${API_URL}/api/rewards/toggle`,
        { enabled: !config.enabled },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setConfig(response.data.config);
      alert(response.data.message);
    } catch (error) {
      console.error('Erreur lors du changement de statut:', error);
      alert('Erreur lors du changement de statut');
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);

      const url = historyDateFilter
        ? `${API_URL}/api/rewards/history?date=${historyDateFilter}`
        : `${API_URL}/api/rewards/history`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setHistory(response.data.history || []);
      setStats(response.data.stats || null);
    } catch (error) {
      console.error('Erreur lors du chargement de l\'historique:', error);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      setLogsLoading(true);

      const url = logsDateFilter
        ? `${API_URL}/api/rewards/history?date=${logsDateFilter}`
        : `${API_URL}/api/rewards/history`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setLogs(response.data.history || []);
    } catch (error) {
      console.error('Erreur lors du chargement des logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleExportHistory = async () => {
    try {
      const url = historyDateFilter
        ? `${API_URL}/api/rewards/history/export?date=${historyDateFilter}`
        : `${API_URL}/api/rewards/history/export`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `rewards_history_${historyDateFilter || 'all'}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Erreur lors de l\'export:', error);
      alert('Erreur lors de l\'export de l\'historique');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackHome = () => {
    navigate('/home');
  };

  // Styles
  const tabStyle = (tabName) => ({
    padding: '15px 30px',
    cursor: 'pointer',
    borderBottom: activeTab === tabName ? '3px solid #007bff' : '3px solid transparent',
    color: activeTab === tabName ? '#007bff' : '#666',
    fontWeight: activeTab === tabName ? 'bold' : 'normal',
    transition: 'all 0.3s ease'
  });

  const renderConfigTab = () => (
    <div>
      {/* Configuration Card */}
      <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Configuration WPLoyalty</h2>
          <button
            onClick={handleToggleEnabled}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              backgroundColor: config.enabled ? '#28a745' : '#6c757d',
              color: 'white',
              transition: 'background-color 0.3s ease'
            }}
          >
            {config.enabled ? '✓ Activé' : '✗ Désactivé'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
              URL WooCommerce
            </label>
            <input
              type="text"
              value={config.woocommerce_url}
              onChange={(e) => handleConfigChange('woocommerce_url', e.target.value)}
              placeholder="https://votre-site.com"
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
              Consumer Key
            </label>
            <input
              type="text"
              value={config.consumer_key}
              onChange={(e) => handleConfigChange('consumer_key', e.target.value)}
              placeholder="ck_..."
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
              Consumer Secret
            </label>
            <input
              type="password"
              value={config.consumer_secret}
              onChange={(e) => handleConfigChange('consumer_secret', e.target.value)}
              placeholder="cs_..."
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
                Points pour avis site
              </label>
              <input
                type="number"
                value={config.points_site}
                onChange={(e) => handleConfigChange('points_site', parseInt(e.target.value) || 0)}
                min="0"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', fontSize: '14px' }}>
                Points pour avis produit
              </label>
              <input
                type="number"
                value={config.points_product}
                onChange={(e) => handleConfigChange('points_product', parseInt(e.target.value) || 0)}
                min="0"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', paddingTop: '15px' }}>
            <button
              onClick={handleSaveConfig}
              disabled={configLoading}
              style={{
                flex: 1,
                padding: '15px',
                backgroundColor: configLoading ? '#ccc' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: configLoading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.3s ease'
              }}
            >
              {configLoading ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>

            <button
              onClick={handleTestConnection}
              disabled={testLoading}
              style={{
                flex: 1,
                padding: '15px',
                backgroundColor: testLoading ? '#ccc' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: testLoading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.3s ease'
              }}
            >
              {testLoading ? 'Test en cours...' : 'Tester la connexion'}
            </button>

            <button
              onClick={handleProcessRewards}
              disabled={processLoading}
              style={{
                flex: 1,
                padding: '15px',
                backgroundColor: processLoading ? '#ccc' : '#6f42c1',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: processLoading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.3s ease'
              }}
            >
              {processLoading ? 'Traitement...' : 'Lancer manuellement'}
            </button>
          </div>

          {testResult && (
            <div style={{
              padding: '15px',
              borderRadius: '6px',
              backgroundColor: testResult.success ? '#d4edda' : '#f8d7da',
              color: testResult.success ? '#155724' : '#721c24',
              border: `1px solid ${testResult.success ? '#c3e6cb' : '#f5c6cb'}`
            }}>
              <p style={{ margin: 0, fontWeight: 'bold' }}>
                {testResult.success ? '✓' : '✗'} {testResult.message}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Manual Reward Card */}
      <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '30px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Récompenser un avis spécifique</h3>
        <div style={{ display: 'flex', gap: '15px' }}>
          <input
            type="text"
            value={manualReviewId}
            onChange={(e) => setManualReviewId(e.target.value)}
            placeholder="Entrez l'ID de l'avis"
            style={{
              flex: 1,
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px'
            }}
          />
          <button
            onClick={handleManualReward}
            disabled={manualLoading}
            style={{
              padding: '12px 30px',
              backgroundColor: manualLoading ? '#ccc' : '#fd7e14',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: manualLoading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.3s ease'
            }}
          >
            {manualLoading ? 'Traitement...' : 'Récompenser'}
          </button>
        </div>
        {manualResult && (
          <div style={{
            marginTop: '15px',
            padding: '15px',
            borderRadius: '6px',
            backgroundColor: manualResult.success ? '#d4edda' : '#f8d7da',
            color: manualResult.success ? '#155724' : '#721c24',
            border: `1px solid ${manualResult.success ? '#c3e6cb' : '#f5c6cb'}`
          }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>
              {manualResult.success ? '✓' : '✗'} {manualResult.message}
            </p>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div style={{ backgroundColor: '#d1ecf1', padding: '20px', borderRadius: '8px', border: '1px solid #bee5eb' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0c5460', marginBottom: '10px' }}>ℹ️ Information</h3>
        <p style={{ margin: 0, fontSize: '14px', color: '#0c5460' }}>
          Le système vérifie automatiquement les nouveaux avis publiés toutes les 5 minutes et attribue les points fidélité correspondants.
          Seuls les avis avec <strong>review_status = 1</strong> (publié) et possédant un email client sont récompensés.
        </p>
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Avis récompensés</h2>
        <div style={{ display: 'flex', gap: '15px' }}>
          <input
            type="date"
            value={historyDateFilter}
            onChange={(e) => setHistoryDateFilter(e.target.value)}
            style={{
              padding: '10px 15px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px'
            }}
          />
          <button
            onClick={handleExportHistory}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'background-color 0.3s ease'
            }}
          >
            📥 Exporter CSV
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total récompenses</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{stats.total_rewards}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total points</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#007bff', margin: 0 }}>{stats.total_points}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Réussies</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', margin: 0 }}>{stats.successful_rewards}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Échouées</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#dc3545', margin: 0 }}>{stats.failed_rewards}</p>
          </div>
        </div>
      )}

      {historyLoading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Review ID</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Points</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Type</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Statut API</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Erreur</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => (
                  <tr key={entry.id} style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{new Date(entry.created_at).toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{entry.review_id}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{entry.customer_email}</td>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#007bff' }}>{entry.points_awarded}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        backgroundColor: entry.review_type === 'site' ? '#e7d4f7' : '#cfe2ff',
                        color: entry.review_type === 'site' ? '#6f42c1' : '#0d6efd'
                      }}>
                        {entry.review_type}
                      </span>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      {entry.api_status ? (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          backgroundColor: entry.api_status >= 200 && entry.api_status < 300 ? '#d1e7dd' : '#f8d7da',
                          color: entry.api_status >= 200 && entry.api_status < 300 ? '#0f5132' : '#842029'
                        }}>
                          {entry.api_status}
                        </span>
                      ) : (
                        <span style={{ color: '#6c757d' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px', color: '#dc3545' }}>
                      {entry.error_message || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun avis récompensé pour le moment
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderLogsTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Logs des récompenses</h2>
        <input
          type="date"
          value={logsDateFilter}
          onChange={(e) => setLogsDateFilter(e.target.value)}
          style={{
            padding: '10px 15px',
            border: '1px solid #ddd',
            borderRadius: '6px',
            fontSize: '16px'
          }}
        />
      </div>

      {logsLoading ? (
        <div style={{ textAlign: 'center', padding: '50px', backgroundColor: 'white', borderRadius: '8px' }}>Chargement...</div>
      ) : (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Review ID</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Points</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Type</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Détails</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{new Date(log.created_at).toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{log.review_id}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{log.customer_email}</td>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#007bff' }}>{log.points_awarded}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        backgroundColor: log.review_type === 'site' ? '#e7d4f7' : '#cfe2ff',
                        color: log.review_type === 'site' ? '#6f42c1' : '#0d6efd'
                      }}>
                        {log.review_type}
                      </span>
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      {log.error_message ? (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          backgroundColor: '#f8d7da',
                          color: '#842029'
                        }}>
                          ✗ Échec
                        </span>
                      ) : (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          backgroundColor: '#d1e7dd',
                          color: '#0f5132'
                        }}>
                          ✓ Succès
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      {log.error_message ? (
                        <span style={{ color: '#dc3545' }}>{log.error_message}</span>
                      ) : log.api_response ? (
                        <span style={{ color: '#6c757d' }}>{JSON.stringify(log.api_response).substring(0, 100)}...</span>
                      ) : (
                        <span style={{ color: '#6c757d' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun log disponible
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: '1200px', margin: '30px auto', padding: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1>🎁 Application Récompense Avis</h1>
        <div>
          <button onClick={handleBackHome} style={{ padding: '10px 20px', marginRight: '10px', cursor: 'pointer' }}>
            Retour
          </button>
          <button onClick={handleLogout} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #ddd', marginBottom: '20px' }}>
        <div onClick={() => setActiveTab('config')} style={tabStyle('config')}>
          ⚙️ Configuration
        </div>
        <div onClick={() => setActiveTab('history')} style={tabStyle('history')}>
          🎁 Avis récompensés
        </div>
        <div onClick={() => setActiveTab('logs')} style={tabStyle('logs')}>
          📋 Logs
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'config' && renderConfigTab()}
      {activeTab === 'history' && renderHistoryTab()}
      {activeTab === 'logs' && renderLogsTab()}
    </div>
  );
};

export default RewardsApp;
