'use strict';
/**
 * One-time migration: SQLite (data/expenses.db) → MySQL (expense_tracker)
 *
 * Run on the VM after MySQL is ready:
 *   node scripts/migrate-sqlite-to-mysql.js
 *
 * Requires:
 *   - .env with MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *   - better-sqlite3 installed (npm install better-sqlite3 --no-save)
 *   - SQLite file at data/expenses.db (or SQLITE_PATH env var)
 */
require('dotenv').config();

const path = require('path');
const mysql = require('mysql2/promise');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('better-sqlite3 not installed. Run: npm install better-sqlite3 --no-save');
  process.exit(1);
}

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'expenses.db');

async function main() {
  // ── Open SQLite ──────────────────────────────────────────────────────────────
  let sqlite;
  try {
    sqlite = new Database(SQLITE_PATH, { readonly: true });
  } catch (e) {
    console.error(`Cannot open SQLite at ${SQLITE_PATH}:`, e.message);
    process.exit(1);
  }
  console.log(`SQLite opened: ${SQLITE_PATH}`);

  // ── Open MySQL ───────────────────────────────────────────────────────────────
  const conn = await mysql.createConnection({
    host:     process.env.MYSQL_HOST     || 'localhost',
    port:     Number(process.env.MYSQL_PORT) || 3306,
    user:     process.env.MYSQL_USER     || 'app_user',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'expense_tracker',
    timezone: '+00:00',
    multipleStatements: false,
  });
  console.log('MySQL connected');

  try {
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

    // ── Migrate each table ───────────────────────────────────────────────────

    await migrateCategories(sqlite, conn);
    await migrateSubcategories(sqlite, conn);
    await migrateAccounts(sqlite, conn);
    await migrateTransactions(sqlite, conn);
    await migrateBudgets(sqlite, conn);
    await migrateTrips(sqlite, conn);
    await migrateTripMembers(sqlite, conn);
    await migrateTripExpenses(sqlite, conn);
    await migrateRecurring(sqlite, conn);

    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');

    // ── Verification ────────────────────────────────────────────────────────
    console.log('\n── Row count verification ──────────────────────────');
    const tables = [
      'categories', 'subcategories', 'accounts', 'transactions',
      'budgets', 'trips', 'trip_members', 'trip_expenses', 'recurring',
    ];
    for (const t of tables) {
      const srcCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()?.n ?? 'N/A (table missing)';
      const [[{ n: dstCount }]] = await conn.execute(`SELECT COUNT(*) AS n FROM ${t}`);
      const ok = srcCount === dstCount ? '✓' : '✗ MISMATCH';
      console.log(`  ${t.padEnd(20)} SQLite=${srcCount}  MySQL=${dstCount}  ${ok}`);
    }

    console.log('\nMigration complete.');
  } finally {
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await conn.end();
    sqlite.close();
  }
}

// ── Table migrators ───────────────────────────────────────────────────────────

async function migrateCategories(sqlite, conn) {
  const rows = sqlite.prepare('SELECT id, name, icon FROM categories').all();
  if (!rows.length) { console.log('categories: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      'INSERT IGNORE INTO categories (id, name, icon) VALUES (?, ?, ?)',
      [r.id, r.name, r.icon ?? null],
    );
    inserted += res.affectedRows;
  }
  console.log(`categories: ${rows.length} read, ${inserted} inserted`);
}

async function migrateSubcategories(sqlite, conn) {
  const rows = sqlite.prepare('SELECT id, category_id, name FROM subcategories').all();
  if (!rows.length) { console.log('subcategories: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      'INSERT IGNORE INTO subcategories (id, category_id, name) VALUES (?, ?, ?)',
      [r.id, r.category_id, r.name],
    );
    inserted += res.affectedRows;
  }
  console.log(`subcategories: ${rows.length} read, ${inserted} inserted`);
}

async function migrateAccounts(sqlite, conn) {
  const rows = sqlite.prepare(
    'SELECT id, name, type, icon, currency, initial_balance, created_at FROM accounts'
  ).all();
  if (!rows.length) { console.log('accounts: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO accounts (id, name, type, icon, currency, initial_balance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.name, r.type, r.icon ?? '💰', r.currency ?? 'TWD',
       r.initial_balance ?? 0, normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`accounts: ${rows.length} read, ${inserted} inserted`);
}

async function migrateTransactions(sqlite, conn) {
  const rows = sqlite.prepare(
    `SELECT id, description, date, amount,
            source_account_id, dest_account_id,
            category_id, subcategory_id, note, tags, created_at
     FROM transactions`
  ).all();
  if (!rows.length) { console.log('transactions: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO transactions
         (id, description, date, amount, source_account_id, dest_account_id,
          category_id, subcategory_id, note, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.description ?? null, r.date, r.amount,
       r.source_account_id, r.dest_account_id,
       r.category_id ?? null, r.subcategory_id ?? null,
       r.note ?? null, r.tags ?? null, normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`transactions: ${rows.length} read, ${inserted} inserted`);
}

async function migrateBudgets(sqlite, conn) {
  // Table may not exist in older SQLite DBs
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='budgets'"
  ).get();
  if (!exists) { console.log('budgets: table not found in SQLite, skipping'); return; }

  const rows = sqlite.prepare('SELECT id, category_id, amount, month, created_at FROM budgets').all();
  if (!rows.length) { console.log('budgets: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      'INSERT IGNORE INTO budgets (id, category_id, amount, month, created_at) VALUES (?, ?, ?, ?, ?)',
      [r.id, r.category_id ?? null, r.amount, r.month, normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`budgets: ${rows.length} read, ${inserted} inserted`);
}

async function migrateTrips(sqlite, conn) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trips'"
  ).get();
  if (!exists) { console.log('trips: table not found in SQLite, skipping'); return; }

  const rows = sqlite.prepare(
    'SELECT id, name, destination, start_date, end_date, budget, currency, created_by, created_at FROM trips'
  ).all();
  if (!rows.length) { console.log('trips: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO trips
         (id, name, destination, start_date, end_date, budget, currency, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.name, r.destination ?? null, r.start_date ?? null, r.end_date ?? null,
       r.budget ?? 0, r.currency ?? 'TWD', r.created_by ?? null, normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`trips: ${rows.length} read, ${inserted} inserted`);
}

async function migrateTripMembers(sqlite, conn) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trip_members'"
  ).get();
  if (!exists) { console.log('trip_members: table not found in SQLite, skipping'); return; }

  const rows = sqlite.prepare(
    'SELECT id, trip_id, name, email, join_code FROM trip_members'
  ).all();
  if (!rows.length) { console.log('trip_members: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      'INSERT IGNORE INTO trip_members (id, trip_id, name, email, join_code) VALUES (?, ?, ?, ?, ?)',
      [r.id, r.trip_id, r.name, r.email ?? null, r.join_code],
    );
    inserted += res.affectedRows;
  }
  console.log(`trip_members: ${rows.length} read, ${inserted} inserted`);
}

async function migrateTripExpenses(sqlite, conn) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trip_expenses'"
  ).get();
  if (!exists) { console.log('trip_expenses: table not found in SQLite, skipping'); return; }

  const rows = sqlite.prepare(
    `SELECT id, trip_id, paid_by, amount, currency, exchange_rate,
            category_id, description, date, split_type, splits, created_at
     FROM trip_expenses`
  ).all();
  if (!rows.length) { console.log('trip_expenses: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO trip_expenses
         (id, trip_id, paid_by, amount, currency, exchange_rate,
          category_id, description, date, split_type, splits, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.trip_id, r.paid_by, r.amount, r.currency ?? 'TWD', r.exchange_rate ?? 1,
       r.category_id ?? null, r.description ?? null, r.date,
       r.split_type ?? 'equal', r.splits ?? null, normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`trip_expenses: ${rows.length} read, ${inserted} inserted`);
}

async function migrateRecurring(sqlite, conn) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='recurring'"
  ).get();
  if (!exists) { console.log('recurring: table not found in SQLite, skipping'); return; }

  const rows = sqlite.prepare(
    `SELECT id, title, amount, source_account_id, dest_account_id,
            category_id, repeat_freq, next_date, active, created_at
     FROM recurring`
  ).all();
  if (!rows.length) { console.log('recurring: 0 rows, skipping'); return; }
  let inserted = 0;
  for (const r of rows) {
    const [res] = await conn.execute(
      `INSERT IGNORE INTO recurring
         (id, title, amount, source_account_id, dest_account_id,
          category_id, repeat_freq, next_date, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.title, r.amount, r.source_account_id, r.dest_account_id,
       r.category_id ?? null, r.repeat_freq, r.next_date, r.active ?? 1,
       normalizeTs(r.created_at)],
    );
    inserted += res.affectedRows;
  }
  console.log(`recurring: ${rows.length} read, ${inserted} inserted`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * SQLite stores timestamps as "YYYY-MM-DD HH:MM:SS" or ISO strings.
 * MySQL DATETIME accepts that format directly, but null is fine too.
 */
function normalizeTs(v) {
  if (!v) return null;
  // Already "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS..." — MySQL handles both
  return String(v).replace('T', ' ').replace(/\.\d+Z?$/, '').slice(0, 19);
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
