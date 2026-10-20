import { reviewModel, markerDecisions, remainingSections } from './chapter-review.js';

// Visibility is a preference; publication still requires the server's fingerprint checks.
export function acceptanceState(preview, form = {}, { connected = true, authNeeded = false } = {}) {
  const minimum = Number(form.min ?? preview?.default_minimum_percent);
  let problem = '';
  if (!preview?.ready || !preview.token) problem = 'Load a current, complete draft before saving.';
  else if (!Number.isFinite(minimum) || minimum < 1 || minimum > 100) problem = 'Enter a minimum between 1 and 100%.';
  else if (!Number.isFinite(preview.supported_percent) || preview.supported_percent + 1e-9 < minimum) problem = `${preview.supported_percent?.toFixed(1) ?? 'Unknown'}% identified; the selected minimum is ${minimum}%. Review the unresolved chapters before deciding.`;
  else if (Array.isArray(preview.markers)) problem = chapterProblem(preview, form);
  else if ((preview.sections || []).some(s => !(form.sections || []).includes(s.id))) problem = 'Confirm every section you accept as optional.';
  else if (preview.unresolved_markers?.length && !form.preserve) problem = 'Confirm that unidentified markers keep their names and times.';
  if (!problem && !form.gap) problem = 'Confirm that you accept possible gaps or edition differences.';
  else if (!problem && !connected) problem = 'Reconnect to the server before saving.';
  else if (!problem && authNeeded) problem = 'Add the server’s access token in Settings before saving.';
  else if (!problem && form.busy) problem = 'Submitting your approval…';
  if (!problem && form.closing) problem = 'Finishing your decision…';
  return { minimum, visible: Boolean(form.gap), enabled: !problem, problem };
}

export function draftApproval(preview, previous = {}) {
  return preview?.token && previous.token === preview.token ? previous : { token: preview?.token, message: previous.token ? 'The draft changed. Review it and confirm your choices again.' : previous.message || '' };
}

function chapterProblem(preview, form) {
  if (form.token !== preview.token) return 'The draft changed. Review it and confirm your choices again.';
  const model = reviewModel(preview, form);
  if (model.confirmed < 1) return 'At least one marker must be confirmed by audio.';
  if (model.need) return `${model.need} left to decide`;
  const decisions = markerDecisions(preview, form);
  const ranks = new Map((preview.published_sections || preview.sections).map((s, i) => [s.id, i]));
  const used = new Set(), retained = [];
  for (const decision of decisions) {
    if (decision.action === 'published') {
      if (!ranks.has(decision.section_id)) return 'Choose a published section from the current draft.';
    } else if (decision.action === 'rename' && (!decision.title?.trim() || decision.title.trim().length > 200 || /[\x00-\x1f]/.test(decision.title))) return 'Enter a chapter name of 1–200 characters without control characters.';
    else if (decision.action === 'remove' && (decision.index === 1 || decision.confirmed !== true)) return 'Confirm each removal; the first marker must remain.';
    if (decision.action === 'remove') continue;
    const id = decision.action === 'published' ? decision.section_id : preview.markers.find(m => m.index === decision.index)?.reference_id;
    if (id == null) continue;
    if (used.has(id)) return 'A published section cannot be assigned to two retained markers.';
    const rank = ranks.get(id), override = decision.action === 'published' && decision.override_order === true;
    // Match the server: either member of an inverted pair can carry the
    // explicit manual override. Other pairs must still retain their order.
    if (retained.some(other => other.rank > rank && !other.override && !override)) return 'Outside the surrounding chapter order';
    used.add(id); retained.push({ rank, override });
  }
  if (remainingSections(preview, form).some(s => !form.sections?.includes(s.id))) return 'Decide whether to assign or save without each unmatched section.';
  return '';
}
