// Pieces shared by several views.
import { db, showSongs } from '../data.js';
import { closestShows, showHoliday } from '../season.js';
import { artistLink, esc, longDate, plural, showLink } from '../util.js';

export function holidayBadge(show) {
  const h = showHoliday(show);
  return h ? `<span class="badge">${esc(h.name)}</span>` : '';
}

// The first few distinct artists of a show, as a one-line preview.
export function artistPreview(show, n = 4) {
  const seen = [];
  for (const p of showSongs(show)) {
    if (!seen.includes(p.artist)) seen.push(p.artist);
    if (seen.length === n) break;
  }
  return seen.map(a => esc(db.artists[a] || 'Unknown')).join(' · ');
}

export function showCard(show, note = '') {
  return `<li class="card">
    <div class="card-head">${showLink(show)} ${holidayBadge(show)}${note ? `<span class="muted small">${esc(note)}</span>` : ''}</div>
    <div class="card-sub">${plural(show.count, 'song')} — ${artistPreview(show)}</div>
  </li>`;
}

export function showCards(shows) {
  return `<ul class="cards">${shows.map(s => showCard(s)).join('')}</ul>`;
}

// One show per year, closest to month/day (holiday-aligned when relevant).
export function seasonList(month, day, { excludeIso } = {}) {
  const { holiday, matches } = closestShows(month, day);
  const rows = matches.filter(m => m.show.iso !== excludeIso).map(m => {
    // Holiday shows already carry a badge; only plain dates need the offset.
    const off = holiday || m.offset === 0 ? '' : `${Math.abs(m.offset)} day${Math.abs(m.offset) === 1 ? '' : 's'} ${m.offset < 0 ? 'before' : 'after'}`;
    return showCard(m.show, off);
  });
  return { holiday, html: `<ul class="cards">${rows.join('')}</ul>` };
}

export function playsTable(plays, { showDate = true, showArtist = true, showAlbum = true } = {}) {
  const head = [showDate && 'Show', 'Song', showArtist && 'Artist', showAlbum && 'Album'].filter(Boolean);
  return `<div class="table-wrap"><table class="plays"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${plays.map(p => {
      const show = db.shows[p.show];
      return `<tr>${showDate ? `<td class="nowrap">${showLink(show, `${show.month}/${show.day}/${show.year}`)}</td>` : ''}
        <td><a href="#/song/${encodeURIComponent(db.titles[p.title])}">${esc(db.titles[p.title])}</a></td>
        ${showArtist ? `<td>${artistLink(p.artist)}</td>` : ''}
        ${showAlbum ? `<td>${p.album >= 0 ? esc(db.albums[p.album].name) : ''}</td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>`;
}

// Long lists start collapsed after `n` rows.
export function collapsible(title, count, inner, open = false) {
  return `<details class="more"${open ? ' open' : ''}><summary>${esc(title)} <span class="muted">(${count})</span></summary>${inner}</details>`;
}

export function firstLast(plays) {
  const shows = plays.map(p => db.shows[p.show]);
  const first = shows.reduce((a, b) => (a.date < b.date ? a : b));
  const last = shows.reduce((a, b) => (a.date > b.date ? a : b));
  return { first, last, firstHtml: showLink(first, longDate(first)), lastHtml: showLink(last, longDate(last)) };
}
