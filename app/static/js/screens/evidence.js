// Chapter-check evidence shared by Needs review and Book: check rows, the
// where-in-the-book timeline, the five server gates with evidence grades
// (GAPS G-031) and the alignment diagnostics (G-032).

import { html, clock, bool } from '../format.js';
import { reportOf } from '../status.js';
import { spotButton, ldot, button, segmented } from '../ui.js';
import { chapterTimeline } from '../chapter-review.js';
import * as audio from '../audio.js';

/** Checks from the latest verification, or the local-marker recovery draft. */
export function checksOf(job, { preview, form = {} } = {}) {
  const report = reportOf(job);
  const draft = report.recovery_draft;
  if (draft?.markers?.length && (!report.recovery_acceptance || job.status === 'awaiting_review')) {
    const p = preview || { markers: draft.markers.map((m, i) => ({ index: i+1, title: m.old_title,
      suggested_title: m.title, seconds: m.old_seconds, supported: m.status === 'supported',
      reference_id: m.status === 'supported' ? String(m.reference_start) : null,
      transcript: m.transcript, excerpt: m.audio_excerpt, reason: m.reason })),
      published_sections: (draft.reference_chapters || []).map(c => ({ id: String(c.start), title: c.title })) };
    return chapterTimeline(p, form);
  }
  if (Array.isArray(report.checks) && report.checks.length) {
    return report.checks.map((c, i) => ({ n: i + 1, name: c.title || `Chapter check ${i + 1}`, seconds: c.boundary_seconds, passed: c.passed === true,
      pending: c.passed == null, transcript: typeof c.transcript === 'string' ? c.transcript : c.transcript ? JSON.stringify(c.transcript) : '', excerpt: c.audio_excerpt || null, reason: c.reason || '' }));
  }
  if (draft?.markers?.length) {
    return draft.markers.map((m, i) => ({ n: i + 1, name: m.title || m.old_title || `Marker ${i + 1}`, seconds: m.old_seconds, passed: m.status === 'supported',
      pending: false, transcript: m.transcript || '', excerpt: m.audio_excerpt || null, reason: m.reason || '', draft: true }));
  }
  return [];
}

export function durationOf(job, sourceSeconds) {
  const report = reportOf(job);
  const diag = (report.alignment_attempts || []).find(a => a.diagnostics?.local_duration_seconds)?.diagnostics;
  return sourceSeconds || diag?.local_duration_seconds || report.edition?.runtime_seconds || null;
}

/** Dots along the book where each check falls. */
export function checkTimeline(rows, duration, { small = false, label = 'Where each check falls in the book' } = {}) {
  const max = duration || Math.max(1, ...rows.map(r => Number(r.seconds) || 0)) * 1.04;
  return html`<div class="timeline ${small ? 'sm' : ''}" role="img" aria-label="${label}"><div class="rail-line"></div>${rows.map((r, i) => {
    const left = Math.max(0, Math.min(100, ((Number(r.seconds) || 0) / max) * 100));
    return html`<span class="pt tick ${r.passed ? 'pass' : 'fail'}" style="left:${left.toFixed(2)}%;animation-delay:${(0.3 + i * 0.06).toFixed(2)}s"></span>`;
  })}</div>`;
}

/** Rows with spot-check buttons; expanding a row shows what was heard. */
export function checkRows(job, rows, ctx) {
  const now = audio.current();
  if (rows[0]?.original != null) {
    const filter = ctx.ui.checkFilter || 'all';
    const visible = rows.filter(r => filter === 'changed' ? r.changed : filter === 'attention' ? r.needsAttention : true);
    const limit = ctx.ui.checkLimit || 50;
    return html`<div class="col gap12">
      <div class="check-filters">${segmented({ label: 'Filter chapter timeline', options: [['all', 'All'], ['attention', 'Needs attention'], ['changed', 'Changed']], value: filter, act: 'chapter-filter' })}</div>
      <p class="meta">Existing and planned titles in file-time order. Planned changes are saved only after your approval.</p>
      ${visible.slice(0, limit).map(r => {
        const open = ctx.ui.check === r.n;
        const label = r.manual ? 'Your decision' : r.conflict ? 'Conflicting match' : r.passed ? 'Audio match' : 'Not confirmed';
        return html`<div class="checkrow" data-check-row="${r.n}"><div class="row gap8">
          <button type="button" class="crow check-compare" data-act="check-open" data-arg="${r.n}" aria-expanded="${bool(open)}">
            <span class="meta tabular">${r.seconds != null ? clock(r.seconds) : '—'}</span>
            <span class="col gap4 check-title"><span class="meta">Existing</span><strong>${r.original}</strong></span>
            <span class="col gap4 check-title"><span class="meta">Planned</span><strong>${r.planned}</strong></span>
            <span class="pill sm ${r.conflict || r.needsAttention ? 'tone-warn' : r.passed ? 'tone-ok' : 'tone-muted'}">${label}</span>
          </button>
          <div class="col gap8 check-actions">${spotButton({ playing: now?.key === `chk:${job.id}:${r.n}`, label: `${r.name} at ${clock(r.seconds)}`, act: 'check-play', arg: r.n, cls: 'playbtn', disabled: !r.excerpt, disabledReason: 'No saved audio for this check' })}
          ${ctx.editMatches ? button({ label: 'Change', act: 'cr-edit-match', arg: `m${r.n}`, size: 'sm', disabled: ctx.reviewBusy, extra: { 'aria-label': `Change match at ${clock(r.seconds)}` } }) : ''}</div>
        </div>${open ? html`<p class="opened transcript">${r.transcript || 'No transcript was saved for this check.'}${r.reason ? html` · ${r.reason}` : ''}</p>` : ''}</div>`;
      })}
      ${!visible.length ? html`<p class="meta">No chapters match this filter.</p>` : ''}
      ${visible.length > limit ? button({ label: `Show more chapters (${visible.length-limit} left)`, act: 'chapter-check-more' }) : ''}
    </div>`;
  }
  return html`<div class="col" style="border-top:1px solid var(--line)">${rows.map(r => {
    const key = `chk:${job.id}:${r.n}`;
    const open = ctx.ui.check === r.n;
    const label = r.pending ? 'Pending' : r.passed ? (r.draft ? 'Heard' : 'Passed') : 'Listen';
    const tone = r.pending ? 'tone-muted' : r.passed ? 'tone-ok' : 'tone-warn';
    const play = spotButton({ playing: now?.key === key, label: r.name, act: 'check-play', arg: r.n, cls: 'playbtn', disabled: !r.excerpt, disabledReason: 'No saved audio for this check' });
    if (ctx.phone) {
      return html`<div class="checkrow"><div class="row gap12"><button type="button" class="grow" style="min-height:58px;padding:8px 0;border:0;background:transparent;text-align:left;display:flex;flex-direction:column;gap:3px" data-act="check-open" data-arg="${r.n}" aria-expanded="${bool(open)}"><span style="font-size:15px;font-weight:650">${r.name}</span><span class="meta tabular">${r.seconds != null ? clock(r.seconds) : '—'} · <span class="${r.passed ? 'ok-text' : r.pending ? '' : 'warn-text'}">${label}</span></span></button>${play}</div>${open ? html`<p class="opened meta" style="margin:0 0 12px;font-size:13px;line-height:1.5">${r.transcript || 'No transcript was saved for this check.'}${r.reason ? html` · ${r.reason}` : ''}</p>` : ''}</div>`;
    }
    return html`<div class="checkrow"><div class="row gap12"><button type="button" class="crow" data-act="check-open" data-arg="${r.n}" aria-expanded="${bool(open)}"><span class="meta tabular">${r.n}</span><span style="font-weight:650" class="ell">${r.name}</span><span class="meta tabular">${r.seconds != null ? clock(r.seconds) : '—'}</span><span class="pill sm ${tone}" style="justify-self:start">${label}</span></button>${play}</div>${open ? html`<p class="opened transcript">${r.transcript ? html`“${r.transcript}”` : 'No transcript was saved for this check.'}${r.reason ? html` · ${r.reason}` : ''}</p>` : ''}</div>`;
  })}</div>`;
}

export async function playCheck(job, n, rows) {
  const r = rows.find(x => x.n === Number(n));
  if (!r?.excerpt) return;
  await audio.playExcerpt({ key: `chk:${job.id}:${r.n}`, jobId: job.id, label: r.name, excerpt: r.excerpt });
}

const GRADE_WORDS = { compatible: 'Compatible', passed: 'Passed', sampled: 'Sampled checks', all_numbered: 'All numbered chapters', no_known_gaps: 'No known gaps', suspected_gap: 'Possible gap', accepted_exceptions: 'Accepted exceptions', unresolved: 'Unresolved', unknown: 'Not checked' };
const STATE_KIND = { passed: 'ok', review: 'warn', blocked: 'bad', working: 'play', waiting: 'info', skipped: 'info' };

/** The server's five gates and five evidence grades, in plain words (G-031). */
export function gatesDetail(job) {
  const w = job.workflow;
  if (!w?.gates?.length) return '';
  const grades = Object.entries(w.assessment || {});
  return html`<div class="col gap8"><p class="meta">The server checks five things before saving. Grades describe what was checked; they aren’t probabilities.</p>
    <ol class="hist">${w.gates.map(g => html`<li>${ldot(STATE_KIND[g.state] || 'info')}<div class="col gap4"><span class="t">${g.label} · <span class="muted" style="font-weight:500">${g.state}</span></span>${g.detail ? html`<span class="d">${g.detail}</span>` : ''}</div></li>`)}</ol>
    ${grades.length ? html`<dl class="kv" style="margin-top:6px">${grades.map(([k, v]) => html`<dt style="text-transform:capitalize">${k}</dt><dd>${GRADE_WORDS[v.level] || String(v.level).replaceAll('_', ' ')}<br><span class="meta" style="font-weight:400">${v.detail}</span></dd>`)}</dl>` : ''}</div>`;
}

/** Local minus nearest published boundary across the recording (from the old UI, now on tokens). */
export function alignmentPlot(d) {
  const pairs = d?.nearest_candidates || [];
  if (!pairs.length) return '';
  const maxX = Math.max(1, Number(d.local_duration_seconds) || 1);
  const maxY = Math.max(0.35, ...pairs.map(p => Math.abs(p.difference)));
  return html`<figure class="plot"><svg viewBox="0 0 600 160" role="img" aria-label="Local minus nearest published chapter time across the recording"><path d="M35 15V130H580M35 70H580" fill="none" stroke="currentColor" opacity=".35"/>${pairs.map(p => html`<circle cx="${(35 + 545 * p.local / maxX).toFixed(1)}" cy="${(70 - 50 * p.difference / maxY).toFixed(1)}" r="3" class="${p.matched ? 'pt-ok' : 'pt-warn'}"><title>${clock(p.local)}: ${Number(p.difference).toFixed(3)} s</title></circle>`)}<text x="35" y="152" font-size="12" fill="currentColor">0 min</text><text x="500" y="152" font-size="12" fill="currentColor">${(maxX / 60).toFixed(1)} min</text></svg>
    <figcaption class="meta">Green matched a published chapter; amber didn’t. Range ±${maxY.toFixed(3)} s. A flat line alone isn’t verification.</figcaption></figure>`;
}

/** Everything technical about why a book paused: raw strings, attempts, diagnostics. */
export function technical(job) {
  const report = reportOf(job);
  const lines = [];
  if (report.review_reason?.detail) lines.push(report.review_reason.detail);
  if (report.reason && report.reason !== report.review_reason?.detail) lines.push(report.reason);
  if (job.error && !lines.includes(job.error)) lines.push(job.error);
  for (const f of report.lookup_failures || []) lines.push(`Lookup ${f.asin}: ${f.reason}`);
  for (const r of report.rejected_editions || []) lines.push(`Rejected ${r.asin}${r.region ? ` (${r.region})` : ''}: ${r.reason}`);
  for (const a of report.alignment_attempts || []) {
    const d = a.diagnostics || {};
    lines.push(`${a.asin} · ${String(a.region || '').toUpperCase()} · ${a.identity_compatible ? 'metadata compatible' : 'metadata mismatch'} · ${a.timing_passed ? 'timing compatible' : 'timing unresolved'}${d.usable_anchors ? ` · ${d.matching_boundaries || 0}/${d.usable_anchors} anchors` : ''}${a.reason ? ` · ${a.reason}` : ''}`);
  }
  for (const w of report.coverage_warnings || []) lines.push(`Coverage: ${w}`);
  lines.push(`Job ${job.id}`);
  return lines.join('\n');
}

export const bestDiagnostics = job => (reportOf(job).alignment_attempts || []).map(a => a.diagnostics).find(d => d?.nearest_candidates?.length) || null;
