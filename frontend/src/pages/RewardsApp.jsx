import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const RewardsApp = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();

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

  // Logs state (same as history but for logs tab)
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

  const renderConfigTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800">Configuration WPLoyalty</h2>
          <button
            onClick={handleToggleEnabled}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              config.enabled
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-400 hover:bg-gray-500 text-white'
            }`}
          >
            {config.enabled ? '✓ Activé' : '✗ Désactivé'}
          </button>
        </div>

        <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            URL WooCommerce
          </label>
          <input
            type="text"
            value={config.woocommerce_url}
            onChange={(e) => handleConfigChange('woocommerce_url', e.target.value)}
            placeholder="https://votre-site.com"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Consumer Key
          </label>
          <input
            type="text"
            value={config.consumer_key}
            onChange={(e) => handleConfigChange('consumer_key', e.target.value)}
            placeholder="ck_..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Consumer Secret
          </label>
          <input
            type="password"
            value={config.consumer_secret}
            onChange={(e) => handleConfigChange('consumer_secret', e.target.value)}
            placeholder="cs_..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Points pour avis site
            </label>
            <input
              type="number"
              value={config.points_site}
              onChange={(e) => handleConfigChange('points_site', parseInt(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Points pour avis produit
            </label>
            <input
              type="number"
              value={config.points_product}
              onChange={(e) => handleConfigChange('points_product', parseInt(e.target.value) || 0)}
              min="0"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={handleSaveConfig}
            disabled={configLoading}
            className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition"
          >
            {configLoading ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>

          <button
            onClick={handleTestConnection}
            disabled={testLoading}
            className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 transition"
          >
            {testLoading ? 'Test en cours...' : 'Tester la connexion'}
          </button>

          <button
            onClick={handleProcessRewards}
            disabled={processLoading}
            className="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 disabled:bg-gray-400 transition"
          >
            {processLoading ? 'Traitement...' : 'Lancer manuellement'}
          </button>
        </div>

        {testResult && (
          <div className={`p-4 rounded-lg ${testResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <p className="font-semibold">{testResult.success ? '✓' : '✗'} {testResult.message}</p>
          </div>
        )}
      </div>
      </div>

      {/* Manual Reward Section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Récompenser un avis spécifique</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={manualReviewId}
            onChange={(e) => setManualReviewId(e.target.value)}
            placeholder="Entrez l'ID de l'avis"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleManualReward}
            disabled={manualLoading}
            className="bg-orange-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-orange-700 disabled:bg-gray-400 transition"
          >
            {manualLoading ? 'Traitement...' : 'Récompenser'}
          </button>
        </div>
        {manualResult && (
          <div className={`mt-4 p-4 rounded-lg ${manualResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            <p className="font-semibold">{manualResult.success ? '✓' : '✗'} {manualResult.message}</p>
          </div>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">ℹ️ Information</h3>
        <p className="text-sm text-blue-800">
          Le système vérifie automatiquement les nouveaux avis publiés toutes les 5 minutes et attribue les points fidélité correspondants.
          Seuls les avis avec <strong>review_status = 1</strong> (publié) et possédant un email client sont récompensés.
        </p>
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-800">Avis récompensés</h2>
        <div className="flex gap-3">
          <input
            type="date"
            value={historyDateFilter}
            onChange={(e) => setHistoryDateFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleExportHistory}
            className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition"
          >
            📥 Exporter CSV
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-md p-4">
            <p className="text-sm text-gray-600">Total récompenses</p>
            <p className="text-2xl font-bold text-gray-800">{stats.total_rewards}</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <p className="text-sm text-gray-600">Total points</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total_points}</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <p className="text-sm text-gray-600">Réussies</p>
            <p className="text-2xl font-bold text-green-600">{stats.successful_rewards}</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-4">
            <p className="text-sm text-gray-600">Échouées</p>
            <p className="text-2xl font-bold text-red-600">{stats.failed_rewards}</p>
          </div>
        </div>
      )}

      {historyLoading ? (
        <div className="text-center py-8">Chargement...</div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Review ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut API</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Erreur</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {history.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(entry.created_at).toLocaleString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{entry.review_id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{entry.customer_email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600">
                      {entry.points_awarded}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        entry.review_type === 'site' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {entry.review_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {entry.api_status ? (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          entry.api_status >= 200 && entry.api_status < 300
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {entry.api_status}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600">
                      {entry.error_message || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Aucun avis récompensé pour le moment
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderLogsTab = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-gray-800">Logs des récompenses</h2>
        <input
          type="date"
          value={logsDateFilter}
          onChange={(e) => setLogsDateFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {logsLoading ? (
        <div className="text-center py-8">Chargement...</div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Review ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Détails</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(log.created_at).toLocaleString('fr-FR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.review_id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.customer_email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-blue-600">
                      {log.points_awarded}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        log.review_type === 'site' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {log.review_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {log.error_message ? (
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800">
                          ✗ Échec
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-800">
                          ✓ Succès
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {log.error_message ? (
                        <span className="text-red-600">{log.error_message}</span>
                      ) : log.api_response ? (
                        <span className="text-gray-600">{JSON.stringify(log.api_response).substring(0, 100)}...</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              Aucun log disponible
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/home')}
              className="text-gray-600 hover:text-gray-800 font-semibold transition"
            >
              ← Retour
            </button>
            <h1 className="text-2xl font-bold text-gray-800">🎁 Récompense Avis</h1>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
          >
            Déconnexion
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-1 px-6 py-4 font-semibold transition ${
                activeTab === 'config'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              ⚙️ Configuration
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 px-6 py-4 font-semibold transition ${
                activeTab === 'history'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              🎁 Avis récompensés
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex-1 px-6 py-4 font-semibold transition ${
                activeTab === 'logs'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              📋 Logs
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'config' && renderConfigTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'logs' && renderLogsTab()}
      </div>
    </div>
  );
};

export default RewardsApp;
