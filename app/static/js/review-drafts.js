// Device-local edits only. A server draft token prevents applying edits to new evidence.
const memory = new Map();
const prefix = 'chapterkeeparr.review.v1.';
export function loadDraft(id) {
  if (memory.has(id)) return memory.get(id);
  try {
    const value = JSON.parse(localStorage.getItem(prefix + id));
    if (value && typeof value === 'object') { memory.set(id, value); return value; }
  } catch { /* Storage can be disabled; in-memory edits still survive navigation. */ }
  return null;
}
export function saveDraft(id, value) {
  const copy = JSON.parse(JSON.stringify(value));
  if (copy.accept) { delete copy.accept.busy; delete copy.accept.message; delete copy.accept.closing; }
  memory.set(id, copy);
  try { localStorage.setItem(prefix + id, JSON.stringify(copy)); return true; }
  catch { return false; }
}
export function clearDraft(id) {
  memory.delete(id);
  try { localStorage.removeItem(prefix + id); } catch { /* unavailable storage */ }
}
export function acceptedDraft(id, token) {
  const saved = loadDraft(id)?.accept;
  return saved?.token === token ? structuredClone(saved) : { token };
}

// Section IDs in the acceptance contract are the published start in seconds.
export const publishedSeconds = section => Number(section.seconds ?? section.id);
export function nearestUnassignedSections(preview, decisions, seconds) {
  const used = new Set(decisions.filter(d=>d.action!=='remove').map(d=>
    d.action==='published' ? d.section_id : preview.markers.find(m=>m.index===d.index)?.reference_id).filter(id=>id != null));
  return (preview.published_sections || preview.sections).filter(s=>!used.has(s.id))
    .map((s,order)=>({s,order,distance:Number.isFinite(publishedSeconds(s)) ? Math.abs(publishedSeconds(s)-seconds) : Infinity}))
    .sort((a,b)=>a.distance-b.distance || a.order-b.order).map(r=>r.s);
}

// A user-triggered convenience, not speech evidence or publication approval.
// Work from a single snapshot: applying one choice must not manufacture certainty
// for another by removing its competing candidate.
export function clearRecommendations(preview, decisions, edits = {}, allowed = () => true) {
  const unresolved = preview.markers.filter(m=>!m.supported && decisions.find(d=>d.index===m.index)?.action !== 'remove');
  const proposals = unresolved.filter(m=>!edits[m.index]).flatMap(m=>{
    const choices = nearestUnassignedSections(preview,decisions,m.seconds).filter(s=>allowed(m,s));
    const first = choices[0];
    if (!first) return [];
    const distance = Math.abs(publishedSeconds(first)-m.seconds);
    const next = choices[1] ? Math.abs(publishedSeconds(choices[1])-m.seconds) : Infinity;
    if (!Number.isFinite(distance) || distance>5 || next-distance<10) return [];
    // Competing local markers also make the timestamp correspondence ambiguous.
    if (unresolved.some(other=>other.index!==m.index && Math.abs(other.seconds-publishedSeconds(first))-distance<10)) return [];
    return [{index:m.index,action:'published',section_id:first.id}];
  });
  return proposals.filter(d=>proposals.filter(other=>other.section_id===d.section_id).length===1);
}
