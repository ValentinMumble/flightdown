import type {Spot} from '../types';
import {mapsLink, satelliteTile, TILE, worldPixel, type LatLng} from '../model/geo';
import {spotLabel} from './ui';

/** Close enough to see the field and the trees around it: about 1 m a pixel in Europe. */
const ZOOM = 17;
/** How far the tiles reach from the pin, wide enough for the widest panel. */
const REACH_X = 460;

/**
 * The spot from above: satellite tiles laid around its pin, no map library needed. A tap opens it in Maps.
 */
export function MiniMap({spot, height = 170}: {spot: Spot & LatLng; height?: number}) {
  const centre = worldPixel(spot, ZOOM);
  const reachY = height / 2 + 10;
  const tiles: {x: number; y: number; left: number; top: number}[] = [];
  for (let x = Math.floor((centre.x - REACH_X) / TILE); x <= Math.floor((centre.x + REACH_X) / TILE); x += 1) {
    for (let y = Math.floor((centre.y - reachY) / TILE); y <= Math.floor((centre.y + reachY) / TILE); y += 1) {
      tiles.push({x, y, left: Math.round(x * TILE - centre.x), top: Math.round(y * TILE - centre.y)});
    }
  }
  return (
    <a
      className="mini-map"
      href={mapsLink(spot)}
      target="_blank"
      rel="noreferrer"
      style={{height}}
      aria-label={`${spot.name} in Maps`}
    >
      <span className="mini-map-tiles">
        {tiles.map(tile => (
          <img
            key={`${tile.x}-${tile.y}`}
            src={satelliteTile(ZOOM, tile.x, tile.y)}
            alt=""
            loading="lazy"
            style={{left: tile.left, top: tile.top}}
          />
        ))}
      </span>
      <span className="mini-map-pin" />
      <span className="mini-map-label">{spotLabel(spot)}</span>
      <span className="mini-map-credit">Esri</span>
    </a>
  );
}
