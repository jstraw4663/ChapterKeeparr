// Library search over the cached book list (GAPS G-009). Matches title, ASIN,
// author, narrator and series, in that priority. Pure; no DOM access.

export const MAX_RESULTS = 7;

function highlight(text, query) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  return at < 0 ? { pre: text, mid: '', post: '' }
    : { pre: text.slice(0, at), mid: text.slice(at, at + query.length), post: text.slice(at + query.length) };
}

/**
 * → { head, results: [{ type: 'book'|'series', book?, name?, count?, pre, mid, post, why }] }
 * Empty query returns up to 3 recent books (ids in `recent` first, then most recently updated).
 */
export function searchLibrary(books, query, { recent = [], limit = MAX_RESULTS } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    const byId = new Map(books.map(b => [b.id, b]));
    const picked = [...recent.map(id => byId.get(id)).filter(Boolean)];
    for (const b of books.slice().sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (picked.length >= 3) break;
      if (!picked.includes(b)) picked.push(b);
    }
    const results = picked.slice(0, 3).map(book => ({ type: 'book', book, ...highlight(book.title, ''), why: '' }));
    return { head: results.length ? 'Recent' : '', results };
  }
  const hits = [];
  for (const book of books) {
    const title = book.title.toLowerCase();
    if (title.includes(q)) hits.push({ rank: title.startsWith(q) ? 0 : 1, book, why: '' });
    else if (book.asin && book.asin.toLowerCase().includes(q)) hits.push({ rank: 2, book, why: `ASIN ${book.asin}` });
    else if (book.author && book.author.toLowerCase().includes(q)) hits.push({ rank: 3, book, why: '' });
    else if (book.narrators && book.narrators.toLowerCase().includes(q)) hits.push({ rank: 4, book, why: `Narrated by ${book.narrators}` });
  }
  hits.sort((a, b) => a.rank - b.rank || b.book.updatedAt - a.book.updatedAt);
  const results = hits.map(h => ({ type: 'book', book: h.book, why: h.why, ...highlight(h.book.title, h.rank <= 1 ? q : '') }));
  const series = new Map();
  for (const book of books) {
    if (book.series && book.series.toLowerCase().includes(q)) series.set(book.series, (series.get(book.series) || 0) + 1);
  }
  for (const [name, count] of series) results.push({ type: 'series', name, count, ...highlight(name, q), why: '' });
  const total = results.length;
  return { head: total ? `${total} ${total === 1 ? 'result' : 'results'}` : '', results: results.slice(0, limit) };
}
