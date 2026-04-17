'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:     process.env.MYSQL_HOST     || 'localhost',
      port:     Number(process.env.MYSQL_PORT) || 3306,
      user:     process.env.MYSQL_USER     || 'app_user',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'expense_tracker',
      waitForConnections: true,
      connectionLimit: 10,
      timezone: '+00:00',
    });
  }
  return pool;
}

// Normalize MySQL duplicate-key error so existing catch checks still work
function normError(e) {
  if (e.code === 'ER_DUP_ENTRY') {
    const err = new Error(`UNIQUE constraint failed: ${e.sqlMessage}`);
    err.code = 'ER_DUP_ENTRY';
    return err;
  }
  return e;
}

async function query(sql, params = []) {
  try {
    const [rows] = await getPool().execute(sql, params);
    return rows;
  } catch (e) { throw normError(e); }
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function run(sql, params = []) {
  try {
    const [result] = await getPool().execute(sql, params);
    return { insertId: result.insertId, affectedRows: result.affectedRows };
  } catch (e) { throw normError(e); }
}

// Transaction helper — callback receives a tx object with query/get/run
async function transaction(fn) {
  const conn = await getPool().getConnection();
  await conn.beginTransaction();
  const tx = {
    async query(sql, params = []) {
      try { const [rows] = await conn.execute(sql, params); return rows; }
      catch (e) { throw normError(e); }
    },
    async get(sql, params = []) {
      const rows = await this.query(sql, params);
      return rows[0] ?? null;
    },
    async run(sql, params = []) {
      try {
        const [result] = await conn.execute(sql, params);
        return { insertId: result.insertId, affectedRows: result.affectedRows };
      } catch (e) { throw normError(e); }
    },
  };
  try {
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { query, get, run, transaction };
