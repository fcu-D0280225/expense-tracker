'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { handleLineWebhook } = require('./line');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Schema ────────────────────────────────────────────────────────────────────

async function initSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS categories (
      id   INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      icon VARCHAR(20)
    )`,
    `CREATE TABLE IF NOT EXISTS subcategories (
      id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      name        VARCHAR(255) NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE KEY uq_cat_name (category_id, name)
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      type            ENUM('asset','expense','revenue','liabilities') NOT NULL,
      icon            VARCHAR(20) DEFAULT '💰',
      currency        VARCHAR(10) DEFAULT 'TWD',
      initial_balance DOUBLE DEFAULT 0,
      created_at      DATETIME DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      description       TEXT,
      date              VARCHAR(10) NOT NULL,
      amount            DOUBLE NOT NULL,
      source_account_id INT NOT NULL,
      dest_account_id   INT NOT NULL,
      category_id       INT,
      subcategory_id    INT,
      note              TEXT,
      tags              TEXT,
      created_at        DATETIME DEFAULT NOW(),
      FOREIGN KEY (source_account_id) REFERENCES accounts(id),
      FOREIGN KEY (dest_account_id)   REFERENCES accounts(id),
      FOREIGN KEY (category_id)       REFERENCES categories(id)
    )`,
    `CREATE TABLE IF NOT EXISTS budgets (
      id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      category_id INT,
      amount      DOUBLE NOT NULL,
      month       VARCHAR(7) NOT NULL,
      created_at  DATETIME DEFAULT NOW(),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE KEY uq_budget (category_id, month)
    )`,
    `CREATE TABLE IF NOT EXISTS trips (
      id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      destination VARCHAR(255),
      start_date  VARCHAR(10),
      end_date    VARCHAR(10),
      budget      DOUBLE DEFAULT 0,
      currency    VARCHAR(10) DEFAULT 'TWD',
      created_by  VARCHAR(255),
      created_at  DATETIME DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS trip_members (
      id        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      trip_id   INT NOT NULL,
      name      VARCHAR(255) NOT NULL,
      email     VARCHAR(255),
      join_code VARCHAR(10) UNIQUE NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS trip_expenses (
      id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      trip_id       INT NOT NULL,
      paid_by       INT NOT NULL,
      amount        DOUBLE NOT NULL,
      currency      VARCHAR(10) DEFAULT 'TWD',
      exchange_rate DOUBLE DEFAULT 1,
      category_id   INT,
      description   TEXT,
      date          VARCHAR(10) NOT NULL,
      split_type    ENUM('equal','custom','paid_by_one') NOT NULL DEFAULT 'equal',
      splits        TEXT,
      created_at    DATETIME DEFAULT NOW(),
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by) REFERENCES trip_members(id)
    )`,
    `CREATE TABLE IF NOT EXISTS trip_member_claims (
      id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      member_id    INT NOT NULL,
      trip_id      INT NOT NULL,
      device_token VARCHAR(64) NOT NULL,
      claimed_at   DATETIME DEFAULT NOW(),
      UNIQUE KEY uq_device_trip (device_token, trip_id),
      FOREIGN KEY (member_id) REFERENCES trip_members(id) ON DELETE CASCADE,
      FOREIGN KEY (trip_id)   REFERENCES trips(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS recurring (
      id                INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title             VARCHAR(255) NOT NULL,
      amount            DOUBLE NOT NULL,
      source_account_id INT NOT NULL,
      dest_account_id   INT NOT NULL,
      category_id       INT,
      repeat_freq       ENUM('daily','weekly','monthly','yearly') NOT NULL,
      next_date         VARCHAR(10) NOT NULL,
      active            TINYINT DEFAULT 1,
      created_at        DATETIME DEFAULT NOW(),
      FOREIGN KEY (source_account_id) REFERENCES accounts(id),
      FOREIGN KEY (dest_account_id)   REFERENCES accounts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      google_sub VARCHAR(64) UNIQUE,
      email      VARCHAR(255),
      name       VARCHAR(255) NOT NULL,
      picture    VARCHAR(512),
      created_at DATETIME DEFAULT NOW()
    )`,
  ];
  for (const sql of stmts) await db.run(sql);

  // Idempotent column additions for existing DBs
  await addColumnIfMissing('trip_members', 'user_id', 'INT NULL');
  await addColumnIfMissing('trips', 'share_token', 'VARCHAR(32) NULL UNIQUE');
}

async function addColumnIfMissing(table, column, definition) {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].n === 0) {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// ── Seed data ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: '飲食', icon: '🍜', subs: ['早餐', '午餐', '晚餐', '飲料'] },
  { name: '交通', icon: '🚌', subs: ['大眾運輸', '計程車'] },
  { name: '購物', icon: '🛒', subs: ['日用品', '服飾', '3C'] },
  { name: '娛樂', icon: '🎮', subs: ['電影', '遊戲'] },
  { name: '醫療', icon: '🏥', subs: ['診所', '藥品'] },
  { name: '其他', icon: '📦', subs: [] },
];

const DEFAULT_ACCOUNTS = [
  { name: '現金',   type: 'asset',       icon: '💵' },
  { name: '銀行帳戶', type: 'asset',     icon: '🏦' },
  { name: '信用卡', type: 'liabilities', icon: '💳' },
  { name: '薪資',   type: 'revenue',     icon: '💼' },
  { name: '其他收入', type: 'revenue',   icon: '💰' },
  { name: '飲食',   type: 'expense',     icon: '🍜' },
  { name: '交通',   type: 'expense',     icon: '🚌' },
  { name: '購物',   type: 'expense',     icon: '🛒' },
  { name: '娛樂',   type: 'expense',     icon: '🎮' },
  { name: '醫療',   type: 'expense',     icon: '🏥' },
  { name: '其他支出', type: 'expense',   icon: '📦' },
];

async function seedData() {
  await db.transaction(async (tx) => {
    for (const cat of DEFAULT_CATEGORIES) {
      await tx.run('INSERT IGNORE INTO categories (name, icon) VALUES (?, ?)', [cat.name, cat.icon]);
      const row = await tx.get('SELECT id FROM categories WHERE name = ?', [cat.name]);
      if (row) {
        for (const sub of cat.subs) {
          await tx.run('INSERT IGNORE INTO subcategories (category_id, name) VALUES (?, ?)', [row.id, sub]);
        }
      }
    }
  });

  await db.transaction(async (tx) => {
    for (const acc of DEFAULT_ACCOUNTS) {
      const exists = await tx.get('SELECT id FROM accounts WHERE name = ? AND type = ?', [acc.name, acc.type]);
      if (!exists) {
        await tx.run('INSERT INTO accounts (name, type, icon) VALUES (?, ?, ?)', [acc.name, acc.type, acc.icon]);
      }
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function computeAccountBalance(accountId) {
  const account = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!account) return 0;
  const initial = account.initial_balance || 0;
  const { total: outflow } = await db.get(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE source_account_id = ?', [accountId]
  );
  const { total: inflow } = await db.get(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE dest_account_id = ?', [accountId]
  );
  if (account.type === 'asset' || account.type === 'liabilities') {
    return initial + inflow - outflow;
  }
  return inflow - outflow;
}

async function enrichAccount(account) {
  return { ...account, balance: await computeAccountBalance(account.id) };
}

// ── Middleware ────────────────────────────────────────────────────────────────

// LINE webhook: raw body required for HMAC signature verification
app.post('/line/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    req.rawBody = req.body;
    try { req.body = JSON.parse(req.body.toString()); } catch (_) { req.body = {}; }
    next();
  },
  handleLineWebhook
);

app.use(express.json());
app.use(cookieParser());

// ── Auth helpers ──────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'et_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let _ephemeralSecret = null;
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!_ephemeralSecret) {
    _ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn('SESSION_SECRET not set — using ephemeral secret (sessions lost on restart)');
  }
  return _ephemeralSecret;
}

function setSessionCookie(res, userId) {
  const token = jwt.sign({ uid: userId }, getSessionSecret(), { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function readSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;
    const payload = jwt.verify(token, secret);
    return payload.uid || null;
  } catch (_) { return null; }
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

app.use(express.static(path.join(__dirname, '../public')));

// ── Categories API ───────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res) => {
  const cats = await db.query('SELECT * FROM categories ORDER BY id');
  const subs = await db.query('SELECT * FROM subcategories ORDER BY id');
  res.json(cats.map(c => ({ ...c, subcategories: subs.filter(s => s.category_id === c.id) })));
});

app.post('/api/categories', async (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await db.run('INSERT INTO categories (name, icon) VALUES (?, ?)', [name, icon || '📦']);
    res.status(201).json({ id: result.insertId, name, icon: icon || '📦' });
  } catch (e) {
    res.status(409).json({ error: 'Category already exists' });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  const { name, icon } = req.body;
  const old = await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  await db.run('UPDATE categories SET name = ?, icon = ? WHERE id = ?',
    [name || old.name, icon !== undefined ? icon : old.icon, req.params.id]);
  res.json(await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]));
});

app.delete('/api/categories/:id', async (req, res) => {
  const cat = await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM subcategories WHERE category_id = ?', [req.params.id]);
    await tx.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  });
  res.json({ deleted: true });
});

app.post('/api/categories/:catId/subcategories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const cat = await db.get('SELECT id FROM categories WHERE id = ?', [req.params.catId]);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  try {
    const result = await db.run('INSERT INTO subcategories (category_id, name) VALUES (?, ?)', [req.params.catId, name]);
    res.status(201).json({ id: result.insertId, category_id: Number(req.params.catId), name });
  } catch (e) {
    res.status(409).json({ error: 'Subcategory already exists in this category' });
  }
});

app.delete('/api/subcategories/:id', async (req, res) => {
  const result = await db.run('DELETE FROM subcategories WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Accounts API ─────────────────────────────────────────────────────────────

app.get('/api/accounts', async (req, res) => {
  const { type } = req.query;
  const accounts = type
    ? await db.query('SELECT * FROM accounts WHERE type = ? ORDER BY id', [type])
    : await db.query('SELECT * FROM accounts ORDER BY type, id');
  res.json(await Promise.all(accounts.map(enrichAccount)));
});

app.post('/api/accounts', async (req, res) => {
  const { name, type, icon, currency, initial_balance } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const validTypes = ['asset', 'expense', 'revenue', 'liabilities'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid account type' });
  const result = await db.run(
    'INSERT INTO accounts (name, type, icon, currency, initial_balance) VALUES (?, ?, ?, ?, ?)',
    [name, type, icon || '💰', currency || 'TWD', initial_balance || 0]
  );
  const account = await db.get('SELECT * FROM accounts WHERE id = ?', [result.insertId]);
  res.status(201).json(await enrichAccount(account));
});

app.put('/api/accounts/:id', async (req, res) => {
  const old = await db.get('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { name, icon, currency, initial_balance } = req.body;
  await db.run('UPDATE accounts SET name=?, icon=?, currency=?, initial_balance=? WHERE id=?',
    [name || old.name, icon !== undefined ? icon : old.icon,
     currency || old.currency, initial_balance !== undefined ? initial_balance : old.initial_balance,
     req.params.id]);
  const account = await db.get('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  res.json(await enrichAccount(account));
});

app.delete('/api/accounts/:id', async (req, res) => {
  const { c } = await db.get(
    'SELECT COUNT(*) AS c FROM transactions WHERE source_account_id = ? OR dest_account_id = ?',
    [req.params.id, req.params.id]
  );
  if (c > 0) return res.status(409).json({ error: 'Cannot delete account with existing transactions' });
  const result = await db.run('DELETE FROM accounts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Transactions API ─────────────────────────────────────────────────────────

const TX_SELECT = `
  SELECT t.*,
    sa.name AS source_name, sa.type AS source_type, sa.icon AS source_icon,
    da.name AS dest_name,   da.type AS dest_type,   da.icon AS dest_icon,
    c.name  AS category_name, c.icon AS category_icon,
    sc.name AS subcategory_name
  FROM transactions t
  LEFT JOIN accounts sa    ON t.source_account_id = sa.id
  LEFT JOIN accounts da    ON t.dest_account_id   = da.id
  LEFT JOIN categories c   ON t.category_id       = c.id
  LEFT JOIN subcategories sc ON t.subcategory_id  = sc.id
`;

app.get('/api/transactions', async (req, res) => {
  const { from, to, category_id, account_id, type, q, limit: lim } = req.query;
  let sql = TX_SELECT + ' WHERE 1=1';
  const params = [];

  if (q) {
    sql += ' AND (t.description LIKE ? OR t.note LIKE ? OR t.tags LIKE ? OR c.name LIKE ? OR sc.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (from)        { sql += ' AND t.date >= ?';  params.push(from); }
  if (to)          { sql += ' AND t.date <= ?';  params.push(to); }
  if (category_id) { sql += ' AND t.category_id = ?'; params.push(category_id); }
  if (account_id)  {
    sql += ' AND (t.source_account_id = ? OR t.dest_account_id = ?)';
    params.push(account_id, account_id);
  }
  if (type === 'expense')  sql += " AND sa.type = 'asset' AND da.type = 'expense'";
  else if (type === 'income')   sql += " AND sa.type = 'revenue' AND da.type = 'asset'";
  else if (type === 'transfer') sql += " AND sa.type = 'asset' AND da.type = 'asset'";

  sql += ' ORDER BY t.date DESC, t.created_at DESC';
  if (lim) { sql += ' LIMIT ?'; params.push(parseInt(lim)); }

  res.json(await db.query(sql, params));
});

app.get('/api/transactions/trend', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter is required' });
  const rows = await db.query(`
    SELECT LEFT(t.date, 7) AS month,
      SUM(t.amount) AS total, COUNT(*) AS count
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id   = da.id
    WHERE (t.description LIKE ? OR t.note LIKE ?)
      AND sa.type = 'asset' AND da.type = 'expense'
    GROUP BY LEFT(t.date, 7)
    ORDER BY month
  `, [`%${q}%`, `%${q}%`]);
  res.json(rows);
});

app.post('/api/transactions', async (req, res) => {
  const { description, date, amount, source_account_id, dest_account_id,
          category_id, subcategory_id, note, tags } = req.body;
  if (!date || !amount || !source_account_id || !dest_account_id) {
    return res.status(400).json({ error: 'date, amount, source_account_id, dest_account_id are required' });
  }
  const result = await db.run(`
    INSERT INTO transactions
      (description, date, amount, source_account_id, dest_account_id,
       category_id, subcategory_id, note, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [description || null, date, amount, source_account_id, dest_account_id,
      category_id || null, subcategory_id || null, note || null, tags || null]);
  res.status(201).json(await db.get(TX_SELECT + ' WHERE t.id = ?', [result.insertId]));
});

app.put('/api/transactions/:id', async (req, res) => {
  const existing = await db.get('SELECT id FROM transactions WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { description, date, amount, source_account_id, dest_account_id,
          category_id, subcategory_id, note, tags } = req.body;
  await db.run(`
    UPDATE transactions
    SET description=?, date=?, amount=?, source_account_id=?, dest_account_id=?,
        category_id=?, subcategory_id=?, note=?, tags=?
    WHERE id=?
  `, [description || null, date, amount, source_account_id, dest_account_id,
      category_id || null, subcategory_id || null, note || null, tags || null, req.params.id]);
  res.json(await db.get(TX_SELECT + ' WHERE t.id = ?', [req.params.id]));
});

app.delete('/api/transactions/:id', async (req, res) => {
  const result = await db.run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Recurring API ────────────────────────────────────────────────────────────

app.get('/api/recurring', async (req, res) => {
  res.json(await db.query(`
    SELECT r.*,
      sa.name AS source_name, sa.icon AS source_icon,
      da.name AS dest_name,   da.icon AS dest_icon,
      c.name  AS category_name
    FROM recurring r
    LEFT JOIN accounts sa ON r.source_account_id = sa.id
    LEFT JOIN accounts da ON r.dest_account_id   = da.id
    LEFT JOIN categories c ON r.category_id      = c.id
    ORDER BY r.next_date
  `));
});

app.post('/api/recurring', async (req, res) => {
  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date } = req.body;
  if (!title || !amount || !source_account_id || !dest_account_id || !repeat_freq || !next_date) {
    return res.status(400).json({ error: 'title, amount, source/dest accounts, repeat_freq, next_date are required' });
  }
  const result = await db.run(`
    INSERT INTO recurring (title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [title, amount, source_account_id, dest_account_id, category_id || null, repeat_freq, next_date]);
  res.status(201).json(await db.get('SELECT * FROM recurring WHERE id = ?', [result.insertId]));
});

app.put('/api/recurring/:id', async (req, res) => {
  const old = await db.get('SELECT * FROM recurring WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date, active } = req.body;
  await db.run(`
    UPDATE recurring SET title=?, amount=?, source_account_id=?, dest_account_id=?,
      category_id=?, repeat_freq=?, next_date=?, active=? WHERE id=?
  `, [title || old.title, amount || old.amount,
      source_account_id || old.source_account_id, dest_account_id || old.dest_account_id,
      category_id !== undefined ? category_id : old.category_id,
      repeat_freq || old.repeat_freq, next_date || old.next_date,
      active !== undefined ? active : old.active,
      req.params.id]);
  res.json(await db.get('SELECT * FROM recurring WHERE id = ?', [req.params.id]));
});

app.delete('/api/recurring/:id', async (req, res) => {
  const result = await db.run('DELETE FROM recurring WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/recurring/process', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const due = await db.query('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?', [today]);
  const created = [];

  await db.transaction(async (tx) => {
    for (const r of due) {
      await tx.run(`
        INSERT INTO transactions
          (description, date, amount, source_account_id, dest_account_id, category_id, note)
        VALUES (?, ?, ?, ?, ?, ?, '自動建立：重複交易')
      `, [r.title, r.next_date, r.amount, r.source_account_id, r.dest_account_id, r.category_id]);

      const d = new Date(r.next_date);
      switch (r.repeat_freq) {
        case 'daily':   d.setDate(d.getDate() + 1); break;
        case 'weekly':  d.setDate(d.getDate() + 7); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'yearly':  d.setFullYear(d.getFullYear() + 1); break;
      }
      await tx.run('UPDATE recurring SET next_date = ? WHERE id = ?',
        [d.toISOString().slice(0, 10), r.id]);
      created.push({ recurring_id: r.id, title: r.title, date: r.next_date });
    }
  });

  res.json({ processed: created.length, transactions: created });
});

// ── Reports API ──────────────────────────────────────────────────────────────

app.get('/api/reports/monthly', async (req, res) => {
  const months = parseInt(req.query.months) || 6;
  const rows = await db.query(`
    SELECT
      LEFT(t.date, 7) AS month,
      SUM(CASE WHEN sa.type = 'revenue' AND da.type = 'asset'   THEN t.amount ELSE 0 END) AS income,
      SUM(CASE WHEN sa.type = 'asset'   AND da.type = 'expense' THEN t.amount ELSE 0 END) AS expense
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id   = da.id
    GROUP BY LEFT(t.date, 7)
    ORDER BY month DESC
    LIMIT ?
  `, [months]);
  res.json(rows.reverse());
});

app.get('/api/reports/category', async (req, res) => {
  const { from, to } = req.query;
  let sql = `
    SELECT
      COALESCE(c.name, da.name) AS name,
      COALESCE(c.icon, da.icon) AS icon,
      SUM(t.amount)             AS total,
      COUNT(*)                  AS count
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id   = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
  `;
  const params = [];
  if (from) { sql += ' AND t.date >= ?'; params.push(from); }
  if (to)   { sql += ' AND t.date <= ?'; params.push(to); }
  sql += ' GROUP BY COALESCE(c.name, da.name) ORDER BY total DESC';
  res.json(await db.query(sql, params));
});

app.get('/api/reports/networth', async (req, res) => {
  const months = parseInt(req.query.months) || 12;
  const accounts = await db.query("SELECT * FROM accounts WHERE type IN ('asset', 'liabilities')");
  const rows = await db.query(
    "SELECT DISTINCT LEFT(date, 7) AS month FROM transactions ORDER BY month"
  );
  const recentMonths = rows.slice(-months);

  const result = await Promise.all(recentMonths.map(async ({ month }) => {
    const endDate = month + '-31';
    let assets = 0, liabilities = 0;
    for (const acc of accounts) {
      const initial = acc.initial_balance || 0;
      const { t: inflow } = await db.get(
        'SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE dest_account_id = ? AND date <= ?',
        [acc.id, endDate]
      );
      const { t: outflow } = await db.get(
        'SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE source_account_id = ? AND date <= ?',
        [acc.id, endDate]
      );
      const balance = initial + inflow - outflow;
      if (acc.type === 'asset') assets += balance;
      else liabilities += balance;
    }
    return { month, assets, liabilities, net_worth: assets - liabilities };
  }));

  res.json(result);
});

// ── Budgets API ──────────────────────────────────────────────────────────────

app.get('/api/budgets', async (req, res) => {
  const { month } = req.query;
  let sql = `
    SELECT b.*, c.name AS category_name, c.icon AS category_icon
    FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
  `;
  const params = [];
  if (month) { sql += ' WHERE b.month = ?'; params.push(month); }
  sql += ' ORDER BY b.category_id IS NULL DESC, b.category_id';
  res.json(await db.query(sql, params));
});

app.post('/api/budgets', async (req, res) => {
  const { category_id, amount, month } = req.body;
  if (!amount || !month) return res.status(400).json({ error: 'amount and month are required' });
  try {
    const result = await db.run(
      'INSERT INTO budgets (category_id, amount, month) VALUES (?, ?, ?)',
      [category_id || null, amount, month]
    );
    res.status(201).json(await db.get(`
      SELECT b.*, c.name AS category_name, c.icon AS category_icon
      FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.id = ?
    `, [result.insertId]));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Budget already exists for this category/month' });
    }
    throw e;
  }
});

app.get('/api/budgets/status', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const monthStart = month + '-01';
  const monthEnd   = month + '-31';

  const budgets = await db.query(`
    SELECT b.*, c.name AS category_name, c.icon AS category_icon
    FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.month = ?
    ORDER BY b.category_id IS NULL DESC, b.category_id
  `, [month]);

  const { total: totalSpent } = await db.get(`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id   = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
  `, [monthStart, monthEnd]);

  const categorySpending = await db.query(`
    SELECT t.category_id, COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id   = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
  `, [monthStart, monthEnd]);

  const spendingMap = {};
  for (const row of categorySpending) spendingMap[row.category_id] = row.total;

  const result = budgets.map(b => {
    const spent = b.category_id ? (spendingMap[b.category_id] || 0) : totalSpent;
    const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    return { ...b, spent, remaining: b.amount - spent, pct };
  });

  res.json({ month, total_spent: totalSpent, budgets: result });
});

app.put('/api/budgets/:id', async (req, res) => {
  const old = await db.get('SELECT * FROM budgets WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  await db.run('UPDATE budgets SET amount = ? WHERE id = ?', [req.body.amount || old.amount, req.params.id]);
  res.json(await db.get(`
    SELECT b.*, c.name AS category_name, c.icon AS category_icon
    FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.id = ?
  `, [req.params.id]));
});

app.delete('/api/budgets/:id', async (req, res) => {
  const result = await db.run('DELETE FROM budgets WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── CSV Export ───────────────────────────────────────────────────────────────

app.get('/api/export', async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const rows = await db.query(`
    SELECT t.id, t.date, t.amount, t.description,
      sa.name AS source_account, da.name AS dest_account,
      c.name AS category, sc.name AS subcategory,
      t.note, t.tags, t.created_at
    FROM transactions t
    LEFT JOIN accounts sa    ON t.source_account_id = sa.id
    LEFT JOIN accounts da    ON t.dest_account_id   = da.id
    LEFT JOIN categories c   ON t.category_id       = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id  = sc.id
    WHERE t.date >= ?
    ORDER BY t.date DESC
  `, [fromStr]);

  const header = 'id,date,amount,description,source_account,dest_account,category,subcategory,note,tags,created_at\n';
  const csv = header + rows.map(r =>
    [r.id, r.date, r.amount,
     `"${(r.description || '').replace(/"/g, '""')}"`,
     `"${r.source_account || ''}"`, `"${r.dest_account || ''}"`,
     `"${r.category || ''}"`, `"${r.subcategory || ''}"`,
     `"${(r.note || '').replace(/"/g, '""')}"`,
     `"${(r.tags || '').replace(/"/g, '""')}"`,
     r.created_at].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${days}d.csv"`);
  res.send(csv);
});

// ── Trips API ────────────────────────────────────────────────────────────────

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateShareToken() {
  return crypto.randomBytes(16).toString('hex'); // 32-char URL-safe
}

async function ensureShareToken(tripId) {
  const trip = await db.get('SELECT share_token FROM trips WHERE id = ?', [tripId]);
  if (trip && trip.share_token) return trip.share_token;
  let token, attempts = 0;
  do {
    token = generateShareToken();
    attempts++;
  } while ((await db.get('SELECT id FROM trips WHERE share_token = ?', [token])) && attempts < 10);
  await db.run('UPDATE trips SET share_token = ? WHERE id = ?', [token, tripId]);
  return token;
}

async function backfillShareTokens() {
  const rows = await db.query('SELECT id FROM trips WHERE share_token IS NULL');
  for (const r of rows) await ensureShareToken(r.id);
  if (rows.length) console.log(`Backfilled share_token for ${rows.length} trip(s)`);
}

function computeSettlement(members, expenses) {
  const net = {};
  members.forEach(m => { net[m.id] = 0; });
  for (const exp of expenses) {
    const baseAmount = exp.amount * (exp.exchange_rate || 1);
    if (net[exp.paid_by] !== undefined) net[exp.paid_by] += baseAmount;
    const splits = exp.splits ? JSON.parse(exp.splits) : null;
    if (exp.split_type === 'equal') {
      const share = baseAmount / members.length;
      members.forEach(m => { if (net[m.id] !== undefined) net[m.id] -= share; });
    } else if (exp.split_type === 'paid_by_one') {
      if (net[exp.paid_by] !== undefined) net[exp.paid_by] -= baseAmount;
    } else if (exp.split_type === 'custom' && splits) {
      for (const [mid, share] of Object.entries(splits)) {
        if (net[parseInt(mid)] !== undefined) net[parseInt(mid)] -= parseFloat(share) * (exp.exchange_rate || 1);
      }
    }
  }
  const creditors = Object.entries(net).filter(([, v]) => v > 0.005).map(([id, v]) => ({ id: parseInt(id), amount: v }));
  const debtors   = Object.entries(net).filter(([, v]) => v < -0.005).map(([id, v]) => ({ id: parseInt(id), amount: -v }));
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amt = Math.min(creditors[ci].amount, debtors[di].amount);
    if (amt > 0.005) transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: Math.round(amt) });
    creditors[ci].amount -= amt;
    debtors[di].amount -= amt;
    if (creditors[ci].amount < 0.005) ci++;
    if (debtors[di].amount < 0.005) di++;
  }
  return { net, transfers };
}

app.get('/api/trips', async (req, res) => {
  res.json(await db.query('SELECT * FROM trips ORDER BY start_date DESC, id DESC'));
});

app.post('/api/trips', async (req, res) => {
  const { name, destination, start_date, end_date, budget, currency, created_by } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = await db.run(
    'INSERT INTO trips (name, destination, start_date, end_date, budget, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, destination || null, start_date || null, end_date || null, budget || 0, currency || 'TWD', created_by || null]
  );
  await ensureShareToken(result.insertId);
  res.status(201).json(await db.get('SELECT * FROM trips WHERE id = ?', [result.insertId]));
});

app.get('/api/trips/:id', async (req, res) => {
  const trip = await db.get('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  const members = await db.query('SELECT * FROM trip_members WHERE trip_id = ? ORDER BY id', [req.params.id]);
  const expenses = await db.query(`
    SELECT te.*, tm.name AS paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.trip_id = ? ORDER BY te.date DESC, te.id DESC
  `, [req.params.id]);
  res.json({ ...trip, members, expenses });
});

app.put('/api/trips/:id', async (req, res) => {
  const old = await db.get('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { name, destination, start_date, end_date, budget, currency } = req.body;
  await db.run('UPDATE trips SET name=?, destination=?, start_date=?, end_date=?, budget=?, currency=? WHERE id=?',
    [name || old.name, destination ?? old.destination, start_date ?? old.start_date,
     end_date ?? old.end_date, budget ?? old.budget, currency || old.currency, req.params.id]);
  res.json(await db.get('SELECT * FROM trips WHERE id = ?', [req.params.id]));
});

app.delete('/api/trips/:id', async (req, res) => {
  const result = await db.run('DELETE FROM trips WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/trips/:id/members', async (req, res) => {
  const trip = await db.get('SELECT id FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  let joinCode, attempts = 0;
  do {
    joinCode = generateJoinCode();
    attempts++;
  } while ((await db.get('SELECT id FROM trip_members WHERE join_code = ?', [joinCode])) && attempts < 10);
  const result = await db.run(
    'INSERT INTO trip_members (trip_id, name, email, join_code) VALUES (?, ?, ?, ?)',
    [req.params.id, name, email || null, joinCode]
  );
  res.status(201).json(await db.get('SELECT * FROM trip_members WHERE id = ?', [result.insertId]));
});

app.delete('/api/trips/:id/members/:mid', async (req, res) => {
  const { c } = await db.get(
    'SELECT COUNT(*) AS c FROM trip_expenses WHERE trip_id = ? AND paid_by = ?',
    [req.params.id, req.params.mid]
  );
  if (c > 0) return res.status(409).json({ error: '此成員有費用記錄，無法移除' });
  const result = await db.run(
    'DELETE FROM trip_members WHERE id = ? AND trip_id = ?', [req.params.mid, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/trips/join', async (req, res) => {
  const { join_code } = req.body;
  if (!join_code) return res.status(400).json({ error: 'join_code is required' });
  const member = await db.get('SELECT * FROM trip_members WHERE join_code = ?', [join_code.toUpperCase()]);
  if (!member) return res.status(404).json({ error: '邀請碼無效' });
  const trip = await db.get('SELECT * FROM trips WHERE id = ?', [member.trip_id]);
  res.json({ member, trip });
});

// ── Auth: Google OAuth + session ──────────────────────────────────────────────

function googleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);
}

// GET /auth/google?share_token=<optional>
app.get('/auth/google', (req, res) => {
  if (!googleOAuthConfigured()) {
    return res.status(501).send('Google OAuth 尚未設定。請在 .env 填入 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL。');
  }
  const share_token = req.query.share_token || null;
  const nonce = crypto.randomBytes(12).toString('hex');
  const state = jwt.sign({ share_token, nonce }, getSessionSecret(), { expiresIn: '10m' });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback
app.get('/auth/google/callback', async (req, res) => {
  if (!googleOAuthConfigured()) return res.status(501).send('OAuth not configured');
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Google 登入失敗：${error}`);
  if (!code || !state) return res.status(400).send('Missing code or state');

  let stateData;
  try { stateData = jwt.verify(state, getSessionSecret()); }
  catch (_) { return res.status(400).send('State invalid or expired'); }

  // Exchange code for tokens
  let tokenJson;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });
    tokenJson = await r.json();
    if (!r.ok) throw new Error(tokenJson.error_description || 'token exchange failed');
  } catch (e) {
    return res.status(500).send(`Token exchange error: ${e.message}`);
  }

  // Parse id_token payload (trusted channel — from Google over HTTPS)
  const idToken = tokenJson.id_token;
  if (!idToken) return res.status(500).send('No id_token in response');
  const [, payloadB64] = idToken.split('.');
  const profile = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  // profile: { sub, email, email_verified, name, picture, ... }

  // Find or create user
  let user = await db.get('SELECT * FROM users WHERE google_sub = ?', [profile.sub]);
  if (!user) {
    const result = await db.run(
      'INSERT INTO users (google_sub, email, name, picture) VALUES (?, ?, ?, ?)',
      [profile.sub, profile.email || null, profile.name || profile.email || 'User', profile.picture || null]
    );
    user = await db.get('SELECT * FROM users WHERE id = ?', [result.insertId]);
  } else {
    // Refresh profile snapshot
    await db.run('UPDATE users SET email=?, name=?, picture=? WHERE id=?',
      [profile.email || user.email, profile.name || user.name, profile.picture || user.picture, user.id]);
  }

  setSessionCookie(res, user.id);

  // If state carries a share_token, auto-join that trip
  if (stateData.share_token) {
    const trip = await db.get('SELECT id FROM trips WHERE share_token = ?', [stateData.share_token]);
    if (trip) {
      const existing = await db.get(
        'SELECT id FROM trip_members WHERE trip_id = ? AND user_id = ?', [trip.id, user.id]
      );
      if (!existing) {
        let joinCode, attempts = 0;
        do {
          joinCode = generateJoinCode();
          attempts++;
        } while ((await db.get('SELECT id FROM trip_members WHERE join_code = ?', [joinCode])) && attempts < 10);
        await db.run(
          'INSERT INTO trip_members (trip_id, name, email, join_code, user_id) VALUES (?, ?, ?, ?, ?)',
          [trip.id, user.name, user.email, joinCode, user.id]
        );
      }
      return res.redirect(`/#trip/${stateData.share_token}`);
    }
  }
  res.redirect('/#trips');
});

// GET /api/me — current session user (null if not logged in)
app.get('/api/me', async (req, res) => {
  const uid = readSession(req);
  if (!uid) return res.json({ user: null });
  const user = await db.get('SELECT id, email, name, picture FROM users WHERE id = ?', [uid]);
  res.json({ user });
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── Share-link access ─────────────────────────────────────────────────────────

// GET /api/trips/by-share/:token — fetch trip via share link
app.get('/api/trips/by-share/:token', async (req, res) => {
  const trip = await db.get('SELECT * FROM trips WHERE share_token = ?', [req.params.token]);
  if (!trip) return res.status(404).json({ error: '分享連結無效' });
  const members = await db.query('SELECT id, name, email, user_id FROM trip_members WHERE trip_id = ? ORDER BY id', [trip.id]);
  const expenses = await db.query(`
    SELECT te.*, tm.name AS paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.trip_id = ? ORDER BY te.date DESC, te.id DESC
  `, [trip.id]);

  // If authenticated via Google session, surface their trip_member row
  const uid = readSession(req);
  let current_member = null;
  if (uid) {
    current_member = await db.get(
      'SELECT id, name, email FROM trip_members WHERE trip_id = ? AND user_id = ?',
      [trip.id, uid]
    );
  }
  res.json({ ...trip, members, expenses, current_member });
});

// POST /api/trips/by-share/:token/join  { name, device_token }
// Quick-join by name only — creates trip_member + auto-claims to device
app.post('/api/trips/by-share/:token/join', async (req, res) => {
  const { name, device_token } = req.body;
  if (!name || !device_token) {
    return res.status(400).json({ error: 'name and device_token are required' });
  }
  const trip = await db.get('SELECT id FROM trips WHERE share_token = ?', [req.params.token]);
  if (!trip) return res.status(404).json({ error: '分享連結無效' });

  const member = await db.transaction(async (tx) => {
    let joinCode, attempts = 0;
    do {
      joinCode = generateJoinCode();
      attempts++;
    } while ((await tx.get('SELECT id FROM trip_members WHERE join_code = ?', [joinCode])) && attempts < 10);
    const result = await tx.run(
      'INSERT INTO trip_members (trip_id, name, join_code) VALUES (?, ?, ?)',
      [trip.id, name.trim(), joinCode]
    );
    await tx.run(`
      INSERT INTO trip_member_claims (member_id, trip_id, device_token)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE member_id = VALUES(member_id), claimed_at = NOW()
    `, [result.insertId, trip.id, device_token]);
    return tx.get('SELECT * FROM trip_members WHERE id = ?', [result.insertId]);
  });
  res.status(201).json({ trip_id: trip.id, member });
});

app.post('/api/trips/:id/expenses', async (req, res) => {
  const trip = await db.get('SELECT id FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const { paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits } = req.body;
  if (!paid_by || !amount || !date) {
    return res.status(400).json({ error: 'paid_by, amount, date are required' });
  }
  const result = await db.run(`
    INSERT INTO trip_expenses
      (trip_id, paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [req.params.id, paid_by, amount, currency || 'TWD', exchange_rate || 1,
      category_id || null, description || null, date, split_type || 'equal',
      splits ? JSON.stringify(splits) : null]);
  res.status(201).json(await db.get(`
    SELECT te.*, tm.name AS paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.id = ?
  `, [result.insertId]));
});

app.put('/api/trips/:id/expenses/:eid', async (req, res) => {
  const old = await db.get('SELECT * FROM trip_expenses WHERE id = ? AND trip_id = ?',
    [req.params.eid, req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits } = req.body;
  await db.run(`
    UPDATE trip_expenses
    SET paid_by=?, amount=?, currency=?, exchange_rate=?, category_id=?,
        description=?, date=?, split_type=?, splits=?
    WHERE id=?
  `, [paid_by ?? old.paid_by, amount ?? old.amount, currency || old.currency,
      exchange_rate ?? old.exchange_rate, category_id ?? old.category_id,
      description ?? old.description, date || old.date, split_type || old.split_type,
      splits !== undefined ? JSON.stringify(splits) : old.splits,
      req.params.eid]);
  res.json(await db.get(`
    SELECT te.*, tm.name AS paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.id = ?
  `, [req.params.eid]));
});

app.delete('/api/trips/:id/expenses/:eid', async (req, res) => {
  const result = await db.run(
    'DELETE FROM trip_expenses WHERE id = ? AND trip_id = ?', [req.params.eid, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.get('/api/trips/:id/settlement', async (req, res) => {
  const trip = await db.get('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  const members = await db.query('SELECT * FROM trip_members WHERE trip_id = ? ORDER BY id', [req.params.id]);
  const expenses = await db.query('SELECT * FROM trip_expenses WHERE trip_id = ?', [req.params.id]);
  const { net, transfers } = computeSettlement(members, expenses);
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });
  res.json({
    summary: members.map(m => ({
      id: m.id, name: m.name,
      total_paid: expenses.filter(e => e.paid_by === m.id)
        .reduce((s, e) => s + e.amount * (e.exchange_rate || 1), 0),
      net_balance: Math.round((net[m.id] || 0) * 100) / 100,
    })),
    transfers: transfers.map(t => ({
      from_id: t.from, from_name: memberMap[t.from]?.name || '?',
      to_id: t.to,   to_name: memberMap[t.to]?.name || '?',
      amount: t.amount,
    })),
  });
});

// ── Trip Identity API ─────────────────────────────────────────────────────────

// POST /api/trips/identity  { trip_id, member_id, device_token }
app.post('/api/trips/identity', async (req, res) => {
  const { trip_id, member_id, device_token } = req.body;
  if (!trip_id || !member_id || !device_token) {
    return res.status(400).json({ error: 'trip_id, member_id, device_token are required' });
  }
  const member = await db.get(
    'SELECT id, name FROM trip_members WHERE id = ? AND trip_id = ?', [member_id, trip_id]
  );
  if (!member) return res.status(404).json({ error: 'Member not found in this trip' });

  await db.run(`
    INSERT INTO trip_member_claims (member_id, trip_id, device_token)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE member_id = VALUES(member_id), claimed_at = NOW()
  `, [member_id, trip_id, device_token]);

  res.json({ id: member.id, name: member.name });
});

// DELETE /api/trips/identity  { trip_id, device_token }
app.delete('/api/trips/identity', async (req, res) => {
  const { trip_id, device_token } = req.body;
  if (!trip_id || !device_token) return res.status(400).json({ error: 'trip_id and device_token are required' });
  await db.run('DELETE FROM trip_member_claims WHERE trip_id = ? AND device_token = ?', [trip_id, device_token]);
  res.json({ cleared: true });
});

// GET /api/trips/identity?trip_id=xxx&device_token=xxx
app.get('/api/trips/identity', async (req, res) => {
  const { trip_id, device_token } = req.query;
  if (!trip_id || !device_token) {
    return res.status(400).json({ error: 'trip_id and device_token are required' });
  }
  const row = await db.get(`
    SELECT tm.id, tm.name
    FROM trip_member_claims c
    JOIN trip_members tm ON c.member_id = tm.id
    WHERE c.trip_id = ? AND c.device_token = ?
  `, [trip_id, device_token]);

  if (!row) return res.status(404).json({ error: 'No identity for this device' });
  res.json(row);
});

// ── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await initSchema();
  await seedData();
  await backfillShareTokens();
  app.listen(PORT, () => {
    console.log(`Expense Tracker running at http://localhost:${PORT}`);
  });
}

start().catch(err => { console.error(err); process.exit(1); });
