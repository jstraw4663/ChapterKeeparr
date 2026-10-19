// The only module that knows server endpoints (app/api.py). Anything the design
// needs that the server lacks is a typed stub returning notAvailable(G-xxx), so
// the backend only has to implement the call. See docs/design/GAPS.md.

import { getToken } from './prefs.js';

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; this.offline = status === 0; }
}

/** Result of a call the server can't make yet. */
export const notAvailable = (gap, message) => ({ available: false, gap, message });
export const needsServer = gap => `Needs server support (${gap})`;

async function request(path, { method = 'GET', body, raw = false } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError('Can’t reach the server.', 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const data = await response.json();
      const detail = data.detail ?? data.error ?? data.message;
      if (detail) message = typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch { /* plain-text error body */ }
    if (response.status === 401) message = 'Access denied. Add the server’s access token in Settings → Server.';
    throw new ApiError(message, response.status);
  }
  if (raw) return response;
  return response.status === 204 ? null : response.json();
}

const id = value => encodeURIComponent(value);

export const api = {
  health: () => request('/api/health'),
  settings: () => request('/api/settings'),
  updates: () => request('/api/updates'),
  setRecoveryMinimum: percent => request('/api/settings/recovery', { method: 'PUT', body: { recovery_minimum_percent: percent } }),

  listJobs: (limit = 1000) => request(`/api/jobs?limit=${limit}`).then(d => (Array.isArray(d) ? d : d?.jobs || [])),
  job: jobId => request(`/api/jobs/${id(jobId)}`),
  cancel: jobId => request(`/api/jobs/${id(jobId)}/cancel`, { method: 'POST' }),
  retry: jobId => request(`/api/jobs/${id(jobId)}/retry`, { method: 'POST' }),

  /** Correct details and resume: { asin?, title?, author?, narrator?, region?, recovery?: 'verify'|'local_markers' }. */
  answerReview: (jobId, answer) => request(`/api/jobs/${id(jobId)}/review`, { method: 'POST', body: answer }),
  resumeChecks: jobId => request(`/api/jobs/${id(jobId)}/review`, { method: 'POST', body: { action: 'resume' } }),
  acceptRecovery: (jobId, body) => request(`/api/jobs/${id(jobId)}/accept-recovery`, { method: 'POST', body }),
  editions: (query, region) => request(`/api/editions?query=${encodeURIComponent(query)}&region=${encodeURIComponent(region)}`),

  browse: path => request(`/api/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  discover: path => request('/api/discover', { method: 'POST', body: { path } }),
  submit: payload => request('/api/jobs', { method: 'POST', body: payload }),

  chapters: jobId => request(`/api/jobs/${id(jobId)}/chapters`),
  sourceInfo: jobId => request(`/api/jobs/${id(jobId)}/source-info`),
  mediaTicket: jobId => request(`/api/jobs/${id(jobId)}/media-token`, { method: 'POST' }),
  audioUrl: (jobId, ticket) => `/api/jobs/${id(jobId)}/audio?ticket=${encodeURIComponent(ticket)}`,
  report: jobId => request(`/api/jobs/${id(jobId)}/report`),

  async coverBlob(jobId) {
    const response = await request(`/api/jobs/${id(jobId)}/cover`, { raw: true });
    return response.blob();
  },
  /** Evidence files (check excerpts) live under the job's report folder. */
  async artifactBlob(jobId, relative) {
    const parts = String(relative || '').split('/').filter(Boolean);
    if (!parts.length || parts.some(p => p === '..' || p === '.')) throw new ApiError('Evidence file is unavailable.', 404);
    const response = await request(`/api/jobs/${id(jobId)}/artifacts/${parts.map(encodeURIComponent).join('/')}`, { raw: true });
    return response.blob();
  },

  // ---- Placeholders: the design needs these, the server doesn't provide them yet. ----

  // DESIGN-GAP: G-005 — converter output for failed jobs.
  jobLog: async () => notAvailable('G-005', 'Converter output isn’t available from the server yet.'),
  // DESIGN-GAP: G-015 — delete source MP3s for a verified book.
  cleanupSources: async () => notAvailable('G-015', 'Cleaning up source MP3s needs server support.'),
  // DESIGN-GAP: G-018 — edit title/author/narrators/series/ASIN/region and rewrite tags.
  updateDetails: async () => notAvailable('G-018', 'Editing details needs server support.'),
  // DESIGN-GAP: G-010 — global activity feed.
  activity: async () => notAvailable('G-010', 'A full activity log needs server support.'),
  // DESIGN-GAP: G-011 — per-book event history.
  history: async () => notAvailable('G-011', 'Full book history needs server support.'),
  // DESIGN-GAP: G-020 — suggestions scan results, ignore and pairing.
  ignoreSuggestion: async () => notAvailable('G-020', 'Ignoring a suggestion needs server support, so it will come back after the next scan.'),
  pairFiles: async () => notAvailable('G-020', 'Pairing files needs server support.'),
  // DESIGN-GAP: G-021 — BookOrbit address, deep links and requests.
  bookOrbitLink: () => notAvailable('G-021', 'Set a BookOrbit address in Settings.'),
  // DESIGN-GAP: G-022 — title/author guess from a folder.
  guessFromFolder: async () => notAvailable('G-022', 'Filling details from a folder needs server support.'),
  // DESIGN-GAP: G-023 — server-wide preferences (default region, BookOrbit address).
  savePreferences: async () => notAvailable('G-023', 'Saving this setting needs server support.'),
};
