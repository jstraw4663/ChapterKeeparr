// Per-device preferences in localStorage. Theme, motion and notifications are
// device settings by design; server-wide preferences need GAPS G-023.

const KEY = 'chapterkeeparr.prefs.v1';
const TOKEN_KEY = 'chapterkeeparr.api_token'; // unchanged from the previous UI
const LOG_KEY = 'chapterkeeparr.activity.v1';

const DEFAULTS = {
  theme: 'system',            // system | light | dark
  reduceMotion: false,
  notifications: true,
  sidebarCollapsed: null,     // null → decided by window width
  library: { filter: 'all', group: null, sort: 'recent', view: 'grid', closed: {} },
  jobDefaults: { verify_all: false, keep_mp3s: false },
  recent: [],
};

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or quota: keep in memory */ }
}

let prefs = { ...DEFAULTS, ...read(KEY, {}) };
prefs.library = { ...DEFAULTS.library, ...(prefs.library || {}) };
prefs.jobDefaults = { ...DEFAULTS.jobDefaults, ...(prefs.jobDefaults || {}) };
const listeners = new Set();

export const getPrefs = () => prefs;
export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  write(KEY, prefs);
  listeners.forEach(fn => fn(prefs));
}
export const onPrefs = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function rememberRecent(id) {
  setPrefs({ recent: [id, ...prefs.recent.filter(x => x !== id)].slice(0, 6) });
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(value) {
  try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/** This device's own actions and notifications (GAPS G-010: no server event log yet). */
export const readLog = () => read(LOG_KEY, []);
export function appendLog(entry) {
  const log = [entry, ...readLog()].slice(0, 300);
  write(LOG_KEY, log);
  return log;
}
