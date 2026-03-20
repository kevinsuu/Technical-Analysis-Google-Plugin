/**
 * Options Page - 管理各券商 Selector 設定
 */

(async function () {
  let configs = {};

  // ===== 初始化 =====
  await loadConfigs();
  renderBrokerList();
  bindGlobalEvents();

  // ===== 載入設定 =====
  async function loadConfigs() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_CONFIGS' });
    configs = response?.configs || {};
  }

  // ===== 儲存設定 =====
  async function saveConfigs() {
    await chrome.runtime.sendMessage({ type: 'UPDATE_CONFIGS', configs });
    showToast('設定已儲存');
  }

  // ===== 渲染券商列表 =====
  function renderBrokerList() {
    const container = document.getElementById('broker-list');
    const domains = Object.keys(configs);

    if (domains.length === 0) {
      container.innerHTML = '<div class="empty-state">尚未設定任何券商，請前往「新增券商」頁籤。</div>';
      return;
    }

    container.innerHTML = domains.map((domain) => {
      const broker = configs[domain];
      const actions = broker.actions || [];

      return `
        <div class="card" data-domain="${domain}">
          <div class="card-header">
            <div>
              <span class="card-title">${escapeHtml(broker.name || domain)}</span>
              <span class="badge" style="margin-left:8px">${domain}</span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-secondary btn-sm" data-action="add-action" data-domain="${domain}">新增動作</button>
              <button class="btn btn-danger btn-sm" data-action="delete-broker" data-domain="${domain}">刪除券商</button>
            </div>
          </div>
          ${actions.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>群組</th>
                <th>類型</th>
                <th>Selector / Script</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${actions.map((a) => `
                <tr data-action-id="${a.id}">
                  <td>${escapeHtml(a.label)}</td>
                  <td><span class="badge">${escapeHtml(a.group || '其他')}</span></td>
                  <td>${a.type}</td>
                  <td><code>${escapeHtml(a.selector || a.script || '')}</code></td>
                  <td>
                    <button class="btn btn-secondary btn-sm" data-action="edit-action" data-domain="${domain}" data-id="${a.id}">編輯</button>
                    <button class="btn btn-danger btn-sm" data-action="delete-action" data-domain="${domain}" data-id="${a.id}">刪除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : '<div class="empty-state">尚無動作設定</div>'}
        </div>
      `;
    }).join('');

    // 更新 JSON 編輯器
    const jsonEditor = document.getElementById('json-editor');
    if (jsonEditor) {
      jsonEditor.value = JSON.stringify(configs, null, 2);
    }
  }

  // ===== 全域事件綁定 =====
  function bindGlobalEvents() {
    // Tab 切換
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

        // 切到 JSON tab 時更新內容
        if (tab.dataset.tab === 'json') {
          document.getElementById('json-editor').value = JSON.stringify(configs, null, 2);
        }
      });
    });

    // 委派事件
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const domain = btn.dataset.domain;
      const id = btn.dataset.id;

      switch (action) {
        case 'delete-broker':
          if (confirm(`確定要刪除「${configs[domain]?.name || domain}」的所有設定嗎？`)) {
            delete configs[domain];
            await saveConfigs();
            renderBrokerList();
          }
          break;

        case 'delete-action':
          if (confirm('確定要刪除此動作？')) {
            configs[domain].actions = configs[domain].actions.filter((a) => a.id !== id);
            await saveConfigs();
            renderBrokerList();
          }
          break;

        case 'add-action':
          showActionDialog(domain, null);
          break;

        case 'edit-action':
          const actionData = configs[domain]?.actions?.find((a) => a.id === id);
          if (actionData) showActionDialog(domain, actionData);
          break;
      }
    });

    // 新增券商
    document.getElementById('btn-add-broker')?.addEventListener('click', async () => {
      const domain = document.getElementById('new-domain').value.trim();
      const name = document.getElementById('new-name').value.trim();
      const urlPattern = document.getElementById('new-url-pattern').value.trim();

      if (!domain) {
        showToast('請輸入網域', 'error');
        return;
      }

      configs[domain] = {
        name: name || domain,
        stockUrlPattern: urlPattern || '',
        actions: [],
      };

      await saveConfigs();
      renderBrokerList();

      // 清空表單
      document.getElementById('new-domain').value = '';
      document.getElementById('new-name').value = '';
      document.getElementById('new-url-pattern').value = '';

      // 切換至券商列表
      document.querySelector('[data-tab="brokers"]').click();
    });

    // JSON 格式化
    document.getElementById('btn-json-format')?.addEventListener('click', () => {
      const editor = document.getElementById('json-editor');
      try {
        const parsed = JSON.parse(editor.value);
        editor.value = JSON.stringify(parsed, null, 2);
      } catch {
        showToast('JSON 格式錯誤', 'error');
      }
    });

    // JSON 儲存
    document.getElementById('btn-json-save')?.addEventListener('click', async () => {
      const editor = document.getElementById('json-editor');
      try {
        configs = JSON.parse(editor.value);
        await saveConfigs();
        renderBrokerList();
      } catch {
        showToast('JSON 格式錯誤，無法儲存', 'error');
      }
    });
  }

  // ===== 動作編輯對話框 =====
  function showActionDialog(domain, existingAction) {
    const isEdit = !!existingAction;
    const action = existingAction || {
      id: 'action_' + Date.now(),
      label: '',
      group: '',
      type: 'click',
      selector: '',
      script: '',
      description: '',
    };

    // 建立覆蓋層
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
    });

    overlay.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid #16213e;border-radius:12px;padding:24px;width:480px;max-height:80vh;overflow-y:auto">
        <h3 style="color:#e94560;margin-bottom:16px">${isEdit ? '編輯動作' : '新增動作'}</h3>
        <div class="form-row">
          <div class="form-group">
            <label>按鈕名稱</label>
            <input type="text" id="dlg-label" value="${escapeHtml(action.label)}">
          </div>
          <div class="form-group">
            <label>群組</label>
            <input type="text" id="dlg-group" value="${escapeHtml(action.group || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>類型</label>
            <select id="dlg-type">
              <option value="click" ${action.type === 'click' ? 'selected' : ''}>Click（點擊元素）</option>
              <option value="script" ${action.type === 'script' ? 'selected' : ''}>Script（執行腳本）</option>
              <option value="input" ${action.type === 'input' ? 'selected' : ''}>Input（輸入值）</option>
            </select>
          </div>
        </div>
        <div class="form-row" id="dlg-selector-row">
          <div class="form-group">
            <label>CSS Selector</label>
            <input type="text" id="dlg-selector" value="${escapeHtml(action.selector || '')}" placeholder=".btn-period-5 或 [data-value='5m']">
          </div>
        </div>
        <div class="form-row" id="dlg-script-row" style="display:none">
          <div class="form-group">
            <label>腳本</label>
            <input type="text" id="dlg-script" value="${escapeHtml(action.script || '')}" placeholder='toggleIndicator("MACD")'>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>說明（選填）</label>
            <input type="text" id="dlg-desc" value="${escapeHtml(action.description || '')}">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-secondary" id="dlg-cancel">取消</button>
          <button class="btn btn-primary" id="dlg-save">儲存</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 類型切換
    const typeSelect = overlay.querySelector('#dlg-type');
    const selectorRow = overlay.querySelector('#dlg-selector-row');
    const scriptRow = overlay.querySelector('#dlg-script-row');

    function updateTypeVisibility() {
      const t = typeSelect.value;
      selectorRow.style.display = t === 'script' ? 'none' : 'flex';
      scriptRow.style.display = t === 'script' ? 'flex' : 'none';
    }
    typeSelect.addEventListener('change', updateTypeVisibility);
    updateTypeVisibility();

    // 取消
    overlay.querySelector('#dlg-cancel').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    // 儲存
    overlay.querySelector('#dlg-save').onclick = async () => {
      const label = overlay.querySelector('#dlg-label').value.trim();
      if (!label) { showToast('請輸入按鈕名稱', 'error'); return; }

      const updatedAction = {
        id: action.id,
        label,
        group: overlay.querySelector('#dlg-group').value.trim() || '其他',
        type: typeSelect.value,
        selector: overlay.querySelector('#dlg-selector').value.trim(),
        script: overlay.querySelector('#dlg-script').value.trim(),
        description: overlay.querySelector('#dlg-desc').value.trim(),
      };

      if (!configs[domain]) {
        configs[domain] = { name: domain, actions: [] };
      }

      const idx = configs[domain].actions.findIndex((a) => a.id === updatedAction.id);
      if (idx >= 0) {
        configs[domain].actions[idx] = updatedAction;
      } else {
        configs[domain].actions.push(updatedAction);
      }

      await saveConfigs();
      renderBrokerList();
      overlay.remove();
    };
  }

  // ===== 工具函式 =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.background = type === 'error' ? '#e94560' : '#4CAF50';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
})();
