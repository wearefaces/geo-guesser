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
  currentName: "",   // reverse-geocoded name of the current round
  rounds: 5,         // chosen via the segmented control
  results: [],       // [{ name, km, points }] for share + summary
  timeLimit: 60,     // seconds per round (0 = no timer)
  timeLeft: 0,
  timerId: null,
};

/* ---------------------- DOM helpers --------------------- */
const $ = (id) => document.getElementById(id);
const screens = {
  start: $("start-screen"),
  game: $("game-screen"),
  result: $("result-screen"),
  summary: $("summary-screen"),
  profile: $("profile-screen"),
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
  updateGuessButton();
}

// The bottom button is always useful: with no pin it opens the map; once a pin
// is placed it submits the guess. The live countdown is shown on it too.
function updateGuessButton() {
  const btn = $("guess-btn");
  let label = state.guessLatLng ? "Guess" : "Open map";
  const timed = state.timeLimit && state.timerId;
  if (timed) label += " · " + formatTime(Math.max(0, state.timeLeft));
  btn.textContent = label;
  btn.disabled = false;
  btn.classList.toggle("danger", !!timed && state.timeLeft <= 10);
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
// Flat monochrome icons (inline SVG, currentColor).
const SVG = {
  walk: '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>',
  target: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/></svg>',
  star: '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 3 14.7 8.6 21 9.3 16.5 13.6 17.6 19.9 12 16.9 6.4 19.9 7.5 13.6 3 9.3 9.3 8.6 12 3"/></svg>',
  thumb: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 11l4-8a2 2 0 0 1 3 1.8V9h4.6a2 2 0 0 1 2 2.4l-1.3 7A2 2 0 0 1 17.3 20H7"/></svg>',
  compass: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5"/></svg>',
  xcircle: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  clock: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>',
  heartFill: '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/></svg>',
  heartHalf: '<svg class="ic ic--fill half" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/></svg>',
  heartOutline: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/></svg>',
  globe: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
  award: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="6"/><polyline points="8.5 14 7.5 21 12 18.5 16.5 21 15.5 14"/></svg>',
  bolt: '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 2 4 14 11 14 9 22 20 9 13 9 13 2"/></svg>',
  pin: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.8"/></svg>',
  lock: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg class="ic ic--stroke" viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 12 10 18 20 6"/></svg>',
};
function iconForPoints(p) {
  if (p >= 4500) return SVG.target;
  if (p >= 3500) return SVG.star;
  if (p >= 2000) return SVG.thumb;
  if (p >= 800) return SVG.compass;
  return SVG.xcircle;
}

/* ---------------------- UI feedback --------------------- */
function animateNumber(el, to, dur = 750) {
  const from = 0, start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * ease(p)).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
const GAME_URL = "https://wearefaces.github.io/geo-guesser/";
async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ title: "GeoGuess", text, url: GAME_URL }); return; }
    catch { /* user cancelled or unsupported — fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(text + "\n" + GAME_URL); toast("Copied to clipboard"); }
  catch { toast("Couldn't share"); }
}

/* ---------------------- Round timer --------------------- */
function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function renderTimer() {
  updateGuessButton(); // the countdown lives on the action button now
}
function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}
function startTimer() {
  state.timeLeft = state.timeLimit;
  resumeTimer();
}
// Restart the countdown interval from the current timeLeft (used to resume
// after the game was paused, e.g. while viewing the profile).
function resumeTimer() {
  stopTimer();
  if (!state.timeLimit) { renderTimer(); return; }
  state.timerId = setInterval(() => {
    state.timeLeft -= 1;
    renderTimer();
    if (state.timeLeft <= 0) { stopTimer(); toast("Time's up!"); finishRound(); }
  }, 1000);
  renderTimer(); // show the countdown immediately (timerId is now set)
}

/* ---------------------- Ambient players ----------------- */
// Simulated "online" players dropping pins on the guess map for a lively,
// social feel. Purely cosmetic — never affects scoring or the player's pin.
const PLAYER_COLORS = ["#2f6bff", "#18c98a", "#f4b740", "#ff5d6c", "#a855f7", "#06b6d4", "#fb7185", "#f97316"];
const PLAYER_INITIALS = "ABCDEFGHIJKLMNOPRSTVWYZ".split("");
let ambientTimer = null, onlineTimer = null, ambientMarkers = [];
let onlineCount = 0;

// Build a little avatar "bubble" marker (coloured circle + initial + tail) as
// an inline SVG data URI — no network, looks like a player on the map.
function avatarDataUri(letter, color) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">' +
    '<path d="M20 47 L11 31 H29 Z" fill="' + color + '"/>' +
    '<circle cx="20" cy="18" r="16" fill="' + color + '" stroke="#fff" stroke-width="3"/>' +
    '<text x="20" y="24" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">' + letter + '</text>' +
    '</svg>';
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function renderOnline() {
  const el = $("online-count");
  if (el) el.textContent = onlineCount.toLocaleString();
}
function startOnline() {
  if (!onlineCount) onlineCount = 900 + Math.floor(Math.random() * 2600);
  renderOnline();
  clearInterval(onlineTimer);
  onlineTimer = setInterval(() => {
    onlineCount = Math.max(750, onlineCount + Math.floor(Math.random() * 21) - 9);
    renderOnline();
  }, 2500);
}
function dropFakePin() {
  if (!guessMap || !window.google) return;
  let lat, lng;
  const b = guessMap.getBounds && guessMap.getBounds();
  if (b) {
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    lat = sw.lat() + Math.random() * (ne.lat() - sw.lat());
    lng = sw.lng() + Math.random() * (ne.lng() - sw.lng());
  } else {
    lat = Math.random() * 140 - 70;
    lng = Math.random() * 360 - 180;
  }
  const color = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  const letter = PLAYER_INITIALS[Math.floor(Math.random() * PLAYER_INITIALS.length)];
  const m = new google.maps.Marker({
    position: { lat, lng }, map: guessMap, clickable: false, zIndex: 1,
    animation: google.maps.Animation.DROP,
    icon: {
      url: avatarDataUri(letter, color),
      scaledSize: new google.maps.Size(36, 43),
      anchor: new google.maps.Point(18, 43),
    },
  });
  ambientMarkers.push(m);
  if (ambientMarkers.length > 7) ambientMarkers.shift().setMap(null);
  // Avatars linger a while, then fade out.
  setTimeout(() => { m.setMap(null); ambientMarkers = ambientMarkers.filter((x) => x !== m); }, 7000);
}
function startAmbient() {
  stopAmbient();
  const tick = () => {
    dropFakePin();
    ambientTimer = setTimeout(tick, 3000 + Math.random() * 3000); // calm: ~3–6s apart
  };
  ambientTimer = setTimeout(tick, 1200);
}
function stopAmbient() {
  clearTimeout(ambientTimer); ambientTimer = null;
  ambientMarkers.forEach((m) => m.setMap(null));
  ambientMarkers = [];
}

/* ---------------------- Street View --------------------- */
let panorama = null, svService = null;

// Find the nearest outdoor Street View panorama to a seed, widening the radius
// until one is found. Returns { pano, lat, lng } or null.
function findPano(lat, lng) {
  return new Promise((resolve) => {
    if (!svService) svService = new google.maps.StreetViewService();
    const radii = [3000, 12000, 45000];
    let i = 0;
    const attempt = () => {
      svService.getPanorama(
        {
          location: { lat, lng },
          radius: radii[i],
          // GOOGLE = official car coverage (on roads, connected to walk), not
          // random user photospheres that can sit in a desert or forest.
          source: (google.maps.StreetViewSource && google.maps.StreetViewSource.GOOGLE) ||
                   google.maps.StreetViewSource.DEFAULT,
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

/* ---------------------- Worldwide location picking ------ */
// Pick a real road panorama anywhere: take an anchor, jitter it so we land on a
// random nearby street, and snap to the nearest Google coverage. Try several
// anchors/jitters so a round is always found.
async function findRoundPano() {
  const deck = state.deck;
  for (let t = 0; t < 10; t++) {
    const anchor = deck[(state.roundIndex + t) % deck.length];
    const jLat = anchor.lat + (Math.random() - 0.5) * 0.8; // ~±44 km
    const jLng = anchor.lng + (Math.random() - 0.5) * 0.8;
    const hit = await findPano(jLat, jLng);
    if (hit) { hit.label = anchor.label; return hit; }
  }
  // Last resort: the anchors themselves (guaranteed coverage).
  for (const a of deck) {
    const hit = await findPano(a.lat, a.lng);
    if (hit) { hit.label = a.label; return hit; }
  }
  return null;
}

// Resolve a friendly "City, Country" name for a coordinate (no extra API key).
let geocoder = null;
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    if (!geocoder) geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status !== "OK" || !results || !results.length) return resolve(null);
      const pick = (type) => {
        for (const r of results)
          for (const c of r.address_components)
            if (c.types.includes(type)) return c.long_name;
        return null;
      };
      const city = pick("locality") || pick("postal_town") ||
                   pick("administrative_area_level_2") || pick("administrative_area_level_1");
      const country = pick("country");
      resolve(city && country ? `${city}, ${country}` : (country || null));
    });
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
  const rounds = state.rounds || 5;
  try {
    showLoaderOnStart(true);
    await loadGoogleMaps();
  } catch (err) {
    showLoaderOnStart(false);
    toast(err.message);
    return;
  }
  showLoaderOnStart(false);

  state.deck = shuffle(LOCATIONS).slice(0, Math.min(rounds, LOCATIONS.length));
  state.roundIndex = 0;
  state.totalScore = 0;
  state.results = [];
  $("round-total").textContent = state.deck.length;
  $("score-total").textContent = "0";
  showScreen("game");
  initGuessMap();
  startOnline();
  setTimeout(() => google.maps.event.trigger(guessMap, "resize"), 80);
  loadRound();
}

function showLoaderOnStart(on) {
  const btn = $("start-btn");
  btn.disabled = on;
  btn.textContent = on ? "Loading…" : "▶ Play";
}

function setMapExpanded(on) {
  const panel = $("guess-panel");
  panel.classList.toggle("expanded", on);
  panel.classList.toggle("collapsed", !on);
  setTimeout(() => guessMap && google.maps.event.trigger(guessMap, "resize"), 240);
}

function resetGuessUI() {
  state.guessLatLng = null;
  $("round-current").textContent = state.roundIndex + 1;
  if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
  guessMap.setCenter({ lat: 20, lng: 0 });
  guessMap.setZoom(1);
  setMapExpanded(false);
  updateGuessButton();
}

async function loadRound() {
  resetGuessUI();
  $("pano-credit").textContent = "";
  state.currentName = "Somewhere on Earth";
  showLoader("Finding a street somewhere on Earth…");

  const hit = await findRoundPano();
  if (!hit) { showLoader("Couldn't find a location — check your connection."); return; }

  state.truth = { lat: hit.lat, lng: hit.lng };
  state.currentName = hit.label || "Somewhere on Earth"; // refined by geocoding below
  ensurePanorama(hit.pano);
  $("sv").style.display = "block";
  $("pano-img").style.display = "none";
  hideLoader();
  setPanoHint(SVG.walk + " <b>Drag</b> to look around · click the <b>arrows</b> to walk", false);
  startTimer();
  startAmbient();

  // Resolve a human-readable name in the background for the result screen.
  reverseGeocode(hit.lat, hit.lng).then((name) => { if (name) state.currentName = name; });
}

// Manual "Guess" button — only valid once a pin is placed.
function submitGuess() {
  if (!state.guessLatLng) return;
  finishRound();
}

// End the round, whether by guessing or the timer running out (no pin = 0).
function finishRound() {
  stopTimer();
  stopAmbient();
  const guess = state.guessLatLng;
  let km = null, points = 0;
  if (guess && state.truth) {
    km = haversineKm(guess, state.truth);
    points = scoreForDistance(km);
  }
  state.totalScore += points;
  state.results.push({ name: state.currentName, km, points });
  $("score-total").textContent = state.totalScore.toLocaleString();
  const guessSeconds = guess && state.timeLimit ? state.timeLimit - state.timeLeft : null;
  recordRound(km, points, guessSeconds);
  showResult(state.currentName, state.truth, guess, km, points);
}

/* ---------------------- Result -------------------------- */
function showResult(name, truth, guess, km, points) {
  showScreen("result");
  $("result-emoji").innerHTML = guess ? iconForPoints(points) : SVG.clock;
  $("result-distance").textContent = guess
    ? `${name} — ${formatDistance(km)} away`
    : `${name} — out of time!`;
  animateNumber($("result-points-num"), points);
  $("result-bar").style.width = "0%";
  setTimeout(() => { $("result-bar").style.width = (points / MAX_POINTS_PER_ROUND * 100) + "%"; }, 60);
  $("next-btn").textContent =
    state.roundIndex + 1 >= state.deck.length ? "See results" : "Next round";

  if (!resultMap) resultMap = makeMap($("result-map"), true);

  resultMarkers.forEach((m) => m.setMap(null));
  resultMarkers = [];
  if (resultLine) { resultLine.setMap(null); resultLine = null; }

  const t = { lat: truth.lat, lng: truth.lng };
  resultMarkers.push(new google.maps.Marker({ position: t, map: resultMap, title: name }));

  if (guess) {
    const g = { lat: guess.lat, lng: guess.lng };
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
  }

  setTimeout(() => {
    google.maps.event.trigger(resultMap, "resize");
    if (guess) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(t); bounds.extend({ lat: guess.lat, lng: guess.lng });
      resultMap.fitBounds(bounds, 70);
    } else {
      resultMap.setCenter(t);
      resultMap.setZoom(5);
    }
  }, 80);
}

function nextRound() {
  stopTimer();
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
  if (pct >= 0.9) return "World traveler!";
  if (pct >= 0.7) return "Seasoned explorer.";
  if (pct >= 0.5) return "Getting your bearings.";
  if (pct >= 0.3) return "Room to roam.";
  return "Lost, but having fun!";
}
function showSummary() {
  const max = state.results.length * MAX_POINTS_PER_ROUND;
  const pct = max ? state.totalScore / max : 0;
  $("summary-max").textContent = `out of ${max.toLocaleString()}`;
  $("summary-grade").textContent = gradeFor(pct);

  // Per-round breakdown as Bump-style list rows.
  const list = $("round-dots");
  list.innerHTML = "";
  state.results.forEach((r, idx) => {
    const g = r.points / MAX_POINTS_PER_ROUND;
    const heart = g >= 0.7 ? SVG.heartFill : g >= 0.4 ? SVG.heartHalf : SVG.heartOutline;
    const sub = r.km == null ? "Out of time" : `${formatDistance(r.km)} away`;
    const row = document.createElement("div");
    row.className = "round-row";
    row.innerHTML =
      `<span class="round-row-rank">${idx + 1}</span>` +
      `<span class="round-row-main"><div class="round-row-name"></div><div class="round-row-sub"></div></span>` +
      `<span class="round-row-pts"></span>` +
      `<span class="round-row-heart">${heart}</span>`;
    row.querySelector(".round-row-name").textContent = r.name;
    row.querySelector(".round-row-sub").textContent = sub;
    row.querySelector(".round-row-pts").textContent = r.points.toLocaleString();
    list.appendChild(row);
  });

  showScreen("summary");
  animateNumber($("summary-score"), state.totalScore, 900);
  $("summary-bar").style.width = "0%";
  setTimeout(() => { $("summary-bar").style.width = (pct * 100) + "%"; }, 80);

  recordGame(state.totalScore, state.results.length);
}

function buildShareText() {
  const max = state.results.length * MAX_POINTS_PER_ROUND;
  const dots = state.results
    .map((r) => (r.points / MAX_POINTS_PER_ROUND >= 0.7 ? "🟩" : r.points / MAX_POINTS_PER_ROUND >= 0.4 ? "🟨" : "🟥"))
    .join("");
  return `🌍 GeoGuess — ${state.totalScore.toLocaleString()}/${max.toLocaleString()}\n${dots}\nCan you beat me?`;
}

/* ---------------------- Profile + achievements ---------- */
const PROFILE_KEY = "geoguess.profile";
const DEFAULT_PROFILE = {
  name: "Explorer", games: 0, rounds: 0, totalScore: 0,
  bestGame: 0, bestRound: 0, bestKm: null, fastestGuess: null, maxRounds: 0, unlocked: [],
};
let profile = loadProfile();

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && typeof p === "object") return Object.assign({}, DEFAULT_PROFILE, p);
  } catch { /* ignore */ }
  return Object.assign({}, DEFAULT_PROFILE);
}
function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* ignore */ } }

const ACHIEVEMENTS = [
  { id: "first",    icon: "globe",   title: "First Steps",  desc: "Play your first game",        test: (p) => p.games >= 1 },
  { id: "rounds25", icon: "compass", title: "World Tour",   desc: "Play 25 rounds total",        test: (p) => p.rounds >= 25 },
  { id: "games10",  icon: "award",   title: "Globetrotter", desc: "Play 10 games",               test: (p) => p.games >= 10 },
  { id: "sharp",    icon: "target",  title: "Sharpshooter", desc: "Score 4,500+ in a round",     test: (p) => p.bestRound >= 4500 },
  { id: "bullseye", icon: "star",    title: "Bullseye",     desc: "Nail a 5,000-point round",    test: (p) => p.bestRound >= MAX_POINTS_PER_ROUND },
  { id: "sniper",   icon: "pin",     title: "Sniper",       desc: "Guess within 50 km",          test: (p) => p.bestKm != null && p.bestKm <= 50 },
  { id: "high",     icon: "award",   title: "High Roller",  desc: "Score 20,000+ in one game",   test: (p) => p.bestGame >= 20000 },
  { id: "quick",    icon: "bolt",    title: "Quick Draw",   desc: "Guess in under 10 seconds",   test: (p) => p.fastestGuess != null && p.fastestGuess <= 10 },
];

function recordRound(km, points, guessSeconds) {
  profile.rounds += 1;
  if (points > profile.bestRound) profile.bestRound = points;
  if (km != null && (profile.bestKm == null || km < profile.bestKm)) profile.bestKm = km;
  if (guessSeconds != null && (profile.fastestGuess == null || guessSeconds < profile.fastestGuess)) profile.fastestGuess = guessSeconds;
  saveProfile();
}
function recordGame(gameScore, roundsCount) {
  profile.games += 1;
  profile.totalScore += gameScore;
  if (gameScore > profile.bestGame) profile.bestGame = gameScore;
  if (roundsCount > profile.maxRounds) profile.maxRounds = roundsCount;
  saveProfile();
  checkAchievements();
}
function checkAchievements() {
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!profile.unlocked.includes(a.id) && a.test(profile)) { profile.unlocked.push(a.id); newly.push(a); }
  }
  if (newly.length) { saveProfile(); newly.forEach((a) => toast("Achievement unlocked: " + a.title)); }
}

function avatarLetter() { return ((profile.name || "").trim()[0] || "E").toUpperCase(); }
function renderProfile() {
  $("profile-name").value = profile.name;
  $("profile-avatar").textContent = avatarLetter();
  $("stat-games").textContent = profile.games.toLocaleString();
  $("stat-best").textContent = profile.bestGame.toLocaleString();
  $("stat-rounds").textContent = profile.rounds.toLocaleString();
  $("stat-total").textContent = profile.totalScore.toLocaleString();
  const unlocked = ACHIEVEMENTS.filter((a) => profile.unlocked.includes(a.id)).length;
  $("ach-progress").textContent = unlocked + " / " + ACHIEVEMENTS.length;

  const list = $("ach-list");
  list.innerHTML = "";
  for (const a of ACHIEVEMENTS) {
    const on = profile.unlocked.includes(a.id);
    const row = document.createElement("div");
    row.className = "ach " + (on ? "on" : "off");
    row.innerHTML =
      '<span class="ach-ic">' + (SVG[a.icon] || SVG.star) + "</span>" +
      '<span class="ach-main"><span class="ach-title"></span><span class="ach-desc"></span></span>' +
      '<span class="ach-check">' + (on ? SVG.check : SVG.lock) + "</span>";
    row.querySelector(".ach-title").textContent = a.title;
    row.querySelector(".ach-desc").textContent = a.desc;
    list.appendChild(row);
  }
}

/* ---------------------- Wire-up ------------------------- */
// Segmented controls — toggle "active" only within each group.
function wireSeg(groupId, apply) {
  const group = $(groupId);
  group.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      group.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      apply(b);
    });
  });
}
wireSeg("rounds-seg", (b) => { state.rounds = parseInt(b.dataset.rounds, 10) || 5; });
wireSeg("time-seg", (b) => { state.timeLimit = parseInt(b.dataset.time, 10) || 0; });

// Tap-to-expand mini-map (mobile-friendly guess flow).
$("map-open").addEventListener("click", () => setMapExpanded(true));
$("map-collapse").addEventListener("click", () => setMapExpanded(false));

$("start-btn").addEventListener("click", startGame);
$("guess-btn").addEventListener("click", () => {
  if (state.guessLatLng) submitGuess();
  else setMapExpanded(true); // no pin yet -> open the map so they can place one
});
$("next-btn").addEventListener("click", nextRound);
$("playagain-btn").addEventListener("click", () => { stopTimer(); stopAmbient(); clearInterval(onlineTimer); showScreen("start"); });

// Profile screen — remember where we came from so "back" returns there.
let profileReturn = "start";
$("profile-btn").addEventListener("click", () => { profileReturn = "start"; renderProfile(); showScreen("profile"); });
$("game-profile-btn").addEventListener("click", () => {
  profileReturn = "game";
  stopTimer(); stopAmbient();          // pause the round while viewing the profile
  renderProfile();
  showScreen("profile");
});
$("profile-back").addEventListener("click", () => {
  showScreen(profileReturn);
  if (profileReturn === "game") {       // resume the paused round
    setTimeout(() => google.maps.event.trigger(guessMap, "resize"), 80);
    resumeTimer();
    startAmbient();
  }
});
$("profile-name").addEventListener("input", () => {
  profile.name = $("profile-name").value.slice(0, 20) || "Explorer";
  $("profile-avatar").textContent = avatarLetter();
  saveProfile();
});
$("share-btn").addEventListener("click", () => {
  const last = state.results[state.results.length - 1];
  const line = last ? `🌍 GeoGuess — ${last.name}: ${last.points.toLocaleString()} pts (${formatDistance(last.km)} off)` : "🌍 GeoGuess";
  shareText(line + "\nCan you beat me?");
});
$("summary-share-btn").addEventListener("click", () => shareText(buildShareText()));

$("sv-toggle").addEventListener("click", () => {
  const panel = $("sv-panel");
  panel.classList.toggle("hidden");
  $("sv-toggle").textContent =
    (panel.classList.contains("hidden") ? "Advanced — " : "Hide — ") + "Google Maps API key";
});
$("sv-save").addEventListener("click", () => { setKey($("sv-token").value.trim()); refreshKeyStatus(); });
$("sv-clear").addEventListener("click", () => { setKey(""); $("sv-token").value = ""; refreshKeyStatus(); });
refreshKeyStatus();

/* ---------------------- PWA: install + service worker -------- */
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let deferredPrompt = null;

const installBtn = $("install-btn");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone) installBtn.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  installBtn.classList.add("hidden");
  toast("Installed — find GeoGuess on your home screen");
});
// iOS gives no install event; show the button with manual instructions instead.
if (isiOS && !isStandalone) installBtn.classList.remove("hidden");

installBtn.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignore */ }
    deferredPrompt = null;
    installBtn.classList.add("hidden");
  } else if (isiOS) {
    toast("Tap the Share button, then “Add to Home Screen”");
  } else {
    toast("Use your browser menu → “Install app”");
  }
});

if ("serviceWorker" in navigator) {
  // When a new version's worker takes over, reload once so the user always
  // ends up on the latest deploy — no more stale-cache confusion.
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !navigator.serviceWorker.controller) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js?v=24").catch(() => {});
  });
}
