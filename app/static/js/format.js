// Escaping, HTML templating and value formatting. Pure; no DOM access.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

class Html {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
export const raw = value => new Html(String(value ?? ''));

const part = value => {
  if (value == null || value === false || value === true) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  return esc(value);
};

/** Tagged template: interpolated values are escaped unless they are html`` results or raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += part(value) + strings[i + 1]; });
  return new Html(out);
}

/** ARIA booleans: html`` drops true/false, so attribute values must be strings. */
export const bool = value => (value ? 'true' : 'false');

/** Unknown is always an em dash, never an invented value. */
export const dash = value => (value == null || value === '' || Number.isNaN(value) ? '—' : String(value));

export const toDate = value => {
  if (value == null || value === '') return null;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const toMillis = value => toDate(value)?.getTime() ?? 0;

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function timeOfDay(value) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d) : '—';
}

export function shortDate(value) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d) : '—';
}

/** "Just now", "4:02 PM", "Yesterday", "Sep 23". */
export function relative(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = now - d.getTime();
  if (diff >= 0 && diff < 60_000) return 'Just now';
  const today = new Date(now);
  if (sameDay(d, today)) return timeOfDay(d);
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return shortDate(d);
}

export function dayLabel(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return 'Earlier';
  if (sameDay(d, new Date(now))) return 'Today';
  if (sameDay(d, new Date(now - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(d);
}

export function clock(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  const pad = x => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function minutes(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n / 60).toLocaleString()} min`;
}

export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const folderName = path => String(path || '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
export const stripAudioExt = name => String(name || '').replace(/\.(m4b|m4a|mp3)$/i, '');

/** Sort key that ignores a leading article: "The Hound…" sorts under H. */
export const sortTitle = title => String(title || '').replace(/^(the|a|an)\s+/i, '').toLocaleLowerCase();
