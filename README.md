# Universal Trading Remote (UTR) - 萬用看盤遙控器

Chrome 擴充功能，在證券網頁上提供持久化的懸浮遙控面板，跨券商統一操作技術分析切換與個股跳轉。

## 功能特色

- **懸浮遙控面板** — Shadow DOM 隔離，不受券商網頁樣式影響
- **K 線週期快切** — 一鍵切換 1分/5分/15分/30分/60分/日/週/月 K 線
- **技術指標開關** — MA、MACD、RSI、KDJ、布林通道、成交量等
- **個股快速跳轉** — 輸入股票代碼直接切換
- **動作錄製器** — 開啟錄製模式，點擊網頁元素自動擷取 CSS Selector
- **跨券商配置** — 可擴展支援多家券商的 DOM Selector 映射

## 目前支援券商

| 券商 | 網域 | 備註 |
|------|------|------|
| 群益證券 | `tradeweb.capital.com.tw` | 基於 TradingView 圖表 |

> 透過錄製器或 Options 頁面可自行新增其他券商。

## 技術架構

```
Chrome Extension Manifest V3
├── Background Service Worker  — 標籤頁監控、跨頁通訊、設定管理
├── Content Scripts
│   ├── injector.js            — Shadow DOM 注入懸浮面板
│   ├── executor.js            — 頁面 Context 中執行 DOM 操作
│   └── recorder.js            — 錄製模式邏輯
├── UI Panel                   — 遙控器介面（注入至 Shadow DOM）
├── Options Page               — 管理各券商 Selector 設定
└── Utils
    └── selector-finder.js     — CSS Selector 自動產生器
```

## 環境需求

- Node.js >= 18
- Chrome 瀏覽器 >= 120（支援 Manifest V3）

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 開發模式（自動監聽變更）

```bash
npm run dev
```

### 3. 正式建構

```bash
npm run build
```

### 4. 載入至 Chrome

1. 打開 `chrome://extensions/`
2. 啟用「開發人員模式」（右上角）
3. 點擊「載入未封裝項目」
4. 選擇 `dist/` 資料夾

### 5. 開始使用

1. 前往群益證券看盤頁面：`https://tradeweb.capital.com.tw/TradingViewChart/KlineChart.aspx?s=2330`
2. 點擊瀏覽器工具列的 UTR 圖示開啟遙控面板
3. 使用面板上的按鈕切換 K 線週期或技術指標
4. 輸入股票代碼（如 `2330`）並按 GO 跳轉

## 錄製新動作

1. 點擊面板上的錄製按鈕（圓形紅點圖示）
2. 滑鼠移動到目標元素，會顯示紅色外框
3. 點擊元素，彈出儲存對話框
4. 填寫按鈕名稱與群組，確認 Selector 後儲存
5. 按 `ESC` 或再次點擊錄製按鈕退出錄製模式

## 新增券商

### 方法一：Options 頁面

1. 右鍵點擊 UTR 圖示 → 選項
2. 切換至「新增券商」頁籤
3. 輸入網域、名稱、個股 URL 範本
4. 在券商設定中新增動作（Click / Script / Input）

### 方法二：JSON 編輯

1. Options 頁面 → JSON 編輯頁籤
2. 直接編輯設定 JSON
3. 點擊儲存

### 設定格式範例

```json
{
  "tradeweb.capital.com.tw": {
    "name": "群益證券",
    "stockUrlPattern": "https://tradeweb.capital.com.tw/TradingViewChart/KlineChart.aspx?s={code}",
    "actions": [
      {
        "id": "period_5m",
        "label": "5分K",
        "group": "週期",
        "type": "click",
        "selector": "[data-value=\"5\"]",
        "description": "切換至5分鐘K線"
      }
    ]
  }
}
```

## 專案結構

```
/universal-trading-remote
├── manifest.json                  # Chrome Extension 設定
├── package.json                   # Node.js 專案設定
├── webpack.config.js              # Webpack 建構設定
├── src/
│   ├── background/
│   │   └── service-worker.js      # Background Service Worker
│   ├── content/
│   │   ├── injector.js            # Shadow DOM 注入面板
│   │   ├── executor.js            # DOM 操作執行器
│   │   └── recorder.js            # 錄製模式
│   ├── ui/
│   │   ├── panel.html             # 面板 HTML（備用 popup）
│   │   ├── panel.css              # 面板樣式
│   │   └── panel.js               # 面板邏輯
│   ├── options/
│   │   ├── options.html           # 設定頁面
│   │   └── options.js             # 設定邏輯
│   └── utils/
│       └── selector-finder.js     # CSS Selector 產生器
├── assets/
│   └── icons/                     # 16, 48, 128 PNG 圖示
└── dist/                          # 建構輸出（載入此資料夾至 Chrome）
```

## 安全性注意事項

- **Shadow DOM 隔離**：面板使用 `closed` Shadow DOM，防止券商網頁存取或修改
- **CSP 相容**：所有操作透過 Content Script 執行，不使用 `eval` 或內聯腳本
- **腳本白名單**：`executor.js` 只允許執行預定義函式（toggleIndicator、changeResolution、changeSymbol）
- **iframe 支援**：`manifest.json` 設定 `all_frames: true`，並在執行時嘗試穿透同源 iframe

## 授權

MIT License
