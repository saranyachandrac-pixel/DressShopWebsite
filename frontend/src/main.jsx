import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Products from './pages/Products';
import MenCategoryPage from './pages/MenCategoryPage';
import Login from './pages/Login';
import Register from './pages/Register';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Admin from './pages/Admin';
import AdminSalePage from './pages/AdminSalePage';
import HubManagement from './pages/admin/HubManagement';
import AdminCoupons from './pages/admin/AdminCoupons';
import ProductDetail from './pages/ProductDetail';
import Profile from './pages/Profile';
import SavedPayments from './pages/SavedPayments';
import Reviews from './pages/Reviews';
import Wishlist from './pages/Wishlist';
import AddressBook from './pages/AddressBook';
import Coupons from './pages/Coupons';
import AccountCoupons from './pages/AccountCoupons';
import BuyNowCheckout from './pages/BuyNowCheckout';
import WalletDashboard from './pages/WalletDashboard';
import AddMoney from './pages/AddMoney';
import SendMoney from './pages/SendMoney';
import WalletHistory from './pages/WalletHistory';
import HelpCenterHome from './pages/HelpCenterHome';
import HelpCategoryPage from './pages/HelpCategoryPage';
import HelpArticlePage from './pages/HelpArticlePage';
import RaiseTicket from './pages/RaiseTicket';
import MyTickets from './pages/MyTickets';
import AdminHelpCenter from './pages/AdminHelpCenter';
import AdminTickets from './pages/AdminTickets';
import MonthlyPurchaseTemplate from './pages/MonthlyPurchaseTemplate';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Products />} />
          <Route path="/men/category/:slug" element={<MenCategoryPage />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/cart" element={<ProtectedRoute><Cart /></ProtectedRoute>} />
          <Route path="/checkout/cart" element={<ProtectedRoute><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/checkout/buy-now" element={<ProtectedRoute><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/checkout/buy/:productId" element={<ProtectedRoute><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/monthly-template" element={<ProtectedRoute><MonthlyPurchaseTemplate /></ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute><WalletDashboard /></ProtectedRoute>} />
          <Route path="/wallet/add-money" element={<ProtectedRoute><AddMoney /></ProtectedRoute>} />
          <Route path="/wallet/send-money" element={<ProtectedRoute><SendMoney /></ProtectedRoute>} />
          <Route path="/wallet/history" element={<ProtectedRoute><WalletHistory /></ProtectedRoute>} />
          <Route path="/help-center" element={<HelpCenterHome />} />
          <Route path="/help" element={<HelpCenterHome />} />
          <Route path="/help/category/:slug" element={<HelpCategoryPage />} />
          <Route path="/help/articles/:slug" element={<HelpArticlePage />} />
          <Route path="/help/raise-ticket" element={<ProtectedRoute><RaiseTicket /></ProtectedRoute>} />
          <Route path="/help/my-tickets" element={<ProtectedRoute><MyTickets /></ProtectedRoute>} />
          <Route path="/saved-payments" element={<ProtectedRoute><SavedPayments /></ProtectedRoute>} />
          <Route path="/reviews" element={<ProtectedRoute><Reviews /></ProtectedRoute>} />
          <Route path="/addresses" element={<ProtectedRoute><AddressBook /></ProtectedRoute>} />
          <Route path="/coupons" element={<ProtectedRoute><Coupons /></ProtectedRoute>} />
          <Route path="/account/coupons" element={<ProtectedRoute><AccountCoupons /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
          <Route path="/admin/sale" element={<ProtectedRoute adminOnly><AdminSalePage /></ProtectedRoute>} />
          <Route path="/admin/hubs" element={<ProtectedRoute adminOnly><HubManagement /></ProtectedRoute>} />
          <Route path="/admin/coupons" element={<ProtectedRoute adminOnly><AdminCoupons /></ProtectedRoute>} />
          <Route path="/admin/help" element={<ProtectedRoute adminOnly><AdminHelpCenter /></ProtectedRoute>} />
          <Route path="/admin/help/tickets" element={<ProtectedRoute adminOnly><AdminTickets /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
