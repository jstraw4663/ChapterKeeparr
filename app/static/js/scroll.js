// Programmatic scrolling (CHAPTER_REVIEW.md §4): one eased glide that lands an
// element just below the fixed header and above any bottom bar. Used instead of
// scrollIntoView({behavior:'smooth'}), which is inconsistent on iOS and lands
// things under the bottom bar. Any touch, wheel or pointer press cancels it.

let active = null;

const reduced = () => document.documentElement.dataset.motion === 'reduce';
export const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const glideDuration = distance => Math.min(520, 260 + Math.abs(distance) * 0.2);

/** The nearest scrolling ancestor, or the page. */
function scroller(el) {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const y = getComputedStyle(node).overflowY;
    if ((y === 'auto' || y === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement || document.documentElement;
}

/** Visible zone in viewport coordinates: below the header, above the bottom bar (minus 12px). */
function zone(root, { top, bar }) {
  const page = root === document.scrollingElement || root === document.documentElement;
  const box = page ? { top: 0, bottom: window.innerHeight } : root.getBoundingClientRect();
  const barEl = bar && document.querySelector(bar);
  const barTop = barEl && barEl.offsetParent !== null ? barEl.getBoundingClientRect().top : Infinity;
  return { top: box.top + top, bottom: Math.min(box.bottom, barTop) - 12 };
}

export function cancelGlide() { active = null; }

/**
 * Glide so `el`'s top sits at the top of the visible zone.
 * force: false skips it when the top and first 220px are already visible (auto-advance).
 * top: fixed header height (76 phone, 96 desktop). bar: selector of a bottom bar to stay above.
 * Resolves when the glide ends or is cancelled.
 */
export function glideTo(el, { force = true, top = 96, bar = '' } = {}) {
  if (!el?.getBoundingClientRect) return Promise.resolve();
  const root = scroller(el);
  const area = zone(root, { top, bar });
  const r = el.getBoundingClientRect();
  if (!force && r.top >= area.top && r.top + Math.min(r.height, 220) <= area.bottom) return Promise.resolve();
  return glideBy(root, r.top - area.top);
}

/** Glide the page (or `root`) to an absolute scroll position. */
export function glideToTop(root = document.scrollingElement || document.documentElement) {
  return glideBy(root, -root.scrollTop);
}

function glideBy(root, delta) {
  const from = root.scrollTop;
  const max = root.scrollHeight - root.clientHeight;
  const to = Math.max(0, Math.min(max, from + delta));
  const distance = to - from;
  if (Math.abs(distance) < 2) return Promise.resolve();
  // Reduced motion jumps; so does a hidden page, where animation frames don't run.
  if (reduced() || document.hidden) { active = null; root.scrollTop = to; return Promise.resolve(); }
  const token = {};
  active = token;
  const target = root === document.documentElement || root === document.scrollingElement ? window : root;
  const stop = () => { if (active === token) active = null; };
  for (const type of ['touchstart', 'wheel', 'pointerdown']) target.addEventListener(type, stop, { once: true, passive: true });
  const duration = glideDuration(distance);
  const start = performance.now();
  return new Promise(resolve => {
    const step = now => {
      if (active !== token) return resolve();
      const k = Math.min(1, (now - start) / duration);
      root.scrollTop = from + distance * easeInOutCubic(k);
      if (k < 1) requestAnimationFrame(step); else { stop(); resolve(); }
    };
    requestAnimationFrame(step);
  });
}
