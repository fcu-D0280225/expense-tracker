# Expense Tracker 記帳本

個人記帳 PWA，採雙式記帳架構，支援多帳戶、旅遊共帳、LINE 記帳機器人與月報表。

---

## 專案在做什麼

這是一個可以安裝到手機桌面的記帳 App（PWA）。核心設計是**雙式記帳**，每筆交易都有「從哪個帳戶出」和「進哪個帳戶」，因此可以準確追蹤每個帳戶的餘額，不會有記了支出卻不知道錢從哪扣的問題。

除了基本記帳，也支援多人共遊的旅遊共帳功能，自動計算誰欠誰多少錢（最小轉帳次數），以及透過 LINE 直接傳訊息記帳（自然語言解析）。

---

## 功能模組

| 頁籤 | 功能 |
|------|------|
| **記帳** | 新增 / 編輯 / 刪除交易，支援支出、收入、轉帳三種類型；內嵌月曆選日期；搜尋、篩選、匯出 CSV |
| **帳戶** | 管理資產、負債、收入來源、支出類別四種帳戶；自動計算餘額與淨資產 |
| **固定支出** | 設定週期性交易（每日 / 週 / 月 / 年），到期時一鍵建立 |
| **預算** | 設定月預算（整體或分類），進度條顯示使用率，超過 80% / 100% 變色警示 |
| **報表** | 月收支長條圖、支出分類圓餅圖（自訂日期範圍）、淨資產走勢折線圖 |
| **旅遊** | 建立旅遊專案、管理成員、記錄費用（多幣別）、自動平攤計算 |

---

## 技術架構

```
前端          後端              資料庫
Vanilla JS ─► Express (Node) ─► MySQL 8
PWA / SW      src/server.js     GCP VM
              src/db.js
              src/line.js  ◄── LINE Messaging API
                           ◄── Claude CLI（自然語言解析）
```

- **前端**：無框架 Vanilla JS，PWA 可安裝到手機桌面
- **後端**：Node.js + Express，RESTful API
- **資料庫**：MySQL 8，連線池由 `mysql2/promise` 管理
- **LINE Bot**：使用者在 LINE 傳訊息 → Claude CLI 解析 → 自動建立交易
- **身份驗證**：旅遊頁面透過 `device_token`（UUID）+ MySQL 記錄身份，跨裝置持久化

---

## 本機啟動

### 前置需求

- Node.js 18+
- MySQL 8 資料庫

### 步驟

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數
cp .env.example .env
# 編輯 .env，填入 MySQL 連線資訊

# 3. 啟動（會自動建立所有 table）
npm start
# → http://localhost:3000
```

### .env 說明

```env
PORT=3000

# MySQL 連線
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=app_user
MYSQL_PASSWORD=your_password_here
MYSQL_DATABASE=expense_tracker

# LINE Bot（選填，不設定則 LINE 功能不啟用）
LINE_CHANNEL_SECRET=your_line_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
```

> **注意**：`ANTHROPIC_API_KEY` 不需要設定。LINE Bot 使用 Claude Code CLI 的登入 token（月租方案），不走 API Key。

---

## LINE 記帳機器人

### 設定步驟

1. 到 [LINE Developers Console](https://developers.line.biz/) 建立 Messaging API Channel
2. 取得 `Channel Secret` 和 `Channel Access Token`，填入 `.env`
3. 設定 Webhook URL：`https://你的域名/line/webhook`
4. 確認 Claude Code CLI 已登入（`claude --version` 可執行）

### 使用方式

在 LINE 直接傳文字訊息：

```
午餐 250
昨天搭計程車花了三百五
信用卡買了一件衣服 1200
上週六看電影 320
```

Bot 會回覆確認訊息，並自動寫入資料庫。

---

## 旅遊共帳

### 使用流程

1. **建立旅遊專案** → 填入名稱、日期、預算
2. **加入成員** → 每個成員會得到一組邀請碼
3. **分享邀請碼** → 點成員列表的「複製碼」，傳給當事人
4. **認領身份** → 每個人開啟 App 後，點「你是哪位成員？」選自己的名字
5. **記錄費用** → 「誰付的」會自動選到自己
6. **平攤計算** → 點「重新計算」，App 自動算出最少轉帳次數的還款方案

> 身份認領資料存在 MySQL，同一個裝置下次進來會自動恢復。

---

## API 路由總覽

| 資源 | 路徑 |
|------|------|
| 帳戶 | `GET/POST /api/accounts`、`PUT/DELETE /api/accounts/:id` |
| 交易 | `GET/POST /api/transactions`、`PUT/DELETE /api/transactions/:id` |
| 分類 | `GET/POST /api/categories`、`PUT/DELETE /api/categories/:id` |
| 子分類 | `POST /api/categories/:catId/subcategories`、`DELETE /api/subcategories/:id` |
| 固定支出 | `GET/POST /api/recurring`、`PUT/DELETE /api/recurring/:id`、`POST /api/recurring/process` |
| 預算 | `GET/POST /api/budgets`、`PUT/DELETE /api/budgets/:id`、`GET /api/budgets/status` |
| 報表 | `GET /api/reports/monthly`、`/category`、`/networth` |
| 旅遊 | `GET/POST /api/trips`、`GET/PUT/DELETE /api/trips/:id` |
| 旅遊成員 | `POST /api/trips/:id/members`、`DELETE /api/trips/:id/members/:mid` |
| 旅遊費用 | `POST/PUT/DELETE /api/trips/:id/expenses/:eid` |
| 旅遊平攤 | `GET /api/trips/:id/settlement` |
| 旅遊身份 | `GET/POST /api/trips/identity`、`DELETE /api/trips/identity` |
| 搜尋趨勢 | `GET /api/transactions/trend` |
| 匯出 | `GET /api/export?days=30` |
| LINE Webhook | `POST /line/webhook` |

---

## 資料庫 Schema

啟動時 `initSchema()` 自動建立所有 table，不需手動 migration。

| Table | 說明 |
|-------|------|
| `accounts` | 帳戶（asset / expense / revenue / liabilities） |
| `categories` | 大分類 |
| `subcategories` | 小分類，belongs to category |
| `transactions` | 交易記錄，雙式記帳（source → dest） |
| `recurring` | 固定週期交易設定 |
| `budgets` | 月預算（整體或分類） |
| `trips` | 旅遊專案 |
| `trip_members` | 旅遊成員 |
| `trip_expenses` | 旅遊費用（含多幣別、分攤方式） |
| `trip_member_claims` | 旅遊身份認領（device_token → member） |

---

## 專案結構

```
expense-tracker/
├── src/
│   ├── server.js     # Express server + 所有 API 路由
│   ├── db.js         # MySQL 連線池 + query/get/run/transaction 工具
│   └── line.js       # LINE webhook 處理 + Claude CLI 解析
├── public/
│   ├── index.html    # 單頁應用主體
│   ├── app.js        # 前端邏輯（Vanilla JS）
│   ├── style.css     # 暗色主題 CSS
│   ├── manifest.json # PWA manifest
│   └── sw.js         # Service Worker（離線快取）
├── .env.example      # 環境變數範本
└── package.json
```
