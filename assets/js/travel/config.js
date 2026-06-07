// Travel-log frontend config.

export const CONFIG = {
  API_BASE: '/api',
  MAP: { center: [25, 10], zoom: 2, minZoom: 2, maxZoom: 19 },

  // Basemap tiles.
  // DEV DEFAULT = CARTO Voyager: keyless, attribution required, fine for personal/low use.
  // PRODUCTION: set MAPTILER_KEY below and replace CONFIG.TILES with the MapTiler block.
  TILES: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },

  // For production, paste your MapTiler key here, then swap CONFIG.TILES for this:
  //   url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${CONFIG.MAPTILER_KEY}`,
  //   options: { maxZoom: 20, attribution: '© MapTiler © OpenStreetMap contributors' }
  MAPTILER_KEY: '',

  // Group photos taken within this many meters into the same place (used in a later phase).
  PLACE_GROUP_RADIUS_M: 200,
  // Quick-jump presets are stored in the backend (editable in edit mode), not hardcoded here.
};
