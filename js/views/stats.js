import { countBy, db } from '../data.js';
import { columnChart } from '../charts.js';
import { albumLink, artistLink, esc, fmt, monthName, rankList, statTiles, titleLink } from '../util.js';

function longTail(plays) {
  const artistCounts = countBy(plays, p => p.artist);
  const songCounts = countBy(plays, p => `${p.title}|${p.artist}`);
  const onceA = artistCounts.filter(([, n]) => n === 1).length;
  const onceS = songCounts.filter(([, n]) => n === 1).length;
  return `<ul class="facts">
    <li><strong>${fmt(onceA)}</strong> artists (${Math.round(100 * onceA / artistCounts.length)}%) were played exactly once.</li>
    <li><strong>${fmt(onceS)}</strong> recordings (${Math.round(100 * onceS / songCounts.length)}%) were played exactly once.</li>
    <li>The top 50 artists account for <strong>${Math.round(100 * artistCounts.slice(0, 50).reduce((s, [, n]) => s + n, 0) / plays.length)}%</strong> of all plays.</li>
  </ul>`;
}

function seasonalArtists() {
  return db.byArtist
    .map((plays, a) => ({ a, plays }))
    .filter(r => r.plays.length >= 20)
    .map(r => {
      const months = new Array(12).fill(0);
      for (const p of r.plays) months[db.shows[p.show].month - 1]++;
      const peak = months.indexOf(Math.max(...months));
      return { ...r, peak, share: months[peak] / r.plays.length };
    })
    .sort((x, y) => y.share - x.share)
    .slice(0, 15)
    .map(r => [`${artistLink(r.a)} <span class="muted small">${monthName(r.peak + 1)}</span>`, Math.round(r.share * 100)]);
}

function longestRunning() {
  return db.byArtist
    .map((plays, a) => ({ a, n: plays.length, years: new Set(plays.map(p => db.shows[p.show].year)).size }))
    .sort((x, y) => y.years - x.years || y.n - x.n)
    .slice(0, 15)
    .map(r => [`${artistLink(r.a)} <span class="muted small">${fmt(r.n)} plays</span>`, r.years]);
}

function newThisYear(year, plays) {
  const firstYear = db.byArtist.map(ps => Math.min(...ps.map(p => db.shows[p.show].year)));
  return countBy(plays.filter(p => firstYear[p.artist] === year), p => p.artist).map(([a, n]) => [artistLink(a), n]);
}

export function statsView(arg) {
  const year = Number(arg) || null;
  const plays = year ? db.plays.filter(p => db.shows[p.show].year === year) : db.plays;
  const shows = year ? db.shows.filter(s => s.year === year) : db.shows;

  const artists = countBy(plays, p => p.artist);
  const albums = countBy(plays, p => p.album);
  const titles = countBy(plays, p => p.title);
  const recordings = countBy(plays, p => p.title * 1e5 + p.artist);

  const artistsPerYear = db.years.map(y => ({
    label: String(y),
    value: new Set(db.plays.filter(p => db.shows[p.show].year === y).map(p => p.artist)).size,
  }));

  return {
    title: year ? `Stats · ${year}` : 'Stats',
    html: `<section>
      <h1>Stats ${year ? `<span class="muted">· ${year}</span>` : ''}</h1>
      <nav class="pills"><a class="pill-link${year ? '' : ' on'}" href="#/stats">All years</a>${db.years.map(y => `<a class="pill-link${y === year ? ' on' : ''}" href="#/stats/${y}">${y}</a>`).join('')}</nav>
      ${statTiles([['shows', fmt(shows.length)], ['songs played', fmt(plays.length)], ['artists', fmt(artists.length)], ['different songs', fmt(titles.length)]])}
      ${year ? '' : columnChart(artistsPerYear, { title: 'Different artists played each year', unit: 'artists', height: 160 })}
    </section>
    <section class="two-col">
      <div><h3>Top artists</h3>${rankList(artists.map(([a, n]) => [artistLink(a), n]), { limit: 25 })}</div>
      <div><h3>Top albums</h3>${rankList(albums.map(([al, n]) => [`${albumLink(al)} <span class="muted small">${esc(db.artists[db.albums[al].artist])}</span>`, n]), { limit: 25 })}</div>
    </section>
    <section class="two-col">
      <div><h3>Top songs <span class="muted small">any artist</span></h3>${rankList(titles.map(([t, n]) => [titleLink(t), n]), { limit: 25 })}</div>
      <div><h3>Top recordings</h3>${rankList(recordings.map(([k, n]) => {
        const t = Math.floor(k / 1e5), a = k % 1e5;
        return [`${titleLink(t)} <span class="muted small">${esc(db.artists[a])}</span>`, n];
      }), { limit: 25 })}</div>
    </section>
    ${year ? `<section><h3>New to the show in ${year}</h3><p class="muted">Artists first played this year, by plays.</p>${rankList(newThisYear(year, plays), { limit: 20 })}</section>` : `
    <section class="two-col">
      <div><h3>Most seasonal artists</h3><p class="muted small">Share of their plays (min. 20) landing in a single month.</p>${rankList(seasonalArtists(), { unit: '% in that month' })}</div>
      <div><h3>Longest-running favorites</h3><p class="muted small">Number of different years they were played.</p>${rankList(longestRunning(), { unit: 'years' })}</div>
    </section>`}
    <section><h3>The long tail</h3>${longTail(plays)}</section>`,
  };
}
