/**
 * Public, baked-in configuration for the deployed site.
 *
 * googleMapsKey: a Google Maps JavaScript API key (Street View + Maps). It is
 * intentionally committed so the game works for everyone with no setup. Because
 * it ships in the public page, it MUST be restricted in the Google Cloud
 * console to this site's HTTP referrer (e.g. https://wearefaces.github.io/*)
 * and to the Maps JavaScript API, and ideally capped with a daily quota.
 * Players can override it with their own key via the start-screen panel (that
 * one is stored only in their browser).
 */
window.GEOGUESS_CONFIG = {
  googleMapsKey: "AIzaSyAxbZNWm51wKF_Gc7XYElzojCGaSMD0GHo",
};
