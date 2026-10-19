// Documentation-only interactions. No API calls or audiobook mutations.
const icons={library:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',bulb:'<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9z"/>',queue:'<path d="M4 6h16M4 12h16M4 18h10"/>',inbox:'<path d="m4 4-2 12v4h20v-4L20 4zM2 16h6l2 3h4l2-3h6"/>',plus:'<path d="M12 4v16M4 12h16"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-11-3 3 3 3"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',left:'<path d="m14 5-7 7 7 7"/>',up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 10v7m4-7v7"/>',alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/>'};
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[e.dataset.icon]+'</svg>');
const params=new URLSearchParams(location.search);
let currentView=params.get('view')||'review';
const layout=document.getElementById('review-layout');
const railToggle=document.getElementById('rail-toggle');
function setRail(expanded){layout.classList.toggle('expanded',expanded);railToggle.setAttribute('aria-expanded',String(expanded));railToggle.setAttribute('aria-label',expanded?'Collapse book list':'Expand book list');}
function setView(view){currentView=view;document.body.classList.toggle('settings',view==='settings');document.getElementById('review-page').hidden=view!=='review';document.getElementById('settings-page').hidden=view!=='settings';document.getElementById('view-toggle').textContent=view==='settings'?'Review mockup':'Settings mockup';document.getElementById('nav-review').classList.toggle('selected',view==='review');document.getElementById('nav-settings').classList.toggle('selected',view==='settings');updateHeight();}
function setTheme(theme){document.documentElement.dataset.theme=theme;document.getElementById('theme-toggle').textContent=theme==='dark'?'Light theme':'Dark theme';}
const consent=document.getElementById('gap-consent');
function updateConsent(announce=true){document.getElementById('save-wrap').hidden=!consent.checked;document.getElementById('consent-hint').hidden=consent.checked;if(announce)document.getElementById('consent-status').textContent=consent.checked?'Save action shown. The selected minimum is still not met.':'Save action hidden.';updateHeight();}
function updateHeight(){requestAnimationFrame(()=>document.documentElement.style.setProperty('--acceptance-height',document.getElementById('acceptance').getBoundingClientRect().height+'px'));}
railToggle.addEventListener('click',()=>setRail(!layout.classList.contains('expanded')));
consent.addEventListener('change',()=>updateConsent());
document.getElementById('theme-toggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
document.getElementById('view-toggle').addEventListener('click',()=>setView(currentView==='settings'?'review':'settings'));
document.getElementById('nav-review').addEventListener('click',()=>setView('review'));
document.getElementById('mobile-review').addEventListener('click',()=>setView('review'));
document.getElementById('nav-settings').addEventListener('click',()=>setView('settings'));
document.getElementById('check-updates').addEventListener('click',()=>{document.getElementById('update-note').textContent='Design preview only. No update check was sent.';});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&layout.classList.contains('expanded')){setRail(false);railToggle.focus();}});
window.addEventListener('resize',updateHeight);
if(window.ResizeObserver)new ResizeObserver(updateHeight).observe(document.getElementById('acceptance'));
setTheme(params.get('theme')||'dark');setRail(params.get('rail')==='expanded');consent.checked=params.get('checked')==='1';updateConsent(false);setView(currentView);
