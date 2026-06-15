# 🌍 GeoGuess

A lightweight [GeoGuessr](https://www.geoguessr.com/)-style web game. You're shown
a photo of a place somewhere in the world — study it, then drop a pin on the map
where you think it is. The closer your guess, the more points (up to **5000** per
round).

## How to play

1. (Optional) Expand **Street View** on the start screen and paste a free
   [Mapillary](https://www.mapillary.com/dashboard/developers) access token to
   walk around real street imagery. Without one, you'll guess from photos.
2. Pick the number of rounds and hit **Start Game**.
3. Explore the view for clues (drag to look around in Street View).
4. Hover the mini-map in the bottom-right to expand it, then **click to drop a pin**.
5. Hit **Guess** to reveal the true location, the distance, and your score.
6. After the final round, see your total and grade. Play again!

## Street View (Mapillary)

Street-level "walk around" imagery comes from [Mapillary](https://www.mapillary.com/),
which is free but needs an access token. **A public, read-only token is baked
into `config.js`** so Street View works out of the box on the deployed site —
no setup required. Treat it as throwaway; regenerate it from the
[Mapillary dashboard](https://www.mapillary.com/dashboard/developers) if it ever
gets abused.

To use your **own** token instead (e.g. your own quota), on the start screen
expand **Street View**, paste it in, and **Save**. A personal token is stored
only in your browser (`localStorage`), never committed, and takes precedence
over the built-in one.

Coverage is crowdsourced, so a round with no nearby imagery automatically falls
back to a photo. Walk around with: **drag** to look, **tap the on-street arrows**
to move (arrow keys on desktop).

## Localized map

The guess/result maps use [MapLibre GL](https://maplibre.org/) with keyless
[OpenFreeMap](https://openfreemap.org/) vector tiles. Labels are relabelled to
your device language (`navigator.language`), falling back to each place's local
name where a translation isn't available in the tiles.

## Scoring

Points decay with distance from the true location:

```
points = 5000 · e^(−distance_km / 1500)
```

A guess within ~25 km earns the full 5000. Halfway around the world earns almost
nothing.

## Running locally

No build step and no `npm install` required — the only dependency is a static
file server, and a zero-dependency one ships in `server.js`.

```bash
npm start                # serves on http://localhost:5173
# or pick a port:
PORT=8080 npm start
```

You can also serve the folder with anything else, e.g.:

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

> An internet connection is needed at play time: map tiles come from
> OpenFreeMap, MapLibre/Mapillary are loaded from a CDN, photos from the
> Wikipedia REST API, and (optionally) street imagery from Mapillary. The only
> credential is your own optional Mapillary token.

## How it works

| Concern        | Choice                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| Guess map      | [MapLibre GL](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) vector tiles (no key), labels localized to device language |
| Street view    | [Mapillary JS](https://mapillary.github.io/mapillary-js/) walk-around viewer (free token) |
| Location photo | Wikipedia REST summary API, keyed by article title (CORS-enabled)       |
| Distance       | Haversine great-circle distance                                         |
| Stack          | Plain HTML/CSS/vanilla JS — no framework, no bundler                     |

## Project layout

```
index.html     # screens: start / game / result / summary
styles.css     # all styling
locations.js   # curated locations (name, Wikipedia title, lat/lng)
game.js        # game loop, scoring, Leaflet maps, image fetching
server.js      # zero-dependency static server
```

## Adding locations

Append to the array in `locations.js`:

```js
{ name: "Pretty Place", title: "Wikipedia_Article_Title", lat: 12.34, lng: 56.78 }
```

The `title` must match an English Wikipedia article that has a lead image. The
`lat`/`lng` are the real coordinates used to score guesses.

## License

MIT
