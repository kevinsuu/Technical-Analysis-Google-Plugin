/**
 * Background Service Worker
 * 負責：標籤頁監控、跨分頁通訊、插件圖示狀態管理
 */

// ===== 安裝與初始化 =====
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // 首次安裝，寫入預設設定
    const { configs } = await chrome.storage.local.get('configs');
    if (!configs) {
      await chrome.storage.local.set({
        configs: getDefaultConfigs(),
        watchlist: getDefaultWatchlist(),
        settings: {
          panelPosition: 'right',
          panelWidth: 220,
          panelCollapsed: false,
          recordingMode: false,
        },
      });
    }
    // 開啟 Options 頁面引導設定
    chrome.runtime.openOptionsPage();
  }
});

// ===== 訊息路由 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    // 取得目前頁面對應的券商設定
    GET_CONFIG: handleGetConfig,
    // 儲存新的 action 設定（錄製器用）
    SAVE_ACTION: handleSaveAction,
    // 刪除 action
    DELETE_ACTION: handleDeleteAction,
    // 跨分頁跳轉個股
    NAVIGATE_STOCK: handleNavigateStock,
    // 切換錄製模式
    TOGGLE_RECORDING: handleToggleRecording,
    // 取得所有設定
    GET_ALL_CONFIGS: handleGetAllConfigs,
    // 更新完整設定
    UPDATE_CONFIGS: handleUpdateConfigs,
    // ===== 觀察清單 =====
    GET_WATCHLIST: handleGetWatchlist,
    ADD_TO_WATCHLIST: handleAddToWatchlist,
    REMOVE_FROM_WATCHLIST: handleRemoveFromWatchlist,
    REORDER_WATCHLIST: handleReorderWatchlist,
    // ===== 股票搜尋 =====
    SEARCH_STOCKS: handleSearchStocks,
    // ===== 頁面 Context 執行（繞過 CSP） =====
    EXEC_IN_PAGE: handleExecInPage,
  };

  const handler = handlers[message.type];
  if (handler) {
    handler(message, sender).then(sendResponse);
    return true; // 保持 sendResponse 可用（非同步）
  }
});

// ===== 標籤頁切換監控 =====
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateBadgeForTab(tab);
  } catch {
    // Tab 可能已關閉
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    updateBadgeForTab(tab);
  }
});

// ===== 插件圖示點擊 =====
chrome.action.onClicked.addListener(async (tab) => {
  // 向 content script 發送切換面板顯示的訊息
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    // 如果沒有收到回應，代表舊的 listener 已失效
    if (!resp) throw new Error('no response');
  } catch {
    // Content script 尚未載入或已失效，重新注入
    if (tab.url && isSupportedUrl(tab.url)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ['content/executor.js', 'content/injector.js'],
      });
      // 注入後面板預設收合，發送 TOGGLE 展開
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
      } catch { /* 忽略 */ }
    }
  }
});

// ===== Handler 實作 =====

async function handleGetConfig(message, sender) {
  const url = message.url || sender.tab?.url || '';
  const domain = extractDomain(url);
  const { configs } = await chrome.storage.local.get('configs');
  const config = configs?.[domain] || null;
  return { success: true, config, domain };
}

async function handleSaveAction(message) {
  const { domain, action } = message;
  const { configs } = await chrome.storage.local.get('configs');
  const current = configs || {};

  if (!current[domain]) {
    current[domain] = { name: domain, actions: [] };
  }

  // 若同 id 已存在則更新，否則新增
  const idx = current[domain].actions.findIndex((a) => a.id === action.id);
  if (idx >= 0) {
    current[domain].actions[idx] = action;
  } else {
    current[domain].actions.push(action);
  }

  await chrome.storage.local.set({ configs: current });
  return { success: true };
}

async function handleDeleteAction(message) {
  const { domain, actionId } = message;
  const { configs } = await chrome.storage.local.get('configs');
  if (configs?.[domain]) {
    configs[domain].actions = configs[domain].actions.filter(
      (a) => a.id !== actionId
    );
    await chrome.storage.local.set({ configs });
  }
  return { success: true };
}

async function handleNavigateStock(message, sender) {
  const { stockCode, targetDomain } = message;
  const { configs } = await chrome.storage.local.get('configs');
  const config = configs?.[targetDomain];

  if (!config?.stockUrlPattern) {
    return { success: false, error: '該券商未設定個股 URL 規則' };
  }

  const url = config.stockUrlPattern.replace('{code}', stockCode);

  // 尋找已開啟的該券商分頁，或開新分頁
  const tabs = await chrome.tabs.query({ url: `https://${targetDomain}/*` });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
  } else {
    await chrome.tabs.create({ url });
  }

  return { success: true };
}

async function handleToggleRecording(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { success: false };

  // 注入錄製腳本
  if (message.enabled) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/recorder.js'],
    });
  }

  await chrome.tabs.sendMessage(tabId, {
    type: 'SET_RECORDING',
    enabled: message.enabled,
  });

  return { success: true };
}

async function handleGetAllConfigs() {
  const data = await chrome.storage.local.get(['configs', 'settings']);
  return { success: true, ...data };
}

async function handleUpdateConfigs(message) {
  const updates = {};
  if (message.configs) updates.configs = message.configs;
  if (message.settings) updates.settings = message.settings;
  await chrome.storage.local.set(updates);
  return { success: true };
}

// ===== 觀察清單 Handler =====

async function handleGetWatchlist() {
  const { watchlist } = await chrome.storage.local.get('watchlist');
  return { success: true, watchlist: watchlist || getDefaultWatchlist() };
}

async function handleAddToWatchlist(message) {
  const { stock } = message; // { code, name }
  const { watchlist } = await chrome.storage.local.get('watchlist');
  const list = watchlist || getDefaultWatchlist();

  // 避免重複
  if (list.some((s) => s.code === stock.code)) {
    return { success: false, error: '已在觀察清單中' };
  }

  list.push({ code: stock.code, name: stock.name || stock.code });
  await chrome.storage.local.set({ watchlist: list });
  return { success: true, watchlist: list };
}

async function handleRemoveFromWatchlist(message) {
  const { code } = message;
  const { watchlist } = await chrome.storage.local.get('watchlist');
  const list = (watchlist || []).filter((s) => s.code !== code);
  await chrome.storage.local.set({ watchlist: list });
  return { success: true, watchlist: list };
}

async function handleReorderWatchlist(message) {
  const { watchlist: newOrder } = message;
  await chrome.storage.local.set({ watchlist: newOrder });
  return { success: true, watchlist: newOrder };
}

function getDefaultWatchlist() {
  return [
    { code: '2330', name: '台積電' },
    { code: '2317', name: '鴻海' },
    { code: '2454', name: '聯發科' },
    { code: '2308', name: '台達電' },
    { code: '3008', name: '大立光' },
    { code: '2881', name: '富邦金' },
    { code: '2882', name: '國泰金' },
    { code: '1326', name: '台化' },
    { code: '2603', name: '長榮' },
    { code: '2609', name: '陽明' },
  ];
}

// ===== 股票清單（TWSE + TPEx） =====

const STOCK_LIST_CACHE_KEY = 'stockListCache';
const STOCK_LIST_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

async function fetchAndCacheStockList() {
  const { [STOCK_LIST_CACHE_KEY]: cached } = await chrome.storage.local.get(STOCK_LIST_CACHE_KEY);
  if (cached && Date.now() - cached.timestamp < STOCK_LIST_TTL) {
    return cached.list;
  }

  const list = [];

  try {
    // 上市股票 (TWSE)
    const twseResp = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
    if (twseResp.ok) {
      const twseData = await twseResp.json();
      for (const item of twseData) {
        const code = item['公司代號']?.trim();
        const name = item['公司簡稱']?.trim();
        if (code && name) list.push({ code, name, market: 'twse' });
      }
    }
  } catch (e) {
    console.warn('[UTR] TWSE 股票清單取得失敗:', e);
  }

  try {
    // 上櫃股票 (TPEx)
    const tpexResp = await fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O');
    if (tpexResp.ok) {
      const tpexData = await tpexResp.json();
      for (const item of tpexData) {
        const code = item['SecuritiesCompanyCode']?.trim();
        const name = item['CompanyAbbreviation']?.trim();
        if (code && name) list.push({ code, name, market: 'tpex' });
      }
    }
  } catch (e) {
    console.warn('[UTR] TPEx 股票清單取得失敗:', e);
  }

  if (list.length > 0) {
    await chrome.storage.local.set({
      [STOCK_LIST_CACHE_KEY]: { list, timestamp: Date.now() },
    });
  }

  return list;
}

async function handleSearchStocks(message) {
  const query = (message.query || '').trim();
  if (!query) return { success: true, results: [] };

  const list = await fetchAndCacheStockList();
  if (!list || list.length === 0) {
    return { success: false, error: '無法取得股票清單' };
  }

  const q = query.toLowerCase();
  const results = [];

  for (const stock of list) {
    if (results.length >= 10) break;
    if (stock.code.startsWith(q) || stock.name.toLowerCase().includes(q)) {
      results.push({ code: stock.code, name: stock.name });
    }
  }

  return { success: true, results };
}

// ===== 頁面 Context 執行 =====

async function handleExecInPage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { success: false, error: 'no tab' };

  const { action, resolution, period, stockCode } = message;

  if (action === 'CHANGE_RESOLUTION') {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (res, per, code) => {
          // 方法1：TradingView Widget API（主頁面）
          if (window.tvWidget) {
            try { window.tvWidget.activeChart().setResolution(res); return; } catch (e) {}
          }
          // 方法2：遍歷所有可能的 TradingView 全域變數
          const possibleNames = ['tvWidget', 'widget', 'tvwidget', 'TradingView', '_tv'];
          for (const name of possibleNames) {
            const w = window[name];
            if (w && typeof w.activeChart === 'function') {
              try { w.activeChart().setResolution(res); return; } catch (e) {}
            }
          }
          // 方法3：尋找 iframe 中的 tvWidget
          try {
            const frames = document.querySelectorAll('iframe');
            for (const frame of frames) {
              try {
                const fw = frame.contentWindow;
                if (fw?.tvWidget) {
                  fw.tvWidget.activeChart().setResolution(res);
                  return;
                }
              } catch (e) {}
            }
          } catch (e) {}
          // 方法4：模擬點擊頁面上的週期按鈕
          const selectors = [
            `[data-value="${res}"]`,
            `[data-resolution="${res}"]`,
            `[data-period="${per}"]`,
          ];
          for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) { btn.click(); return; }
          }
          // 方法5：群益 POST + 重載
          if (location.hostname.includes('capital.com.tw') && code) {
            const fd = new FormData();
            fd.append('s', code);
            fd.append('period', per);
            fd.append('m', '0');
            fetch('/Public/Ajax/KLine.ashx', { method: 'POST', body: fd })
              .then(() => location.reload());
          }
        },
        args: [resolution, period, stockCode],
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'unknown action' };
}

// ===== 工具函式 =====

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isSupportedUrl(url) {
  const domain = extractDomain(url);
  const supported = [
    'capital.com.tw',
    'yuanta.com.tw',
    'kgieworld.com.tw',
    'fbs.com.tw',
    'sinotrade.com.tw',
    'cathaysec.com.tw',
    'fugle.tw',
    'tssco.com.tw',
    'ibfs.com.tw',
    'emega.com.tw',
    'skis.com.tw',
  ];
  return supported.some((d) => domain.includes(d));
}

async function updateBadgeForTab(tab) {
  if (!tab?.url) return;
  const domain = extractDomain(tab.url);
  const { configs } = await chrome.storage.local.get('configs');

  if (configs?.[domain]) {
    chrome.action.setBadgeText({ text: 'ON', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: tab.id });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tab.id });
  }
}

// ===== 預設設定 =====

function getDefaultConfigs() {
  return {
    // ===== 群益金鼎證券 =====
    'tradeweb.capital.com.tw': {
      name: '群益證券',
      category: '市場領先',
      stockUrlPattern:
        'https://tradeweb.capital.com.tw/TradingViewChart/KlineChart.aspx?s={code}',
      stockCodeParam: 's',
      actions: [],
    },

    // ===== 元大證券 =====
    'ytdf.yuanta.com.tw': {
      name: '元大證券',
      category: '市場領先',
      stockUrlPattern:
        'https://ytdf.yuanta.com.tw/prod/YesiDmz/StockPreview/{code}',
      stockCodeParam: null, // 代碼在 path 中
      actions: [],
    },

    // ===== 凱基證券 =====
    'h5webtrade.kgieworld.com.tw': {
      name: '凱基證券',
      category: '市場領先',
      stockUrlPattern:
        'https://h5webtrade.kgieworld.com.tw/',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 富邦證券 =====
    'fubon-ebrokerdj.fbs.com.tw': {
      name: '富邦證券',
      category: '市場領先',
      stockUrlPattern:
        'https://fubon-ebrokerdj.fbs.com.tw/z/zc/zcw/zcw1_{code}.djhtm',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 永豐金證券 (大戶投) =====
    'stockchannelnew.sinotrade.com.tw': {
      name: '永豐金證券',
      category: '市場領先',
      stockUrlPattern:
        'https://www.sinotrade.com.tw/Stock/Stock_3_1/{code}',
      stockCodeParam: null,
      actions: [],
    },
    'www.sinotrade.com.tw': {
      name: '永豐金證券',
      category: '市場領先',
      stockUrlPattern:
        'https://www.sinotrade.com.tw/Stock/Stock_3_1/{code}',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 國泰綜合證券 =====
    'djinfo.cathaysec.com.tw': {
      name: '國泰證券',
      category: '市場領先',
      stockUrlPattern:
        'https://djinfo.cathaysec.com.tw/z/zc/zcw/zcw.djhtm?A={code}',
      stockCodeParam: 'A',
      actions: [],
    },
    'www.cathaysec.com.tw': {
      name: '國泰證券',
      category: '市場領先',
      stockUrlPattern:
        'https://djinfo.cathaysec.com.tw/z/zc/zcw/zcw.djhtm?A={code}',
      stockCodeParam: 'A',
      actions: [],
    },

    // ===== 玉山證券 / 富果 Fugle =====
    'www.fugle.tw': {
      name: '富果 Fugle',
      category: '銀行兼營',
      stockUrlPattern:
        'https://www.fugle.tw/ai/{code}',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 台新證券 =====
    'tssweb.tssco.com.tw': {
      name: '台新證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://tssweb.tssco.com.tw/',
      stockCodeParam: null,
      actions: [],
    },
    'www.tssco.com.tw': {
      name: '台新證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://tssweb.tssco.com.tw/',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 國票證券 =====
    'www.ibfs.com.tw': {
      name: '國票證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://www.ibfs.com.tw/',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 兆豐證券 =====
    'moneydj.emega.com.tw': {
      name: '兆豐證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://moneydj.emega.com.tw/z/zc/zcw/zcw1_{code}.djhtm',
      stockCodeParam: null,
      actions: [],
    },
    'www.emega.com.tw': {
      name: '兆豐證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://moneydj.emega.com.tw/z/zc/zcw/zcw1_{code}.djhtm',
      stockCodeParam: null,
      actions: [],
    },

    // ===== 新光證券 =====
    'www.skis.com.tw': {
      name: '新光證券',
      category: '銀行兼營',
      stockUrlPattern:
        'https://www.skis.com.tw/',
      stockCodeParam: null,
      actions: [],
    },
  };
}
