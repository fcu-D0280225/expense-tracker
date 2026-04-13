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

  CREATE TABLE IF NOT EXISTS expenses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    amount        REAL NOT NULL,
    category      TEXT NOT NULL,
    subcategory   TEXT,
    note          TEXT,
    tags          TEXT,
    date          TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// Seed default two-tier categories
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

// Migrate: add subcategory column if missing (for existing DBs)
try {
  db.prepare("SELECT subcategory FROM expenses LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE expenses ADD COLUMN subcategory TEXT");
}

// Migrate old category names: 餐飲 → 飲食
db.prepare("UPDATE categories SET name = '飲食', icon = '🍜' WHERE name = '餐飲'").run();
db.prepare("UPDATE expenses SET category = '飲食' WHERE category = '餐飲'").run();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Categories API ───────────────────────────────────────────────────────────

// GET /api/categories — returns categories with nested subcategories
app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const subs = db.prepare('SELECT * FROM subcategories ORDER BY id').all();
  const result = cats.map(c => ({
    ...c,
    subcategories: subs.filter(s => s.category_id === c.id),
  }));
  res.json(result);
});

// POST /api/categories — create category
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

// PUT /api/categories/:id
app.put('/api/categories/:id', (req, res) => {
  const { name, icon } = req.body;
  const old = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });

  db.transaction(() => {
    db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?')
      .run(name || old.name, icon !== undefined ? icon : old.icon, req.params.id);
    if (name && name !== old.name) {
      db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(name, old.name);
    }
  })();

  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

// DELETE /api/categories/:id
app.delete('/api/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM subcategories WHERE category_id = ?').run(req.params.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  })();

  res.json({ deleted: true });
});

// ── Subcategories API ────────────────────────────────────────────────────────

// POST /api/categories/:catId/subcategories
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

// DELETE /api/subcategories/:id
app.delete('/api/subcategories/:id', (req, res) => {
  const result = db.prepare('DELETE FROM subcategories WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ── Expenses API ─────────────────────────────────────────────────────────────

// GET /api/expenses
app.get('/api/expenses', (req, res) => {
  const { from, to, category, subcategory } = req.query;
  let query = 'SELECT * FROM expenses WHERE 1=1';
  const params = [];

  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to)   { query += ' AND date <= ?'; params.push(to); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (subcategory) { query += ' AND subcategory = ?'; params.push(subcategory); }

  query += ' ORDER BY date DESC, created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// POST /api/expenses
app.post('/api/expenses', (req, res) => {
  const { amount, category, subcategory, note, tags, date } = req.body;
  if (!amount || !category || !date) {
    return res.status(400).json({ error: 'amount, category, date are required' });
  }
  const stmt = db.prepare(
    'INSERT INTO expenses (amount, category, subcategory, note, tags, date) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(amount, category, subcategory || null, note || null, tags || null, date);
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/expenses/:id
app.put('/api/expenses/:id', (req, res) => {
  const { amount, category, subcategory, note, tags, date } = req.body;
  const existing = db.prepare('SELECT id FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    'UPDATE expenses SET amount=?, category=?, subcategory=?, note=?, tags=?, date=? WHERE id=?'
  ).run(amount, category, subcategory || null, note || null, tags || null, date, req.params.id);

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

  const header = 'id,amount,category,subcategory,note,tags,date,created_at\n';
  const csv = header + rows.map(r =>
    [r.id, r.amount, `"${r.category}"`, `"${r.subcategory || ''}"`,
     `"${(r.note || '').replace(/"/g, '""')}"`,
     `"${(r.tags || '').replace(/"/g, '""')}"`, r.date, r.created_at].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${days}d.csv"`);
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});
