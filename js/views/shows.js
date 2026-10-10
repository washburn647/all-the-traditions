import { db, showSongs } from '../data.js';
import { columnChart } from '../charts.js';
import { albumLink, artistLink, clock, esc, fmt, longDate, plural, spotifySearch, titleLink } from '../util.js';
import { holidayBadge, seasonList, showCards } from './common.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How many times this exact song (title + artist) was played across the archive.
function versionCount(p) {
  return db.byTitle[p.title].filter(q => q.artist === p.artist).length;
}

export function showView(iso) {
  const show = db.showByIso.get(iso);
  if (!show) return null;
  const songs = showSongs(show);
  const newer = db.shows[show.idx - 1], older = db.shows[show.idx + 1];
  const start = songs[0]?.min, end = songs.at(-1)?.min;

  const rows = songs.map(p => {
    const n = versionCount(p);
    const note = n === 1 ? '<span class="pill">only play</span>' : `<span class="muted small" title="Times this recording was played">×${n}</span>`;
    return `<tr>
      <td class="nowrap muted">${clock(p.min)}</td>
      <td>${titleLink(p.title)} ${note}</td>
      <td>${artistLink(p.artist)}</td>
      <td>${albumLink(p.album)}</td>
      <td><a class="ext" href="${spotifySearch(p)}" target="_blank" rel="noopener" title="Search Spotify">Spotify ↗</a></td>
    </tr>`;
  }).join('');

  const season = seasonList(show.month, show.day, { excludeIso: show.iso });
  return {
    title: longDate(show),
    html: `<nav class="pager">
      ${older ? `<a href="#/show/${older.iso}">← ${esc(longDate(older))}</a>` : '<span></span>'}
      <a class="button" href="#/random">Random show</a>
      ${newer ? `<a href="#/show/${newer.iso}">${esc(longDate(newer))} →</a>` : '<span></span>'}
    </nav>
    <section>
      <h1>${esc(longDate(show))} ${holidayBadge(show)}</h1>
      <p class="muted">${WEEKDAYS[show.date.getDay()]} · ${plural(songs.length, 'song')}${start !== undefined ? ` · ${clock(start)}–${clock(end)}` : ''}</p>
      <div class="table-wrap"><table class="plays show-table">
        <thead><tr><th>Aired</th><th>Song</th><th>Artist</th><th>Album</th><th><span class="sr-only">Links</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    <section>
      <h2>${season.holiday ? `${esc(season.holiday.name)} in other years` : 'This time of year, other years'}</h2>
      ${season.html}
    </section>`,
  };
}

export function showsView(arg) {
  const year = Number(arg) || db.years.at(-1);
  const shows = db.shows.filter(s => s.year === year);
  const perYear = db.years.map(y => ({ label: String(y), value: db.shows.filter(s => s.year === y).length }));
  return {
    title: `Shows · ${year}`,
    html: `<section>
      <h1>All shows</h1>
      ${columnChart(perYear, { title: 'Shows per year (click a year)', unit: 'shows', height: 150, onClick: d => { location.hash = `#/shows/${d.label}`; } })}
      <nav class="pills">${db.years.map(y => `<a class="pill-link${y === year ? ' on' : ''}" href="#/shows/${y}">${y}</a>`).join('')}</nav>
    </section>
    <section>
      <h2>${year} <span class="muted">· ${plural(shows.length, 'show')}, ${fmt(shows.reduce((n, s) => n + s.count, 0))} songs</span></h2>
      ${showCards(shows)}
    </section>`,
  };
}
