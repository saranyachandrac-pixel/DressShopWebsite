const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const helpRouter = express.Router();
const adminHelpRouter = express.Router();
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'support');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename(req, file, callback) {
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '')}`);
    }
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!file.mimetype.startsWith('image/')) return callback(new Error('Only image uploads are allowed.'));
    callback(null, true);
  }
});

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapTicket(row) {
  const rawReplies = Array.isArray(row.replies)
    ? row.replies
    : (row.replies ? JSON.parse(row.replies) : []);
  const replies = rawReplies.filter(Boolean);
  return {
    ...row,
    replies,
    adminReplies: replies.filter((reply) => reply.sender_type === 'admin' || reply.is_admin)
  };
}

function ticketNumber(id) {
  return `TKT${String(id).padStart(6, '0')}`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function getTicketTypeFromOrder(order) {
  if (!order) return 'Order Issue';
  const paymentStatus = normalizeStatus(order.paymentStatus || order.payment_status || order.paid_status);
  const status = normalizeStatus(order.status || order.delivery_status);
  const deliveryStatus = normalizeStatus(order.deliveryStatus || order.delivery_status);
  const returnStatus = normalizeStatus(order.returnStatus || order.return_status || order.request_status);
  const cancelStatus = normalizeStatus(order.cancelStatus || order.cancel_status);

  if (['FAILED', 'PENDING'].includes(paymentStatus)) return 'Payment Issue';
  if (status === 'CANCELLED') return 'Cancellation Issue';
  if (['REQUESTED', 'APPROVED', 'PENDING'].includes(cancelStatus)) return 'Cancellation Issue';
  if (['REQUESTED', 'APPROVED'].includes(returnStatus)) return 'Return Issue';
  if (['DELAYED', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(deliveryStatus)) return 'Delivery Issue';
  if (status === 'DELIVERED' || deliveryStatus === 'DELIVERED') return 'Product Issue';
  return 'Order Issue';
}

helpRouter.get('/categories', asyncHandler(async (req, res) => {
  const [categories] = await pool.execute(
    `SELECT hc.*,
            COUNT(ha.id) AS article_count
     FROM help_categories hc
     LEFT JOIN help_articles ha ON ha.category_id = hc.id AND ha.is_active = TRUE
     WHERE hc.is_active = TRUE
     GROUP BY hc.id
     ORDER BY hc.sort_order, hc.name`
  );
  res.json({ categories });
}));

helpRouter.get('/articles', asyncHandler(async (req, res) => {
  const params = [];
  const where = ['ha.is_active = TRUE', 'hc.is_active = TRUE'];
  if (req.query.category) {
    where.push('hc.slug = ?');
    params.push(req.query.category);
  }
  if (req.query.search) {
    where.push('(ha.title LIKE ? OR ha.content LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.popular === 'true') {
    where.push('ha.is_popular = TRUE');
  }
  const [articles] = await pool.execute(
    `SELECT ha.id, ha.title, ha.slug, ha.content, ha.is_popular, ha.helpful_yes, ha.helpful_no, ha.created_at,
            hc.name AS category_name, hc.slug AS category_slug
     FROM help_articles ha
     JOIN help_categories hc ON hc.id = ha.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ha.is_popular DESC, ha.created_at DESC`,
    params
  );
  res.json({ articles });
}));

helpRouter.get('/articles/:slug', asyncHandler(async (req, res) => {
  const [[article]] = await pool.execute(
    `SELECT ha.*, hc.name AS category_name, hc.slug AS category_slug
     FROM help_articles ha
     JOIN help_categories hc ON hc.id = ha.category_id
     WHERE ha.slug = ? AND ha.is_active = TRUE`,
    [req.params.slug]
  );
  if (!article) return res.status(404).json({ message: 'Article not found.' });
  const [related] = await pool.execute(
    `SELECT id, title, slug
     FROM help_articles
     WHERE category_id = ? AND id <> ? AND is_active = TRUE
     ORDER BY is_popular DESC, created_at DESC
     LIMIT 4`,
    [article.category_id, article.id]
  );
  res.json({ article, related });
}));

helpRouter.post('/articles/:slug/helpful', asyncHandler(async (req, res) => {
  const column = req.body.helpful === false ? 'helpful_no' : 'helpful_yes';
  await pool.execute(`UPDATE help_articles SET ${column} = ${column} + 1 WHERE slug = ?`, [req.params.slug]);
  res.json({ message: 'Feedback saved.' });
}));

helpRouter.post('/tickets', authenticate, upload.single('image'), asyncHandler(async (req, res) => {
  let issueType = 'Order Issue';
  const message = String(req.body.message || '').trim();
  const rawOrderId = req.body.orderId;
  const orderId = rawOrderId === undefined || rawOrderId === null || rawOrderId === '' ? null : Number(rawOrderId);
  if (!message) return res.status(400).json({ message: 'Message is required.' });
  if (orderId !== null && (!Number.isInteger(orderId) || orderId < 1)) {
    return res.status(400).json({ message: 'Valid order is required.' });
  }
  if (orderId) {
    const [[order]] = await pool.execute(
      `SELECT o.*,
              o.delivery_status AS status,
              o.paid_status AS paymentStatus,
              o.delivery_status AS deliveryStatus,
              (
                SELECT pdr.request_status
                FROM post_delivery_requests pdr
                WHERE pdr.order_id = o.id
                ORDER BY pdr.updated_at DESC
                LIMIT 1
              ) AS returnStatus,
              (
                SELECT oc.refund_status
                FROM order_cancellations oc
                WHERE oc.order_id = o.id
                ORDER BY oc.cancelled_at DESC
                LIMIT 1
              ) AS cancelStatus
       FROM orders o
       WHERE o.id = ? AND o.user_id = ?`,
      [orderId, req.user.id]
    );
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    issueType = getTicketTypeFromOrder(order);
  }
  const subject = String(req.body.subject || issueType || 'Support request').trim();
  const imageUrl = req.file ? `${req.protocol}://${req.get('host')}/uploads/support/${req.file.filename}` : null;
  const [result] = await pool.execute(
    `INSERT INTO support_tickets (ticket_no, user_id, order_id, issue_type, ticket_type, subject, message, image_url, status)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    [req.user.id, orderId, issueType, issueType, subject, message, imageUrl]
  );
  const nextTicketNo = ticketNumber(result.insertId);
  await pool.execute('UPDATE support_tickets SET ticket_no = ? WHERE id = ?', [nextTicketNo, result.insertId]);
  res.status(201).json({ id: result.insertId, ticketNo: nextTicketNo, message: 'Ticket raised successfully.' });
}));

helpRouter.get('/my-tickets', authenticate, asyncHandler(async (req, res) => {
  const [tickets] = await pool.execute(
    `SELECT st.*,
            o.order_number,
            COALESCE(JSON_ARRAYAGG(
              IF(str.id IS NULL, NULL, JSON_OBJECT(
                'id', str.id,
                'message', str.message,
                'sender_type', str.sender_type,
                'sender_id', str.sender_id,
                'is_admin', str.is_admin,
                'created_at', str.created_at,
                'name', u.name
              ))
            ), JSON_ARRAY()) AS replies
     FROM support_tickets st
     LEFT JOIN orders o ON o.id = st.order_id
     LEFT JOIN support_ticket_replies str ON str.ticket_id = st.id
     LEFT JOIN users u ON u.id = COALESCE(str.sender_id, str.user_id)
     WHERE st.user_id = ?
     GROUP BY st.id
     ORDER BY st.created_at DESC`,
    [req.user.id]
  );
  res.json({ tickets: tickets.map(mapTicket) });
}));

helpRouter.get('/tickets/:id', authenticate, asyncHandler(async (req, res) => {
  const [[ticket]] = await pool.execute(
    `SELECT st.*, o.order_number,
            COALESCE(JSON_ARRAYAGG(
              IF(str.id IS NULL, NULL, JSON_OBJECT(
                'id', str.id,
                'message', str.message,
                'sender_type', str.sender_type,
                'sender_id', str.sender_id,
                'is_admin', str.is_admin,
                'created_at', str.created_at,
                'name', u.name
              ))
            ), JSON_ARRAY()) AS replies
     FROM support_tickets st
     LEFT JOIN orders o ON o.id = st.order_id
     LEFT JOIN support_ticket_replies str ON str.ticket_id = st.id
     LEFT JOIN users u ON u.id = COALESCE(str.sender_id, str.user_id)
     WHERE st.id = ? AND st.user_id = ?
     GROUP BY st.id`,
    [req.params.id, req.user.id]
  );
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
  res.json({ ticket: mapTicket(ticket) });
}));

helpRouter.post('/tickets/:id/reply', authenticate, asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ message: 'Reply message is required.' });
  const [[ticket]] = await pool.execute('SELECT id FROM support_tickets WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
  await pool.execute(
    `INSERT INTO support_ticket_replies (ticket_id, sender_type, sender_id, user_id, message, is_admin)
     VALUES (?, 'user', ?, ?, ?, FALSE)`,
    [req.params.id, req.user.id, req.user.id, message]
  );
  await pool.execute("UPDATE support_tickets SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'ANSWERED'", [req.params.id]);
  res.status(201).json({ message: 'Reply sent.' });
}));

adminHelpRouter.use(authenticate, requireAdmin);

adminHelpRouter.get('/articles', asyncHandler(async (req, res) => {
  const [articles] = await pool.execute(
    `SELECT ha.*, hc.name AS category_name
     FROM help_articles ha
     JOIN help_categories hc ON hc.id = ha.category_id
     ORDER BY ha.created_at DESC`
  );
  res.json({ articles });
}));

adminHelpRouter.post('/articles', asyncHandler(async (req, res) => {
  const { categoryId, title, content, isPopular = false, isActive = true } = req.body;
  if (!categoryId || !title || !content) return res.status(400).json({ message: 'Category, title and content are required.' });
  const slug = slugify(req.body.slug || title);
  const [result] = await pool.execute(
    `INSERT INTO help_articles (category_id, title, slug, content, is_popular, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [categoryId, title, slug, content, Boolean(isPopular), Boolean(isActive)]
  );
  res.status(201).json({ id: result.insertId, slug, message: 'Article created.' });
}));

adminHelpRouter.put('/articles/:id', asyncHandler(async (req, res) => {
  const { categoryId, title, content, isPopular = false, isActive = true } = req.body;
  if (!categoryId || !title || !content) return res.status(400).json({ message: 'Category, title and content are required.' });
  const slug = slugify(req.body.slug || title);
  await pool.execute(
    `UPDATE help_articles
     SET category_id = ?, title = ?, slug = ?, content = ?, is_popular = ?, is_active = ?
     WHERE id = ?`,
    [categoryId, title, slug, content, Boolean(isPopular), Boolean(isActive), req.params.id]
  );
  res.json({ message: 'Article updated.' });
}));

adminHelpRouter.delete('/articles/:id', asyncHandler(async (req, res) => {
  await pool.execute('DELETE FROM help_articles WHERE id = ?', [req.params.id]);
  res.json({ message: 'Article deleted.' });
}));

adminHelpRouter.get('/tickets', asyncHandler(async (req, res) => {
  const [tickets] = await pool.execute(
    `SELECT st.*, u.name AS customer_name, u.email AS customer_email, o.order_number,
            COALESCE(JSON_ARRAYAGG(
              IF(str.id IS NULL, NULL, JSON_OBJECT(
                'id', str.id,
                'message', str.message,
                'sender_type', str.sender_type,
                'sender_id', str.sender_id,
                'is_admin', str.is_admin,
                'created_at', str.created_at,
                'name', ru.name
              ))
            ), JSON_ARRAY()) AS replies
     FROM support_tickets st
     JOIN users u ON u.id = st.user_id
     LEFT JOIN orders o ON o.id = st.order_id
     LEFT JOIN support_ticket_replies str ON str.ticket_id = st.id
     LEFT JOIN users ru ON ru.id = COALESCE(str.sender_id, str.user_id)
     GROUP BY st.id
     ORDER BY st.created_at DESC`
  );
  res.json({ tickets: tickets.map(mapTicket) });
}));

adminHelpRouter.post('/tickets/:id/reply', asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ message: 'Reply message is required.' });
  await pool.execute(
    `INSERT INTO support_ticket_replies (ticket_id, sender_type, sender_id, user_id, message, is_admin)
     VALUES (?, 'admin', ?, ?, ?, TRUE)`,
    [req.params.id, req.user.id, req.user.id, message]
  );
  await pool.execute("UPDATE support_tickets SET status = 'ANSWERED' WHERE id = ?", [req.params.id]);
  res.status(201).json({ message: 'Reply sent.' });
}));

adminHelpRouter.put('/tickets/:id/status', asyncHandler(async (req, res) => {
  const status = String(req.body.status || '').toUpperCase();
  if (!['OPEN', 'ANSWERED', 'IN_PROGRESS', 'RESOLVED'].includes(status)) return res.status(400).json({ message: 'Invalid ticket status.' });
  await pool.execute('UPDATE support_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ message: 'Ticket status updated.' });
}));

module.exports = { helpRouter, adminHelpRouter };
