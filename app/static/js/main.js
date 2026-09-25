// Boot: shell, router, render loop, delegated actions, live updates.

import { html } from './format.js';
import { parse, legacyJobTarget, navFor } from './router.js';
import { state, start, subscribe, onEvents, bookById, refresh } from './store.js';
import { shellMarkup, applyAppearance, initShell, updateShell, setScreenChrome, shellActions, closeSearch, refreshSearch } from './shell.js';
import { notify } from './notify.js';
import { onPrefs } from './prefs.js';
import { hydrateCovers, settleCovers } from './covers.js';
import { top as topOverlay } from './overlay.js';
import * as audio from './audio.js';
import { playerBar } from './player.js';
import { emptyState } from './ui.js';
import { morphInto } from './morph.js';
import { transition, kindOf, stripEntrance, syncInks, syncTabbarInk } from './transitions.js';

import library from './screens/library.js';
import queue from './screens/queue.js';
import review from './screens/review.js';
import book from './screens/book.js';
import newjob from './screens/newjob.js';
import suggestions from './screens/suggestions.js';
import settings from './screens/settings.js';

const SCREENS = { library, queue, review, book, newjob, suggestions, settings };
const phoneQuery = window.matchMedia('(max-width: 767px)');

let route = null;
let screen = null;
let ui = {};               // per-route screen state, survives re-renders
const uiByRoute = new Map();
let lastSig = '';
let unmount = null;
let firstRender = true;
let currentKey = '';
const scrollByKey = new Map(); // route key → scroll position, for returning to a tab or list

function ctx(enter = false) {
  return { route, state, ui, enter, phone: phoneQuery.matches, rerender: () => render(false, true) };
}

/**
 * enter: first render of this route (mount may scroll or focus).
 * patch: update the existing DOM even on enter (same screen, different route).
 * still: drop per-element entrance animations (a view transition animates instead).
 */
function render(enter = false, force = false, { patch = false, still = false } = {}) {
  if (!screen) return;
  const view = document.getElementById('view');
  const c = ctx(enter);
  const sig = `${phoneQuery.matches}|${screen.signature ? screen.signature(c) : Math.random()}`;
  if (!force && !enter && sig === lastSig) return;
  lastSig = sig;
  // Keep focus, caret and scroll across re-renders.
  const active = document.activeElement;
  const focusId = active && view.contains(active) ? active.id : '';
  const focusAct = !focusId && active && view.contains(active) && active.dataset?.act ? `[data-act="${active.dataset.act}"]${active.dataset.arg != null ? `[data-arg="${CSS.escape(active.dataset.arg)}"]` : ''}` : '';
  const selection = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = window.scrollY;
  unmount?.();
  if (typeof screen.title === 'function') document.title = `${screen.title(c)} · ChapterKeeparr`;
  try {
    // A new screen renders fresh (with its entrance); updates patch in place.
    if (enter && !patch) view.innerHTML = String(screen.render(c));
    else morphInto(view, String(screen.render(c)));
    if (still) stripEntrance(view);
    hydrateCovers(view);
    syncInks(view);
    unmount = screen.mount?.(view, c) || null;
  } catch (error) {
    // Keep the shell usable and say what broke instead of leaving a blank page.
    console.error(error);
    unmount = null;
    view.innerHTML = String(html`<div class="page-inset">${emptyState({ title: 'This screen couldn’t be shown', body: error?.message || 'Unexpected error', action: html`<button type="button" class="btn btn-md" onclick="location.reload()">Reload</button>` })}</div>`);
    return;
  }
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus({ preventScroll: true }); if (selection && 'setSelectionRange' in el) { try { el.setSelectionRange(...selection); } catch { /* not a text input */ } } }
  } else if (focusAct) {
    view.querySelector(focusAct)?.focus({ preventScroll: true });
  }
  if (!enter) window.scrollTo(0, scroll);
}

function go() {
  audio.stop();
  closeSearch();
  const parsed = parse(location.hash);
  if (parsed.redirect) { location.replace(parsed.redirect); return; }
  if (parsed.legacyJob) {
    const target = () => location.replace(legacyJobTarget(bookById(parsed.legacyJob), parsed.match));
    if (state.loaded) target(); else refresh().then(target);
    return;
  }
  const key = location.hash.split('?')[0] || '#/';
  if (currentKey) scrollByKey.set(currentKey, window.scrollY);
  const from = route;
  const next = { ...parsed, nav: navFor(parsed) };
  const phone = phoneQuery.matches;
  const kind = firstRender ? 'none' : kindOf(from, next, phone);
  // Tabs and lists come back where you left them; details open at the top.
  const restore = !next.id && (kind === 'pop' || kind.startsWith('tab')) ? scrollByKey.get(key) || 0 : 0;
  const swap = () => {
    currentKey = key;
    if (!uiByRoute.has(key)) uiByRoute.set(key, {});
    ui = uiByRoute.get(key);
    ui.menu = null;
    route = next;
    screen = SCREENS[route.name];
    setScreenChrome({ topbar: screen.topbar !== false, detail: typeof screen.detail === 'function' ? screen.detail(ctx()) : Boolean(screen.detail && phone) });
    document.title = `${typeof screen.title === 'function' ? screen.title(ctx()) : screen.title} · ChapterKeeparr`;
    updateShell(route);
    lastSig = '';
    // First load keeps the designed entrance; later navigation is animated by the transition.
    render(true, false, { patch: kind === 'same', still: kind !== 'none' });
    window.scrollTo(0, restore);
    if (kind !== 'none') document.querySelector('#view h1')?.focus({ preventScroll: true });
    return settleCovers(document.getElementById('view'));
  };
  transition(kind, swap, { bookId: kind === 'push' ? next.id : kind === 'pop' ? from?.id : '' });
  firstRender = false;
}

/** Close an open drop-down menu (menuButton); returns true when one was open. */
function closeMenu({ focusToggle = false } = {}) {
  if (!ui.menu) return false;
  const id = ui.menu;
  ui.menu = null;
  render(false, true);
  if (focusToggle) document.querySelector(`[data-act="menu-toggle"][data-arg="${CSS.escape(id)}"]`)?.focus();
  return true;
}

function dispatch(event) {
  // Any click outside an open menu closes it; picking an item closes it too.
  if (ui.menu && !event.target.closest(`.menuwrap[data-key="${CSS.escape(ui.menu)}"]`)) closeMenu();
  else if (ui.menu && event.target.closest('.menuitem')) ui.menu = null;
  const el = event.target.closest('[data-act]');
  if (!el || el.closest('.layer')) return;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const name = el.dataset.act;
  const fn = screen?.actions?.[name] || shellActions[name] || commonActions[name];
  if (!fn) return;
  if (el.tagName !== 'A' || el.dataset.actPreventNav !== undefined) event.preventDefault();
  fn(el, event, ctx());
}

const commonActions = {
  'menu-toggle'(el, event, c) {
    const id = el.dataset.arg;
    c.ui.menu = c.ui.menu === id ? null : id;
    render(false, true);
    if (c.ui.menu) document.querySelector(`#${CSS.escape(id)}-menu .menuitem`)?.focus();
  },
  'player-stop': () => audio.stop(),
  'player-full': () => audio.continueToChapterEnd(),
  /** Collapsible panels: open state lives in the screen's ui.open map. */
  toggle(el, event, c) {
    const id = el.dataset.arg;
    const body = document.getElementById(`${id}-body`);
    const open = el.getAttribute('aria-expanded') !== 'true';
    c.ui.open = { ...(c.ui.open || {}), [id]: open };
    el.setAttribute('aria-expanded', String(open));
    if (body) {
      body.hidden = !open;
      if (open) { body.classList.remove('opened'); void body.offsetWidth; body.classList.add('opened'); }
    }
  },
};

function boot() {
  // Screens set their own scroll position; don't let a reload restore the old one over it.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  document.body.innerHTML = String(shellMarkup());
  applyAppearance();
  initShell();
  document.addEventListener('click', dispatch);
  // Start loading a screen's data as soon as a finger or pointer goes down on a link to it.
  document.addEventListener('pointerdown', event => {
    const a = event.target.closest?.('a[href^="#/"]');
    if (!a) return;
    const target = parse(a.getAttribute('href'));
    if (target.name) SCREENS[target.name]?.prefetch?.(target);
  }, { passive: true });
  const reink = () => { syncInks(document); syncTabbarInk(); };
  window.addEventListener('resize', reink);
  document.fonts?.ready.then(reink);
  document.addEventListener('keydown', event => {
    if (!ui.menu || document.querySelector('.layer')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu({ focusToggle: true }); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...document.querySelectorAll(`#${CSS.escape(ui.menu)}-menu .menuitem`)];
      if (!items.length) return;
      event.preventDefault();
      const i = items.indexOf(document.activeElement);
      items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  const onField = event => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || el.closest('.layer') || !document.getElementById('view').contains(el)) return;
    screen?.onInput?.(el, event, ctx());
  };
  document.addEventListener('input', onField);
  document.addEventListener('change', onField);
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.closest('.layer') || !screen?.onSubmit) return;
    event.preventDefault();
    screen.onSubmit(form, event, ctx());
  });
  window.addEventListener('hashchange', go);
  phoneQuery.addEventListener?.('change', () => { lastSig = ''; go(); });
  onPrefs(() => { applyAppearance(); });
  subscribe(() => {
    updateShell(route);
    refreshSearch();
    render(false);
    topOverlay()?.refresh?.();
  });
  onEvents(events => events.forEach(notify));
  audio.onPlayer(now => {
    document.getElementById('player-slot').innerHTML = String(now ? playerBar(now) : html``);
    render(false, true);
  });
  go();
  start();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
