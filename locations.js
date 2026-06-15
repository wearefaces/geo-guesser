/**
 * Worldwide anchor points used to seed each round. They are spread across ~60
 * regions in countries that have Google Street View coverage. Each round the
 * game picks an anchor, jitters the coordinate by up to ~0.4° so you can land
 * on a random street (not just a city centre), and snaps to the nearest real
 * Google road panorama. The actual place name is resolved at runtime by
 * reverse-geocoding, so locations can be anywhere — not only famous landmarks.
 *
 * `label` is only a fallback name if reverse-geocoding fails.
 */
const LOCATIONS = [
  // North America
  { label: "USA", lat: 40.7128, lng: -74.0060 },
  { label: "USA", lat: 34.0522, lng: -118.2437 },
  { label: "USA", lat: 41.8781, lng: -87.6298 },
  { label: "USA", lat: 39.7392, lng: -104.9903 },
  { label: "USA", lat: 29.7604, lng: -95.3698 },
  { label: "USA", lat: 47.6062, lng: -122.3321 },
  { label: "Canada", lat: 43.6532, lng: -79.3832 },
  { label: "Canada", lat: 49.2827, lng: -123.1207 },
  { label: "Canada", lat: 45.5019, lng: -73.5674 },
  { label: "Mexico", lat: 19.4326, lng: -99.1332 },
  { label: "Mexico", lat: 20.6597, lng: -103.3496 },
  // South America
  { label: "Brazil", lat: -23.5505, lng: -46.6333 },
  { label: "Brazil", lat: -22.9068, lng: -43.1729 },
  { label: "Argentina", lat: -34.6037, lng: -58.3816 },
  { label: "Chile", lat: -33.4489, lng: -70.6693 },
  { label: "Colombia", lat: 4.7110, lng: -74.0721 },
  { label: "Peru", lat: -12.0464, lng: -77.0428 },
  { label: "Uruguay", lat: -34.9011, lng: -56.1645 },
  // Europe
  { label: "United Kingdom", lat: 51.5074, lng: -0.1278 },
  { label: "United Kingdom", lat: 53.4808, lng: -2.2426 },
  { label: "France", lat: 48.8566, lng: 2.3522 },
  { label: "France", lat: 45.7640, lng: 4.8357 },
  { label: "Spain", lat: 40.4168, lng: -3.7038 },
  { label: "Spain", lat: 41.3851, lng: 2.1734 },
  { label: "Italy", lat: 41.9028, lng: 12.4964 },
  { label: "Italy", lat: 45.4642, lng: 9.1900 },
  { label: "Germany", lat: 52.5200, lng: 13.4050 },
  { label: "Germany", lat: 48.1351, lng: 11.5820 },
  { label: "Netherlands", lat: 52.3676, lng: 4.9041 },
  { label: "Sweden", lat: 59.3293, lng: 18.0686 },
  { label: "Norway", lat: 59.9139, lng: 10.7522 },
  { label: "Poland", lat: 52.2297, lng: 21.0122 },
  { label: "Portugal", lat: 38.7223, lng: -9.1393 },
  { label: "Switzerland", lat: 47.3769, lng: 8.5417 },
  { label: "Ireland", lat: 53.3498, lng: -6.2603 },
  { label: "Greece", lat: 37.9838, lng: 23.7275 },
  { label: "Czechia", lat: 50.0755, lng: 14.4378 },
  { label: "Romania", lat: 44.4268, lng: 26.1025 },
  { label: "Finland", lat: 60.1699, lng: 24.9384 },
  { label: "Denmark", lat: 55.6761, lng: 12.5683 },
  // Africa
  { label: "South Africa", lat: -33.9249, lng: 18.4241 },
  { label: "South Africa", lat: -26.2041, lng: 28.0473 },
  { label: "Kenya", lat: -1.2921, lng: 36.8219 },
  { label: "Nigeria", lat: 6.5244, lng: 3.3792 },
  { label: "Ghana", lat: 5.6037, lng: -0.1870 },
  { label: "Senegal", lat: 14.7167, lng: -17.4677 },
  { label: "Botswana", lat: -24.6282, lng: 25.9231 },
  { label: "Uganda", lat: 0.3476, lng: 32.5825 },
  // Asia
  { label: "Japan", lat: 35.6762, lng: 139.6503 },
  { label: "Japan", lat: 34.6937, lng: 135.5023 },
  { label: "Taiwan", lat: 25.0330, lng: 121.5654 },
  { label: "Hong Kong", lat: 22.3193, lng: 114.1694 },
  { label: "Singapore", lat: 1.3521, lng: 103.8198 },
  { label: "Thailand", lat: 13.7563, lng: 100.5018 },
  { label: "Malaysia", lat: 3.1390, lng: 101.6869 },
  { label: "Indonesia", lat: -6.2088, lng: 106.8456 },
  { label: "Philippines", lat: 14.5995, lng: 120.9842 },
  { label: "India", lat: 28.6139, lng: 77.2090 },
  { label: "India", lat: 19.0760, lng: 72.8777 },
  { label: "Israel", lat: 32.0853, lng: 34.7818 },
  { label: "Turkey", lat: 41.0082, lng: 28.9784 },
  { label: "United Arab Emirates", lat: 25.2048, lng: 55.2708 },
  { label: "Sri Lanka", lat: 6.9271, lng: 79.8612 },
  // Oceania
  { label: "Australia", lat: -33.8688, lng: 151.2093 },
  { label: "Australia", lat: -37.8136, lng: 144.9631 },
  { label: "Australia", lat: -31.9523, lng: 115.8613 },
  { label: "New Zealand", lat: -36.8485, lng: 174.7633 },
  { label: "New Zealand", lat: -41.2865, lng: 174.7762 },
];

window.LOCATIONS = LOCATIONS;
