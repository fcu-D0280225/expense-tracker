# DESIGN.md — StashSquirrel 攢攢鼠 設計規範

> 本檔是本 repo 視覺設計的 **single source of truth**，內容為**從現行程式碼萃取的現況記錄**，不是重新設計。改樣式前先讀這裡；新增畫面/元件請沿用既有 token 與 class，不要另創一套。
> 建立方式：掃描 `public/style.css`、`public/app.js`、`public/index.html`、`public/manifest.json` 實際值整理而成（見 §9）。
> 建立日期：2026-07-11。

---

## 0. 核心原則

1. **單一深色主題**：全站只有一套暗色介面（無淺色模式切換），`--bg #0f0f13` 打底，卡片用 `--surface` 系列分層堆疊出景深。
2. **色彩已 token 化，字級/間距尚未**：顏色、圓角、陰影已抽成 `:root` CSS 變數；**字級與間距目前是散落的 rem 字面值**，沒有 `--fz-*` / `--space-*` 這類 token（與 clockin 的做法不同，見 §2.3、§8「已知漂移」）。
3. **語意化狀態色（部分一致）**：支出=靛紫 `--accent`、收入=綠 `--green`、轉帳=天藍 `--sky`、預算警戒=琥珀 `--amber`、危險/超支=紅 `--red`。多數元件遵守，但有少數硬編碼例外（見 §8）。
4. **無框架 Vanilla JS + 系統字體**：不依賴任何 UI 套件；`font-family` 用系統字堆疊，不特別宣告中文字體（CJK 由瀏覽器 fallback 補）。
5. **44px 觸控底線**：所有互動元件（`button`、`input`、`select`、`.tab`）強制 `min-height: 44px`，這是目前唯一被嚴格貫徹的無障礙規則。

---

## 1. 品牌

| 項目 | 值 | 來源 |
|------|-----|------|
| 中文名 | **攢攢鼠** | `mine/BRAND.md` |
| 英文名 | **StashSquirrel** | `mine/BRAND.md` |
| 吉祥物 | 松鼠 | `mine/BRAND.md` |
| HQ 登記主色 | `#a855f7`（紫） | `mine/BRAND.md` |
| **實際產品主色（accent）** | `#6366f1`（靛紫 indigo） | `public/style.css` `:root --accent` |
| 產品內顯示名稱 | 「記帳本」（無「攢攢鼠 / StashSquirrel」字樣、無松鼠圖像） | `public/index.html` `<title>` / `<h1>`、`public/manifest.json` `name` |
| App icon | Emoji 💰（data URI SVG），非松鼠圖像 | `public/manifest.json` |

> **注意**：HQ 品牌表登記的攢攢鼠主色 `#a855f7` 與實際上線 CSS 的 `--accent #6366f1` **不一致**，且產品 UI 全程未出現「攢攢鼠 / StashSquirrel」品牌字樣或松鼠意象。此為現況記錄，不擅自修改，詳見 §8。

---

## 2. 設計 Token

### 2.1 色彩 — `public/style.css :root`（單一定義來源）

**中性 / 表面**
| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#0f0f13` | 全域背景 |
| `--surface` | `#18181f` | 卡片 / header / 面板底 |
| `--surface-hi` | `#22222d` | 次層底（input、hover 前一階、帳戶總計底） |
| `--surface-hov` | `#2a2a38` | hover 狀態底 |
| `--border` | `#2e2e3e` | 一般邊框 |
| `--border-hi` | `#3e3e52` | 較亮邊框（目前少用） |

**文字**
| Token | 值 | 用途 |
|-------|-----|------|
| `--text` | `#e2e2ee` | 主文字 |
| `--text-sub` | `#8888a8` | 次要文字（label、說明） |
| `--text-muted` | `#55556a` | 最弱文字（empty state、cal-dow） |

**Accent（品牌/互動色）**
| Token | 值 | 用途 |
|-------|-----|------|
| `--accent` | `#6366f1` | 主按鈕、支出金額、focus border、預算進度條 |
| `--accent-hi` | `#818cf8` | hover 態、active tab 文字、金額強調色 |
| `--accent-dim` | `rgba(99,102,241,.15)` | summary / export-link 底色 |
| `--accent-focus` | `rgba(99,102,241,.35)` | `:focus-visible` outline |

**語意狀態色**
| Token | 值 | dim 版 | 用途 |
|-------|-----|--------|------|
| `--green` | `#22c55e` | `rgba(34,197,94,.15)` | 收入金額、還款方向（收款方）、bar chart 收入條 |
| `--sky` | `#38bdf8` | `rgba(56,189,248,.15)` | 轉帳金額、`.badge` 預設底 |
| `--red` | `#f87171` | `rgba(248,113,113,.15)` | 危險按鈕、負餘額、超支、settlement 付款方 |
| `--amber` | `#fbbf24` | `rgba(251,191,36,.15)` | 預算警戒（80–100%）、`.badge.due` |

### 2.2 圓角 / 陰影

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | `6px` | input、button、tab、小標籤 |
| `--radius` | `10px` | 卡片類（expense-item、account-card、filter-bar、cal-picker） |
| `--radius-lg` | `14px` | 大卡（form-card、report-section） |
| `--shadow` | `0 1px 3px rgba(0,0,0,.4), 0 1px 12px rgba(0,0,0,.2)` | 所有卡片統一陰影，無其他變體 |

> 圓角、陰影 token 化程度高，全站一致，未發現硬編碼例外。

### 2.3 字體 / 字級（未 token 化，現況值）

- `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`（`body`，唯一宣告處），無獨立中文字體宣告。
- 字級無 `--fz-*` 變數，以下為程式碼中實際出現過的 rem 值（由小到大，供沿用參考，非強制刻度）：

  `0.68rem`（cal-dow）→ `0.7rem`（bar-value）→ `0.72rem`（badge / line-label）→ `0.75/0.78rem`（次要文字、按鈕小字、account-group 標題）→ `0.8/0.82rem`（empty、expense-sub、budget-detail、cal-day）→ `0.85/0.9rem`（label、input、tab、settlement-row、identity-banner）→ `0.92/0.95rem`（cal-title、summary、budget-label）→ `1rem`（form-card / report-section 的 `h2`）→ `1.05/1.1rem`（金額類：rec-amount、expense-amount、acc-balance、budget-pct）→ `1.4rem`（`header h1`）→ `1.6rem`（expense-icon emoji）。

- 字重僅用瀏覽器預設 `400` 與 `font-weight: 600 / 700`（金額、標題、active 狀態），無中間值，無變數。

### 2.4 間距（未 token 化，現況值）

無 `--space-*` 變數，`padding` / `margin` / `gap` 直接寫 rem 字面值，常見值集中在 `0.3 / 0.4 / 0.5 / 0.6 / 0.75 / 0.85 / 1 / 1.25rem`。無明顯全站刻度規則，同語意間距在不同元件偶有不同值（如卡片 padding 有 `0.85rem 1rem` 與 `1.25rem` 兩種）。

### 2.5 斷點

只有**一個** RWD 斷點：`@media (max-width: 480px)`（`.row` 改直排、`.filter-bar` 欄寬收窄、`.tab` 縮小、`.pie-wrapper` 改直排）。無 tablet/desktop 加寬版面（`main { max-width: 760px }` 全尺寸皆置中固定寬）。

---

## 3. 版面 / Layout

- **單頁應用**：`public/index.html` 是唯一 HTML，7 個分頁靠 `.page.active` 顯示/隱藏切換（記帳／帳戶／固定支出／預算／報表／旅遊／分類），無路由切頁（無 SPA router，`hash` 僅作視覺錨點）。
- **容器**：`main { max-width: 760px; margin: 0 auto; padding: 1rem }`，所有分頁共用同一置中寬版，無側邊欄、無多欄 grid layout。
- **Header**：深底 `header`（`--surface`）+ `<h1>💰 記帳本</h1>` + 水平捲動式 `.tab-nav`（`overflow-x:auto`，隱藏捲軸）。
- **表單優先於清單**：多數分頁採「上方 `.form-card` 新增/編輯表單 → 下方清單」的固定結構（記帳、固定支出、預算、分類皆同構）。
- **無 Modal**：全站未使用 `<dialog>` 或任何 modal/backdrop 機制，所有編輯皆用「行內展開表單」（如 `.recurring-item--editing`、`acc-edit-*`）取代跳出視窗。

---

## 4. 元件（Class 對照表）

| 元件 | Class | 規格 |
|------|-------|------|
| 分頁導覽 | `.tab-nav` / `.tab`（`.active`） | 水平捲動、`--radius-sm` 上圓角、active 態文字變 `--accent-hi` |
| 卡片（表單） | `.form-card` / `h2` | `--radius-lg`、`--shadow`、標題色 `--accent-hi` |
| 卡片（清單項）| `.expense-item` / `.account-card` / `.recurring-item` / `.budget-card` | `--radius`、`--shadow`、hover 變 `--surface-hi` |
| 按鈕（主要） | `button`（無 class） | `--accent` 底、白字、`--radius-sm`、hover `--accent-hi` |
| 按鈕（次要） | `button.secondary` | `--surface-hi` 底、`--border` 框 |
| 按鈕（危險） | `button.danger` | `--red` 底，hover `#ef4444`（唯一非 token 硬編碼但屬同色系加深，見 §8） |
| 小按鈕 | `button.sm` | `padding:4px 10px`，用於旅遊身份/成員操作 |
| 輸入 / 下拉 | `input` / `select` | `--surface-hi` 底、`--border` 框、`44px` 最小高、`color-scheme:dark` |
| 交易類型切換 | `.tx-type-bar` / `.tx-type`（`.active`） | 三態（支出/收入/轉帳），active 依 `data-type` 變色：支出=`--accent`、收入=`--green`、轉帳=`--sky`（轉帳文字反白為深色 `#0c1a24`） |
| 篩選列 | `.filter-bar` / `.export-link` | 橫向 flex-wrap，匯出連結用 `--accent-dim` 底 |
| 摘要列 | `.summary` | `--accent-dim` 底、`--accent-hi` 文字 |
| 金額顯示 | `.expense-amount`（`.income` / `.transfer`）/ `.acc-balance`（`.negative`）| 依交易類型／正負餘額切色 |
| 徽章 | `.badge`（`.due`） | 預設 `--sky` 系，到期態 `--amber` 系，圓角 pill（`border-radius:99px`） |
| 長條圖 | `.bar-chart` / `.bar.expense-bar`（`--accent`）/ `.bar.income-bar`（`--green`） | 純 CSS width 動畫（`transition: width .3s`） |
| 圓餅圖 | `.pie-svg` + `.pie-legend` / `.legend-dot` | 顏色來自 `app.js` 的 `PIE_COLORS`（10 色陣列，獨立於 `:root`，見 §8） |
| 折線圖 | `.line-chart-wrap svg` / `.line-path` / `.line-area` | SVG 手繪，顏色為硬編碼 hex（見 §8） |
| 預算進度 | `.budget-bar-track` / `.budget-bar-fill`（`.warn` / `.over`） | 正常 `--accent` → ≥80% `--amber` → 100%+ `--red`，左側 `border-left` 同步變色 |
| 日曆選取器 | `.cal-picker` / `.cal-grid` / `.cal-day`（`.is-today` / `.selected`） | 內嵌式（非彈出），7 欄 grid |
| 旅遊身份banner | `.identity-banner`（`.identity-set`） | 未認領=灰框、已認領=`--accent` 框 |
| 平攤結果列 | `.settlement-row` / `.settlement-from`(`--red`) / `.settlement-to`(`--green`) | 付款方紅、收款方綠，箭頭中性灰 |
| 分類子項 | `.sub-block` / `.sub-list` | 左側 `--accent` 3px 色條 + 左縮排，表示從屬關係 |

---

## 5. 狀態色對照（記帳語意）

| 狀態 / 語意 | 顏色 Token | 用於 |
|------|-----------|------|
| 支出 expense | `--accent` / `--accent-hi` | 金額文字、長條圖、預算進度條（正常區間） |
| 收入 income | `--green` | 金額文字、tx-type active、長條圖收入條、settlement 收款方 |
| 轉帳 transfer | `--sky` | 金額文字、tx-type active（文字反白深色） |
| 負餘額 / 負債 | `--red` | `.acc-balance.negative` |
| 預算警戒（≥80%） | `--amber` | `.budget-card.warn`、`.budget-pct.warn`、`.budget-bar-fill.warn` |
| 預算超支（≥100%） | `--red` | `.budget-card.over`、`.budget-pct.over`、`.budget-bar-fill.over` |
| 固定支出到期 | `--amber`（`.badge.due`） | 固定支出清單 |
| 平攤：付款方 | `--red`（`.settlement-from`） | 旅遊平攤結果 |
| 平攤：收款方 | `--green`（`.settlement-to`） | 旅遊平攤結果 |

> 規則整體算一致：紅=負向/超支/付款、綠=正向/收入/收款、琥珀=警戒、靛紫=中性主色（支出）。例外見 §8。

---

## 6. 文案語氣

- 全繁體中文、功能標籤式命名（「記帳」「固定支出」「預算」而非行銷語氣）。
- 空狀態：`.empty` 統一置中弱化文字（`--text-muted`），文案簡短（如清單為空時的提示），未見到像 clockin 那樣「可行動」的空狀態導引文案（例如未附「立即新增」CTA 連結）。
- 無 emoji 裝飾性用語堆砌，emoji 僅作為使用者可自訂的帳戶/分類圖示（`acc-icon` / `cat-icon`，使用者輸入的文字欄位，非固定圖示系統）。

---

## 7. 無障礙現況

**已落實**
- 全域 `44px` 觸控目標下限（`button` / `input` / `select` / `.tab`）。
- `:focus-visible` 全域規則：`outline: 2px solid var(--accent-focus); outline-offset: 2px`（`input`、`select`、`textarea`、`button`、`a`）。
- `input`、`select` 宣告 `color-scheme: dark`，讓瀏覽器原生控件（日期選取器等）跟隨暗色主題。
- 狀態不只靠顏色：預算卡同時用左邊框粗細+顏色+百分比文字（`.budget-pct`）三重提示；徽章有文字（「已停用」「到期」）而非純色點。

**尚未覆核（本次僅記錄現況，不代表已通過 WCAG AA 稽核）**
- 色彩對比未逐一實測：例如 `--text-muted #55556a` 對 `--bg #0f0f13` 的對比比值未經工具驗證。
- emoji（💰、圖示 emoji）未見 `aria-hidden` 標記。
- `.cal-day` 為可點但非原生 `<button>` 的自訂元素，鍵盤可及性（Enter/Space 觸發）未在本次掃描中確認。

---

## 8. 已知漂移 / 待對齊（如實記錄，未動 code）

以下為掃描時發現「語意應一致但值不一致」或「該用 token 卻硬編碼」的地方，供未來對齊參考，本次**未修改任何程式碼**：

1. **品牌主色不一致**：`mine/BRAND.md` 登記攢攢鼠主色為 `#a855f7`（紫），但實際上線 CSS 的 `--accent` 是 `#6366f1`（靛紫），且全站找不到 `#a855f7` 這個值的任何出處。建議之後對齊時，由 PM/品牌側先決定「哪個是對的」（改 BRAND.md 登記色，或改產品 `--accent`），不是各自為政。
2. **產品 UI 未出現品牌名稱與吉祥物**：`<title>`、`<h1>`、`manifest.json` 的 `name`/`short_name` 皆是「記帳本」/「記帳」，PWA icon 是 💰 emoji，全站無「攢攢鼠 / StashSquirrel」字樣或松鼠圖像。目前品牌僅存在於 HQ 文件層級，未落地到產品本身。
3. **`--green` / `--red` 語意色在個別元件被繞過，改用淺色系（亮底深字）硬編碼**：
   - `public/app.js:465`（淨資產列）：`background:#d1fae5;color:#065f46`（Tailwind emerald-100/800，淺色主題配色），與全站暗色主題（token 皆為「深底＋亮色文字」）風格不符，也未用 `--green-dim` / `--green`。
   - `public/app.js:590`（固定支出「已停用」badge）：`background:#fee2e2;color:#991b1b`（Tailwind red-100/800），同樣是淺色主題配色，未用 `--red-dim` / `--red`。
4. **折線圖 / 圓餅圖顏色未接 `:root` token**：
   - `public/app.js:841-843`（淨資產走勢折線圖）：`fill="#818cf8"`（= `--accent-hi` 的值但寫死字串，非變數）、`stroke="#4f46e5"`（indigo-600，**與 `--accent #6366f1` 不是同一值**，是相近但不同的靛紫色調）。
   - `public/app.js:34` `PIE_COLORS` 為獨立 10 色陣列（`#818cf8 #34d399 #f59e0b #f87171 #38bdf8 #a78bfa #fb923c #4ade80 #e879f9 #94a3b8`），其中僅 `#818cf8`（accent-hi）、`#f87171`（red）、`#38bdf8`（sky）與現有 token 完全同值，其餘 7 色是額外擴充的分類色階，未登記進 `:root`。SVG 無法用 CSS 變數渲染 `fill`/`stroke` 屬性是常見限制，但可考慮改用 JS 讀 `getComputedStyle` 取值以維持單一事實來源。
5. **旅遊平攤說明文字硬編碼灰色**：`public/app.js:1358` `color:#64748b`（slate-500），全站其他次要文字一律用 `--text-sub #8888a8`，此處是唯一例外的漏網硬編碼。
6. **字級與間距完全未 token 化**（見 §2.3、§2.4）：與顏色/圓角/陰影的 token 化程度不對稱，是否要補齊 `--fz-*` / `--space-*` 屬產品決策，本文件僅如實記錄現況、不建議擅自新增。
7. **`button.danger:hover` 硬編碼 `#ef4444`**（`public/style.css:158`）：非 `--red` 的 dim/亮版本組合中的值，是額外引入的第三個紅色調（`--red` = `#f87171`，hover 用更深的 `#ef4444`），雖語意上合理（hover 加深），但沒有對應 token，純字面值。

---

## 9. 檔案地圖

| 檔案 | 角色 |
|------|------|
| `public/style.css` | 唯一樣式來源，`:root` 定義全部色彩/圓角/陰影 token（561 行） |
| `public/app.js` | 前端邏輯 + 部分內嵌樣式（`style="..."` inline）與圖表顏色（`PIE_COLORS`、SVG 折線圖顏色）（1622 行） |
| `public/index.html` | 單頁應用主體，7 分頁 DOM 結構、`<meta name="theme-color">` |
| `public/manifest.json` | PWA manifest，`background_color` / `theme_color` / emoji icon |
| `public/sw.js` | Service Worker，`CACHE = 'expense-tracker-v1'`；本 repo **無** clockin 式 `?v=vN` 靜態資源版本號慣例，也未發現 pre-commit hook 強制 bump `CACHE_NAME`（改 `sw.js` 快取清單時須自行手動 bump `CACHE`，否則沿用舊快取） |
| `DESIGN.md` | 本檔（設計 source of truth） |

---

## 10. 使用守則

- 新增畫面/元件：**先查 §2、§4 有沒有可複用的 token / class**，不要新開一組顏色或字級。
- 需要新語意色（如新增交易類型）：比照 §5 模式，在 `:root` 新增一組 `--color` / `--color-dim`，不要直接寫 hex。
- 發現本文件與程式碼不符：以程式碼為準，並回來更新本文件（本檔是「反映現況」而非「規定應然」的設計文件）。
