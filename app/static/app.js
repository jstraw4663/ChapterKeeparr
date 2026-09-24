(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const TOKEN_KEY = 'chapterkeeparr.api_token';
  const state = { jobs: [], selected: null, filter: 'all', query: '', settings: null, browsePath: null, browseRoots: [], loading: true, connected: false, polling: false, detailBusy: false, lastSection: 'jobs', editionResults: [], editionQuery: '', editionRegion: 'us', editionLoading: false };
  const ACTIVE = new Set(['queued', 'running', 'starting', 'converting', 'researching', 'checking_speech', 'validating_output', 'committing', 'cancelling']);
  const REVIEW = new Set(['awaiting_review', 'needs_review', 'needs_details', 'review', 'error', 'failed', 'cleanup_incomplete']);
  const REVIEW_FORM = new Set(['awaiting_review']);
  const DONE = new Set(['complete', 'completed', 'saved', 'skipped', 'cancelled', 'canceled']);
  const names = { queued: 'Queued', running: 'In progress', starting: 'Starting', converting: 'Converting', researching: 'Researching', checking_speech: 'Checking audio', validating_output: 'Validating', committing: 'Saving output', cancelling: 'Cancelling', awaiting_review: 'Awaiting review', needs_review: 'Needs review', needs_details: 'Needs details', review: 'Needs review', error: 'Error', failed: 'Failed', cleanup_incomplete: 'Cleanup incomplete', complete: 'Complete', completed: 'Complete', saved: 'Saved', skipped: 'Skipped', cancelled: 'Cancelled', canceled: 'Cancelled' };
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = value => value == null || value === '' ? '—' : String(value);
  const shortPath = path => String(path || '').replace(/\/$/, '').split('/').filter(Boolean).pop() || String(path || 'Untitled source');
  const statusName = status => names[status] || String(status || 'Unknown').replaceAll('_', ' ');
  const statusClass = status => REVIEW.has(status) ? 'review' : DONE.has(status) ? (status === 'complete' || status === 'completed' || status === 'saved' ? 'success' : 'neutral') : ACTIVE.has(status) ? 'active' : 'neutral';
  const badge = status => `<span class="badge ${statusClass(status)}"><span class="badge-dot"></span>${safe(statusName(status))}</span>`;
  const dateValue = value => typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  const when = value => { if (!value) return '—'; const d = dateValue(value); return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d); };
  const percent = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n))) : 0; };
  const reportOf = job => job?.result?.report || job?.result || {};
  const token = () => localStorage.getItem(TOKEN_KEY) || '';

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body != null) headers.set('Content-Type', 'application/json');
    if (token()) headers.set('Authorization', `Bearer ${token()}`);
    let response;
    try { response = await fetch(path, { ...options, headers, cache: 'no-store' }); }
    catch { throw new Error('Cannot reach the ChapterKeeparr server. Check the container and try again.'); }
    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try { const data = await response.json(); message = data.detail || data.error || data.message || message; }
      catch { /* The server may return plain text. */ }
      if (response.status === 401) message = 'Access denied. Add the server token in Settings and try again.';
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function alert(message) { const box = $('#global-alert'); box.textContent = message; box.classList.toggle('hidden', !message); }
  function connection(connected) { state.connected = connected; const el = $('#connection'); el.innerHTML = `<span class="connection-dot"></span>${connected ? 'Connected' : 'Offline'}`; el.classList.toggle('offline', !connected); updateOfflineUI(); }
  function updateOfflineUI() { const offline = !navigator.onLine || !state.connected; $('#offline-banner').classList.toggle('hidden', !offline); $('#submit-button').disabled = offline || scanningBooks || Boolean(scannedPath && !selectedBooks.size); $$('[data-action], #review-form button[type="submit"], #edition-search-form button[type="submit"]').forEach(button => { button.disabled = offline; }); }
  function setMetric(id, n) { $(id).textContent = state.loading || !state.connected ? '—' : String(n); }

  const covers = new Map();
  const coverPending = new Set();
  let coverActive = 0;
  const coverQueue = [];
  function coverMarkup(job) {
    const report = reportOf(job);
    const url = report.edition?.cover_url || report.identity?.cover_url;
    return `<span class="book-cover" aria-hidden="true">♫<img alt="" loading="lazy" referrerpolicy="no-referrer" ${url ? `src="${safe(url)}"` : `data-cover-id="${safe(job.id)}"`}></span>`;
  }
  const coverObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      coverObserver.unobserve(entry.target);
      const id = entry.target.dataset.coverId;
      if (!covers.has(id) && !coverPending.has(id)) { coverPending.add(id); coverQueue.push(id); }
    }
    pumpCovers();
  });
  function hydrateCovers() {
    $$('img[data-cover-id]').forEach(img => {
      const url = covers.get(img.dataset.coverId);
      if (url) img.src = url;
      else if (!covers.has(img.dataset.coverId)) coverObserver.observe(img);
    });
  }
  function pumpCovers() {
    while (coverActive < 3 && coverQueue.length) {
      const id = coverQueue.shift(); coverActive++;
      fetch(`/api/jobs/${encodeURIComponent(id)}/cover`, {headers: token() ? {Authorization: `Bearer ${token()}`} : {}, cache: 'no-store'})
        .then(async response => response.ok ? URL.createObjectURL(await response.blob()) : null)
        .then(url => {
          covers.set(id, url);
          if (covers.size > 150) { const key = covers.keys().next().value; const old = covers.get(key); if (old) URL.revokeObjectURL(old); covers.delete(key); }
          $$('img[data-cover-id]').filter(img => img.dataset.coverId === id).forEach(img => { if (url) img.src = url; });
        }).catch(() => {}).finally(() => { coverPending.delete(id); coverActive--; pumpCovers(); });
    }
  }
  document.addEventListener('load', event => { if (event.target.matches?.('.book-cover img')) event.target.classList.add('loaded'); }, true);
  document.addEventListener('error', event => { if (event.target.matches?.('.book-cover img')) event.target.classList.remove('loaded'); }, true);
  const attentionFirst = jobs => jobs.slice().sort((a,b) => Number(REVIEW.has(b.status)) - Number(REVIEW.has(a.status)));
  const searchButton = job => REVIEW_FORM.has(job.status) ? `<button class="icon-button match-shortcut" data-match-id="${safe(job.id)}" aria-label="Find a match for ${safe(shortPath(job.path))}" title="Find a match">⌕</button>` : '';
  function renderCurrentWork() {
    const running = state.jobs.filter(job => job.status === 'running');
    const queued = state.jobs.filter(job => job.status === 'queued').length;
    $('#current-work-count').textContent = `${running.length} working · ${queued} queued`;
    $('#current-work-list').innerHTML = running.length ? running.map(job => `<div class="working-job">${coverMarkup(job)}<div class="working-main"><button class="table-source" data-job-id="${safe(job.id)}"><strong>${safe(shortPath(job.path))}</strong></button><p>${safe(job.result?.activity || statusName(job.stage || job.status))}</p><div class="progress-cell"><div class="progress-track" role="progressbar" aria-label="Estimated workflow progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent(job.progress)}"><span style="width:${percent(job.progress)}%"></span></div><span>${percent(job.progress)}%</span></div></div></div>`).join('') : `<p class="subtle">${queued ? 'Waiting for a worker to start the next book.' : 'No books processing right now.'}</p>`;
  }
  function renderOverview() {
    const jobs = attentionFirst(state.jobs);
    renderCurrentWork();
    setMetric('#metric-total', jobs.length);
    setMetric('#metric-active', jobs.filter(j => ACTIVE.has(j.status)).length);
    setMetric('#metric-review', jobs.filter(j => REVIEW.has(j.status)).length);
    setMetric('#metric-complete', jobs.filter(j => ['complete', 'completed', 'saved'].includes(j.status)).length);
    const target = $('#recent-jobs');
    if (state.loading) { target.innerHTML = '<div class="loading-state">Loading jobs…</div>'; return; }
    if (!state.connected && !jobs.length) { target.innerHTML = '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">◫</div><strong>Jobs unavailable</strong><p>Connect to the server to load activity.</p></div>'; return; }
    if (!jobs.length) { target.innerHTML = '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">◫</div><strong>No jobs yet</strong><p>Choose a source folder to start your first verification.</p><a class="button button-secondary" href="#new-job">Create a job</a></div>'; return; }
    target.innerHTML = jobs.slice(0, 5).map(job => `<div class="recent-row">${coverMarkup(job)}<button class="recent-main table-source" data-job-id="${safe(job.id)}"><strong>${safe(shortPath(job.path))}</strong><small title="${safe(job.path)}">${safe(job.path || job.id)}</small></button><div class="recent-status">${badge(job.status)}${searchButton(job)}</div></div>`).join('');
    hydrateCovers();
  }

  function filteredJobs() {
    return attentionFirst(state.jobs).filter(job => {
      if (state.filter === 'active' && !ACTIVE.has(job.status)) return false;
      if (state.filter === 'review' && !REVIEW.has(job.status)) return false;
      if (state.filter === 'complete' && !['complete', 'completed', 'saved'].includes(job.status)) return false;
      if (state.filter === 'done' && !DONE.has(job.status)) return false;
      const q = state.query.trim().toLowerCase();
      return !q || [job.path, job.id, job.status].some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function renderJobs() {
    const body = $('#jobs-tbody');
    if (state.loading) { body.innerHTML = '<tr><td colspan="5" class="loading-state">Loading jobs…</td></tr>'; return; }
    const jobs = filteredJobs();
    if (!jobs.length) { body.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-symbol" aria-hidden="true">⌕</div><strong>${!state.connected && !state.jobs.length ? 'Jobs unavailable' : state.jobs.length ? 'No matching jobs' : 'No jobs yet'}</strong><p>${!state.connected && !state.jobs.length ? 'Connect to the server to load the queue.' : state.jobs.length ? 'Try a different search or filter.' : 'Start with an audiobook folder to see progress here.'}</p>${state.jobs.length || !state.connected ? '' : '<a class="button button-secondary" href="#new-job">Create a job</a>'}</div></td></tr>`; }
    else body.innerHTML = jobs.map(job => {
      const progress = percent(job.progress);
      const label = ACTIVE.has(job.status) ? `${progress}%` : DONE.has(job.status) ? 'Finished' : 'Paused';
      return `<tr><td><div class="job-source-wrap">${coverMarkup(job)}<button type="button" class="table-source" data-job-id="${safe(job.id)}"><strong>${safe(shortPath(job.path))}</strong><small title="${safe(job.path)}">${safe(job.path || job.id)}</small></button></div></td><td>${badge(job.status)}</td><td><div class="progress-cell"><div class="progress-track"><span style="width:${progress}%"></span></div><span>${safe(label)}</span></div></td><td class="date-cell">${safe(when(job.updated_at || job.created_at))}</td><td class="job-row-actions">${searchButton(job)}<button type="button" class="row-open" data-job-id="${safe(job.id)}" aria-label="Open ${safe(shortPath(job.path))}">→</button></td></tr>`;
    }).join('');
    hydrateCovers();
    $('#jobs-count').textContent = `Showing ${jobs.length} of ${state.jobs.length} ${state.jobs.length === 1 ? 'job' : 'jobs'}`;
  }

  function renderSettings() {
    const s = state.settings; const target = $('#settings-list');
    if (!s) { target.innerHTML = '<div><dt>Status</dt><dd>Unavailable</dd></div>'; return; }
    const roots = Array.isArray(s.library_roots) ? s.library_roots : [];
    target.innerHTML = `<div><dt>API authentication</dt><dd>${s.auth_required ? 'Required' : 'Not required'}</dd></div><div><dt>Library roots</dt><dd>${roots.length ? roots.map(x => `<span class="path-chip">${safe(x)}</span>`).join('') : 'None configured'}</dd></div><div><dt>Workers</dt><dd>${safe(text(s.workers))}</dd></div><div><dt>CPU threads</dt><dd>${safe(text(s.cpu_threads))}</dd></div><div><dt>Work cache budget</dt><dd>${s.work_cache_budget_gb == null ? '—' : `${safe(s.work_cache_budget_gb)} GB`}</dd></div><div><dt>BookOrbit</dt><dd>${s.bookorbit_enabled ? 'Enabled' : 'Unavailable'}</dd></div><div><dt>Work directory</dt><dd class="break-path">${safe(text(s.work_dir))}</dd></div><div><dt>Config directory</dt><dd class="break-path">${safe(text(s.config_dir))}</dd></div>`;
    target.insertAdjacentHTML('beforeend', `<div><dt>Recovery acceptance</dt><dd><form id="recovery-settings-form"><label for="recovery-default">Minimum supported markers (%)</label><input id="recovery-default" name="minimum" type="number" min="1" max="100" step="0.1" value="${safe(s.recovery_minimum_percent ?? 95)}" required><p class="subtle">Default for book acceptance. Each book still requires explicit exceptions and output validation.</p><button class="button button-secondary" type="submit">Save recovery default</button><p id="recovery-settings-message" role="status"></p></form></dd></div>`);
    $('#roots-help').textContent = roots.length ? `Configured roots: ${roots.join(' · ')}` : 'No library roots configured. Enter an allowed server folder path.';
  }

  function route() {
    stopChapter(); chapterKey = '';
    const raw = decodeURIComponent((location.hash || '#overview').slice(1));
    const base = raw.split('?')[0];
    const detail = raw.startsWith('job/');
    const filter = new URLSearchParams(raw.split('?')[1] || '').get('filter');
    if (base === 'jobs' && ['all', 'active', 'review', 'complete', 'done'].includes(filter)) {
      state.filter = filter; state.query = ''; $('#job-search').value = '';
      $$('.filter').forEach(button => { const active = button.dataset.filter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      renderJobs();
    }
    const section = detail ? 'job-detail' : ['overview', 'jobs', 'new-job', 'settings'].includes(base) ? base : 'overview';
    $$('.page-section').forEach(el => el.classList.toggle('hidden', el.id !== section));
    $$('.nav-link').forEach(el => { const active = el.dataset.nav === (detail ? 'jobs' : section); el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    $('#breadcrumb-current').textContent = detail ? 'Job details' : { overview: 'Overview', jobs: 'Jobs', 'new-job': 'New job', settings: 'Settings' }[section];
    if (detail) { const next = raw.slice(4).split('?')[0]; if (next !== state.selected) { state.editionQuery = ''; state.editionResults = []; } state.selected = next; loadDetail(state.selected); }
    else { state.selected = null; if (section !== 'jobs') state.lastSection = section; }
    $('.sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function refresh(initial = false) {
    if (state.polling) return;
    state.polling = true;
    try {
      const data = await api('/api/jobs');
      state.jobs = (Array.isArray(data) ? data : data?.jobs || []).slice().sort((a, b) => dateValue(b.updated_at || b.created_at || 0) - dateValue(a.updated_at || a.created_at || 0));
      state.loading = false; connection(true); alert(''); renderOverview(); renderJobs();
      if (state.selected) await loadDetail(state.selected, true);
    } catch (error) { state.loading = false; connection(false); if (initial) { alert(error.message); renderOverview(); renderJobs(); } }
    finally { state.polling = false; schedulePoll(); }
  }
  let pollTimer;
  function schedulePoll() { clearTimeout(pollTimer); pollTimer = setTimeout(() => refresh(), state.jobs.some(j => ACTIVE.has(j.status)) ? 3000 : 10000); }
  async function loadSettings() { try { state.settings = await api('/api/settings'); renderSettings(); } catch { renderSettings(); } }

  function detailSection(title, body, empty = 'No information available yet.') { return `<section class="surface detail-card"><div class="card-heading"><div><h2>${safe(title)}</h2></div></div>${body || `<p class="subtle">${safe(empty)}</p>`}</section>`; }
  function keyValue(label, value) { return `<div><dt>${safe(label)}</dt><dd>${safe(text(value))}</dd></div>`; }
  function evidenceStatus(value) { return value === true ? '<span class="badge success"><span class="badge-dot"></span>Pass</span>' : value === false ? '<span class="badge review"><span class="badge-dot"></span>Review</span>' : '<span class="badge neutral"><span class="badge-dot"></span>Pending</span>'; }
  function artifactPath(id, relative) {
    const pieces = String(relative || '').split('/').filter(Boolean);
    if (!pieces.length || pieces.some(p => p === '..' || p === '.') || String(relative).startsWith('/')) return null;
    return `/api/jobs/${encodeURIComponent(id)}/artifacts/${pieces.map(encodeURIComponent).join('/')}`;
  }
  function checkMarkup(job, check, index) {
    const title = check.title || `Chapter ${index + 1}`;
    const excerpt = check.audio_excerpt ? artifactPath(job.id, check.audio_excerpt) : null;
    const transcript = check.transcript;
    return `<div class="check-row"><div class="check-index">${String(index + 1).padStart(2, '0')}</div><div class="check-main"><div class="check-title"><strong>${safe(title)}</strong>${evidenceStatus(check.passed)}</div><div class="check-meta">${check.boundary_seconds == null ? '' : `Boundary ${safe(formatDuration(check.boundary_seconds))}`}${check.reason ? ` · ${safe(check.reason)}` : ''}</div>${transcript ? `<blockquote>${safe(typeof transcript === 'string' ? transcript : JSON.stringify(transcript))}</blockquote>` : ''}${excerpt ? `<a class="excerpt-link" href="${safe(excerpt)}" data-audio-link="true">▶ Listen to excerpt</a>` : ''}</div></div>`;
  }
  function formatDuration(seconds) { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 3600).toString().padStart(2, '0')}:${Math.floor((n % 3600) / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`; }
  const sourceDurations = new Map();
  function sourceMinutes(job) {
    const seconds = sourceDurations.get(job.id) ?? reportOf(job).source_duration_seconds;
    return Number.isFinite(seconds) && seconds > 0 ? `${(seconds / 60).toLocaleString(undefined, {maximumFractionDigits: 1})} minutes (${formatDuration(seconds)})` : 'Duration unavailable';
  }
  async function loadSourceDuration(job) {
    if (sourceDurations.has(job.id)) return;
    try {
      const info = await api(`/api/jobs/${encodeURIComponent(job.id)}/source-info`);
      sourceDurations.set(job.id, info.duration_seconds);
      if (state.selected === job.id && $('#source-duration')) $('#source-duration').textContent = sourceMinutes(job);
    } catch { /* An unavailable source must not block edition search. */ }
  }
  function alignmentPlot(d) {
    const pairs = d?.nearest_candidates || [];
    if (!pairs.length) return '<p class="subtle">No nearby boundary candidates to plot.</p>';
    const maxX = Math.max(1, Number(d.local_duration_seconds));
    const maxY = Math.max(.35, ...pairs.map(p => Math.abs(p.difference)));
    return `<figure class="alignment-plot"><svg viewBox="0 0 600 160" role="img" aria-label="Local minus nearest published timestamp across the recording"><path d="M35 15V130H580M35 70H580" fill="none" stroke="currentColor" opacity=".4"/>${pairs.map(p => `<circle cx="${35 + 545*p.local/maxX}" cy="${70-50*p.difference/maxY}" r="3" fill="${p.matched ? '#74ddd0' : '#f0bc6d'}"><title>${safe(formatDuration(p.local))}: ${Number(p.difference).toFixed(3)} s</title></circle>`).join('')}<text x="35" y="152" fill="currentColor" font-size="12">0 min</text><text x="480" y="152" fill="currentColor" font-size="12">${(maxX/60).toFixed(1)} min</text></svg><figcaption>Local minus nearest published boundary; green = matched, amber = unconfirmed candidate. Vertical range ±${maxY.toFixed(3)} s. Unmatched boundaries are listed below; a flat plot alone is not verification.</figcaption></figure>`;
  }
  function alignmentDetails(report) {
    const attempts = report.alignment_attempts || [];
    if (!attempts.length) return '';
    return detailSection(`Alignment diagnostics · ${attempts.length} of 10 editions checked`, attempts.map(a => {
      const d = a.diagnostics || {};
      return `<details class="alignment-attempt"><summary>${safe(a.asin)} · ${safe(a.region?.toUpperCase())} · ${a.identity_compatible ? 'Metadata compatible' : 'Metadata mismatch'} · ${a.timing_passed ? 'Timing compatible' : 'Timing unresolved'}</summary><p>${safe(a.reason)}</p>${a.cached ? '<p class="subtle">Reused versioned timing diagnostic; speech verification is still required.</p>' : ''}${a.duplicate_of ? `<p>Identical timeline: ${safe(a.duplicate_of)}</p>` : ''}${d.local_duration_seconds ? `<p>Local ${(d.local_duration_seconds/60).toFixed(1)} min · Published ${(d.reference_duration_seconds/60).toFixed(1)} min · Offset ${d.offset_seconds == null ? 'unavailable' : Number(d.offset_seconds).toFixed(3)+' s'} · ${d.matching_boundaries || 0}/${d.usable_anchors || 0} anchors</p>${alignmentPlot(d)}<p>Unmatched local: ${(d.unmatched_local || []).length} · Unmatched published: ${(d.unmatched_reference || []).length}</p><details><summary>Unmatched timestamps</summary><p class="break-path">Local: ${safe((d.unmatched_local || []).map(formatDuration).join(', ')) || 'None'}</p><p class="break-path">Published: ${safe((d.unmatched_reference || []).map(formatDuration).join(', ')) || 'None'}</p></details>` : ''}</details>`;
    }).join(''));
  }
  function recoveryDraft(job, report) {
    const draft = report.recovery_draft; if (!draft) return '';
    return detailSection('Local-marker recovery draft', `<p>${draft.complete ? 'Scan complete' : 'Partial scan saved'} · ${draft.supported_count || 0} supported · ${draft.unresolved_count || 0} unresolved · ${draft.markers.length}/${draft.total_markers} scanned</p><p class="subtle">Recovery evidence retains original timestamps. Supported headings identify chapters; unresolved sections require explicit exceptions before finalization.</p>${draft.invalidated ? '<p class="error">Source changed; this draft is invalid.</p>' : ''}<details class="alignment-attempt"><summary>Review ${draft.markers.length} marker entries</summary><div class="checks-list">${draft.markers.map((m,i) => `<details class="alignment-attempt"><summary>${i+1}. ${safe(m.title || m.old_title || 'Untitled marker')} · ${safe(formatDuration(m.new_seconds))} · ${safe(m.status)}</summary><p>Old ${safe(formatDuration(m.old_seconds))} → Proposed ${safe(formatDuration(m.new_seconds))}</p><p>${safe(m.reason)}</p>${m.retry ? `<p>Automatic wider-excerpt retry: ${safe(m.retry.status)} · ${safe(formatDuration(m.retry.clip_start_seconds))}–${safe(formatDuration(m.retry.clip_end_seconds))}</p>` : ''}<p>${safe(m.source)} · ${safe(m.confidence)}</p><blockquote>${safe(m.transcript)}</blockquote><a class="excerpt-link" href="${safe(artifactPath(job.id,m.audio_excerpt))}" data-audio-link="true">▶ Listen to excerpt</a></details>`).join('')}</div></details><details class="alignment-attempt"><summary>Unresolved published sections: ${draft.missing_sections.length}</summary><p>${draft.missing_sections.map(c=>safe(c.title)).join(', ')}</p></details>`);
  }
  async function downloadReport() {
    try {
      const report = await api(`/api/jobs/${encodeURIComponent(state.selected)}/report`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'chapterkeeparr-report.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { alert(error.message); }
  }
  function workflowMarkup(job) {
    const w = job.workflow;
    if (!w) return '';
    return `<section class="surface workflow-card" aria-label="Book process"><h2>${safe(w.overall)}</h2><ol class="workflow-timeline">${w.gates.map((g,i)=>`<li class="gate-${safe(g.state)}"><details><summary><span class="gate-number">${i+1}</span><strong>${safe(g.label)}</strong><small>${safe(g.state)}</small></summary><p>${safe(g.detail)}</p></details></li>`).join('')}</ol><p class="subtle">Open a step to see its checks. Evidence grades describe checks performed; they are not probabilities of completeness.</p>${Object.keys(w.assessment).length ? `<dl class="assessment-grid">${Object.entries(w.assessment).map(([key,value])=>`<div><dt>${safe(key)}</dt><dd><strong>${safe(value.level.replaceAll('_',' '))}</strong><p>${safe(value.detail)}</p></dd></div>`).join('')}</dl>` : ''}</section>`;
  }
  function acceptanceForm(job) {
    const p = job.recovery_acceptance_preview;
    if (!p) return '';
    if (!p.ready) return '<p class="subtle">Finalization needs a complete, valid draft with its reference timeline. Resume checks first.</p>';
    return `<section class="surface detail-card"><h2>Finalize with accepted exceptions</h2><p>${p.supported} of ${p.total} markers supported (${p.supported_percent.toFixed(1)}%). Supported labels will be applied at existing times. Unresolved labels and times are preserved; no missing marker is invented.</p><form id="accept-recovery-form" data-draft-token="${safe(p.token)}"><label for="book-recovery-minimum">Minimum supported markers for this book (%)</label><input id="book-recovery-minimum" name="minimum" type="number" min="1" max="100" step="0.1" value="${safe(p.default_minimum_percent)}" required><p class="subtle">Global default: ${safe(p.default_minimum_percent)}%. This value applies only to this approval.</p>${p.sections.length ? '<h3>Accept unlocated sections individually</h3><p>Checking a section designates it optional for this book. Named narrative chapters are not automatically optional.</p>' : ''}${p.sections.map(c=>`<label class="accept-option"><input type="checkbox" name="optional_section" value="${safe(c.id)}" required> Accept unlocated section: ${safe(c.title)}</label>`).join('')}${p.unresolved_markers.length ? `<details><summary>${p.unresolved_markers.length} original markers will keep their labels and times</summary><ul>${p.unresolved_markers.map(m=>`<li>${m.index}. ${safe(m.title)} · ${safe(formatDuration(m.seconds))}</li>`).join('')}</ul></details><label class="accept-option"><input type="checkbox" name="preserve" required> Keep these unresolved original markers</label>` : ''}<h3>Content coverage</h3>${p.coverage_warnings.map(w=>`<p>${safe(w)}</p>`).join('')}<label class="accept-option"><input type="checkbox" name="gap" required> I accept the possible content gaps or edition differences in this recording. Chapter matching does not establish complete audio.</label><p class="subtle">The audio must be unchanged, the output must validate, and an existing M4B will be backed up. Source MP3s are retained.</p><button class="button button-primary" type="submit">Accept exceptions and finalize</button><p id="accept-recovery-message" role="status"></p></form></section>`;
  }
  function targetedReview(job, report, identity) {
    const w = job.workflow;
    if (!w || w.review_category === 'identity') return reviewForm(job,report,identity);
    return `<section class="surface detail-card"><h2>${safe(w.next_action)}</h2><p>${safe(report.review_reason?.detail || report.reason || job.error)}</p><p class="subtle">Resume reruns the required checks. Use explicit acceptance below to finalize an eligible recovery draft.</p><button type="button" class="button button-primary" data-resume-checks>Resume checks</button><details class="alignment-attempt"><summary>Change recording details</summary>${reviewForm(job,report,identity)}</details></section>`;
  }
  function renderDetail(job, force = false) {
    if (state.selected !== job.id) return;
    if (!force && REVIEW_FORM.has(job.status) && $('#review-form')?.dataset.jobId === job.id) return;
    const report = reportOf(job); const identity = report.identity || {};
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const attempts = Array.isArray(report.edition_attempts) ? report.edition_attempts : [];
    const logs = Array.isArray(job.logs) ? job.logs : Array.isArray(job.result?.logs) ? job.result.logs : [];
    const isReview = REVIEW_FORM.has(job.status);
    const isActive = ACTIVE.has(job.status);
    const canRetry = ['failed', 'cancelled', 'skipped'].includes(job.status);
    const canCancel = ['queued', 'running', 'awaiting_review'].includes(job.status);
    const progress = percent(job.progress);
    $('#detail-updated').textContent = `Updated ${when(job.updated_at || job.created_at)}`;
    $('#detail-content').innerHTML = `<div class="detail-heading"><div><div class="eyebrow">JOB ${safe(String(job.id).slice(0, 8).toUpperCase())}</div>${coverMarkup(job)}<h1 id="detail-title">${safe(shortPath(job.path))}</h1><p class="break-path">${safe(job.path)}</p><div class="detail-status">${badge(job.status)}<span>${safe(job.stage ? statusName(job.stage) : '')}</span></div></div><div class="detail-actions">${canCancel ? '<button class="button button-quiet" type="button" data-action="cancel">Cancel job</button>' : ''}${canRetry ? '<button class="button button-secondary" type="button" data-action="retry">Retry job</button>' : ''}</div></div>
      ${workflowMarkup(job)}
      ${isActive ? `<div class="surface detail-progress"><div><strong>${safe(statusName(job.stage || job.status))}</strong><span>${progress}%</span></div><div class="progress-track"><span style="width:${progress}%"></span></div></div>` : ''}
      ${(job.error || report.reason || report.pending_question) ? `<div class="alert ${isReview ? 'warning' : ''}" role="status"><strong>${isReview ? 'Review needed' : 'Job note'}</strong><p>${safe(job.error || report.reason || report.pending_question)}</p></div>` : ''}
      ${isReview ? `<div class="review-card">${targetedReview(job, report, identity)}${acceptanceForm(job)}</div>` : ''}
      <div class="detail-grid"><div class="detail-main">
      ${['complete', 'skipped'].includes(job.status) ? detailSection('Chapter Details', '<div id="chapter-list">Loading saved chapters…</div><p id="chapter-message" class="subtle" role="status"></p>') : ''}
      ${report.recovery_acceptance ? detailSection('Recorded recovery acceptance', `<p>${Number(report.recovery_acceptance.supported_percent).toFixed(1)}% supported · ${safe(report.recovery_acceptance.minimum_percent)}% required</p><p>Accepted sections: ${report.recovery_acceptance.sections.map(s=>safe(s.title)).join(', ') || 'None'}</p><p>Unresolved original markers retained: ${report.recovery_acceptance.unresolved_markers.length}. Possible content gaps explicitly accepted.</p>`) : ''}
      ${detailSection('Verification evidence', checks.length ? `<div class="check-summary"><strong>${checks.filter(c => c.passed === true).length} of ${checks.length}</strong> checks passed</div><div class="checks-list">${checks.map((check, i) => checkMarkup(job, check, i)).join('')}</div>` : '', report.recovery_acceptance ? 'Recovery speech evidence is recorded below; output integrity is shown in the Verify gate.' : 'Audio checks will appear here when a chapter plan is ready.')}
      ${recoveryDraft(job, report)}
      ${alignmentDetails(report)}
      ${attempts.length ? detailSection('Edition attempts', `<div class="attempt-list">${attempts.map(a => `<div class="attempt-row"><div><strong>${safe(a.asin || 'Unknown edition')}</strong><small>${safe(a.alignment?.matching_boundaries == null ? 'Timeline evaluated' : `${a.alignment.matching_boundaries} matching boundaries`)}</small></div>${evidenceStatus(a.passed)}</div>`).join('')}</div>`) : ''}
      ${(report.rejected_editions?.length || report.lookup_failures?.length) ? detailSection('Other editions considered', `<div class="reason-list">${[...(report.rejected_editions || []), ...(report.lookup_failures || [])].map(x => `<div><strong>${safe(x.asin || 'Edition')}</strong><p>${safe(x.reason)}</p></div>`).join('')}</div>`) : ''}
      ${logs.length ? detailSection('Activity log', `<pre class="log-block">${safe(logs.map(x => typeof x === 'string' ? x : x.message || JSON.stringify(x)).join('\n'))}</pre>`) : ''}
      </div><aside class="detail-aside">
      ${detailSection('Book details', `<dl class="detail-list">${keyValue('Title', identity.title || report.edition?.title)}${keyValue('Author', identity.author || report.edition?.author)}${keyValue('Narrator', identity.narrator || report.edition?.narrator)}${keyValue('ASIN', report.edition?.asin || identity.asin)}${keyValue('Output', report.output)}${keyValue('MP3s deleted', report.mp3s_deleted)}</dl>`)}
      ${detailSection('Job details', `<dl class="detail-list">${keyValue('Created', when(job.created_at))}${keyValue('Started', when(job.started_at))}${keyValue('Finished', when(job.finished_at))}${keyValue('Attempts', job.attempts)}${keyValue('Source MP3s', job.options?.keep_mp3s ? 'Keep' : 'Remove after success')}${keyValue('Chapter checks', job.options?.verify_all ? 'All numbered chapters' : 'Spot checks')}</dl><button type="button" class="button button-secondary" data-download-report>Download report</button>`)}
      </aside></div>`;
    if (isReview) loadSourceDuration(job);
    if (state.editionResults.length && isReview) renderEditions();
    hydrateCovers();
    if (['complete', 'skipped'].includes(job.status)) loadChapters(job);
    if (location.hash.endsWith('?match')) $('#edition-query')?.focus({preventScroll:true});
    updateOfflineUI();
  }
  function reviewForm(job, report, identity) {
    identity = {...identity, asin: report.selected_recording?.asin || identity.asin};
    const answer = job.review_answer || job.review || {};
    const field = (name, label, value, hint = '') => `<label class="field-label" for="review-${name}">${label}</label><input id="review-${name}" name="${name}" type="text" value="${safe(answer[name] || value || '')}" ${hint ? `placeholder="${safe(hint)}"` : ''} autocomplete="off">`;
    return detailSection('Correct book details', `<p class="subtle form-intro">Search by title or ASIN to inspect possible editions. Select a match to fill the fields, then submit the details to resume verification.</p><p class="source-duration">Current file: <strong id="source-duration">${safe(sourceMinutes(job))}</strong></p><form id="edition-search-form" role="search"><label class="field-label" for="edition-query">Find an edition</label><div class="edition-search-row"><input id="edition-query" type="search" name="query" value="${safe(state.editionQuery)}" placeholder="Title or ASIN" autocomplete="off"><button class="button button-secondary" type="submit">Search</button></div><button type="button" class="button button-quiet filename-fill" data-file-title="${safe(shortPath(job.path).replace(/\.(m4b|m4a|mp3)$/i, ''))}">Use filename</button><p class="field-help">Results are candidates. A selection is checked against your audio after you submit.</p></form><div id="edition-message" class="form-message hidden" role="status"></div><div id="edition-results" class="edition-results" aria-live="polite"></div><form id="review-form" data-job-id="${safe(job.id)}"><div class="review-divider"><span>Selected or manual details</span></div>${field('asin', 'ASIN', identity.asin, '10-character ASIN')}${field('title', 'Title', identity.title)}${field('author', 'Author', identity.author)}${field('narrator', 'Narrator', identity.narrator)}<label class="field-label" for="review-region">Region</label><select name="region" id="review-region">${['us', 'uk', 'ca', 'au', 'de', 'fr', 'jp', 'in', 'es', 'it'].map(x => `<option value="${x}" ${String(answer.region || report.region || 'us').toLowerCase() === x ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select><div id="review-message" class="form-message hidden" role="status"></div><button class="button button-primary submit-button" type="submit">Submit details &amp; resume</button><button class="button button-secondary submit-button" type="submit" name="recovery" value="local_markers">Review markers from audio</button><p class="field-help">Listen near each existing marker and save a draft. Select a matching ASIN first. This scan does not change your audiobook.</p></form>`);
  }
  function personNames(people) { return Array.isArray(people) ? people.map(x => typeof x === 'string' ? x : x?.name || '').filter(Boolean).join(', ') : ''; }
  function renderEditions() {
    const box = $('#edition-results'); if (!box) return;
    box.innerHTML = state.editionResults.map((edition, index) => `<button class="edition-card" type="button" data-edition-index="${index}" aria-pressed="false">${edition.cover_url ? `<span class="book-cover"><img alt="" class="loaded" loading="lazy" referrerpolicy="no-referrer" src="${safe(edition.cover_url)}"></span>` : ''}<span class="edition-top"><strong>${safe(edition.title || 'Untitled edition')}</strong><span class="edition-asin">${safe(edition.asin || 'No ASIN')}</span></span><span class="edition-people">${safe(personNames(edition.authors) || 'Author unknown')}${personNames(edition.narrators) ? ` · Narrated by ${safe(personNames(edition.narrators))}` : ''}</span><span class="edition-meta">${[edition.runtime_length_min != null ? `${Math.round(Number(edition.runtime_length_min))} min` : '', edition.language, edition.publisher_name].filter(Boolean).map(safe).join(' · ')}</span><span class="edition-choice">Select edition <span aria-hidden="true">→</span></span></button>`).join('');
  }
  async function searchEditions(event) {
    event.preventDefault();
    const query = $('#edition-query')?.value.trim();
    if (!query) { formMessage('#edition-message', 'Enter a title or ASIN to search.', true); $('#edition-query')?.focus(); return; }
    if (!state.connected || !navigator.onLine) { formMessage('#edition-message', 'Connect to the server to search editions.', true); return; }
    const jobId = state.selected; state.editionQuery = query; state.editionLoading = true;
    const button = $('#edition-search-form button[type="submit"]'); button.disabled = true;
    formMessage('#edition-message', 'Searching editions…'); $('#edition-results').innerHTML = '';
    try {
      const region = $('#review-region')?.value || 'us';
      const data = await api(`/api/editions?query=${encodeURIComponent(query)}&region=${encodeURIComponent(region)}`);
      if (state.selected !== jobId || $('#edition-query')?.value.trim() !== query) return;
      state.editionRegion = String(data.region || region).toLowerCase();
      state.editionResults = Array.isArray(data.editions) ? data.editions : [];
      formMessage('#edition-message', state.editionResults.length ? `${state.editionResults.length} possible ${state.editionResults.length === 1 ? 'edition' : 'editions'} found. Choose one to fill the details below.` : 'No editions found. Try another title, ASIN, or region.');
      renderEditions();
    } catch (error) { if (state.selected === jobId) { state.editionResults = []; formMessage('#edition-message', error.message, true); } }
    finally { state.editionLoading = false; if (button) button.disabled = false; }
  }
  function selectEdition(index) {
    const edition = state.editionResults[index]; if (!edition) return;
    $('#review-asin').value = edition.asin || '';
    $('#review-title').value = edition.title || '';
    $('#review-author').value = personNames(edition.authors);
    $('#review-narrator').value = personNames(edition.narrators);
    $('#review-region').value = state.editionRegion;
    $$('.edition-card').forEach((card, i) => { const selected = i === index; card.classList.toggle('selected', selected); card.setAttribute('aria-pressed', String(selected)); });
    formMessage('#edition-message', `${edition.title || edition.asin} selected. Review the details, then submit to resume verification.`);
    $('#review-asin').focus();
  }
  async function loadDetail(id, quiet = false) {
    if (!id || state.detailBusy) return;
    state.detailBusy = true;
    if (!quiet) $('#detail-content').innerHTML = '<div class="loading-state">Loading job…</div>';
    try { const data = await api(`/api/jobs/${encodeURIComponent(id)}`); renderDetail(data.job || data, !quiet); connection(true); }
    catch (error) { if (!quiet) $('#detail-content').innerHTML = `<div class="surface error-state"><h2>Could not load this job</h2><p>${safe(error.message)}</p><button class="button button-secondary" type="button" id="detail-retry">Try again</button></div>`; }
    finally { state.detailBusy = false; }
  }

  const player = new Audio();
  player.preload = 'metadata';
  let chapterJob = null, chapterData = [], chapterKey = '', chapterLoading = false;
  let playingChapter = -1, playbackURL = '', ticketExpiry = 0, pendingSeek = null, playGeneration = 0;
  function stopChapter() { playGeneration++; player.pause(); playingChapter = -1; pendingSeek = null; updateChapterButtons(); formMessage('#chapter-message', ''); }
  function updateChapterButtons() {
    $$('[data-chapter-index]').forEach(button => {
      const active = Number(button.dataset.chapterIndex) === playingChapter;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('playing', active);
      $('.chapter-symbol', button).textContent = active ? '■' : '▶';
    });
  }
  function chapterMarkup() {
    const box = $('#chapter-list'); if (!box || state.selected !== chapterJob) return;
    box.innerHTML = chapterData.length ? `<p class="subtle">${chapterData.length} chapters · Tap to play; tap the playing chapter to stop.</p><div class="chapter-rows">${chapterData.map((chapter,index) => `<button class="chapter-row" data-chapter-index="${index}" aria-pressed="false" ${playbackURL ? '' : 'disabled'}><span class="chapter-symbol" aria-hidden="true">▶</span><span>${safe(chapter.title || `Untitled segment ${index+1}`)}</span><time>${formatDuration(chapter.start_seconds)}</time></button>`).join('')}</div>` : '<p class="subtle">This file has no embedded chapters.</p>';
    updateChapterButtons();
  }
  async function prepareTicket(id) {
    const result = await api(`/api/jobs/${encodeURIComponent(id)}/media-token`, {method:'POST'});
    if (state.selected !== id || chapterJob !== id) return;
    playbackURL = `/api/jobs/${encodeURIComponent(id)}/audio?ticket=${encodeURIComponent(result.token)}`;
    ticketExpiry = Date.now() + result.expires_in * 1000;
    const resume = !player.paused && playingChapter >= 0;
    const position = player.currentTime;
    if (resume) pendingSeek = position;
    player.src = playbackURL; player.load();
    if (resume) player.play().catch(() => { stopChapter(); formMessage('#chapter-message', 'Playback refreshed. Tap a chapter to continue.'); });
  }
  async function loadChapters(job) {
    const key = `${job.id}:${job.updated_at}`;
    if (chapterKey === key && chapterJob === job.id) { chapterMarkup(); return; }
    if (chapterLoading) return;
    chapterLoading = true;
    try {
      const data = await api(`/api/jobs/${encodeURIComponent(job.id)}/chapters`);
      if (state.selected !== job.id) return;
      stopChapter(); chapterJob = job.id; chapterData = data.chapters || []; playbackURL = ''; chapterKey = key;
      await prepareTicket(job.id); chapterMarkup();
    } catch(error) { if (state.selected === job.id && $('#chapter-list')) { $('#chapter-list').textContent = error.message; chapterKey = ''; } }
    finally { chapterLoading = false; }
  }
  function playChapter(index) {
    if (playingChapter === index) { stopChapter(); return; }
    if (!playbackURL || chapterJob !== state.selected) return;
    if (Date.now() >= ticketExpiry) { prepareTicket(chapterJob).then(() => { chapterMarkup(); formMessage('#chapter-message','Player refreshed. Tap the chapter again.'); }).catch(error => formMessage('#chapter-message',error.message,true)); return; }
    const chapter = chapterData[index]; if (!chapter) return;
    const generation = ++playGeneration;
    playingChapter = index; pendingSeek = chapter.start_seconds;
    if (player.getAttribute('src') !== playbackURL) player.src = playbackURL;
    if (player.readyState >= 1) { player.currentTime = pendingSeek; pendingSeek = null; }
    player.play().then(() => { if (generation === playGeneration) formMessage('#chapter-message', `Playing: ${chapter.title || 'Untitled segment'}`); }).catch(error => { if (generation !== playGeneration) return; stopChapter(); formMessage('#chapter-message', `Cannot play audio: ${error.message}`, true); });
    updateChapterButtons();
  }
  player.addEventListener('loadedmetadata', () => { if (pendingSeek !== null) { player.currentTime = pendingSeek; pendingSeek = null; } });
  player.addEventListener('timeupdate', () => { if (playingChapter >= 0 && pendingSeek === null && player.currentTime >= chapterData[playingChapter].end_seconds) stopChapter(); });
  player.addEventListener('ended', stopChapter);
  player.addEventListener('error', () => { if (playingChapter >= 0) { stopChapter(); formMessage('#chapter-message','Audio could not be loaded. Reopen the job to refresh playback.',true); } });
  setInterval(() => { if (chapterJob === state.selected && playbackURL && Date.now() > ticketExpiry - 60000) prepareTicket(chapterJob).catch(() => {}); }, 30000);

  function formMessage(id, message, error = false) { const el = $(id); if (!el) return; el.textContent = message; el.classList.toggle('hidden', !message); el.classList.toggle('error', error); }
  let scannedPath = '', scannedBooks = [], selectedBooks = new Set(), scanningBooks = false;
  function selectionChanged() {
    $('#submit-button').disabled = !state.connected || !selectedBooks.size;
    $('#submit-button').textContent = `Start ${selectedBooks.size} selected ${selectedBooks.size === 1 ? 'book' : 'books'}`;
    const all = $('#select-all-books'); if (all) { all.checked = selectedBooks.size === scannedBooks.length; all.indeterminate = selectedBooks.size > 0 && selectedBooks.size < scannedBooks.length; }
    if ($('#selection-count')) $('#selection-count').textContent = `${selectedBooks.size} of ${scannedBooks.length} selected`;
  }
  function clearBookSelection() {
    scannedPath = ''; scannedBooks = []; selectedBooks.clear();
    $('#book-selection').innerHTML = ''; $('#book-selection').classList.add('hidden');
    $('#submit-button').textContent = 'Find audiobooks';
  }
  async function scanBooks() {
    if (scanningBooks) return;
    const path = $('#source-path').value.trim();
    if (!path) { formMessage('#submit-message', 'Choose a folder first.', true); return; }
    scanningBooks = true; $('#scan-books').disabled = true; $('#submit-button').disabled = true;
    formMessage('#submit-message', 'Finding audiobooks…'); clearBookSelection();
    try {
      const data = await api('/api/discover', {method:'POST', body:JSON.stringify({path})});
      if ($('#source-path').value.trim() !== path) return;
      scannedPath = path; scannedBooks = data.books || []; selectedBooks = new Set(scannedBooks.map(book => book.path));
      const box = $('#book-selection'); box.classList.remove('hidden');
      box.innerHTML = `<div class="selection-heading"><h2>Choose audiobooks</h2><span id="selection-count" class="subtle"></span></div>${scannedBooks.length ? `<label class="book-option select-all"><input id="select-all-books" type="checkbox" checked><span>Select all</span></label><div class="book-options">${scannedBooks.map((book,index) => `<label class="book-option"><input type="checkbox" data-book-index="${index}" checked><span><strong>${safe(book.name)}</strong><small>${safe(book.path)}</small><small>${book.kind === 'm4b' ? 'Review existing M4B' : 'Convert MP3 folder'}</small></span></label>`).join('')}</div>` : '<p class="subtle">No eligible audiobooks found in this folder.</p>'}`;
      formMessage('#submit-message', data.issues?.length ? `${data.issues.length} layout issue(s): ${data.issues.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' · ')}` : 'Choose the books to process, then start the selected books.');
      selectionChanged();
    } catch(error) { formMessage('#submit-message',error.message,true); }
    finally { scanningBooks = false; $('#scan-books').disabled = false; $('#submit-button').disabled = !state.connected || (scannedPath && !selectedBooks.size); }
  }
  async function submitJob(event) {
    event.preventDefault(); const form = event.currentTarget; const button = $('#submit-button'); const path = $('#source-path').value.trim();
    if (!state.connected || !navigator.onLine) { formMessage('#submit-message', 'Connect to the server before starting a job.', true); return; }
    if (!path) { formMessage('#submit-message', 'Choose or enter a source folder.', true); $('#source-path').focus(); return; }
    if (scannedPath !== path) { await scanBooks(); return; }
    if (!selectedBooks.size) { formMessage('#submit-message','Select at least one audiobook.',true); return; }
    button.disabled = true; button.textContent = 'Starting…'; formMessage('#submit-message', '');
    try {
      const data = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ path, selected_paths: [...selectedBooks], keep_mp3s: form.elements.keep_mp3s.checked, verify_all: form.elements.verify_all.checked, force: form.elements.force.checked }) });
      const created = data.job || (Array.isArray(data.jobs) ? data.jobs[0] : null);
      formMessage('#submit-message', data.issues?.length ? `${data.jobs?.length || 0} jobs queued. ${data.issues.length} source issue(s) need review.` : 'Job queued. Opening its details…');
      await refresh();
      if (created?.id) location.hash = `#job/${encodeURIComponent(created.id)}`;
      else location.hash = '#jobs';
    } catch (error) { formMessage('#submit-message', error.message, true); }
    finally { selectionChanged(); }
  }

  async function jobAction(action) {
    const id = state.selected; if (!id) return;
    if (!state.connected || !navigator.onLine) { alert('Connect to the server before changing a job.'); return; }
    const button = $(`[data-action="${action}"]`); if (button) button.disabled = true;
    try { await api(`/api/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); await refresh(); await loadDetail(id); }
    catch (error) { alert(error.message); if (button) button.disabled = false; }
  }
  async function submitReview(event) {
    event.preventDefault(); const form = event.target; const id = form.dataset.jobId;
    if (!state.connected || !navigator.onLine) { formMessage('#review-message', 'Connect to the server before submitting details.', true); return; }
    const values = Object.fromEntries(new FormData(form));
    values.recovery = event.submitter?.value === 'local_markers' ? 'local_markers' : 'verify';
    const button = event.submitter || $('button[type="submit"]', form); button.disabled = true;
    formMessage('#review-message', 'Submitting details…');
    try { await api(`/api/jobs/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(values) }); formMessage('#review-message', 'Details submitted. Verification will resume.'); await refresh(); await loadDetail(id); }
    catch (error) { formMessage('#review-message', error.message, true); button.disabled = false; }
  }

  async function browse(path = null) {
    state.browsePath = path; const list = $('#browse-list'); list.innerHTML = '<div class="loading-state">Loading folders…</div>'; formMessage('#browse-error', '');
    $('#browse-current').textContent = path || 'Library roots'; $('#browse-select').disabled = !path;
    try {
      const data = await api(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      state.browsePath = data.path || path; state.browseRoots = data.roots || [];
      $('#browse-current').textContent = state.browsePath || 'Library roots'; $('#browse-select').disabled = !state.browsePath;
      const entries = (data.entries || []).filter(x => ['directory', 'dir', 'folder'].includes(String(x.type).toLowerCase()) || x.is_dir === true);
      const roots = !state.browsePath && !entries.length ? (data.roots || []).map(x => typeof x === 'string' ? { name: shortPath(x), path: x } : x) : [];
      const folders = [...roots, ...entries];
      list.innerHTML = folders.length ? folders.map(x => `<button type="button" class="browse-entry" data-browse-path="${safe(x.path)}"><span aria-hidden="true">▰</span><span><strong>${safe(x.name || shortPath(x.path))}</strong><small>${safe(x.path)}</small></span><span aria-hidden="true">→</span></button>`).join('') : '<div class="empty-state compact"><strong>No subfolders</strong><p>You can select this folder or go back.</p></div>';
    } catch (error) { list.innerHTML = ''; formMessage('#browse-error', error.message, true); }
  }
  async function openAudio(event) {
    const link = event.target.closest('[data-audio-link]'); if (!link || !token()) return;
    event.preventDefault(); const original = link.textContent; link.textContent = 'Loading excerpt…';
    try {
      const response = await fetch(link.href, { headers: { Authorization: `Bearer ${token()}` } });
      if (!response.ok) throw new Error(`Audio unavailable (${response.status}).`);
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.className = 'inline-audio';
      audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
      link.replaceWith(audio); audio.play().catch(() => {});
    } catch (error) { link.textContent = original; alert(error.message); }
  }

  function bind() {
    document.addEventListener('submit', async event => {
      const form=event.target;
      if (!['accept-recovery-form','recovery-settings-form'].includes(form.id)) return;
      event.preventDefault();
      const button=form.querySelector('button[type=submit]');button.disabled=true;
      const values=new FormData(form);
      const message=form.querySelector('[role=status]');
      try {
        if(form.id==='recovery-settings-form') {
          state.settings=await api('/api/settings/recovery',{method:'PUT',body:JSON.stringify({recovery_minimum_percent:Number(values.get('minimum'))})});
          message.textContent='Recovery default saved.';
        } else {
          const body={draft_token:form.dataset.draftToken,minimum_percent:Number(values.get('minimum')),optional_sections:values.getAll('optional_section'),preserve_unresolved:values.has('preserve'),accept_possible_gap:values.has('gap')};
          await api(`/api/jobs/${encodeURIComponent(state.selected)}/accept-recovery`,{method:'POST',body:JSON.stringify(body)});
          await refresh();await loadDetail(state.selected);
        }
      } catch(error) { message.textContent=error.message; }
      finally { button.disabled=false; }
    });
    window.addEventListener('hashchange', route);
    $('#refresh-button').addEventListener('click', () => refresh());
    $('#menu-toggle').addEventListener('click', () => { const open = $('.sidebar').classList.toggle('open'); $('#menu-toggle').setAttribute('aria-expanded', String(open)); });
    $('#job-search').addEventListener('input', event => { state.query = event.target.value; renderJobs(); });
    $$('.filter').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('.filter').forEach(x => { const active = x === button; x.classList.toggle('active', active); x.setAttribute('aria-pressed', String(active)); }); renderJobs(); }));
    document.addEventListener('click', event => {
      if (event.target.closest('[data-download-report]')) downloadReport();
      const filename = event.target.closest('[data-file-title]'); if (filename) { state.editionQuery = filename.dataset.fileTitle; state.editionResults = []; $('#edition-query').value = state.editionQuery; $('#edition-results').innerHTML = ''; formMessage('#edition-message', 'Filename filled in. Edit it if needed, then search.'); $('#edition-query').focus(); }
      const match = event.target.closest('[data-match-id]'); if (match) location.hash = `#job/${encodeURIComponent(match.dataset.matchId)}?match`;
      const chapter = event.target.closest('[data-chapter-index]'); if (chapter) playChapter(Number(chapter.dataset.chapterIndex));
      const job = event.target.closest('[data-job-id]:not(form)'); if (job) location.hash = `#job/${encodeURIComponent(job.dataset.jobId)}`;
      const action = event.target.closest('[data-action]'); if (action) jobAction(action.dataset.action);
      const folder = event.target.closest('[data-browse-path]'); if (folder) browse(folder.dataset.browsePath);
    });
    $('#detail-content').addEventListener('click', openAudio);
    $('#detail-content').addEventListener('click', async event => {
      const button = event.target.closest('[data-resume-checks]');
      if (!button) return;
      button.disabled = true;
      try { await api(`/api/jobs/${encodeURIComponent(state.selected)}/review`, {method:'POST',body:JSON.stringify({action:'resume'})}); await refresh(); await loadDetail(state.selected); }
      catch(error) { alert(error.message); button.disabled = false; }
    });
    $('#detail-content').addEventListener('submit', event => { if (event.target.id === 'review-form') submitReview(event); if (event.target.id === 'edition-search-form') searchEditions(event); });
    $('#detail-content').addEventListener('click', event => { const card = event.target.closest('[data-edition-index]'); if (card) selectEdition(Number(card.dataset.editionIndex)); });
    $('#detail-content').addEventListener('click', event => { if (event.target.id === 'detail-retry') loadDetail(state.selected); });
    $('#detail-back').addEventListener('click', () => { location.hash = '#jobs'; });
    $('#submit-form').addEventListener('submit', submitJob);
    $('#submit-button').textContent = 'Find audiobooks';
    $('#source-path').addEventListener('input', clearBookSelection);
    $('#scan-books').addEventListener('click', scanBooks);
    $('#book-selection').addEventListener('change', event => {
      if (event.target.id === 'select-all-books') {
        selectedBooks = event.target.checked ? new Set(scannedBooks.map(book => book.path)) : new Set();
        $$('[data-book-index]').forEach(box => { box.checked = event.target.checked; });
      } else if (event.target.matches('[data-book-index]')) {
        const path = scannedBooks[Number(event.target.dataset.bookIndex)].path;
        if (event.target.checked) selectedBooks.add(path); else selectedBooks.delete(path);
      }
      selectionChanged();
    });
    $('#browse-button').addEventListener('click', () => { $('#browse-dialog').showModal(); browse(); });
    $('#browse-close').addEventListener('click', () => $('#browse-dialog').close());
    $('#browse-up').addEventListener('click', () => { const path = state.browsePath; if (!path) return; const parent = path.replace(/\/$/, '').replace(/\/[^/]+$/, '') || '/'; browse(state.browseRoots.includes(path) || parent === path ? null : parent); });
    $('#browse-select').addEventListener('click', () => { if (!state.browsePath) return; $('#source-path').value = state.browsePath; $('#browse-dialog').close(); clearBookSelection(); scanBooks(); });
    $('#token-form').addEventListener('submit', event => { event.preventDefault(); const value = $('#api-token').value.trim(); if (value) localStorage.setItem(TOKEN_KEY, value); else localStorage.removeItem(TOKEN_KEY); formMessage('#token-message', value ? 'Token saved in this browser.' : 'Token cleared.'); refresh(true); loadSettings(); });
    $('#clear-token').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); $('#api-token').value = ''; formMessage('#token-message', 'Token cleared.'); refresh(true); loadSettings(); });
  }

  bind(); route(); if (token()) $('#api-token').value = token(); refresh(true); loadSettings();
  window.addEventListener('online', () => { updateOfflineUI(); refresh(true); });
  window.addEventListener('offline', updateOfflineUI);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
