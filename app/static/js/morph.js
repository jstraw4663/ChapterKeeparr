// Patch a live DOM subtree to match new markup instead of replacing it.
// Re-renders from polling then leave unchanged elements alone: cover images
// don't reload, entrance and progress animations don't replay, and focus,
// caret and scroll stay where they were.
//
// Children are matched by key (id, data-key or data-book) and otherwise by
// position and tag. Cover images with the same data-art are left untouched.
// Pure DOM; no framework.

/** Classes added at runtime (cover art loaded, disclosure opened, ink placed) that markup never contains. */
const RUNTIME_CLASSES = ['loaded', 'has-art', 'opened', 'ink-ready'];

const keyOf = node => {
  if (node.nodeType !== 1) return '';
  return node.id || node.dataset.key || node.dataset.book || '';
};

/** Replace the children of `el` with `markup`, reusing matching nodes. */
export function morphInto(el, markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  morphChildren(el, template.content);
}

function morphChildren(from, to) {
  const wanted = [...to.childNodes];
  const newKeys = new Set(wanted.map(keyOf).filter(Boolean));
  const keyed = new Map();
  for (const node of from.childNodes) { const k = keyOf(node); if (k) keyed.set(k, node); }

  let cursor = from.firstChild;
  const skipStale = () => {
    // Drop old keyed nodes that aren't in the new markup so they don't block reuse.
    while (cursor && keyOf(cursor) && !newKeys.has(keyOf(cursor))) {
      const next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
  };
  for (const node of wanted) {
    skipStale();
    const k = keyOf(node);
    let match = null;
    if (k) { match = keyed.get(k) || null; keyed.delete(k); }
    else if (cursor && !keyOf(cursor) && same(cursor, node)) match = cursor;
    if (match && !same(match, node)) match = null;
    if (match) {
      if (match === cursor) cursor = cursor.nextSibling;
      else from.insertBefore(match, cursor);
      morphNode(match, node);
    } else {
      from.insertBefore(node, cursor);
    }
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}

function same(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  // A cover image already showing the same art: leave it (src was set at runtime).
  if (from.tagName === 'IMG' && from.dataset.art && from.dataset.art === to.dataset.art) return;
  // Sliding ink is positioned at runtime (transitions.js); keep it where it is.
  if (from.classList?.contains('ink') && to.classList?.contains('ink')) return;
  syncAttributes(from, to);
  syncFormState(from, to);
  morphChildren(from, to);
}

function syncAttributes(from, to) {
  for (const { name } of [...from.attributes]) {
    if (from.tagName === 'DETAILS' && name === 'open') continue;
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
  for (const { name, value } of [...to.attributes]) {
    if (from.tagName === 'DETAILS' && name === 'open') continue;
    if (name === 'class') {
      const kept = RUNTIME_CLASSES.filter(c => from.classList.contains(c) && !to.classList.contains(c));
      const next = kept.length ? `${value} ${kept.join(' ')}` : value;
      if (from.getAttribute('class') !== next) from.setAttribute('class', next);
      continue;
    }
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

function syncFormState(from, to) {
  const tag = from.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'OPTION') return;
  if (tag === 'OPTION') { from.selected = to.hasAttribute('selected'); return; }
  if (from.type === 'checkbox' || from.type === 'radio') { from.checked = to.hasAttribute('checked'); return; }
  // Never overwrite what the user is typing.
  if (from === document.activeElement) return;
  if (tag === 'SELECT') return; // options carry the selection
  const value = tag === 'TEXTAREA' ? to.textContent : (to.getAttribute('value') ?? '');
  if (from.value !== value) from.value = value;
}
