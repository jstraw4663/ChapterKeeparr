// Settings (SCREENS.md → Settings). Changes save automatically.
// Device settings live in this browser; server-wide preferences need G-023.
// Build-only settings with a home here: access token (G-034), server readout
// (G-035) and the recovery acceptance minimum (G-036).

import { html, dash } from '../format.js';
import { icon } from '../icons.js';
import { api, needsServer } from '../api.js';
import { state, refresh, loadSettings } from '../store.js';
import { getPrefs, setPrefs, getToken, setToken } from '../prefs.js';
import { segmented, toggle, settingRow, selectField, REGIONS, gapNote } from '../ui.js';
import { notify } from '../notify.js';
import { ownAction } from '../events.js';
import { applyAppearance } from '../shell.js';

const SECTIONS = [['appearance', 'Appearance'], ['library', 'Library'], ['conversion', 'Conversion defaults'], ['metadata', 'Metadata'], ['bookorbit', 'BookOrbit'], ['notifications', 'Notifications'], ['server', 'Server']];
const local = { token: null, tokenMsg: '', minimum: null, minMsg: '', saving: false };

function section(id, title, rows, ctx) {
  if (ctx.phone) return html`<section id="set-${id}" class="col gap8" aria-labelledby="h-${id}"><h2 class="eyebrow" id="h-${id}" style="padding:0 4px">${title}</h2><div class="panel" style="padding:0 16px">${rows}</div></section>`;
  return html`<section id="set-${id}" class="panel" style="padding:6px 28px 10px;scroll-margin-top:24px" aria-labelledby="h-${id}"><h2 class="h3" id="h-${id}" style="padding:20px 0 6px">${title}</h2>${rows}</section>`;
}

function body(ctx) {
  const p = getPrefs();
  const s = state.settings;
  const st = ctx.phone;
  const connected = state.connected;
  const roots = s?.library_roots || [];
  const minimum = local.minimum ?? s?.recovery_minimum_percent ?? '';
  const tokenValue = local.token ?? getToken();
  const conn = connected === false ? ['dot-bad', 'Can’t reach server'] : connected ? ['dot-ok', 'Connected'] : ['dot-muted', 'Checking…'];
  const row = (label, desc, control) => settingRow({ label, desc, control, stack: st });

  return html`
  ${section('appearance', 'Appearance', html`
    ${row('Theme', 'System follows your device.', segmented({ label: 'Theme', options: [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], value: p.theme, act: 'theme' }))}
    ${row('Reduce motion', 'Swap slides and zooms for simple fades.', toggle({ label: 'Reduce motion', checked: p.reduceMotion, act: 'motion' }))}`, ctx)}
  ${section('library', 'Library', html`
    ${row('Library folder', 'Where your audiobooks live on the server. It’s set with LIBRARY_ROOTS when the container starts.', html`<span class="val mono">${roots.length ? roots.join(' · ') : s ? 'None configured' : '—'}</span>`)}`, ctx)}
  ${section('conversion', 'Conversion defaults', html`
    ${row('Chapter checks', 'Used for every new job on this device unless you change it there.', segmented({ label: 'Chapter checks', options: [['spot', 'Spot checks'], ['all', 'Every chapter']], value: p.jobDefaults.verify_all ? 'all' : 'spot', act: 'checks' }))}
    ${row('Keep source MP3s', 'Off deletes them after the M4B is verified.', toggle({ label: 'Keep source MP3s', checked: p.jobDefaults.keep_mp3s, act: 'keep' }))}
    ${row('Save to', 'Finished books are saved next to their source. Another location needs server support (G-039).', html`<span class="val">Next to source</span>`)}
    ${row('Minimum for accepted exceptions', 'When some chapters can’t be located, finalizing needs at least this share of markers identified. Each book still needs your explicit approval.', html`<div class="col gap4" style="align-items:flex-end"><div class="row gap8"><label for="set-min" class="sr">Minimum identified markers (%)</label><input id="set-min" class="input" type="number" min="1" max="100" step="0.1" inputmode="decimal" value="${minimum}" style="width:110px" ${connected === false ? 'disabled' : ''}><span class="meta">%</span></div>${local.minMsg ? html`<span class="meta" role="status">${local.minMsg}</span>` : ''}</div>`)}
    <p class="meta" style="padding:0 0 14px">Checks and MP3 defaults are saved on this device. Saving them on the server needs support (G-023).</p>`, ctx)}
  ${section('metadata', 'Metadata', html`
    ${row('Default region', 'Tried first when matching an edition.', html`<div style="width:${ctx.phone ? '100%' : '220px'}">${selectField({ id: 'set-region', label: 'Default region', options: REGIONS, value: 'us', disabled: true, extra: { title: needsServer('G-023') } })}</div>`)}
    ${row('Metadata provider', 'Source for editions and chapter timelines.', html`<span class="val">Libex search · Audnexus timelines</span>`)}`, ctx)}
  ${section('bookorbit', 'BookOrbit', html`
    ${row('BookOrbit address', 'Used for “Open in BookOrbit” and requests from Suggestions.', html`<input class="input" type="url" placeholder="https://your-bookorbit-address" disabled title="${needsServer('G-021')}" style="width:${ctx.phone ? '100%' : '300px'}" aria-label="BookOrbit address">`)}
    ${row('Connection', 'Checked when you save.', html`<span class="row" style="gap:8px;font-size:14px;font-weight:600"><span class="dot lg dot-muted"></span>Not set up</span>`)}
    ${gapNote('BookOrbit isn’t connected to ChapterKeeparr yet, so the address can’t be saved.', 'G-021')}`, ctx)}
  ${section('notifications', 'Notifications', html`
    ${row('Status notifications', 'Pop up briefly, then tuck into Queue or Needs review.', toggle({ label: 'Status notifications', checked: p.notifications, act: 'notif' }))}`, ctx)}
  ${section('server', 'Server', html`
    ${row('ChapterKeeparr server', 'This app is a front end for the service on your server.', html`<span class="row" style="gap:8px;font-size:14px;font-weight:600"><span class="dot lg ${conn[0]}"></span>${conn[1]}</span>`)}
    ${row('Version', 'Reported by the server.', html`<span class="val">— <span class="meta mono">(G-024)</span></span>`)}
    ${row('Access token', s?.auth_required ? 'This server requires a token. It’s stored in this browser and sent only to this server.' : 'Only needed if the server sets CHAPTERKEEPER_API_TOKEN. Stored in this browser.', html`<form class="col gap8" data-form="token" style="align-items:${ctx.phone ? 'stretch' : 'flex-end'}"><div class="row gap8"><label for="set-token" class="sr">Access token</label><input id="set-token" class="input" type="password" autocomplete="off" placeholder="Optional access token" value="${tokenValue}" style="width:${ctx.phone ? '100%' : '240px'}"><button type="submit" class="btn btn-md">Save</button></div>${local.tokenMsg ? html`<span class="meta" role="status">${local.tokenMsg}</span>` : ''}</form>`)}
    ${row('Workers', 'Books processed at the same time.', html`<span class="val">${dash(s?.workers)}</span>`)}
    ${row('CPU threads', 'Speech recognition threads per book.', html`<span class="val">${dash(s?.cpu_threads)}</span>`)}
    ${row('Cache budget', 'Retained conversions and transcripts.', html`<span class="val">${s?.work_cache_budget_gb != null ? `${s.work_cache_budget_gb} GB` : '—'}</span>`)}
    ${row('Work folder', '', html`<span class="val mono">${dash(s?.work_dir)}</span>`)}
    ${row('Config folder', '', html`<span class="val mono">${dash(s?.config_dir)}</span>`)}`, ctx)}`;
}

export default {
  title: 'Settings',
  topbar: false,
  detail: true,

  signature(ctx) {
    return [state.connected, JSON.stringify(state.settings), JSON.stringify(getPrefs()), JSON.stringify(local), ctx.route.section].join('|');
  },

  render(ctx) {
    const { phone, enter } = ctx;
    if (phone) {
      return html`<div class="back-head" style="padding:0 8px"><a class="textlink" href="#/" style="color:var(--ink);font-size:16px">${icon('chevronLeft', 22)}Back</a></div>
        <div class="page-inset col" style="gap:22px"><div class="col gap4" style="margin:0 4px"><h1 class="h1" tabindex="-1">Settings</h1><p class="meta">Changes save automatically.</p></div>${body(ctx)}</div>`;
    }
    const current = ctx.route.section || 'appearance';
    return html`<div class="page-head ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Settings</h1><p class="lede">Changes save automatically.</p></div>
      <div class="setgrid"><nav class="col ${enter ? 'rise' : ''}" aria-label="Settings sections" style="gap:2px;position:sticky;top:24px;animation-delay:.05s">${SECTIONS.map(([id, label]) => html`<a class="snav" href="#/settings/${id}" ${id === current ? html`aria-current="true"` : ''}>${label}</a>`)}</nav>
      <div class="col gap20 ${enter ? 'rise' : ''}" style="animation-delay:.1s">${body(ctx)}</div></div>`;
  },

  mount(root, ctx) {
    if (ctx.enter && ctx.route.section) requestAnimationFrame(() => document.getElementById(`set-${ctx.route.section}`)?.scrollIntoView({ block: 'start' }));
    const min = root.querySelector('#set-min');
    min?.addEventListener('change', async () => {
      const value = Number(min.value);
      if (!(value >= 1 && value <= 100)) { local.minMsg = 'Enter a percentage between 1 and 100.'; ctx.rerender(); return; }
      try {
        state.settings = await api.setRecoveryMinimum(value);
        local.minimum = null; local.minMsg = 'Saved.';
      } catch (error) { local.minMsg = error.message; }
      ctx.rerender();
    });
  },

  onInput(el) {
    if (el.id === 'set-token') local.token = el.value;
    if (el.id === 'set-min') local.minimum = el.value;
  },

  onSubmit(form, ev, ctx) {
    if (form.dataset.form !== 'token') return;
    const value = (local.token ?? getToken()).trim();
    setToken(value);
    local.token = null;
    local.tokenMsg = value ? 'Token saved in this browser.' : 'Token cleared.';
    notify(ownAction(value ? 'Access token saved' : 'Access token cleared', 'Used for requests from this browser'));
    refresh(); loadSettings();
    ctx.rerender();
  },

  actions: {
    theme: (el, ev, ctx) => { setPrefs({ theme: el.dataset.arg }); applyAppearance(); ctx.rerender(); },
    motion: (el, ev, ctx) => { setPrefs({ reduceMotion: !getPrefs().reduceMotion }); applyAppearance(); ctx.rerender(); },
    notif: (el, ev, ctx) => { setPrefs({ notifications: !getPrefs().notifications }); ctx.rerender(); },
    checks: (el, ev, ctx) => { setPrefs({ jobDefaults: { ...getPrefs().jobDefaults, verify_all: el.dataset.arg === 'all' } }); ctx.rerender(); },
    keep: (el, ev, ctx) => { setPrefs({ jobDefaults: { ...getPrefs().jobDefaults, keep_mp3s: !getPrefs().jobDefaults.keep_mp3s } }); ctx.rerender(); },
  },
};
