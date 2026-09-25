// Notification choreography (DESIGN.md §9): arrive → hold ~3.6s → fly into the
// Needs review or Queue badge (own actions fade in place) → badge pops with a halo.
// Every notification is also written to the activity log.

import { html } from './format.js';
import { icon, ICON_FOR_KIND } from './icons.js';
import { cover } from './ui.js';
import { getPrefs, appendLog } from './prefs.js';
import { bookById } from './store.js';
import { isPhone } from './overlay.js';

const HOLD = 3600, ENTER = 550, FLY = 720;
const queue = [];
let current = null;
const logListeners = new Set();
export const onLog = fn => { logListeners.add(fn); return () => logListeners.delete(fn); };

const reduced = () => document.documentElement.dataset.motion === 'reduce';

export function notify(event) {
  const kind = event.kind === 'plain' ? 'you' : event.kind === 'info' ? 'play' : event.kind;
  appendLog({ id: `n:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), kind, text: event.title, detail: event.body || '', href: event.href || '', jobId: event.jobId || null, own: Boolean(event.own) });
  logListeners.forEach(fn => fn());
  if (!getPrefs().notifications) { bump(event.dest); return; }
  queue.push(event);
  if (!current) next();
}

function next() {
  const event = queue.shift();
  if (!event) { current = null; return; }
  current = show(event);
}

function placement() {
  if (isPhone()) return 'phone';
  return document.documentElement.classList.contains('collapsed') ? 'corner' : 'side';
}

function show(event) {
  const where = placement();
  const book = event.jobId ? bookById(event.jobId) : null;
  const el = document.createElement('div');
  el.className = `note-card at-${where} in${event.kind === 'plain' ? ' plain' : ''}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const thumbSize = where === 'side' ? 40 : where === 'phone' ? 44 : 48;
  const thumb = html`<div class="thumb" style="width:${thumbSize}px;height:${thumbSize}px">${book ? cover(book, { size: thumbSize, radius: 9 }) : ''}<span class="ticon ${event.kind}">${icon(ICON_FOR_KIND[event.kind] || 'check', 12, { stroke: 2.6 })}</span></div>`;
  const action = event.kind !== 'plain' && event.href ? html`<a class="tbtn" href="${event.href}" data-note-action>${event.action || 'Open'}</a>` : '';
  const close = html`<button type="button" class="tclose" data-note-close aria-label="Dismiss notification">${icon('x', 18)}</button>`;
  el.innerHTML = String(where === 'side'
    ? html`<div class="row gap12" style="align-items:flex-start">${thumb}<span class="nt clamp2">${event.title}</span></div>${event.body ? html`<p class="nb">${event.body}</p>` : ''}<div class="row" style="justify-content:space-between;margin-top:10px">${action || html`<span></span>`}<span style="margin-right:-10px">${close}</span></div><span class="holdbar"></span>`
    : html`<div class="row gap14" style="padding:${where === 'phone' ? '12px 8px 12px 12px' : '14px 16px 14px 14px'}">${thumb}${where === 'phone' && action ? html`<a class="col gap4 grow nlink" href="${event.href}" data-note-action><span class="nt ell">${event.title}</span>${event.body ? html`<span class="nb ell">${event.body}</span>` : ''}</a>` : html`<div class="col gap4 grow"><span class="nt ell">${event.title}</span>${event.body ? html`<span class="nb ell">${event.body}</span>` : ''}</div>`}${where === 'phone' ? '' : action}${close}</div><span class="holdbar"></span>`);
  if (where === 'side') {
    const settings = document.querySelector('.rail [data-nav="settings"]');
    const top = settings ? settings.getBoundingClientRect().bottom + 16 : 360;
    el.style.top = `${Math.round(top)}px`;
  }
  document.getElementById('notes').append(el);
  let done = false;
  const timer = setTimeout(() => minimize(), ENTER + HOLD);
  function minimize() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const target = event.dest ? badgeFor(event.dest) : null;
    const rect = el.getBoundingClientRect();
    let dx = 0, dy = where === 'side' ? -20 : 24;
    if (target) {
      const t = target.getBoundingClientRect();
      dx = t.left + t.width / 2 - (rect.left + rect.width / 2);
      dy = t.top + t.height / 2 - (rect.top + rect.height / 2);
    }
    el.style.setProperty('--dx', `${Math.round(dx)}px`);
    el.style.setProperty('--dy', `${Math.round(dy)}px`);
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      bump(event.dest);
      next();
    }, reduced() ? 220 : FLY + 20);
  }
  // The whole card opens its destination (the phone card has no room for an action button).
  if (event.href && event.kind !== 'plain') el.classList.add('tappable');
  el.addEventListener('click', ev => {
    if (ev.target.closest('[data-note-close]')) { minimize(); return; }
    if (!ev.target.closest('[data-note-action]') && event.href && event.kind !== 'plain') location.hash = event.href;
    if (event.href) setTimeout(minimize, 50);
  });
  return { minimize };
}

/** The visible badge for a destination: sidebar on desktop, tab bar on phone. */
function badgeFor(dest) {
  const scope = isPhone() ? '.tabbar' : '.rail';
  const badge = document.querySelector(`${scope} [data-badge="${dest}"]`);
  if (!badge) return null;
  return badge.offsetParent ? badge : badge.closest('.glyph') || badge.parentElement;
}

export function bump(dest) {
  if (!dest) return;
  document.querySelectorAll(`[data-badge="${dest}"]`).forEach(badge => {
    badge.classList.remove('bump');
    void badge.offsetWidth; // restart the animation
    badge.classList.add('bump');
    setTimeout(() => badge.classList.remove('bump'), 800);
  });
}
