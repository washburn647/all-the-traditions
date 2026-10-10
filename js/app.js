import { db, loadData, loadLinks } from './data.js';
import { initPlayer, playShow, resumePending } from './player.js';
import * as spotify from './spotify.js';
import { mountCharts, resetCharts } from './charts.js';
import { randomShow } from './util.js';
import { homeView, seasonView } from './views/home.js';
import { showsView, showView } from './views/shows.js';
import { albumView, artistView, songView } from './views/entities.js';
import { statsView } from './views/stats.js';
import { searchView } from './views/search.js';

const app = document.getElementById('app');
const searchBox = document.getElementById('search');

const routes = {
  '': () => homeView(),
  show: ([iso]) => showView(iso),
  shows: ([year]) => showsView(year),
  season: ([md]) => seasonView(md),
  artist: ([name]) => artistView(name),
  song: ([title]) => songView(title),
  album: ([artist, album]) => albumView(artist, album),
  stats: ([year]) => statsView(year),
  search: ([q]) => searchView(q),
};

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: parts[0] || '', args: parts.slice(1) };
}

function render() {
  const { name, args } = parse();
  if (name === 'random') {
    location.replace(`#/show/${randomShow().iso}`);
    return;
  }
  resetCharts();
  let view = routes[name] ? routes[name](args) : null;
  // A hand-typed or outdated name: show what it matches instead of a dead end.
  if (!view && ['artist', 'song', 'album'].includes(name) && args.length) view = searchView(args.at(-1));
  const page = view || { title: 'Not found', html: '<section><h1>Not found</h1><p>That page isn’t in the archive. <a href="#/">Go home</a>.</p></section>' };
  app.innerHTML = page.html;
  document.title = page.title === 'All the Traditions' ? page.title : `${page.title} · All the Traditions`;
  document.querySelectorAll('.site-nav a').forEach(a => {
    a.classList.toggle('on', a.getAttribute('href').replace('#/', '') === name);
  });
  if (name !== 'search') searchBox.value = '';
  mountCharts(app);
  if (name !== 'search') window.scrollTo(0, 0);
}

let searchTimer;
searchBox.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const target = `#/search/${encodeURIComponent(searchBox.value.trim())}`;
    if (parse().name === 'search') { history.replaceState(null, '', target); render(); }
    else location.hash = target;
  }, 200);
});

window.addEventListener('hashchange', render);

// Play buttons anywhere on a page: data-play="<show iso>" data-idx="<song index>"
app.addEventListener('click', e => {
  const b = e.target.closest('[data-play]');
  if (b) playShow(b.dataset.play, Number(b.dataset.idx) || 0);
});

(async () => {
  initPlayer();
  // Finish a Spotify sign-in first: it rewrites the URL back to the page that started it.
  const signin = await spotify.handleRedirect().catch(err => ({ error: err.message }));
  await Promise.all([loadData(), loadLinks()]);
  document.body.classList.remove('loading');
  render();
  renderSpotifyStatus();
  if (signin?.ok) resumePending();
  if (signin?.error) alertBanner(signin.error);
})().catch(err => {
  app.innerHTML = `<section><h1>Couldn’t load the archive</h1><p class="muted">${String(err)}</p></section>`;
});

// Footer: Spotify connection state, with connect / disconnect.
function renderSpotifyStatus() {
  const el = document.getElementById('spotify-status');
  el.innerHTML = spotify.isConnected()
    ? 'Spotify: connected for playback · <button class="linkish" data-sp="out">Disconnect</button>'
    : 'Spotify Premium? <button class="linkish" data-sp="in">Connect Spotify</button> to hear the songs matched there.';
}
document.getElementById('spotify-status').addEventListener('click', e => {
  const b = e.target.closest('[data-sp]');
  if (!b) return;
  if (b.dataset.sp === 'in') spotify.login();
  else { spotify.logout(); renderSpotifyStatus(); render(); }
});
renderSpotifyStatus();

function alertBanner(text) {
  const div = document.createElement('div');
  div.className = 'banner wrap';
  div.textContent = text;
  app.before(div);
  setTimeout(() => div.remove(), 8000);
}

window.atr = db; // handy for poking around in the console
