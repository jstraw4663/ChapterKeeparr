// Bounded, simultaneous notifications. Occupied slots and their timers survive
// polling; a dismissed slot is refilled without moving the other cards.
import { html } from './format.js';
import { icon, ICON_FOR_KIND } from './icons.js';
import { cover } from './ui.js';
import { hydrateCovers } from './covers.js';
import { getPrefs, appendLog } from './prefs.js';
import { bookById } from './store.js';
import { isPhone } from './overlay.js';

const HOLD = 6000, FLY = 720, LIMIT = 3, PENDING_LIMIT = 100;
const waiting = [], active = new Map(), slots = [];
const logListeners = new Set();
let panel, list, more, observer, hovering = false, focused = false, scrolling = false, scrollTimer;
export const onLog = fn => { logListeners.add(fn); return () => logListeners.delete(fn); };
const reduced = () => document.documentElement.dataset.motion === 'reduce';

export function notify(event) {
  const kind = event.kind === 'plain' ? 'you' : event.kind === 'info' ? 'play' : event.kind;
  appendLog({ id: `n:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), kind, text: event.title, detail: event.body || '', href: event.href || '', jobId: event.jobId || null, own: Boolean(event.own) });
  logListeners.forEach(fn => fn());
  if (!getPrefs().notifications) { bump(event.dest); return; }
  // Resolve at arrival, before a refresh can change/remove the job in the store.
  const book = event.book || (event.jobId && bookById(event.jobId)) || (event.jobId ? { id: event.jobId, title: event.title } : null);
  if (waiting.length >= PENDING_LIMIT) { bump(event.dest); return; } // Activity retains the event.
  waiting.push({ ...event, book });
  ensurePanel();
  fill();
}

function placement() {
  return isPhone() ? 'phone' : document.documentElement.classList.contains('collapsed') ? 'corner' : 'side';
}

function ensurePanel() {
  if (panel) return;
  panel = document.getElementById('notes');
  panel.setAttribute('aria-label', 'Notifications');
  panel.setAttribute('role', 'region');
  panel.className = 'note-stack';
  list = document.createElement('div'); list.className = 'note-slots';
  more = document.createElement('span'); more.className = 'note-waiting';
  panel.append(list, more);
  for (let i = 0; i < LIMIT; i++) {
    const slot = document.createElement('div'); slot.className = 'note-slot'; slot.hidden = true;
    list.append(slot); slots.push(slot);
  }
  observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const note = [...active.values()].find(n => n.el === entry.target);
      if (note) { note.visible = entry.intersectionRatio >= .9; clock(note); }
    }
  }, { root: list, threshold: [.0, .9, 1] }) : null;
  panel.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovering = true; clocks(); } });
  panel.addEventListener('pointerleave', () => { hovering = false; clocks(); });
  panel.addEventListener('focusin', () => { focused = true; clocks(); });
  panel.addEventListener('focusout', () => queueMicrotask(() => { focused = panel.contains(document.activeElement); clocks(); }));
  list.addEventListener('scroll', () => { scrolling = true; clocks(); clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { scrolling = false; clocks(); }, 300); }, { passive: true });
  window.addEventListener('resize', layout, { passive: true });
  new MutationObserver(layout).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', clocks);
}

export function reflowNotifications() { layout(); }

function layout() {
  if (!panel) return;
  const where = placement(); panel.className = `note-stack at-${where}`;
  let top = 12, bottom = 24;
  if (where === 'side') {
    top = Math.round(document.querySelector('.rail [data-nav="settings"]')?.getBoundingClientRect().bottom || 340) + 12;
    const activityTop = document.querySelector('.act')?.getBoundingClientRect().top;
    bottom = activityTop > top ? innerHeight - activityTop + 12 : 80;
  } else if (where === 'phone') {
    const bars = [...document.querySelectorAll('.tabbar,.player.mob,.cr-save')].filter(el => el.offsetParent !== null);
    bottom = Math.max(88, ...bars.map(el => innerHeight - el.getBoundingClientRect().top + 12));
    top = 72;
  }
  panel.style.top = where === 'side' ? `${top}px` : 'auto';
  panel.style.bottom = where === 'side' ? 'auto' : `${bottom}px`;
  panel.style.maxHeight = `${Math.max(100, innerHeight - top - bottom)}px`;
  const overflow = list.scrollHeight > list.clientHeight + 1;
  more.textContent = waiting.length ? `${waiting.length} more waiting` : overflow ? 'Scroll for more notifications' : '';
  more.hidden = !more.textContent;
  for (const note of active.values()) { note.el.className = note.el.className.replace(/at-(side|corner|phone)/g, `at-${where}`); }
}

function fill() {
  for (let i = 0; i < LIMIT && waiting.length; i++) {
    if (active.has(i)) continue;
    const event = waiting.shift(), slot = slots[i];
    slot.hidden = false;
    const el = document.createElement('div');
    el.className = `note-card stack-note at-${placement()} in${event.kind === 'plain' ? ' plain' : ''}`;
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true');
    const thumb = html`<div class="thumb">${event.book ? cover(event.book, { size: 40, radius: 9 }) : icon(ICON_FOR_KIND[event.kind] || 'check', 24)}<span class="ticon ${event.kind}">${icon(ICON_FOR_KIND[event.kind] || 'check', 12, { stroke: 2.6 })}</span></div>`;
    el.innerHTML = String(html`<div class="note-heading">${thumb}<span class="nt clamp2">${event.title}</span></div>${event.body ? html`<p class="nb clamp2">${event.body}</p>` : ''}<div class="note-actions">${event.kind !== 'plain' && event.href ? html`<a class="tbtn" href="${event.href}" data-note-action>${event.action || 'Open'}</a>` : html`<span></span>`}<button type="button" class="tclose" data-note-close aria-label="Dismiss notification: ${event.title}">${icon('x', 18)}</button></div><span class="holdbar" aria-hidden="true"></span>`);
    slot.replaceChildren(el);
    const note = { el, event, slot: i, remaining: HOLD, started: 0, timer: null, visible: !observer, done: false };
    active.set(i, note);
    el.querySelector('[data-note-close]').onclick = () => minimize(note);
    el.querySelector('[data-note-action]')?.addEventListener('click', () => minimize(note));
    hydrateCovers(el);
    if (observer) observer.observe(el); else clock(note);
  }
  more.textContent = waiting.length ? `${waiting.length} more waiting` : '';
  more.hidden = !waiting.length;
  layout();
}

function clocks() { for (const note of active.values()) clock(note); }
function clock(note) {
  if (note.done) return;
  if (note.timer !== null) {
    clearTimeout(note.timer); note.timer = null;
    note.remaining = Math.max(0, note.remaining - (performance.now() - note.started));
  }
  const paused = hovering || focused || scrolling || document.hidden || !note.visible;
  note.el.querySelector('.holdbar').style.animationPlayState = paused ? 'paused' : 'running';
  if (!paused) { note.started = performance.now(); note.timer = setTimeout(() => minimize(note), note.remaining); }
}

function minimize(note) {
  if (note.done) return;
  note.done = true; clearTimeout(note.timer); observer?.unobserve(note.el);
  const rect = note.el.getBoundingClientRect(), target = note.event.dest && badgeFor(note.event.dest);
  const dest = target?.getBoundingClientRect();
  const focusedHere = note.el.contains(document.activeElement);
  Object.assign(note.el.style, { position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`, bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px` });
  note.el.style.setProperty('--dx', `${dest ? dest.left + dest.width / 2 - rect.left - rect.width / 2 : 0}px`);
  note.el.style.setProperty('--dy', `${dest ? dest.top + dest.height / 2 - rect.top - rect.height / 2 : -20}px`);
  note.el.classList.remove('in'); note.el.classList.add('out');
  document.body.append(note.el); // The empty slot holds its space while the card flies.
  if (focusedHere) [...active.values()].find(n => n !== note && !n.done)?.el.querySelector('button')?.focus();
  setTimeout(() => {
    note.el.remove(); active.delete(note.slot); bump(note.event.dest);
    if (!active.size && !waiting.length) for (const slot of slots) slot.hidden = true;
    fill();
  }, reduced() ? 220 : FLY + 20);
}

function badgeFor(dest) {
  const scope = isPhone() ? '.tabbar' : '.rail';
  const badge = document.querySelector(`${scope} [data-badge="${dest}"]`);
  return badge && (badge.offsetParent ? badge : badge.closest('.glyph') || badge.parentElement);
}

export function bump(dest) {
  if (!dest) return;
  document.querySelectorAll(`[data-badge="${dest}"]`).forEach(badge => {
    badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump');
    setTimeout(() => badge.classList.remove('bump'), 800);
  });
}
