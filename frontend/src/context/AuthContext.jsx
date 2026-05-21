import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('dress_shop_token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('dress_shop_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [cartCount, setCartCount] = useState(0);

  async function loadCartCount() {
    if (!token) {
      setCartCount(0);
      return;
    }

    try {
      const { data } = await api.get('/cart');
      const cartItems = data.cartItems || data.items || [];
      setCartCount(cartItems.length);
    } catch (error) {
      setCartCount(0);
    }
  }

  useEffect(() => {
    loadCartCount();
  }, [token]);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', {
      email: String(email || '').trim(),
      password: String(password || '').trim()
    });
    localStorage.setItem('dress_shop_token', data.token);
    localStorage.setItem('dress_shop_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    await loadCartCount();
    return data.user;
  }

  async function register(payload) {
    const { data } = await api.post('/auth/register', payload);
    localStorage.setItem('dress_shop_token', data.token);
    localStorage.setItem('dress_shop_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    await loadCartCount();
  }

  async function updateUser(payload) {
    const { data } = await api.put('/auth/me', payload);
    localStorage.setItem('dress_shop_token', data.token);
    localStorage.setItem('dress_shop_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('dress_shop_token');
    localStorage.removeItem('dress_shop_user');
    setToken(null);
    setUser(null);
    setCartCount(0);
  }

  const value = useMemo(() => ({
    token,
    user,
    cartCount,
    login,
    register,
    updateUser,
    logout,
    refreshCartCount: loadCartCount,
    isAdmin: user?.role === 'ADMIN'
  }), [token, user, cartCount]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
