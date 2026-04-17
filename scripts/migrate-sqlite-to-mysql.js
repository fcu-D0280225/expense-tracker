#!/usr/bin/env node
/**
 * One-time migration: SQLite (expenses.db) → MySQL (expense_tracker)
 *
 * Prerequisites:
 *   1. MySQL schema already created (run `node src/server.js` once, then stop it)
 *   2. `npm install better-sqlite3 --no-save`
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-mysql.js
 */

const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const path = require('path');

const SQLITE_PATH = path.join(__dirname, '../data/expenses.db');

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'app_user',
  password: process.env.MYSQL_PASSWORD || 'AppUser@2026!',
  database: process.env.MYSQL_DATABASE || 'expense_tracker',
  charset: 'utf8mb4',
};

// Tables in dependency order (parents before children)
const TABLES = [
  'categories',
  'subcategories',
  'accounts',
  'transactions',
  'budgets',
  'trips',
  'trip_members',
  'trip_expenses',
  'recurring',
];

async function migrate() {
  console.log(`Opening SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  console.log(`Connecting to MySQL: ${MYSQL_CONFIG.host}/${MYSQL_CONFIG.database}`);
  const pool = await mysql.createPool(MYSQL_CONFIG);

  // Check which tables exist in SQLite
  const sqliteTables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(r => r.name);
  console.log(`SQLite tables: ${sqliteTables.join(', ')}`);

  for (const table of TABLES) {
    if (!sqliteTables.includes(table)) {
      console.log(`  [skip] ${table} — not in SQLite`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`  [skip] ${table} — 0 rows`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const insertSQL = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    // Disable FK checks for bulk insert, re-enable after
    const conn = await pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      await conn.beginTransaction();

      let inserted = 0;
      for (const row of rows) {
        const values = columns.map(c => row[c] === undefined ? null : row[c]);
        try {
          await conn.query(insertSQL, values);
          inserted++;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') {
            // Skip duplicates (e.g. seed data already exists)
            continue;
          }
          throw e;
        }
      }

      await conn.commit();
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log(`  [done] ${table}: ${inserted}/${rows.length} rows migrated`);
    } catch (e) {
      await conn.rollback();
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      console.error(`  [FAIL] ${table}: ${e.message}`);
    } finally {
      conn.release();
    }
  }

  // Verify row counts
  console.log('\n── Verification ──');
  for (const table of TABLES) {
    if (!sqliteTables.includes(table)) continue;
    const sqliteCount = sqlite.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c;
    const [[{ c: mysqlCount }]] = await pool.query(`SELECT COUNT(*) as c FROM ${table}`);
    const status = sqliteCount === mysqlCount ? 'OK' : 'MISMATCH';
    console.log(`  ${table}: SQLite=${sqliteCount} MySQL=${mysqlCount} [${status}]`);
  }

  sqlite.close();
  await pool.end();
  console.log('\nMigration complete.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
