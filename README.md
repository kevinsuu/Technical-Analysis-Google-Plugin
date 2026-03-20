# Universal Trading Remote (UTR) - 萬用看盤遙控器

Chrome 擴充功能，在證券網頁上提供持久化的懸浮遙控面板，跨券商統一操作技術分析切換與個股跳轉。

## 功能特色

- **懸浮遙控面板** — Shadow DOM (closed) 隔離，不受券商網頁樣式影響，支援拖曳移動
- **K 線週期快切** — 分鐘 / 小時 / 天 三大分頁，涵蓋 16 種週期（1分～1月），透過 Service Worker 在頁面 MAIN world 繞過 CSP 執行
- **個股搜尋與自動完成** — 即時搜尋上市 (TWSE) + 上櫃 (TPEx) 全股票，支援代碼或中文名稱，200ms 防抖、鍵盤上下選取
- **觀察清單** — 持久化觀察清單，支援新增/移除/拖曳排序，點擊一鍵跳轉個股
- **動作錄製器** — 開啟錄製模式，點擊網頁元素自動擷取 CSS Selector，儲存為自訂動作
- **跨券商配置** — 內建 11 家台灣券商設定，可透過 Options 頁面或 JSON 編輯自行擴展
- **自動版本管理** — Webpack 建構時根據 Git commit 次數自動更新 manifest 版本號

## 目前支援券商

| 券商 | 網域 | 類別 |
|------|------|------|
| 群益證券 | `tradeweb.capital.com.tw` | 市場領先 |
| 元大證券 | `ytdf.yuanta.com.tw` | 市場領先 |
| 凱基證券 | `h5webtrade.kgieworld.com.tw` | 市場領先 |
| 富邦證券 | `fubon-ebrokerdj.fbs.com.tw` | 市場領先 |
| 永豐金證券 | `stockchannelnew.sinotrade.com.tw` / `www.sinotrade.com.tw` | 市場領先 |
| 國泰證券 | `djinfo.cathaysec.com.tw` / `www.cathaysec.com.tw` | 市場領先 |
| 富果 Fugle | `www.fugle.tw` | 銀行兼營 |
| 台新證券 | `tssweb.tssco.com.tw` / `www.tssco.com.tw` | 銀行兼營 |
| 國票證券 | `www.ibfs.com.tw` | 銀行兼營 |
| 兆豐證券 | `moneydj.emega.com.tw` / `www.emega.com.tw` | 銀行兼營 |
| 新光證券 | `www.skis.com.tw` | 銀行兼營 |

> 透過錄製器或 Options 頁面可自行新增其他券商。

## 技術架構

```
Chrome Extension Manifest V3
├── Background Service Worker  — 標籤頁監控、跨頁通訊、設定管理、股票清單快取
│                                 頁面 Context 執行（MAIN world，繞過 CSP）
├── Content Scripts
│   ├── injector.js            — Shadow DOM (closed) 注入懸浮面板
│   ├── executor.js            — 頁面 Context DOM 操作（白名單函式）
│   └── recorder.js            — 動態注入的錄製模式邏輯
├── UI Panel                   — 觀察清單 + K 線週期 + 搜尋（注入至 Shadow DOM）
├── Options Page               — 4 頁籤：券商設定 / 新增券商 / JSON 編輯 / 關於
└── Utils
    └── selector-finder.js     — CSS Selector 自動產生器
```

### 資料來源

| 來源 | 用途 |
|------|------|
| TWSE OpenAPI `/v1/opendata/t187ap03_L` | 上市公司基本資料 |
| TWSE OpenAPI `/v1/exchangeReport/STOCK_DAY_AVG_ALL` | 上市全證券（含 ETF） |
| TPEx OpenAPI `/v1/mopsfin_t187ap03_O` | 上櫃公司基本資料 |
| TPEx OpenAPI `/v1/tpex_mainboard_daily_close_quotes` | 上櫃全證券 |

股票清單快取 7 天，擴充更新時自動清除快取。

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

1. 前往任一支援的券商看盤頁面（例如群益證券）
2. 點擊瀏覽器工具列的 UTR 圖示開啟遙控面板
3. 展開「目前股票」區塊切換 K 線週期
4. 搜尋或輸入股票代碼加入觀察清單
5. 點擊清單中的股票一鍵跳轉

### 一鍵更新

```bash
bash update.sh
```

從 GitHub 拉取最新版本並重新建構。

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
    "category": "市場領先",
    "stockUrlPattern": "https://tradeweb.capital.com.tw/TradingViewChart/KlineChart.aspx?s={code}",
    "stockCodeParam": "s",
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
├── manifest.json                  # Chrome Extension 設定（Manifest V3）
├── package.json                   # Node.js 專案設定
├── webpack.config.js              # Webpack 建構設定（含自動版本管理）
├── update.sh                      # 一鍵更新腳本
├── src/
│   ├── background/
│   │   └── service-worker.js      # Background Service Worker
│   ├── content/
│   │   ├── injector.js            # Shadow DOM 注入面板
│   │   ├── executor.js            # DOM 操作執行器（白名單）
│   │   └── recorder.js            # 錄製模式
│   ├── ui/
│   │   ├── panel.html             # 面板 HTML（備用 popup）
│   │   ├── panel.css              # 面板樣式
│   │   └── panel.js               # 面板邏輯
│   ├── options/
│   │   ├── options.html           # 設定頁面（4 頁籤）
│   │   └── options.js             # 設定邏輯
│   └── utils/
│       └── selector-finder.js     # CSS Selector 產生器
├── assets/
│   └── icons/                     # 16, 48, 128 PNG 圖示
└── dist/                          # 建構輸出（載入此資料夾至 Chrome）
```

## 安全性注意事項

- **Shadow DOM 隔離**：面板使用 `closed` Shadow DOM，防止券商網頁存取或修改
- **CSP 相容**：K 線週期切換透過 Service Worker `chrome.scripting.executeScript` 在 MAIN world 執行，無需 `eval` 或內聯腳本
- **腳本白名單**：`executor.js` 只允許執行預定義函式（`toggleIndicator`、`changeResolution`、`changeSymbol`）
- **最小權限**：`all_frames: false`，僅在最上層視窗注入面板

## 授權

MIT License
