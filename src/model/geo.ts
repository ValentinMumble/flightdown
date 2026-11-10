import type {Spot} from '../types';

export interface LatLng {
  lat: number;
  lng: number;
}

export const TILE = 256;

export function hasLocation(spot: Spot | undefined): spot is Spot & LatLng {
  return typeof spot?.lat === 'number' && typeof spot.lng === 'number';
}

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6};
}

/**
 * A place from what the pilot pastes: "47.2184, -1.5536", or a link from Google Maps (`@47.2,-1.5`, `q=47.2,-1.5`,
 * `!3d47.2!4d-1.5`), Apple Maps (`ll=47.2,-1.5`, `coordinate=...`) or a `geo:47.2,-1.5` link.
 */
export function parseLocation(text: string): LatLng | null {
  let input = text.trim().replace(/\+/g, ' ');
  try {
    input = decodeURIComponent(input);
  } catch {
    // Not encoded: read it as it is.
  }
  const pinned = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(input);
  if (pinned) return valid(Number(pinned[1]), Number(pinned[2]));
  const pair =
    /(?:@|geo:|[?&](?:q|ll|query|coordinate|sll|daddr)=|^)\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/.exec(
      input,
    );
  return pair ? valid(Number(pair[1]), Number(pair[2])) : null;
}

export const formatLocation = ({lat, lng}: LatLng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/** Where a place falls on the Web Mercator map at a zoom, in pixels from the top left of the world. */
export function worldPixel({lat, lng}: LatLng, zoom: number) {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Satellite tiles (Esri World Imagery): flying fields read best from above. */
export const satelliteTile = (zoom: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;

/** The place in Apple Maps (the web version off Apple devices). */
export const mapsLink = (spot: Spot & LatLng) =>
  `https://maps.apple.com/?ll=${spot.lat},${spot.lng}&q=${encodeURIComponent(spot.name)}&t=k`;

/** Spots by name, "Other" last: the order of a list to pick from. */
export function sortSpots(spots: Spot[]) {
  const isOther = (spot: Spot) => spot.name.trim().toLowerCase() === 'other';
  return [...spots].sort(
    (left, right) => Number(isOther(left)) - Number(isOther(right)) || left.name.localeCompare(right.name),
  );
}
