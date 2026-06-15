# 🌍 GeoGuess

A [GeoGuessr](https://www.geoguessr.com/)-style web game. You're dropped into a
real **Google Street View** panorama somewhere in the world — walk around for
clues, then drop a pin on the map to guess where you are. The closer (and
faster) your guess, the more points, up to **5000** per round.

▶ **Play:** https://wearefaces.github.io/geo-guesser/

## How to play

1. Pick the number of **rounds** and the **time per round** (∞ / 1:00 / 2:00).
2. Hit **Play**.
3. **Walk the street view** — drag to look around, click the arrows to move.
4. Tap the mini-map to open it and **drop a pin**, then hit **Guess** (or let the
   timer run out — no pin scores 0 and reveals the spot).
5. After the last round, see your total, grade, and a per-round breakdown — then
   **Share** your result to challenge friends.

## Scoring

Points decay with distance from the panorama's true location:

```
points = 5000 · e^(−distance_km / 1500)   (5000 within ~25 km)
```

## Features

- **Google Street View** with full chevron-arrow walking and a Google guess map.
- **Road-only locations** (`StreetViewSource.GOOGLE`) — you always land on a
  street, never an isolated photosphere in a desert or forest.
- **Per-round timer** with auto-submit on time-out.
- **Device-language map** — labels follow `navigator.language`.
- **Shareable results** (Web Share API, clipboard fallback) with an emoji
  score strip, for challenging friends.
- Mobile-first UI: tap-to-expand map, animated score reveal, score bars.

## Google Maps API key

The game needs a Google Maps JavaScript API key (Street View + Maps). A key is
baked into `config.js` so the deployed site works with no setup. Because it
ships in the public page, it **must** be restricted in the
[Google Cloud console](https://console.cloud.google.com/google/maps-apis/credentials):

- **Application restrictions → Websites** → allow `https://wearefaces.github.io/*`
- **API restrictions** → Maps JavaScript API
- Billing must be enabled, and a **daily quota cap** is recommended.

Players can override the key with their own via the start screen's **Advanced**
panel; a personal key is stored only in their browser (`localStorage`).

## Running locally

No build step and no `npm install` — a zero-dependency static server ships in
`server.js`:

```bash
npm start                 # http://localhost:5173
PORT=8080 npm start       # custom port
```

(Add `http://localhost:*/*` to the key's allowed referrers to test locally.)

## How it works

| Concern        | Choice                                                              |
| -------------- | ------------------------------------------------------------------- |
| Street view    | Google Maps JavaScript API — `StreetViewPanorama`, source `GOOGLE`  |
| Guess map      | Google Maps, localized to the device language                       |
| Distance       | Haversine great-circle distance                                     |
| Hosting        | GitHub Pages (auto-deploy from `main` via Actions)                  |
| Stack          | Plain HTML/CSS/vanilla JS — no framework, no bundler                |

## Project layout

```
index.html     # screens: start / game / result / summary
styles.css     # all styling
config.js      # baked-in Google Maps API key
locations.js   # curated location seeds (name, lat/lng)
game.js        # game loop, timer, scoring, Street View, maps, sharing
server.js      # zero-dependency static server
```

## Adding locations

Append to the array in `locations.js` — pick spots with Google Street View
coverage (cities, landmarks, roads):

```js
{ name: "Pretty Place", title: "Wikipedia_Article_Title", lat: 12.34, lng: 56.78 }
```

`lat`/`lng` seed the area; the nearest road panorama becomes the round. `title`
is used only for the rare no-coverage photo fallback.

## License

MIT
