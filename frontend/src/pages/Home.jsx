import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleGoToReviews = () => {
    navigate('/reviews');
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px' }}>
      <h1>Bienvenue sur Youvape Apps</h1>
      <p>Connecté en tant que : <strong>{user?.email}</strong></p>

      <div style={{ marginTop: '30px' }}>
        <h2>Applications disponibles</h2>
        <div
          onClick={handleGoToReviews}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '15px 25px',
            backgroundColor: '#007bff',
            color: 'white',
            borderRadius: '8px',
            cursor: 'pointer',
            marginTop: '15px',
            fontSize: '16px',
            border: 'none'
          }}
        >
          <span style={{ fontSize: '24px' }}>📱</span>
          <span>Avis Garantis</span>
        </div>
      </div>

      <button onClick={handleLogout} style={{ padding: '10px 20px', marginTop: '30px' }}>
        Se déconnecter
      </button>
    </div>
  );
};

export default Home;