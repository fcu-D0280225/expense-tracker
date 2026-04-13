# Expense Tracker — 專案規格

## 目標
輕量記帳 Web App，資料存 SQLite，方便 AI 定期分析消費習慣。

## 功能需求

### 基本功能
- 新增支出：金額、大分類、小分類、備註、日期
- 瀏覽支出清單（依日期排序）
- 刪除 / 編輯支出
- 兩層分類管理（大分類 + 小分類）

### 預設分類
- 飲食：早餐、午餐、晚餐、飲料
- 交通：大眾運輸、計程車
- 購物：日用品、服飾、3C
- 娛樂：電影、遊戲
- 醫療：診所、藥品
- 其他

### AI 分析友善設計
- SQLite 資料庫，schema 簡單易讀
- 提供 `/api/export` 輸出近 N 天的支出 CSV（供 AI 讀取）
- 每筆支出附 `tags` 欄位（自由標籤，AI 可用來分群）

## 技術棧
- Backend：Node.js + Express + better-sqlite3
- Frontend：原生 HTML/CSS/JS（PWA，可加入主畫面）
- DB：SQLite（`data/expenses.db`）

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

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  amount        REAL NOT NULL,
  category      TEXT NOT NULL,
  subcategory   TEXT,
  note          TEXT,
  tags          TEXT,
  date          TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);
```

## API
- `GET  /api/expenses` — 取得支出清單（支援 ?from=&to=&category=&subcategory=）
- `POST /api/expenses` — 新增支出
- `PUT  /api/expenses/:id` — 編輯支出
- `DELETE /api/expenses/:id` — 刪除支出
- `GET  /api/export?days=30` — 匯出 CSV 供 AI 分析
- `GET  /api/categories` — 取得類別清單（含子分類）
- `POST /api/categories` — 新增大分類
- `PUT  /api/categories/:id` — 編輯大分類
- `DELETE /api/categories/:id` — 刪除大分類（連帶刪除子分類）
- `POST /api/categories/:catId/subcategories` — 新增子分類
- `DELETE /api/subcategories/:id` — 刪除子分類
