# Expense Tracker — Codemap Index

---

## 文件地圖

- `codemap/system-overview.md`
  - 技術棧、啟動流程、目錄地圖、資料庫 schema 總覽
- `SCHEMA.md`
  - 完整 DB schema、欄位定義、預設資料
- `README.md`
  - 功能模組說明（記帳、帳戶、固定支出、預算、報表、旅遊）

---

## 建議讀取策略

- 想找 API endpoint：讀 `src/server.js`（所有路由在此）
- 想改 DB schema：讀 `src/db.js`
- 想改 LINE 記帳邏輯：讀 `src/line.js`
- 想改前端頁面：讀 `public/app.js`
- 想了解旅遊分帳計算：grep `trip` in `src/server.js`
