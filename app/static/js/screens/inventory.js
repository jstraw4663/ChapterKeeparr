// Library health uses the existing panels, fields, tabs, pills and disclosures.
import { html, bool, raw, relative, minutes } from '../format.js';
import { button, field, selectField, tabs, statusPill, collapsible, emptyState, cover, selectionBubble } from '../ui.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { FINDINGS, INTEGRITY, bytes, openFindings, isPaired, matches, sortedBooks, bookBytes, selectedBooks, selectionState, reviewItems, bookAuthor } from '../library-health.js';

const FILTERS = [['all', 'All'], ['attention', 'Needs attention'], ['paired', 'Pair present'], ['duplicates', 'Multiple copies'], ['conversion', 'Conversions'], ['inspection', 'File problems'], ['chapters', 'Chapters'], ['reviewed', 'Kept as is']];
const active = task => task && ['queued', 'running'].includes(task.status);
const scanLabel = task => task.status === 'completed' ? task.complete ? 'Scan finished' : 'Scan finished with exclusions' : task.status === 'running' ? 'Inspecting library' : task.status === 'queued' ? 'Queued' : task.status === 'cancelled' ? 'Cancelled' : 'Failed';
const formatPills = book => [...new Set(book.files.filter(f => f.kind !== 'sidecar').map(f => f.format))].sort().map(format => {
  const count = book.files.filter(f => f.format === format).length;
  return count ? html`<span class="pill sm ${count > 1 && ['epub', 'm4b'].includes(format) ? 'tone-warn' : ''}">${format.toUpperCase()}${count > 1 ? ` × ${count}` : ''}</span>` : '';
});

async function load(ctx) {
  const ui = ctx.ui;
  if (ui.pending) return;
  ui.pending = true;
  const generation = ui.generation || 0;
  try {
    const { scans } = await api.libraryScans();
    const selected = ui.scanId || scans[0]?.id;
    const report = selected ? await api.libraryScan(selected) : null;
    if (!ctx.isCurrent() || generation !== (ui.generation || 0)) return;
    ui.scans = scans; ui.scanId = selected; ui.report = report; ui.initialized = true; ui.error = '';
  } catch (error) {
    if (ctx.isCurrent() && generation === (ui.generation || 0)) { ui.error = error.message; ui.initialized = true; }
  } finally {
    ui.pending = false;
    if (ctx.isCurrent()) {
      ctx.rerender();
      if (generation !== (ui.generation || 0)) load(ctx);
    }
  }
}

function findingRows(book, ui) {
  if (!book.findings.length) return html`<p class="meta">No organization issues found by this scan. Audio completeness and chapter accuracy have not been verified.</p>`;
  return html`<div class="health-findings">${book.findings.map(finding => {
    const [label, advice] = FINDINGS[finding.code] || [finding.code, 'Review this finding.'];
    return html`<div class="health-finding" data-key="${finding.key}"><div class="col gap8 grow"><strong>${label}${finding.format ? ` · ${finding.format.toUpperCase()}` : ''}</strong>
      <span class="meta">${finding.review_note ? 'Kept as is · this exception applies while the scanned files are unchanged.' : advice}</span>
      ${finding.file ? html`<span class="mono meta health-path">${finding.file.split('/').at(-1)}</span>` : ''}
      ${finding.detail ? html`<span class="meta">${finding.detail}</span>` : ''}</div>
      ${button({ label: finding.review_note ? 'Reopen' : 'Keep as is', act: 'health-review', arg: finding.key, extra: { 'data-folder': book.path }, disabled: Boolean(ui.mutating) })}</div>`;
  })}</div>`;
}

function fileRows(book) {
  return html`<div class="health-files">${book.files.map(file => html`<article class="health-file"><div class="row health-wrap"><span class="pill sm">${file.format.toUpperCase() || 'FILE'}</span><strong class="health-path grow">${file.path.split('/').at(-1)}</strong><span class="meta">${bytes(file.size_bytes)}</span></div>
    <div class="row health-wrap meta"><span>${INTEGRITY[file.integrity] || 'Not checked'}</span>${file.link_count > 1 ? html`<span>Hardlinked · ${file.link_count} links</span>` : ''}${file.codec ? html`<span>${file.codec.toUpperCase()} · ${minutes(file.duration_seconds)}</span>` : ''}${file.chapter_count != null ? html`<span>${file.chapter_count} embedded chapters</span>` : ''}</div>
    ${file.title || file.author ? html`<p class="meta health-path">${file.title || 'No embedded title'}${file.author ? ` · ${file.author}` : ''}</p>` : ''}
    ${file.inspection_detail ? html`<p class="meta">${file.inspection_detail}</p>` : ''}</article>`)}</div>`;
}

function bookDetail(book, ctx) {
  const { ui } = ctx;
  return html`<section class="col gap14 health-detail" aria-label="Details for ${book.title}">
    <p class="meta mono health-path">${book.path}</p>
    <p class="meta">${isPaired(book) ? 'One EPUB and one M4B are present. Their editions have not been matched.' : 'Review the formats below to work toward one EPUB and one M4B.'}</p>
    <div class="health-row-panels">
      ${collapsible({ id: `health-findings-${book.id}`, title: 'Suggestions', count: openFindings(book).length, open: ui.open?.[`health-findings-${book.id}`] !== false, body: findingRows(book, ui), level: 'h3' })}
      ${collapsible({ id: `health-files-${book.id}`, title: 'Files and inspection', count: book.files.length, open: ui.open?.[`health-files-${book.id}`] !== false, body: fileRows(book), level: 'h3' })}
    </div>
    <p class="meta">Keep as is records an exception only. Conversion, renaming, metadata writes and cleanup are not available in this build.</p>
  </section>`;
}

function rowSummary(book, ctx) {
  const { ui } = ctx;
  const needs = openFindings(book);
  const expanded = Boolean(ui.expanded?.[book.path]);
  const selected = (ui.selection || []).includes(book.path);
  const audio = book.files.filter(f => f.format === 'm4b');
  const primaryAudio = audio.length === 1 ? audio[0] : null;
  const hardlinks = book.files.filter(f => f.link_count > 1).length;
  const inspected = book.files.filter(f => ['structurally_valid', 'probe_readable'].includes(f.integrity)).length;
  const preview = [...new Set(needs.map(f => FINDINGS[f.code]?.[0] || f.code))];
  const kept = book.findings.length - needs.length;
  const detailId = `health-detail-${book.id}`;
  return html`<tr class="health-book-row ${selected ? 'is-selected' : ''}" data-key="${book.path}" data-folder="${book.path}">
    <td class="health-art-cell">${cover({ id: `inventory:${ui.scanId}:${book.id}`, title: book.title, author: bookAuthor(book), path: book.path }, { size: 52, radius: 8 })}</td>
    <td class="health-select-cell">${selectionBubble({ label: `Select ${book.title}`, checked: selected, act: 'health-pick', arg: book.path, disabled: Boolean(ui.mutating) })}</td>
    <th scope="row" class="health-book-cell"><strong class="health-path">${book.title}</strong><span class="meta health-path">${bookAuthor(book)}</span><span class="meta mono health-path health-folder-path" title="${book.relative_path}">${book.relative_path}</span></th>
    <td class="health-format-cell"><div class="row health-wrap">${formatPills(book)}</div><span class="meta">${book.files.length} ${book.files.length === 1 ? 'file' : 'files'} · ${bytes(bookBytes(book))}</span>${primaryAudio ? html`<span class="meta">${minutes(primaryAudio.duration_seconds)} · ${primaryAudio.chapter_count == null ? 'Chapters not checked' : `${primaryAudio.chapter_count} ${primaryAudio.chapter_count === 1 ? 'chapter' : 'chapters'}`}</span>` : ''}<span class="meta">${hardlinks ? `${hardlinks} hardlinked ${hardlinks === 1 ? 'file' : 'files'}` : 'No hardlinked files'}</span></td>
    <td class="health-findings-cell">${needs.length ? statusPill({ key: 'review', tone: 'warn', label: 'Needs review' }, { size: 'sm' }) : html`<span class="meta">No open findings</span>`}<span class="meta health-path">${preview.slice(0, 2).join(' · ')}${preview.length > 2 ? ` · +${preview.length - 2} more` : ''}</span><span class="meta">${needs.length ? `${needs.length} open · ` : ''}${kept ? `${kept} kept as is · ` : ''}${inspected} of ${book.files.filter(f => f.kind !== 'sidecar').length} basic file checks passed</span></td>
    <td class="health-action-cell">${button({ label: expanded ? 'Close' : needs.length ? 'Review' : 'Details', iconEnd: expanded ? 'chevronUp' : 'chevronDown', act: 'health-expand', arg: book.path, extra: { 'aria-label': `${expanded ? 'Collapse' : 'Review'} ${book.title}`, 'aria-expanded': bool(expanded), 'aria-controls': detailId } })}</td>
  </tr><tr class="health-expanded-row" ${expanded ? '' : raw('hidden')}><td colspan="6"><div id="${detailId}">${expanded ? bookDetail(book, ctx) : ''}</div></td></tr>`;
}

function selectionBar(books, visible, ui) {
  const chosen = selectedBooks(books, ui.selection);
  const visibleCount = selectedBooks(visible, ui.selection).length;
  const keep = reviewItems(chosen, 'keep').length;
  const reopen = reviewItems(chosen, 'reopen').length;
  const disabled = Boolean(ui.mutating);
  return html`<div class="health-selection-bar" aria-label="Selection actions"><span class="meta" role="status">${chosen.length ? `${chosen.length} selected${chosen.length > visibleCount ? ` · ${chosen.length - visibleCount} outside this filter` : ''}` : 'Select books for actions'}</span><div class="row health-wrap">
    ${chosen.length ? html`${button({ label: 'Expand selected', act: 'health-expand-selected', disabled })}${button({ label: 'Collapse selected', act: 'health-collapse-selected', disabled })}${button({ label: `Keep as is${keep ? ` (${keep})` : ''}`, act: 'health-bulk-keep', disabled: disabled || !keep })}${button({ label: `Reopen${reopen ? ` (${reopen})` : ''}`, act: 'health-bulk-reopen', disabled: disabled || !reopen })}${button({ label: 'Clear selection', act: 'health-clear-selection', disabled })}` : html`<span class="meta">The selection bubble in the heading selects all matching books.</span>`}
  </div></div>${ui.bulkConfirm ? html`<div class="panel pad health-bulk-confirm" role="region" aria-label="Confirm exceptions"><p>Keep ${keep} open findings across ${chosen.length} selected books as intentional exceptions? This records your review; it does not repair or change any file.</p><div class="row health-wrap">${button({ label: 'Confirm exceptions', kind: 'primary', act: 'health-bulk-confirm', disabled: disabled || !keep })}${button({ label: 'Cancel', act: 'health-bulk-dismiss', disabled })}</div></div>` : ''}`;
}

async function bulkReview(ctx, mode) {
  const ui = ctx.ui;
  if (ui.mutating) return;
  const items = reviewItems(selectedBooks(ui.report.books, ui.selection), mode);
  if (!items.length) return;
  const scanId = ui.scanId;
  const generation = ui.generation = (ui.generation || 0) + 1;
  ui.mutating = true; ui.bulkConfirm = false; ctx.rerender();
  try {
    const report = await api.reviewLibraryFindings(scanId, items);
    if (ui.scanId === scanId && ui.generation === generation) { ui.generation++; ui.report = report; }
  } catch (error) { if (ui.scanId === scanId) ui.error = error.message; }
  finally { ui.mutating = false; if (ctx.isCurrent()) ctx.rerender(); }
}

export default {
  title: 'Library', nav: 'library', topbar: false, search: false,
  signature(ctx) { return JSON.stringify([ctx.ui, state.settings?.library_roots]); },
  render(ctx) {
    const { ui, phone } = ctx;
    const report = ui.report;
    const books = report?.books || [];
    const filter = ui.filter || 'all';
    const visible = sortedBooks(books.filter(b => matches(b, filter, ui.search || '')), ui.sort || 'title');
    const running = (ui.scans || []).find(active);
    const roots = state.settings?.library_roots || [];
    if (ui.path === undefined && roots.length) ui.path = roots[0];
    const summary = report?.summary;
    const error = ui.error ? html`<div class="panel pad health-error" role="alert"><strong>Couldn’t update the library</strong><p>${ui.error}</p>${button({ label: 'Retry', act: 'health-refresh' })}</div>` : '';
    const controlsBody = html`<div class="col gap14">
      <div class="health-scan-form">${field({ id: 'health-root', label: 'Library folder', value: ui.path || '', placeholder: '/library', hint: 'Server path inside this container. Scans never change library or seeding files.', extra: { 'data-input': 'health-root' } })}
        </div>
      ${running ? html`<p class="statusline" role="status"><span class="dot dot-ink pulse" aria-hidden="true"></span>${scanLabel(running)} · ${running.processed_files.toLocaleString()} files inspected${running.cancel_requested ? ' · stopping at a safe checkpoint' : ''}</p>` : ''}
      ${(ui.scans || []).length ? selectField({ id: 'health-history', label: 'Scan history', value: ui.scanId, options: ui.scans.map(s => [s.id, `${relative(s.created_at)} · ${scanLabel(s)} · ${s.root}`]), extra: { 'data-input': 'health-history' } }) : ''}
    </div>`;
    const controls = collapsible({ id: 'health-scan-controls', title: 'Scan options and history', summary: ui.path || report?.root || '', open: Boolean(running) || (ui.open?.['health-scan-controls'] ?? !summary), body: controlsBody });
    let content;
    if (!ui.initialized) content = emptyState({ title: 'Loading library scans…' });
    else if (!report) content = emptyState({ title: 'Inspect your library', body: 'Scan a server folder to find EPUB and audiobook pairs, extra copies, naming differences and file problems.' });
    else if (active(report)) content = emptyState({ title: scanLabel(report), body: `${report.processed_files.toLocaleString()} files inspected. Results appear when this scan finishes. You can leave this screen and return later.` });
    else if (report.status === 'failed' || report.status === 'cancelled') content = emptyState({ title: scanLabel(report), body: report.error || 'No library files were changed. Start a new scan when ready.' });
    else {
      const stats = html`<section class="panel pad col gap14" aria-label="Scan summary"><div class="row health-wrap"><h2 class="h2">Scan results</h2><span class="meta">${relative(report.created_at)}</span></div>
        <dl class="health-summary"><div><dt>Book folders</dt><dd>${summary.book_folder_candidates}</dd></div><div><dt>EPUB + M4B pairs</dt><dd>${books.filter(isPaired).length}</dd></div><div><dt>Need attention</dt><dd>${books.filter(b => openFindings(b).length).length}</dd></div><div><dt>Files</dt><dd>${summary.file_count}</dd></div><div><dt>Logical size</dt><dd>${bytes(summary.logical_bytes)}</dd></div><div><dt>Hardlinked files</dt><dd>${summary.hardlinked_files}</dd></div></dl>
        <p class="meta">Folders are book candidates. File checks do not verify complete books or chapter accuracy. Size includes hardlinks; physical space recoverable is unknown.</p>
      </section>`;
      const issues = (report.issues || []).length ? collapsible({ id: 'health-exclusions', title: 'Scan exclusions', count: report.issues.length, open: Boolean(ui.open?.['health-exclusions']), body: html`<ul class="health-issues">${report.issues.map(i => html`<li><strong>${i.code.replaceAll('_', ' ')}</strong><span class="mono meta health-path">${i.path}</span></li>`)}</ul>` }) : '';
      const pickState = selectionState(visible, ui.selection);
      const list = visible.length ? html`<div class="panel health-table-panel"><table class="health-table"><caption class="sr">Library book folders and file health</caption><thead><tr><th scope="col" class="health-art-cell">Cover</th><th scope="col" class="health-select-cell">${selectionBubble({ label: `Select all ${visible.length} matching books`, ...pickState, act: 'health-pick-all', disabled: Boolean(ui.mutating) })}</th><th scope="col" class="health-book-cell">Book</th><th scope="col" class="health-format-cell">Files and audio</th><th scope="col" class="health-findings-cell">Findings</th><th scope="col" class="health-action-cell">Action</th></tr></thead><tbody>${visible.slice(0, ui.limit || 60).map(b => rowSummary(b, ctx))}</tbody></table></div>${visible.length > (ui.limit || 60) ? button({ label: 'Show more books', act: 'health-more' }) : ''}` : emptyState({ title: books.length ? 'No folders match this filter' : 'No book folders found', body: books.length ? 'Try another filter or search.' : 'Check the folder path and scan exclusions. Unrecognized files are listed under Other files.' });
      const extras = (report.files || []).filter(f => !books.some(b => b.path === f.path.slice(0, f.path.lastIndexOf('/'))));
      const otherFiles = extras.length ? collapsible({ id: 'health-other', title: 'Other files', count: extras.length, open: Boolean(ui.open?.['health-other']), body: html`<ul class="health-issues">${extras.map(f => html`<li><span class="mono meta health-path">${f.relative_path}</span><span class="meta">${bytes(f.size_bytes)}</span></li>`)}</ul>` }) : '';
      content = html`${stats}${issues}<div class="col gap14"><div class="health-filter-fields">${field({ id: 'health-search', label: 'Search folders and metadata', type: 'search', value: ui.search || '', extra: { 'data-input': 'health-search' } })}${selectField({ id: 'health-sort', label: 'Sort folders', options: [['title', 'Title'], ['findings', 'Most findings'], ['size', 'Largest first']], value: ui.sort || 'title', extra: { 'data-input': 'health-sort' } })}</div>
        ${tabs({ label: 'Filter library findings', options: FILTERS.map(([key, label]) => [key, label, books.filter(b => matches(b, key)).length]), value: filter, act: 'health-filter', scroll: true })}
        <p class="meta">${visible.length} of ${books.length} book folders · folder names and editions have not been matched to BookOrbit</p>
        ${selectionBar(books, visible, ui)}${list}</div>${otherFiles}`;
    }
    return html`<div class="col gap20 ${phone ? 'page-inset' : ''} health-page"><header class="health-heading"><div><h1 class="h1" tabindex="-1">Library</h1><p class="meta">File health and organization</p></div><div class="row health-wrap">${button({ label: 'Chapter repair jobs', href: '#/repairs' })}${button({ label: ui.starting ? 'Starting…' : 'Scan library', kind: 'primary', act: 'health-start', disabled: Boolean(running || ui.starting || ui.mutating || !ui.path) })}${running ? button({ label: running.cancel_requested ? 'Cancelling…' : 'Cancel scan', act: 'health-cancel', arg: running.id, disabled: Boolean(running.cancel_requested || ui.mutating) }) : ''}</div></header>${error}${controls}${content}</div>`;
  },
  mount(root, ctx) {
    if ((!ctx.ui.initialized || ctx.enter) && !ctx.ui.pending) { load(ctx); return; }
    const timer = setTimeout(() => load(ctx), (ctx.ui.scans || []).some(active) ? 1500 : 10000);
    return () => clearTimeout(timer);
  },
  actions: {
    'health-refresh': (el, ev, ctx) => load(ctx),
    'health-filter': (el, ev, ctx) => { ctx.ui.filter = el.dataset.arg; ctx.ui.bulkConfirm = false; ctx.ui.limit = 60; ctx.rerender(); },
    'health-expand': (el, ev, ctx) => { const path = el.dataset.arg; ctx.ui.expanded = { ...ctx.ui.expanded, [path]: !ctx.ui.expanded?.[path] }; ctx.rerender(); },
    'health-pick': (el, ev, ctx) => {
      const current = ctx.ui.selection || [], path = el.dataset.arg;
      ctx.ui.selection = current.includes(path) ? current.filter(p => p !== path) : [...current, path];
      ctx.ui.bulkConfirm = false; ctx.rerender();
    },
    'health-pick-all': (el, ev, ctx) => {
      const ui = ctx.ui, visible = ui.report.books.filter(b => matches(b, ui.filter || 'all', ui.search || ''));
      const paths = visible.map(b => b.path), current = ui.selection || [];
      ui.selection = selectionState(visible, current).checked ? current.filter(p => !paths.includes(p)) : [...new Set([...current, ...paths])];
      ui.bulkConfirm = false; ctx.rerender();
    },
    'health-clear-selection': (el, ev, ctx) => { ctx.ui.selection = []; ctx.ui.bulkConfirm = false; ctx.rerender(); },
    'health-expand-selected': (el, ev, ctx) => { ctx.ui.expanded = { ...ctx.ui.expanded, ...Object.fromEntries((ctx.ui.selection || []).map(p => [p, true])) }; ctx.rerender(); },
    'health-collapse-selected': (el, ev, ctx) => { ctx.ui.expanded = { ...ctx.ui.expanded, ...Object.fromEntries((ctx.ui.selection || []).map(p => [p, false])) }; ctx.rerender(); },
    'health-bulk-keep': (el, ev, ctx) => { ctx.ui.bulkConfirm = true; ctx.rerender(); },
    'health-bulk-dismiss': (el, ev, ctx) => { ctx.ui.bulkConfirm = false; ctx.rerender(); },
    'health-bulk-confirm': (el, ev, ctx) => bulkReview(ctx, 'keep'),
    'health-bulk-reopen': (el, ev, ctx) => bulkReview(ctx, 'reopen'),
    'health-more': (el, ev, ctx) => { ctx.ui.limit = (ctx.ui.limit || 60) + 60; ctx.rerender(); },
    async 'health-start'(el, ev, ctx) {
      const ui = ctx.ui;
      if (ui.starting) return;
      ui.starting = true; ui.error = ''; ctx.rerender();
      try {
        const task = await api.startLibraryScan(ui.path);
        ui.generation = (ui.generation || 0) + 1;
        ui.scanId = task.id; ui.report = task; ui.selection = []; ui.expanded = {}; ui.bulkConfirm = false;
        ui.scans = [task, ...(ui.scans || [])]; ui.initialized = true;
      } catch (error) { ui.error = error.message; }
      finally { ui.starting = false; if (ctx.isCurrent()) { ctx.rerender(); load(ctx); } }
    },
    async 'health-cancel'(el, ev, ctx) {
      ctx.ui.mutating = true; ctx.rerender();
      try { await api.cancelLibraryScan(el.dataset.arg); }
      catch (error) { ctx.ui.error = error.message; }
      finally { ctx.ui.mutating = false; if (ctx.isCurrent()) { ctx.rerender(); load(ctx); } }
    },
    async 'health-review'(el, ev, ctx) {
      const ui = ctx.ui, book = ui.report.books.find(b => b.path === (el.dataset.folder || ui.selected));
      const finding = book.findings.find(f => f.key === el.dataset.arg);
      const scanId = ui.scanId;
      const generation = ui.generation = (ui.generation || 0) + 1;
      ui.mutating = true; ctx.rerender();
      try {
        const report = await api.reviewLibraryFinding(scanId, { folder: book.path, finding: finding.key, fingerprint: book.fingerprint, note: finding.review_note ? null : 'Intentional library exception' });
        if (ui.scanId === scanId && ui.generation === generation) {
          ui.generation++;
          ui.report = report;
        }
      } catch (error) { ui.error = error.message; }
      finally { ui.mutating = false; if (ctx.isCurrent()) ctx.rerender(); }
    },
  },
  onInput(el, ev, ctx) {
    const key = el.dataset.input;
    if (key === 'health-root') { ctx.ui.path = el.value; ctx.rerender(); }
    if (key === 'health-search') { ctx.ui.search = el.value; ctx.ui.bulkConfirm = false; ctx.ui.limit = 60; ctx.rerender(); }
    if (key === 'health-sort') { ctx.ui.sort = el.value; ctx.rerender(); }
    if (key === 'health-history' && el.value !== ctx.ui.scanId) {
      ctx.ui.generation = (ctx.ui.generation || 0) + 1;
      ctx.ui.scanId = el.value; ctx.ui.selection = []; ctx.ui.expanded = {}; ctx.ui.bulkConfirm = false; ctx.ui.report = null;
      ctx.ui.initialized = false; ctx.rerender(); load(ctx);
    }
  },
};
