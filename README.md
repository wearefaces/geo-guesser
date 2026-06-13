# 🌍 GeoGuess

A lightweight [GeoGuessr](https://www.geoguessr.com/)-style web game. You're shown
a photo of a place somewhere in the world — study it, then drop a pin on the map
where you think it is. The closer your guess, the more points (up to **5000** per
round).

## How to play

1. Pick the number of rounds and hit **Start Game**.
2. Look at the photo for clues.
3. Hover the mini-map in the bottom-right to expand it, then **click to drop a pin**.
4. Hit **Guess** to reveal the true location, the distance, and your score.
5. After the final round, see your total and grade. Play again!

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

> An internet connection is needed at play time: the map tiles come from
> OpenStreetMap, Leaflet is loaded from a CDN, and location photos are fetched
> from the Wikipedia REST API. No API keys are required.

## How it works

| Concern        | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Guess map      | [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles (no API key)   |
| Location photo | Wikipedia REST summary API, keyed by article title (CORS-enabled)      |
| Distance       | Haversine great-circle distance                                        |
| Stack          | Plain HTML/CSS/vanilla JS — no framework, no bundler                    |

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
