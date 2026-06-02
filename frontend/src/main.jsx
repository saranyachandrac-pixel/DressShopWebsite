import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ChatBot from './components/ChatBot';
import ProtectedRoute, { GuestOnlyRoute } from './components/ProtectedRoute';
import Products from './pages/Products';
import MenProducts from './pages/MenProducts';
import MenCategoryPage from './pages/MenCategoryPage';
import Login from './pages/Login';
import Register from './pages/Register';
import Cart from './pages/Cart';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Admin from './pages/Admin';
import AdminOrders from './pages/AdminOrders';
import AdminGuestOrders from './pages/AdminGuestOrders';
import AdminSalePage from './pages/AdminSalePage';
import HubManagement from './pages/admin/HubManagement';
import AdminCoupons from './pages/admin/AdminCoupons';
import LogoManagement from './pages/admin/LogoManagement';
import CompanyNameManagement from './pages/admin/CompanyNameManagement';
import AdminChatbotSupport from './pages/admin/AdminChatbotSupport';
import ProductDetail from './pages/ProductDetail';
import Profile from './pages/Profile';
import SavedPayments from './pages/SavedPayments';
import Reviews from './pages/Reviews';
import Wishlist from './pages/Wishlist';
import AddressBook from './pages/AddressBook';
import Coupons from './pages/Coupons';
import AccountCoupons from './pages/AccountCoupons';
import BuyNowCheckout from './pages/BuyNowCheckout';
import GuestCheckout from './pages/GuestCheckout';
import GuestTrackOrder from './pages/GuestTrackOrder';
import WalletDashboard from './pages/WalletDashboard';
import AddMoney from './pages/AddMoney';
import SendMoney from './pages/SendMoney';
import WalletHistory from './pages/WalletHistory';
import SuperCoinWallet from './pages/SuperCoinWallet';
import HelpCenter from './pages/HelpCenter';
import HelpCategoryPage from './pages/HelpCategoryPage';
import HelpArticlePage from './pages/HelpArticlePage';
import RaiseTicket from './pages/RaiseTicket';
import MyTickets from './pages/MyTickets';
import AdminHelpCenter from './pages/AdminHelpCenter';
import AdminTickets from './pages/AdminTickets';
import MonthlyPurchaseTemplate from './pages/MonthlyPurchaseTemplate';
import SuperCoinAdmin from './pages/admin/SuperCoinAdmin';
import AdminReplacementSettings from './pages/admin/AdminReplacementSettings';
import TaxonomyManagement from './pages/admin/TaxonomyManagement';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Navbar />
        <ChatBot />
        <Routes>
          <Route path="/" element={<Products />} />
          <Route path="/home" element={<Products />} />
          <Route path="/men" element={<MenProducts />} />
          <Route path="/women" element={<MenProducts />} />
          <Route path="/kids" element={<MenProducts />} />
          <Route path="/men/category/:slug" element={<MenCategoryPage />} />
          <Route path="/women/category/:slug" element={<MenCategoryPage />} />
          <Route path="/kids/category/:slug" element={<MenCategoryPage />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/guest-checkout" element={<GuestCheckout />} />
          <Route path="/guest-track-order" element={<GuestOnlyRoute><GuestTrackOrder /></GuestOnlyRoute>} />
          <Route path="/track-order" element={<GuestOnlyRoute><GuestTrackOrder /></GuestOnlyRoute>} />
          <Route path="/checkout/cart" element={<ProtectedRoute allowedRoles={['USER']}><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/checkout/buy-now" element={<ProtectedRoute allowedRoles={['USER']}><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/checkout/buy/:productId" element={<ProtectedRoute allowedRoles={['USER']}><BuyNowCheckout /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute allowedRoles={['USER', 'ADMIN']}><Orders /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute allowedRoles={['USER', 'ADMIN']}><OrderDetail /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute allowedRoles={['USER', 'ADMIN']}><Profile /></ProtectedRoute>} />
          <Route path="/monthly-template" element={<ProtectedRoute allowedRoles={['USER']}><MonthlyPurchaseTemplate /></ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute allowedRoles={['USER']}><Wishlist /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute allowedRoles={['USER']}><WalletDashboard /></ProtectedRoute>} />
          <Route path="/wallet/add-money" element={<ProtectedRoute allowedRoles={['USER']}><AddMoney /></ProtectedRoute>} />
          <Route path="/wallet/send-money" element={<ProtectedRoute allowedRoles={['USER']}><SendMoney /></ProtectedRoute>} />
          <Route path="/wallet/history" element={<ProtectedRoute allowedRoles={['USER']}><WalletHistory /></ProtectedRoute>} />
          <Route path="/super-coins" element={<ProtectedRoute allowedRoles={['USER']}><SuperCoinWallet /></ProtectedRoute>} />
          <Route path="/help-center" element={<HelpCenter />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/help/category/:slug" element={<HelpCategoryPage />} />
          <Route path="/help/articles/:slug" element={<HelpArticlePage />} />
          <Route path="/help/raise-ticket" element={<ProtectedRoute allowedRoles={['USER']}><RaiseTicket /></ProtectedRoute>} />
          <Route path="/help/my-tickets" element={<ProtectedRoute allowedRoles={['USER']}><MyTickets /></ProtectedRoute>} />
          <Route path="/saved-payments" element={<ProtectedRoute allowedRoles={['USER']}><SavedPayments /></ProtectedRoute>} />
          <Route path="/reviews" element={<ProtectedRoute allowedRoles={['USER']}><Reviews /></ProtectedRoute>} />
          <Route path="/addresses" element={<ProtectedRoute allowedRoles={['USER']}><AddressBook /></ProtectedRoute>} />
          <Route path="/coupons" element={<ProtectedRoute allowedRoles={['USER']}><Coupons /></ProtectedRoute>} />
          <Route path="/account/coupons" element={<ProtectedRoute allowedRoles={['USER']}><AccountCoupons /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['ADMIN']}><Navigate to="/admin/products" replace /></ProtectedRoute>} />
          <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={['ADMIN']}><Navigate to="/admin/products" replace /></ProtectedRoute>} />
          <Route path="/admin/products" element={<ProtectedRoute allowedRoles={['ADMIN']}><Admin /></ProtectedRoute>} />
          <Route path="/admin/genders" element={<ProtectedRoute allowedRoles={['ADMIN']}><TaxonomyManagement mode="genders" /></ProtectedRoute>} />
          <Route path="/admin/categories" element={<ProtectedRoute allowedRoles={['ADMIN']}><TaxonomyManagement mode="categories" /></ProtectedRoute>} />
          <Route path="/admin/product-types" element={<ProtectedRoute allowedRoles={['ADMIN']}><TaxonomyManagement mode="productTypes" /></ProtectedRoute>} />
          <Route path="/admin/orders" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminOrders /></ProtectedRoute>} />
          <Route path="/admin/orders/cancelled" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminOrders /></ProtectedRoute>} />
          <Route path="/admin/orders/returns" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminOrders /></ProtectedRoute>} />
          <Route path="/admin/orders/reviews" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminOrders /></ProtectedRoute>} />
          <Route path="/admin/guest-orders" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminGuestOrders /></ProtectedRoute>} />
          <Route path="/admin/guest-orders/:id" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminGuestOrders /></ProtectedRoute>} />
          <Route path="/admin/sale" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminSalePage /></ProtectedRoute>} />
          <Route path="/admin/hubs" element={<ProtectedRoute allowedRoles={['ADMIN']}><HubManagement /></ProtectedRoute>} />
          <Route path="/admin/coupons" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminCoupons /></ProtectedRoute>} />
          <Route path="/admin/logo" element={<ProtectedRoute allowedRoles={['ADMIN']}><LogoManagement /></ProtectedRoute>} />
          <Route path="/admin/company-name" element={<ProtectedRoute allowedRoles={['ADMIN']}><CompanyNameManagement /></ProtectedRoute>} />
          <Route path="/admin/chatbot" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminChatbotSupport /></ProtectedRoute>} />
          <Route path="/admin/super-coins" element={<ProtectedRoute allowedRoles={['ADMIN']}><SuperCoinAdmin /></ProtectedRoute>} />
          <Route path="/admin/replacement-settings" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminReplacementSettings /></ProtectedRoute>} />
          <Route path="/admin/help" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminHelpCenter /></ProtectedRoute>} />
          <Route path="/admin/help/tickets" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminTickets /></ProtectedRoute>} />
        </Routes>
        <Footer />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
