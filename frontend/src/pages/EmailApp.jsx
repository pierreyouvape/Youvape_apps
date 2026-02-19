import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const EmailApp = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/auth', '') || 'http://localhost:3000/api';

  const [activeTab, setActiveTab] = useState('config');

  // Configuration state
  const [config, setConfig] = useState({
    probance_url: 'https://www.probancemail.com/rest/v2/send/',
    probance_token: '',
    campaign_external_id: '',
    enabled: true
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testEmail, setTestEmail] = useState('');

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
      const response = await axios.get(`${API_BASE_URL}/emails/config`, {
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

      const response = await axios.post(`${API_BASE_URL}/emails/config`, config, {
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
    if (!testEmail.trim()) {
      alert('Veuillez entrer une adresse email de test');
      return;
    }

    try {
      setTestLoading(true);
      setTestResult(null);

      const response = await axios.post(`${API_BASE_URL}/emails/test-connection`, {
        test_email: testEmail
      }, {
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

  const handleProcessEmails = async () => {
    if (!confirm('Voulez-vous lancer le processus d\'envoi d\'emails manuellement ?')) {
      return;
    }

    try {
      setProcessLoading(true);

      const response = await axios.post(`${API_BASE_URL}/emails/process`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(`Processus terminé:\n- ${response.data.stats.processed} commandes traitées\n- ${response.data.stats.sent} emails envoyés\n- ${response.data.stats.errors} erreurs`);

      if (activeTab === 'history') {
        await loadHistory();
      }
    } catch (error) {
      console.error('Erreur lors du processus:', error);
      alert('Erreur lors du processus d\'envoi d\'emails');
    } finally {
      setProcessLoading(false);
    }
  };

  const handleToggleEnabled = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/emails/toggle`,
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
        ? `${API_BASE_URL}/emails/history?date=${historyDateFilter}`
        : `${API_BASE_URL}/emails/history`;

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
        ? `${API_BASE_URL}/emails/logs?date=${logsDateFilter}`
        : `${API_BASE_URL}/emails/logs`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setLogs(response.data.logs || []);
    } catch (error) {
      console.error('Erreur lors du chargement des logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleExportHistory = async () => {
    try {
      const url = historyDateFilter
        ? `${API_BASE_URL}/emails/history/export?date=${historyDateFilter}`
        : `${API_BASE_URL}/emails/history/export`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `email_history_${historyDateFilter || 'all'}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Erreur lors de l\'export:', error);
      alert('Erreur lors de l\'export de l\'historique');
    }
  };

  const handleExportLogs = async () => {
    try {
      const url = logsDateFilter
        ? `${API_BASE_URL}/emails/logs/export?date=${logsDateFilter}`
        : `${API_BASE_URL}/emails/logs/export`;

      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `email_logs_${logsDateFilter || 'all'}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Erreur lors de l\'export:', error);
      alert('Erreur lors de l\'export des logs');
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
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Configuration Probance</h2>
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
              URL Probance
            </label>
            <input
              type="text"
              value={config.probance_url}
              onChange={(e) => handleConfigChange('probance_url', e.target.value)}
              placeholder="https://www.probancemail.com/rest/v2/send/"
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
              Token Probance
            </label>
            <input
              type="password"
              value={config.probance_token}
              onChange={(e) => handleConfigChange('probance_token', e.target.value)}
              placeholder="Votre token API Probance"
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
              Campaign External ID
            </label>
            <input
              type="text"
              value={config.campaign_external_id}
              onChange={(e) => handleConfigChange('campaign_external_id', e.target.value)}
              placeholder="RT-433831"
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
              onClick={handleProcessEmails}
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
        </div>
      </div>

      {/* Test Email Card */}
      <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', marginBottom: '30px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>Tester l'envoi d'email</h3>
        <p style={{ fontSize: '14px', color: '#6c757d', marginBottom: '15px' }}>
          Ce test n'écrira pas dans la base de données. Il servira uniquement à vérifier que l'API Probance fonctionne correctement.
        </p>
        <div style={{ display: 'flex', gap: '15px' }}>
          <input
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="email@example.com"
            style={{
              flex: 1,
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '16px'
            }}
          />
          <button
            onClick={handleTestConnection}
            disabled={testLoading}
            style={{
              padding: '12px 30px',
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
            {testLoading ? 'Envoi...' : 'Envoyer test'}
          </button>
        </div>
        {testResult && (
          <div style={{
            marginTop: '15px',
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

      {/* Info Card */}
      <div style={{ backgroundColor: '#d1ecf1', padding: '20px', borderRadius: '8px', border: '1px solid #bee5eb' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0c5460', marginBottom: '10px' }}>ℹ️ Information</h3>
        <p style={{ margin: 0, fontSize: '14px', color: '#0c5460' }}>
          Le système vérifie automatiquement les avis récompensés toutes les 5 minutes et envoie un email par commande.
          <strong> Un seul email par order_id</strong>, même si plusieurs avis ont été récompensés pour cette commande.
        </p>
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Historique des emails envoyés</h2>
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
              padding: '6px 12px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            CSV
          </button>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total emails envoyés</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>{stats.total_emails_sent}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Commandes uniques</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#007bff', margin: 0 }}>{stats.unique_orders || 0}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#6c757d', margin: '0 0 10px 0' }}>Total avis notifiés</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#28a745', margin: 0 }}>{stats.total_reviews_notified}</p>
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
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Order ID</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Avis récompensés</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{new Date(entry.sent_at).toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#007bff' }}>{entry.order_id}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{entry.customer_email}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        backgroundColor: '#d1e7dd',
                        color: '#0f5132'
                      }}>
                        {entry.reviews_count} avis
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length === 0 && (
            <div style={{ textAlign: 'center', padding: '50px', color: '#6c757d' }}>
              Aucun email envoyé pour le moment
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderLogsTab = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', flexWrap: 'wrap', gap: '15px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>Logs des emails</h2>
        <div style={{ display: 'flex', gap: '15px' }}>
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
          <button
            onClick={handleExportLogs}
            style={{
              padding: '6px 12px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            CSV
          </button>
        </div>
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
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Order ID</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Email</th>
                  <th style={{ padding: '15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6c757d', textTransform: 'uppercase' }}>Avis</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderTop: '1px solid #dee2e6' }}>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{new Date(log.sent_at).toLocaleString('fr-FR')}</td>
                    <td style={{ padding: '15px', fontSize: '14px', fontWeight: 'bold', color: '#007bff' }}>{log.order_id}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{log.customer_email}</td>
                    <td style={{ padding: '15px', fontSize: '14px' }}>{log.reviews_count}</td>
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
        <h1>📧 Application Envoi d'Emails</h1>
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
          📧 Historique
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

export default EmailApp;
