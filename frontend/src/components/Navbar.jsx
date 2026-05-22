import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Headset, Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import MenMegaMenu from './MenMegaMenu';
import api from '../services/api';

export default function Navbar() {
  const { user, isAdmin, logout, cartCount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menMenuOpen, setMenMenuOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [siteLogo, setSiteLogo] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadSiteLogo();
    window.addEventListener('site-logo-updated', loadSiteLogo);
    return () => window.removeEventListener('site-logo-updated', loadSiteLogo);
  }, []);

  async function loadSiteLogo() {
    try {
      const { data } = await api.get('/logo');
      setSiteLogo(data.logo || null);
    } catch (error) {
      setSiteLogo(null);
    }
  }

  function signOut() {
    logout();
    setMenuOpen(false);
    setMobileOpen(false);
    setMenMenuOpen(false);
    navigate('/login');
  }

  function submitSearch(event) {
    event.preventDefault();
    const search = searchText.trim();
    navigate(search ? `/?search=${encodeURIComponent(search)}` : '/');
    setMobileOpen(false);
    setMenMenuOpen(false);
  }

  const menuItems = ['MEN', 'WOMEN', 'KIDS', 'HOME', 'BEAUTY', 'GENZ', 'STUDIO'];
  const accountLinks = [
    ['My Profile', '/profile'],
    ['My Orders', '/orders'],
    ['Monthly Purchase Template', '/monthly-template'],
    ['Review & Rating', '/reviews'],
    ['Saved UPI IDs', '/saved-payments?tab=upi'],
    ['Saved Cards', '/saved-payments?tab=cards'],
    ['Payment Methods', '/saved-payments'],
    ['Coupons', '/account/coupons'],
    ['My Wallet', '/wallet'],
    ['Address Book', '/addresses'],
    ['My Tickets', '/help/my-tickets']
  ];

  return (
    <nav className={isAdmin ? 'app-nav fashion-nav admin-nav sticky-top' : 'app-nav fashion-nav sticky-top'} onMouseLeave={() => setMenMenuOpen(false)}>
      <div className="fashion-nav-inner">
        <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen((open) => !open)} aria-label="Toggle menu">
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Link className="brand-mark fashion-logo" to="/" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>
          {siteLogo?.logoUrl ? (
            <img className="site-logo-image" src={siteLogo.logoUrl} alt="DressShop" />
          ) : (
            <>
              <span>DS</span>
              <strong>DressShop</strong>
            </>
          )}
        </Link>

        <div className={mobileOpen ? 'fashion-menu open' : 'fashion-menu'}>
          {menuItems.map((item) => (
            item === 'MEN' ? (
              <button
                className={menMenuOpen ? 'fashion-menu-link active' : 'fashion-menu-link'}
                key={item}
                type="button"
                onMouseEnter={() => !mobileOpen && setMenMenuOpen(true)}
                onClick={() => setMenMenuOpen((open) => !open)}
              >
                MEN
              </button>
            ) : (
              <NavLink key={item} to="/" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>
                {item}
                {item === 'STUDIO' && <span className="new-badge">NEW</span>}
              </NavLink>
            )
          ))}
          {isAdmin && <NavLink to="/admin" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>ADMIN</NavLink>}
          {isAdmin && <NavLink to="/admin/sale" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>SALE</NavLink>}
          {isAdmin && <NavLink to="/admin/coupons" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>COUPONS</NavLink>}
          {isAdmin && <NavLink to="/admin/logo" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>LOGO</NavLink>}
          {isAdmin && <NavLink to="/admin/help" onClick={() => { setMobileOpen(false); setMenMenuOpen(false); }}>HELP</NavLink>}
        </div>

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
                    {accountLinks.map(([label, to]) => (
                      !isAdmin && <Link key={label} to={to} onClick={() => setMenuOpen(false)}>{label}</Link>
                    ))}
                    {isAdmin && <Link to="/admin" onClick={() => setMenuOpen(false)}>Admin Dashboard</Link>}
                    {isAdmin && <Link to="/admin/sale" onClick={() => setMenuOpen(false)}>Sale Manager</Link>}
                    {isAdmin && <Link to="/admin/coupons" onClick={() => setMenuOpen(false)}>Coupon Control</Link>}
                    {isAdmin && <Link to="/admin/logo" onClick={() => setMenuOpen(false)}>Logo Management</Link>}
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
            <NavLink className="nav-icon-link bag-link" to={user ? '/cart' : '/login'}>
              <ShoppingBag size={20} />
              <span>Bag</span>
              {cartCount > 0 && <b>{cartCount}</b>}
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
      <MenMegaMenu
        open={menMenuOpen}
        mobile={mobileOpen}
        onClose={() => {
          setMenMenuOpen(false);
          setMobileOpen(false);
        }}
        onMouseEnter={() => setMenMenuOpen(true)}
        onMouseLeave={() => setMenMenuOpen(false)}
      />
    </nav>
  );
}
