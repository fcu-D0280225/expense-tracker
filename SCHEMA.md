# Expense Tracker — 資料庫 Schema 與建置指南

輕量級記帳系統（雙式記帳 + 旅遊分帳），Express + MySQL，前端為原生 HTML/JS PWA。

---

## 一、資料庫 Schema

- **資料庫**：MySQL（由 SQLite 遷移而來）
- **初始化**：啟動時自動執行 `initSchema()` + `seedCategories()` + `seedAccounts()`（`src/server.js:23-145`）
- **預設 database 名稱**：`expense_tracker`
- 所有 `CREATE TABLE IF NOT EXISTS`，重複啟動安全

### Table 總覽

| # | Table | 用途 |
|---|-------|------|
| 1 | `categories` | 大分類 |
| 2 | `subcategories` | 子分類 |
| 3 | `accounts` | 帳戶（資產 / 支出 / 收入 / 負債） |
| 4 | `transactions` | 交易（雙式記帳） |
| 5 | `budgets` | 預算 |
| 6 | `recurring` | 重複交易 |
| 7 | `trips` | 旅遊專案 |
| 8 | `trip_members` | 旅遊同行成員 |
| 9 | `trip_expenses` | 旅遊費用（支援分帳） |

### 1. categories
| 欄位 | 型別 |
|------|------|
| id | INT AUTO_INCREMENT PK |
| name | VARCHAR(255) UNIQUE NOT NULL |
| icon | VARCHAR(32) |

預設資料：飲食 🍜、交通 🚌、購物 🛒、娛樂 🎮、醫療 🏥、其他 📦

### 2. subcategories
`id / category_id FK CASCADE / name`
UNIQUE `(category_id, name)`

### 3. accounts
| 欄位 | 型別 |
|------|------|
| id | INT AUTO_INCREMENT PK |
| name | VARCHAR(255) NOT NULL |
| type | ENUM(`asset`,`expense`,`revenue`,`liabilities`) |
| icon | VARCHAR(32) default `💰` |
| currency | VARCHAR(16) default `TWD` |
| initial_balance | DOUBLE default 0 |
| created_at | DATETIME |

預設帳戶：現金、銀行帳戶、信用卡、薪資、其他收入、飲食/交通/購物/娛樂/醫療/其他支出

### 4. transactions
核心交易表（雙式記帳）：
| 欄位 | 型別 |
|------|------|
| id | INT PK |
| description | TEXT |
| date | VARCHAR(10) `YYYY-MM-DD` |
| amount | DOUBLE NOT NULL |
| source_account_id | INT FK → accounts |
| dest_account_id | INT FK → accounts |
| category_id | INT FK → categories |
| subcategory_id | INT |
| note | TEXT |
| tags | TEXT（供 AI 分析） |
| created_at | DATETIME |

三種交易型態：
- 支出：資產 → 支出
- 收入：收入 → 資產
- 轉帳：資產 → 資產

### 5. budgets
`id / category_id FK nullable / amount DOUBLE / month VARCHAR(7) YYYY-MM / created_at`
UNIQUE `(category_id, month)`，`category_id = NULL` 表示全局預算

### 6. recurring
`id / title / amount / source_account_id FK / dest_account_id FK / category_id / repeat_freq ENUM(daily,weekly,monthly,yearly) / next_date / active / created_at`

### 7. trips
`id / name / destination / start_date / end_date / budget / currency / created_by / created_at`

### 8. trip_members
`id / trip_id FK CASCADE / name / email / join_code VARCHAR(6) UNIQUE`
`join_code` 為 6 字元邀請碼（隨機產生）

### 9. trip_expenses
| 欄位 | 型別 |
|------|------|
| id | INT PK |
| trip_id | INT FK CASCADE |
| paid_by | INT FK → trip_members |
| amount | DOUBLE |
| currency | VARCHAR(16) default `TWD` |
| exchange_rate | DOUBLE default 1 |
| category_id | INT |
| description | TEXT |
| date | VARCHAR(10) |
| split_type | ENUM(`equal`,`custom`,`paid_by_one`) default `equal` |
| splits | TEXT（JSON，自訂分帳明細） |
| created_at | DATETIME |

---

## 二、建置與啟動

### 環境需求
- **Node.js**：14+（建議 LTS）
- **MySQL**：5.7 / 8.x
- **套件管理**：npm

### 依賴
- `express ^4.18.2`
- `mysql2 ^3.9.0`

### 環境變數（`.env`）

參考 `.env.example`：
```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=app_user
MYSQL_PASSWORD=AppUser@2026!
MYSQL_DATABASE=expense_tracker
PORT=3000
```

### 啟動流程

```bash
# 1. 安裝依賴
npm install

# 2. 複製並修改環境變數
cp .env.example .env

# 3. 確保 MySQL 已啟動且 database 可建立，然後啟動 server
npm start
# → 首次啟動自動建立 schema + seed
# → 輸出：Expense Tracker running at http://localhost:3000 (MySQL)
```

### 從舊 SQLite 遷移（選用）

```bash
# 臨時裝 better-sqlite3（不存到 package.json）
npm install better-sqlite3 --no-save

# 執行遷移（source: data/expenses.db）
npm run migrate
```

遷移完成後會自動比對行數（`scripts/migrate-sqlite-to-mysql.js`）。

### 正式部署建議

```bash
npm install --production
export NODE_ENV=production
pm2 start src/server.js --name expense-tracker
pm2 save
```

### API 模組一覽

| 模組 | 端點 |
|------|------|
| Categories | `GET/POST /api/categories`、`PUT/DELETE /:id`、`POST/DELETE /:catId/subcategories` |
| Accounts | `GET/POST /api/accounts`、`PUT/DELETE /:id` |
| Transactions | `GET/POST /api/transactions`、`PUT/DELETE /:id`、`GET /trend` |
| Recurring | `GET/POST /api/recurring`、`POST /process` |
| Reports | `GET /api/reports/monthly|category|networth` |
| Budgets | `GET/POST /api/budgets`、`GET /status` |
| Trips | `GET/POST /api/trips`、`POST /:id/members`、`POST /join`、`GET /:id/settlement` |
| Export | `GET /api/export?days=30`（CSV） |

### 前端 SPA 路由（hash-based）

`#transactions` / `#accounts` / `#recurring` / `#budgets` / `#reports` / `#trips`
