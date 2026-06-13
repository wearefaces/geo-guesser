/**
 * Curated set of locations spread across the globe.
 *
 * Each entry has:
 *   - name:  label shown on the result screen
 *   - title: an English Wikipedia article title, used for the PHOTO fallback
 *            (fetched at runtime from the Wikipedia REST summary API — CORS
 *            enabled, no API key).
 *   - lat/lng: a seed coordinate. In photo mode this is the answer. In Street
 *            View mode it's the centre of the area we search Mapillary for a
 *            nearby street image; the actual image location becomes the answer.
 *
 * The first block is landmark-centric (great for photo mode). The second block
 * is street-level city spots that tend to have good Mapillary coverage so that
 * Street View mode has plenty of playable rounds.
 */
const LOCATIONS = [
  // --- Landmarks --------------------------------------------------------
  { name: "Eiffel Tower",          title: "Eiffel_Tower",           lat: 48.8584,  lng: 2.2945 },
  { name: "Statue of Liberty",     title: "Statue_of_Liberty",      lat: 40.6892,  lng: -74.0445 },
  { name: "Colosseum",             title: "Colosseum",              lat: 41.8902,  lng: 12.4922 },
  { name: "Big Ben",               title: "Big_Ben",                lat: 51.5007,  lng: -0.1246 },
  { name: "Sydney Opera House",    title: "Sydney_Opera_House",     lat: -33.8568, lng: 151.2153 },
  { name: "Taj Mahal",             title: "Taj_Mahal",              lat: 27.1751,  lng: 78.0421 },
  { name: "Christ the Redeemer",   title: "Christ_the_Redeemer",    lat: -22.9519, lng: -43.2105 },
  { name: "Brandenburg Gate",      title: "Brandenburg_Gate",       lat: 52.5163,  lng: 13.3777 },
  { name: "Golden Gate Bridge",    title: "Golden_Gate_Bridge",     lat: 37.8199,  lng: -122.4783 },
  { name: "Burj Khalifa",          title: "Burj_Khalifa",           lat: 25.1972,  lng: 55.2744 },
  { name: "Santorini",             title: "Santorini",              lat: 36.4618,  lng: 25.3753 },
  { name: "Table Mountain",        title: "Table_Mountain",         lat: -33.9628, lng: 18.4098 },
  { name: "Neuschwanstein Castle", title: "Neuschwanstein_Castle",  lat: 47.5576,  lng: 10.7498 },
  { name: "Times Square",          title: "Times_Square",           lat: 40.7580,  lng: -73.9855 },
  { name: "Stonehenge",            title: "Stonehenge",             lat: 51.1789,  lng: -1.8262 },
  { name: "Niagara Falls",         title: "Niagara_Falls",          lat: 43.0962,  lng: -79.0377 },

  // --- Street-level city spots (good Mapillary coverage) ----------------
  { name: "Shibuya, Tokyo",          title: "Shibuya",                     lat: 35.6595,  lng: 139.7005 },
  { name: "Amsterdam Canals",        title: "Canals_of_Amsterdam",         lat: 52.3676,  lng: 4.9041 },
  { name: "La Rambla, Barcelona",    title: "La_Rambla,_Barcelona",        lat: 41.3809,  lng: 2.1733 },
  { name: "Trafalgar Square, London",title: "Trafalgar_Square",            lat: 51.5080,  lng: -0.1281 },
  { name: "Brooklyn Bridge",         title: "Brooklyn_Bridge",             lat: 40.7061,  lng: -73.9969 },
  { name: "Champs-Élysées, Paris",   title: "Avenue_des_Champs-Élysées",   lat: 48.8698,  lng: 2.3078 },
  { name: "Downtown Toronto",        title: "Toronto",                     lat: 43.6426,  lng: -79.3871 },
  { name: "Lisbon",                  title: "Lisbon",                      lat: 38.7223,  lng: -9.1393 },
  { name: "Old Town, Prague",        title: "Old_Town_Square",             lat: 50.0875,  lng: 14.4213 },
  { name: "Sultanahmet, Istanbul",   title: "Sultan_Ahmed_Mosque",         lat: 41.0086,  lng: 28.9802 },
  { name: "Paulista Ave, São Paulo", title: "Paulista_Avenue",             lat: -23.5614, lng: -46.6562 },
  { name: "Marina Bay, Singapore",   title: "Marina_Bay,_Singapore",       lat: 1.2834,   lng: 103.8607 },
  { name: "Plaza Mayor, Madrid",     title: "Plaza_Mayor,_Madrid",         lat: 40.4155,  lng: -3.7074 },
  { name: "Dam Square, Berlin",      title: "Alexanderplatz",              lat: 52.5219,  lng: 13.4132 },
  { name: "Melbourne CBD",           title: "Melbourne",                   lat: -37.8136, lng: 144.9631 },
];

// Expose for the browser (no module bundler in play).
window.LOCATIONS = LOCATIONS;
