// Spot-check preview bar (DESIGN.md §8 Book → Spot check): bottom-right on
// desktop, above the tab bar on phone. Stops by itself after 15 seconds.

import { html } from './format.js';
import { icon } from './icons.js';
import { clock } from './format.js';
import { SPOT_SECONDS } from './audio.js';

export function playerBar(now) {
  const canContinue = now.chapterEnd != null && !now.full && now.chapterEnd - now.from > SPOT_SECONDS;
  return html`<div class="player" role="region" aria-label="Chapter preview">
    <span class="eqwrap"><span class="eq" aria-hidden="true"><span></span><span></span><span></span></span></span>
    <div class="col gap4 grow"><span class="ell" style="font-size:14px;font-weight:700">Previewing ${now.label}</span><span class="meta" style="font-size:12px">${now.full ? `Playing to the chapter end (${clock(now.chapterEnd)})` : now.excerpt ? '15-second check from the saved excerpt' : `15-second check from ${clock(now.from)}`}</span></div>
    ${canContinue ? html`<button type="button" class="tbtn" data-act="player-full" title="Keeps the previous full-chapter playback until this is decided (G-048)">Play to chapter end</button>` : ''}
    <button type="button" class="icb bare" data-act="player-stop" aria-label="Stop preview">${icon('x', 20)}</button>
    ${now.full ? '' : html`<span class="progline"></span>`}
  </div>`;
}
