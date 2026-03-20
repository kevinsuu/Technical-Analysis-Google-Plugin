/**
 * Content Script - Executor
 * 負責在頁面 Context 中執行 DOM 操作與腳本
 * 此腳本透過 postMessage 接收來自 Shadow DOM 面板的指令
 */

(function () {
  // 防止重複掛載
  if (window.__utrExecutorLoaded) return;
  window.__utrExecutorLoaded = true;

  // ===== 監聽來自面板的腳本執行請求 =====
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'utr-panel') return;

    switch (event.data.type) {
      case 'EXEC_SCRIPT':
        safeExecuteScript(event.data.script);
        break;
      case 'EXEC_CLICK':
        safeExecuteClick(event.data.selector, event.data.fallbackSelectors);
        break;
      case 'EXEC_INPUT':
        safeExecuteInput(event.data.selector, event.data.value);
        break;
    }
  });

  // ===== TradingView 指標切換 =====
  // 群益使用的是 TradingView 圖表，以下為通用的操作函式

  /**
   * 切換技術指標（TradingView 專用）
   * @param {string} indicatorName - 指標名稱 (e.g. "Moving Average", "MACD")
   */
  window.toggleIndicator = function (indicatorName) {
    // 方法1：透過 TradingView Widget API（若可用）
    if (window.tvWidget) {
      try {
        const chart = window.tvWidget.activeChart();
        const studies = chart.getAllStudies();
        const existing = studies.find((s) =>
          s.name.toLowerCase().includes(indicatorName.toLowerCase())
        );

        if (existing) {
          chart.removeEntity(existing.id);
        } else {
          chart.createStudy(indicatorName, false, false);
        }
        return;
      } catch (err) {
        console.warn('[UTR] tvWidget API 失敗，嘗試 DOM 操作:', err);
      }
    }

    // 方法2：透過 DOM 操作模擬使用者行為
    // 開啟指標選單
    const indicatorBtn = document.querySelector(
      '[data-name="insert-indicator"], .js-button-indicators, [data-tooltip="指標"]'
    );
    if (indicatorBtn) {
      indicatorBtn.click();

      // 等待選單出現後搜尋指標
      setTimeout(() => {
        const searchInput = document.querySelector(
          '.tv-insert-indicator-dialog input[type="search"], input[placeholder*="搜尋"]'
        );
        if (searchInput) {
          searchInput.value = indicatorName;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));

          setTimeout(() => {
            const resultItem = document.querySelector(
              '.tv-insert-indicator-dialog .js-item-title, [data-title*="' +
                indicatorName +
                '"]'
            );
            if (resultItem) {
              resultItem.click();
            }
            // 關閉對話框
            const closeBtn = document.querySelector(
              '.tv-insert-indicator-dialog .close, [data-name="close"]'
            );
            if (closeBtn) closeBtn.click();
          }, 500);
        }
      }, 300);
    }
  };

  /**
   * 切換 K 線週期（TradingView 專用）
   * @param {string} resolution - 週期代碼 (e.g. "1", "5", "D")
   */
  window.changeResolution = function (resolution) {
    // 方法1：透過 TradingView Widget API
    if (window.tvWidget) {
      try {
        window.tvWidget.activeChart().setResolution(resolution);
        return;
      } catch (err) {
        console.warn('[UTR] tvWidget API 失敗:', err);
      }
    }

    // 方法2：模擬點擊
    const btn = document.querySelector(
      `[data-value="${resolution}"], [data-resolution="${resolution}"]`
    );
    if (btn) {
      btn.click();
    }
  };

  /**
   * 跳轉個股（TradingView 專用）
   * @param {string} symbol - 股票代碼
   */
  window.changeSymbol = function (symbol) {
    if (window.tvWidget) {
      try {
        window.tvWidget.activeChart().setSymbol(symbol);
        return;
      } catch (err) {
        console.warn('[UTR] tvWidget API 失敗:', err);
      }
    }

    // fallback: 透過搜尋框
    const symbolInput = document.querySelector(
      '.js-symbol-search-input, [data-role="search"]'
    );
    if (symbolInput) {
      symbolInput.click();
      setTimeout(() => {
        const input = document.querySelector(
          'input[placeholder*="搜尋"], input[placeholder*="Symbol"]'
        );
        if (input) {
          input.value = symbol;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 300);
    }
  };

  // ===== 安全執行函式 =====

  function safeExecuteScript(script) {
    try {
      // 限制可執行的函式白名單
      const allowedFunctions = [
        'toggleIndicator',
        'changeResolution',
        'changeSymbol',
      ];
      const fnMatch = script.match(/^(\w+)\((.*)\)$/);
      if (fnMatch && allowedFunctions.includes(fnMatch[1])) {
        const fn = window[fnMatch[1]];
        const args = JSON.parse(`[${fnMatch[2]}]`);
        fn.apply(null, args);
      } else {
        console.warn('[UTR] 不允許的腳本呼叫:', script);
      }
    } catch (err) {
      console.error('[UTR] 腳本執行錯誤:', err);
    }
  }

  function safeExecuteClick(selector, fallbackSelectors = []) {
    const selectors = [selector, ...fallbackSelectors];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        return;
      }
    }
    console.warn('[UTR] 找不到元素:', selector);
  }

  function safeExecuteInput(selector, value) {
    const el = document.querySelector(selector);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
})();
