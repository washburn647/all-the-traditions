import { db } from '../data.js';
import { albumLink, artistLink, esc, fmt, longDate, showLink, titleLink } from '../util.js';

const fold = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function find(names, q, sizeOf, limit = 40) {
  const out = [];
  names.forEach((name, i) => {
    const f = fold(name);
    const at = f.indexOf(q);
    if (at >= 0) out.push({ i, score: (at === 0 ? 2 : 0) + (f === q ? 4 : 0), n: sizeOf(i) });
  });
  return out.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, limit);
}

function block(title, hits, render) {
  if (!hits.length) return '';
  return `<div><h3>${title}</h3><ol class="rank">${hits.map(h =>
    `<li><span class="rank-name">${render(h.i)}</span><span class="rank-n">${fmt(h.n)}</span></li>`).join('')}</ol></div>`;
}

export function searchView(raw) {
  const query = (raw || '').trim();
  const q = fold(query);
  if (q.length < 2) {
    return { title: 'Search', html: '<section><h1>Search</h1><p class="muted">Type at least two letters in the search box above.</p></section>' };
  }
  const artists = find(db.artists, q, i => db.byArtist[i].length);
  const songs = find(db.titles, q, i => db.byTitle[i].length);
  const albums = find(db.albums.map(a => a.name), q, i => db.byAlbum[i].length);
  const shows = db.shows.filter(s => fold(longDate(s)).includes(q) || s.iso.includes(q)).slice(0, 40);

  const body = [
    block('Artists', artists, artistLink),
    block('Songs', songs, titleLink),
    block('Albums', albums, i => `${albumLink(i)} <span class="muted small">${esc(db.artists[db.albums[i].artist])}</span>`),
    shows.length ? `<div><h3>Shows</h3><ul class="plain">${shows.map(s => `<li>${showLink(s)}</li>`).join('')}</ul></div>` : '',
  ].filter(Boolean);

  return {
    title: `Search: ${query}`,
    html: `<section><h1>Results for “${esc(query)}”</h1>
      ${body.length ? `<div class="three-col">${body.join('')}</div>` : '<p class="muted">Nothing matched.</p>'}</section>`,
  };
}
