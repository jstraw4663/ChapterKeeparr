// Cover art loading. Provider artwork loads directly; otherwise the server's
// /cover endpoint (local cover file or embedded art) is fetched with auth,
// three at a time, when the cover scrolls into view. Missing art keeps the
// generated placeholder.

import { api } from './api.js';

const cache = new Map();   // jobId → object URL, or null when the server has no cover
const pending = new Set();
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
  root.querySelectorAll('img[data-cover-id]').forEach(img => {
    const id = img.dataset.coverId;
    if (cache.has(id)) { const url = cache.get(id); if (url) img.src = url; return; }
    if (observer) observer.observe(img); else { enqueue(id); pump(); }
  });
}

document.addEventListener('load', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('cover')) {
    img.classList.add('loaded');
    img.parentElement.classList.add('has-art');
  }
}, true);

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
