// The single sheet/modal system (DESIGN.md §8). Modal on desktop, bottom sheet on
// phone, same content. Traps focus, closes on Esc and scrim, returns focus.

import { html, raw } from './format.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { morphInto } from './morph.js';
import { syncInks } from './transitions.js';

export const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

const stack = [];
let root;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function ensureRoot() {
  if (!root) { root = document.getElementById('overlays'); }
  return root;
}

/**
 * open({ label, kind: 'auto'|'sheet'|'modal', render(), actions: {name: (el, ev) => {}}, onClose, tall })
 * → { close(), update(), el }
 */
export function open({ label, kind = 'auto', render, actions = {}, onClose, tall = false, initialFocus }) {
  const asSheet = kind === 'sheet' || (kind === 'auto' && isPhone());
  const trigger = document.activeElement;
  const triggerAct = trigger?.dataset?.act || '';
  const layer = document.createElement('div');
  layer.className = 'layer';
  const scrim = document.createElement('button');
  scrim.type = 'button';
  scrim.className = 'scrim';
  scrim.setAttribute('aria-label', 'Close');
  scrim.tabIndex = -1;
  const box = document.createElement('div');
  box.className = asSheet ? `sheet${tall ? ' tall' : ''}` : 'modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', label);
  layer.append(scrim, box);
  ensureRoot().append(layer);

  const handle = {
    el: box,
    asSheet,
    actions,
    update() { morphInto(box, String(render({ asSheet, close: handle.close }))); syncInks(box); },
    close(reason) {
      const i = stack.indexOf(handle);
      if (i < 0) return;
      stack.splice(i, 1);
      layer.remove();
      if (!stack.length) document.documentElement.classList.remove('overlay-open');
      onClose?.(reason);
      // The trigger may have been re-rendered while the overlay was open; find its replacement.
      const target = trigger && document.contains(trigger) ? trigger
        : triggerAct ? document.querySelector(`[data-act="${CSS.escape(triggerAct)}"]`) : null;
      target?.focus({ preventScroll: true });
    },
  };
  stack.push(handle);
  document.documentElement.classList.add('overlay-open');
  handle.update();
  scrim.addEventListener('click', () => handle.close('scrim'));
  box.addEventListener('click', event => {
    const el = event.target.closest('[data-act]');
    if (!el || !box.contains(el)) return;
    const fn = handle.actions[el.dataset.act];
    if (fn) { event.preventDefault(); event.stopPropagation(); fn(el, event); }
  });
  setTimeout(() => {
    const target = (initialFocus && box.querySelector(initialFocus)) || box.querySelector('[autofocus]') || box.querySelector(FOCUSABLE) || box;
    if (target === box) box.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, 0);
  return handle;
}

export const top = () => stack[stack.length - 1] || null;

document.addEventListener('keydown', event => {
  const current = top();
  if (!current) return;
  if (event.key === 'Escape') { event.preventDefault(); current.close('escape'); return; }
  if (event.key !== 'Tab') return;
  const items = [...current.el.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !current.el.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !current.el.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
});

/** Header for a modal (title + ×) or a sheet (grab handle + title + ×). */
export function head(title, asSheet, { center = false, left = '', right = '' } = {}) {
  if (asSheet && center) {
    return html`<div class="grab"></div><div class="sheet-head center">${left || html`<span style="width:52px"></span>`}<span class="t">${title}</span>${right || html`<span style="width:52px"></span>`}</div>`;
  }
  const close = html`<button type="button" class="tclose" data-act="overlay-close" aria-label="Close" style="margin:0 -10px 0 0">${icon('x', 20)}</button>`;
  return asSheet
    ? html`<div class="grab"></div><div class="sheet-head"><span class="t">${title}</span>${close}</div>`
    : html`<div class="modal-head"><span class="t">${title}</span>${close}</div>`;
}

/** Phone destructive confirmation (DESIGN.md §8 Destructive confirm). Resolves true when confirmed. */
export function confirmSheet({ title, body, confirmLabel, keepLabel = 'Keep it' }) {
  return new Promise(resolve => {
    let done = false;
    const h = open({
      label: title, kind: 'sheet',
      render: () => html`<div class="grab"></div><p style="margin:6px 0 4px;font-size:18px;font-weight:800">${title}</p><p class="meta" style="margin:0 0 16px;font-size:14px">${body}</p><div class="col gap12">${button({ label: confirmLabel, kind: 'danger-fill', size: 'lg', act: 'yes', block: true })}${button({ label: keepLabel, size: 'lg', act: 'no', block: true })}</div>`,
      actions: { yes: () => { done = true; h.close(); resolve(true); }, no: () => h.close() },
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/** Phone "…" menu: items [{ label, icon, onSelect, danger, disabled, reason, href }]. */
export function actionSheet(label, items) {
  const h = open({
    label, kind: 'sheet',
    render: () => html`<div class="grab"></div>${items.map((item, i) => item.href && !item.disabled
      ? html`<a class="actrow ${item.danger ? 'danger' : ''}" href="${item.href}" data-act="pick" data-arg="${i}">${icon(item.icon, 22)}${item.label}</a>`
      : html`<button type="button" class="actrow ${item.danger ? 'danger' : ''}" data-act="pick" data-arg="${i}" ${item.disabled ? raw('disabled') : ''} ${item.reason ? html`title="${item.reason}"` : ''}>${icon(item.icon, 22)}<span class="col"><span>${item.label}</span>${item.disabled && item.reason ? html`<span class="meta">${item.reason}</span>` : ''}</span></button>`)}`,
    actions: {
      pick: el => {
        const item = items[Number(el.dataset.arg)];
        if (!item || item.disabled) return;
        h.close();
        // The sheet's click handler cancels link navigation, so follow href here.
        if (item.href) location.href = item.href;
        item.onSelect?.();
      },
    },
  });
  return h;
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-act="overlay-close"]');
  if (el) top()?.close('button');
}, true);
