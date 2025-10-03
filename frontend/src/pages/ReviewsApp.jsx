import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';

const ReviewsApp = () => {
  const { token, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const API_BASE_URL = import.meta.env.VITE_API_URL?.replace('/auth', '') || 'http://localhost:3000/api';

  // Formulaire
  const [formData, setFormData] = useState({
    api_key: '',
    review_type: 'site',
    limit: 100,
    product_id: '',
    page: 1
  });

  // Résultats
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Logs
  const [logs, setLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  // Charger les logs au montage
  useEffect(() => {
    fetchLogs();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/reviews/fetch`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      setResult(response.data);
      // Recharger les logs après un nouvel appel
      fetchLogs();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Erreur lors de l\'appel API');
      setResult(err.response?.data || null);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (date = '') => {
    setLogsLoading(true);
    try {
      const url = date
        ? `${API_BASE_URL}/reviews/logs?date=${date}`
        : `${API_BASE_URL}/reviews/logs`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
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

  const handleExport = async () => {
    try {
      const url = selectedDate
        ? `${API_BASE_URL}/reviews/logs/export?date=${selectedDate}`
        : `${API_BASE_URL}/reviews/logs/export`;

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        responseType: 'blob'
      });

      // Créer un lien de téléchargement
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackHome = () => {
    navigate('/home');
  };

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

      {/* Formulaire */}
      <div style={{ backgroundColor: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
        <h2>Tester l'API</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>API Key *</label>
            <input
              type="text"
              name="api_key"
              value={formData.api_key}
              onChange={handleChange}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Type d'avis *</label>
            <select
              name="review_type"
              value={formData.review_type}
              onChange={handleChange}
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
              value={formData.limit}
              onChange={handleChange}
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
              value={formData.product_id}
              onChange={handleChange}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>Page</label>
            <input
              type="number"
              name="page"
              value={formData.page}
              onChange={handleChange}
              min="1"
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '10px 30px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Chargement...' : 'Tester l\'API'}
          </button>
        </form>
      </div>

      {/* Résultats */}
      {error && (
        <div style={{ backgroundColor: '#fee', padding: '15px', borderRadius: '8px', marginBottom: '20px', color: '#c00' }}>
          <strong>Erreur :</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ backgroundColor: '#efe', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
          <h3>Résultats</h3>
          <p><strong>Statut :</strong> {result.success ? '✅ Succès' : '❌ Échec'}</p>
          {result.reviewsCount !== undefined && (
            <p><strong>Nombre d'avis récupérés :</strong> {result.reviewsCount}</p>
          )}
          <details style={{ marginTop: '15px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Voir les données JSON</summary>
            <pre style={{
              backgroundColor: '#f5f5f5',
              padding: '10px',
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '400px',
              marginTop: '10px'
            }}>
              {JSON.stringify(result.data || result.details, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Logs */}
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
              onClick={handleExport}
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
    </div>
  );
};

export default ReviewsApp;
