// These functions execute in a named BiDi sandbox. Keep them self-contained.
// Names/roles are DOM heuristics; closed shadow roots and frame contents are
// deliberately not represented as a complete accessibility tree.
export function domOutline(limit = 10000) {
  const entries = []; let iframes = 0, visited = 0, truncated = false;
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const roles = { A: 'link', BUTTON: 'button', TEXTAREA: 'textbox', SELECT: 'combobox',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell',
    MAIN: 'main', NAV: 'navigation', P: 'text', SUMMARY: 'button' };
  const visit = (root, depth = 0) => {
    for (const el of root.children ?? []) {
      if (++visited > limit) { truncated = true; return; }
      const style = getComputedStyle(el);
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName) || el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.tagName === 'IFRAME') { iframes++; continue; }
      let role = el.getAttribute('role')?.split(/\s+/)[0] || roles[el.tagName];
      if (el.tagName === 'INPUT') role = ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', number: 'spinbutton', range: 'slider', hidden: null })[el.type] ?? (el.type === 'hidden' ? null : 'textbox');
      if (el.isContentEditable) role ??= 'textbox';
      if (!role && (el.hasAttribute('onclick') || el.tabIndex >= 0)) role = 'generic';
      if (role && el.getClientRects().length && !['none', 'presentation'].includes(role)) {
        const labelled = clean((el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => el.getRootNode().getElementById?.(id)?.textContent ?? '').join(' '));
        const label = clean([...(el.labels ?? [])].map(item => item.textContent).join(' '));
        const name = labelled || clean(el.getAttribute('aria-label')) || label || clean(el.alt) ||
          (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? clean(el.placeholder || el.title || (role === 'button' ? el.value : '')) : clean(el.innerText || el.textContent || el.title));
        const value = el.type === 'password' ? '' : el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.text).join(', ') :
          el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : typeof el.value === 'string' ? el.value : el.isContentEditable ? el.textContent : '';
        entries.push({ node: el, role, name: name.slice(0, 1000), value: clean(value).slice(0, 1000), depth,
          states: [el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' ? 'disabled' : '', el.readOnly ? 'readonly' : '',
            el.checked ? 'checked' : '', el === el.getRootNode().activeElement ? 'focused' : ''].filter(Boolean) });
      }
      if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
      visit(el, depth + (role ? 1 : 0));
      if (truncated) return;
    }
  };
  visit(document);
  return { title: document.title, url: location.href, entries, iframes, truncated };
}

export function domElement(operation, value) {
  let el = this;
  if (!el?.isConnected) throw new Error('BROWSER_ELEMENT_STALE: node is detached');
  if (el.tagName === 'LABEL' && el.control) el = el.control;
  const read = () => el.type === 'password' ? '[redacted]' : el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.text).join(', ') :
    el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? 'checked' : 'unchecked') : el.value ?? el.textContent ?? '';
  if (operation === 'read') return read();
  if (operation === 'info') {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), type: el.type, href: el.href, value: read(), text: el.innerText,
      bounds: { x: r.x, y: r.y, width: r.width, height: r.height }, disabled: el.matches(':disabled'), readOnly: Boolean(el.readOnly) };
  }
  if (el.matches(':disabled') || el.closest('[aria-disabled="true"]')) throw new Error('BROWSER_NOT_EDITABLE: disabled');
  if (operation === 'prepareClick') {
    if (el.type === 'file') throw new Error('BROWSER_BIDI_UNSUPPORTED: file chooser is not supported by this prototype');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect(), x = Math.max(0, r.left) + (Math.min(innerWidth, r.right) - Math.max(0, r.left)) / 2,
      y = Math.max(0, r.top) + (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) / 2;
    if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw new Error('BROWSER_ELEMENT_HIDDEN: no visible hit point');
    const hit = el.getRootNode().elementFromPoint(x, y);
    if (hit && hit !== el && !el.contains(hit)) throw new Error('BROWSER_ELEMENT_COVERED: ' + (hit.innerText || hit.tagName).slice(0, 80));
    return { x, y };
  }
  if (operation === 'focus') { el.focus({ preventScroll: true }); return true; }
  if (operation === 'scroll') { const before = [el.scrollLeft, el.scrollTop]; el.scrollBy({ left: value[0], top: value[1], behavior: 'instant' }); return { before, after: [el.scrollLeft, el.scrollTop] }; }
  if (operation !== 'set') throw new Error('BROWSER_BIDI_UNSUPPORTED: DOM operation ' + operation);
  if (el.readOnly || el.getAttribute('aria-readonly') === 'true') throw new Error('BROWSER_NOT_EDITABLE: read-only');
  const wanted = String(value);
  if (el.type === 'checkbox' || el.type === 'radio') {
    if (!/^(true|false)$/i.test(wanted)) throw new Error('INVALID_ARGUMENTS: checkbox/radio requires true or false');
    const checked = /^true$/i.test(wanted);
    if (el.type === 'radio' && !checked && el.checked) throw new Error('BROWSER_NOT_EDITABLE: clear a radio by selecting another');
    if (el.checked !== checked) el.click();
  } else if (el.tagName === 'SELECT') {
    const names = el.multiple ? wanted.split(/\r?\n|\|/) : [wanted];
    const options = names.map(name => [...el.options].find(o => o.value === name || o.text.trim() === name));
    if (options.some(o => !o)) throw new Error('BROWSER_OPTION_NOT_FOUND: ' + wanted);
    if (options.some(o => o.disabled || o.parentElement?.disabled)) throw new Error('BROWSER_OPTION_DISABLED: ' + wanted);
    for (const option of el.options) option.selected = options.includes(option);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = wanted; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: wanted }));
  } else if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['file', 'button', 'submit', 'reset', 'image', 'hidden'].includes(el.type))) {
    const probe = document.createElement(el.tagName); if (el.tagName === 'INPUT') probe.type = el.type; probe.value = wanted;
    if (probe.value !== wanted) throw new Error('BROWSER_VALUE_REJECTED: input keeps previous value');
    const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, wanted);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: wanted }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else throw new Error('BROWSER_NOT_EDITABLE: element does not accept a value');
  return read();
}

export function domFocused() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || !(el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName))) throw new Error('BROWSER_NO_FOCUSED_FIELD: focus a text field first');
  if (el.matches(':disabled') || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') throw new Error('BROWSER_NOT_EDITABLE: focused field is locked');
  if (el.tagName === 'INPUT' && !['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(el.type)) throw new Error('BROWSER_NOT_EDITABLE: focused field is not text');
  return el;
}
