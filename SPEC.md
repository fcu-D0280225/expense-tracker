# Expense Tracker — 專案規格

## 目標
輕量記帳 Web App，採用雙式記帳架構，資料存 MySQL，方便 AI 定期分析消費習慣。

## 架構概念（參考 Firefly III）
- **雙式記帳（Double-entry bookkeeping）**：每筆交易有「來源帳戶」→「目的帳戶」
- **帳戶類型**：asset（資產）、expense（支出）、revenue（收入）、liabilities（負債）
- **多帳戶管理**：現金、銀行帳戶、信用卡分開記錄
- **收入記錄**：薪資/兼職等收入來源，每月淨收支清楚呈現
- **重複交易**：設定每月固定支出（房租、訂閱費），到期自動提醒

## 功能需求

### 基本功能
- 新增交易：金額、來源帳戶、目的帳戶、分類、備註、日期
- 支援三種交易類型：支出（資產→支出）、收入（收入→資產）、轉帳（資產→資產）
- 瀏覽交易清單（依日期排序，支援篩選）
- 刪除 / 編輯交易
- 兩層分類管理（大分類 + 小分類）
- 帳戶管理（新增/刪除，即時餘額計算）
- 固定交易管理（新增/刪除/到期執行）

### 預設分類
- 飲食：早餐、午餐、晚餐、飲料
- 交通：大眾運輸、計程車
- 購物：日用品、服飾、3C
- 娛樂：電影、遊戲
- 醫療：診所、藥品
- 其他

### 預設帳戶
- 資產：現金、銀行帳戶
- 負債：信用卡
- 收入：薪資、其他收入

### 報表功能
- 月收支對比長條圖（近 6 個月）
- 支出分類圓餅圖（可選日期區間）
- 淨資產走勢折線圖（近 12 個月）

### AI 分析友善設計
- MySQL 資料庫，schema 簡單易讀
- 提供 `/api/export` 輸出近 N 天的交易 CSV（供 AI 讀取）
- 每筆交易附 `tags` 欄位（自由標籤，AI 可用來分群）

## 技術棧
- Backend：Node.js + Express + mysql2
- Frontend：原生 HTML/CSS/JS（PWA，可加入主畫面）
- DB：MySQL 8（database `expense_tracker`，schema 詳見 `SCHEMA.md`）

## Schema

```sql
CREATE TABLE categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT UNIQUE NOT NULL,
  icon  TEXT
);

CREATE TABLE subcategories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name        TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE(category_id, name)
);

CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('asset','expense','revenue','liabilities')),
  icon            TEXT DEFAULT '💰',
  currency        TEXT DEFAULT 'TWD',
  initial_balance REAL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE transactions (
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

CREATE TABLE recurring (
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
```

## API

### 帳戶
- `GET  /api/accounts` — 取得帳戶清單（含計算餘額），支援 ?type= 篩選
- `POST /api/accounts` — 新增帳戶
- `PUT  /api/accounts/:id` — 編輯帳戶
- `DELETE /api/accounts/:id` — 刪除帳戶（有交易關聯時拒絕）

### 交易
- `GET  /api/transactions` — 取得交易清單（支援 ?from=&to=&category_id=&account_id=&type=&limit=）
- `POST /api/transactions` — 新增交易
- `PUT  /api/transactions/:id` — 編輯交易
- `DELETE /api/transactions/:id` — 刪除交易

### 固定交易
- `GET  /api/recurring` — 取得固定交易清單
- `POST /api/recurring` — 新增固定交易
- `PUT  /api/recurring/:id` — 編輯固定交易
- `DELETE /api/recurring/:id` — 刪除固定交易
- `POST /api/recurring/process` — 執行所有到期的固定交易

### 報表
- `GET /api/reports/monthly?months=6` — 月收支對比
- `GET /api/reports/category?from=&to=` — 支出分類佔比
- `GET /api/reports/networth?months=12` — 淨資產走勢

### 分類
- `GET  /api/categories` — 取得類別清單（含子分類）
- `POST /api/categories` — 新增大分類
- `PUT  /api/categories/:id` — 編輯大分類
- `DELETE /api/categories/:id` — 刪除大分類（連帶刪除子分類）
- `POST /api/categories/:catId/subcategories` — 新增子分類
- `DELETE /api/subcategories/:id` — 刪除子分類

### 匯出
- `GET  /api/export?days=30` — 匯出交易 CSV 供 AI 分析

## 前端頁面（SPA，hash-based routing）
- `#transactions` — 記帳主頁（新增/編輯交易、篩選、清單）
- `#accounts` — 帳戶總覽（資產/負債/收入/支出帳戶、餘額、淨資產）
- `#recurring` — 固定交易管理
- `#reports` — 報表（月收支長條圖、分類圓餅圖、淨資產走勢）
