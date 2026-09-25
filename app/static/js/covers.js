// Cover art loading. Provider artwork loads directly; otherwise the server's
// /cover endpoint (local cover file or embedded art) is fetched with auth,
// three at a time, when the cover scrolls into view. Missing art keeps the
// generated placeholder.

import { api } from './api.js';

const cache = new Map();   // jobId → object URL, or null when the server has no cover
const pending = new Set();
const shown = new Set();   // image URLs that have loaded once; later renders show them without the fade
const waiting = [];
let active = 0;
const LIMIT = 150;

const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    enqueue(entry.target.dataset.coverId);
  }
  pump();
}, { rootMargin: '200px' }) : null;

function enqueue(id) {
  if (!id || cache.has(id) || pending.has(id)) return;
  pending.add(id);
  waiting.push(id);
}

function paint(id) {
  const url = cache.get(id);
  document.querySelectorAll(`img[data-cover-id="${CSS.escape(id)}"]`).forEach(img => {
    if (url) img.src = url;
  });
}

function pump() {
  while (active < 3 && waiting.length) {
    const id = waiting.shift();
    active++;
    api.coverBlob(id)
      .then(blob => URL.createObjectURL(blob))
      .catch(() => null)
      .then(url => {
        cache.set(id, url);
        if (cache.size > LIMIT) {
          const [oldest, oldUrl] = cache.entries().next().value;
          if (oldUrl) URL.revokeObjectURL(oldUrl);
          cache.delete(oldest);
        }
        paint(id);
      })
      .finally(() => { pending.delete(id); active--; pump(); });
  }
}

/** Call after rendering: hooks up every cover image under `root`. */
export function hydrateCovers(root = document) {
  // Provider artwork already seen: show it at once instead of fading in again on every new screen.
  root.querySelectorAll('.cover>img[src]:not(.loaded)').forEach(img => {
    if (shown.has(img.src)) { img.classList.add('loaded'); img.parentElement.classList.add('has-art'); }
  });
  root.querySelectorAll('img[data-cover-id]').forEach(img => {
    const id = img.dataset.coverId;
    if (cache.has(id)) {
      const url = cache.get(id);
      // Already fetched: show it at once, without the fade, so re-renders don't blink.
      if (url && img.src !== url) { img.src = url; img.classList.add('loaded'); img.parentElement?.classList.add('has-art'); }
      return;
    }
    if (observer) observer.observe(img); else { enqueue(id); pump(); }
  });
}

document.addEventListener('load', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('cover')) {
    img.classList.add('loaded');
    img.parentElement.classList.add('has-art');
    shown.add(img.src);
  }
}, true);

/**
 * Wait (briefly) until the cover images on screen are decoded, so a view
 * transition captures the new screen with its artwork instead of blank tiles.
 */
export function settleCovers(root, limit = 250) {
  const visible = [...root.querySelectorAll('.cover>img[src]')].filter(img => {
    const r = img.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width;
  });
  if (!visible.length) return Promise.resolve();
  const decoded = Promise.all(visible.map(img => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
  return Promise.race([decoded, new Promise(resolve => setTimeout(resolve, limit))]);
}

document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.parentElement?.classList.contains('cover')) return;
  img.classList.remove('loaded');
  img.parentElement.classList.remove('has-art');
  // Provider artwork failed: fall back to the server's local artwork.
  const fallback = img.dataset.coverFallback;
  if (fallback) {
    delete img.dataset.coverFallback;
    img.removeAttribute('src');
    img.dataset.coverId = fallback;
    hydrateCovers(img.parentElement);
  }
}, true);
