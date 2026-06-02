import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { GUEST_CART_EVENT, getGuestCartCount } from '../utils/guestCart';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('dress_shop_token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('dress_shop_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [cartCount, setCartCount] = useState(0);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem('dress_shop_token')));

  function clearUserState() {
    setUser(null);
    setCartCount(0);
    localStorage.removeItem('dress_shop_user');
    localStorage.removeItem('dress_shop_role');
    localStorage.removeItem('dress_shop_coupon_code');
    localStorage.removeItem('monthly_template_checkout');
    sessionStorage.removeItem('dress_shop_user');
    sessionStorage.removeItem('dress_shop_role');
    sessionStorage.removeItem('super_coin_wallet');
  }

  function clearAuthStorage() {
    localStorage.removeItem('dress_shop_token');
    localStorage.removeItem('dress_shop_user');
    localStorage.removeItem('dress_shop_role');
    localStorage.removeItem('dress_shop_coupon_code');
    localStorage.removeItem('monthly_template_checkout');
    sessionStorage.removeItem('dress_shop_token');
    sessionStorage.removeItem('dress_shop_user');
    sessionStorage.removeItem('dress_shop_role');
    sessionStorage.removeItem('super_coin_wallet');
  }

  async function loadCartCount() {
    if (!token) {
      setCartCount(getGuestCartCount());
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

  useEffect(() => {
    function syncGuestCartCount() {
      if (!token) setCartCount(getGuestCartCount());
    }
    window.addEventListener(GUEST_CART_EVENT, syncGuestCartCount);
    window.addEventListener('storage', syncGuestCartCount);
    return () => {
      window.removeEventListener(GUEST_CART_EVENT, syncGuestCartCount);
      window.removeEventListener('storage', syncGuestCartCount);
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!token) {
        setAuthLoading(false);
        clearUserState();
        return;
      }

      setAuthLoading(true);
      try {
        const { data } = await api.get('/auth/me');
        if (cancelled) return;
        localStorage.setItem('dress_shop_user', JSON.stringify(data));
        localStorage.setItem('dress_shop_role', data.role);
        setUser(data);
      } catch (error) {
        if (cancelled) return;
        clearAuthStorage();
        setToken(null);
        clearUserState();
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function login(email, password) {
    clearAuthStorage();
    setToken(null);
    clearUserState();
    setAuthLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email: String(email || '').trim(),
        password: String(password || '').trim()
      });
      localStorage.setItem('dress_shop_token', data.token);
      localStorage.setItem('dress_shop_role', data.user.role);
      setToken(data.token);
      const profile = await api.get('/auth/me', { headers: { Authorization: `Bearer ${data.token}` } });
      localStorage.setItem('dress_shop_user', JSON.stringify(profile.data));
      localStorage.setItem('dress_shop_role', profile.data.role);
      setUser(profile.data);
      await loadCartCount();
      return profile.data;
    } finally {
      setAuthLoading(false);
    }
  }

  async function register(payload) {
    clearAuthStorage();
    clearUserState();
    setAuthLoading(true);
    try {
      const { data } = await api.post('/auth/register', payload);
      localStorage.setItem('dress_shop_token', data.token);
      localStorage.setItem('dress_shop_user', JSON.stringify(data.user));
      localStorage.setItem('dress_shop_role', data.user.role);
      setToken(data.token);
      setUser(data.user);
      await loadCartCount();
    } finally {
      setAuthLoading(false);
    }
  }

  async function updateUser(payload) {
    const { data } = await api.put('/auth/me', payload);
    localStorage.setItem('dress_shop_token', data.token);
    localStorage.setItem('dress_shop_user', JSON.stringify(data.user));
    localStorage.setItem('dress_shop_role', data.user.role);
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    clearAuthStorage();
    setToken(null);
    clearUserState();
    setAuthLoading(false);
  }

  const role = user?.role || localStorage.getItem('dress_shop_role') || '';
  const normalizedRole = String(role).toUpperCase();
  const isAuthenticated = Boolean(token && user);

  const value = useMemo(() => ({
    token,
    user,
    role: normalizedRole,
    isAuthenticated,
    authLoading,
    cartCount,
    login,
    register,
    updateUser,
    logout,
    refreshCartCount: loadCartCount,
    isAdmin: normalizedRole === 'ADMIN'
  }), [token, user, normalizedRole, isAuthenticated, authLoading, cartCount]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
