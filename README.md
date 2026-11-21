# 智能行事曆（Smart Calendar PWA）

用自然語言加行程、AI 會追問提醒細節、同步到 Google 日曆由 Google 準時通知。
純前端，不需要伺服器；放上 GitHub Pages 後在 iPhone「加入主畫面」就是一個 App。

## 檔案
| 檔案 | 用途 |
|---|---|
| `index.html` | 畫面結構 |
| `styles.css` | 樣式（自動深色模式、iPhone 瀏海安全區） |
| `app.js` | 全部邏輯：行事曆、編輯、Gemini 對話、Google 同步 |
| `sw.js` | 離線快取 |
| `manifest.webmanifest`、`icons/` | 加入主畫面用的 App 資訊與圖示 |

## 一、取得 Gemini API key（免費，約 2 分鐘）
1. 打開 https://aistudio.google.com/apikey ，用 Google 帳號登入。
2. 按「Create API key」，複製 `AIza...` 開頭的字串。
3. 之後在 App 右上角 ⚙︎ →「Gemini API key」貼上。

> 模型預設 `gemini-flash-latest`（自動指向最新的 Flash）。若出現「找不到模型」，到 AI Studio 看目前可用的名稱，填到設定的「模型名稱」。

## 二、建立 Google OAuth Client ID（免費，約 10 分鐘）
App 要寫入你的 Google 日曆，需要一個「OAuth 用戶端 ID」。

1. 建專案：https://console.cloud.google.com/projectcreate → 名稱隨意（例如 smart-calendar）→ 建立。
2. 啟用日曆 API：https://console.cloud.google.com/apis/library/calendar-json.googleapis.com → 按「啟用」。
3. 設定同意畫面：https://console.cloud.google.com/auth/overview → 「開始」
   - 應用程式名稱：智能行事曆；使用者支援電子郵件：你自己
   - 目標對象：**外部（External）**
   - 完成後到左側「目標對象（Audience）」→「測試使用者」→ 加入你自己的 Gmail。
4. 建立用戶端：左側「用戶端（Clients）」→「建立用戶端」
   - 應用程式類型：**網頁應用程式**
   - 已授權的 JavaScript 來源：
     - `https://你的GitHub帳號.github.io`（部署後的網址，**不要**加路徑或結尾斜線）
     - `http://localhost:8765`（本機測試用，可選）
   - 建立後複製「用戶端 ID」（`xxxx.apps.googleusercontent.com`）。
5. 在 App ⚙︎ →「OAuth Client ID」貼上 →「連結 Google 日曆」→ 登入並允許。
   - 會看到「Google 尚未驗證這個應用程式」→ 點「繼續」即可（這是你自己的 App）。
   - App 只申請 `calendar.app.created` 權限：**只能存取它自己建立的「智能行事曆」日曆**，碰不到你其他日曆。

## 三、部署到 GitHub Pages（約 5 分鐘）
```bash
cd ~/Claude/Projects/SmartCalendar
git init && git add . && git commit -m "Smart Calendar v1"
gh repo create smart-calendar --public --source=. --push
gh api -X POST repos/{owner}/smart-calendar/pages -f "source[branch]=main" -f "source[path]=/"
```
約 1 分鐘後打開 `https://你的GitHub帳號.github.io/smart-calendar/` 看到月曆就成功了。
（沒有 `gh` 的話：在 github.com 建 repo、上傳這些檔案，Settings → Pages → Branch 選 `main` / `root` → Save。）

## 四、裝到 iPhone 桌面
1. 用 **Safari** 打開上面的網址 → 分享按鈕 → 「加入主畫面」。
2. 從桌面圖示打開 App，**在這裡面**重新填一次設定（iOS 的桌面 App 和 Safari 資料是分開的）。
3. 安裝 **Google 日曆 App** 並登入同一個帳號，在其設定中確認「智能行事曆」這個日曆的通知是開的——提醒是由 Google 日曆跳出來的。

## 使用方式
- **說的**：底部輸入「12/5 下午兩點期末 demo」→ 助理追問準備事項與提醒 → 出現確認卡片 → 「加入行事曆」。
  iPhone 鍵盤上的麥克風可以直接語音輸入。
- **手動**：右下角 ＋，或點月曆上的某一天。點行程可編輯／刪除；週檢視可拖曳改時間。
- 🔔 開頭的行程是 AI 幫你拆出來的「準備事項」，刪除主行程時可一併刪除。
- 黃色提示條「N 筆待同步」→ 點一下就會同步到 Google。

## 已知限制
- **單向同步**：App → Google。在 Google 日曆 App 裡直接改的內容不會回到這個 App。
- **Google 登入約 1 小時過期**（純前端無法保存長期憑證），過期後提示條會請你點一下重新連結；行程不會遺失，會等連上後再同步。
- 行程資料存在手機本機（localStorage）。換手機前請用 ⚙︎ →「匯出備份」。
- Gemini 免費額度由 Google 決定、可能調整；免費版的對話內容可能被 Google 用於改進模型。
- 加入主畫面的 App 裡跳出 Google 登入視窗，這部分尚未在真實 iPhone 上驗證；若登入視窗無法返回，請回報。

## 之後可以擴充
1. 從 Google 日曆拉回資料（雙向同步）。
2. 匯入 TimeTree 舊行程（用開源工具 `timetree-exporter` 匯出 .ics 再匯入）。
3. 每天早上的「今日行程」摘要、或改用 Claude API 提升追問品質（設定裡換模型即可擴充）。
