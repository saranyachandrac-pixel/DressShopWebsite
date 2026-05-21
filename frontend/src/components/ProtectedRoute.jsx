import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}
