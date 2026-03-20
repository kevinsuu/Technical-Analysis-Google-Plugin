/**
 * Panel JS - Popup 模式備用腳本
 * 當面板以 popup 而非 Shadow DOM 呈現時使用
 */

(async function () {
  const panelBody = document.getElementById('panel-body');
  if (!panelBody) return;

  // 取得當前分頁資訊
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    panelBody.innerHTML = '<p class="utr-notice">無法取得分頁資訊</p>';
    return;
  }

  // 取得設定
  const response = await chrome.runtime.sendMessage({
    type: 'GET_CONFIG',
    url: tab.url,
  });

  if (!response?.config) {
    panelBody.innerHTML = `
      <p class="utr-notice">此網站尚未設定</p>
      <button class="utr-btn utr-btn--action" style="width:100%;margin-top:8px" id="btn-options">前往設定</button>
    `;
    document.getElementById('btn-options')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  // 渲染動作按鈕
  const { config } = response;
  const groups = {};
  for (const action of config.actions) {
    const g = action.group || '其他';
    if (!groups[g]) groups[g] = [];
    groups[g].push(action);
  }

  let html = '';
  for (const [groupName, actions] of Object.entries(groups)) {
    html += `<div class="utr-group">
      <div class="utr-group-title">${groupName}</div>
      <div class="utr-group-buttons">`;
    for (const action of actions) {
      html += `<button class="utr-btn utr-btn--action" data-action-id="${action.id}">${action.label}</button>`;
    }
    html += `</div></div>`;
  }
  panelBody.innerHTML = html;

  // 事件委派
  panelBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action-id]');
    if (!btn) return;

    const actionId = btn.dataset.actionId;
    const action = config.actions.find((a) => a.id === actionId);
    if (!action) return;

    // 透過 content script 執行動作
    await chrome.tabs.sendMessage(tab.id, {
      type: 'EXEC_ACTION',
      action,
    });
  });
})();
