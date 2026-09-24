import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveLibrary, groupBooks, sortBooks, passes, routeFor, coverColor, coverMark } from '../../app/static/js/books.js';
import { searchLibrary } from '../../app/static/js/search.js';
import { job, edition } from './fixtures.mjs';

const series = (name, position) => ({ series: { name, position } });

function library() {
  return deriveLibrary([
    job({ id: 'a', path: '/l/a', report: edition('The Gate of the Feral Gods', series('Dungeon Crawler Carl', '4')), updated_at: 10 }),
    job({ id: 'b', path: '/l/b', report: edition('Dungeon Crawler Carl', series('Dungeon Crawler Carl', '1')), updated_at: 30 }),
    job({ id: 'c', path: '/l/c', status: 'awaiting_review', gateStates: ['passed', 'review'], report: { identity: { title: 'Emma', author: 'Jane Austen' } }, updated_at: 20 }),
    job({ id: 'd', path: '/l/d', status: 'failed', gateStates: ['blocked'], report: { identity: { title: 'Dracula', author: 'Bram Stoker' } }, updated_at: 5 }),
  ]);
}

test('library keeps only the latest job per path', () => {
  const books = deriveLibrary([
    job({ id: 'old', path: '/l/x', created_at: 1, status: 'failed' }),
    job({ id: 'new', path: '/l/x', created_at: 2 }),
    job({ id: 'other', path: '/l/y', created_at: 1 }),
  ]);
  assert.deepEqual(books.map(b => b.id).sort(), ['new', 'other']);
});

test('title falls back to the folder name without an audio extension', () => {
  const [book] = deriveLibrary([job({ path: '/library/Some Author/Book Title.m4b', report: {} })]);
  assert.equal(book.title, 'Book Title');
});

test('series grouping orders by series number and puts standalone last', () => {
  const groups = groupBooks(sortBooks(library(), 'series'), 'series');
  assert.deepEqual(groups.map(g => g.title), ['Dungeon Crawler Carl', 'Standalone']);
  assert.deepEqual(groups[0].items.map(b => b.title), ['Dungeon Crawler Carl', 'The Gate of the Feral Gods']);
  assert.equal(groups[0].sub, 'Matt Dinniman');
  assert.equal(groups[1].sub, '2 need attention');
});

test('status grouping follows the attention-first order', () => {
  const groups = groupBooks(library(), 'status');
  assert.deepEqual(groups.map(g => g.title), ['Needs review', 'Failed', 'Verified']);
});

test('title sort ignores leading articles; recent sort is newest first', () => {
  assert.deepEqual(sortBooks(library(), 'title').map(b => b.title), ['Dracula', 'Dungeon Crawler Carl', 'Emma', 'The Gate of the Feral Gods']);
  assert.deepEqual(sortBooks(library(), 'recent').map(b => b.id), ['b', 'c', 'a', 'd']);
});

test('filters: needs attention = review + failed', () => {
  const books = library();
  assert.equal(books.filter(b => passes(b, 'attention')).length, 2);
  assert.equal(books.filter(b => passes(b, 'verified')).length, 2);
});

test('books open the screen for their status', () => {
  const byId = Object.fromEntries(library().map(b => [b.id, b]));
  assert.equal(routeFor(byId.a), '#/books/a');
  assert.equal(routeFor(byId.c), '#/review/c');
  assert.equal(routeFor(byId.d), '#/queue?job=d');
});

test('generated covers are stable per book', () => {
  assert.equal(coverColor('/l/a'), coverColor('/l/a'));
  assert.match(coverColor('/l/a'), /^#[0-9A-F]{6}$/);
  const [gate] = library().filter(b => b.id === 'a');
  assert.equal(coverMark(gate), '4');
});

test('search matches title with highlight, then ASIN, author and series', () => {
  const books = library();
  const title = searchLibrary(books, 'carl');
  assert.equal(title.results[0].book.title, 'Dungeon Crawler Carl');
  assert.deepEqual([title.results[0].pre, title.results[0].mid], ['Dungeon Crawler ', 'Carl']);
  assert.ok(title.results.some(r => r.type === 'series' && r.name === 'Dungeon Crawler Carl' && r.count === 2));
  assert.equal(searchLibrary(books, 'b0cdx').results[0].why, 'ASIN B0CDXWSS5D');
  assert.equal(searchLibrary(books, 'austen').results[0].book.title, 'Emma');
  assert.equal(searchLibrary(books, 'zzz').results.length, 0);
});

test('empty search shows up to three recent books, preferring recently opened', () => {
  const result = searchLibrary(library(), '', { recent: ['d'] });
  assert.equal(result.head, 'Recent');
  assert.deepEqual(result.results.map(r => r.book.id), ['d', 'b', 'c']);
});

test('search caps at seven results', () => {
  const many = deriveLibrary(Array.from({ length: 12 }, (_, i) => job({ path: `/l/${i}`, report: edition(`Carl ${i}`) })));
  const result = searchLibrary(many, 'carl');
  assert.equal(result.results.length, 7);
  assert.equal(result.head, '12 results');
});
