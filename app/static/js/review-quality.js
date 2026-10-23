// Live preview of server review_quality.assess; the server recomputes at Save.
const identityOf = (title, policy) => {
  const known = policy.identities?.[String(title).trim().toLowerCase()];
  if (known) return known;
  const match = /^chapter\s+([0-9]+)(?![\d.])\b/i.exec(String(title).trim());
  return { number: match ? Number(match[1]) : null, scope: '' };
};

export function assessMatches(p, form = {}) {
  const policy = p.quality_policy || {}, sections = p.published_sections || p.sections || [];
  const byId = new Map(sections.map(s => [s.id, s])), ranks = new Map(sections.map((s,i) => [s.id,i]));
  const edits = form.decisions || {}, rows = [];
  let scope = '';
  for (const m of p.markers || []) {
    const d = edits[m.index] || { action: m.supported ? 'suggested' : 'keep' };
    if (d.action === 'remove' || (!m.supported && !edits[m.index])) continue;
    const id = d.action === 'published' ? d.section_id : m.reference_id;
    const section = byId.get(id) || {};
    const title = d.action === 'rename' ? d.title || '' : d.action === 'keep' ? m.title : section.title || m.suggested_title || m.title;
    const parsed = identityOf(title, policy);
    scope = section.scope || parsed.scope || scope;
    rows.push({ index:m.index, id, rank:ranks.get(id), title, number:parsed.number, scope, override:d.override_order === true });
  }
  const warnings = [], seenIds = new Map(), seenNumbers = new Map(), highestNumber = new Map();
  let highest = null;
  const warn = (kind, indexes, message) => warnings.push({kind, indexes:[...new Set(indexes)].sort((a,b)=>a-b), message});
  for (const row of rows) {
    const {index:i,id,number:n,scope} = row;
    if (seenIds.has(id)) warn('duplicate',[seenIds.get(id),i],'The same published chapter is assigned more than once.');
    if (id != null) seenIds.set(id,i);
    if (row.rank != null) {
      if (highest && row.rank < highest.rank) warn('out_of_order',[highest.index,i],`${row.title} appears before an earlier chapter in the published order.`);
      if (!highest || row.rank > highest.rank) highest = row;
    }
    if (n != null) {
      const key = JSON.stringify([scope,n]);
      if (seenNumbers.has(key)) warn('duplicate_number',[seenNumbers.get(key),i],`Chapter ${n} is repeated within the same part.`);
      seenNumbers.set(key,i);
      const prior = highestNumber.get(scope);
      if (prior && n < prior.number && !warnings.some(w=>w.kind==='out_of_order' && w.indexes.includes(i))) warn('out_of_order',[prior.index,i],`Chapter ${n} follows Chapter ${prior.number} in this part.`);
      if (!prior || n > prior.number) highestNumber.set(scope,row);
      const expected = byId.get(id)?.number;
      if (expected != null && expected !== n) warn('title_conflict',[i],`The chosen title says Chapter ${n}, but the matched section is Chapter ${expected}.`);
    }
  }
  const ranked = rows.filter(r=>r.rank != null);
  const used = new Set(rows.map(r=>r.id));
  if (ranked.length) {
    const lo = Math.min(...ranked.map(r=>r.rank)), hi = Math.max(...ranked.map(r=>r.rank));
    sections.forEach((s,rank)=>{
      if (lo<rank && rank<hi && !used.has(s.id) && s.number != null) {
        const target = ranked.find(r=>r.rank>rank) || ranked.at(-1);
        warn('unassigned_chapter',[target.index],`${s.title} has no assigned marker between matched chapters. Its audio may still be inside another chapter.`);
      }
    });
  }
  for (const section of sections) {
    const n = section.number, scope = section.scope || '';
    const numbered = rows.filter(r=>r.number != null && r.scope===scope);
    if (n == null || !numbered.length || seenNumbers.has(JSON.stringify([scope,n])) || used.has(section.id)) continue;
    if (Math.min(...numbered.map(r=>r.number))<n && n<Math.max(...numbered.map(r=>r.number))
      && !warnings.some(w=>w.kind==='unassigned_chapter' && w.message.startsWith(section.title+' has '))) {
      const target=numbered.find(r=>r.number>n);
      warn('unassigned_chapter',[target.index],`${section.title} has no assigned marker between matched chapters. Its audio may still be inside another chapter.`);
    }
  }
  const invalid = new Set(warnings.filter(w=>w.kind!=='unassigned_chapter').flatMap(w=>w.indexes));
  const retainedAudio = (p.markers || []).filter(m=>m.supported && !['remove','published'].includes(edits[m.index]?.action)).length
    + (p.markers || []).filter(m=>m.supported && edits[m.index]?.action==='published' && edits[m.index].section_id===m.reference_id).length;
  const qualified = (p.markers || []).filter(m=>!m.supported && edits[m.index]?.action==='published' && !edits[m.index].override_order
    && m.eligible_reference_ids?.includes(edits[m.index].section_id) && !invalid.has(m.index) && retainedAudio >= (policy.minimum_audio_anchors ?? 6)).map(m=>m.index);
  const original = p.supported ?? (p.markers || []).filter(m=>m.supported).length;
  return { policy_version:policy.version ?? null, validated_count:original+qualified.length, validated_percent: p.quality_policy ? 100*(original+qualified.length)/Math.max(1,p.markers.length) : p.supported_percent,
    audio_count:original, selected_count:qualified.length, qualified_indexes:qualified, warnings };
}
