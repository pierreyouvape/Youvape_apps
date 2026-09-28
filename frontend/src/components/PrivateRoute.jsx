import { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useContext(AuthContext);
  const location = useLocation();

  if (loading) return null;
  // La page demandée suit jusqu'au login, qui y renvoie une fois connecté :
  // indispensable pour le raccourci du PDA (/pda), qui sinon atterrirait sur l'accueil.
  return isAuthenticated ? children : <Navigate to="/login" state={{ from: location.pathname + location.search }} />;
};

export default PrivateRoute;