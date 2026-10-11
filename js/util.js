import { db } from './data.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const enc = encodeURIComponent;
export const fmt = n => n.toLocaleString('en-US');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = m => MONTH_NAMES[m - 1];

export function longDate(show) {
  return `${monthName(show.month)} ${show.day}, ${show.year}`;
}
export function shortDate(show) {
  return `${show.month}/${show.day}/${String(show.year).slice(2)}`;
}
export function clock(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}
export const plural = (n, word, many = word + 's') => `${fmt(n)} ${n === 1 ? word : many}`;

// --- links -------------------------------------------------------------
export const artistName = i => db.artists[i] || 'Unknown artist';

export function showLink(show, text = longDate(show)) {
  return `<a href="#/show/${show.iso}">${esc(text)}</a>`;
}
export function artistLink(i) {
  return `<a href="#/artist/${enc(db.artists[i])}">${esc(artistName(i))}</a>`;
}
export function titleLink(i) {
  return `<a href="#/song/${enc(db.titles[i])}">${esc(db.titles[i])}</a>`;
}
export function albumLink(i) {
  if (i < 0) return '<span class="muted">—</span>';
  const a = db.albums[i];
  return `<a href="#/album/${enc(db.artists[a.artist])}/${enc(a.name)}">${esc(a.name)}</a>`;
}
export function spotifySearch(p) {
  const q = [db.titles[p.title], db.artists[p.artist]].join(' ');
  return `https://open.spotify.com/search/${enc(q)}`;
}

// type: 'artists' | 'albums' | 'tracks' narrows Spotify's results tab.
export function spotifyButton(query, type) {
  return `<a class="button small" href="https://open.spotify.com/search/${enc(query)}/${type}" target="_blank" rel="noopener">Search Spotify ↗</a>`;
}

export function statTiles(items) {
  return `<div class="tiles">${items.map(([label, value]) =>
    `<div class="tile"><div class="tile-value">${value}</div><div class="tile-label">${esc(label)}</div></div>`).join('')}</div>`;
}

// A two-or-three column ranked list: [[html, count], ...]
export function rankList(rows, { limit = 15, unit = 'plays' } = {}) {
  if (!rows.length) return '<p class="muted">Nothing here.</p>';
  return `<ol class="rank">${rows.slice(0, limit).map(([html, n]) =>
    `<li><span class="rank-name">${html}</span><span class="rank-n" title="${fmt(n)} ${unit}">${fmt(n)}</span></li>`).join('')}</ol>`;
}

// Touch-first devices (phones, tablets): Spotify's web player doesn't run there,
// so "Send to Spotify" is the way to listen.
export const isPhone = () => matchMedia('(pointer: coarse)').matches;

export function randomShow() {
  return db.shows[Math.floor(Math.random() * db.shows.length)];
}
