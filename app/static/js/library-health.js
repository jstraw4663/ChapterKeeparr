// Inventory presentation is separate from chapter-verification status.
export const FINDINGS = {
  missing_epub: ['Missing EPUB', 'Add an EPUB edition, or keep this book as an exception.'],
  missing_m4b: ['Missing M4B', 'Add an audiobook, or review existing audio for conversion.'],
  multiple_format_candidates: ['Multiple copies to compare', 'Compare these files before choosing a keeper. Different editions may be intentional.'],
  pair_filename_mismatch: ['EPUB and M4B names differ', 'Review a consistent filename for the pair after confirming the edition.'],
  audio_conversion_candidate: ['Audio ready for conversion review', 'Check track order and completeness before preparing an M4B.'],
  ebook_conversion_candidate: ['Ebook conversion candidate', 'Prefer a native EPUB when available. PDF conversion needs individual review; protected files may require replacement.'],
  empty_media_file: ['Empty book file', 'Replace this empty file from a known good source.'],
  sidecars_present: ['Extra files to classify', 'Artwork, NFO and metadata sidecars may be useful. Review before removing anything.'],
  file_inspection_problem: ['File inspection needs attention', 'Review the inspection result below; a failed check does not establish the cause.'],
  missing_audio_chapters: ['No embedded audio chapters', 'Use BookOrbit’s chapter tools to review and add chapters.'],
  missing_embedded_title: ['Embedded title missing', 'Review BookOrbit metadata before writing a title into the file.'],
  missing_embedded_author: ['Embedded author missing', 'Review BookOrbit metadata before writing an author into the file.'],
};
export const INTEGRITY = {
  not_checked: 'Not checked', structurally_valid: 'Structure checked', probe_readable: 'Container readable',
  invalid: 'Invalid structure', unreadable: 'Unreadable', changed: 'Changed during scan',
  inspection_failed: 'Inspection failed', unsupported: 'Manual inspection needed',
};
export const openFindings = book => book.findings.filter(f => !f.review_note);
export const isPaired = book => ['epub', 'm4b'].every(format => book.files.filter(f => f.format === format).length === 1);
export const bookBytes = book => book.files.reduce((sum, file) => sum + file.size_bytes, 0);
export const selectedBooks = (books, selection = []) => books.filter(b => selection.includes(b.path));
export const bookAuthor = book => [...new Set(book.files.map(f => f.author).filter(Boolean))].join(' · ') || 'Author unknown';
export function selectionState(books, selection = []) {
  const count = selectedBooks(books, selection).length;
  return { count, checked: books.length > 0 && count === books.length, mixed: count > 0 && count < books.length };
}
export function reviewItems(books, mode) {
  return books.flatMap(book => book.findings.filter(f => mode === 'keep' ? !f.review_note : Boolean(f.review_note))
    .map(f => ({ folder: book.path, finding: f.key, fingerprint: book.fingerprint, note: mode === 'keep' ? 'Intentional library exception' : null })));
}
export function bytes(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let number = value / 1024, unit = 0;
  while (number >= 1024 && unit < units.length - 1) { number /= 1024; unit++; }
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
export function matches(book, filter = 'all', search = '') {
  const codes = openFindings(book).map(f => f.code);
  const selected = filter === 'all' ||
    filter === 'attention' && codes.length > 0 ||
    filter === 'paired' && isPaired(book) ||
    filter === 'duplicates' && codes.includes('multiple_format_candidates') ||
    filter === 'conversion' && codes.some(c => c.endsWith('_conversion_candidate')) ||
    filter === 'inspection' && codes.some(c => ['file_inspection_problem', 'empty_media_file'].includes(c)) ||
    filter === 'chapters' && codes.includes('missing_audio_chapters') ||
    filter === 'reviewed' && book.findings.some(f => f.review_note);
  return selected && (!search.trim() || [book.path, book.title, ...book.files.flatMap(f => [f.title, f.author])].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
}
export function sortedBooks(books, sort = 'title') {
  return [...books].sort((a, b) => (sort === 'size' ? bookBytes(b) - bookBytes(a) : sort === 'findings' ? openFindings(b).length - openFindings(a).length : 0) || a.title.localeCompare(b.title, undefined, { numeric: true }));
}
