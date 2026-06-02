const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const adminRouter = express.Router();

const defaultBotReply = 'Our support team will reply shortly.';

async function tableColumns(table) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

function messageTerms(message) {
  const cleaned = String(message || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const terms = cleaned.split(/\s+/).filter((term) => term.length >= 3);
  return [...new Set([cleaned.trim(), ...terms].filter(Boolean))].slice(0, 8);
}

function scoreArticle(article, terms, searchableFields) {
  return terms.reduce((score, term) => {
    return score + searchableFields.reduce((fieldScore, field) => {
      const value = String(article[field] || '').toLowerCase();
      if (!value) return fieldScore;
      if (value === term) return fieldScore + 6;
      if (value.includes(term)) return fieldScore + (field === 'title' ? 5 : field === 'category_name' ? 4 : 2);
      return fieldScore;
    }, 0);
  }, 0);
}

async function findHelpArticleAnswer(message) {
  const terms = messageTerms(message);
  if (!terms.length) return null;

  const articleColumns = await tableColumns('help_articles');
  const categoryColumns = await tableColumns('help_categories');
  const optionalSearchColumns = ['question', 'answer', 'keywords'].filter((column) => articleColumns.has(column));
  const searchableArticleColumns = ['title', 'content', ...optionalSearchColumns].filter((column) => articleColumns.has(column));
  const answerColumn = articleColumns.has('answer') ? 'answer' : 'content';
  const selectOptional = optionalSearchColumns.map((column) => `ha.\`${column}\` AS \`${column}\``).join(', ');
  const categorySearchColumns = ['name', 'slug'].filter((column) => categoryColumns.has(column));

  const where = [];
  const params = [];
  if (articleColumns.has('is_active')) where.push('ha.is_active = TRUE');
  if (articleColumns.has('status')) where.push("LOWER(ha.status) IN ('active', 'published')");
  if (categoryColumns.has('is_active')) where.push('hc.is_active = TRUE');

  const likeParts = [];
  for (const term of terms) {
    const like = `%${term}%`;
    for (const column of searchableArticleColumns) {
      likeParts.push(`LOWER(ha.\`${column}\`) LIKE ?`);
      params.push(like);
    }
    for (const column of categorySearchColumns) {
      likeParts.push(`LOWER(hc.\`${column}\`) LIKE ?`);
      params.push(like);
    }
  }
  if (!likeParts.length) return null;
  where.push(`(${likeParts.join(' OR ')})`);

  const [articles] = await pool.execute(
    `SELECT ha.id,
            ha.title,
            ha.content,
            ha.\`${answerColumn}\` AS answer_text,
            hc.name AS category_name
            ${selectOptional ? `, ${selectOptional}` : ''}
     FROM help_articles ha
     JOIN help_categories hc ON hc.id = ha.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ha.is_popular DESC, ha.updated_at DESC, ha.id DESC
     LIMIT 12`,
    params
  );

  if (!articles.length) return null;
  const searchableFields = ['title', 'content', 'category_name', ...optionalSearchColumns];
  const best = articles
    .map((article) => ({ article, score: scoreArticle(article, terms, searchableFields) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score <= 0) return null;
  return String(best.article.answer_text || '').trim() || null;
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    message: row.message,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at
  };
}

async function ensureUserConversation(userId) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, status, created_at, updated_at
     FROM chatbot_conversations
     WHERE user_id = ? AND status = 'open'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [userId]
  );
  if (rows[0]) return rows[0];

  const [result] = await pool.execute(
    'INSERT INTO chatbot_conversations (user_id, status) VALUES (?, "open")',
    [userId]
  );
  const [created] = await pool.execute('SELECT * FROM chatbot_conversations WHERE id = ?', [result.insertId]);
  return created[0];
}

async function assertUserConversation(conversationId, userId) {
  const [rows] = await pool.execute(
    'SELECT id, user_id, status FROM chatbot_conversations WHERE id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return rows[0] || null;
}

router.use(authenticate);

router.post('/start', asyncHandler(async (req, res) => {
  const conversation = await ensureUserConversation(req.user.id);
  res.status(201).json({ conversation });
}));

router.get('/messages/:conversationId', asyncHandler(async (req, res) => {
  const conversation = await assertUserConversation(req.params.conversationId, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  await pool.execute(
    `UPDATE chatbot_messages
     SET is_read = TRUE
     WHERE conversation_id = ? AND sender_type IN ('admin', 'bot')`,
    [conversation.id]
  );
  const [rows] = await pool.execute(
    `SELECT id, conversation_id, sender_type, sender_id, message, is_read, created_at
     FROM chatbot_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC, id ASC`,
    [conversation.id]
  );
  res.json({ conversation, messages: rows.map(mapMessage) });
}));

router.post('/messages', asyncHandler(async (req, res) => {
  const conversationId = Number(req.body.conversationId || req.body.conversation_id);
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ message: 'Message is required.' });

  let conversation = conversationId
    ? await assertUserConversation(conversationId, req.user.id)
    : await ensureUserConversation(req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });
  if (conversation.status === 'closed') conversation = await ensureUserConversation(req.user.id);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO chatbot_messages (conversation_id, sender_type, sender_id, message, is_read)
       VALUES (?, 'user', ?, ?, FALSE)`,
      [conversation.id, req.user.id, message]
    );
    await connection.execute('UPDATE chatbot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversation.id]);

    const reply = await findHelpArticleAnswer(message) || defaultBotReply;
    await connection.execute(
      `INSERT INTO chatbot_messages (conversation_id, sender_type, sender_id, message, is_read)
       VALUES (?, 'bot', NULL, ?, FALSE)`,
      [conversation.id, reply]
    );
    await connection.execute('UPDATE chatbot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversation.id]);
    await connection.commit();

    const [rows] = await pool.execute(
      `SELECT id, conversation_id, sender_type, sender_id, message, is_read, created_at
       FROM chatbot_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`,
      [conversation.id]
    );
    res.status(201).json({ conversation, messages: rows.map(mapMessage) });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

adminRouter.use(authenticate, requireAdmin);

adminRouter.get('/conversations', asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT c.id,
            c.user_id,
            c.status,
            c.created_at,
            c.updated_at,
            u.name AS user_name,
            u.email AS user_email,
            lm.message AS last_message,
            lm.sender_type AS last_sender_type,
            lm.created_at AS last_message_at,
            SUM(CASE WHEN m.sender_type = 'user' AND m.is_read = FALSE THEN 1 ELSE 0 END) AS unread_count
     FROM chatbot_conversations c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN chatbot_messages lm ON lm.id = (
       SELECT id FROM chatbot_messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     )
     LEFT JOIN chatbot_messages m ON m.conversation_id = c.id
     GROUP BY c.id, c.user_id, c.status, c.created_at, c.updated_at, u.name, u.email, lm.message, lm.sender_type, lm.created_at
     ORDER BY c.updated_at DESC, c.id DESC`
  );
  res.json({
    conversations: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userName: row.user_name,
      userEmail: row.user_email,
      lastMessage: row.last_message,
      lastSenderType: row.last_sender_type,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count || 0)
    }))
  });
}));

adminRouter.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const [conversationRows] = await pool.execute(
    `SELECT c.*, u.name AS user_name, u.email AS user_email
     FROM chatbot_conversations c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = ?`,
    [req.params.id]
  );
  const conversation = conversationRows[0];
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  await pool.execute(
    `UPDATE chatbot_messages
     SET is_read = TRUE
     WHERE conversation_id = ? AND sender_type = 'user'`,
    [conversation.id]
  );
  const [rows] = await pool.execute(
    `SELECT id, conversation_id, sender_type, sender_id, message, is_read, created_at
     FROM chatbot_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC, id ASC`,
    [conversation.id]
  );
  res.json({ conversation, messages: rows.map(mapMessage) });
}));

adminRouter.post('/reply', asyncHandler(async (req, res) => {
  const conversationId = Number(req.body.conversationId || req.body.conversation_id);
  const message = String(req.body.message || '').trim();
  if (!conversationId || !message) return res.status(400).json({ message: 'Conversation and message are required.' });

  const [conversations] = await pool.execute('SELECT id, status FROM chatbot_conversations WHERE id = ?', [conversationId]);
  const conversation = conversations[0];
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });
  if (conversation.status === 'closed') return res.status(400).json({ message: 'Conversation is closed.' });

  await pool.execute(
    `INSERT INTO chatbot_messages (conversation_id, sender_type, sender_id, message, is_read)
     VALUES (?, 'admin', ?, ?, FALSE)`,
    [conversationId, req.user.id, message]
  );
  await pool.execute('UPDATE chatbot_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
  res.status(201).json({ message: 'Reply sent.' });
}));

adminRouter.put('/conversations/:id/close', asyncHandler(async (req, res) => {
  const [result] = await pool.execute(
    "UPDATE chatbot_conversations SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ message: 'Conversation not found.' });
  res.json({ message: 'Conversation closed.' });
}));

module.exports = { chatbotRouter: router, adminChatbotRouter: adminRouter };
