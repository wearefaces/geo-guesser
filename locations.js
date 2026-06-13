/**
 * Curated set of locations spread across the globe.
 *
 * Each location references an English Wikipedia article title. The photo for a
 * round is fetched at runtime from the Wikipedia REST summary API
 * (https://en.wikipedia.org/api/rest_v1/page/summary/<title>), which is CORS
 * enabled and needs no API key. We only ship coordinates + a stable title here,
 * so there are no brittle hard-coded image URLs to rot.
 *
 * Coordinates are the real-world location used to score the player's guess.
 */
const LOCATIONS = [
  { name: "Eiffel Tower",          title: "Eiffel_Tower",           lat: 48.8584,  lng: 2.2945 },
  { name: "Statue of Liberty",     title: "Statue_of_Liberty",      lat: 40.6892,  lng: -74.0445 },
  { name: "Colosseum",             title: "Colosseum",              lat: 41.8902,  lng: 12.4922 },
  { name: "Big Ben",               title: "Big_Ben",                lat: 51.5007,  lng: -0.1246 },
  { name: "Sydney Opera House",    title: "Sydney_Opera_House",     lat: -33.8568, lng: 151.2153 },
  { name: "Taj Mahal",             title: "Taj_Mahal",              lat: 27.1751,  lng: 78.0421 },
  { name: "Christ the Redeemer",   title: "Christ_the_Redeemer",    lat: -22.9519, lng: -43.2105 },
  { name: "Great Wall of China",   title: "Great_Wall_of_China",    lat: 40.4319,  lng: 116.5704 },
  { name: "Machu Picchu",          title: "Machu_Picchu",           lat: -13.1631, lng: -72.5450 },
  { name: "Giza Pyramids",         title: "Giza_pyramid_complex",   lat: 29.9792,  lng: 31.1342 },
  { name: "Burj Khalifa",          title: "Burj_Khalifa",           lat: 25.1972,  lng: 55.2744 },
  { name: "Petra",                 title: "Petra",                  lat: 30.3285,  lng: 35.4444 },
  { name: "Golden Gate Bridge",    title: "Golden_Gate_Bridge",     lat: 37.8199,  lng: -122.4783 },
  { name: "Mount Fuji",            title: "Mount_Fuji",             lat: 35.3606,  lng: 138.7274 },
  { name: "Brandenburg Gate",      title: "Brandenburg_Gate",       lat: 52.5163,  lng: 13.3777 },
  { name: "Santorini",             title: "Santorini",              lat: 36.4618,  lng: 25.3753 },
  { name: "Table Mountain",        title: "Table_Mountain",         lat: -33.9628, lng: 18.4098 },
  { name: "Moai, Easter Island",   title: "Moai",                   lat: -27.1212, lng: -109.3666 },
  { name: "Neuschwanstein Castle", title: "Neuschwanstein_Castle",  lat: 47.5576,  lng: 10.7498 },
  { name: "Chichen Itza",          title: "Chichen_Itza",           lat: 20.6843,  lng: -88.5678 },
  { name: "Grand Canyon",          title: "Grand_Canyon",           lat: 36.1069,  lng: -112.1129 },
  { name: "Angkor Wat",            title: "Angkor_Wat",             lat: 13.4125,  lng: 103.8670 },
  { name: "Times Square",          title: "Times_Square",           lat: 40.7580,  lng: -73.9855 },
  { name: "Mount Everest",         title: "Mount_Everest",          lat: 27.9881,  lng: 86.9250 },
  { name: "Stonehenge",            title: "Stonehenge",             lat: 51.1789,  lng: -1.8262 },
  { name: "Niagara Falls",         title: "Niagara_Falls",          lat: 43.0962,  lng: -79.0377 },
];

// Expose for the browser (no module bundler in play).
window.LOCATIONS = LOCATIONS;
