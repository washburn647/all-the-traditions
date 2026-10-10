# All the Traditions archive

A browsable archive of every posted playlist from *All the Traditions*, Robert
Resnik's folk show on Vermont Public (610 shows, April 2013 – June 2025).

Plain static site — no build step. `index.html` loads `js/app.js` (ES modules),
which fetches `data/atr.json`.

## Run locally

```
python -m http.server 8790
```

then open http://localhost:8790.

## Updating the data

The source of truth is the "All the Traditions" Google Sheet (Log tab). Export
it as .xlsx, then:

```
python tools/build_data.py path/to/export.xlsx
```

## Layout

| Path | What |
|---|---|
| `js/data.js` | Loads the JSON, builds play/artist/song/album indexes |
| `js/season.js` | Time-of-year matching and holiday Sundays |
| `js/charts.js` | Column charts with hover tooltips |
| `js/views/` | One module per page (home, shows, artist/song/album, stats, search) |
| `tools/build_data.py` | Sheet export → `data/atr.json` |

Routes are hash-based: `#/show/2019-11-24`, `#/artist/Bob%20Dylan`,
`#/song/Tam%20Lin`, `#/album/<artist>/<album>`, `#/season/12-25`,
`#/stats/2019`, `#/search/<text>`, `#/random`.
