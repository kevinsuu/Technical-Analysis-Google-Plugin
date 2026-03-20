/**
 * Selector Finder - 輔助工具
 * 生成最簡且唯一的 CSS Selector
 */

/**
 * 為指定元素產生唯一的 CSS Selector
 * 策略順序：ID > data 屬性 > aria 屬性 > class 組合 > 路徑
 *
 * @param {Element} el - 目標 DOM 元素
 * @param {Document} [doc=document] - 所屬文件
 * @returns {string} CSS Selector 字串
 */
export function generateSelector(el, doc = document) {
  if (!el || el === doc.body || el === doc.documentElement) {
    return 'body';
  }

  // 策略 1: ID
  if (el.id) {
    const selector = `#${CSS.escape(el.id)}`;
    if (isUnique(selector, el, doc)) return selector;
  }

  // 策略 2: data-* 屬性
  const dataSelector = findDataAttrSelector(el, doc);
  if (dataSelector) return dataSelector;

  // 策略 3: aria 屬性
  const ariaSelector = findAriaSelector(el, doc);
  if (ariaSelector) return ariaSelector;

  // 策略 4: tag + 唯一 class 組合
  const classSelector = findClassSelector(el, doc);
  if (classSelector) return classSelector;

  // 策略 5: 逐層建立路徑
  return buildPathSelector(el, doc);
}

/**
 * 測試 selector 在文件中是否唯一指向目標
 */
function isUnique(selector, target, doc) {
  try {
    const results = doc.querySelectorAll(selector);
    return results.length === 1 && results[0] === target;
  } catch {
    return false;
  }
}

/**
 * 策略 2: data-* 屬性 selector
 */
function findDataAttrSelector(el, doc) {
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && attr.value) {
      // 完整 match
      const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
      if (isUnique(selector, el, doc)) return selector;

      // tag + data attr
      const tagSelector = `${el.tagName.toLowerCase()}${selector}`;
      if (isUnique(tagSelector, el, doc)) return tagSelector;
    }
  }
  return null;
}

/**
 * 策略 3: aria 屬性 selector
 */
function findAriaSelector(el, doc) {
  const ariaAttrs = ['aria-label', 'aria-labelledby', 'role', 'title'];
  for (const attrName of ariaAttrs) {
    const value = el.getAttribute(attrName);
    if (value) {
      const selector = `[${attrName}="${CSS.escape(value)}"]`;
      if (isUnique(selector, el, doc)) return selector;
    }
  }
  return null;
}

/**
 * 策略 4: tag + class 組合 selector
 */
function findClassSelector(el, doc) {
  if (!el.className || typeof el.className !== 'string') return null;

  const classes = el.className.trim().split(/\s+/).filter(Boolean);
  if (classes.length === 0) return null;

  const tag = el.tagName.toLowerCase();

  // 嘗試單一 class
  for (const cls of classes) {
    const selector = `${tag}.${CSS.escape(cls)}`;
    if (isUnique(selector, el, doc)) return selector;
  }

  // 嘗試兩個 class 組合
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const selector = `${tag}.${CSS.escape(classes[i])}.${CSS.escape(classes[j])}`;
      if (isUnique(selector, el, doc)) return selector;
    }
  }

  return null;
}

/**
 * 策略 5: 建構完整路徑 selector
 */
function buildPathSelector(el, doc) {
  const parts = [];
  let current = el;

  while (current && current !== doc.body && current !== doc.documentElement) {
    let part = current.tagName.toLowerCase();

    // 有 ID 就中斷
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // 加上有用的 class
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (classes.length > 0) {
        part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      }
    }

    // nth-child 確保路徑唯一
    const parent = current.parentElement;
    if (parent) {
      const sameTagSiblings = [...parent.children].filter(
        (s) => s.tagName === current.tagName
      );
      if (sameTagSiblings.length > 1) {
        const idx = sameTagSiblings.indexOf(current) + 1;
        part += `:nth-child(${idx})`;
      }
    }

    parts.unshift(part);
    current = current.parentElement;

    // 檢查目前路徑是否已唯一
    const candidate = parts.join(' > ');
    if (isUnique(candidate, el, doc)) return candidate;

    // 最多 5 層
    if (parts.length >= 5) break;
  }

  return parts.join(' > ');
}

/**
 * 驗證 selector 是否能正確指向目標
 */
export function validateSelector(selector, doc = document) {
  try {
    const el = doc.querySelector(selector);
    return { valid: !!el, element: el };
  } catch {
    return { valid: false, element: null };
  }
}

/**
 * 簡化已有的 selector（嘗試縮短路徑）
 */
export function simplifySelector(selector, doc = document) {
  const el = doc.querySelector(selector);
  if (!el) return selector;
  return generateSelector(el, doc);
}
