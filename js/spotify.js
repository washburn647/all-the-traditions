// Spotify sign-in (Authorization Code + PKCE, so no secret lives in the page)
// and a thin Web API helper. Tokens are kept in this browser's localStorage.

const CLIENT_ID = '714b451297454abc9054af8994241aad';
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
const STORE = 'atr.spotify';
const PKCE = 'atr.spotify.pkce';

// Must exactly match a Redirect URI registered on the Spotify app.
const redirectUri = () => location.origin + location.pathname;

function read(key, storage = localStorage) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}
function write(key, value, storage = localStorage) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* private mode: sign-in lasts this page only */ }
}

export const isConnected = () => !!read(STORE)?.refresh;

export function logout() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  write(PKCE, { verifier, state, hash: location.hash }, sessionStorage);
  const q = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${q}`);
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  if (!r.ok) throw new Error(`Spotify sign-in failed (${r.status})`);
  const t = await r.json();
  const prev = read(STORE) || {};
  write(STORE, { access: t.access_token, refresh: t.refresh_token || prev.refresh, expires: Date.now() + (t.expires_in - 60) * 1000 });
}

// Call once at startup: finishes a sign-in if Spotify just redirected back here.
export async function handleRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return null;
  const pk = read(PKCE, sessionStorage);
  history.replaceState(null, '', redirectUri() + (pk?.hash || ''));
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : p.get('error') };
  if (!pk || p.get('state') !== pk.state) return { error: 'Spotify sign-in expired; please try again.' };
  await tokenRequest({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier });
  return { ok: true };
}

export async function token() {
  const t = read(STORE);
  if (!t) throw new Error('Not signed in to Spotify');
  if (Date.now() < t.expires) return t.access;
  await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return read(STORE).access;
}

export async function api(method, path, body) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204 || r.status === 202) return null;
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error?.message || `Spotify error ${r.status}`;
    // Development-mode apps only serve users added to the app's allowlist.
    if (r.status === 403 && /registered|developer/i.test(msg)) throw new Error('This Spotify account isn’t on the app’s listener list yet.');
    if (r.status === 403 && /premium/i.test(msg)) throw new Error('Spotify playback needs a Premium account.');
    throw new Error(msg);
  }
  return data;
}
