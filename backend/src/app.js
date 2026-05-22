const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const menRoutes = require('./routes/men');
const cartRoutes = require('./routes/cart');
const addressRoutes = require('./routes/addresses');
const orderRoutes = require('./routes/orders');
const wishlistRoutes = require('./routes/wishlist');
const deliveryRoutes = require('./routes/deliveryRoutes');
const hubRoutes = require('./routes/hubRoutes');
const couponRoutes = require('./routes/couponRoutes');
const userCouponRoutes = require('./routes/userCouponRoutes');
const accountCouponRoutes = require('./routes/accountCouponRoutes');
const walletRoutes = require('./routes/walletRoutes');
const cancellationRoutes = require('./routes/cancellationRoutes');
const postDeliveryRoutes = require('./routes/postDeliveryRoutes');
const monthlyTemplateRoutes = require('./routes/monthlyTemplate');
const logoRoutes = require('./routes/logo');
const { helpRouter, adminHelpRouter } = require('./routes/help');
const { router: paymentMethodRoutes } = require('./routes/paymentMethods');

const app = express();

const allowedOrigins = new Set([
  process.env.CLIENT_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/men', menRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/cancellations', cancellationRoutes);
app.use('/api/post-delivery', postDeliveryRoutes);
app.use('/api/monthly-template', monthlyTemplateRoutes);
app.use('/api', logoRoutes);
app.use('/api/help', helpRouter);
app.use('/api/coupons', userCouponRoutes);
app.use('/api/user', accountCouponRoutes);
app.use('/api/admin/help', adminHelpRouter);
app.use('/api/admin', hubRoutes);
app.use('/api/admin', couponRoutes);

app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((error, req, res, next) => {
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'Logo file size must be 2MB or less.' });
  }
  res.status(error.status || 500).json({ message: error.message || 'Server error.' });
});

module.exports = app;
