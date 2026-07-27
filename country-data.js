/* Static, bundled country reference data — no live lookups, no API calls.
   Used to auto-fill Country Info when you add a stop. Always editable after.
   Coordinates are approximate (capital/major city) — refine per-stop if you
   need precise Shabbat timing for a specific base. */

window.COUNTRY_DATA = {
  "israel": { currency: "ILS", language: "Hebrew, Arabic", plug: "C/H", emergency: "100 (police) / 101 (ambulance)", lat: 31.78, lon: 35.22, timezone: "Asia/Jerusalem" },
  "united states": { currency: "USD", language: "English", plug: "A/B", emergency: "911", lat: 40.71, lon: -74.01, timezone: "America/New_York" },
  "usa": { currency: "USD", language: "English", plug: "A/B", emergency: "911", lat: 40.71, lon: -74.01, timezone: "America/New_York" },
  "new york": { currency: "USD", language: "English", plug: "A/B", emergency: "911", lat: 40.71, lon: -74.01, timezone: "America/New_York" },
  "peru": { currency: "PEN", language: "Spanish, Quechua", plug: "A/C", emergency: "105", lat: -13.53, lon: -71.97, timezone: "America/Lima" },
  "argentina": { currency: "ARS", language: "Spanish", plug: "C/I", emergency: "911", lat: -34.6, lon: -58.38, timezone: "America/Argentina/Buenos_Aires" },
  "patagonia": { currency: "ARS", language: "Spanish", plug: "C/I", emergency: "911", lat: -41.15, lon: -71.31, timezone: "America/Argentina/Buenos_Aires" },
  "chile": { currency: "CLP", language: "Spanish", plug: "C", emergency: "133", lat: -33.45, lon: -70.67, timezone: "America/Santiago" },
  "bolivia": { currency: "BOB", language: "Spanish, Quechua, Aymara", plug: "A/C", emergency: "110", lat: -16.5, lon: -68.15, timezone: "America/La_Paz" },
  "costa rica": { currency: "CRC", language: "Spanish", plug: "A/B", emergency: "911", lat: 9.93, lon: -84.08, timezone: "America/Costa_Rica" },
  "brazil": { currency: "BRL", language: "Portuguese", plug: "C/N", emergency: "190", lat: -22.91, lon: -43.17, timezone: "America/Sao_Paulo" },
  "kyrgyzstan": { currency: "KGS", language: "Kyrgyz, Russian", plug: "C/F", emergency: "112", lat: 42.87, lon: 74.59, timezone: "Asia/Bishkek" },
  "mongolia": { currency: "MNT", language: "Mongolian", plug: "C/E", emergency: "105", lat: 47.92, lon: 106.92, timezone: "Asia/Ulaanbaatar" },
  "uzbekistan": { currency: "UZS", language: "Uzbek, Russian", plug: "C/F", emergency: "112", lat: 41.31, lon: 69.24, timezone: "Asia/Tashkent" },
  "taiwan": { currency: "TWD", language: "Mandarin", plug: "A/B", emergency: "110/119", lat: 25.03, lon: 121.56, timezone: "Asia/Taipei" },

  "mexico": { currency: "MXN", language: "Spanish", plug: "A/B", emergency: "911", lat: 19.43, lon: -99.13, timezone: "America/Mexico_City" },
  "colombia": { currency: "COP", language: "Spanish", plug: "A/B", emergency: "123", lat: 4.71, lon: -74.07, timezone: "America/Bogota" },
  "ecuador": { currency: "USD", language: "Spanish", plug: "A/B", emergency: "911", lat: -0.18, lon: -78.47, timezone: "America/Guayaquil" },
  "uruguay": { currency: "UYU", language: "Spanish", plug: "C/I", emergency: "911", lat: -34.9, lon: -56.16, timezone: "America/Montevideo" },
  "panama": { currency: "PAB/USD", language: "Spanish", plug: "A/B", emergency: "911", lat: 8.98, lon: -79.52, timezone: "America/Panama" },
  "guatemala": { currency: "GTQ", language: "Spanish", plug: "A/B", emergency: "110", lat: 14.63, lon: -90.51, timezone: "America/Guatemala" },

  "spain": { currency: "EUR", language: "Spanish", plug: "C/F", emergency: "112", lat: 40.42, lon: -3.7, timezone: "Europe/Madrid" },
  "portugal": { currency: "EUR", language: "Portuguese", plug: "C/F", emergency: "112", lat: 38.72, lon: -9.14, timezone: "Europe/Lisbon" },
  "italy": { currency: "EUR", language: "Italian", plug: "C/F/L", emergency: "112", lat: 41.9, lon: 12.5, timezone: "Europe/Rome" },
  "france": { currency: "EUR", language: "French", plug: "C/E", emergency: "112", lat: 48.86, lon: 2.35, timezone: "Europe/Paris" },
  "germany": { currency: "EUR", language: "German", plug: "C/F", emergency: "112", lat: 52.52, lon: 13.4, timezone: "Europe/Berlin" },
  "greece": { currency: "EUR", language: "Greek", plug: "C/F", emergency: "112", lat: 37.98, lon: 23.73, timezone: "Europe/Athens" },
  "united kingdom": { currency: "GBP", language: "English", plug: "G", emergency: "999/112", lat: 51.51, lon: -0.13, timezone: "Europe/London" },
  "switzerland": { currency: "CHF", language: "German, French, Italian", plug: "C/J", emergency: "112", lat: 46.95, lon: 7.45, timezone: "Europe/Zurich" },
  "georgia": { currency: "GEL", language: "Georgian", plug: "C/F", emergency: "112", lat: 41.72, lon: 44.79, timezone: "Asia/Tbilisi" },
  "armenia": { currency: "AMD", language: "Armenian", plug: "C/F", emergency: "112", lat: 40.18, lon: 44.51, timezone: "Asia/Yerevan" },
  "turkey": { currency: "TRY", language: "Turkish", plug: "C/F", emergency: "112", lat: 41.01, lon: 28.98, timezone: "Europe/Istanbul" },

  "thailand": { currency: "THB", language: "Thai", plug: "A/C/O", emergency: "191", lat: 13.76, lon: 100.5, timezone: "Asia/Bangkok" },
  "vietnam": { currency: "VND", language: "Vietnamese", plug: "A/C", emergency: "113", lat: 21.03, lon: 105.85, timezone: "Asia/Ho_Chi_Minh" },
  "cambodia": { currency: "USD/KHR", language: "Khmer", plug: "A/C/G", emergency: "117", lat: 11.56, lon: 104.92, timezone: "Asia/Phnom_Penh" },
  "japan": { currency: "JPY", language: "Japanese", plug: "A/B", emergency: "110/119", lat: 35.68, lon: 139.65, timezone: "Asia/Tokyo" },
  "south korea": { currency: "KRW", language: "Korean", plug: "C/F", emergency: "112/119", lat: 37.57, lon: 126.98, timezone: "Asia/Seoul" },
  "indonesia": { currency: "IDR", language: "Indonesian", plug: "C/F", emergency: "112", lat: -6.21, lon: 106.85, timezone: "Asia/Jakarta" },
  "india": { currency: "INR", language: "Hindi, English", plug: "C/D/M", emergency: "112", lat: 28.61, lon: 77.21, timezone: "Asia/Kolkata" },
  "nepal": { currency: "NPR", language: "Nepali", plug: "C/D/M", emergency: "100", lat: 27.72, lon: 85.32, timezone: "Asia/Kathmandu" },
  "sri lanka": { currency: "LKR", language: "Sinhala, Tamil", plug: "D/G/M", emergency: "119", lat: 6.93, lon: 79.86, timezone: "Asia/Colombo" },
  "china": { currency: "CNY", language: "Mandarin", plug: "A/C/I", emergency: "110/120", lat: 39.9, lon: 116.4, timezone: "Asia/Shanghai" },
  "kazakhstan": { currency: "KZT", language: "Kazakh, Russian", plug: "C/F", emergency: "112", lat: 51.16, lon: 71.47, timezone: "Asia/Almaty" },
  "tajikistan": { currency: "TJS", language: "Tajik, Russian", plug: "C/F", emergency: "112", lat: 38.56, lon: 68.79, timezone: "Asia/Dushanbe" },

  "south africa": { currency: "ZAR", language: "English, Afrikaans, Zulu", plug: "M/N", emergency: "10111", lat: -25.75, lon: 28.19, timezone: "Africa/Johannesburg" },
  "kenya": { currency: "KES", language: "Swahili, English", plug: "G", emergency: "999/112", lat: -1.29, lon: 36.82, timezone: "Africa/Nairobi" },
  "tanzania": { currency: "TZS", language: "Swahili, English", plug: "D/G", emergency: "112", lat: -6.16, lon: 35.75, timezone: "Africa/Dar_es_Salaam" },
  "morocco": { currency: "MAD", language: "Arabic, French", plug: "C/E", emergency: "19", lat: 34.02, lon: -6.83, timezone: "Africa/Casablanca" },
  "egypt": { currency: "EGP", language: "Arabic", plug: "C/F", emergency: "122", lat: 30.04, lon: 31.24, timezone: "Africa/Cairo" },
  "jordan": { currency: "JOD", language: "Arabic", plug: "C/D/G", emergency: "911", lat: 31.95, lon: 35.93, timezone: "Asia/Amman" },

  "australia": { currency: "AUD", language: "English", plug: "I", emergency: "000", lat: -33.87, lon: 151.21, timezone: "Australia/Sydney" },
  "new zealand": { currency: "NZD", language: "English, Maori", plug: "I", emergency: "111", lat: -41.29, lon: 174.78, timezone: "Pacific/Auckland" },
  "canada": { currency: "CAD", language: "English, French", plug: "A/B", emergency: "911", lat: 43.65, lon: -79.38, timezone: "America/Toronto" }
};

/* aliases mapping alternate spellings to a canonical key above */
window.COUNTRY_ALIASES = {
  "america": "united states", "u.s.": "united states", "u.s.a.": "united states", "usa": "united states",
  "uk": "united kingdom", "britain": "united kingdom", "england": "united kingdom",
  "korea": "south korea", "s. korea": "south korea",
  "kyrgyz republic": "kyrgyzstan"
};

function lookupCountryData(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (window.COUNTRY_DATA[key]) return window.COUNTRY_DATA[key];
  const alias = window.COUNTRY_ALIASES[key];
  if (alias && window.COUNTRY_DATA[alias]) return window.COUNTRY_DATA[alias];
  // loose contains-match as a fallback (e.g. "Cusco, Peru" -> peru)
  const found = Object.keys(window.COUNTRY_DATA).find((k) => key.includes(k));
  return found ? window.COUNTRY_DATA[found] : null;
}
