import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Login from './components/Login';
import Register from './components/Register';
import Home from './pages/Home';
import ReviewsApp from './pages/ReviewsApp';
import RewardsApp from './pages/RewardsApp';
import EmailApp from './pages/EmailApp';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/home"
            element={
              <PrivateRoute>
                <Home />
              </PrivateRoute>
            }
          />
          <Route
            path="/reviews"
            element={
              <PrivateRoute>
                <ReviewsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/rewards"
            element={
              <PrivateRoute>
                <RewardsApp />
              </PrivateRoute>
            }
          />
          <Route
            path="/emails"
            element={
              <PrivateRoute>
                <EmailApp />
              </PrivateRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;