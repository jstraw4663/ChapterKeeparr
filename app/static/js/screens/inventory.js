// Library health uses the existing panels, fields, tabs, pills and disclosures.
import { html, bool, relative, minutes } from '../format.js';
import { button, field, selectField, tabs, statusPill, collapsible, emptyState } from '../ui.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { FINDINGS, INTEGRITY, bytes, openFindings, isPaired, matches, sortedBooks, bookBytes } from '../library-health.js';

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
      ${button({ label: finding.review_note ? 'Reopen' : 'Keep as is', act: 'health-review', arg: finding.key, disabled: Boolean(ui.mutating) })}</div>`;
  })}</div>`;
}

function fileRows(book) {
  return html`<div class="health-files">${book.files.map(file => html`<article class="health-file"><div class="row health-wrap"><span class="pill sm">${file.format.toUpperCase() || 'FILE'}</span><strong class="health-path grow">${file.path.split('/').at(-1)}</strong><span class="meta">${bytes(file.size_bytes)}</span></div>
    <div class="row health-wrap meta"><span>${INTEGRITY[file.integrity] || 'Not checked'}</span>${file.link_count > 1 ? html`<span>Hardlinked · ${file.link_count} links</span>` : ''}${file.codec ? html`<span>${file.codec.toUpperCase()} · ${minutes(file.duration_seconds)}</span>` : ''}${file.chapter_count != null ? html`<span>${file.chapter_count} embedded chapters</span>` : ''}</div>
    ${file.title || file.author ? html`<p class="meta health-path">${file.title || 'No embedded title'}${file.author ? ` · ${file.author}` : ''}</p>` : ''}
    ${file.inspection_detail ? html`<p class="meta">${file.inspection_detail}</p>` : ''}</article>`)}</div>`;
}

function bookDetail(book, ctx) {
  const { ui, phone } = ctx;
  return html`<section class="col gap14 health-detail" aria-label="Folder review">
    ${phone ? button({ label: 'All folders', act: 'health-back' }) : ''}
    <div class="panel pad col gap14"><div><span class="eyebrow">Folder review</span><h2 class="h2 health-path">${book.title}</h2><p class="meta mono health-path">${book.path}</p></div>
      <div class="row health-wrap">${formatPills(book)}<span class="meta">${bytes(bookBytes(book))} logical size</span></div>
      <p class="meta">${isPaired(book) ? 'One EPUB and one M4B are present. This does not verify that their editions match.' : 'Review the formats below to work toward one EPUB and one M4B.'}</p>
    </div>
    ${collapsible({ id: 'health-findings', title: 'Suggestions', count: openFindings(book).length, open: ui.open?.['health-findings'] !== false, body: findingRows(book, ui) })}
    ${collapsible({ id: 'health-files', title: 'Files and inspection', count: book.files.length, open: ui.open?.['health-files'] !== false, body: fileRows(book) })}
    <p class="meta">Keep as is records a review choice only. Conversion, renaming, metadata writes and cleanup are not available in this build.</p>
  </section>`;
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
    const selected = books.find(b => b.path === ui.selected);
    const running = (ui.scans || []).find(active);
    const roots = state.settings?.library_roots || [];
    if (ui.path === undefined && roots.length) ui.path = roots[0];
    const summary = report?.summary;
    const error = ui.error ? html`<div class="panel pad health-error" role="alert"><strong>Couldn’t update the library</strong><p>${ui.error}</p>${button({ label: 'Retry', act: 'health-refresh' })}</div>` : '';
    const controls = html`<section class="panel pad col gap14" aria-label="Library scan">
      <div class="health-scan-form">${field({ id: 'health-root', label: 'Library folder', value: ui.path || '', placeholder: '/library', hint: 'Server path inside this container. Scans never change library or seeding files.', extra: { 'data-input': 'health-root' } })}
        <div class="health-scan-actions">${button({ label: ui.starting ? 'Starting…' : 'Scan library', kind: 'primary', act: 'health-start', disabled: Boolean(running || ui.starting || !ui.path) })}${running ? button({ label: running.cancel_requested ? 'Cancelling…' : 'Cancel scan', act: 'health-cancel', arg: running.id, disabled: Boolean(running.cancel_requested || ui.mutating) }) : ''}</div></div>
      ${running ? html`<p class="statusline" role="status"><span class="dot dot-ink pulse" aria-hidden="true"></span>${scanLabel(running)} · ${running.processed_files.toLocaleString()} files inspected${running.cancel_requested ? ' · stopping at a safe checkpoint' : ''}</p>` : ''}
      ${(ui.scans || []).length ? selectField({ id: 'health-history', label: 'Scan history', value: ui.scanId, options: ui.scans.map(s => [s.id, `${relative(s.created_at)} · ${scanLabel(s)} · ${s.root}`]), extra: { 'data-input': 'health-history' } }) : ''}
    </section>`;
    let content;
    if (!ui.initialized) content = emptyState({ title: 'Loading library scans…' });
    else if (!report) content = emptyState({ title: 'Inspect your library', body: 'Scan a server folder to find EPUB and audiobook pairs, extra copies, naming differences and file problems.' });
    else if (active(report)) content = emptyState({ title: scanLabel(report), body: `${report.processed_files.toLocaleString()} files inspected. Results appear when this scan finishes. You can leave this screen and return later.` });
    else if (report.status === 'failed' || report.status === 'cancelled') content = emptyState({ title: scanLabel(report), body: report.error || 'No library files were changed. Start a new scan when ready.' });
    else {
      const stats = html`<section class="panel pad col gap14" aria-label="Scan summary"><div class="row health-wrap"><h2 class="h2">Scan results</h2><span class="meta">${relative(report.created_at)}</span></div>
        <dl class="health-summary"><div><dt>Book folders</dt><dd>${summary.book_folder_candidates}</dd></div><div><dt>EPUB + M4B pairs</dt><dd>${books.filter(isPaired).length}</dd></div><div><dt>Need attention</dt><dd>${books.filter(b => openFindings(b).length).length}</dd></div><div><dt>Files</dt><dd>${summary.file_count}</dd></div><div><dt>Logical size</dt><dd>${bytes(summary.logical_bytes)}</dd></div><div><dt>Hardlinked files</dt><dd>${summary.hardlinked_files}</dd></div></dl>
        <p class="meta">Folders are book candidates. Structural checks do not prove complete text, complete audio or accurate chapters. Logical size includes linked entries; physical space recoverable is unknown.</p>
      </section>`;
      const issues = (report.issues || []).length ? collapsible({ id: 'health-exclusions', title: 'Scan exclusions', count: report.issues.length, open: Boolean(ui.open?.['health-exclusions']), body: html`<ul class="health-issues">${report.issues.map(i => html`<li><strong>${i.code.replaceAll('_', ' ')}</strong><span class="mono meta health-path">${i.path}</span></li>`)}</ul>` }) : '';
      const list = html`<section class="col gap14 health-list" aria-label="Book folders">${visible.length ? html`<div class="panel health-folder-list">${visible.slice(0, ui.limit || 60).map(b => {
        const needs = openFindings(b).length;
        return html`<button type="button" class="health-folder ${b.path === ui.selected ? 'selected' : ''}" data-act="health-select" data-arg="${b.path}" aria-pressed="${bool(b.path === ui.selected)}"><span class="col gap8 grow"><strong class="health-path">${b.title}</strong><span class="meta mono health-path">${b.relative_path}</span><span class="row health-wrap">${formatPills(b)}</span></span><span class="col gap8 health-folder-end">${needs ? statusPill({ key: 'review', tone: 'warn', label: 'Needs review' }, { size: 'sm' }) : html`<span class="meta">No open findings</span>`}<span class="meta">${needs ? `${needs} ${needs === 1 ? 'finding' : 'findings'}` : `${b.files.length} files`}</span></span></button>`;
      })}</div>` : emptyState({ title: books.length ? 'No folders match this filter' : 'No book folders found', body: books.length ? 'Try another filter or search.' : 'Check the folder path and scan exclusions. Files without recognized ebook or audio formats remain listed in Other files.' })}
      ${visible.length > (ui.limit || 60) ? button({ label: 'Show more folders', act: 'health-more' }) : ''}</section>`;
      const extras = (report.files || []).filter(f => !books.some(b => b.path === f.path.slice(0, f.path.lastIndexOf('/'))));
      const otherFiles = extras.length ? collapsible({ id: 'health-other', title: 'Other files', count: extras.length, open: Boolean(ui.open?.['health-other']), body: html`<ul class="health-issues">${extras.map(f => html`<li><span class="mono meta health-path">${f.relative_path}</span><span class="meta">${bytes(f.size_bytes)}</span></li>`)}</ul>` }) : '';
      content = html`${stats}${issues}<div class="col gap14"><div class="health-filter-fields">${field({ id: 'health-search', label: 'Search folders and metadata', type: 'search', value: ui.search || '', extra: { 'data-input': 'health-search' } })}${selectField({ id: 'health-sort', label: 'Sort folders', options: [['title', 'Title'], ['findings', 'Most findings'], ['size', 'Largest first']], value: ui.sort || 'title', extra: { 'data-input': 'health-sort' } })}</div>
        ${tabs({ label: 'Filter library findings', options: FILTERS.map(([key, label]) => [key, label, books.filter(b => matches(b, key)).length]), value: filter, act: 'health-filter', scroll: true })}
        <p class="meta">${visible.length} of ${books.length} book folders · folder names and editions have not been matched to BookOrbit</p>
        <div class="health-workspace ${selected ? 'has-selection' : ''}">${!phone || !selected ? list : ''}${selected ? bookDetail(selected, ctx) : !phone ? html`<div class="panel">${emptyState({ title: 'Choose a folder to review', body: 'Compare its files, inspect findings, and record intentional exceptions.' })}</div>` : ''}</div></div>${otherFiles}`;
    }
    return html`<div class="col gap20 ${phone ? 'page-inset' : ''} health-page"><header class="health-heading"><div><h1 class="h1" tabindex="-1">Library</h1><p class="meta">File health and organization</p></div>${button({ label: 'Chapter repair jobs', href: '#/repairs' })}</header>${error}${controls}${content}</div>`;
  },
  mount(root, ctx) {
    if ((!ctx.ui.initialized || ctx.enter) && !ctx.ui.pending) { load(ctx); return; }
    const timer = setTimeout(() => load(ctx), (ctx.ui.scans || []).some(active) ? 1500 : 10000);
    return () => clearTimeout(timer);
  },
  actions: {
    'health-refresh': (el, ev, ctx) => load(ctx),
    'health-filter': (el, ev, ctx) => { ctx.ui.filter = el.dataset.arg; ctx.ui.selected = null; ctx.ui.limit = 60; ctx.rerender(); },
    'health-select': (el, ev, ctx) => { ctx.ui.selected = el.dataset.arg; ctx.rerender(); },
    'health-back': (el, ev, ctx) => { ctx.ui.selected = null; ctx.rerender(); },
    'health-more': (el, ev, ctx) => { ctx.ui.limit = (ctx.ui.limit || 60) + 60; ctx.rerender(); },
    async 'health-start'(el, ev, ctx) {
      const ui = ctx.ui;
      if (ui.starting) return;
      ui.starting = true; ui.error = ''; ctx.rerender();
      try {
        const task = await api.startLibraryScan(ui.path);
        ui.generation = (ui.generation || 0) + 1;
        ui.scanId = task.id; ui.report = task; ui.selected = null;
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
      const ui = ctx.ui, book = ui.report.books.find(b => b.path === ui.selected);
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
    if (key === 'health-search') { ctx.ui.search = el.value; ctx.ui.selected = null; ctx.ui.limit = 60; ctx.rerender(); }
    if (key === 'health-sort') { ctx.ui.sort = el.value; ctx.rerender(); }
    if (key === 'health-history' && el.value !== ctx.ui.scanId) {
      ctx.ui.generation = (ctx.ui.generation || 0) + 1;
      ctx.ui.scanId = el.value; ctx.ui.selected = null; ctx.ui.report = null;
      ctx.ui.initialized = false; ctx.rerender(); load(ctx);
    }
  },
};
