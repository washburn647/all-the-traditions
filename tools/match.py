"""Match every recording in data/atr.json to playable links.

Usage:
  python tools/match.py spotify [--sample N] [--limit N]
  python tools/match.py archive [--sample N] [--limit N]
  python tools/match.py youtube [--limit N]        # official Data API, ~100 searches/day
  python tools/match.py report  [--sample N]

A "recording" is one (artist, title) pair. Raw API answers are cached in
tools/cache/ so re-runs are cheap; results are merged into data/links.json,
which the site loads:

  {"artist\ttitle": {"sp": [trackId, conf], "ia": [identifier, file, conf], "yt": [videoId, conf]}}

conf is "high" (title, artist and album or length agree) or "ok" (title and
artist agree). Misses are recorded as null so they aren't searched again.
"""
import argparse
import base64
import difflib
import json
import random
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "atr.json"
LINKS = ROOT / "data" / "links.json"
CACHE = ROOT / "tools" / "cache"
ENV = ROOT / "tools" / ".env"


# --- recordings ---------------------------------------------------------

def load_recordings():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    artists, titles, albums = d["artists"], d["titles"], d["albums"]
    recs = {}
    for _, songs in d["shows"]:
        for i, (minute, t, a, al) in enumerate(songs):
            key = f"{artists[a]}\t{titles[t]}"
            r = recs.setdefault(key, {"key": key, "artist": artists[a], "title": titles[t],
                                      "albums": {}, "gaps": [], "plays": 0})
            r["plays"] += 1
            if al >= 0:
                name = albums[al][0]
                r["albums"][name] = r["albums"].get(name, 0) + 1
            if i + 1 < len(songs):
                gap = songs[i + 1][0] - minute
                if 1 <= gap <= 15:
                    r["gaps"].append(gap)
    for r in recs.values():
        r["album"] = max(r["albums"], key=r["albums"].get) if r["albums"] else ""
        # airtime gaps are whole minutes and include any talk, so this is rough
        r["est"] = statistics.median(r["gaps"]) * 60 if r["gaps"] else None
    return d, recs


def sample_keys(d, recs, n, seed=7):
    """Recordings from n random shows (fixed seed, so the sample is repeatable)."""
    artists, titles = d["artists"], d["titles"]
    shows = random.Random(seed).sample(d["shows"], n)
    keys = []
    for _, songs in shows:
        for _, t, a, _ in songs:
            k = f"{artists[a]}\t{titles[t]}"
            if k not in keys:
                keys.append(k)
    return keys, [s[0] for s in shows]


# --- text matching ------------------------------------------------------

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)              # (live), [remastered]
    s = re.sub(r"\s-\s.*(remaster|version|live|mono|stereo|edit|mix).*$", " ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^the ", "", s)


def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) > 3 and len(b) > 3 and (a in b or b in a):
        return 0.9
    return difflib.SequenceMatcher(None, a, b).ratio()


def artist_parts(s):
    return [p for p in re.split(r"\s*(?:&|\band\b|,|/|\bwith\b|\bfeat\.?|\bfeaturing\b)\s*", s, flags=re.I) if p.strip()]


def artist_sim(ours, theirs):
    """ours: our artist string; theirs: list of artist names on the candidate."""
    best = max([sim(ours, ", ".join(theirs))] + [sim(ours, t) for t in theirs])
    for part in artist_parts(ours):
        for t in theirs:
            if sim(part, t) >= 0.9:
                best = max(best, 0.85)
    return best


def judge(rec, title, artists, album, dur_s):
    ts, as_ = sim(rec["title"], title), artist_sim(rec["artist"], artists)
    als = sim(rec["album"], album) if rec["album"] and album else 0.0
    dur_ok = rec["est"] is not None and dur_s and abs(dur_s - rec["est"]) <= 75
    score = 0.5 * ts + 0.35 * as_ + 0.1 * als + 0.05 * bool(dur_ok)
    if ts >= 0.9 and (als >= 0.9 or sim(rec["artist"], album) >= 0.9):
        # Band-named albums: the sheet often credits "Twist of the Wrist" where
        # Spotify credits the players on an album of that name.
        as_ = max(as_, 0.6)
    if ts < 0.75 or as_ < 0.6:
        return None, score
    high = ts >= 0.9 and as_ >= 0.85 and (als >= 0.8 or dur_ok)
    return ("high" if high else "ok"), score


# --- plumbing -----------------------------------------------------------

def load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


class RateLimited(Exception):
    """The service asked us to come back much later (e.g. a daily cap)."""


def http_json(url, headers=None, data=None, tries=6):
    for attempt in range(tries):
        req = urllib.request.Request(url, data=data, headers={"User-Agent": "atr-archive/1.0", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", "5")) + 1
                if wait > 120:
                    raise RateLimited(f"asked to wait {wait / 3600:.1f} hours")
                print(f"  rate limited, waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            if e.code in (500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"gave up on {url}")


def env():
    return dict(l.strip().split("=", 1) for l in ENV.read_text().splitlines()
                if "=" in l and not l.lstrip().startswith("#"))


def clean_q(s):
    return re.sub(r'["\\:]', " ", s).strip()


class Runner:
    """Shared loop: walk recordings, skip ones already decided for this source, save often."""

    def __init__(self, source, keys, recs, limit):
        self.source, self.keys, self.recs, self.limit = source, keys, recs, limit
        self.links = load_json(LINKS, {})
        self.cache = load_json(CACHE / f"{source}.json", {})

    def todo(self, skip_if=(), require=()):
        out = []
        for k in self.keys:
            entry = self.links.get(k, {})
            if self.source in entry or any(s not in entry for s in require):
                continue
            if any(entry.get(s) for s in skip_if):  # already playable elsewhere
                continue
            out.append(k)
        return out[: self.limit] if self.limit else out

    def save(self):
        save_json(LINKS, self.links)
        save_json(CACHE / f"{self.source}.json", self.cache)

    def record(self, key, value):
        self.links.setdefault(key, {})[self.source] = value


# --- Spotify ------------------------------------------------------------

def spotify(keys, recs, limit):
    e = env()
    auth = base64.b64encode(f"{e['SPOTIFY_CLIENT_ID']}:{e['SPOTIFY_CLIENT_SECRET']}".encode()).decode()
    token = {"value": None, "at": 0}

    def get(q):
        if time.time() - token["at"] > 3000:
            t = http_json("https://accounts.spotify.com/api/token", data=b"grant_type=client_credentials",
                          headers={"Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded"})
            token.update(value=t["access_token"], at=time.time())
        url = "https://api.spotify.com/v1/search?type=track&limit=10&q=" + urllib.parse.quote(q)
        res = http_json(url, headers={"Authorization": "Bearer " + token["value"]})
        return [[t["id"], t["name"], [a["name"] for a in t["artists"]], t["album"]["name"], t["duration_ms"] / 1000]
                for t in res["tracks"]["items"] if t]

    run = Runner("sp", keys, recs, limit)
    todo = run.todo()
    print(f"Spotify: {len(todo)} recordings to search")
    try:
        _spotify_loop(run, todo, recs, get)
    except RateLimited as e:
        print(f"Spotify daily limit reached ({e}); progress saved, run again later.")
    run.save()


def _spotify_loop(run, todo, recs, get):
    for n, key in enumerate(todo, 1):
        rec = recs[key]
        best = None
        for q in (f'track:"{clean_q(rec["title"])}" artist:"{clean_q(rec["artist"])}"',
                  f'{clean_q(rec["title"])} {clean_q(artist_parts(rec["artist"])[0] if artist_parts(rec["artist"]) else rec["artist"])}'):
            if q not in run.cache:
                run.cache[q] = get(q)
                time.sleep(1.0)
            for tid, name, artists, album, dur in run.cache[q]:
                conf, score = judge(rec, name, artists, album, dur)
                if conf and (not best or score > best[2]):
                    best = (tid, conf, score)
            # Only fall back to the loose query when the strict one found nothing
            # at all; Spotify caps hobby apps at a few hundred searches a day.
            if best or run.cache[q]:
                break
        run.record(key, [best[0], best[1]] if best else None)
        if n % 50 == 0:
            run.save()
            print(f"  {n}/{len(todo)}", flush=True)


# --- Internet Archive ---------------------------------------------------

def archive(keys, recs, limit):
    run = Runner("ia", keys, recs, limit)
    todo = run.todo(skip_if=("sp",), require=("sp",))
    print(f"Archive.org: {len(todo)} recordings to search (Spotify misses only)")

    def search(rec):
        q = (f'title:("{clean_q(rec["title"])}") AND creator:("{clean_q(rec["artist"])}") '
             f'AND mediatype:(audio)')
        if q not in run.cache:
            url = ("https://archive.org/advancedsearch.php?rows=8&output=json&fl[]=identifier&fl[]=title"
                   "&fl[]=creator&q=" + urllib.parse.quote(q))
            run.cache[q] = http_json(url)["response"]["docs"]
            time.sleep(0.3)
        return run.cache[q]

    def files(ident):
        ck = "meta:" + ident
        if ck not in run.cache:
            m = http_json(f"https://archive.org/metadata/{urllib.parse.quote(ident)}")
            meta = m.get("metadata", {})
            restricted = str(meta.get("access-restricted-item", "")).lower() == "true" or m.get("is_dark")
            run.cache[ck] = {"restricted": bool(restricted),
                             "files": [[f["name"], f.get("title", ""), f.get("format", ""), float(f.get("length") or 0)]
                                       for f in m.get("files", []) if "MP3" in f.get("format", "")]}
            time.sleep(0.3)
        return run.cache[ck]

    for n, key in enumerate(todo, 1):
        rec = recs[key]
        found = None
        for doc in search(rec):
            creators = doc.get("creator") or []
            creators = creators if isinstance(creators, list) else [creators]
            if artist_sim(rec["artist"], creators) < 0.6:
                continue
            meta = files(doc["identifier"])
            if meta["restricted"] or not meta["files"]:
                continue
            item_title = doc.get("title") or ""
            if isinstance(item_title, list):
                item_title = item_title[0]
            if sim(rec["title"], item_title) >= 0.85:      # the item is the song (e.g. a 78)
                found = [doc["identifier"], meta["files"][0][0], "ok"]
            else:                                            # an album: look for the track
                for name, ftitle, _, _ in meta["files"]:
                    if sim(rec["title"], ftitle or Path(name).stem) >= 0.85:
                        found = [doc["identifier"], name, "ok"]
                        break
            if found:
                break
        run.record(key, found)
        if n % 25 == 0:
            run.save()
            print(f"  {n}/{len(todo)}", flush=True)
    run.save()


# --- YouTube (official Data API v3) -------------------------------------

def youtube(keys, recs, limit):
    key_ = env().get("YOUTUBE_API_KEY")
    if not key_:
        sys.exit("Add YOUTUBE_API_KEY=... to tools/.env first.")
    run = Runner("yt", keys, recs, limit or 95)  # search.list costs 100 of the 10,000 daily units
    todo = sorted(run.todo(skip_if=("sp", "ia"), require=("sp", "ia")), key=lambda k: -recs[k]["plays"])[: run.limit]
    print(f"YouTube: {len(todo)} searches this run")
    for key in todo:
        rec = recs[key]
        q = f'{rec["artist"]} {rec["title"]}'
        if q not in run.cache:
            url = ("https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5"
                   f"&videoEmbeddable=true&q={urllib.parse.quote(q)}&key={key_}")
            try:
                run.cache[q] = [[v["id"]["videoId"], v["snippet"]["title"], v["snippet"]["channelTitle"]]
                                for v in http_json(url)["items"]]
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    print("  daily quota used up; stopping")
                    break
                raise
        best = None
        for vid, vtitle, channel in run.cache[q]:
            # Video titles usually read "Artist - Song"; channel may be "Artist - Topic".
            ts = max(sim(rec["title"], vtitle), sim(rec["title"], vtitle.split(" - ", 1)[-1]))
            as_ = max(artist_sim(rec["artist"], [channel.replace(" - Topic", "")]),
                      0.85 if norm(rec["artist"]) and norm(rec["artist"]) in norm(vtitle) else 0)
            if ts >= 0.75 and as_ >= 0.6:
                conf = "high" if ts >= 0.9 and as_ >= 0.85 else "ok"
                if not best or (conf == "high" and best[1] != "high"):
                    best = [vid, conf]
        run.record(key, best)
    run.save()


# --- report -------------------------------------------------------------

def report(keys, recs, show_isos=None):
    links = load_json(LINKS, {})
    tally = {"sp": 0, "ia": 0, "yt": 0, "none": 0, "unsearched": 0}
    conf = {"high": 0, "ok": 0}
    for k in keys:
        e = links.get(k, {})
        hit = next((s for s in ("sp", "ia", "yt") if e.get(s)), None)
        if hit:
            tally[hit] += 1
            conf[e[hit][-1]] += 1
        elif "sp" in e:
            tally["none"] += 1
        else:
            tally["unsearched"] += 1
    total = len(keys)
    print(f"{total} recordings" + (f" from {len(show_isos)} shows" if show_isos else ""))
    for s, label in (("sp", "Spotify"), ("ia", "archive.org"), ("yt", "YouTube"), ("none", "not found yet"), ("unsearched", "not searched")):
        print(f"  {label:14} {tally[s]:6}  {100 * tally[s] / max(1, total):5.1f}%")
    print(f"  confidence: {conf['high']} high, {conf['ok']} ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["spotify", "archive", "youtube", "report"])
    ap.add_argument("--sample", type=int, help="only recordings from N random shows")
    ap.add_argument("--limit", type=int, help="stop after N recordings")
    args = ap.parse_args()

    d, recs = load_recordings()
    isos = None
    if args.sample:
        keys, isos = sample_keys(d, recs, args.sample)
    else:  # most-played first, so partial runs cover the most ground
        keys = sorted(recs, key=lambda k: -recs[k]["plays"])
    {"spotify": lambda: spotify(keys, recs, args.limit),
     "archive": lambda: archive(keys, recs, args.limit),
     "youtube": lambda: youtube(keys, recs, args.limit),
     "report": lambda: report(keys, recs, isos)}[args.cmd]()


if __name__ == "__main__":
    main()
