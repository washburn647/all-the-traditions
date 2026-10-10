// Show player: plays a show's songs in order, each from the best source
// available (Spotify if connected, else YouTube, else archive.org), and
// skips songs with no playable copy. Lives in a bar pinned to the bottom of
// the page, so it keeps playing while you browse.
import { db, linkFor, showSongs } from './data.js';
import { AudioSource, SpotifySource, YouTubeSource } from './sources.js';
import * as spotify from './spotify.js';
import { clock, enc, esc, longDate, randomShow, spotifySearch } from './util.js';

const SKIP_SECONDS = 4;
const PENDING = 'atr.player.pending';

const st = {
  show: null, queue: [], idx: -1, choice: null,
  status: 'idle',        // idle | ready | loading | playing | paused | missing | ended | error
  message: '', countdown: 0,
  spotifyBlocked: '',    // why Spotify can't be used this session, if it failed
  seq: 0, showQueue: false,
};
let sources, el, skipTimer;

// --- choosing a source ---------------------------------------------------
const spotifyUsable = () => spotify.isConnected() && !st.spotifyBlocked;

export function choose(play) {
  const l = linkFor(play);
  if (l?.sp && spotifyUsable()) return { src: 'sp', arg: l.sp[0], label: 'Spotify' };
  if (l?.yt) return { src: 'yt', arg: l.yt[0], alts: [...(l.yt[2] || [])], label: 'YouTube' };
  if (l?.ia) return { src: 'ia', arg: `https://archive.org/download/${enc(l.ia[0])}/${l.ia[1].split('/').map(enc).join('/')}`, label: 'Internet Archive' };
  if (l?.sp) return { src: null, why: st.spotifyBlocked ? `On Spotify — ${st.spotifyBlocked}` : 'On Spotify — connect Spotify to hear it' };
  if (l && 'yt' in l) return { src: null, why: 'No playable copy found online' };
  return { src: null, why: 'Not matched yet — the daily search hasn’t reached it' };
}

// How a show will play right now: counts per source.
export function showCoverage(show) {
  const c = { sp: 0, yt: 0, ia: 0, spOnly: 0, none: 0, total: show.count };
  for (const p of showSongs(show)) {
    const l = linkFor(p), ch = choose(p);
    if (ch.src) c[ch.src]++;
    else if (l?.sp) c.spOnly++;
    else c.none++;
  }
  return c;
}

// --- playback -------------------------------------------------------------
function current() { return st.choice?.src ? sources[st.choice.src] : null; }

function stopAll() {
  clearTimeout(skipTimer);
  for (const s of Object.values(sources)) { try { s.stop(); } catch { /* not started */ } }
}

async function playAt(i, { autoplay = true } = {}) {
  if (i < 0 || i >= st.queue.length) return;
  stopAll();
  const seq = ++st.seq;
  st.idx = i;
  st.choice = choose(st.queue[i]);
  st.message = '';
  setMediaSession();
  if (!autoplay) { st.status = 'ready'; return render(); }

  if (!st.choice.src) {
    st.status = 'missing';
    st.countdown = SKIP_SECONDS;
    render();
    const step = () => {
      if (seq !== st.seq || st.status !== 'missing') return;
      if (--st.countdown <= 0) return next();
      render();
      skipTimer = setTimeout(step, 1000);
    };
    skipTimer = setTimeout(step, 1000);
    return;
  }

  st.status = 'loading';
  render();
  try {
    await sources[st.choice.src].play(st.choice.arg);
    if (seq !== st.seq) return;
    st.status = 'playing';
  } catch (err) {
    if (seq !== st.seq) return;
    if (st.choice.src === 'sp') {
      // Spotify itself is unusable (not Premium, not on the listener list,
      // sign-in expired...): fall back to other sources for the rest.
      st.spotifyBlocked = err.message;
      return playAt(i);
    }
    failAndSkip(err.message, seq);
    return;
  }
  render();
}

function failAndSkip(message, seq = st.seq) {
  st.status = 'error';
  st.message = message;
  st.countdown = SKIP_SECONDS;
  render();
  skipTimer = setTimeout(() => { if (seq === st.seq) next(); }, SKIP_SECONDS * 1000);
}

function next() {
  if (st.idx + 1 < st.queue.length) return playAt(st.idx + 1);
  stopAll();
  st.status = 'ended';
  render();
}

async function prev() {
  const src = current();
  if (src && st.status === 'playing') {
    const { pos } = await src.position();
    if (pos > 5) return src.seek(0);
  }
  if (st.idx > 0) playAt(st.idx - 1);
}

function toggle() {
  const src = current();
  if (st.status === 'ready' || st.status === 'ended') return playAt(st.status === 'ended' ? 0 : st.idx);
  if (st.status === 'missing' || st.status === 'error') { clearTimeout(skipTimer); return next(); }
  if (!src) return;
  if (st.status === 'playing') { src.pause(); st.status = 'paused'; }
  else if (st.status === 'paused') { src.resume(); st.status = 'playing'; }
  render();
}

export function playShow(iso, startIdx = 0) {
  const show = db.showByIso.get(iso);
  if (!show) return;
  stopAll();
  st.show = show;
  st.queue = showSongs(show);
  const cov = showCoverage(show);
  if (cov.spOnly && !spotify.isConnected() && !st.declinedSpotify) {
    st.idx = startIdx;
    st.choice = null;
    st.status = 'ask-spotify';
    st.pendingStart = startIdx;
    return render();
  }
  playAt(startIdx);
}

function close() {
  stopAll();
  st.seq++;
  st.status = 'idle';
  st.show = null;
  render();
}

// --- UI -------------------------------------------------------------------
const fmtTime = s => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

function nowPlayingHtml() {
  const p = st.queue[st.idx];
  if (!p) return '';
  const title = db.titles[p.title], artist = db.artists[p.artist];
  return `<div class="np-title"><a href="#/song/${enc(title)}">${esc(title)}</a></div>
    <div class="np-sub"><a href="#/artist/${enc(artist)}">${esc(artist)}</a> · <a href="#/show/${st.show.iso}">${esc(longDate(st.show))}</a>, aired ${clock(p.min)}</div>`;
}

function statusHtml() {
  const p = st.queue[st.idx];
  switch (st.status) {
    case 'ask-spotify': {
      const cov = showCoverage(st.show);
      return `<div class="pl-ask">${cov.spOnly} of ${cov.total} songs in this show are on Spotify.
        <button class="button primary small" data-pl="connect">Connect Spotify</button>
        <button class="button small" data-pl="without">Play without it</button></div>`;
    }
    case 'missing':
      return `<div class="pl-note">${esc(st.choice.why)}. <a href="${spotifySearch(p)}" target="_blank" rel="noopener">Search Spotify ↗</a> ·
        <a href="https://www.youtube.com/results?search_query=${enc(`${db.artists[p.artist]} ${db.titles[p.title]}`)}" target="_blank" rel="noopener">YouTube ↗</a>
        — skipping in ${st.countdown}…</div>`;
    case 'error':
      return `<div class="pl-note">${esc(st.message)} Skipping…</div>`;
    case 'ended':
      return `<div class="pl-note">End of the show.
        ${db.shows[st.show.idx + 1] ? `<button class="button small" data-pl="older">Play the week before</button>` : ''}
        <button class="button small" data-pl="random">Random show</button></div>`;
    case 'loading':
      return `<div class="pl-note muted">Loading from ${esc(st.choice.label)}…</div>`;
    default:
      return st.spotifyBlocked && st.choice?.src !== 'sp'
        ? `<div class="pl-note muted small">Spotify unavailable: ${esc(st.spotifyBlocked)}</div>` : '';
  }
}

function queueHtml() {
  return `<ol class="pl-queue">${st.queue.map((p, i) => {
    const ch = choose(p);
    const tag = ch.src ? { sp: 'Spotify', yt: 'YouTube', ia: 'Archive' }[ch.src] : 'missing';
    return `<li class="${i === st.idx ? 'on' : ''}${ch.src ? '' : ' gone'}"><button data-pl-jump="${i}">
      <span class="muted small">${clock(p.min)}</span> ${esc(db.titles[p.title])} <span class="muted">— ${esc(db.artists[p.artist])}</span>
      <span class="src-tag src-${ch.src || 'none'}">${tag}</span></button></li>`;
  }).join('')}</ol>`;
}

function render() {
  const open = st.status !== 'idle';
  el.hidden = !open;
  document.body.classList.toggle('player-open', open);
  if (!open) { el.querySelector('.yt-panel').hidden = true; return; }

  el.querySelector('.yt-panel').hidden = st.choice?.src !== 'yt' || !['playing', 'paused', 'loading'].includes(st.status);
  el.querySelector('.np').innerHTML = nowPlayingHtml();
  el.querySelector('.pl-status').innerHTML = statusHtml();
  const playing = st.status === 'playing' || st.status === 'loading';
  const pp = el.querySelector('[data-pl="toggle"]');
  pp.textContent = playing ? '❚❚' : '▶';
  pp.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  const srcTag = el.querySelector('.pl-src');
  srcTag.textContent = st.choice?.src ? st.choice.label : '';
  srcTag.className = `pl-src src-tag src-${st.choice?.src || 'none'}`;
  el.querySelector('.pl-count').textContent = st.queue.length ? `${st.idx + 1} / ${st.queue.length}` : '';
  const q = el.querySelector('.pl-queue-wrap');
  q.hidden = !st.showQueue;
  if (st.showQueue) q.innerHTML = queueHtml();
}

async function tick() {
  const src = current();
  if (!src || !['playing', 'paused'].includes(st.status)) {
    el.querySelector('.pl-time').textContent = '';
    el.querySelector('.pl-bar span').style.width = '0%';
    return;
  }
  const { pos, dur } = await src.position();
  el.querySelector('.pl-time').textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
  el.querySelector('.pl-bar span').style.width = dur ? `${Math.min(100, (100 * pos) / dur)}%` : '0%';
}

function setMediaSession() {
  if (!('mediaSession' in navigator) || !st.queue[st.idx]) return;
  const p = st.queue[st.idx];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: db.titles[p.title], artist: db.artists[p.artist],
    album: `All the Traditions — ${longDate(st.show)}`,
  });
}

function onClick(e) {
  const jump = e.target.closest('[data-pl-jump]');
  if (jump) return playAt(+jump.dataset.plJump);
  const b = e.target.closest('[data-pl]');
  if (!b) return;
  switch (b.dataset.pl) {
    case 'toggle': return toggle();
    case 'next': clearTimeout(skipTimer); return next();
    case 'prev': return prev();
    case 'close': return close();
    case 'queue': st.showQueue = !st.showQueue; return render();
    case 'connect':
      try { sessionStorage.setItem(PENDING, JSON.stringify({ iso: st.show.iso, idx: st.pendingStart || 0 })); } catch { /* ignore */ }
      return spotify.login();
    case 'without': st.declinedSpotify = true; return playAt(st.pendingStart || 0);
    case 'older': return playShow(db.shows[st.show.idx + 1].iso);
    case 'random': return playShow(randomShow().iso);
    case 'seek': {
      const src = current();
      if (!src) return;
      const r = b.getBoundingClientRect();
      src.position().then(({ dur }) => dur && src.seek(((e.clientX - r.left) / r.width) * dur));
    }
  }
}

export function initPlayer() {
  el = document.createElement('div');
  el.id = 'player';
  el.className = 'player';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Show player');
  el.innerHTML = `
    <div class="yt-panel" hidden><div id="yt-frame"></div></div>
    <div class="pl-queue-wrap" hidden></div>
    <div class="wrap pl-row">
      <div class="pl-ctrls">
        <button data-pl="prev" aria-label="Previous song">⏮</button>
        <button data-pl="toggle" class="pl-main" aria-label="Play">▶</button>
        <button data-pl="next" aria-label="Next song">⏭</button>
      </div>
      <div class="pl-mid">
        <div class="np"></div>
        <div class="pl-progress"><span class="pl-time muted small"></span>
          <div class="pl-bar" data-pl="seek"><span></span></div></div>
        <div class="pl-status"></div>
      </div>
      <div class="pl-side">
        <span class="pl-src"></span>
        <span class="pl-count muted small"></span>
        <button data-pl="queue" class="button small">Song list</button>
        <button data-pl="close" aria-label="Close player">✕</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);

  sources = { sp: new SpotifySource(), yt: new YouTubeSource('yt-frame'), ia: new AudioSource() };
  for (const [key, s] of Object.entries(sources)) {
    s.onEnded = () => { if (st.choice?.src === key && st.status === 'playing') next(); };
    s.onError = err => {
      if (st.choice?.src !== key || !['loading', 'playing'].includes(st.status)) return;
      // Some owners block embedding, which only shows up at play time: try the backup videos.
      if (st.choice.alts?.length) {
        st.choice.arg = st.choice.alts.shift();
        s.play(st.choice.arg).catch(e => failAndSkip(e.message));
        return;
      }
      failAndSkip(err.message);
    };
  }
  setInterval(tick, 500);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', toggle);
    navigator.mediaSession.setActionHandler('pause', toggle);
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }
}

// After a Spotify sign-in redirect: reopen the show that asked for it, ready to play.
export function resumePending() {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING)); sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  const show = pending && db.showByIso.get(pending.iso);
  if (!show) return;
  st.show = show;
  st.queue = showSongs(show);
  playAt(pending.idx, { autoplay: false });
}
