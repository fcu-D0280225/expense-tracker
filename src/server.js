const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── MySQL connection pool ───────────────────────────────────────────────────

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'app_user',
  password: process.env.MYSQL_PASSWORD || 'AppUser@2026!',
  database: process.env.MYSQL_DATABASE || 'expense_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

// ── Schema ───────────────────────────────────────────────────────────────────

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id   INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      icon VARCHAR(32)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      name        VARCHAR(255) NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE KEY uq_cat_sub (category_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(255) NOT NULL,
      type            ENUM('asset','expense','revenue','liabilities') NOT NULL,
      icon            VARCHAR(32) DEFAULT '💰',
      currency        VARCHAR(16) DEFAULT 'TWD',
      initial_balance DOUBLE DEFAULT 0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      description       TEXT,
      date              VARCHAR(10) NOT NULL,
      amount            DOUBLE NOT NULL,
      source_account_id INT NOT NULL,
      dest_account_id   INT NOT NULL,
      category_id       INT,
      subcategory_id    INT,
      note              TEXT,
      tags              TEXT,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_account_id) REFERENCES accounts(id),
      FOREIGN KEY (dest_account_id) REFERENCES accounts(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT,
      amount      DOUBLE NOT NULL,
      month       VARCHAR(7) NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      UNIQUE KEY uq_cat_month (category_id, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      destination VARCHAR(255),
      start_date  VARCHAR(10),
      end_date    VARCHAR(10),
      budget      DOUBLE DEFAULT 0,
      currency    VARCHAR(16) DEFAULT 'TWD',
      created_by  VARCHAR(255),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_members (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      trip_id   INT NOT NULL,
      name      VARCHAR(255) NOT NULL,
      email     VARCHAR(255),
      join_code VARCHAR(6) UNIQUE NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trip_expenses (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      trip_id       INT NOT NULL,
      paid_by       INT NOT NULL,
      amount        DOUBLE NOT NULL,
      currency      VARCHAR(16) DEFAULT 'TWD',
      exchange_rate DOUBLE DEFAULT 1,
      category_id   INT,
      description   TEXT,
      date          VARCHAR(10) NOT NULL,
      split_type    ENUM('equal','custom','paid_by_one') NOT NULL DEFAULT 'equal',
      splits        TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      FOREIGN KEY (paid_by) REFERENCES trip_members(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recurring (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      title             VARCHAR(255) NOT NULL,
      amount            DOUBLE NOT NULL,
      source_account_id INT NOT NULL,
      dest_account_id   INT NOT NULL,
      category_id       INT,
      repeat_freq       ENUM('daily','weekly','monthly','yearly') NOT NULL,
      next_date         VARCHAR(10) NOT NULL,
      active            TINYINT DEFAULT 1,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_account_id) REFERENCES accounts(id),
      FOREIGN KEY (dest_account_id) REFERENCES accounts(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── Seed default categories ─────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: '飲食', icon: '🍜', subs: ['早餐', '午餐', '晚餐', '飲料'] },
  { name: '交通', icon: '🚌', subs: ['大眾運輸', '計程車'] },
  { name: '購物', icon: '🛒', subs: ['日用品', '服飾', '3C'] },
  { name: '娛樂', icon: '🎮', subs: ['電影', '遊戲'] },
  { name: '醫療', icon: '🏥', subs: ['診所', '藥品'] },
  { name: '其他', icon: '📦', subs: [] },
];

async function seedCategories() {
  for (const cat of DEFAULT_CATEGORIES) {
    await pool.query('INSERT IGNORE INTO categories (name, icon) VALUES (?, ?)', [cat.name, cat.icon]);
    const [[row]] = await pool.query('SELECT id FROM categories WHERE name = ?', [cat.name]);
    if (row) {
      for (const sub of cat.subs) {
        await pool.query('INSERT IGNORE INTO subcategories (category_id, name) VALUES (?, ?)', [row.id, sub]);
      }
    }
  }
}

// ── Seed default accounts ───────────────────────────────────────────────────

const DEFAULT_ACCOUNTS = [
  { name: '現金', type: 'asset', icon: '💵' },
  { name: '銀行帳戶', type: 'asset', icon: '🏦' },
  { name: '信用卡', type: 'liabilities', icon: '💳' },
  { name: '薪資', type: 'revenue', icon: '💼' },
  { name: '其他收入', type: 'revenue', icon: '💰' },
  { name: '飲食', type: 'expense', icon: '🍜' },
  { name: '交通', type: 'expense', icon: '🚌' },
  { name: '購物', type: 'expense', icon: '🛒' },
  { name: '娛樂', type: 'expense', icon: '🎮' },
  { name: '醫療', type: 'expense', icon: '🏥' },
  { name: '其他支出', type: 'expense', icon: '📦' },
];

async function seedAccounts() {
  for (const acc of DEFAULT_ACCOUNTS) {
    const [[existing]] = await pool.query(
      'SELECT id FROM accounts WHERE name = ? AND type = ?', [acc.name, acc.type]
    );
    if (!existing) {
      await pool.query('INSERT INTO accounts (name, type, icon) VALUES (?, ?, ?)', [acc.name, acc.type, acc.icon]);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function computeAccountBalance(accountId) {
  const [[account]] = await pool.query('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!account) return 0;

  const initial = account.initial_balance || 0;
  const [[{ total: outflow }]] = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE source_account_id = ?', [accountId]
  );
  const [[{ total: inflow }]] = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE dest_account_id = ?', [accountId]
  );

  if (account.type === 'asset' || account.type === 'liabilities') {
    return initial + inflow - outflow;
  }
  return inflow - outflow;
}

async function enrichAccount(account) {
  return { ...account, balance: await computeAccountBalance(account.id) };
}

async function enrichAccounts(accounts) {
  return Promise.all(accounts.map(a => enrichAccount(a)));
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Categories API ───────────────────────────────────────────────────────────

app.get('/api/categories', async (req, res) => {
  const [cats] = await pool.query('SELECT * FROM categories ORDER BY id');
  const [subs] = await pool.query('SELECT * FROM subcategories ORDER BY id');
  const result = cats.map(c => ({
    ...c,
    subcategories: subs.filter(s => s.category_id === c.id),
  }));
  res.json(result);
});

app.post('/api/categories', async (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const [result] = await pool.query('INSERT INTO categories (name, icon) VALUES (?, ?)', [name, icon || '📦']);
    res.status(201).json({ id: result.insertId, name, icon: icon || '📦' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category already exists' });
    throw e;
  }
});

app.put('/api/categories/:id', async (req, res) => {
  const { name, icon } = req.body;
  const [[old]] = await pool.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  await pool.query('UPDATE categories SET name = ?, icon = ? WHERE id = ?',
    [name || old.name, icon !== undefined ? icon : old.icon, req.params.id]);
  const [[updated]] = await pool.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  res.json(updated);
});

app.delete('/api/categories/:id', async (req, res) => {
  const [[cat]] = await pool.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM subcategories WHERE category_id = ?', [req.params.id]);
    await conn.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json({ deleted: true });
});

app.post('/api/categories/:catId/subcategories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [[cat]] = await pool.query('SELECT id FROM categories WHERE id = ?', [req.params.catId]);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  try {
    const [result] = await pool.query('INSERT INTO subcategories (category_id, name) VALUES (?, ?)', [req.params.catId, name]);
    res.status(201).json({ id: result.insertId, category_id: Number(req.params.catId), name });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Subcategory already exists in this category' });
    throw e;
  }
});

app.delete('/api/subcategories/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM subcategories WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Accounts API ─────────────────────────────────────────────────────────────

app.get('/api/accounts', async (req, res) => {
  const { type } = req.query;
  let accounts;
  if (type) {
    [accounts] = await pool.query('SELECT * FROM accounts WHERE type = ? ORDER BY id', [type]);
  } else {
    [accounts] = await pool.query('SELECT * FROM accounts ORDER BY type, id');
  }
  res.json(await enrichAccounts(accounts));
});

app.post('/api/accounts', async (req, res) => {
  const { name, type, icon, currency, initial_balance } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const validTypes = ['asset', 'expense', 'revenue', 'liabilities'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

  const [result] = await pool.query(
    'INSERT INTO accounts (name, type, icon, currency, initial_balance) VALUES (?, ?, ?, ?, ?)',
    [name, type, icon || '💰', currency || 'TWD', initial_balance || 0]
  );

  const [[account]] = await pool.query('SELECT * FROM accounts WHERE id = ?', [result.insertId]);
  res.status(201).json(await enrichAccount(account));
});

app.put('/api/accounts/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });

  const { name, icon, currency, initial_balance } = req.body;
  await pool.query('UPDATE accounts SET name=?, icon=?, currency=?, initial_balance=? WHERE id=?', [
    name || old.name,
    icon !== undefined ? icon : old.icon,
    currency || old.currency,
    initial_balance !== undefined ? initial_balance : old.initial_balance,
    req.params.id
  ]);

  const [[account]] = await pool.query('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
  res.json(await enrichAccount(account));
});

app.delete('/api/accounts/:id', async (req, res) => {
  const [[{ c: txCount }]] = await pool.query(
    'SELECT COUNT(*) as c FROM transactions WHERE source_account_id = ? OR dest_account_id = ?',
    [req.params.id, req.params.id]
  );
  if (txCount > 0) {
    return res.status(409).json({ error: 'Cannot delete account with existing transactions' });
  }
  const [result] = await pool.query('DELETE FROM accounts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Transactions API ─────────────────────────────────────────────────────────

app.get('/api/transactions', async (req, res) => {
  const { from, to, category_id, account_id, type, q, limit: lim } = req.query;
  let query = `
    SELECT t.*,
      sa.name as source_name, sa.type as source_type, sa.icon as source_icon,
      da.name as dest_name, da.type as dest_type, da.icon as dest_icon,
      c.name as category_name, c.icon as category_icon,
      sc.name as subcategory_name
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id
    WHERE 1=1
  `;
  const params = [];

  if (q) {
    query += ' AND (t.description LIKE ? OR t.note LIKE ? OR t.tags LIKE ? OR c.name LIKE ? OR sc.name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (from) { query += ' AND t.date >= ?'; params.push(from); }
  if (to)   { query += ' AND t.date <= ?'; params.push(to); }
  if (category_id) { query += ' AND t.category_id = ?'; params.push(category_id); }
  if (account_id) {
    query += ' AND (t.source_account_id = ? OR t.dest_account_id = ?)';
    params.push(account_id, account_id);
  }
  if (type === 'expense') {
    query += " AND sa.type = 'asset' AND da.type = 'expense'";
  } else if (type === 'income') {
    query += " AND sa.type = 'revenue' AND da.type = 'asset'";
  } else if (type === 'transfer') {
    query += " AND sa.type = 'asset' AND da.type = 'asset'";
  }

  query += ' ORDER BY t.date DESC, t.created_at DESC';
  if (lim) { query += ' LIMIT ?'; params.push(parseInt(lim)); }

  const [rows] = await pool.query(query, params);
  res.json(rows);
});

app.get('/api/transactions/trend', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter is required' });

  const [rows] = await pool.query(`
    SELECT DATE_FORMAT(t.date, '%Y-%m') as month,
      SUM(t.amount) as total,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    WHERE (t.description LIKE ? OR t.note LIKE ?)
      AND sa.type = 'asset' AND da.type = 'expense'
    GROUP BY month
    ORDER BY month
  `, [`%${q}%`, `%${q}%`]);

  res.json(rows);
});

app.post('/api/transactions', async (req, res) => {
  const { description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags } = req.body;
  if (!date || !amount || !source_account_id || !dest_account_id) {
    return res.status(400).json({ error: 'date, amount, source_account_id, dest_account_id are required' });
  }

  const [result] = await pool.query(`
    INSERT INTO transactions (description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [description || null, date, amount, source_account_id, dest_account_id, category_id || null, subcategory_id || null, note || null, tags || null]);

  const [[tx]] = await pool.query(`
    SELECT t.*,
      sa.name as source_name, sa.type as source_type, sa.icon as source_icon,
      da.name as dest_name, da.type as dest_type, da.icon as dest_icon,
      c.name as category_name, c.icon as category_icon,
      sc.name as subcategory_name
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id
    WHERE t.id = ?
  `, [result.insertId]);

  res.status(201).json(tx);
});

app.put('/api/transactions/:id', async (req, res) => {
  const [[existing]] = await pool.query('SELECT id FROM transactions WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags } = req.body;
  await pool.query(`
    UPDATE transactions
    SET description=?, date=?, amount=?, source_account_id=?, dest_account_id=?,
        category_id=?, subcategory_id=?, note=?, tags=?
    WHERE id=?
  `, [description || null, date, amount, source_account_id, dest_account_id,
    category_id || null, subcategory_id || null, note || null, tags || null, req.params.id]);

  const [[tx]] = await pool.query(`
    SELECT t.*,
      sa.name as source_name, sa.type as source_type, sa.icon as source_icon,
      da.name as dest_name, da.type as dest_type, da.icon as dest_icon,
      c.name as category_name, c.icon as category_icon,
      sc.name as subcategory_name
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id
    WHERE t.id = ?
  `, [req.params.id]);

  res.json(tx);
});

app.delete('/api/transactions/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Recurring API ────────────────────────────────────────────────────────────

app.get('/api/recurring', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT r.*,
      sa.name as source_name, sa.icon as source_icon,
      da.name as dest_name, da.icon as dest_icon,
      c.name as category_name
    FROM recurring r
    LEFT JOIN accounts sa ON r.source_account_id = sa.id
    LEFT JOIN accounts da ON r.dest_account_id = da.id
    LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.next_date
  `);
  res.json(rows);
});

app.post('/api/recurring', async (req, res) => {
  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date } = req.body;
  if (!title || !amount || !source_account_id || !dest_account_id || !repeat_freq || !next_date) {
    return res.status(400).json({ error: 'title, amount, source/dest accounts, repeat_freq, next_date are required' });
  }

  const [result] = await pool.query(`
    INSERT INTO recurring (title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [title, amount, source_account_id, dest_account_id, category_id || null, repeat_freq, next_date]);

  const [[row]] = await pool.query('SELECT * FROM recurring WHERE id = ?', [result.insertId]);
  res.status(201).json(row);
});

app.put('/api/recurring/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM recurring WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });

  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date, active } = req.body;
  await pool.query(`
    UPDATE recurring SET title=?, amount=?, source_account_id=?, dest_account_id=?,
      category_id=?, repeat_freq=?, next_date=?, active=? WHERE id=?
  `, [
    title || old.title, amount || old.amount,
    source_account_id || old.source_account_id, dest_account_id || old.dest_account_id,
    category_id !== undefined ? category_id : old.category_id,
    repeat_freq || old.repeat_freq, next_date || old.next_date,
    active !== undefined ? active : old.active,
    req.params.id
  ]);

  const [[row]] = await pool.query('SELECT * FROM recurring WHERE id = ?', [req.params.id]);
  res.json(row);
});

app.delete('/api/recurring/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM recurring WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/recurring/process', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [due] = await pool.query('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?', [today]);
  const created = [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of due) {
      await conn.query(`
        INSERT INTO transactions (description, date, amount, source_account_id, dest_account_id, category_id, note)
        VALUES (?, ?, ?, ?, ?, ?, '自動建立：重複交易')
      `, [r.title, r.next_date, r.amount, r.source_account_id, r.dest_account_id, r.category_id]);

      const d = new Date(r.next_date);
      switch (r.repeat_freq) {
        case 'daily': d.setDate(d.getDate() + 1); break;
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
      }
      const nextDate = d.toISOString().slice(0, 10);
      await conn.query('UPDATE recurring SET next_date = ? WHERE id = ?', [nextDate, r.id]);
      created.push({ recurring_id: r.id, title: r.title, date: r.next_date });
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  res.json({ processed: created.length, transactions: created });
});

// ── Reports API ──────────────────────────────────────────────────────────────

app.get('/api/reports/monthly', async (req, res) => {
  const months = parseInt(req.query.months) || 6;
  const [rows] = await pool.query(`
    SELECT
      DATE_FORMAT(t.date, '%Y-%m') as month,
      SUM(CASE WHEN sa.type = 'revenue' AND da.type = 'asset' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN sa.type = 'asset' AND da.type = 'expense' THEN t.amount ELSE 0 END) as expense
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `, [months]);
  res.json(rows.reverse());
});

app.get('/api/reports/category', async (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT
      COALESCE(c.name, da.name) AS name,
      COALESCE(c.icon, da.icon) AS icon,
      SUM(t.amount) AS total,
      COUNT(*) AS count
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
  `;
  const params = [];
  if (from) { query += ' AND t.date >= ?'; params.push(from); }
  if (to)   { query += ' AND t.date <= ?'; params.push(to); }
  query += ' GROUP BY COALESCE(c.name, da.name), COALESCE(c.icon, da.icon) ORDER BY total DESC';
  const [rows] = await pool.query(query, params);
  res.json(rows);
});

app.get('/api/reports/networth', async (req, res) => {
  const months = parseInt(req.query.months) || 12;
  const [accounts] = await pool.query("SELECT * FROM accounts WHERE type IN ('asset', 'liabilities')");

  const [monthRows] = await pool.query(`
    SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') as month FROM transactions ORDER BY month
  `);

  const recentMonths = monthRows.slice(-months);
  const result = [];

  for (const { month } of recentMonths) {
    const endDate = month + '-31';
    let assets = 0;
    let liabilities = 0;

    for (const acc of accounts) {
      const initial = acc.initial_balance || 0;
      const [[{ t: inflow }]] = await pool.query(
        'SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE dest_account_id = ? AND date <= ?',
        [acc.id, endDate]
      );
      const [[{ t: outflow }]] = await pool.query(
        'SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE source_account_id = ? AND date <= ?',
        [acc.id, endDate]
      );
      const balance = initial + inflow - outflow;

      if (acc.type === 'asset') assets += balance;
      else liabilities += balance;
    }

    result.push({ month, assets, liabilities, net_worth: assets - liabilities });
  }

  res.json(result);
});

// ── Budgets API ─────────────────────────────────────────────────────────────

app.get('/api/budgets', async (req, res) => {
  const { month } = req.query;
  let query = `
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b
    LEFT JOIN categories c ON b.category_id = c.id
  `;
  const params = [];
  if (month) { query += ' WHERE b.month = ?'; params.push(month); }
  query += ' ORDER BY b.category_id IS NULL DESC, b.category_id';
  const [rows] = await pool.query(query, params);
  res.json(rows);
});

app.post('/api/budgets', async (req, res) => {
  const { category_id, amount, month } = req.body;
  if (!amount || !month) return res.status(400).json({ error: 'amount and month are required' });
  try {
    const [result] = await pool.query(
      'INSERT INTO budgets (category_id, amount, month) VALUES (?, ?, ?)',
      [category_id || null, amount, month]
    );
    const [[budget]] = await pool.query(`
      SELECT b.*, c.name as category_name, c.icon as category_icon
      FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.id = ?
    `, [result.insertId]);
    res.status(201).json(budget);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Budget already exists for this category/month' });
    }
    throw e;
  }
});

app.get('/api/budgets/status', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const monthStart = month + '-01';
  const monthEnd = month + '-31';

  const [budgets] = await pool.query(`
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.month = ?
    ORDER BY b.category_id IS NULL DESC, b.category_id
  `, [month]);

  const [[{ total: totalSpent }]] = await pool.query(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
  `, [monthStart, monthEnd]);

  const [categorySpending] = await pool.query(`
    SELECT t.category_id, COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
  `, [monthStart, monthEnd]);

  const spendingMap = {};
  for (const row of categorySpending) {
    spendingMap[row.category_id] = row.total;
  }

  const result = budgets.map(b => {
    const spent = b.category_id ? (spendingMap[b.category_id] || 0) : totalSpent;
    const remaining = b.amount - spent;
    const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    return { ...b, spent, remaining, pct };
  });

  res.json({ month, total_spent: totalSpent, budgets: result });
});

app.put('/api/budgets/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM budgets WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { amount } = req.body;
  await pool.query('UPDATE budgets SET amount = ? WHERE id = ?', [amount || old.amount, req.params.id]);
  const [[budget]] = await pool.query(`
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.id = ?
  `, [req.params.id]);
  res.json(budget);
});

app.delete('/api/budgets/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM budgets WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── CSV Export ───────────────────────────────────────────────────────────────

app.get('/api/export', async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const [rows] = await pool.query(`
    SELECT t.id, t.date, t.amount, t.description,
      sa.name as source_account, da.name as dest_account,
      c.name as category, sc.name as subcategory,
      t.note, t.tags, t.created_at
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id
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
    if (amt > 0.005) {
      transfers.push({ from: debtors[di].id, to: creditors[ci].id, amount: Math.round(amt) });
    }
    creditors[ci].amount -= amt;
    debtors[di].amount -= amt;
    if (creditors[ci].amount < 0.005) ci++;
    if (debtors[di].amount < 0.005) di++;
  }

  return { net, transfers };
}

app.get('/api/trips', async (req, res) => {
  const [trips] = await pool.query('SELECT * FROM trips ORDER BY start_date DESC, id DESC');
  res.json(trips);
});

app.post('/api/trips', async (req, res) => {
  const { name, destination, start_date, end_date, budget, currency, created_by } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const [result] = await pool.query(
    'INSERT INTO trips (name, destination, start_date, end_date, budget, currency, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, destination || null, start_date || null, end_date || null, budget || 0, currency || 'TWD', created_by || null]
  );
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [result.insertId]);
  res.status(201).json(trip);
});

app.get('/api/trips/:id', async (req, res) => {
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  const [members] = await pool.query('SELECT * FROM trip_members WHERE trip_id = ? ORDER BY id', [req.params.id]);
  const [expenses] = await pool.query(`
    SELECT te.*, tm.name as paid_by_name
    FROM trip_expenses te
    LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.trip_id = ?
    ORDER BY te.date DESC, te.id DESC
  `, [req.params.id]);
  res.json({ ...trip, members, expenses });
});

app.put('/api/trips/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { name, destination, start_date, end_date, budget, currency } = req.body;
  await pool.query('UPDATE trips SET name=?, destination=?, start_date=?, end_date=?, budget=?, currency=? WHERE id=?',
    [name || old.name, destination ?? old.destination, start_date ?? old.start_date,
     end_date ?? old.end_date, budget ?? old.budget, currency || old.currency, req.params.id]);
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  res.json(trip);
});

app.delete('/api/trips/:id', async (req, res) => {
  const [result] = await pool.query('DELETE FROM trips WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/trips/:id/members', async (req, res) => {
  const [[trip]] = await pool.query('SELECT id FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const { name, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  let joinCode;
  let attempts = 0;
  do {
    joinCode = generateJoinCode();
    const [[dup]] = await pool.query('SELECT id FROM trip_members WHERE join_code = ?', [joinCode]);
    if (!dup) break;
    attempts++;
  } while (attempts < 10);

  const [result] = await pool.query(
    'INSERT INTO trip_members (trip_id, name, email, join_code) VALUES (?, ?, ?, ?)',
    [req.params.id, name, email || null, joinCode]
  );
  const [[member]] = await pool.query('SELECT * FROM trip_members WHERE id = ?', [result.insertId]);
  res.status(201).json(member);
});

app.delete('/api/trips/:id/members/:mid', async (req, res) => {
  const [[{ c: hasExpenses }]] = await pool.query(
    'SELECT COUNT(*) as c FROM trip_expenses WHERE trip_id = ? AND paid_by = ?',
    [req.params.id, req.params.mid]
  );
  if (hasExpenses > 0) {
    return res.status(409).json({ error: '此成員有費用記錄，無法移除' });
  }
  const [result] = await pool.query('DELETE FROM trip_members WHERE id = ? AND trip_id = ?', [req.params.mid, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.post('/api/trips/join', async (req, res) => {
  const { join_code } = req.body;
  if (!join_code) return res.status(400).json({ error: 'join_code is required' });
  const [[member]] = await pool.query('SELECT * FROM trip_members WHERE join_code = ?', [join_code.toUpperCase()]);
  if (!member) return res.status(404).json({ error: '邀請碼無效' });
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [member.trip_id]);
  res.json({ member, trip });
});

app.post('/api/trips/:id/expenses', async (req, res) => {
  const [[trip]] = await pool.query('SELECT id FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const { paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits } = req.body;
  if (!paid_by || !amount || !date) {
    return res.status(400).json({ error: 'paid_by, amount, date are required' });
  }
  const [result] = await pool.query(`
    INSERT INTO trip_expenses (trip_id, paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [req.params.id, paid_by, amount, currency || 'TWD', exchange_rate || 1,
    category_id || null, description || null, date, split_type || 'equal',
    splits ? JSON.stringify(splits) : null]);
  const [[exp]] = await pool.query(`
    SELECT te.*, tm.name as paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.id = ?
  `, [result.insertId]);
  res.status(201).json(exp);
});

app.put('/api/trips/:id/expenses/:eid', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM trip_expenses WHERE id = ? AND trip_id = ?', [req.params.eid, req.params.id]);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { paid_by, amount, currency, exchange_rate, category_id, description, date, split_type, splits } = req.body;
  await pool.query(`
    UPDATE trip_expenses SET paid_by=?, amount=?, currency=?, exchange_rate=?, category_id=?,
      description=?, date=?, split_type=?, splits=? WHERE id=?
  `, [
    paid_by ?? old.paid_by, amount ?? old.amount, currency || old.currency,
    exchange_rate ?? old.exchange_rate, category_id ?? old.category_id,
    description ?? old.description, date || old.date, split_type || old.split_type,
    splits !== undefined ? JSON.stringify(splits) : old.splits,
    req.params.eid
  ]);
  const [[exp]] = await pool.query(`
    SELECT te.*, tm.name as paid_by_name
    FROM trip_expenses te LEFT JOIN trip_members tm ON te.paid_by = tm.id
    WHERE te.id = ?
  `, [req.params.eid]);
  res.json(exp);
});

app.delete('/api/trips/:id/expenses/:eid', async (req, res) => {
  const [result] = await pool.query('DELETE FROM trip_expenses WHERE id = ? AND trip_id = ?', [req.params.eid, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

app.get('/api/trips/:id/settlement', async (req, res) => {
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Not found' });
  const [members] = await pool.query('SELECT * FROM trip_members WHERE trip_id = ? ORDER BY id', [req.params.id]);
  const [expenses] = await pool.query('SELECT * FROM trip_expenses WHERE trip_id = ?', [req.params.id]);
  const { net, transfers } = computeSettlement(members, expenses);
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });
  res.json({
    summary: members.map(m => ({
      id: m.id, name: m.name,
      total_paid: expenses.filter(e => e.paid_by === m.id).reduce((s, e) => s + e.amount * (e.exchange_rate || 1), 0),
      net_balance: Math.round((net[m.id] || 0) * 100) / 100,
    })),
    transfers: transfers.map(t => ({
      from_id: t.from, from_name: memberMap[t.from]?.name || '?',
      to_id: t.to, to_name: memberMap[t.to]?.name || '?',
      amount: t.amount,
    })),
  });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await initSchema();
  await seedCategories();
  await seedAccounts();
  app.listen(PORT, () => {
    console.log(`Expense Tracker running at http://localhost:${PORT} (MySQL)`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
