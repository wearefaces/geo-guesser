/**
 * Public, baked-in configuration for the deployed site.
 *
 * This Mapillary client token is intentionally committed so Street View works
 * for everyone with zero setup. It is read-scoped; treat it as throwaway and
 * regenerate it anytime from https://www.mapillary.com/dashboard/developers if
 * it gets abused. Players can override it with their own token via the Street
 * View panel on the start screen (that one is stored only in their browser).
 */
window.GEOGUESS_CONFIG = {
  mapillaryToken: "MLY|27138145105794268|0fdaba6153bbe87e8150f9b7b75da43c",
};
