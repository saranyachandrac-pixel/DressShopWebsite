import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function homeForRole(role) {
  return role === 'ADMIN' ? '/admin/dashboard' : '/home';
}

export default function ProtectedRoute({ children, adminOnly = false, allowedRoles = null }) {
  const { token, user, authLoading } = useAuth();
  const location = useLocation();

  if (authLoading) return <main><p className="helper-text">Checking your session...</p></main>;

  if (!token || !user) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  const roles = allowedRoles || (adminOnly ? ['ADMIN'] : null);
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return children;
}

export function GuestOnlyRoute({ children, redirectTo = '/orders' }) {
  const { token, user, authLoading } = useAuth();

  if (authLoading) return <main><p className="helper-text">Checking your session...</p></main>;

  if (token && user) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
