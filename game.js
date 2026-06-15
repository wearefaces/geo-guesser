/* global google, LOCATIONS */
"use strict";

/* ============================================================
 * GeoGuess — a GeoGuessr-style game built on Google Street View.
 *
 * Each round drops the player into a real Street View panorama near a curated
 * location. They walk around (Google's chevron arrows), then drop a pin on the
 * Google map to guess. Score decays with great-circle distance from the
 * panorama's actual location.
 *
 * Needs a Google Maps JavaScript API key (Street View + Maps). It is read from
 * a player's saved key (localStorage) or the baked-in one in config.js. The
 * device language is passed to the Maps API so map labels localize.
 * ============================================================ */

const MAX_POINTS_PER_ROUND = 5000;
const SCORE_DECAY_KM = 1500;
const PERFECT_KM = 25;
const LANG = (navigator.language || "en").toLowerCase().split("-")[0];
const KEY_LS = "geoguess.googleKey";

const state = {
  deck: [],
  roundIndex: 0,
  totalScore: 0,
  guessLatLng: null, // {lat,lng}
  truth: null,       // {lat,lng}
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

/* ---------------------- API key ------------------------- */
function getKey() {
  try {
    const stored = localStorage.getItem(KEY_LS);
    if (stored) return stored;
  } catch { /* ignore */ }
  return (window.GEOGUESS_CONFIG && window.GEOGUESS_CONFIG.googleMapsKey) || "";
}
function setKey(k) {
  try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch { /* ignore */ }
}
function refreshKeyStatus() {
  const status = $("sv-status");
  const has = !!getKey();
  status.textContent = has
    ? "✓ Google Maps key set — Street View ready."
    : "No key set — add one to play.";
  status.classList.toggle("ok", has);
}

/* ---------------------- Load Google Maps ---------------- */
let mapsPromise = null;
function loadGoogleMaps() {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const key = getKey();
    if (!key) return reject(new Error("Add a Google Maps API key on the start screen to play."));
    // Google rejects a bad/forbidden key via this global hook.
    window.gm_authFailure = () =>
      reject(new Error("Google rejected the key — check billing, that the Maps JavaScript API is enabled, and that this domain is allowed (HTTP referrer restriction)."));
    window.__gmReady = () => resolve();
    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) +
      "&v=weekly&language=" + encodeURIComponent(LANG) + "&callback=__gmReady";
    s.async = true;
    s.onerror = () => reject(new Error("Couldn't load Google Maps (network blocked or bad key)."));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

/* ---------------------- Maps ---------------------------- */
let guessMap = null, guessMarker = null;
let resultMap = null, resultMarkers = [], resultLine = null;

function makeMap(div, interactive) {
  return new google.maps.Map(div, {
    center: { lat: 20, lng: 0 },
    zoom: 1,
    disableDefaultUI: true,
    zoomControl: interactive,
    gestureHandling: interactive ? "greedy" : "none",
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
  });
}

function initGuessMap() {
  if (guessMap) return;
  guessMap = makeMap($("guess-map"), true);
  guessMap.addListener("click", (e) => setGuess(e.latLng));
  // The panel grows on hover; keep the canvas in sync.
  $("guess-panel").addEventListener("transitionend", () => {
    google.maps.event.trigger(guessMap, "resize");
  });
}

function setGuess(latLng) {
  state.guessLatLng = { lat: latLng.lat(), lng: latLng.lng() };
  if (!guessMarker) {
    guessMarker = new google.maps.Marker({ position: latLng, map: guessMap, draggable: true });
    guessMarker.addListener("dragend", () => {
      const p = guessMarker.getPosition();
      state.guessLatLng = { lat: p.lat(), lng: p.lng() };
    });
  } else {
    guessMarker.setPosition(latLng);
  }
  const btn = $("guess-btn");
  btn.disabled = false;
  btn.textContent = "Guess";
}

/* ---------------------- Geo + scoring ------------------- */
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
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

/* ---------------------- Street View --------------------- */
let panorama = null, svService = null;

// Find the nearest outdoor Street View panorama to a seed, widening the radius
// until one is found. Returns { pano, lat, lng } or null.
function findPano(lat, lng) {
  return new Promise((resolve) => {
    if (!svService) svService = new google.maps.StreetViewService();
    const radii = [1000, 5000, 25000, 100000];
    let i = 0;
    const attempt = () => {
      svService.getPanorama(
        {
          location: { lat, lng },
          radius: radii[i],
          source: google.maps.StreetViewSource.OUTDOOR,
          preference: google.maps.StreetViewPreference.NEAREST,
        },
        (data, status) => {
          if (status === google.maps.StreetViewStatus.OK && data && data.location) {
            const ll = data.location.latLng;
            resolve({ pano: data.location.pano, lat: ll.lat(), lng: ll.lng() });
          } else if (++i < radii.length) {
            attempt();
          } else {
            resolve(null);
          }
        }
      );
    };
    attempt();
  });
}

function ensurePanorama(panoId) {
  if (panorama) { panorama.setPano(panoId); return; }
  panorama = new google.maps.StreetViewPanorama($("sv"), {
    pano: panoId,
    addressControl: false,    // hide the place name (fair guessing)
    showRoadLabels: false,    // hide street names
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    linksControl: true,       // the chevron arrows to walk
    panControl: true,
    zoomControl: true,
    enableCloseButton: false,
  });
}

/* ---------------------- Photo fallback ------------------ */
// Used only when a round's seed has no nearby Street View at all.
async function fetchImageForLocation(loc) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(loc.title)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
  const data = await res.json();
  const src = (data.originalimage && data.originalimage.source) ||
              (data.thumbnail && data.thumbnail.source);
  if (!src) throw new Error("No image available");
  return src;
}
function loadImg(imgEl, src) {
  return new Promise((resolve, reject) => {
    imgEl.onload = () => resolve();
    imgEl.onerror = () => reject(new Error("Image failed to load"));
    imgEl.src = src;
  });
}

/* ---------------------- Hint pill ----------------------- */
let hintTimer = null;
function setPanoHint(text, persistent) {
  const hint = $("pano-hint");
  clearTimeout(hintTimer);
  hint.innerHTML = text;
  hint.classList.toggle("persistent", !!persistent);
  hint.classList.add("show");
  if (!persistent) hintTimer = setTimeout(() => hint.classList.remove("show"), 6000);
}
function showLoader(msg) {
  const loader = $("pano-loader");
  loader.classList.remove("hidden");
  loader.querySelector("p").textContent = msg;
}
function hideLoader() { $("pano-loader").classList.add("hidden"); }

/* ---------------------- Rounds -------------------------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startGame() {
  const rounds = parseInt($("rounds-select").value, 10) || 5;
  try {
    showLoaderOnStart(true);
    await loadGoogleMaps();
  } catch (err) {
    showLoaderOnStart(false);
    const status = $("sv-status");
    status.textContent = "⚠️ " + err.message;
    status.classList.remove("ok");
    $("sv-panel").classList.remove("hidden");
    return;
  }
  showLoaderOnStart(false);

  state.deck = shuffle(LOCATIONS).slice(0, Math.min(rounds, LOCATIONS.length));
  state.roundIndex = 0;
  state.totalScore = 0;
  $("round-total").textContent = state.deck.length;
  $("score-total").textContent = "0";
  showScreen("game");
  initGuessMap();
  setTimeout(() => google.maps.event.trigger(guessMap, "resize"), 80);
  loadRound();
}

function showLoaderOnStart(on) {
  const btn = $("start-btn");
  btn.disabled = on;
  btn.textContent = on ? "Loading…" : "Start Game";
}

function resetGuessUI() {
  state.guessLatLng = null;
  $("round-current").textContent = state.roundIndex + 1;
  const btn = $("guess-btn");
  btn.disabled = true;
  btn.textContent = "Place a pin to guess";
  if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
  guessMap.setCenter({ lat: 20, lng: 0 });
  guessMap.setZoom(1);
}

function skipRound(reason) {
  console.warn("Skipping round:", reason);
  state.deck.splice(state.roundIndex, 1);
  if (state.deck.length <= state.roundIndex) {
    const used = new Set(state.deck.map((l) => l.title));
    const extra = LOCATIONS.find((l) => !used.has(l.title));
    if (extra) state.deck.push(extra);
  }
  $("round-total").textContent = state.deck.length;
  if (state.deck.length === 0) { showLoader("Couldn't load any locations."); return; }
  setTimeout(loadRound, 400);
}

async function loadRound() {
  const loc = state.deck[state.roundIndex];
  resetGuessUI();
  $("pano-img").classList.remove("ready");
  $("pano-credit").textContent = "";
  showLoader("Finding a street…");

  const hit = await findPano(loc.lat, loc.lng);
  if (hit) {
    state.truth = { lat: hit.lat, lng: hit.lng };
    ensurePanorama(hit.pano);
    $("sv").style.display = "block";
    $("pano-img").style.display = "none";
    hideLoader();
    setPanoHint("🚶 <b>Drag</b> to look around · click the <b>arrows</b> to walk", false);
  } else {
    await loadPhotoRound(loc);
  }
}

async function loadPhotoRound(loc) {
  const img = $("pano-img");
  $("sv").style.display = "none";
  img.style.display = "block";
  state.truth = { lat: loc.lat, lng: loc.lng };
  try {
    const src = await fetchImageForLocation(loc);
    await loadImg(img, src);
    img.classList.add("ready");
    hideLoader();
    $("pano-credit").textContent = "Photo: Wikimedia Commons";
    setPanoHint("📷 No Street View here — showing a photo for this round", false);
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

/* ---------------------- Result -------------------------- */
function showResult(loc, truth, guess, km, points) {
  showScreen("result");
  $("result-distance").textContent = `${loc.name} — ${formatDistance(km)} away`;
  $("result-points").textContent = `${points.toLocaleString()} points`;
  $("next-btn").textContent =
    state.roundIndex + 1 >= state.deck.length ? "See results" : "Next round";

  if (!resultMap) resultMap = makeMap($("result-map"), true);

  resultMarkers.forEach((m) => m.setMap(null));
  resultMarkers = [];
  if (resultLine) { resultLine.setMap(null); resultLine = null; }

  const t = { lat: truth.lat, lng: truth.lng };
  const g = { lat: guess.lat, lng: guess.lng };

  resultMarkers.push(new google.maps.Marker({ position: t, map: resultMap, label: "📍", title: loc.name }));
  resultMarkers.push(new google.maps.Marker({
    position: g, map: resultMap, title: "Your guess",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 7, fillColor: "#2d6cdf", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2,
    },
  }));
  resultLine = new google.maps.Polyline({
    path: [g, t], map: resultMap, geodesic: true,
    strokeColor: "#2d6cdf", strokeOpacity: 0.85, strokeWeight: 2,
  });

  const bounds = new google.maps.LatLngBounds();
  bounds.extend(t); bounds.extend(g);
  setTimeout(() => {
    google.maps.event.trigger(resultMap, "resize");
    resultMap.fitBounds(bounds, 70);
  }, 80);
}

function nextRound() {
  state.roundIndex += 1;
  if (state.roundIndex >= state.deck.length) {
    showSummary();
  } else {
    showScreen("game");
    setTimeout(() => google.maps.event.trigger(guessMap, "resize"), 80);
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

$("sv-toggle").addEventListener("click", () => {
  const panel = $("sv-panel");
  panel.classList.toggle("hidden");
  $("sv-toggle").textContent =
    (panel.classList.contains("hidden") ? "▸" : "▾") + " Google Maps API key";
});
$("sv-save").addEventListener("click", () => { setKey($("sv-token").value.trim()); refreshKeyStatus(); });
$("sv-clear").addEventListener("click", () => { setKey(""); $("sv-token").value = ""; refreshKeyStatus(); });
refreshKeyStatus();
