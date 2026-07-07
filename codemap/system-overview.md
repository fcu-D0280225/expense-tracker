# Expense Tracker — System Overview

## 1) 技術棧

- Backend：Node.js + Express（CommonJS）+ MySQL（mysql2）
- Frontend：原生 HTML/CSS/JS PWA（`public/`）
- LINE 記帳：Webhook（`src/line.js`）+ 自然語言解析
- Port：3000

---

## 2) 啟動流程

```bash
npm start   # → node src/server.js
```

1. `initSchema()`：建所有 table（IF NOT EXISTS，重啟安全）
2. `seedCategories()`：補預設分類（飲食/交通/購物…）
3. `seedAccounts()`：補預設帳戶
4. 啟動 Express，註冊 API + 靜態頁

---

## 3) 目錄地圖

```
src/
  server.js     # 主程式：schema 建立 + 所有 API 路由
  db.js         # DB 連線 pool（mysql2）
  line.js       # LINE webhook handler + 自然語言記帳解析

public/
  index.html    # 單頁 PWA 入口
  app.js        # 前端主程式（SPA，tab 切換）
  style.css
  sw.js         # Service Worker（離線快取）
  manifest.json # PWA manifest

data/
  expenses.db*  # 舊 SQLite 殘留（已遷移 MySQL，可忽略）
```

---

## 4) 資料庫模型

| Table | 用途 |
|-------|------|
| `categories` | 大分類（飲食、交通…） |
| `subcategories` | 子分類 |
| `accounts` | 帳戶（資產/支出/收入/負債） |
| `transactions` | 交易（雙式記帳：來源帳戶→目標帳戶） |
| `budgets` | 月預算 |
| `recurring` | 固定/重複交易 |
| `trips` | 旅遊專案 |
| `trip_members` | 旅遊同行成員 |
| `trip_expenses` | 旅遊費用（多幣別） |
| `trip_member_claims` | 裝置身份認領（device_token ↔ member）|

---

## 5) 部署（VPS：104.199.167.209）

```bash
# SSH 進 VPS
ssh jacksonlin@104.199.167.209

# 部署（在 VPS 上）
cd ~/expense-tracker
git pull && npm install --omit=dev
pm2 restart expense-tracker   # 或首次：pm2 start src/server.js --name expense-tracker
pm2 save
```

**`.env` 必要變數**：
```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<user>
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=expense_tracker
PORT=3000
LINE_CHANNEL_SECRET=<secret>       # LINE 記帳（可選）
LINE_CHANNEL_ACCESS_TOKEN=<token>  # LINE 記帳（可選）
```

**本地連 VPS MySQL**（SSH Tunnel）：
```bash
ssh -fN -L 3306:127.0.0.1:3306 jacksonlin@104.199.167.209
```

---

## 6) 核心 API 分組

| 功能域 | 路徑前綴 |
|--------|---------|
| 交易 CRUD | `GET/POST/PUT/DELETE /api/transactions` |
| 帳戶管理 | `/api/accounts` |
| 分類管理 | `/api/categories` |
| 預算 | `/api/budgets` |
| 固定支出 | `/api/recurring` |
| 旅遊 | `/api/trips`, `/api/trip-expenses` |
| 報表 | `/api/reports/*` |
| LINE webhook | `POST /webhook` |
