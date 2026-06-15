/* global maplibregl, mapillary, LOCATIONS */
"use strict";

/* ============================================================
 * GeoGuess — a small GeoGuessr-style game.
 *
 * Two view modes:
 *   - Street View (Mapillary): walk around real street imagery. Enabled when
 *     the player has saved a free Mapillary access token. The answer is the
 *     actual location of the street image shown.
 *   - Photo (fallback): a single Wikipedia photo of the place. Used when no
 *     token is set, or when a round has no nearby street imagery.
 *
 * Guess/result maps use MapLibre GL + OpenFreeMap (keyless vector tiles), with
 * labels relabelled to the device language.
 * ============================================================ */

const MAX_POINTS_PER_ROUND = 5000;
// Distance (km) over which the score decays by a factor of e. A guess ~250 km
// off still earns a healthy chunk; thousands of km earns almost nothing.
const SCORE_DECAY_KM = 1500;
// Anything within this distance is treated as a bullseye (full points).
const PERFECT_KM = 25;

// Keyless vector basemap. Labels are relabelled to the device language below.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// Two-letter device language (e.g. "sv", "en") used for OSM `name:<lang>` tags.
const LANG = (navigator.language || "en").toLowerCase().split("-")[0];

const TOKEN_KEY = "geoguess.mapillaryToken";

/* ---------------------- Game state ---------------------- */
const state = {
  deck: [],          // locations chosen for this game
  roundIndex: 0,     // 0-based current round
  totalScore: 0,
  guessLatLng: null, // player's current guess {lat,lng}
  truth: null,       // answer for the active round {lat,lng}
  mode: "photo",     // "street" | "photo"
};

/* ---------------------- DOM helpers --------------------- */
const $ = (id) => document.getElementById(id);
const screens = {
  start: $("start-screen"),
  game: $("game-screen"),
  result: $("result-screen"),
  summary: $("summary-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

/* ---------------------- Mapillary token ----------------- */
function getToken() {
  // A player's own token (saved in their browser) wins; otherwise fall back to
  // the baked-in public token from config.js so Street View works out of the box.
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return (window.GEOGUESS_CONFIG && window.GEOGUESS_CONFIG.mapillaryToken) || "";
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
function refreshTokenStatus() {
  const status = $("sv-status");
  const has = !!getToken();
  status.textContent = has
    ? "✓ Street View enabled — you'll walk around real imagery."
    : "No token set — you'll guess from photos.";
  status.classList.toggle("ok", has);
}

/* ---------------------- MapLibre maps ------------------- */
let guessMap = null;
let resultMap = null;
let guessMarker = null;
let resultMarkers = [];

// Relabel every symbol layer to the device language, falling back to the
// local name when a translation isn't present in the tiles.
function localizeLabels(map) {
  const expr = ["coalesce", ["get", "name:" + LANG], ["get", "name"]];
  for (const layer of map.getStyle().layers || []) {
    if (layer.type === "symbol" && layer.layout && "text-field" in layer.layout) {
      try { map.setLayoutProperty(layer.id, "text-field", expr); } catch { /* ignore */ }
    }
  }
}

function makeMap(container, interactive) {
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: [0, 20],
    zoom: 1,
    interactive,
    attributionControl: { compact: true },
  });
  map.on("style.load", () => localizeLabels(map));
  return map;
}

function initGuessMap() {
  if (guessMap) return;
  guessMap = makeMap("guess-map", true);
  guessMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  guessMap.on("click", (e) => setGuess(e.lngLat));
  // The panel grows on hover; keep the canvas in sync.
  $("guess-panel").addEventListener("transitionend", () => guessMap.resize());
}

function setGuess(lngLat) {
  state.guessLatLng = { lat: lngLat.lat, lng: lngLat.lng };
  if (!guessMarker) {
    guessMarker = new maplibregl.Marker({ draggable: true, color: "#2d6cdf" })
      .setLngLat(lngLat)
      .addTo(guessMap);
    guessMarker.on("dragend", () => {
      const ll = guessMarker.getLngLat();
      state.guessLatLng = { lat: ll.lat, lng: ll.lng };
    });
  } else {
    guessMarker.setLngLat(lngLat);
  }
  const btn = $("guess-btn");
  btn.disabled = false;
  btn.textContent = "Guess";
}

/* ---------------------- Geo + scoring ------------------- */
function haversineKm(a, b) {
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function scoreForDistance(km) {
  if (km <= PERFECT_KM) return MAX_POINTS_PER_ROUND;
  return Math.round(MAX_POINTS_PER_ROUND * Math.exp(-km / SCORE_DECAY_KM));
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/* ---------------------- Mapillary street view ----------- */
let viewer = null;
let viewerBroken = false; // if the viewer can't init, give up on street mode

// Diagnostic from the last Mapillary lookup, surfaced on screen when we have
// to fall back to a photo, so failures are debuggable from a screenshot.
let lastDiag = "";

// Find a *walkable* Mapillary image near a coordinate: one that belongs to a
// connected sequence (so the viewer shows movement arrows), preferring 360°
// panoramas. Widens the search until coverage is found. Returns
// { id, lat, lng } or null.
async function findMapillaryImage(lat, lng) {
  const token = getToken();
  if (!token) { lastDiag = "no token"; return null; }
  // Send the token the way mapillary-js does (Authorization: OAuth …), which
  // the API accepts cross-origin.
  const headers = { Authorization: "OAuth " + token };
  const halfSizes = [0.02, 0.08, 0.3]; // ~2km, 9km, 33km
  let sawImages = 0;
  for (const h of halfSizes) {
    const bbox = [lng - h, lat - h, lng + h, lat + h].join(",");
    const url =
      "https://graph.mapillary.com/images" +
      "?fields=id,is_pano,sequence,computed_geometry,geometry&limit=50&bbox=" + bbox;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      lastDiag = "network/CORS error: " + (e && e.message);
      continue;
    }
    if (!res.ok) {
      let body = "";
      try { body = (await res.text()).slice(0, 100); } catch { /* ignore */ }
      lastDiag = `HTTP ${res.status} ${body}`;
      continue;
    }
    let json;
    try { json = await res.json(); } catch { lastDiag = "bad JSON response"; continue; }
    const data = (json && json.data) || [];
    sawImages += data.length;
    if (!data.length) { lastDiag = "0 images in this area"; continue; }

    // Group images by sequence; a sequence with several images nearby means
    // there's a path to walk along.
    const seqs = new Map();
    for (const im of data) {
      const key = im.sequence || im.id;
      if (!seqs.has(key)) seqs.set(key, []);
      seqs.get(key).push(im);
    }
    // Score each sequence: more images = more walkable; bonus if it has panos.
    let best = null;
    for (const ims of seqs.values()) {
      const hasPano = ims.some((i) => i.is_pano);
      const score = ims.length + (hasPano ? 1000 : 0);
      if (!best || score > best.score) best = { score, ims };
    }
    const ims = best.ims;
    // Start on a panorama if available, otherwise the middle of the sequence.
    const chosen = ims.find((i) => i.is_pano) || ims[Math.floor(ims.length / 2)];
    const g = chosen.computed_geometry || chosen.geometry;
    const c = g && g.coordinates;
    if (c) { lastDiag = ""; return { id: chosen.id, lat: c[1], lng: c[0] }; }
  }
  if (sawImages && !lastDiag) lastDiag = "images found but no coordinates";
  return null;
}

function ensureViewer(imageId) {
  if (viewer) return viewer.moveTo(imageId);
  viewer = new mapillary.Viewer({
    accessToken: getToken(),
    container: "mly",
    imageId,
    component: {
      cover: false,
      // Navigation: arrows to adjacent images, sequence stepping, and keys.
      direction: true,
      sequence: true,
      pointer: true,
      zoom: true,
      keyboard: true,
    },
  });
  return Promise.resolve();
}

/* ---------------------- Imagery (photo fallback) -------- */
async function fetchImageForLocation(loc) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(loc.title)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  const data = await res.json();
  const src = (data.originalimage && data.originalimage.source) ||
              (data.thumbnail && data.thumbnail.source);
  if (!src) throw new Error("No image available for this location");
  return src;
}

function loadImg(imgEl, src) {
  return new Promise((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = () => reject(new Error("Image failed to load"));
    imgEl.src = src;
  });
}

/* ---------------------- Rounds -------------------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startGame() {
  const rounds = parseInt($("rounds-select").value, 10) || 5;
  state.deck = shuffle(LOCATIONS).slice(0, Math.min(rounds, LOCATIONS.length));
  state.roundIndex = 0;
  state.totalScore = 0;
  state.mode = getToken() && !viewerBroken ? "street" : "photo";
  $("round-total").textContent = state.deck.length;
  $("score-total").textContent = "0";
  showScreen("game");
  initGuessMap();
  setTimeout(() => guessMap.resize(), 80);
  loadRound();
}

// Reset the guess UI + map at the start of a round.
function resetGuessUI() {
  state.guessLatLng = null;
  $("round-current").textContent = state.roundIndex + 1;
  const btn = $("guess-btn");
  btn.disabled = true;
  btn.textContent = "Place a pin to guess";
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  guessMap.jumpTo({ center: [0, 20], zoom: 1 });
}

function showLoader(msg) {
  const loader = $("pano-loader");
  loader.classList.remove("hidden");
  loader.querySelector("p").textContent = msg;
}
function hideLoader() { $("pano-loader").classList.add("hidden"); }

let hintTimer = null;
// Show a hint pill over the view. `persistent` keeps it up (used to nudge
// players in photo mode); otherwise it fades after a few seconds.
function setPanoHint(text, persistent) {
  const hint = $("pano-hint");
  clearTimeout(hintTimer);
  hint.innerHTML = text;
  hint.classList.toggle("persistent", !!persistent);
  hint.classList.add("show");
  if (!persistent) hintTimer = setTimeout(() => hint.classList.remove("show"), 6000);
}

// Drop the current round (no imagery) and pull in a replacement so the game
// never gets stuck, then continue.
function skipRound(reason) {
  console.warn("Skipping round:", reason);
  state.deck.splice(state.roundIndex, 1);
  if (state.deck.length <= state.roundIndex) {
    const used = new Set(state.deck.map((l) => l.title));
    const extra = LOCATIONS.find((l) => !used.has(l.title));
    if (extra) state.deck.push(extra);
  }
  $("round-total").textContent = state.deck.length;
  if (state.deck.length === 0) {
    showLoader("No locations could be loaded. Check your connection.");
    return;
  }
  setTimeout(loadRound, 500);
}

async function loadRound() {
  const loc = state.deck[state.roundIndex];
  resetGuessUI();

  const img = $("pano-img");
  const mly = $("mly");
  img.classList.remove("ready");
  $("pano-credit").textContent = "";
  showLoader(state.mode === "street" ? "Finding a street nearby…" : "Finding a place…");

  if (state.mode === "street") {
    try {
      const hit = await findMapillaryImage(loc.lat, loc.lng);
      if (!hit) {
        // No street coverage near here — fall back to a photo for this round.
        await loadPhotoRound(loc, lastDiag);
        return;
      }
      state.truth = { lat: hit.lat, lng: hit.lng };
      await ensureViewer(hit.id);
      mly.style.display = "block";
      img.style.display = "none";
      setTimeout(() => viewer && viewer.resize(), 60);
      hideLoader();
      $("pano-credit").textContent = "Imagery © Mapillary contributors";
      setPanoHint("🚶 <b>Drag</b> to look around · tap the <b>arrows</b> on the street to move", false);
    } catch (err) {
      console.warn("Street view failed, falling back to photo:", err);
      viewerBroken = true; // viewer itself is unusable; stop trying it
      await loadPhotoRound(loc, "viewer error: " + (err && err.message));
    }
  } else {
    await loadPhotoRound(loc);
  }
}

async function loadPhotoRound(loc, diag) {
  const img = $("pano-img");
  $("mly").style.display = "none";
  img.style.display = "block";
  state.truth = { lat: loc.lat, lng: loc.lng };
  try {
    const src = await fetchImageForLocation(loc);
    await loadImg(img, src);
    img.classList.add("ready");
    hideLoader();
    $("pano-credit").textContent = "Photo: Wikimedia Commons";
    if (getToken()) {
      // Token is set but we couldn't load street imagery here. Show why.
      const why = diag ? ` (${diag})` : "";
      setPanoHint("📷 No walkable street imagery here — showing a photo" + why, false);
    } else {
      // No token at all: this is why it isn't walkable.
      setPanoHint(
        "📷 Photo mode — to <b>walk around</b> real streets, add a free " +
        "Mapillary token on the start screen (Play again → Street View)",
        true
      );
    }
  } catch (err) {
    skipRound(`${loc.name}: ${err.message}`);
  }
}

function submitGuess() {
  if (!state.guessLatLng || !state.truth) return;
  const loc = state.deck[state.roundIndex];
  const km = haversineKm(state.guessLatLng, state.truth);
  const points = scoreForDistance(km);
  state.totalScore += points;
  $("score-total").textContent = state.totalScore.toLocaleString();
  showResult(loc, state.truth, state.guessLatLng, km, points);
}

/* ---------------------- Result screen ------------------- */
function showResult(loc, truth, guess, km, points) {
  showScreen("result");
  $("result-distance").textContent = `${loc.name} — ${formatDistance(km)} away`;
  $("result-points").textContent = `${points.toLocaleString()} points`;
  $("next-btn").textContent =
    state.roundIndex + 1 >= state.deck.length ? "See results" : "Next round";

  if (!resultMap) resultMap = makeMap("result-map", true);

  const drawResult = () => {
    resultMap.resize();
    // Clear previous markers.
    resultMarkers.forEach((m) => m.remove());
    resultMarkers = [];

    const truthLngLat = [truth.lng, truth.lat];
    const guessLngLat = [guess.lng, guess.lat];

    resultMarkers.push(
      new maplibregl.Marker({ color: "#e8483b" }).setLngLat(truthLngLat)
        .setPopup(new maplibregl.Popup().setText(`📍 ${loc.name}`))
        .addTo(resultMap)
    );
    resultMarkers.push(
      new maplibregl.Marker({ color: "#2d6cdf" }).setLngLat(guessLngLat)
        .setPopup(new maplibregl.Popup().setText("Your guess"))
        .addTo(resultMap)
    );

    // Dashed line between guess and truth.
    const line = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [guessLngLat, truthLngLat] },
    };
    if (resultMap.getSource("guess-line")) {
      resultMap.getSource("guess-line").setData(line);
    } else {
      resultMap.addSource("guess-line", { type: "geojson", data: line });
      resultMap.addLayer({
        id: "guess-line",
        type: "line",
        source: "guess-line",
        paint: { "line-color": "#2d6cdf", "line-width": 2, "line-dasharray": [2, 2] },
      });
    }

    const bounds = new maplibregl.LngLatBounds(guessLngLat, guessLngLat);
    bounds.extend(truthLngLat);
    resultMap.fitBounds(bounds, { padding: 70, maxZoom: 6, duration: 0 });
  };

  if (resultMap.isStyleLoaded()) {
    setTimeout(drawResult, 60);
  } else {
    resultMap.once("idle", drawResult);
  }
}

function nextRound() {
  state.roundIndex += 1;
  if (state.roundIndex >= state.deck.length) {
    showSummary();
  } else {
    showScreen("game");
    setTimeout(() => guessMap.resize(), 80);
    loadRound();
  }
}

/* ---------------------- Summary ------------------------- */
function gradeFor(pct) {
  if (pct >= 0.9) return "🌟 World traveler!";
  if (pct >= 0.7) return "✈️ Seasoned explorer.";
  if (pct >= 0.5) return "🧭 Getting your bearings.";
  if (pct >= 0.3) return "🗺️ Room to roam.";
  return "🤷 Lost, but having fun!";
}

function showSummary() {
  const max = state.deck.length * MAX_POINTS_PER_ROUND;
  $("summary-score").textContent = state.totalScore.toLocaleString();
  $("summary-max").textContent = `out of ${max.toLocaleString()}`;
  $("summary-grade").textContent = gradeFor(max ? state.totalScore / max : 0);
  showScreen("summary");
}

/* ---------------------- Wire-up ------------------------- */
$("start-btn").addEventListener("click", startGame);
$("guess-btn").addEventListener("click", submitGuess);
$("next-btn").addEventListener("click", nextRound);
$("playagain-btn").addEventListener("click", () => showScreen("start"));

// Street View token panel.
$("sv-toggle").addEventListener("click", () => {
  const panel = $("sv-panel");
  panel.classList.toggle("hidden");
  $("sv-toggle").textContent =
    (panel.classList.contains("hidden") ? "▸" : "▾") + " Street View (optional, free)";
});
$("sv-save").addEventListener("click", () => {
  setToken($("sv-token").value.trim());
  refreshTokenStatus();
});
$("sv-clear").addEventListener("click", () => {
  setToken("");
  $("sv-token").value = "";
  refreshTokenStatus();
});
refreshTokenStatus();
