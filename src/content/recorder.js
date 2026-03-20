/**
 * Content Script - Recorder
 * 錄製模式：監聽使用者操作，擷取 CSS Selector 並儲存為新動作
 */

(function () {
  if (window.__utrRecorderLoaded) return;
  window.__utrRecorderLoaded = true;

  let isRecording = false;
  let highlightOverlay = null;
  let currentTarget = null;

  // ===== 監聽錄製模式切換 =====
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SET_RECORDING') {
      if (message.enabled) {
        startRecording();
      } else {
        stopRecording();
      }
    }
  });

  // ===== 開始錄製 =====
  function startRecording() {
    if (isRecording) return;
    isRecording = true;

    // 建立高亮覆蓋層
    highlightOverlay = document.createElement('div');
    highlightOverlay.id = 'utr-highlight';
    Object.assign(highlightOverlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      border: '2px solid #e94560',
      borderRadius: '3px',
      background: 'rgba(233, 69, 96, 0.1)',
      zIndex: '2147483646',
      transition: 'all 0.1s ease',
      display: 'none',
    });
    document.body.appendChild(highlightOverlay);

    // 建立錄製提示
    showRecordingIndicator();

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  // ===== 停止錄製 =====
  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    highlightOverlay?.remove();
    highlightOverlay = null;

    document.getElementById('utr-recording-indicator')?.remove();
  }

  // ===== 事件處理 =====

  function onMouseOver(e) {
    if (!isRecording) return;
    // 忽略遙控器本身的元素
    if (e.target.closest('#utr-root') || e.target.id === 'utr-highlight') return;

    currentTarget = e.target;
    updateHighlight(e.target);
  }

  function onClick(e) {
    if (!isRecording) return;
    if (e.target.closest('#utr-root') || e.target.id === 'utr-highlight') return;
    if (e.target.id === 'utr-recording-indicator') return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    const selector = generateUniqueSelector(target);
    const label = inferLabel(target);

    // 顯示確認對話框
    showSaveDialog(selector, label, target);
  }

  function onKeyDown(e) {
    // ESC 退出錄製
    if (e.key === 'Escape') {
      stopRecording();
      chrome.runtime.sendMessage({
        type: 'TOGGLE_RECORDING',
        enabled: false,
      });
    }
  }

  // ===== 高亮元素 =====
  function updateHighlight(el) {
    if (!highlightOverlay) return;
    const rect = el.getBoundingClientRect();
    Object.assign(highlightOverlay.style, {
      display: 'block',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
  }

  // ===== 錄製中指示器 =====
  function showRecordingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'utr-recording-indicator';
    Object.assign(indicator.style, {
      position: 'fixed',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#e94560',
      color: 'white',
      padding: '6px 16px',
      borderRadius: '20px',
      fontSize: '13px',
      fontFamily: '-apple-system, sans-serif',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      boxShadow: '0 4px 12px rgba(233,69,96,0.4)',
    });
    indicator.innerHTML = `
      <span style="width:8px;height:8px;background:white;border-radius:50%;animation:utr-blink 1s infinite"></span>
      錄製中 — 點擊元素錄製，ESC 退出
    `;

    // 注入動畫
    if (!document.getElementById('utr-recorder-style')) {
      const style = document.createElement('style');
      style.id = 'utr-recorder-style';
      style.textContent = `
        @keyframes utr-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(indicator);
  }

  // ===== 儲存對話框 =====
  function showSaveDialog(selector, defaultLabel, target) {
    // 移除舊的
    document.getElementById('utr-save-dialog')?.remove();

    const dialog = document.createElement('div');
    dialog.id = 'utr-save-dialog';
    Object.assign(dialog.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: '#1a1a2e',
      border: '1px solid #0f3460',
      borderRadius: '12px',
      padding: '20px',
      zIndex: '2147483647',
      fontFamily: '-apple-system, sans-serif',
      color: '#e0e0e0',
      width: '320px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    });

    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:15px;color:#e94560">儲存動作</h3>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;color:#888;margin-bottom:4px">Selector</label>
        <input id="utr-rec-selector" type="text" value="${escapeHtml(selector)}"
          style="width:100%;box-sizing:border-box;padding:6px 10px;background:#0a0a1a;border:1px solid #0f3460;border-radius:6px;color:#e0e0e0;font-size:13px;font-family:monospace" />
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;color:#888;margin-bottom:4px">按鈕名稱</label>
        <input id="utr-rec-label" type="text" value="${escapeHtml(defaultLabel)}"
          style="width:100%;box-sizing:border-box;padding:6px 10px;background:#0a0a1a;border:1px solid #0f3460;border-radius:6px;color:#e0e0e0;font-size:13px" />
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:12px;color:#888;margin-bottom:4px">群組</label>
        <input id="utr-rec-group" type="text" value="自訂"
          style="width:100%;box-sizing:border-box;padding:6px 10px;background:#0a0a1a;border:1px solid #0f3460;border-radius:6px;color:#e0e0e0;font-size:13px" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="utr-rec-cancel"
          style="padding:6px 14px;background:#16213e;color:#ccc;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px">取消</button>
        <button id="utr-rec-save"
          style="padding:6px 14px;background:#e94560;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">儲存</button>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.querySelector('#utr-rec-cancel').onclick = () => dialog.remove();
    dialog.querySelector('#utr-rec-save').onclick = () => {
      const selectorVal = dialog.querySelector('#utr-rec-selector').value.trim();
      const labelVal = dialog.querySelector('#utr-rec-label').value.trim();
      const groupVal = dialog.querySelector('#utr-rec-group').value.trim();

      if (!selectorVal || !labelVal) return;

      const domain = window.location.hostname;
      const action = {
        id: 'custom_' + Date.now(),
        label: labelVal,
        group: groupVal || '自訂',
        type: 'click',
        selector: selectorVal,
        description: `錄製的動作: ${labelVal}`,
      };

      chrome.runtime.sendMessage({
        type: 'SAVE_ACTION',
        domain,
        action,
      });

      dialog.remove();
      showToast(`已儲存: ${labelVal}`);
    };
  }

  // ===== Selector 產生器 =====
  function generateUniqueSelector(el) {
    // 1. ID 最優先
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // 2. data 屬性
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
    }

    // 3. 建立路徑
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let segment = current.tagName.toLowerCase();

      if (current.id) {
        segment = `#${CSS.escape(current.id)}`;
        path.unshift(segment);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.startsWith('utr-'))
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        if (classes) segment += classes;
      }

      // 加上 nth-child 確保唯一
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (s) => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += `:nth-child(${index})`;
        }
      }

      path.unshift(segment);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // ===== 輔助函式 =====

  function inferLabel(el) {
    return (
      el.textContent?.trim().slice(0, 20) ||
      el.getAttribute('title') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('data-tooltip') ||
      el.tagName.toLowerCase()
    );
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#4CAF50',
      color: 'white',
      padding: '8px 20px',
      borderRadius: '20px',
      fontSize: '13px',
      fontFamily: '-apple-system, sans-serif',
      zIndex: '2147483647',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    });
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }
})();
