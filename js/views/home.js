import { db, showSongs } from '../data.js';
import { showsNear } from '../season.js';
import { artistLink, esc, fmt, monthName, rankList, statTiles, titleLink } from '../util.js';
import { seasonList, showCard } from './common.js';

// Artists and songs played unusually often within ±14 days of month/day.
function seasonalFavorites(month, day) {
  const near = showsNear(month, day, 14);
  const nearPlays = near.flatMap(showSongs);
  const share = nearPlays.length / db.plays.length;
  const pick = (groups, keyOf, link) => {
    const counts = new Map();
    for (const p of nearPlays) counts.set(keyOf(p), (counts.get(keyOf(p)) || 0) + 1);
    return [...counts.entries()]
      .map(([k, n]) => ({ k, n, total: groups[k].length, extra: n - groups[k].length * share }))
      .filter(r => r.n >= 3 && r.n / r.total >= Math.min(0.5, share * 4))
      .sort((a, b) => b.extra - a.extra)
      .slice(0, 12)
      .map(r => [`${link(r.k)} <span class="muted small">${fmt(r.total)} plays overall</span>`, r.n]);
  };
  return {
    artists: pick(db.byArtist, p => p.artist, artistLink),
    songs: pick(db.byTitle, p => p.title, titleLink),
  };
}

export function seasonSection(month, day, { heading } = {}) {
  const { holiday, html } = seasonList(month, day);
  const fav = seasonalFavorites(month, day);
  const when = holiday ? `around ${holiday.name}` : `around ${monthName(month)} ${day}`;
  return `<section>
    <h2>${heading || `Shows ${esc(when)}`}</h2>
    <p class="muted">${holiday ? `The ${esc(holiday.name)} show from each year of the archive.` : `The show closest to ${esc(monthName(month))} ${day} from each year of the archive.`}</p>
    ${html}
  </section>
  <section class="two-col">
    <div><h3>Artists played most this time of year</h3>${rankList(fav.artists, { unit: 'plays this time of year' })}</div>
    <div><h3>Songs of the season</h3>${rankList(fav.songs, { unit: 'plays this time of year' })}</div>
  </section>`;
}

export function homeView() {
  const now = new Date();
  const last = db.shows[0];
  return {
    title: 'All the Traditions',
    html: `<section class="hero">
      <h1>All the Traditions</h1>
      <p class="lede">Robert Resnik's Sunday-night folk show on Vermont Public. Every playlist VPR posted, ${db.years[0]}–${db.years.at(-1)}.</p>
      ${statTiles([['shows', fmt(db.shows.length)], ['songs played', fmt(db.plays.length)], ['artists', fmt(db.artists.length)], ['years', db.years.length]])}
      <div class="actions">
        <a class="button primary" href="#/random">Play me a random show</a>
        <a class="button" href="#/shows">Browse all shows</a>
        <a class="button" href="#/stats">Stats</a>
      </div>
    </section>
    ${seasonSection(now.getMonth() + 1, now.getDate(), { heading: 'This time of year' })}
    <section>
      <p class="muted"><a href="#/season">Pick another date →</a></p>
      <h2>The last posted playlist</h2>
      <ul class="cards">${showCard(last)}</ul>
    </section>`,
  };
}

export function seasonView(arg) {
  const now = new Date();
  let [m, d] = (arg || '').split('-').map(Number);
  if (!m || !d) { m = now.getMonth() + 1; d = now.getDate(); }
  const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === m ? ' selected' : ''}>${monthName(i + 1)}</option>`).join('');
  const days = Array.from({ length: 31 }, (_, i) => `<option${i + 1 === d ? ' selected' : ''}>${i + 1}</option>`).join('');
  return {
    title: `Around ${monthName(m)} ${d}`,
    html: `<section>
      <h1>Shows by time of year</h1>
      <p class="muted">Robert's shows followed the calendar. Pick a date to see the closest show from every year.</p>
      <form class="season-pick" onsubmit="event.preventDefault(); location.hash = '#/season/' + this.m.value + '-' + this.d.value;">
        <select name="m" aria-label="Month">${months}</select>
        <select name="d" aria-label="Day">${days}</select>
        <button class="button primary">Show me</button>
      </form>
    </section>
    ${seasonSection(m, d)}`,
  };
}
