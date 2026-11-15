// Also serialized into the Chromium and BiDi page functions. Keep this
// function self-contained so neither channel can accidentally return secrets.
export function readSafeValue(element) {
  if (!element) return '';
  const type = String(element.type ?? '').toLowerCase();
  const autocomplete = String(element.getAttribute?.('autocomplete') ?? element.autocomplete ?? '').toLowerCase().split(/\s+/);
  const sensitive = type === 'password' || autocomplete.some(item => /^(?:current-password|new-password|one-time-code|cc-number|cc-csc)$/.test(item));
  if (sensitive) return '[redacted; length=' + String(element.value ?? '').length + ']';
  if (element.tagName === 'SELECT') return [...element.selectedOptions].map(option => option.text.trim()).join(', ');
  if (type === 'checkbox' || type === 'radio') return element.checked ? 'checked' : 'unchecked';
  if (type === 'file') return [...element.files].map(file => file.name).join(', ');
  return 'value' in element && typeof element.value === 'string' ? element.value : (element.innerText ?? element.textContent ?? '');
}
