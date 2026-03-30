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
      <div style={{ backgroundColor: '#ff6b6b', color: 'white', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={handleBackHome} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
            ← Accueil
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>📊 Statistiques WooCommerce</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => navigate('/stats/shipping-settings')}
            style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            ⚙️ Paramètres
          </button>
          <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
            Déconnexion
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: '20px 60px', width: '100%' }}>
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
        backgroundColor: '#ff6b6b',
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
