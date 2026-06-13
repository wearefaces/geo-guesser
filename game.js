/* global L, LOCATIONS */
"use strict";

/* ============================================================
 * GeoGuess — a small GeoGuessr-style game.
 *
 * Flow: start screen -> N rounds (photo + guess map) -> per-round
 * result with the true location revealed -> final summary.
 * ============================================================ */

const MAX_POINTS_PER_ROUND = 5000;
// Distance (km) over which the score decays by a factor of e. A guess ~250 km
// off still earns a healthy chunk; thousands of km earns almost nothing.
const SCORE_DECAY_KM = 1500;
// Anything within this distance is treated as a bullseye (full points).
const PERFECT_KM = 25;

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* ---------------------- Game state ---------------------- */
const state = {
  deck: [],          // locations chosen for this game
  roundIndex: 0,     // 0-based current round
  totalScore: 0,
  guessLatLng: null, // player's current guess for the active round
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

/* ---------------------- Leaflet maps -------------------- */
// Created lazily and reused across rounds.
let guessMap = null;
let resultMap = null;
let guessMarker = null;

function makeMap(elId) {
  const map = L.map(elId, {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 1);
  L.tileLayer(OSM_TILES, { attribution: OSM_ATTR, maxZoom: 19, noWrap: false }).addTo(map);
  return map;
}

function initGuessMap() {
  if (guessMap) return;
  guessMap = makeMap("guess-map");
  guessMap.on("click", (e) => setGuess(e.latlng));
}

function setGuess(latlng) {
  state.guessLatLng = latlng;
  if (!guessMarker) {
    guessMarker = L.marker(latlng, { draggable: true }).addTo(guessMap);
    guessMarker.on("dragend", () => {
      state.guessLatLng = guessMarker.getLatLng();
    });
  } else {
    guessMarker.setLatLng(latlng);
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
  const pts = MAX_POINTS_PER_ROUND * Math.exp(-km / SCORE_DECAY_KM);
  return Math.round(pts);
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/* ---------------------- Imagery ------------------------- */
// Fetch a usable photo URL for a location from the Wikipedia REST API.
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

// Resolve <img> load/error into a promise so we can fail gracefully.
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
  $("round-total").textContent = state.deck.length;
  $("score-total").textContent = "0";
  showScreen("game");
  initGuessMap();
  loadRound();
}

async function loadRound() {
  const loc = state.deck[state.roundIndex];
  state.guessLatLng = null;

  // Reset guess UI.
  $("round-current").textContent = state.roundIndex + 1;
  const btn = $("guess-btn");
  btn.disabled = true;
  btn.textContent = "Place a pin to guess";
  if (guessMarker) {
    guessMap.removeLayer(guessMarker);
    guessMarker = null;
  }
  guessMap.setView([20, 0], 1);

  // Reset photo + show loader.
  const img = $("pano-img");
  const loader = $("pano-loader");
  img.classList.remove("ready");
  loader.classList.remove("hidden");
  loader.querySelector("p").textContent = "Finding a place…";
  $("pano-credit").textContent = "";

  try {
    const src = await fetchImageForLocation(loc);
    await loadImg(img, src);
    img.classList.add("ready");
    loader.classList.add("hidden");
    $("pano-credit").textContent = "Photo: Wikimedia Commons";
    // Refresh map sizing now the screen is visible.
    setTimeout(() => guessMap.invalidateSize(), 100);
  } catch (err) {
    // Could not load this place — skip to the next playable one so the
    // game never gets stuck on a broken round.
    console.warn(`Skipping ${loc.name}:`, err);
    loader.querySelector("p").textContent = "Hmm, that one didn't load. Trying another…";
    state.deck.splice(state.roundIndex, 1);
    if (state.deck.length <= state.roundIndex) {
      // Pull in a fresh location not already in the deck.
      const used = new Set(state.deck.map((l) => l.title));
      const extra = LOCATIONS.find((l) => !used.has(l.title));
      if (extra) state.deck.push(extra);
    }
    $("round-total").textContent = state.deck.length;
    if (state.deck.length === 0) {
      loader.querySelector("p").textContent = "No locations could be loaded. Check your connection.";
      return;
    }
    setTimeout(loadRound, 600);
  }
}

function submitGuess() {
  if (!state.guessLatLng) return;
  const loc = state.deck[state.roundIndex];
  const truth = { lat: loc.lat, lng: loc.lng };
  const km = haversineKm(state.guessLatLng, truth);
  const points = scoreForDistance(km);
  state.totalScore += points;
  $("score-total").textContent = state.totalScore.toLocaleString();

  showResult(loc, truth, state.guessLatLng, km, points);
}

/* ---------------------- Result screen ------------------- */
function showResult(loc, truth, guess, km, points) {
  showScreen("result");

  $("result-distance").textContent = `${loc.name} — ${formatDistance(km)} away`;
  $("result-points").textContent = `${points.toLocaleString()} points`;
  $("next-btn").textContent =
    state.roundIndex + 1 >= state.deck.length ? "See results" : "Next round";

  if (!resultMap) {
    resultMap = makeMap("result-map");
  }
  // Clear previous round's markers/lines.
  resultMap.eachLayer((layer) => {
    if (!(layer instanceof L.TileLayer)) resultMap.removeLayer(layer);
  });

  const truthLL = L.latLng(truth.lat, truth.lng);
  const guessLL = L.latLng(guess.lat, guess.lng);

  L.marker(truthLL).addTo(resultMap).bindPopup(`📍 ${loc.name}`).openPopup();
  L.circleMarker(guessLL, {
    radius: 8,
    color: "#2d6cdf",
    fillColor: "#2d6cdf",
    fillOpacity: 0.9,
  }).addTo(resultMap).bindPopup("Your guess");
  L.polyline([guessLL, truthLL], {
    color: "#2d6cdf",
    weight: 2,
    dashArray: "6 8",
  }).addTo(resultMap);

  // Make sure both points are comfortably in view.
  setTimeout(() => {
    resultMap.invalidateSize();
    resultMap.fitBounds(L.latLngBounds([guessLL, truthLL]).pad(0.4), {
      maxZoom: 6,
    });
  }, 100);
}

function nextRound() {
  state.roundIndex += 1;
  if (state.roundIndex >= state.deck.length) {
    showSummary();
  } else {
    showScreen("game");
    setTimeout(() => guessMap.invalidateSize(), 100);
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
