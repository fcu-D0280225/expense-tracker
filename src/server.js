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

// Schema setup
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    amount     REAL NOT NULL,
    category   TEXT NOT NULL,
    note       TEXT,
    tags       TEXT,
    date       TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    icon TEXT
  );

  INSERT OR IGNORE INTO categories (name, icon) VALUES
    ('餐飲', '🍜'),
    ('交通', '🚌'),
    ('娛樂', '🎮'),
    ('購物', '🛒'),
    ('其他', '📦');
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// GET /api/expenses
app.get('/api/expenses', (req, res) => {
  const { from, to, category } = req.query;
  let query = 'SELECT * FROM expenses WHERE 1=1';
  const params = [];

  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to)   { query += ' AND date <= ?'; params.push(to); }
  if (category) { query += ' AND category = ?'; params.push(category); }

  query += ' ORDER BY date DESC, created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// POST /api/expenses
app.post('/api/expenses', (req, res) => {
  const { amount, category, note, tags, date } = req.body;
  if (!amount || !category || !date) {
    return res.status(400).json({ error: 'amount, category, date are required' });
  }
  const stmt = db.prepare(
    'INSERT INTO expenses (amount, category, note, tags, date) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(amount, category, note || null, tags || null, date);
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/expenses/:id
app.put('/api/expenses/:id', (req, res) => {
  const { amount, category, note, tags, date } = req.body;
  const existing = db.prepare('SELECT id FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE expenses SET amount=?, category=?, note=?, tags=?, date=? WHERE id=?'
  ).run(amount, category, note || null, tags || null, date, req.params.id);

  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
});

// DELETE /api/expenses/:id
app.delete('/api/expenses/:id', (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// GET /api/export?days=30
app.get('/api/export', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const rows = db.prepare(
    'SELECT * FROM expenses WHERE date >= ? ORDER BY date DESC'
  ).all(fromStr);

  const header = 'id,amount,category,note,tags,date,created_at\n';
  const csv = header + rows.map(r =>
    [r.id, r.amount, `"${r.category}"`, `"${(r.note || '').replace(/"/g, '""')}"`,
     `"${(r.tags || '').replace(/"/g, '""')}"`, r.date, r.created_at].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${days}d.csv"`);
  res.send(csv);
});

// GET /api/categories
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY id').all());
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});
