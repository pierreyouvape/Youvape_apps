import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import NeedsTab from '../components/purchases/NeedsTab';
import SuppliersTab from '../components/purchases/SuppliersTab';
import OrdersTab from '../components/purchases/OrdersTab';
import './PurchasesApp.css';

const PurchasesApp = () => {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('needs');

  const tabs = [
    { id: 'needs', label: 'Besoins', icon: '📊' },
    { id: 'suppliers', label: 'Fournisseurs', icon: '🏭' },
    { id: 'orders', label: 'Commandes', icon: '📦' }
  ];

  const handleGoHome = () => {
    navigate('/home');
  };

  return (
    <div className="purchases-app">
      {/* Header */}
      <header className="purchases-header">
        <div className="header-left">
          <button className="back-button" onClick={handleGoHome}>
            ← Accueil
          </button>
          <h1>🛒 Gestion d'achat</h1>
        </div>
      </header>

      {/* Tabs */}
      <nav className="purchases-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="purchases-content">
        {activeTab === 'needs' && <NeedsTab token={token} />}
        {activeTab === 'suppliers' && <SuppliersTab token={token} />}
        {activeTab === 'orders' && <OrdersTab token={token} />}
      </main>
    </div>
  );
};

export default PurchasesApp;
