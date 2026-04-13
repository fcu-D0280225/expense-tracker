const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, '../data/expenses.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT
  );

  CREATE TABLE IF NOT EXISTS subcategories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name        TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(category_id, name)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK(type IN ('asset','expense','revenue','liabilities')),
    icon            TEXT DEFAULT '💰',
    currency        TEXT DEFAULT 'TWD',
    initial_balance REAL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    description       TEXT,
    date              TEXT NOT NULL,
    amount            REAL NOT NULL,
    source_account_id INTEGER NOT NULL,
    dest_account_id   INTEGER NOT NULL,
    category_id       INTEGER,
    subcategory_id    INTEGER,
    note              TEXT,
    tags              TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (source_account_id) REFERENCES accounts(id),
    FOREIGN KEY (dest_account_id) REFERENCES accounts(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    amount      REAL NOT NULL,
    month       TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    UNIQUE(category_id, month)
  );

  CREATE TABLE IF NOT EXISTS recurring (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    amount            REAL NOT NULL,
    source_account_id INTEGER NOT NULL,
    dest_account_id   INTEGER NOT NULL,
    category_id       INTEGER,
    repeat_freq       TEXT NOT NULL CHECK(repeat_freq IN ('daily','weekly','monthly','yearly')),
    next_date         TEXT NOT NULL,
    active            INTEGER DEFAULT 1,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (source_account_id) REFERENCES accounts(id),
    FOREIGN KEY (dest_account_id) REFERENCES accounts(id)
  );
`);

// ── Seed default categories ─────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { name: '飲食', icon: '🍜', subs: ['早餐', '午餐', '晚餐', '飲料'] },
  { name: '交通', icon: '🚌', subs: ['大眾運輸', '計程車'] },
  { name: '購物', icon: '🛒', subs: ['日用品', '服飾', '3C'] },
  { name: '娛樂', icon: '🎮', subs: ['電影', '遊戲'] },
  { name: '醫療', icon: '🏥', subs: ['診所', '藥品'] },
  { name: '其他', icon: '📦', subs: [] },
];

const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, icon) VALUES (?, ?)');
const insertSub = db.prepare('INSERT OR IGNORE INTO subcategories (category_id, name) VALUES (?, ?)');
const getCatByName = db.prepare('SELECT id FROM categories WHERE name = ?');

db.transaction(() => {
  for (const cat of DEFAULT_CATEGORIES) {
    insertCat.run(cat.name, cat.icon);
    const row = getCatByName.get(cat.name);
    if (row) {
      for (const sub of cat.subs) {
        insertSub.run(row.id, sub);
      }
    }
  }
})();

// ── Seed default accounts ───────────────────────────────────────────────────

const DEFAULT_ACCOUNTS = [
  // Asset accounts
  { name: '現金', type: 'asset', icon: '💵' },
  { name: '銀行帳戶', type: 'asset', icon: '🏦' },
  // Liability accounts
  { name: '信用卡', type: 'liabilities', icon: '💳' },
  // Revenue accounts
  { name: '薪資', type: 'revenue', icon: '💼' },
  { name: '其他收入', type: 'revenue', icon: '💰' },
  // Expense accounts (one per category)
  { name: '飲食', type: 'expense', icon: '🍜' },
  { name: '交通', type: 'expense', icon: '🚌' },
  { name: '購物', type: 'expense', icon: '🛒' },
  { name: '娛樂', type: 'expense', icon: '🎮' },
  { name: '醫療', type: 'expense', icon: '🏥' },
  { name: '其他支出', type: 'expense', icon: '📦' },
];

const insertAccount = db.prepare('INSERT OR IGNORE INTO accounts (name, type, icon) VALUES (?, ?, ?)');

// Add UNIQUE constraint check — use a workaround since we can't use INSERT OR IGNORE without UNIQUE
const getAccountByNameType = db.prepare('SELECT id FROM accounts WHERE name = ? AND type = ?');

db.transaction(() => {
  for (const acc of DEFAULT_ACCOUNTS) {
    if (!getAccountByNameType.get(acc.name, acc.type)) {
      insertAccount.run(acc.name, acc.type, acc.icon);
    }
  }
})();

// ── Migrate old expenses table if it exists ─────────────────────────────────

const hasExpensesTable = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='expenses'"
).get();

if (hasExpensesTable) {
  const cashAccount = db.prepare("SELECT id FROM accounts WHERE name = '現金' AND type = 'asset'").get();
  if (cashAccount) {
    const oldExpenses = db.prepare('SELECT * FROM expenses').all();
    if (oldExpenses.length > 0) {
      const insertTx = db.prepare(`
        INSERT INTO transactions (description, date, amount, source_account_id, dest_account_id, category_id, note, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Build a lookup: category name → expense-type account (create if needed)
      const getExpenseAccount = db.prepare("SELECT id FROM accounts WHERE name = ? AND type = 'expense'");
      const insertExpenseAccount = db.prepare("INSERT INTO accounts (name, type, icon) VALUES (?, 'expense', ?)");

      db.transaction(() => {
        for (const exp of oldExpenses) {
          // Find or create expense-type account matching the category
          let destAccount = getExpenseAccount.get(exp.category);
          if (!destAccount) {
            const catRow = getCatByName.get(exp.category);
            const icon = catRow ? (db.prepare('SELECT icon FROM categories WHERE id = ?').get(catRow.id)?.icon || '📦') : '📦';
            insertExpenseAccount.run(exp.category, icon);
            destAccount = getExpenseAccount.get(exp.category);
          }

          const catRow = getCatByName.get(exp.category);
          const desc = exp.subcategory ? `${exp.category}/${exp.subcategory}` : exp.category;

          insertTx.run(
            desc,
            exp.date,
            exp.amount,
            cashAccount.id,
            destAccount.id,
            catRow ? catRow.id : null,
            exp.note || null,
            exp.tags || null,
            exp.created_at
          );
        }
      })();
    }
  }
  db.exec('DROP TABLE expenses');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeAccountBalance(accountId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return 0;

  const initial = account.initial_balance || 0;
  // Money leaving this account (as source)
  const outflow = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE source_account_id = ?'
  ).get(accountId).total;
  // Money entering this account (as dest)
  const inflow = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE dest_account_id = ?'
  ).get(accountId).total;

  // For asset accounts: balance = initial + inflow - outflow
  // For liability accounts: balance = initial + inflow - outflow (positive = owed)
  // For expense accounts: balance = outflow - inflow (total spent)
  // For revenue accounts: balance = inflow - outflow (total earned)
  if (account.type === 'asset' || account.type === 'liabilities') {
    return initial + inflow - outflow;
  }
  return inflow - outflow; // expense/revenue
}

function enrichAccount(account) {
  return { ...account, balance: computeAccountBalance(account.id) };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Categories API ───────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const subs = db.prepare('SELECT * FROM subcategories ORDER BY id').all();
  const result = cats.map(c => ({
    ...c,
    subcategories: subs.filter(s => s.category_id === c.id),
  }));
  res.json(result);
});

app.post('/api/categories', (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = db.prepare('INSERT INTO categories (name, icon) VALUES (?, ?)').run(name, icon || '📦');
    res.status(201).json({ id: result.lastInsertRowid, name, icon: icon || '📦' });
  } catch (e) {
    res.status(409).json({ error: 'Category already exists' });
  }
});

app.put('/api/categories/:id', (req, res) => {
  const { name, icon } = req.body;
  const old = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?')
    .run(name || old.name, icon !== undefined ? icon : old.icon, req.params.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

app.delete('/api/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM subcategories WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  })();
  res.json({ deleted: true });
});

app.post('/api/categories/:catId/subcategories', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  try {
    const result = db.prepare('INSERT INTO subcategories (category_id, name) VALUES (?, ?)').run(req.params.catId, name);
    res.status(201).json({ id: result.lastInsertRowid, category_id: Number(req.params.catId), name });
  } catch (e) {
    res.status(409).json({ error: 'Subcategory already exists in this category' });
  }
});

app.delete('/api/subcategories/:id', (req, res) => {
  const result = db.prepare('DELETE FROM subcategories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Accounts API ─────────────────────────────────────────────────────────────

app.get('/api/accounts', (req, res) => {
  const { type } = req.query;
  let accounts;
  if (type) {
    accounts = db.prepare('SELECT * FROM accounts WHERE type = ? ORDER BY id').all(type);
  } else {
    accounts = db.prepare('SELECT * FROM accounts ORDER BY type, id').all();
  }
  res.json(accounts.map(enrichAccount));
});

app.post('/api/accounts', (req, res) => {
  const { name, type, icon, currency, initial_balance } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
  const validTypes = ['asset', 'expense', 'revenue', 'liabilities'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

  const result = db.prepare(
    'INSERT INTO accounts (name, type, icon, currency, initial_balance) VALUES (?, ?, ?, ?, ?)'
  ).run(name, type, icon || '💰', currency || 'TWD', initial_balance || 0);

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(enrichAccount(account));
});

app.put('/api/accounts/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });

  const { name, icon, currency, initial_balance } = req.body;
  db.prepare('UPDATE accounts SET name=?, icon=?, currency=?, initial_balance=? WHERE id=?')
    .run(
      name || old.name,
      icon !== undefined ? icon : old.icon,
      currency || old.currency,
      initial_balance !== undefined ? initial_balance : old.initial_balance,
      req.params.id
    );

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  res.json(enrichAccount(account));
});

app.delete('/api/accounts/:id', (req, res) => {
  const txCount = db.prepare(
    'SELECT COUNT(*) as c FROM transactions WHERE source_account_id = ? OR dest_account_id = ?'
  ).get(req.params.id, req.params.id).c;
  if (txCount > 0) {
    return res.status(409).json({ error: 'Cannot delete account with existing transactions' });
  }
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Transactions API ─────────────────────────────────────────────────────────

app.get('/api/transactions', (req, res) => {
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

  res.json(db.prepare(query).all(...params));
});

// Search trend: group transactions by month for a given keyword
app.get('/api/transactions/trend', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q parameter is required' });

  const rows = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month,
      SUM(t.amount) as total,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN accounts sa ON t.source_account_id = sa.id
    LEFT JOIN accounts da ON t.dest_account_id = da.id
    WHERE (t.description LIKE ? OR t.note LIKE ?)
      AND sa.type = 'asset' AND da.type = 'expense'
    GROUP BY month
    ORDER BY month
  `).all(`%${q}%`, `%${q}%`);

  res.json(rows);
});

app.post('/api/transactions', (req, res) => {
  const { description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags } = req.body;
  if (!date || !amount || !source_account_id || !dest_account_id) {
    return res.status(400).json({ error: 'date, amount, source_account_id, dest_account_id are required' });
  }

  const result = db.prepare(`
    INSERT INTO transactions (description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(description || null, date, amount, source_account_id, dest_account_id, category_id || null, subcategory_id || null, note || null, tags || null);

  const tx = db.prepare(`
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
  `).get(result.lastInsertRowid);

  res.status(201).json(tx);
});

app.put('/api/transactions/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { description, date, amount, source_account_id, dest_account_id, category_id, subcategory_id, note, tags } = req.body;
  db.prepare(`
    UPDATE transactions
    SET description=?, date=?, amount=?, source_account_id=?, dest_account_id=?,
        category_id=?, subcategory_id=?, note=?, tags=?
    WHERE id=?
  `).run(description || null, date, amount, source_account_id, dest_account_id,
    category_id || null, subcategory_id || null, note || null, tags || null, req.params.id);

  const tx = db.prepare(`
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
  `).get(req.params.id);

  res.json(tx);
});

app.delete('/api/transactions/:id', (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Recurring API ────────────────────────────────────────────────────────────

app.get('/api/recurring', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*,
      sa.name as source_name, sa.icon as source_icon,
      da.name as dest_name, da.icon as dest_icon,
      c.name as category_name
    FROM recurring r
    LEFT JOIN accounts sa ON r.source_account_id = sa.id
    LEFT JOIN accounts da ON r.dest_account_id = da.id
    LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.next_date
  `).all();
  res.json(rows);
});

app.post('/api/recurring', (req, res) => {
  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date } = req.body;
  if (!title || !amount || !source_account_id || !dest_account_id || !repeat_freq || !next_date) {
    return res.status(400).json({ error: 'title, amount, source/dest accounts, repeat_freq, next_date are required' });
  }

  const result = db.prepare(`
    INSERT INTO recurring (title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, amount, source_account_id, dest_account_id, category_id || null, repeat_freq, next_date);

  res.status(201).json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/recurring/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM recurring WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });

  const { title, amount, source_account_id, dest_account_id, category_id, repeat_freq, next_date, active } = req.body;
  db.prepare(`
    UPDATE recurring SET title=?, amount=?, source_account_id=?, dest_account_id=?,
      category_id=?, repeat_freq=?, next_date=?, active=? WHERE id=?
  `).run(
    title || old.title, amount || old.amount,
    source_account_id || old.source_account_id, dest_account_id || old.dest_account_id,
    category_id !== undefined ? category_id : old.category_id,
    repeat_freq || old.repeat_freq, next_date || old.next_date,
    active !== undefined ? active : old.active,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM recurring WHERE id = ?').get(req.params.id));
});

app.delete('/api/recurring/:id', (req, res) => {
  const result = db.prepare('DELETE FROM recurring WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// Process due recurring transactions
app.post('/api/recurring/process', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.prepare('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?').all(today);
  const created = [];

  db.transaction(() => {
    for (const r of due) {
      // Create the transaction
      db.prepare(`
        INSERT INTO transactions (description, date, amount, source_account_id, dest_account_id, category_id, note)
        VALUES (?, ?, ?, ?, ?, ?, '自動建立：重複交易')
      `).run(r.title, r.next_date, r.amount, r.source_account_id, r.dest_account_id, r.category_id);

      // Advance next_date
      const d = new Date(r.next_date);
      switch (r.repeat_freq) {
        case 'daily': d.setDate(d.getDate() + 1); break;
        case 'weekly': d.setDate(d.getDate() + 7); break;
        case 'monthly': d.setMonth(d.getMonth() + 1); break;
        case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
      }
      const nextDate = d.toISOString().slice(0, 10);
      db.prepare('UPDATE recurring SET next_date = ? WHERE id = ?').run(nextDate, r.id);
      created.push({ recurring_id: r.id, title: r.title, date: r.next_date });
    }
  })();

  res.json({ processed: created.length, transactions: created });
});

// ── Reports API ──────────────────────────────────────────────────────────────

// Monthly summary: income vs expense per month
app.get('/api/reports/monthly', (req, res) => {
  const months = parseInt(req.query.months) || 6;
  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', t.date) as month,
      SUM(CASE WHEN sa.type = 'revenue' AND da.type = 'asset' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN sa.type = 'asset' AND da.type = 'expense' THEN t.amount ELSE 0 END) as expense
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).all(months);
  res.json(rows.reverse());
});

// Category breakdown for a period
app.get('/api/reports/category', (req, res) => {
  const { from, to } = req.query;
  let query = `
    SELECT c.name, c.icon, SUM(t.amount) as total, COUNT(*) as count
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
  `;
  const params = [];
  if (from) { query += ' AND t.date >= ?'; params.push(from); }
  if (to)   { query += ' AND t.date <= ?'; params.push(to); }
  query += ' GROUP BY t.category_id ORDER BY total DESC';
  res.json(db.prepare(query).all(...params));
});

// Net worth over time (monthly snapshots of asset - liability balances)
app.get('/api/reports/networth', (req, res) => {
  const months = parseInt(req.query.months) || 12;
  // Get all asset and liability accounts
  const accounts = db.prepare("SELECT * FROM accounts WHERE type IN ('asset', 'liabilities')").all();

  // Calculate cumulative balance at end of each month
  const rows = db.prepare(`
    SELECT DISTINCT strftime('%Y-%m', date) as month FROM transactions ORDER BY month
  `).all();

  // Take last N months
  const recentMonths = rows.slice(-months);
  const result = recentMonths.map(({ month }) => {
    const endDate = month + '-31'; // Last possible day
    let assets = 0;
    let liabilities = 0;

    for (const acc of accounts) {
      const initial = acc.initial_balance || 0;
      const inflow = db.prepare(
        'SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE dest_account_id = ? AND date <= ?'
      ).get(acc.id, endDate).t;
      const outflow = db.prepare(
        'SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE source_account_id = ? AND date <= ?'
      ).get(acc.id, endDate).t;
      const balance = initial + inflow - outflow;

      if (acc.type === 'asset') assets += balance;
      else liabilities += balance;
    }

    return { month, assets, liabilities, net_worth: assets - liabilities };
  });

  res.json(result);
});

// ── Budgets API ─────────────────────────────────────────────────────────────

app.get('/api/budgets', (req, res) => {
  const { month } = req.query;
  let query = `
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b
    LEFT JOIN categories c ON b.category_id = c.id
  `;
  const params = [];
  if (month) { query += ' WHERE b.month = ?'; params.push(month); }
  query += ' ORDER BY b.category_id IS NULL DESC, b.category_id';
  res.json(db.prepare(query).all(...params));
});

app.post('/api/budgets', (req, res) => {
  const { category_id, amount, month } = req.body;
  if (!amount || !month) return res.status(400).json({ error: 'amount and month are required' });
  try {
    const result = db.prepare(
      'INSERT INTO budgets (category_id, amount, month) VALUES (?, ?, ?)'
    ).run(category_id || null, amount, month);
    const budget = db.prepare(`
      SELECT b.*, c.name as category_name, c.icon as category_icon
      FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
      WHERE b.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(budget);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Budget already exists for this category/month' });
    }
    throw e;
  }
});

// Budget status must be before :id routes
app.get('/api/budgets/status', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const monthStart = month + '-01';
  const monthEnd = month + '-31';

  // Get all budgets for this month
  const budgets = db.prepare(`
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.month = ?
    ORDER BY b.category_id IS NULL DESC, b.category_id
  `).all(month);

  // Get actual spending for this month
  const totalSpent = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
  `).get(monthStart, monthEnd).total;

  // Get spending by category
  const categorySpending = db.prepare(`
    SELECT t.category_id, COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN accounts sa ON t.source_account_id = sa.id
    JOIN accounts da ON t.dest_account_id = da.id
    WHERE sa.type = 'asset' AND da.type = 'expense'
      AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id
  `).all(monthStart, monthEnd);

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

app.put('/api/budgets/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const { amount } = req.body;
  db.prepare('UPDATE budgets SET amount = ? WHERE id = ?').run(amount || old.amount, req.params.id);
  const budget = db.prepare(`
    SELECT b.*, c.name as category_name, c.icon as category_icon
    FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.id = ?
  `).get(req.params.id);
  res.json(budget);
});

app.delete('/api/budgets/:id', (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── CSV Export (adapted for transactions) ────────────────────────────────────

app.get('/api/export', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const rows = db.prepare(`
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
  `).all(fromStr);

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

// ── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});
