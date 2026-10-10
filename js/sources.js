// Playback sources. Each one exposes the same small interface the player uses:
//   play(id) -> Promise, pause(), resume(), stop(), seek(seconds),
//   position() -> Promise<{ pos, dur }> in seconds, and an onEnded callback.
import { api, token } from './spotify.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn’t load ${src}`));
    document.head.appendChild(s);
  });
}

// --- Spotify Web Playback SDK (desktop browsers, Premium accounts) -----------
export class SpotifySource {
  constructor() { this.onEnded = null; this.ready = null; }

  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => {
        const p = new window.Spotify.Player({
          name: 'All the Traditions archive',
          getOAuthToken: cb => token().then(cb, () => cb('')),
          volume: 0.8,
        });
        p.addListener('ready', ({ device_id }) => { this.device = device_id; resolve(); });
        p.addListener('initialization_error', ({ message }) => reject(new Error(`Spotify player couldn’t start: ${message}`)));
        p.addListener('authentication_error', () => reject(new Error('Spotify sign-in expired — reconnect Spotify.')));
        p.addListener('account_error', () => reject(new Error('Spotify playback needs a Premium account.')));
        p.addListener('player_state_changed', s => this.onState(s));
        p.connect();
        this.player = p;
      };
      loadScript('https://sdk.scdn.co/spotify-player.js').catch(reject);
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async play(id) {
    await this.init();
    this.started = false;
    await this.player.activateElement?.();
    await api('PUT', `/me/player/play?device_id=${this.device}`, { uris: [`spotify:track:${id}`] });
  }

  onState(s) {
    if (!s) return;
    this.last = { pos: s.position / 1000, dur: s.duration / 1000, at: Date.now(), paused: s.paused };
    if (!s.paused && s.position > 0) this.started = true;
    // A single-track play ends by snapping back to 0 and pausing.
    if (this.started && s.paused && s.position === 0) {
      this.started = false;
      this.onEnded?.();
    }
  }

  pause() { this.player?.pause(); }
  resume() { this.player?.resume(); }
  stop() { this.started = false; this.player?.pause(); }
  seek(sec) { this.player?.seek(Math.round(sec * 1000)); }
  async position() {
    const s = await this.player?.getCurrentState();
    return s ? { pos: s.position / 1000, dur: s.duration / 1000 } : { pos: 0, dur: 0 };
  }
}

// --- YouTube IFrame player --------------------------------------------------
// YouTube's terms require the player to stay visible while it plays, so the
// player bar shows it in a small panel whenever YouTube is the source.
export class YouTubeSource {
  constructor(mountId) { this.mountId = mountId; this.onEnded = null; this.onError = null; this.ready = null; }

  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const make = () => {
        this.player = new window.YT.Player(this.mountId, {
          width: 356, height: 200,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
          events: {
            onReady: () => resolve(),
            onStateChange: e => { if (e.data === window.YT.PlayerState.ENDED) this.onEnded?.(); },
            // 100: removed, 101/150: owner blocks embedding
            onError: e => this.onError?.(new Error(e.data === 101 || e.data === 150 ? 'This video can’t be played outside YouTube.' : 'YouTube couldn’t play this video.')),
          },
        });
      };
      if (window.YT?.Player) return make();
      window.onYouTubeIframeAPIReady = make;
      loadScript('https://www.youtube.com/iframe_api').catch(reject);
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  async play(id) { await this.init(); this.player.loadVideoById(id); }
  pause() { this.player?.pauseVideo?.(); }
  resume() { this.player?.playVideo?.(); }
  stop() { this.player?.stopVideo?.(); }
  seek(sec) { this.player?.seekTo?.(sec, true); }
  async position() {
    return { pos: this.player?.getCurrentTime?.() || 0, dur: this.player?.getDuration?.() || 0 };
  }
}

// --- Plain audio files (Internet Archive) -----------------------------------
export class AudioSource {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.onEnded?.());
    this.el.addEventListener('error', () => this.onError?.(new Error('That archive.org file wouldn’t play.')));
  }
  async play(url) { this.el.src = url; await this.el.play(); }
  pause() { this.el.pause(); }
  resume() { this.el.play(); }
  stop() { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
  seek(sec) { this.el.currentTime = sec; }
  async position() { return { pos: this.el.currentTime || 0, dur: this.el.duration || 0 }; }
}
