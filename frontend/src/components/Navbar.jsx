import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ChevronDown, Coins, Headset, Heart, Menu, PackageSearch, Search, ShoppingBag, User, X } from 'lucide-react';
import api from '../services/api';
import MegaMenu from './MegaMenu';

export default function Navbar() {
  const { token, user, authLoading, isAdmin, logout, cartCount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeMegaMenu, setActiveMegaMenu] = useState('');
  const [megaOpenedByHover, setMegaOpenedByHover] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [siteLogo, setSiteLogo] = useState(null);
  const [companySettings, setCompanySettings] = useState(null);
  const [superCoinBalance, setSuperCoinBalance] = useState(null);
  const navRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadHeaderBrand();
    window.addEventListener('site-logo-updated', loadHeaderBrand);
    window.addEventListener('company-settings-updated', loadHeaderBrand);
    return () => {
      window.removeEventListener('site-logo-updated', loadHeaderBrand);
      window.removeEventListener('company-settings-updated', loadHeaderBrand);
    };
  }, []);

  useEffect(() => {
    if (!user || isAdmin) {
      setSuperCoinBalance(null);
      return;
    }
    api.get('/super-coins/balance')
      .then(({ data }) => setSuperCoinBalance(data.wallet?.balance || 0))
      .catch(() => setSuperCoinBalance(null));
  }, [user, isAdmin]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!activeMegaMenu) return;
      if (navRef.current?.contains(event.target)) return;
      setActiveMegaMenu('');
      setMegaOpenedByHover(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activeMegaMenu]);

  async function loadHeaderBrand() {
    await Promise.all([loadSiteLogo(), loadCompanySettings()]);
  }

  async function loadSiteLogo() {
    try {
      const { data } = await api.get('/logo');
      setSiteLogo(data.logo || null);
    } catch (error) {
      setSiteLogo(null);
    }
  }

  async function loadCompanySettings() {
    try {
      const { data } = await api.get('/company-settings');
      setCompanySettings(data.settings || null);
    } catch (error) {
      setCompanySettings(null);
    }
  }

  function signOut() {
    logout();
    setMenuOpen(false);
    setMobileOpen(false);
    navigate('/login');
  }

  function submitSearch(event) {
    event.preventDefault();
    const search = searchText.trim();
    navigate(search ? `/?search=${encodeURIComponent(search)}` : '/');
    setMobileOpen(false);
  }

  function closeMenMegaMenu() {
    setActiveMegaMenu('');
    setMegaOpenedByHover(false);
    setMobileOpen(false);
  }

  function toggleMegaMenu(menu) {
    setActiveMegaMenu((current) => {
      if (current === menu && megaOpenedByHover && !mobileOpen) {
        setMegaOpenedByHover(false);
        return current;
      }
      setMegaOpenedByHover(false);
      return current === menu ? '' : menu;
    });
  }

  function openGenderPage(gender) {
    navigate(`/${gender}`);
    setActiveMegaMenu('');
    setMegaOpenedByHover(false);
    setMobileOpen(false);
  }

  function openMegaMenuByHover(menu) {
    if (mobileOpen) return;
    setActiveMegaMenu(menu);
    setMegaOpenedByHover(true);
  }

  const menuItems = [
    { label: 'MEN', gender: 'men' },
    { label: 'WOMEN', gender: 'women' },
    { label: 'KIDS', gender: 'kids' },
    { label: 'HOME', to: '/' }
  ];
  const accountLinks = [
    ['My Profile', '/profile'],
    ['My Orders', '/orders'],
    ['Monthly Purchase Template', '/monthly-template'],
    ['Review & Rating', '/reviews'],
    ['Saved UPI IDs', '/saved-payments?tab=upi'],
    ['Saved Cards', '/saved-payments?tab=cards'],
    ['Payment Methods', '/saved-payments'],
    ['Coupons', '/account/coupons'],
    ['Super Coins', '/super-coins'],
    ['My Wallet', '/wallet'],
    ['Address Book', '/addresses'],
    ['My Tickets', '/help/my-tickets']
  ];
  const showGuestTrackOrder = !authLoading && !token && !user;

  return (
    <nav ref={navRef} className={isAdmin ? 'app-nav fashion-nav admin-nav sticky-top' : 'app-nav fashion-nav sticky-top'}>
      <div className="fashion-nav-inner">
        <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen((open) => !open)} aria-label="Toggle menu">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Link className="brand-mark fashion-logo" to="/" onClick={() => { setMobileOpen(false); }}>
          {siteLogo?.logoUrl ? (
            <img className="site-logo-image" src={siteLogo.logoUrl} alt="DressShop" />
          ) : (
            <span>DS</span>
          )}
          <strong>{companySettings?.companyName || 'DressShop'}</strong>
        </Link>

        <div className={mobileOpen ? 'fashion-menu open' : 'fashion-menu'}>
          {menuItems.map((item) => (
            item.gender ? (
              <div className="nav-tab-group" key={item.label}>
                <button
                  className={`fashion-menu-link nav-tab ${activeMegaMenu === item.gender ? 'active' : ''}`}
                  type="button"
                  onMouseEnter={() => openMegaMenuByHover(item.gender)}
                  onClick={() => mobileOpen ? toggleMegaMenu(item.gender) : openGenderPage(item.gender)}
                  aria-expanded={activeMegaMenu === item.gender}
                >
                  {item.label}
                  <ChevronDown className="arrow" size={14} />
                </button>
                {mobileOpen && activeMegaMenu === item.gender && (
                  <MegaMenu
                    gender={item.gender}
                    open
                    mobile
                    onClose={closeMenMegaMenu}
                  />
                )}
              </div>
            ) : (
              <NavLink key={item.label} to={item.to} onClick={() => { setMobileOpen(false); setActiveMegaMenu(''); }}>
                {item.label}
              </NavLink>
            )
          ))}
          {isAdmin && <NavLink to="/admin/products" onClick={() => { setMobileOpen(false); }}>PRODUCTS</NavLink>}
          {isAdmin && <NavLink to="/admin/genders" onClick={() => { setMobileOpen(false); }}>GENDERS</NavLink>}
          {isAdmin && <NavLink to="/admin/categories" onClick={() => { setMobileOpen(false); }}>CATEGORIES</NavLink>}
          {isAdmin && <NavLink to="/admin/product-types" onClick={() => { setMobileOpen(false); }}>TYPES</NavLink>}
          {isAdmin && <NavLink to="/admin/orders" onClick={() => { setMobileOpen(false); }}>ORDERS</NavLink>}
          {isAdmin && <NavLink to="/admin/guest-orders" onClick={() => { setMobileOpen(false); }}>GUEST ORDERS</NavLink>}
          {isAdmin && <NavLink to="/admin/sale" onClick={() => { setMobileOpen(false); }}>SALE</NavLink>}
          {isAdmin && <NavLink to="/admin/coupons" onClick={() => { setMobileOpen(false); }}>COUPONS</NavLink>}
          {isAdmin && <NavLink to="/admin/super-coins" onClick={() => { setMobileOpen(false); }}>SUPER COINS</NavLink>}
          {isAdmin && <NavLink to="/admin/logo" onClick={() => { setMobileOpen(false); }}>LOGO</NavLink>}
          {isAdmin && <NavLink to="/admin/company-name" onClick={() => { setMobileOpen(false); }}>COMPANY</NavLink>}
          {isAdmin && <NavLink to="/admin/chatbot" onClick={() => { setMobileOpen(false); }}>CHATBOT</NavLink>}
          {isAdmin && <NavLink to="/admin/help" onClick={() => { setMobileOpen(false); }}>HELP</NavLink>}
        </div>
        {!mobileOpen && (
          <MegaMenu
            gender={activeMegaMenu || 'men'}
            open={Boolean(activeMegaMenu)}
            mobile={false}
            onClose={closeMenMegaMenu}
            onMouseEnter={() => setActiveMegaMenu(activeMegaMenu)}
            onMouseLeave={() => { setActiveMegaMenu(''); setMegaOpenedByHover(false); }}
          />
        )}

        <form className="fashion-search" onSubmit={submitSearch}>
          <Search size={18} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search for products, brands and more"
            aria-label="Search products"
          />
        </form>

        <div className="nav-actions fashion-actions">
          <div className="user-menu" onMouseEnter={() => user && setMenuOpen(true)} onMouseLeave={() => setMenuOpen(false)}>
            {!user ? (
              <NavLink className="nav-icon-link" to="/login">
                <User size={20} />
                <span>Profile</span>
              </NavLink>
            ) : (
              <>
                <button className="user-menu-trigger nav-icon-link" onClick={() => setMenuOpen((open) => !open)} type="button">
                  <span className="user-avatar">{user.name?.charAt(0)?.toUpperCase() || 'U'}</span>
                  <span>Profile</span>
                </button>
                {menuOpen && (
                  <div className="user-menu-panel fashion-user-panel">
                    <div className="user-panel-head">
                      <span className="user-avatar large">{user.name?.charAt(0)?.toUpperCase() || 'U'}</span>
                      <div>
                        <strong>{user.name}</strong>
                        <small>{user.email || 'Welcome back'}</small>
                      </div>
                    </div>
                    {!isAdmin && (
                      <Link className="super-coin-menu-balance" to="/super-coins" onClick={() => setMenuOpen(false)}>
                        <Coins size={16} />
                        <span>Super Coins</span>
                        <strong>{superCoinBalance ?? 0}</strong>
                      </Link>
                    )}
                    {accountLinks.map(([label, to]) => (
                      !isAdmin && <Link key={label} to={to} onClick={() => setMenuOpen(false)}>{label}</Link>
                    ))}
                    {isAdmin && <Link to="/admin/dashboard" onClick={() => setMenuOpen(false)}>Admin Dashboard</Link>}
                    {isAdmin && <Link to="/admin/genders" onClick={() => setMenuOpen(false)}>Gender Management</Link>}
                    {isAdmin && <Link to="/admin/categories" onClick={() => setMenuOpen(false)}>Category Management</Link>}
                    {isAdmin && <Link to="/admin/product-types" onClick={() => setMenuOpen(false)}>Product Type Management</Link>}
                    {isAdmin && <Link to="/admin/sale" onClick={() => setMenuOpen(false)}>Sale Manager</Link>}
                    {isAdmin && <Link to="/admin/coupons" onClick={() => setMenuOpen(false)}>Coupon Control</Link>}
                    {isAdmin && <Link to="/admin/super-coins" onClick={() => setMenuOpen(false)}>Super Coins</Link>}
                    {isAdmin && <Link to="/admin/replacement-settings" onClick={() => setMenuOpen(false)}>Replacement Settings</Link>}
                    {isAdmin && <Link to="/admin/logo" onClick={() => setMenuOpen(false)}>Logo Management</Link>}
                    {isAdmin && <Link to="/admin/company-name" onClick={() => setMenuOpen(false)}>Company Name Management</Link>}
                    {isAdmin && <Link to="/admin/chatbot" onClick={() => setMenuOpen(false)}>Chatbot Support</Link>}
                    <button onClick={signOut} type="button">Logout</button>
                  </div>
                )}
              </>
            )}
          </div>
          {!isAdmin && (
            <NavLink className="nav-icon-link" to="/wishlist">
              <Heart size={20} />
              <span>Wishlist</span>
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink className="nav-icon-link bag-link" to="/cart">
              <ShoppingBag size={20} />
              <span>Bag</span>
              {cartCount > 0 && <b>{cartCount}</b>}
            </NavLink>
          )}
          {showGuestTrackOrder && (
            <NavLink className="nav-icon-link" to="/guest-track-order">
              <PackageSearch size={20} />
              <span>Track Order</span>
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink className="nav-icon-link" to="/help-center">
              <Headset size={20} />
              <span>Help Center</span>
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}
