import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Footer() {
  const { isAdmin } = useAuth();

  return (
    <footer className="app-footer">
      <div>
        <strong>DressShop</strong>
        <span>Fashion delivered with secure order updates.</span>
      </div>
      {!isAdmin && (
        <nav>
          <Link to="/guest-track-order">Track Order</Link>
          <Link to="/help-center">Help Center</Link>
          <Link to="/products">Shop</Link>
        </nav>
      )}
    </footer>
  );
}
