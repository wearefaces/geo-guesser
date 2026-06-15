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
function emojiForPoints(p) {
  if (p >= 4500) return "🎯";
  if (p >= 3500) return "🔥";
  if (p >= 2000) return "👍";
  if (p >= 800) return "🧭";
  return "😅";
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
  try { await navigator.clipboard.writeText(text + "\n" + GAME_URL); toast("Copied to clipboard 📋"); }
  catch { toast("Couldn't share"); }
}

/* ---------------------- Round timer --------------------- */
function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function renderTimer() {
  const pill = $("hud-timer");
  if (!state.timeLimit) { pill.style.display = "none"; return; }
  pill.style.display = "";
  pill.querySelector("b").textContent = formatTime(Math.max(0, state.timeLeft));
  pill.classList.toggle("danger", state.timeLeft <= 10);
}
function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}
function startTimer() {
  stopTimer();
  if (!state.timeLimit) { renderTimer(); return; }
  state.timeLeft = state.timeLimit;
  renderTimer();
  state.timerId = setInterval(() => {
    state.timeLeft -= 1;
    renderTimer();
    if (state.timeLeft <= 0) { stopTimer(); toast("⏰ Time's up!"); finishRound(); }
  }, 1000);
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
  const rounds = state.rounds || 5;
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
  state.results = [];
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
  const btn = $("guess-btn");
  btn.disabled = true;
  btn.textContent = "Drop a pin";
  if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
  guessMap.setCenter({ lat: 20, lng: 0 });
  guessMap.setZoom(1);
  setMapExpanded(false);
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
    startTimer();
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
    startTimer();
  } catch (err) {
    skipRound(`${loc.name}: ${err.message}`);
  }
}

// Manual "Guess" button — only valid once a pin is placed.
function submitGuess() {
  if (!state.guessLatLng) return;
  finishRound();
}

// End the round, whether by guessing or the timer running out (no pin = 0).
function finishRound() {
  stopTimer();
  const loc = state.deck[state.roundIndex];
  const guess = state.guessLatLng;
  let km = null, points = 0;
  if (guess && state.truth) {
    km = haversineKm(guess, state.truth);
    points = scoreForDistance(km);
  }
  state.totalScore += points;
  state.results.push({ name: loc.name, km, points });
  $("score-total").textContent = state.totalScore.toLocaleString();
  showResult(loc, state.truth, guess, km, points);
}

/* ---------------------- Result -------------------------- */
function showResult(loc, truth, guess, km, points) {
  showScreen("result");
  $("result-emoji").textContent = guess ? emojiForPoints(points) : "⏰";
  $("result-distance").textContent = guess
    ? `${loc.name} — ${formatDistance(km)} away`
    : `${loc.name} — out of time!`;
  animateNumber($("result-points-num"), points);
  $("result-bar").style.width = "0%";
  setTimeout(() => { $("result-bar").style.width = (points / MAX_POINTS_PER_ROUND * 100) + "%"; }, 60);
  $("next-btn").textContent =
    state.roundIndex + 1 >= state.deck.length ? "See results →" : "Next round →";

  if (!resultMap) resultMap = makeMap($("result-map"), true);

  resultMarkers.forEach((m) => m.setMap(null));
  resultMarkers = [];
  if (resultLine) { resultLine.setMap(null); resultLine = null; }

  const t = { lat: truth.lat, lng: truth.lng };
  resultMarkers.push(new google.maps.Marker({ position: t, map: resultMap, label: "📍", title: loc.name }));

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
  if (pct >= 0.9) return "🌟 World traveler!";
  if (pct >= 0.7) return "✈️ Seasoned explorer.";
  if (pct >= 0.5) return "🧭 Getting your bearings.";
  if (pct >= 0.3) return "🗺️ Room to roam.";
  return "🤷 Lost, but having fun!";
}
function showSummary() {
  const max = state.results.length * MAX_POINTS_PER_ROUND;
  const pct = max ? state.totalScore / max : 0;
  $("summary-max").textContent = `out of ${max.toLocaleString()}`;
  $("summary-grade").textContent = gradeFor(pct);

  // Per-round dots coloured by how well each round scored.
  const dots = $("round-dots");
  dots.innerHTML = "";
  for (const r of state.results) {
    const d = document.createElement("span");
    d.className = "dot";
    const g = r.points / MAX_POINTS_PER_ROUND;
    d.style.background = g >= 0.7 ? "#34d399" : g >= 0.4 ? "#f4c343" : "#e8746a";
    d.title = `${r.name}: ${r.points.toLocaleString()}`;
    dots.appendChild(d);
  }

  showScreen("summary");
  animateNumber($("summary-score"), state.totalScore, 900);
  $("summary-bar").style.width = "0%";
  setTimeout(() => { $("summary-bar").style.width = (pct * 100) + "%"; }, 80);
}

function buildShareText() {
  const max = state.results.length * MAX_POINTS_PER_ROUND;
  const dots = state.results
    .map((r) => (r.points / MAX_POINTS_PER_ROUND >= 0.7 ? "🟩" : r.points / MAX_POINTS_PER_ROUND >= 0.4 ? "🟨" : "🟥"))
    .join("");
  return `🌍 GeoGuess — ${state.totalScore.toLocaleString()}/${max.toLocaleString()}\n${dots}\nCan you beat me?`;
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
$("guess-btn").addEventListener("click", submitGuess);
$("next-btn").addEventListener("click", nextRound);
$("playagain-btn").addEventListener("click", () => { stopTimer(); showScreen("start"); });
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
    (panel.classList.contains("hidden") ? "⚙︎ Advanced:" : "▾") + " Google Maps API key";
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
  toast("Installed — find GeoGuess on your home screen 🎉");
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js?v=7").catch(() => {});
  });
}
