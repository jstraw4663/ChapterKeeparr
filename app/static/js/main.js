// Boot: shell, router, render loop, delegated actions, live updates.

import { html } from './format.js';
import { parse, legacyJobTarget, navFor } from './router.js';
import { state, start, subscribe, onEvents, bookById, refresh } from './store.js';
import { shellMarkup, applyAppearance, initShell, updateShell, setScreenChrome, shellActions, closeSearch, refreshSearch } from './shell.js';
import { notify } from './notify.js';
import { onPrefs } from './prefs.js';
import { hydrateCovers } from './covers.js';
import { top as topOverlay } from './overlay.js';
import * as audio from './audio.js';
import { playerBar } from './player.js';

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

function ctx(enter = false) {
  return { route, state, ui, enter, phone: phoneQuery.matches, rerender: () => render(false, true) };
}

function render(enter = false, force = false) {
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
  view.innerHTML = String(screen.render(c));
  hydrateCovers(view);
  unmount = screen.mount?.(view, c) || null;
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
  if (!uiByRoute.has(key)) uiByRoute.set(key, {});
  ui = uiByRoute.get(key);
  route = { ...parsed, nav: navFor(parsed) };
  screen = SCREENS[route.name];
  const phone = phoneQuery.matches;
  setScreenChrome({ topbar: screen.topbar !== false, detail: typeof screen.detail === 'function' ? screen.detail(ctx()) : Boolean(screen.detail && phone) });
  document.title = `${typeof screen.title === 'function' ? screen.title(ctx()) : screen.title} · ChapterKeeparr`;
  updateShell(route);
  lastSig = '';
  render(true);
  window.scrollTo(0, 0);
  if (!firstRender) document.querySelector('#view h1')?.focus({ preventScroll: true });
  firstRender = false;
}

function dispatch(event) {
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
  document.body.innerHTML = String(shellMarkup());
  applyAppearance();
  initShell();
  document.addEventListener('click', dispatch);
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
