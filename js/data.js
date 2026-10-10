// Loads data/atr.json and builds the lookup tables every view uses.
//
// Raw format (see tools/build_data.py):
//   artists: [name], titles: [title], albums: [[name, artistIdx]],
//   shows: [[isoDate, [[minutes, titleIdx, artistIdx, albumIdx|-1], ...]], ...] newest first

export const db = {};

export async function loadData() {
  const raw = await (await fetch('data/atr.json')).json();
  db.artists = raw.artists;
  db.titles = raw.titles;
  db.albums = raw.albums.map(([name, artist]) => ({ name, artist }));

  // Flat play table: one entry per song played, in show order.
  const plays = [];
  db.shows = raw.shows.map(([iso, songs], showIdx) => {
    const [y, m, d] = iso.split('-').map(Number);
    const show = { idx: showIdx, iso, year: y, month: m, day: d, date: new Date(y, m - 1, d), first: plays.length };
    for (const [min, title, artist, album] of songs) {
      plays.push({ i: plays.length, show: showIdx, min, title, artist, album });
    }
    show.count = plays.length - show.first;
    return show;
  });
  db.plays = plays;
  db.showByIso = new Map(db.shows.map(s => [s.iso, s]));
  db.years = [...new Set(db.shows.map(s => s.year))].sort((a, b) => a - b);

  db.byArtist = group(plays, p => p.artist, db.artists.length);
  db.byTitle = group(plays, p => p.title, db.titles.length);
  db.byAlbum = group(plays, p => p.album, db.albums.length);

  db.artistIdx = new Map(db.artists.map((a, i) => [a, i]));
  db.titleIdx = new Map(db.titles.map((t, i) => [t, i]));
  db.albumIdx = new Map(db.albums.map((a, i) => [albumKey(a.name, a.artist), i]));
  return db;
}

// data/links.json: "artist\ttitle" -> { sp: [id, conf], yt: [id, conf], ia: [item, file, conf] }
// Filled in daily by tools/match.py; a missing file just means nothing is playable yet.
export async function loadLinks() {
  try {
    db.links = await (await fetch('data/links.json', { cache: 'no-cache' })).json();
  } catch {
    db.links = {};
  }
}

export function linkFor(play) {
  return db.links?.[`${db.artists[play.artist]}\t${db.titles[play.title]}`] || null;
}

function group(plays, keyFn, n) {
  const out = Array.from({ length: n }, () => []);
  for (const p of plays) {
    const k = keyFn(p);
    if (k >= 0) out[k].push(p);
  }
  return out;
}

export const albumKey = (name, artist) => `${artist}\u0000${name}`;

export function showSongs(show) {
  return db.plays.slice(show.first, show.first + show.count);
}

export function showOf(play) {
  return db.shows[play.show];
}

// Distinct shows a set of plays appeared in, newest first.
export function showsOf(plays) {
  return [...new Set(plays.map(p => p.show))].sort((a, b) => a - b).map(i => db.shows[i]);
}

export function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k === undefined || k === null || k < 0) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function perYear(plays) {
  const counts = new Map(db.years.map(y => [y, 0]));
  for (const p of plays) {
    const y = db.shows[p.show].year;
    counts.set(y, counts.get(y) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label: String(label), value }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function perMonth(plays) {
  const counts = new Array(12).fill(0);
  for (const p of plays) counts[db.shows[p.show].month - 1]++;
  return counts.map((value, i) => ({ label: MONTHS[i], value }));
}

// Songs played immediately before or after each of these plays, by artist.
export function neighborArtists(plays, selfArtist) {
  const m = new Map();
  for (const p of plays) {
    const show = db.shows[p.show];
    for (const j of [p.i - 1, p.i + 1]) {
      if (j < show.first || j >= show.first + show.count) continue;
      const a = db.plays[j].artist;
      if (a === selfArtist) continue;
      m.set(a, (m.get(a) || 0) + 1);
    }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
