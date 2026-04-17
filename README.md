# Expense Tracker

個人記帳工具，採用雙式記帳架構，支援多帳戶、旅遊共帳與月報表。

## 功能

- **雙式記帳**：每筆交易有來源帳戶 → 目的帳戶，支援 asset / expense / revenue / liabilities 四種帳戶類型
- **多帳戶管理**：現金、銀行、信用卡分開追蹤，自動計算各帳戶餘額
- **收支分類**：兩層分類（大分類 + 子分類），預設含飲食、交通、購物、娛樂、醫療
- **固定支出**：設定每月定期支出（房租、訂閱費），到期提醒
- **預算管理**：設定月預算（整體 + 各分類），超過 80% / 100% 警示
- **旅遊共帳**：建立旅遊專案，多人記帳，自動計算最小轉帳次數平攤
- **報表**：月收支長條圖、分類圓餅圖、淨資產走勢折線圖

## 技術棧

- **後端**：Node.js + Express
- **資料庫**：MySQL 8（原 SQLite，已遷移）
- **前端**：Vanilla JS（無框架）

## 本機啟動

```bash
npm install
# 設定 .env（參考 .env.example）
npm start
# 預設跑在 http://localhost:3000
```

## API 路由

| 群組 | 路徑 |
|------|------|
| 帳戶 | `GET/POST/PUT/DELETE /api/accounts` |
| 交易 | `GET/POST/PUT/DELETE /api/transactions` |
| 分類 | `GET/POST/PUT/DELETE /api/categories` |
| 固定支出 | `GET/POST/PUT/DELETE /api/recurring` |
| 預算 | `GET/POST/PUT/DELETE /api/budgets` |
| 報表 | `GET /api/reports/monthly` `/category` `/networth` |
| 旅遊 | `GET/POST /api/trips` |
| 匯出 | `GET /api/export` |

## 待辦

- `FEAT-006` 帳戶編輯 UI
- `FEAT-007` 固定支出編輯 UI
- `FEAT-008` 分類管理頁面

詳見 [backlog](https://github.com/fcu-D0280225/claude-cron/blob/main/backlog/autonomous-tasks.md)。
