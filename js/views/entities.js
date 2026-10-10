// Artist, song and album pages.
import { albumKey, countBy, db, neighborArtists, perMonth, perYear, showsOf } from '../data.js';
import { columnChart } from '../charts.js';
import { albumLink, artistLink, esc, fmt, rankList, statTiles, titleLink } from '../util.js';
import { collapsible, firstLast, playsTable } from './common.js';

const newestFirst = plays => [...plays].sort((a, b) => a.show - b.show || a.i - b.i);

function timeCharts(plays, what) {
  return `<div class="two-col">
    ${columnChart(perYear(plays), { title: `${what} per year`, height: 170 })}
    ${columnChart(perMonth(plays), { title: `${what} by month (all years)`, height: 170 })}
  </div>`;
}

export function artistView(name) {
  const a = db.artistIdx.get(name);
  if (a === undefined) return null;
  const plays = db.byArtist[a];
  const shows = showsOf(plays);
  const { firstHtml, lastHtml } = firstLast(plays);
  const songs = countBy(plays, p => p.title);
  const albums = countBy(plays, p => p.album);
  const years = new Set(shows.map(s => s.year)).size;

  return {
    title: name,
    html: `<section>
      <p class="kicker">Artist</p>
      <h1>${esc(name || 'Unknown artist')}</h1>
      ${statTiles([['plays', fmt(plays.length)], ['shows', fmt(shows.length)], ['different songs', fmt(songs.length)], ['years played', years]])}
      <p class="muted">First played ${firstHtml} · last played ${lastHtml}</p>
      ${timeCharts(plays, 'Plays')}
    </section>
    <section class="three-col">
      <div><h3>Most-played songs</h3>${rankList(songs.map(([t, n]) => [titleLink(t), n]))}</div>
      <div><h3>Albums</h3>${rankList(albums.map(([al, n]) => [albumLink(al), n]))}</div>
      <div><h3>Often played next to</h3>${rankList(neighborArtists(plays, a).map(([x, n]) => [artistLink(x), n]), { unit: 'times side by side' })}</div>
    </section>
    <section>${collapsible('Every play', plays.length, playsTable(newestFirst(plays), { showArtist: false }), plays.length <= 25)}</section>`,
  };
}

export function songView(title) {
  const t = db.titleIdx.get(title);
  if (t === undefined) return null;
  const plays = db.byTitle[t];
  const versions = countBy(plays, p => p.artist);
  const { firstHtml, lastHtml } = firstLast(plays);

  return {
    title,
    html: `<section>
      <p class="kicker">Song</p>
      <h1>${esc(title)}</h1>
      ${statTiles([['plays', fmt(plays.length)], ['shows', fmt(showsOf(plays).length)], [versions.length === 1 ? 'artist' : 'different artists', fmt(versions.length)]])}
      <p class="muted">First played ${firstHtml} · last played ${lastHtml}</p>
      ${plays.length >= 4 ? timeCharts(plays, 'Plays') : ''}
    </section>
    <section class="two-col">
      <div><h3>${versions.length === 1 ? 'Recording' : 'Versions played'}</h3>${rankList(versions.map(([a, n]) => [artistLink(a), n]), { limit: 50 })}</div>
      <div><h3>Albums</h3>${rankList(countBy(plays, p => p.album).map(([al, n]) => [`${albumLink(al)} <span class="muted small">${esc(db.artists[db.albums[al].artist])}</span>`, n]))}</div>
    </section>
    <section>${collapsible('Every play', plays.length, playsTable(newestFirst(plays), { showAlbum: true }), plays.length <= 25)}</section>`,
  };
}

export function albumView(artistName, albumName) {
  const a = db.artistIdx.get(artistName);
  const al = db.albumIdx.get(albumKey(albumName, a));
  if (a === undefined || al === undefined) return null;
  const plays = db.byAlbum[al];
  const songs = countBy(plays, p => p.title);
  const { firstHtml, lastHtml } = firstLast(plays);

  return {
    title: `${albumName} — ${artistName}`,
    html: `<section>
      <p class="kicker">Album</p>
      <h1>${esc(albumName)}</h1>
      <p class="byline">by ${artistLink(a)}</p>
      ${statTiles([['plays', fmt(plays.length)], ['shows', fmt(showsOf(plays).length)], ['different songs', fmt(songs.length)]])}
      <p class="muted">First played ${firstHtml} · last played ${lastHtml}</p>
      ${plays.length >= 4 ? timeCharts(plays, 'Plays') : ''}
    </section>
    <section>
      <h3>Songs played from this album</h3>${rankList(songs.map(([t, n]) => [titleLink(t), n]), { limit: 40 })}
    </section>
    <section>${collapsible('Every play', plays.length, playsTable(newestFirst(plays), { showArtist: false, showAlbum: false }), plays.length <= 25)}</section>`,
  };
}
