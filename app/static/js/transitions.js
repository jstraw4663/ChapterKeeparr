// Screen-to-screen motion (DESIGN.md §7, §12).
//
// Route changes run inside the View Transitions API: the browser keeps the old
// page on screen, we swap the DOM, and CSS animates old → new (no blank frame).
// The shell (sidebar, phone header, tab bar, FAB) is named so it stays put;
// the page slides by direction, and the tapped book's cover and title morph
// into the next screen. Browsers without the API get a short fade.
//
// Also here: the sliding ink under tabs, segmented controls and the phone tab bar.

import { NAV } from './router.js';

const ORDER = NAV.map(item => item.name);   // sidebar order, used for tab direction
let running = null;

const reduced = () => document.documentElement.dataset.motion === 'reduce';

/** 'push' (into a detail), 'pop' (back out), 'tab-right' / 'tab-left', 'same' or 'none'. */
export function kindOf(from, to, phone) {
  if (!from) return 'none';
  if (from.name === to.name) {
    const a = from.id || '', b = to.id || '';
    if (a === b) return 'same';
    // Desktop Needs review is a split view: switching books isn't a drill-down.
    if (!phone && to.name === 'review') return 'same';
    return b && !a ? 'push' : a && !b ? 'pop' : 'same';
  }
  if (to.id && !from.id) return 'push';
  if (from.id && !to.id) return 'pop';
  const i = ORDER.indexOf(from.nav || from.name), j = ORDER.indexOf(to.nav || to.name);
  return j >= i ? 'tab-right' : 'tab-left';
}

/** The first visible element in #view marked for this book (cover or title). */
function shared(kind, id) {
  if (!id) return null;
  const view = document.getElementById('view');
  for (const el of view.querySelectorAll(`[data-vt-${kind}="${CSS.escape(id)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) return el;
  }
  return null;
}

function nameShared(id) {
  const named = [];
  for (const kind of ['cover', 'title']) {
    const el = shared(kind, id);
    if (el) { el.style.viewTransitionName = `vt-${kind}`; named.push(el); }
  }
  return named;
}
const unname = els => els.forEach(el => { el.style.viewTransitionName = ''; });

/**
 * Run `update` (which swaps the page) as a transition of `kind`.
 * `bookId` is the book whose cover/title should morph between the two screens.
 */
export function transition(kind, update, { bookId = '' } = {}) {
  running?.skipTransition?.();
  const root = document.documentElement;
  if (kind === 'none' || !document.startViewTransition || document.hidden) {
    update();
    if (kind !== 'none') document.getElementById('view')?.animate?.([{ opacity: 0.5 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    return;
  }
  const before = nameShared(bookId);
  root.dataset.vt = reduced() ? 'fade' : kind;
  let after = [];
  const vt = document.startViewTransition(() => {
    unname(before);
    update();
    after = nameShared(bookId);
  });
  running = vt;
  // A skipped or aborted animation still swaps the page; nothing to report.
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => {
    unname(after);
    if (running === vt) { running = null; delete root.dataset.vt; }
  });
}

/** Remove per-element entrance animations: the view transition already animates the page. */
export function stripEntrance(root) {
  root.querySelectorAll('.rise, .pushin, .stack-in').forEach(el => el.classList.remove('rise', 'pushin', 'stack-in'));
}

// ---------- sliding ink ----------
const INKS = [['.tabs', '.tab'], ['.segctl', '.sgb']];

/** Put each tab strip's ink under its selected option; it slides on later changes. */
export function syncInks(root = document) {
  for (const [group, option] of INKS) {
    root.querySelectorAll(group).forEach(strip => {
      let ink = strip.querySelector(':scope > .ink');
      if (!ink) { ink = document.createElement('span'); ink.className = 'ink'; ink.setAttribute('aria-hidden', 'true'); strip.append(ink); }
      const on = strip.querySelector(`:scope > ${option}[aria-pressed="true"]`);
      if (!on || !on.offsetWidth) { ink.style.opacity = '0'; return; }
      ink.style.opacity = '';
      ink.style.width = `${on.offsetWidth}px`;
      ink.style.transform = `translateX(${on.offsetLeft}px)`;
      // First placement doesn't animate (flush it, then turn sliding on); later ones slide.
      if (!strip.classList.contains('ink-ready')) { void ink.offsetWidth; strip.classList.add('ink-ready'); }
    });
  }
}

/** Phone tab bar: a pill behind the current tab's icon that slides between tabs. */
export function syncTabbarInk() {
  const bar = document.querySelector('.tabbar');
  if (!bar) return;
  let ink = bar.querySelector(':scope > .tabink');
  if (!ink) { ink = document.createElement('span'); ink.className = 'tabink'; ink.setAttribute('aria-hidden', 'true'); bar.prepend(ink); }
  const glyph = bar.querySelector('.ptab[aria-current="page"] .glyph');
  if (!glyph || !glyph.offsetWidth) { ink.style.opacity = '0'; return; }
  const b = bar.getBoundingClientRect(), g = glyph.getBoundingClientRect();
  ink.style.opacity = '1';
  ink.style.transform = `translate(${g.left - b.left + g.width / 2 - 32}px, ${g.top - b.top + g.height / 2 - 16}px)`;
  if (!bar.classList.contains('ink-ready')) { void ink.offsetWidth; bar.classList.add('ink-ready'); }
}
