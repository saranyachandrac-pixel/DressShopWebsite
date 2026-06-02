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
const guestRoutes = require('./routes/guest');
const guestOrderRoutes = require('./routes/guestOrders');
const adminGuestOrderRoutes = require('./routes/adminGuestOrders');
const wishlistRoutes = require('./routes/wishlist');
const deliveryRoutes = require('./routes/deliveryRoutes');
const hubRoutes = require('./routes/hubRoutes');
const couponRoutes = require('./routes/couponRoutes');
const userCouponRoutes = require('./routes/userCouponRoutes');
const accountCouponRoutes = require('./routes/accountCouponRoutes');
const walletRoutes = require('./routes/walletRoutes');
const replacementRoutes = require('./routes/replacementRoutes');
const cancellationRoutes = require('./routes/cancellationRoutes');
const adminCancellationRoutes = require('./routes/adminCancellations');
const postDeliveryRoutes = require('./routes/postDeliveryRoutes');
const monthlyTemplateRoutes = require('./routes/monthlyTemplate');
const logoRoutes = require('./routes/logo');
const companySettingsRoutes = require('./routes/companySettings');
const { router: taxonomyRoutes, adminRouter: adminTaxonomyRoutes } = require('./routes/taxonomy');
const { chatbotRouter, adminChatbotRouter } = require('./routes/chatbot');
const { helpRouter, adminHelpRouter } = require('./routes/help');
const { router: superCoinRoutes, adminRouter: adminSuperCoinRoutes } = require('./routes/superCoinRoutes');
const { router: paymentMethodRoutes } = require('./routes/paymentMethods');
const { authenticate, requireAdmin } = require('./middleware/auth');
const { listHubStockProducts } = require('./controllers/hubController');
const asyncHandler = require('./utils/asyncHandler');
const pool = require('./config/db');

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

app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/admin/gender')) {
    console.log(`[route-debug] ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/help-center', asyncHandler(async (req, res) => {
  const [articleColumns] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'help_articles'`
  );
  const articleColumnSet = new Set(articleColumns.map((row) => row.COLUMN_NAME));
  const hasArticleCategory = articleColumnSet.has('category');
  const hasQuestion = articleColumnSet.has('question');
  const hasAnswer = articleColumnSet.has('answer');
  const hasStatus = articleColumnSet.has('status');
  const hasIsActive = articleColumnSet.has('is_active');
  const hasCategoryId = articleColumnSet.has('category_id');

  const topicExpr = hasArticleCategory
    ? "COALESCE(NULLIF(ha.category, ''), 'General')"
    : hasCategoryId
      ? "COALESCE(NULLIF(hc.name, ''), 'General')"
      : "'General'";
  const questionExpr = hasQuestion ? 'ha.question' : 'ha.title';
  const answerExpr = hasAnswer ? 'ha.answer' : 'ha.content';
  const joins = hasCategoryId ? 'LEFT JOIN help_categories hc ON hc.id = ha.category_id' : '';
  const where = [];
  if (hasStatus) where.push("LOWER(COALESCE(ha.status, 'active')) = 'active'");
  else if (hasIsActive) where.push('ha.is_active = TRUE');
  if (!hasArticleCategory && hasCategoryId) where.push('(hc.id IS NULL OR COALESCE(hc.is_active, TRUE) = TRUE)');

  const [rows] = await pool.execute(
    `SELECT ha.id,
            ${topicExpr} AS topic,
            ${questionExpr} AS question,
            ${answerExpr} AS answer
     FROM help_articles ha
     ${joins}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY topic, ha.id`
  );

  const topics = [];
  const byTopic = new Map();
  for (const row of rows) {
    const topicName = row.topic || 'General';
    if (!byTopic.has(topicName)) {
      const topic = { topic: topicName, issues: [] };
      byTopic.set(topicName, topic);
      topics.push(topic);
    }
    byTopic.get(topicName).issues.push({
      id: row.id,
      question: row.question,
      answer: row.answer
    });
  }
  res.json(topics);
}));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminTaxonomyRoutes);
app.use('/api', taxonomyRoutes);
app.use('/api/men', menRoutes);
app.use('/api/women', menRoutes);
app.use('/api/kids', menRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/guest-orders', guestOrderRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/super-coins', superCoinRoutes);
app.use('/api/cancellations', cancellationRoutes);
app.use('/api/post-delivery', postDeliveryRoutes);
app.use('/api/monthly-template', monthlyTemplateRoutes);
app.use('/api', logoRoutes);
app.use('/api', companySettingsRoutes);
app.use('/api/chatbot', chatbotRouter);
app.use('/api/help', helpRouter);
app.use('/api/coupons', userCouponRoutes);
app.use('/api/user', accountCouponRoutes);
app.use('/api/admin/help', adminHelpRouter);
app.use('/api/admin/chatbot', adminChatbotRouter);
app.use('/api/admin/super-coins', adminSuperCoinRoutes);
// adminTaxonomyRoutes already mounted above
app.use('/api/admin', replacementRoutes);
app.use('/api/admin', hubRoutes);
app.use('/api/admin', couponRoutes);
app.use('/api/admin/products', productRoutes);
app.use('/api/admin/guest-orders', adminGuestOrderRoutes);
app.use('/api/admin/cancellations', adminCancellationRoutes);
app.get('/api/hub-stock/products', authenticate, requireAdmin, asyncHandler(listHubStockProducts));

app.use((req, res) => {
  console.warn(`[route-debug] 404 ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'Route not found.', method: req.method, path: req.originalUrl });
});
app.use((error, req, res, next) => {
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'Logo file size must be 2MB or less.' });
  }
  res.status(error.status || 500).json({ message: error.message || 'Server error.' });
});

module.exports = app;
