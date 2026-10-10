import { db, showSongs } from '../data.js';
import { columnChart } from '../charts.js';
import { albumLink, artistLink, clock, esc, fmt, longDate, plural, spotifySearch, titleLink } from '../util.js';
import { holidayBadge, seasonList, showCards } from './common.js';
import { choose, showCoverage } from '../player.js';

const SRC_LABEL = { sp: 'Spotify', yt: 'YouTube', ia: 'Archive' };

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

  const rows = songs.map((p, i) => {
    const n = versionCount(p);
    const note = n === 1 ? '<span class="pill">only play</span>' : `<span class="muted small" title="Times this recording was played">×${n}</span>`;
    const src = choose(p).src;
    return `<tr>
      <td class="nowrap muted"><button class="row-play" data-play="${show.iso}" data-idx="${i}" aria-label="Play from here">▶</button> ${clock(p.min)}</td>
      <td>${titleLink(p.title)} ${note}</td>
      <td>${artistLink(p.artist)}</td>
      <td>${albumLink(p.album)}</td>
      <td class="nowrap">${src ? `<span class="src-tag src-${src}">${SRC_LABEL[src]}</span>` : ''}
        <a class="ext" href="${spotifySearch(p)}" target="_blank" rel="noopener" title="Search Spotify">Spotify ↗</a></td>
    </tr>`;
  }).join('');

  const cov = showCoverage(show);
  // On phones, Spotify's web player doesn't run; sending to the app is the main way to listen.
  const phone = matchMedia('(pointer: coarse)').matches;
  const playable = cov.sp + cov.yt + cov.ia;
  const parts = [cov.sp && `${cov.sp} on Spotify`, cov.yt && `${cov.yt} on YouTube`, cov.ia && `${cov.ia} from the Internet Archive`].filter(Boolean);
  const coverage = `${playable} of ${cov.total} songs playable${parts.length ? ` (${parts.join(', ')})` : ''}`
    + (cov.spOnly ? ` · ${cov.spOnly} more with Spotify connected` : '')
    + (cov.none ? ` · ${cov.none} not found yet` : '');

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
      <div class="play-row"><button class="button${phone ? '' : ' primary'}" data-play="${show.iso}" data-idx="0">▶ Play this show</button>
        <button class="button${phone ? ' primary' : ''}" data-send-show="${show.iso}">Send to Spotify app</button>
        <span class="muted small">${esc(coverage)}</span></div>
      <div class="table-wrap"><table class="plays show-table">
        <thead><tr><th>Aired</th><th>Song</th><th>Artist</th><th>Album</th><th>Plays on</th></tr></thead>
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
