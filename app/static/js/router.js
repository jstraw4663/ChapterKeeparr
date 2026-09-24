// Hash routes. The server only serves "/" (GAPS G-028), so routes live in the hash.
// Old UI hashes (#overview, #jobs…, #job/<id>, #new-job, #settings) keep working.
// Pure; no DOM access.

const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };

/** → { name, id?, section?, query: URLSearchParams } or { redirect: '#/…' } or { legacyJob: id, match } */
export function parse(hash) {
  const rawHash = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = rawHash.split('?');
  const query = new URLSearchParams(queryPart);

  // Legacy (pre-redesign) routes.
  if (!pathPart.startsWith('/')) {
    if (pathPart === '' ) return { name: 'library', query };
    if (pathPart === 'overview') return { redirect: '#/' };
    if (pathPart === 'jobs') {
      const filter = query.get('filter');
      if (filter === 'review') return { redirect: '#/review' };
      if (filter === 'complete') return { redirect: '#/?filter=verified' };
      return { redirect: '#/queue' };
    }
    if (pathPart === 'new-job') return { redirect: '#/new' };
    if (pathPart === 'settings') return { redirect: '#/settings' };
    if (pathPart.startsWith('job/')) return { legacyJob: decode(pathPart.slice(4)), match: rawHash.endsWith('?match') || query.has('match') };
    return { redirect: '#/' };
  }

  const parts = pathPart.split('/').filter(Boolean).map(decode);
  const [head, arg] = parts;
  switch (head) {
    case undefined: return { name: 'library', query };
    case 'suggestions': return { name: 'suggestions', query };
    case 'queue': return { name: 'queue', query };
    case 'review': return arg ? { name: 'review', id: arg, query } : { name: 'review', query };
    case 'books': return arg ? { name: 'book', id: arg, query } : { redirect: '#/' };
    case 'new': return { name: 'newjob', query };
    case 'settings': return { name: 'settings', section: arg || null, query };
    default: return { redirect: '#/' };
  }
}

/** Where an old #job/<id> link should land once the job's status is known. */
export function legacyJobTarget(book, match = false) {
  if (!book) return '#/queue';
  const key = book.status.key;
  const id = encodeURIComponent(book.id);
  if (key === 'review') return `#/review/${id}${match ? '?match' : ''}`;
  if (key === 'verified' || key === 'optimized') return `#/books/${id}`;
  return `#/queue?job=${id}`;
}

export const NAV = [
  { name: 'library', label: 'Library', href: '#/', icon: 'library' },
  { name: 'suggestions', label: 'Suggestions', href: '#/suggestions', icon: 'suggestions', badge: 'suggestions' },
  { name: 'queue', label: 'Queue', href: '#/queue', icon: 'queue', badge: 'queue' },
  { name: 'review', label: 'Needs review', href: '#/review', icon: 'review', badge: 'review' },
  { name: 'newjob', label: 'New job', href: '#/new', icon: 'plus' },
  { name: 'settings', label: 'Settings', href: '#/settings', icon: 'settings' },
];

/** Which nav item is current for a route (Book belongs to Library). */
export const navFor = route => (route.name === 'book' ? 'library' : route.name);
