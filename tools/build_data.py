"""Build data/atr.json from an .xlsx export of the "All the Traditions" Google Sheet.

Usage: python tools/build_data.py path/to/export.xlsx

Reads the Log tab (Date, Time, Song, Artist, Album) and writes a compact,
dictionary-encoded JSON file the site loads at startup.
"""
import datetime
import json
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "data" / "atr.json"


def text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def main(xlsx_path):
    ws = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)["Log"]
    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    assert header[:5] == ("Date", "Time", "Song", "Artist", "Album"), header

    artists, titles, albums = {}, {}, {}

    def idx(table, key):
        if key not in table:
            table[key] = len(table)
        return table[key]

    shows = {}
    for r in rows:
        if not r[0]:
            continue
        date = r[0].date().isoformat() if isinstance(r[0], datetime.datetime) else str(r[0])
        t = r[1]
        minutes = t.hour * 60 + t.minute if isinstance(t, datetime.time) else 0
        title, artist, album = text(r[2]), text(r[3]), text(r[4])
        a = idx(artists, artist)
        al = idx(albums, (album, a)) if album else -1
        shows.setdefault(date, []).append([minutes, idx(titles, title), a, al])

    data = {
        "generated": datetime.date.today().isoformat(),
        "artists": list(artists),
        "titles": list(titles),
        "albums": [[name, a] for name, a in albums],
        # newest show first; songs keep sheet order (airtime order)
        "shows": [[d, shows[d]] for d in sorted(shows, reverse=True)],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(s) for s in shows.values())
    print(f"{len(shows)} shows, {n} songs, {len(artists)} artists, {len(titles)} titles, "
          f"{len(albums)} albums -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
