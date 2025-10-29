import { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const BASE_API_URL = import.meta.env.VITE_API_URL || 'http://54.37.156.233:3000/api';
  const API_URL = `${BASE_API_URL}/auth`;

  // Charger les permissions de l'utilisateur
  const loadPermissions = async (authToken) => {
    try {
      const response = await axios.get(`${BASE_API_URL}/users/me/permissions`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      const { permissions: userPerms, is_admin, is_super_admin } = response.data;
      setPermissions(userPerms);
      setIsAdmin(is_admin);
      setIsSuperAdmin(is_super_admin);

      localStorage.setItem('permissions', JSON.stringify(userPerms));
      localStorage.setItem('isAdmin', JSON.stringify(is_admin));
      localStorage.setItem('isSuperAdmin', JSON.stringify(is_super_admin));
    } catch (error) {
      console.error('Erreur lors du chargement des permissions:', error);
      // En cas d'erreur, on met des permissions vides
      setPermissions({});
      setIsAdmin(false);
      setIsSuperAdmin(false);
    }
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    const savedPermissions = localStorage.getItem('permissions');
    const savedIsAdmin = localStorage.getItem('isAdmin');
    const savedIsSuperAdmin = localStorage.getItem('isSuperAdmin');

    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));

      // Charger les permissions sauvegardées
      if (savedPermissions) {
        setPermissions(JSON.parse(savedPermissions));
      }
      if (savedIsAdmin) {
        setIsAdmin(JSON.parse(savedIsAdmin));
      }
      if (savedIsSuperAdmin) {
        setIsSuperAdmin(JSON.parse(savedIsSuperAdmin));
      }

      // Recharger les permissions depuis l'API
      loadPermissions(savedToken);
    }
    setLoading(false);
  }, []);

  const register = async (email, password) => {
    const response = await axios.post(`${API_URL}/register`, { email, password });
    return response.data;
  };

  const login = async (email, password) => {
    const response = await axios.post(`${API_URL}/login`, { email, password });
    const { token, user } = response.data;

    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);

    // Charger les permissions après le login
    await loadPermissions(token);

    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('isSuperAdmin');
    setToken(null);
    setUser(null);
    setPermissions(null);
    setIsAdmin(false);
    setIsSuperAdmin(false);
  };

  const value = {
    user,
    token,
    permissions,
    isAdmin,
    isSuperAdmin,
    loading,
    isAuthenticated: !!token,
    register,
    login,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};