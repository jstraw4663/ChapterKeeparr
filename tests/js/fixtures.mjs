// Test-only job records shaped like GET /api/jobs items. Never used by the app.

const gates = states => ['inspect', 'match', 'align', 'verify', 'save'].map((id, i) => ({ id, label: id, state: states[i] || 'waiting', detail: '' }));

let seq = 0;
export function job(overrides = {}) {
  seq += 1;
  const { report = {}, gateStates, ...rest } = overrides;
  return {
    id: `job${seq}`,
    path: `/library/Author/Book ${seq}`,
    status: 'complete',
    stage: 'complete',
    progress: 1,
    options: {},
    result: { report },
    review_answer: null,
    error: null,
    created_at: 1_700_000_000 + seq,
    updated_at: 1_700_000_000 + seq,
    cancel_requested: false,
    workflow: { gates: gates(gateStates || ['passed', 'passed', 'passed', 'passed', 'passed']), review_category: report.review_reason?.category || 'identity' },
    ...rest,
  };
}

export const edition = (title, extra = {}) => ({ edition: { title, authors: 'Matt Dinniman', narrators: 'Jeff Hays', asin: 'B0CDXWSS5D', ...extra } });
