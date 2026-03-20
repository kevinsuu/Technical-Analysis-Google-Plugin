/**
 * Content Script - Injector
 * 注入 Shadow DOM 懸浮觀察清單面板
 * 始終浮動在頁面，點擊 V 摺疊/展開，X 關閉（含確認）
 */

(function () {
  // 只在最上層視窗注入，iframe 不注入
  if (window !== window.top) return;

  // ===== 安全 API 呼叫（擴充重載後 context 會失效） =====
  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function safeSendMessage(msg) {
    if (!isContextValid()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  function safeStorageGet(key) {
    if (!isContextValid()) return Promise.resolve({});
    try {
      return chrome.storage.local.get(key).catch(() => ({}));
    } catch {
      return Promise.resolve({});
    }
  }

  function safeStorageSet(obj) {
    if (!isContextValid()) return;
    try { chrome.storage.local.set(obj); } catch {}
  }

  // 若已存在（擴充重載後重新注入），移除舊的再重建
  const oldRoot = document.getElementById('utr-root');
  if (oldRoot) oldRoot.remove();

  // ===== 狀態 =====
  let watchlist = [];
  let currentStockCode = extractStockCodeFromUrl();
  let currentStockName = '';
  let config = null;
  let isExpanded = false;
  // (per-stock timeframe bar removed — top-level timeframe section is sufficient)
  let searchResults = [];
  let selectedResultIndex = -1;
  let searchDebounceTimer = null;
  let activePeriod = null; // 當前選中的時間週期 period 值
  let dragState = null; // 拖曳排序狀態
  let tfSectionExpanded = false; // 時區區塊是否展開（預設摺疊）
  let activeTab = null; // 當前展開的分頁（'分' | '小時' | '天' | null）
  let priceAlerts = []; // 價格提醒清單
  let alertSectionExpanded = false; // 提醒區塊是否展開
  let showAddAlertForm = false; // 是否顯示新增提醒表單

  // 時間週期選項，按分組排列（period = 群益 KLine.ashx 的 period 參數）
  const TIMEFRAME_GROUPS = [
    {
      group: '分',
      items: [
        { resolution: '1',  label: '1 分鐘',  period: '1' },
        { resolution: '3',  label: '3 分鐘',  period: '8' },
        { resolution: '5',  label: '5 分鐘',  period: '2' },
        { resolution: '10', label: '10 分鐘', period: '9' },
        { resolution: '15', label: '15 分鐘', period: '3' },
        { resolution: '20', label: '20 分鐘', period: '10' },
        { resolution: '30', label: '30 分鐘', period: '4' },
        { resolution: '45', label: '45 分鐘', period: '11' },
        { resolution: '90', label: '90 分鐘', period: '12' },
      ],
    },
    {
      group: '小時',
      items: [
        { resolution: '60',  label: '1 小時', period: '5' },
        { resolution: '120', label: '2 小時', period: '13' },
        { resolution: '180', label: '3 小時', period: '14' },
        { resolution: '240', label: '4 小時', period: '15' },
      ],
    },
    {
      group: '天',
      items: [
        { resolution: 'D', label: '1 天', period: '6' },
        { resolution: 'W', label: '1 周', period: '7' },
        { resolution: 'M', label: '1 月', period: '16' },
      ],
    },
  ];

  // ===== Shadow DOM =====
  const host = document.createElement('div');
  host.id = 'utr-root';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = getStyles();
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'utr-panel';
  shadow.appendChild(panel);

  // 確認對話框容器（在 shadow 內，避免被外部 CSS 影響）
  const confirmOverlay = document.createElement('div');
  confirmOverlay.className = 'utr-confirm-overlay';
  shadow.appendChild(confirmOverlay);

  document.documentElement.appendChild(host);

  // ===== 初始化 =====
  init().catch(() => {});

  async function init() {
    const [configResp, watchlistResp, panelState, alertsResp] = await Promise.all([
      safeSendMessage({ type: 'GET_CONFIG', url: window.location.href }),
      safeSendMessage({ type: 'GET_WATCHLIST' }),
      safeStorageGet('panelExpanded'),
      safeSendMessage({ type: 'GET_PRICE_ALERTS' }),
    ]);
    watchlist = watchlistResp?.watchlist || [];
    config = configResp?.config;
    priceAlerts = alertsResp?.alerts || [];
    // 還原面板展開狀態
    if (panelState.panelExpanded === true) {
      isExpanded = true;
    }

    render();
    bindEvents();

    // 非同步查詢目前股票名稱（不阻塞初始渲染）
    if (currentStockCode) {
      safeSendMessage({ type: 'LOOKUP_STOCK', code: currentStockCode }).then(resp => {
        if (resp?.success && resp.name) {
          currentStockName = resp.name;
          render();
        }
      }).catch(() => {});
    }
  }

  // ===== 來自 background 的切換 =====
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'TOGGLE_PANEL') {
        if (panel.classList.contains('utr-panel--closed')) {
          panel.classList.remove('utr-panel--closed');
        }
        isExpanded = !isExpanded;
        render();
        sendResponse({ ok: true });
      }
      if (msg.type === 'PRICE_ALERTS_UPDATED') {
        priceAlerts = msg.alerts || [];
        render();
      }
    });
  } catch {}

  // ===== 渲染 =====
  function render() {
    panel.innerHTML = buildHTML();
    panel.classList.toggle('utr-panel--expanded', isExpanded);
  }

  function buildHTML() {
    const chevronSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${isExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>`;

    let html = `
      <div class="utr-bar">
        <div class="utr-bar-left" data-action="toggle">
          <svg class="utr-bar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M3 14h7v7H3z"/><path d="M14 14h7v7h-7z"/></svg>
          <span class="utr-bar-title">觀察清單</span>
          <span class="utr-bar-count">${watchlist.length}</span>
        </div>
        <div class="utr-bar-right">
          <button class="utr-bar-btn" data-action="toggle" title="${isExpanded ? '收合' : '展開'}">
            ${chevronSvg}
          </button>
          <button class="utr-bar-btn" data-action="close" title="關閉面板">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;

    if (isExpanded) {
      // 時區切換區塊（可摺疊，分頁 + 下拉選單）
      if (currentStockCode) {
        const stockName = currentStockName || watchlist.find(s => s.code === currentStockCode)?.name || '';
        const activeGroup = TIMEFRAME_GROUPS.find(g => g.group === activeTab);
        const tfChevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${tfSectionExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>`;
        html += `
        <div class="utr-tf-section">
          <div class="utr-tf-header" data-action="toggle-tf-section">
            <div class="utr-tf-header-left">
              <span class="utr-tf-current-label">目前股票</span>
              <span class="utr-tf-current-code">${currentStockCode}${stockName ? ' ' + stockName : ''}</span>
            </div>
            <span class="utr-tf-toggle">${tfChevron}</span>
          </div>
          ${tfSectionExpanded ? `
          <div class="utr-tf-body">
            <div class="utr-tf-tabs">
              ${TIMEFRAME_GROUPS.map(g => `
                <button class="utr-tf-tab ${activeTab === g.group ? 'utr-tf-tab--active' : ''}" data-action="switch-tf-tab" data-group="${g.group}">
                  ${g.group}
                  <svg class="utr-tf-tab-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="${activeTab === g.group ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>
                </button>
              `).join('')}
            </div>
            ${activeGroup ? `
            <div class="utr-tf-dropdown-list">
              ${activeGroup.items.map(tf => `
                <div class="utr-tf-item ${activePeriod === tf.period ? 'utr-tf-item--active' : ''}" data-action="change-timeframe" data-resolution="${tf.resolution}" data-period="${tf.period}">
                  ${tf.label}
                </div>
              `).join('')}
            </div>` : ''}
          </div>` : ''}
        </div>`;
      }

      html += `
      <div class="utr-content">
        <div class="utr-search-wrap">
          <div class="utr-search">
            <svg class="utr-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="utr-search-input" type="text" placeholder="代碼或名稱  例 2330 / 台積電" data-role="stock-code" autocomplete="off" />
            <button class="utr-add-btn" data-action="add-watchlist" title="加入清單">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          ${searchResults.length > 0 ? `
          <div class="utr-dropdown" data-role="search-dropdown">
            ${searchResults.map((s, i) => `
              <div class="utr-dropdown-item ${i === selectedResultIndex ? 'utr-dropdown-item--active' : ''}">
                <span class="utr-dropdown-code">${s.code}</span>
                <span class="utr-dropdown-name">${s.name}</span>
                <button class="utr-dropdown-add" data-action="select-search-result" data-result-code="${s.code}" data-result-name="${s.name}" title="加入觀察清單">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
        <div class="utr-list" data-role="watchlist">
      `;

      if (watchlist.length === 0) {
        html += `<div class="utr-empty">尚無觀察股票</div>`;
      } else {
        for (const stock of watchlist) {
          const isActive = stock.code === currentStockCode;
          html += `
          <div class="utr-item-wrap" data-drag-code="${stock.code}">
            <div class="utr-item ${isActive ? 'utr-item--active' : ''}" data-stock-code="${stock.code}">
              <div class="utr-drag-handle" data-action="drag-handle">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/></svg>
              </div>
              <div class="utr-item-left">
                <span class="utr-item-code">${stock.code}</span>
                <span class="utr-item-name">${stock.name}</span>
              </div>
              <button class="utr-item-del" data-action="remove-watchlist" data-code="${stock.code}" title="移除">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>`;
        }
      }

      html += `</div></div>`;

      // ===== 價格提醒區塊 =====
      const alertChevron = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${alertSectionExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>`;
      const pendingAlerts = priceAlerts.filter(a => !a.triggered);
      const triggeredAlerts = priceAlerts.filter(a => a.triggered);

      html += `
      <div class="utr-alert-section">
        <div class="utr-alert-header" data-action="toggle-alert-section">
          <div class="utr-alert-header-left">
            <svg class="utr-alert-bell" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span class="utr-alert-title">價格提醒</span>
            <span class="utr-bar-count">${pendingAlerts.length}</span>
          </div>
          <span class="utr-tf-toggle">${alertChevron}</span>
        </div>`;

      if (alertSectionExpanded) {
        html += `<div class="utr-alert-body">`;

        // 新增提醒按鈕或表單
        if (showAddAlertForm) {
          const alertCode = currentStockCode || '';
          const alertName = currentStockName || '';
          html += `
          <div class="utr-alert-form">
            <div class="utr-alert-form-row">
              <input class="utr-alert-input utr-alert-input--code" type="text" value="${alertCode}" placeholder="股票代碼" data-role="alert-code" />
              <span class="utr-alert-form-name" data-role="alert-name-display">${alertName}</span>
            </div>
            <div class="utr-alert-form-row">
              <select class="utr-alert-select" data-role="alert-condition">
                <option value="above">突破 ≥</option>
                <option value="below">跌破 ≤</option>
              </select>
              <input class="utr-alert-input utr-alert-input--price" type="number" step="0.01" placeholder="目標價格" data-role="alert-price" />
            </div>
            <div class="utr-alert-form-actions">
              <button class="utr-alert-form-btn utr-alert-form-btn--cancel" data-action="cancel-add-alert">取消</button>
              <button class="utr-alert-form-btn utr-alert-form-btn--save" data-action="save-alert">新增</button>
            </div>
          </div>`;
        } else {
          html += `
          <button class="utr-alert-add-btn" data-action="show-add-alert">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新增提醒
          </button>`;
        }

        // 待觸發提醒
        if (pendingAlerts.length > 0) {
          for (const a of pendingAlerts) {
            const condIcon = a.condition === 'above' ? '↑' : '↓';
            const condClass = a.condition === 'above' ? 'utr-alert-cond--above' : 'utr-alert-cond--below';
            html += `
            <div class="utr-alert-item">
              <div class="utr-alert-item-left">
                <span class="utr-alert-item-code">${a.code}</span>
                <span class="utr-alert-item-name">${a.name}</span>
              </div>
              <div class="utr-alert-item-right">
                <span class="utr-alert-cond ${condClass}">${condIcon} ${a.price}</span>
                <button class="utr-alert-item-del" data-action="remove-alert" data-alert-id="${a.id}" title="刪除提醒">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>`;
          }
        }

        // 已觸發提醒
        if (triggeredAlerts.length > 0) {
          html += `<div class="utr-alert-triggered-header">
            <span>已觸發</span>
            <button class="utr-alert-clear-btn" data-action="clear-triggered-alerts">清除</button>
          </div>`;
          for (const a of triggeredAlerts) {
            const condIcon = a.condition === 'above' ? '↑' : '↓';
            const time = new Date(a.triggeredAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
            html += `
            <div class="utr-alert-item utr-alert-item--triggered">
              <div class="utr-alert-item-left">
                <span class="utr-alert-item-code">${a.code}</span>
                <span class="utr-alert-item-name">${a.name}</span>
              </div>
              <div class="utr-alert-item-right">
                <span class="utr-alert-cond utr-alert-cond--triggered">${condIcon} ${a.price}</span>
                <span class="utr-alert-time">${time}</span>
              </div>
            </div>`;
          }
        }

        if (pendingAlerts.length === 0 && triggeredAlerts.length === 0 && !showAddAlertForm) {
          html += `<div class="utr-empty" style="padding:12px">尚無價格提醒</div>`;
        }

        html += `</div>`;
      }

      html += `</div>`;
    }

    return html;
  }

  // ===== 確認對話框 =====
  function showCloseConfirm() {
    confirmOverlay.innerHTML = `
      <div class="utr-confirm-backdrop" data-action="confirm-cancel"></div>
      <div class="utr-confirm-box">
        <div class="utr-confirm-title">關閉觀察清單</div>
        <div class="utr-confirm-msg">確定要關閉面板嗎？<br>可從擴充工具列重新開啟。</div>
        <div class="utr-confirm-actions">
          <button class="utr-confirm-btn utr-confirm-btn--cancel" data-action="confirm-cancel">取消</button>
          <button class="utr-confirm-btn utr-confirm-btn--ok" data-action="confirm-close">確定關閉</button>
        </div>
      </div>
    `;
    confirmOverlay.classList.add('utr-confirm-overlay--show');
  }

  function hideCloseConfirm() {
    confirmOverlay.classList.remove('utr-confirm-overlay--show');
    confirmOverlay.innerHTML = '';
  }

  // ===== 事件 =====
  function bindEvents() {
    panel.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action], [data-stock-code]');
      if (!target) return;

      const action = target.dataset.action;

      if (action === 'drag-handle') return;

      if (action === 'toggle') {
        isExpanded = !isExpanded;
        safeStorageSet({ panelExpanded: isExpanded });
        render();
        return;
      }

      if (action === 'close') {
        showCloseConfirm();
        return;
      }

      if (action === 'add-watchlist') {
        const input = panel.querySelector('[data-role="stock-code"]');
        const code = input?.value?.trim();
        if (!code) return;
        // 嘗試從搜尋結果中找到對應的名稱
        const matched = searchResults.find(s => s.code === code);
        const name = matched?.name || code;
        const resp = await safeSendMessage({
          type: 'ADD_TO_WATCHLIST',
          stock: { code, name },
        });
        if (resp?.success) {
          watchlist = resp.watchlist;
          input.value = '';
          searchResults = [];
          selectedResultIndex = -1;
          render();
        }
        return;
      }

      if (action === 'select-search-result') {
        const code = target.dataset.resultCode;
        const name = target.dataset.resultName;
        const resp = await safeSendMessage({
          type: 'ADD_TO_WATCHLIST',
          stock: { code, name },
        });
        if (resp?.success) {
          watchlist = resp.watchlist;
          searchResults = [];
          selectedResultIndex = -1;
          render();
        }
        return;
      }

      if (action === 'toggle-tf-section') {
        tfSectionExpanded = !tfSectionExpanded;
        if (!tfSectionExpanded) activeTab = null;
        render();
        return;
      }

      if (action === 'switch-tf-tab') {
        const group = target.dataset.group;
        activeTab = activeTab === group ? null : group;
        render();
        return;
      }

      if (action === 'change-timeframe') {
        e.stopPropagation();
        const resolution = target.dataset.resolution;
        const period = target.dataset.period;

        activePeriod = period;

        // 透過 service worker 在頁面 MAIN world 執行（繞過 CSP 限制）
        safeSendMessage({
          type: 'EXEC_IN_PAGE',
          action: 'CHANGE_RESOLUTION',
          resolution,
          period,
          stockCode: currentStockCode,
        });

        render();
        return;
      }

      if (action === 'remove-watchlist') {
        e.stopPropagation();
        const code = target.dataset.code;
        const resp = await safeSendMessage({
          type: 'REMOVE_FROM_WATCHLIST',
          code,
        });
        if (resp?.success) {
          watchlist = resp.watchlist;
          render();
        }
        return;
      }

      // ===== 價格提醒動作 =====
      if (action === 'toggle-alert-section') {
        alertSectionExpanded = !alertSectionExpanded;
        render();
        return;
      }

      if (action === 'show-add-alert') {
        showAddAlertForm = true;
        render();
        // 自動 focus 價格欄位
        setTimeout(() => {
          const priceInput = panel.querySelector('[data-role="alert-price"]');
          if (priceInput) priceInput.focus();
        }, 50);
        return;
      }

      if (action === 'cancel-add-alert') {
        showAddAlertForm = false;
        render();
        return;
      }

      if (action === 'save-alert') {
        const codeInput = panel.querySelector('[data-role="alert-code"]');
        const condSelect = panel.querySelector('[data-role="alert-condition"]');
        const priceInput = panel.querySelector('[data-role="alert-price"]');
        const code = codeInput?.value?.trim();
        const condition = condSelect?.value;
        const price = priceInput?.value?.trim();

        if (!code || !price) return;

        // 查詢股票名稱
        let name = code;
        try {
          const lookup = await safeSendMessage({ type: 'LOOKUP_STOCK', code });
          if (lookup?.success && lookup.name) name = lookup.name;
        } catch {}

        const resp = await safeSendMessage({
          type: 'ADD_PRICE_ALERT',
          code, name, condition, price,
        });
        if (resp?.success) {
          priceAlerts = resp.alerts;
          showAddAlertForm = false;
          render();
        }
        return;
      }

      if (action === 'remove-alert') {
        e.stopPropagation();
        const alertId = target.dataset.alertId;
        const resp = await safeSendMessage({
          type: 'REMOVE_PRICE_ALERT',
          alertId,
        });
        if (resp?.success) {
          priceAlerts = resp.alerts;
          render();
        }
        return;
      }

      if (action === 'clear-triggered-alerts') {
        const resp = await safeSendMessage({
          type: 'CLEAR_TRIGGERED_ALERTS',
        });
        if (resp?.success) {
          priceAlerts = resp.alerts;
          render();
        }
        return;
      }

      const stockCode = target.dataset.stockCode;
      if (stockCode && stockCode !== currentStockCode) {
        navigateToStock(stockCode);
      }
    });

    // 確認對話框事件
    confirmOverlay.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      if (target.dataset.action === 'confirm-close') {
        hideCloseConfirm();
        panel.classList.add('utr-panel--closed');
      } else if (target.dataset.action === 'confirm-cancel') {
        hideCloseConfirm();
      }
    });

    // 提醒代碼輸入事件（自動查詢名稱）
    let alertCodeTimer = null;
    panel.addEventListener('input', (e) => {
      if (e.target.dataset.role === 'alert-code') {
        clearTimeout(alertCodeTimer);
        const code = e.target.value.trim();
        const nameDisplay = panel.querySelector('[data-role="alert-name-display"]');
        if (!code || !nameDisplay) return;
        alertCodeTimer = setTimeout(async () => {
          try {
            const resp = await safeSendMessage({ type: 'LOOKUP_STOCK', code });
            const el = panel.querySelector('[data-role="alert-name-display"]');
            if (el) el.textContent = resp?.success ? resp.name : '';
          } catch {}
        }, 300);
      }
    });

    // 搜尋輸入事件（debounce）
    panel.addEventListener('input', (e) => {
      if (e.target.dataset.role !== 'stock-code') return;
      clearTimeout(searchDebounceTimer);
      const query = e.target.value.trim();
      if (!query) {
        searchResults = [];
        selectedResultIndex = -1;
        renderDropdown();
        return;
      }
      searchDebounceTimer = setTimeout(async () => {
        try {
          const resp = await safeSendMessage({ type: 'SEARCH_STOCKS', query });
          if (resp?.success) {
            searchResults = resp.results;
            selectedResultIndex = -1;
            renderDropdown();
          }
        } catch {}
      }, 200);
    });

    panel.addEventListener('keydown', (e) => {
      if (e.target.dataset.role !== 'stock-code') return;

      // 下拉選單鍵盤導航
      if (searchResults.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedResultIndex = Math.min(selectedResultIndex + 1, searchResults.length - 1);
          renderDropdown();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedResultIndex = Math.max(selectedResultIndex - 1, -1);
          renderDropdown();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedResultIndex >= 0) {
            const selected = searchResults[selectedResultIndex];
            // 只填入搜尋框，不自動加入觀察清單
            e.target.value = selected.code;
            searchResults = [];
            selectedResultIndex = -1;
            renderDropdown();
          }
          return;
        }
        if (e.key === 'Escape') {
          searchResults = [];
          selectedResultIndex = -1;
          renderDropdown();
          return;
        }
      }

      // 沒有下拉結果時，Enter 不做任何事（不跳轉頁面）
      if (e.key === 'Enter') {
        e.preventDefault();
      }
    });

    enableDrag();
    enableListReorder();
  }

  // 局部更新下拉選單（不重建整個面板，保留 input focus）
  function renderDropdown() {
    const wrap = panel.querySelector('.utr-search-wrap');
    if (!wrap) return;
    const oldDropdown = wrap.querySelector('.utr-dropdown');
    if (oldDropdown) oldDropdown.remove();

    if (searchResults.length > 0) {
      const dropdown = document.createElement('div');
      dropdown.className = 'utr-dropdown';
      dropdown.dataset.role = 'search-dropdown';
      dropdown.innerHTML = searchResults.map((s, i) => `
        <div class="utr-dropdown-item ${i === selectedResultIndex ? 'utr-dropdown-item--active' : ''}">
          <span class="utr-dropdown-code">${s.code}</span>
          <span class="utr-dropdown-name">${s.name}</span>
          <button class="utr-dropdown-add" data-action="select-search-result" data-result-code="${s.code}" data-result-name="${s.name}" title="加入觀察清單">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      `).join('');
      wrap.appendChild(dropdown);
    }
  }

  async function addStockFromSearch(code, name) {
    const resp = await safeSendMessage({
      type: 'ADD_TO_WATCHLIST',
      stock: { code, name },
    });
    if (resp?.success) {
      watchlist = resp.watchlist;
      searchResults = [];
      selectedResultIndex = -1;
      render();
    }
  }

  function navigateToStock(code) {
    const url = config?.stockUrlPattern?.replace('{code}', code);
    if (url) {
      // 跳轉前保存面板展開狀態
      safeStorageSet({ panelExpanded: isExpanded });
      currentStockCode = code;
      window.location.href = url;
    }
  }

  // ===== 拖曳 =====
  function enableDrag() {
    let isDragging = false;
    let wasDragged = false;
    let startX, startY, startRight, startTop;

    panel.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.utr-bar')) return;
      if (e.target.closest('button')) return;

      isDragging = true;
      wasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startRight = window.innerWidth - rect.right;
      startTop = rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragged = true;
      panel.style.right = Math.max(0, startRight - dx) + 'px';
      panel.style.top = Math.max(0, startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      panel.style.transition = '';
      if (wasDragged) {
        panel.addEventListener('click', (ev) => { ev.stopImmediatePropagation(); }, { once: true, capture: true });
      }
    });
  }

  // ===== 清單拖曳排序 =====
  function enableListReorder() {
    let dragEl = null;
    let placeholder = null;
    let offsetY = 0;
    let listEl = null;

    panel.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-action="drag-handle"]');
      if (!handle) return;

      const wrap = handle.closest('.utr-item-wrap');
      if (!wrap) return;

      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);

      listEl = panel.querySelector('[data-role="watchlist"]');
      if (!listEl) return;

      dragEl = wrap;
      const rect = dragEl.getBoundingClientRect();
      const listRect = listEl.getBoundingClientRect();
      startY = e.clientY;
      offsetY = e.clientY - rect.top;

      // 建立佔位元素
      placeholder = document.createElement('div');
      placeholder.className = 'utr-item-placeholder';
      placeholder.style.height = rect.height + 'px';
      dragEl.parentNode.insertBefore(placeholder, dragEl);

      // 設定拖曳元素樣式
      dragEl.classList.add('utr-item-wrap--dragging');
      dragEl.style.width = rect.width + 'px';
      dragEl.style.top = (rect.top - listRect.top + listEl.scrollTop) + 'px';

      dragState = { pointerId: e.pointerId };
    });

    panel.addEventListener('pointermove', (e) => {
      if (!dragEl || !dragState) return;

      const listRect = listEl.getBoundingClientRect();
      const newTop = e.clientY - offsetY - listRect.top + listEl.scrollTop;
      dragEl.style.top = newTop + 'px';

      // 尋找插入位置
      const wraps = Array.from(listEl.querySelectorAll('.utr-item-wrap:not(.utr-item-wrap--dragging)'));
      let inserted = false;
      for (const w of wraps) {
        const wRect = w.getBoundingClientRect();
        const midY = wRect.top + wRect.height / 2;
        if (e.clientY < midY) {
          listEl.insertBefore(placeholder, w);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        listEl.appendChild(placeholder);
      }
    });

    panel.addEventListener('pointerup', async () => {
      if (!dragEl || !dragState) return;

      // 將拖曳元素放到 placeholder 位置
      placeholder.parentNode.insertBefore(dragEl, placeholder);
      placeholder.remove();
      dragEl.classList.remove('utr-item-wrap--dragging');
      dragEl.style.width = '';
      dragEl.style.top = '';

      // 讀取新順序
      const newOrder = Array.from(listEl.querySelectorAll('.utr-item-wrap'))
        .map(el => el.dataset.dragCode)
        .filter(Boolean);

      const reordered = newOrder.map(code => watchlist.find(s => s.code === code)).filter(Boolean);

      dragEl = null;
      placeholder = null;
      dragState = null;

      if (reordered.length === watchlist.length) {
        watchlist = reordered;
        await safeSendMessage({
          type: 'REORDER_WATCHLIST',
          watchlist: reordered,
        });
      }
    });

    panel.addEventListener('pointercancel', () => {
      if (!dragEl) return;
      if (placeholder?.parentNode) placeholder.remove();
      dragEl.classList.remove('utr-item-wrap--dragging');
      dragEl.style.width = '';
      dragEl.style.top = '';
      dragEl = null;
      placeholder = null;
      dragState = null;
    });
  }

  // ===== 工具 =====
  function extractStockCodeFromUrl() {
    try {
      const url = window.location.href;
      const params = new URLSearchParams(window.location.search);
      const paramCode = params.get('s') || params.get('A') || params.get('symbol') || params.get('code');
      if (paramCode) return paramCode;
      const pathMatch = url.match(/\/(\d{4,6})(?:[.?/]|$)/);
      if (pathMatch) return pathMatch[1];
      const djMatch = url.match(/[_](\d{4,6})\.djhtm/);
      if (djMatch) return djMatch[1];
      return '';
    } catch { return ''; }
  }

  // ===== 樣式 =====
  function getStyles() {
    return `
      :host { all: initial; }

      /* ========== 面板 ========== */
      .utr-panel {
        position: fixed;
        right: 16px;
        top: 10%;
        width: 240px;
        background: rgba(30,30,34,0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 14px;
        box-shadow:
          0 20px 60px rgba(0,0,0,0.4),
          0 0 0 1px rgba(255,255,255,0.03) inset;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        font-size: 13px;
        color: #d4d4d8;
        z-index: 2147483647;
        overflow: hidden;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        user-select: none;
        transition: box-shadow 0.25s, opacity 0.3s, transform 0.3s;
      }
      .utr-panel:hover {
        box-shadow:
          0 24px 72px rgba(0,0,0,0.5),
          0 0 0 1px rgba(255,255,255,0.05) inset;
      }
      .utr-panel--closed {
        opacity: 0;
        pointer-events: none;
        transform: scale(0.95) translateY(-8px);
      }

      /* ========== 標題列 ========== */
      .utr-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 8px 10px 14px;
        cursor: grab;
        transition: background 0.15s;
      }
      .utr-bar:active { cursor: grabbing; }
      .utr-bar:hover { background: rgba(255,255,255,0.02); }

      .utr-bar-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        cursor: pointer;
      }
      .utr-bar-icon { color: rgba(255,255,255,0.3); }
      .utr-bar-title {
        font-size: 13px;
        font-weight: 600;
        color: rgba(255,255,255,0.55);
        letter-spacing: 0.3px;
      }
      .utr-bar-count {
        font-size: 11px;
        font-weight: 500;
        color: rgba(255,255,255,0.25);
        background: rgba(255,255,255,0.06);
        padding: 1px 7px;
        border-radius: 6px;
      }
      .utr-bar-right {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .utr-bar-btn {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.25);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .utr-bar-btn:hover {
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.6);
      }

      /* ========== 展開內容 ========== */
      .utr-content {
        border-top: 1px solid rgba(255,255,255,0.05);
        animation: utr-slideDown 0.2s ease;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      @keyframes utr-slideDown {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* ========== 搜尋欄 ========== */
      .utr-search {
        display: flex;
        align-items: center;
        margin: 10px 12px 8px;
        padding: 0 10px;
        height: 34px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 10px;
        transition: all 0.2s;
      }
      .utr-search:focus-within {
        border-color: rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.06);
      }
      .utr-search-icon { flex-shrink: 0; color: rgba(255,255,255,0.2); margin-right: 8px; }
      .utr-search-input {
        flex: 1; border: none; background: transparent; color: #e4e4e7;
        font-size: 13px; font-family: inherit; outline: none; min-width: 0; padding: 0;
      }
      .utr-search-input::placeholder { color: rgba(255,255,255,0.18); }
      .utr-add-btn {
        flex-shrink: 0; width: 26px; height: 26px; border-radius: 7px; border: none;
        background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.35);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        margin-left: 6px; transition: all 0.15s;
      }
      .utr-add-btn:hover { background: rgba(99,102,241,0.2); color: #a5b4fc; }

      /* ========== 搜尋下拉選單 ========== */
      .utr-search-wrap { }
      .utr-dropdown {
        margin: 0 12px 4px;
        background: rgba(36,36,40,0.98);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        max-height: 200px;
        overflow-y: auto;
        animation: utr-fadeIn 0.12s ease;
      }
      .utr-dropdown::-webkit-scrollbar { width: 3px; }
      .utr-dropdown::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      .utr-dropdown-item {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; cursor: pointer; transition: background 0.1s;
      }
      .utr-dropdown-item:hover,
      .utr-dropdown-item--active { background: rgba(99,102,241,0.12); }
      .utr-dropdown-code {
        font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.8);
        font-variant-numeric: tabular-nums; min-width: 42px;
      }
      .utr-dropdown-name { font-size: 12px; color: rgba(255,255,255,0.4); flex: 1; }
      .utr-dropdown-item--active .utr-dropdown-code { color: #a5b4fc; }
      .utr-dropdown-item--active .utr-dropdown-name { color: rgba(255,255,255,0.6); }
      .utr-dropdown-add {
        flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; border: none;
        background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.35);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        margin-left: auto; transition: all 0.15s;
      }
      .utr-dropdown-add:hover { background: rgba(99,102,241,0.25); color: #a5b4fc; }

      /* ========== 清單 ========== */
      .utr-list { overflow-y: auto; flex: 1; min-height: 0; padding: 2px 6px 8px; position: relative; }
      .utr-list::-webkit-scrollbar { width: 3px; }
      .utr-list::-webkit-scrollbar-track { background: transparent; }
      .utr-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 3px; }
      .utr-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
      .utr-empty { text-align: center; color: rgba(255,255,255,0.18); font-size: 12px; padding: 24px 12px; }

      /* ========== 股票項目 ========== */
      .utr-item-wrap { position: relative; }
      .utr-item-wrap--dragging {
        position: absolute;
        z-index: 10;
        opacity: 0.9;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        border-radius: 10px;
      }
      .utr-item-placeholder {
        border: 1px dashed rgba(99,102,241,0.35);
        border-radius: 10px;
        margin: 1px 0;
        background: rgba(99,102,241,0.05);
      }
      .utr-drag-handle {
        flex-shrink: 0; width: 18px; display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.1); cursor: grab; margin-right: 2px; touch-action: none;
      }
      .utr-drag-handle:active { cursor: grabbing; }
      .utr-item:hover .utr-drag-handle { color: rgba(255,255,255,0.3); }
      .utr-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 10px; margin: 1px 0; border-radius: 10px;
        cursor: pointer; transition: all 0.12s; border: 1px solid transparent;
      }
      .utr-item:hover { background: rgba(255,255,255,0.04); }
      .utr-item:active { transform: scale(0.99); }
      .utr-item--active { background: rgba(99,102,241,0.07); border-color: rgba(99,102,241,0.18); }
      .utr-item--active .utr-item-code { color: #a5b4fc; }
      .utr-item--active .utr-item-name { color: rgba(255,255,255,0.7); }
      .utr-item-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
      .utr-item-code {
        font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.82);
        font-variant-numeric: tabular-nums; min-width: 52px; width: 52px; text-align: left;
        flex-shrink: 0; font-family: "SF Mono", "Menlo", "Monaco", "Consolas", monospace;
      }
      .utr-item-name {
        font-size: 12px; color: rgba(255,255,255,0.3);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .utr-item-del {
        flex-shrink: 0; width: 24px; height: 24px; border-radius: 6px; border: none;
        background: transparent; color: rgba(255,255,255,0.12); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: all 0.12s;
      }
      .utr-item:hover .utr-item-del { opacity: 1; }
      .utr-item-del:hover { background: rgba(239,68,68,0.1); color: #f87171; }

      /* ========== 時區切換區塊 ========== */
      .utr-tf-section {
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      .utr-tf-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; cursor: pointer; transition: background 0.15s;
      }
      .utr-tf-header:hover { background: rgba(255,255,255,0.03); }
      .utr-tf-header-left {
        display: flex; align-items: center; gap: 10px;
      }
      .utr-tf-toggle {
        color: rgba(255,255,255,0.25); display: flex; align-items: center;
      }
      .utr-tf-body {
        padding: 0 10px 8px;
        animation: utr-slideDown 0.15s ease;
      }
      .utr-tf-current-label {
        font-size: 11px; color: rgba(255,255,255,0.25); font-weight: 500;
      }
      .utr-tf-current-code {
        font-size: 13px; font-weight: 600; color: #a5b4fc;
        font-variant-numeric: tabular-nums;
      }

      /* 分頁標籤列 */
      .utr-tf-tabs {
        display: flex; gap: 4px;
      }
      .utr-tf-tab {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
        padding: 7px 0; border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px; background: rgba(255,255,255,0.03);
        color: rgba(255,255,255,0.45); font-size: 12px; font-weight: 500;
        cursor: pointer; transition: all 0.15s;
        font-family: inherit;
      }
      .utr-tf-tab:hover {
        background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.7);
        border-color: rgba(255,255,255,0.1);
      }
      .utr-tf-tab--active {
        background: rgba(99,102,241,0.15); color: #a5b4fc;
        border-color: rgba(99,102,241,0.35);
      }
      .utr-tf-tab-chevron {
        transition: transform 0.15s;
      }

      /* 下拉選單 */
      .utr-tf-dropdown-list {
        margin-top: 4px;
        background: rgba(36,36,40,0.95);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px;
        max-height: 240px; overflow-y: auto;
        animation: utr-slideDown 0.15s ease;
      }
      .utr-tf-dropdown-list::-webkit-scrollbar { width: 3px; }
      .utr-tf-dropdown-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
      .utr-tf-item {
        padding: 9px 14px; cursor: pointer;
        font-size: 13px; color: rgba(255,255,255,0.55);
        transition: all 0.1s;
      }
      .utr-tf-item:first-child { border-radius: 10px 10px 0 0; }
      .utr-tf-item:last-child { border-radius: 0 0 10px 10px; }
      .utr-tf-item:hover {
        background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.85);
      }
      .utr-tf-item--active {
        background: rgba(59,130,246,0.15); color: #60a5fa;
      }

      /* ========== 確認對話框 ========== */
      .utr-confirm-overlay {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        align-items: center;
        justify-content: center;
      }
      .utr-confirm-overlay--show {
        display: flex;
      }
      .utr-confirm-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .utr-confirm-box {
        position: relative;
        background: rgba(36,36,40,0.98);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        padding: 24px;
        width: 300px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5);
        animation: utr-fadeIn 0.15s ease;
      }
      @keyframes utr-fadeIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
      .utr-confirm-title {
        font-size: 15px;
        font-weight: 600;
        color: rgba(255,255,255,0.85);
        margin-bottom: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .utr-confirm-msg {
        font-size: 13px;
        color: rgba(255,255,255,0.4);
        line-height: 1.6;
        margin-bottom: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .utr-confirm-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .utr-confirm-btn {
        padding: 8px 18px;
        border-radius: 8px;
        border: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .utr-confirm-btn--cancel {
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.6);
      }
      .utr-confirm-btn--cancel:hover {
        background: rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.8);
      }
      .utr-confirm-btn--ok {
        background: rgba(239,68,68,0.15);
        color: #f87171;
      }
      .utr-confirm-btn--ok:hover {
        background: rgba(239,68,68,0.25);
        color: #fca5a5;
      }

      /* ========== 價格提醒 ========== */
      .utr-alert-section {
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      .utr-alert-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; cursor: pointer; transition: background 0.15s;
      }
      .utr-alert-header:hover { background: rgba(255,255,255,0.03); }
      .utr-alert-header-left {
        display: flex; align-items: center; gap: 8px;
      }
      .utr-alert-bell { color: rgba(255,255,255,0.3); }
      .utr-alert-title {
        font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.55);
        letter-spacing: 0.3px;
      }
      .utr-alert-body {
        padding: 0 10px 8px;
        animation: utr-slideDown 0.15s ease;
      }
      .utr-alert-add-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; padding: 8px 0; border: 1px dashed rgba(255,255,255,0.1);
        border-radius: 8px; background: transparent;
        color: rgba(255,255,255,0.35); font-size: 12px; font-family: inherit;
        cursor: pointer; transition: all 0.15s; margin-bottom: 6px;
      }
      .utr-alert-add-btn:hover {
        border-color: rgba(251,191,36,0.4); color: #fbbf24;
        background: rgba(251,191,36,0.05);
      }

      /* 新增提醒表單 */
      .utr-alert-form {
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px; padding: 10px; margin-bottom: 6px;
        animation: utr-slideDown 0.15s ease;
      }
      .utr-alert-form-row {
        display: flex; gap: 6px; margin-bottom: 8px; align-items: center;
      }
      .utr-alert-input {
        flex: 1; padding: 6px 10px; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08); border-radius: 7px;
        color: #e4e4e7; font-size: 13px; font-family: inherit; outline: none;
        min-width: 0;
      }
      .utr-alert-input:focus {
        border-color: rgba(251,191,36,0.4); background: rgba(255,255,255,0.06);
      }
      .utr-alert-input--code { max-width: 80px; font-family: "SF Mono", "Menlo", monospace; }
      .utr-alert-input--price { font-variant-numeric: tabular-nums; }
      .utr-alert-input::-webkit-inner-spin-button,
      .utr-alert-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
      .utr-alert-form-name {
        font-size: 12px; color: rgba(255,255,255,0.35); flex: 1;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .utr-alert-select {
        padding: 6px 8px; background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08); border-radius: 7px;
        color: #e4e4e7; font-size: 12px; font-family: inherit; outline: none;
        cursor: pointer; min-width: 80px;
      }
      .utr-alert-select:focus { border-color: rgba(251,191,36,0.4); }
      .utr-alert-select option { background: #1e1e22; color: #e4e4e7; }
      .utr-alert-form-actions {
        display: flex; gap: 6px; justify-content: flex-end;
      }
      .utr-alert-form-btn {
        padding: 6px 14px; border-radius: 7px; border: none;
        font-size: 12px; font-weight: 500; cursor: pointer;
        transition: all 0.15s; font-family: inherit;
      }
      .utr-alert-form-btn--cancel {
        background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
      }
      .utr-alert-form-btn--cancel:hover {
        background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);
      }
      .utr-alert-form-btn--save {
        background: rgba(251,191,36,0.15); color: #fbbf24;
      }
      .utr-alert-form-btn--save:hover {
        background: rgba(251,191,36,0.25); color: #fde68a;
      }

      /* 提醒項目 */
      .utr-alert-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 10px; margin: 2px 0; border-radius: 8px;
        transition: background 0.12s;
      }
      .utr-alert-item:hover { background: rgba(255,255,255,0.03); }
      .utr-alert-item--triggered { opacity: 0.5; }
      .utr-alert-item-left {
        display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;
      }
      .utr-alert-item-code {
        font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.75);
        font-family: "SF Mono", "Menlo", monospace; font-variant-numeric: tabular-nums;
        min-width: 42px;
      }
      .utr-alert-item-name {
        font-size: 11px; color: rgba(255,255,255,0.3);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .utr-alert-item-right {
        display: flex; align-items: center; gap: 6px; flex-shrink: 0;
      }
      .utr-alert-cond {
        font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums;
        padding: 2px 6px; border-radius: 5px;
      }
      .utr-alert-cond--above {
        color: #f87171; background: rgba(239,68,68,0.1);
      }
      .utr-alert-cond--below {
        color: #60a5fa; background: rgba(59,130,246,0.1);
      }
      .utr-alert-cond--triggered {
        color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.05);
      }
      .utr-alert-time {
        font-size: 11px; color: rgba(255,255,255,0.25);
        font-variant-numeric: tabular-nums;
      }
      .utr-alert-item-del {
        width: 20px; height: 20px; border-radius: 5px; border: none;
        background: transparent; color: rgba(255,255,255,0.12);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: all 0.12s;
      }
      .utr-alert-item:hover .utr-alert-item-del { opacity: 1; }
      .utr-alert-item-del:hover {
        background: rgba(239,68,68,0.1); color: #f87171;
      }
      .utr-alert-triggered-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px 2px; margin-top: 4px;
        font-size: 11px; color: rgba(255,255,255,0.2); font-weight: 500;
      }
      .utr-alert-clear-btn {
        background: none; border: none; color: rgba(255,255,255,0.2);
        font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 4px;
        font-family: inherit; transition: all 0.15s;
      }
      .utr-alert-clear-btn:hover {
        color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.05);
      }
    `;
  }
})();
