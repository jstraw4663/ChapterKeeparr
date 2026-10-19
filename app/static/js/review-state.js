// Visibility is a preference; publication still requires the server's fingerprint checks.
export function acceptanceState(preview, form = {}, { connected = true, authNeeded = false } = {}) {
  const minimum = Number(form.min ?? preview?.default_minimum_percent);
  let problem = '';
  if (!preview?.ready || !preview.token) problem = 'Load a current, complete draft before saving.';
  else if (!Number.isFinite(minimum) || minimum < 1 || minimum > 100) problem = 'Enter a minimum between 1 and 100%.';
  else if (!Number.isFinite(preview.supported_percent) || preview.supported_percent + 1e-9 < minimum) problem = `${preview.supported_percent?.toFixed(1) ?? 'Unknown'}% identified; the selected minimum is ${minimum}%. Review the unresolved chapters before deciding.`;
  else if ((preview.sections || []).some(s => !(form.sections || []).includes(s.id))) problem = 'Confirm every section you accept as optional.';
  else if (preview.unresolved_markers?.length && !form.preserve) problem = 'Confirm that unidentified markers keep their names and times.';
  else if (!form.gap) problem = 'Confirm that you accept possible gaps or edition differences.';
  else if (!connected) problem = 'Reconnect to the server before saving.';
  else if (authNeeded) problem = 'Add the server’s access token in Settings before saving.';
  else if (form.busy) problem = 'Submitting your approval…';
  return { minimum, visible: Boolean(form.gap), enabled: !problem, problem };
}

export function draftApproval(preview, previous = {}) {
  return preview?.token && previous.token === preview.token ? previous : { token: preview?.token, message: previous.token ? 'The draft changed. Review it and confirm your choices again.' : previous.message || '' };
}
