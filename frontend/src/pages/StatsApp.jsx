import { useContext, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import ReportsTab from '../components/stats/ReportsTab';
import CustomersStatsTab from '../components/stats/CustomersStatsTab';
import ProductsStatsTab from '../components/stats/ProductsStatsTab';
import BrandsStatsTab from '../components/stats/BrandsStatsTab';
import CategoriesStatsTab from '../components/stats/CategoriesStatsTab';
import OrdersStatsTab from '../components/stats/OrdersStatsTab';
import AnalysisTab from '../components/stats/AnalysisTab';

const StatsApp = () => {
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const { tab } = useParams();

  const tabs = [
    { id: 'reports', label: 'Rapports', component: ReportsTab },
    { id: 'clients', label: 'Clients', component: CustomersStatsTab },
    { id: 'products', label: 'Produits', component: ProductsStatsTab },
    { id: 'brands', label: 'Marques', component: BrandsStatsTab },
    { id: 'categories', label: 'Categories', component: CategoriesStatsTab },
    { id: 'orders', label: 'Commandes', component: OrdersStatsTab },
    { id: 'analysis', label: 'Analyse', component: AnalysisTab },
  ];

  // Onglet actif basé sur l'URL, défaut = reports
  const activeTab = tabs.find((t) => t.id === tab)?.id || 'reports';

  // Rediriger vers /stats/reports si on est sur /stats sans onglet
  useEffect(() => {
    if (!tab) {
      navigate('/stats/reports', { replace: true });
    }
  }, [tab, navigate]);

  const handleTabChange = (tabId) => {
    navigate(`/stats/${tabId}`);
  };

  const ActiveTabComponent = tabs.find((t) => t.id === activeTab)?.component;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleBackHome = () => {
    navigate('/home');
  };

  const tabStyle = (tabId) => ({
    padding: '15px 30px',
    cursor: 'pointer',
    borderBottom: activeTab === tabId ? '3px solid #007bff' : '3px solid transparent',
    color: activeTab === tabId ? '#007bff' : '#666',
    fontWeight: activeTab === tabId ? 'bold' : 'normal',
    transition: 'all 0.3s ease'
  });

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
        <div style={{ position: 'absolute', right: '20px', display: 'flex', gap: '10px' }}>
          <button
            onClick={() => navigate('/stats/shipping-settings')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#ffc107',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            ⚙️ Paramètres
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
            Retour
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
        {/* Onglets */}
        <div style={{ display: 'flex', borderBottom: '2px solid #ddd', marginBottom: '20px' }}>
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              style={tabStyle(t.id)}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Contenu de l'onglet actif */}
        <div>{ActiveTabComponent && <ActiveTabComponent />}</div>
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
