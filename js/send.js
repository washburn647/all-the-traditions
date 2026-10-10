// "Send to Spotify": hand a show's Spotify-matched songs, in airtime order, to
// one of the listener's Spotify devices (usually the phone app). Spotify then
// plays them like a playlist, so it keeps going with the screen locked.
import { db, linkFor, showSongs } from './data.js';
import * as spotify from './spotify.js';
import { esc, longDate, plural } from './util.js';

const PENDING = 'atr.send.pending';
let dialog;

const DEVICE_ICON = { Smartphone: '📱', Computer: '💻', Speaker: '🔊', TV: '📺', Tablet: '📱', CastAudio: '🔊', AVR: '🔊', Automobile: '🚗' };

function tracksFor(show) {
  const songs = showSongs(show);
  const uris = [], missing = [];
  for (const p of songs) {
    const l = linkFor(p);
    if (l?.sp) uris.push(`spotify:track:${l.sp[0]}`);
    else missing.push(p);
  }
  return { uris, missing };
}

function open(html) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'send-dialog';
    dialog.addEventListener('click', onClick);
    // click on the backdrop closes
    dialog.addEventListener('mousedown', e => { if (e.target === dialog) dialog.close(); });
    document.body.appendChild(dialog);
  }
  dialog.innerHTML = `<button class="send-x" data-send="close" aria-label="Close">✕</button>${html}`;
  if (!dialog.open) dialog.showModal();
}

let state = { iso: null, devices: [] };

export async function sendShow(iso) {
  const show = db.showByIso.get(iso);
  if (!show) return;
  state = { iso, devices: [] };
  const { uris } = tracksFor(show);
  if (!uris.length) {
    return open(`<h3>Nothing to send yet</h3><p>None of this show's songs have been matched on Spotify so far. The daily search fills more in each day.</p>`);
  }
  if (!spotify.isConnected()) {
    return open(`<h3>Send to your Spotify app</h3>
      <p>${plural(uris.length, 'song')} from ${esc(longDate(show))} can play in your Spotify app, in order, even with your phone locked. Spotify Premium required.</p>
      <button class="button primary" data-send="login">Connect Spotify</button>`);
  }
  await findDevices();
}

async function findDevices() {
  const show = db.showByIso.get(state.iso);
  open('<h3>Looking for your Spotify devices…</h3>');
  let devices;
  try {
    devices = ((await spotify.api('GET', '/me/player/devices'))?.devices || [])
      .filter(d => !d.is_restricted && d.name !== 'All the Traditions archive');
  } catch (err) {
    return open(`<h3>Couldn’t reach Spotify</h3><p>${esc(err.message)}</p><button class="button" data-send="retry">Try again</button>`);
  }
  state.devices = devices;
  if (!devices.length) {
    return open(`<h3>Open Spotify first</h3>
      <p>Spotify doesn’t see any of your devices right now. Open the Spotify app on your phone (playing anything for a second helps), then come back here.</p>
      <p><a class="button" href="https://open.spotify.com/" target="_blank" rel="noopener">Open Spotify</a>
      <button class="button primary" data-send="retry">Try again</button></p>`);
  }
  const { uris, missing } = tracksFor(show);
  // Phones first, then whatever is currently active.
  devices.sort((a, b) => (b.type === 'Smartphone') - (a.type === 'Smartphone') || b.is_active - a.is_active);
  open(`<h3>Send ${esc(longDate(show))}</h3>
    <p class="muted">${plural(uris.length, 'song')} in airtime order${missing.length ? ` · ${missing.length} not on Spotify will be skipped` : ''}.</p>
    <ul class="device-list">${devices.map((d, i) => `<li><button class="device" data-send="device" data-i="${i}">
      <span class="device-icon">${DEVICE_ICON[d.type] || '🎵'}</span><span>${esc(d.name)}</span>
      ${d.is_active ? '<span class="muted small">playing now</span>' : ''}</button></li>`).join('')}</ul>
    <p class="muted small">Not listed? Open Spotify on that device, then <button class="linkish" data-send="retry">refresh</button>.</p>`);
}

async function sendTo(device) {
  const show = db.showByIso.get(state.iso);
  const { uris, missing } = tracksFor(show);
  open(`<h3>Sending to ${esc(device.name)}…</h3>`);
  try {
    // Shuffle would scramble the broadcast order; repeat would loop it.
    await spotify.api('PUT', `/me/player/shuffle?state=false&device_id=${device.id}`).catch(() => {});
    await spotify.api('PUT', `/me/player/repeat?state=off&device_id=${device.id}`).catch(() => {});
    await spotify.api('PUT', `/me/player/play?device_id=${device.id}`, { uris });
  } catch (err) {
    const hint = /not found|no active device/i.test(err.message)
      ? 'Spotify lost track of that device. Open the Spotify app on it, then try again.' : err.message;
    return open(`<h3>Couldn’t start playback</h3><p>${esc(hint)}</p><button class="button primary" data-send="retry">Try again</button>`);
  }
  document.dispatchEvent(new CustomEvent('atr:sent'));
  open(`<h3>Playing on ${esc(device.name)} 🎶</h3>
    <p>${plural(uris.length, 'song')} from ${esc(longDate(show))} are queued in your Spotify app, in the order they aired.</p>
    ${missing.length ? `<details><summary>${plural(missing.length, 'song')} skipped (not on Spotify)</summary><ul class="plain small">${missing.map(p =>
      `<li>${esc(db.titles[p.title])} <span class="muted">— ${esc(db.artists[p.artist])}</span></li>`).join('')}</ul></details>` : ''}
    <p class="muted small">Tip: turn off Autoplay in Spotify’s settings if you don’t want it to keep going with similar songs after the show ends.</p>
    <button class="button" data-send="close">Done</button>`);
}

function onClick(e) {
  const b = e.target.closest('[data-send]');
  if (!b) return;
  switch (b.dataset.send) {
    case 'close': return dialog.close();
    case 'retry': return findDevices();
    case 'device': return sendTo(state.devices[+b.dataset.i]);
    case 'login':
      try { sessionStorage.setItem(PENDING, state.iso); } catch { /* ignore */ }
      return spotify.login();
  }
}

// After a Spotify sign-in that started from "Send to Spotify", pick up where we left off.
export function resumeSend() {
  let iso = null;
  try { iso = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  if (iso) sendShow(iso);
  return !!iso;
}
