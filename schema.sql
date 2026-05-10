-- =============================================================================
-- Expense Tracker — Database Schema + Default Seed
--
-- 用途：在新環境快速建立資料庫結構與預設資料（分類 / 帳戶）
--
-- 使用方式：
--   1. 建立資料庫並設定字元集：
--        mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS expense_tracker
--          CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
--   2. Import schema 與 seed：
--        mysql -u root -p expense-tracker < schema.sql
--   3. 設定 .env 連線參數，啟動 server：
--        npm install && npm start
--
-- 注意：
--   - 所有 CREATE TABLE 皆為 IF NOT EXISTS，可重複執行
--   - 預設 seed 使用 INSERT IGNORE，不會覆蓋既有資料
--   - 與 src/server.js 的 initSchema() / seedData() 對齊（含 ALTER 後的欄位）
-- =============================================================================

USE expense_tracker;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

-- ── Schema ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  id   INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  icon VARCHAR(20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subcategories (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cat_name (category_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accounts (
  id              INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  type            ENUM('asset','expense','revenue','liabilities') NOT NULL,
  icon            VARCHAR(20) DEFAULT '💰',
  currency        VARCHAR(10) DEFAULT 'TWD',
  initial_balance DOUBLE DEFAULT 0,
  created_at      DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budgets (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  amount      DOUBLE NOT NULL,
  month       VARCHAR(7) NOT NULL,
  created_at  DATETIME DEFAULT NOW(),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  UNIQUE KEY uq_budget (category_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trips (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  destination VARCHAR(255),
  start_date  VARCHAR(10),
  end_date    VARCHAR(10),
  budget      DOUBLE DEFAULT 0,
  currency    VARCHAR(10) DEFAULT 'TWD',
  created_by  VARCHAR(255),
  share_token VARCHAR(32) NULL UNIQUE,
  created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_members (
  id        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trip_id   INT NOT NULL,
  name      VARCHAR(255) NOT NULL,
  email     VARCHAR(255),
  join_code VARCHAR(10) UNIQUE NOT NULL,
  user_id   INT NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_expenses (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trip_member_claims (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  member_id    INT NOT NULL,
  trip_id      INT NOT NULL,
  device_token VARCHAR(64) NOT NULL,
  claimed_at   DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_device_trip (device_token, trip_id),
  FOREIGN KEY (member_id) REFERENCES trip_members(id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id)   REFERENCES trips(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  google_sub VARCHAR(64) UNIQUE,
  email      VARCHAR(255),
  name       VARCHAR(255) NOT NULL,
  picture    VARCHAR(512),
  created_at DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Seed: 預設分類 + 子分類 ────────────────────────────────────────────────

INSERT IGNORE INTO categories (name, icon) VALUES
  ('飲食', '🍜'),
  ('交通', '🚌'),
  ('購物', '🛒'),
  ('娛樂', '🎮'),
  ('醫療', '🏥'),
  ('其他', '📦');

INSERT IGNORE INTO subcategories (category_id, name)
SELECT c.id, s.name FROM categories c JOIN (
  SELECT '飲食' AS cat, '早餐' AS name UNION ALL
  SELECT '飲食', '午餐' UNION ALL
  SELECT '飲食', '晚餐' UNION ALL
  SELECT '飲食', '飲料' UNION ALL
  SELECT '交通', '大眾運輸' UNION ALL
  SELECT '交通', '計程車' UNION ALL
  SELECT '購物', '日用品' UNION ALL
  SELECT '購物', '服飾' UNION ALL
  SELECT '購物', '3C' UNION ALL
  SELECT '娛樂', '電影' UNION ALL
  SELECT '娛樂', '遊戲' UNION ALL
  SELECT '醫療', '診所' UNION ALL
  SELECT '醫療', '藥品'
) s ON c.name = s.cat;

-- ── Seed: 預設帳戶 ────────────────────────────────────────────────────────
-- 注意：accounts 沒有 UNIQUE(name, type) 約束，因此用條件式插入避免重複
-- （若已有同名同類型帳戶會被 NOT EXISTS 過濾掉）

INSERT INTO accounts (name, type, icon)
SELECT * FROM (
  SELECT '現金' AS name,   'asset'       AS type, '💵' AS icon UNION ALL
  SELECT '銀行帳戶',       'asset',                '🏦' UNION ALL
  SELECT '信用卡',         'liabilities',          '💳' UNION ALL
  SELECT '薪資',           'revenue',              '💼' UNION ALL
  SELECT '其他收入',       'revenue',              '💰' UNION ALL
  SELECT '飲食',           'expense',              '🍜' UNION ALL
  SELECT '交通',           'expense',              '🚌' UNION ALL
  SELECT '購物',           'expense',              '🛒' UNION ALL
  SELECT '娛樂',           'expense',              '🎮' UNION ALL
  SELECT '醫療',           'expense',              '🏥' UNION ALL
  SELECT '其他支出',       'expense',              '📦'
) AS defaults
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.name = defaults.name AND a.type = defaults.type
);
