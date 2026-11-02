import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, sortedBooks, isPaired, bytes, openFindings } from '../../app/static/js/library-health.js';

const book = (title, files, findings = []) => ({ title, path: `/library/${title}`, files, findings });
const paired = book('Carl', [{ format: 'epub', size_bytes: 10 }, { format: 'm4b', size_bytes: 200 }]);
const multiple = book('World War Z', [{ format: 'epub', size_bytes: 20 }, { format: 'epub', size_bytes: 30 }], [{ code: 'multiple_format_candidates' }, { code: 'missing_m4b', review_note: 'Intentional' }]);
test('pair presence does not make multiple formats a valid pair', () => {
  assert.equal(isPaired(paired), true);
  assert.equal(isPaired(multiple), false);
  assert.equal(matches(multiple, 'duplicates'), true);
  assert.equal(matches(paired, 'attention'), false);
  assert.equal(openFindings(multiple).length, 1);
  assert.equal(matches(multiple, 'reviewed'), true);
});
test('filters and searches combine; size and findings sorts are stable', () => {
  assert.equal(matches(multiple, 'duplicates', 'world'), true);
  assert.equal(matches(multiple, 'duplicates', 'carl'), false);
  assert.deepEqual(sortedBooks([multiple, paired], 'size').map(b => b.title), ['Carl', 'World War Z']);
  assert.equal(sortedBooks([paired, multiple], 'findings')[0], multiple);
});
test('unknown storage remains unknown and logical units are explicit', () => {
  assert.equal(bytes(null), '—');
  assert.equal(bytes(1024), '1 KiB');
});

test('a delayed review cannot replace a newly selected scan', async () => {
  const { default: screen } = await import('../../app/static/js/screens/inventory.js');
  const { api } = await import('../../app/static/js/api.js');
  const original = api.reviewLibraryFinding;
  let finish;
  api.reviewLibraryFinding = () => new Promise(resolve => { finish = resolve; });
  const originalBook = { path: '/library/old', fingerprint: 'evidence', findings: [{ key: 'finding', code: 'missing_epub' }] };
  const ui = { scanId: 'old', selected: originalBook.path, report: { books: [originalBook] } };
  const ctx = { ui, rerender() {}, isCurrent: () => true };
  try {
    const pending = screen.actions['health-review']({ dataset: { arg: 'finding' } }, null, ctx);
    ui.scanId = 'new'; ui.generation++; ui.report = { id: 'new', books: [] };
    finish({ id: 'old', books: [originalBook] });
    await pending;
    assert.equal(ui.report.id, 'new');
    assert.equal(ui.mutating, false);
  } finally { api.reviewLibraryFinding = original; }
});
