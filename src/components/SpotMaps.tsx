import {useEffect, useRef, type RefObject} from 'react';
import L from 'leaflet';
import type {Spot} from '../types';
import {hasLocation, type LatLng} from '../model/geo';

/** France, for a map with nothing on it yet. */
const NOWHERE: [number, number] = [46.6, 2.4];

/** A map with satellite and street layers, sized again whenever its box changes (a sheet sliding in, a rotation). */
function useMap(element: RefObject<HTMLDivElement | null>, setUp: (map: L.Map) => void) {
  const mapRef = useRef<L.Map | null>(null);
  const setUpRef = useRef(setUp);
  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current, {scrollWheelZoom: false, worldCopyJump: true});
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {maxZoom: 19, attribution: 'Tiles © Esri'},
    );
    const streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '© OpenStreetMap contributors © CARTO',
    });
    satellite.addTo(map);
    L.control.layers({Satellite: satellite, Map: streets}, undefined, {position: 'topright'}).addTo(map);
    map.setView(NOWHERE, 5);
    mapRef.current = map;
    setUpRef.current(map);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(element.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [element]);
  return mapRef;
}

/** A round pin with the spot's emoji, bigger where more sorties were flown. */
function pin(spot: Spot, size: number, faint = false) {
  const html = document.createElement('span');
  html.className = `map-pin-mark ${faint ? 'faint' : ''}`;
  html.style.setProperty('--size', `${size}px`);
  html.textContent = spot.emoji ?? '';
  return L.divIcon({className: 'map-pin', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2]});
}

/** Every spot with a location, its name beside it; a tap on one opens it. */
export function SpotsMap({
  spots,
  sorties,
  onSelect,
}: {
  spots: Spot[];
  sorties: Map<string, number>;
  onSelect: (spot: Spot) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const map = useMap(element, created => {
    layer.current = L.layerGroup().addTo(created);
  });

  useEffect(() => {
    const current = map.current;
    if (!current || !layer.current) return;
    layer.current.clearLayers();
    const placed = spots.filter(hasLocation);
    const most = Math.max(1, ...placed.map(spot => sorties.get(spot.id) ?? 0));
    for (const spot of placed) {
      const size = Math.round(22 + 20 * Math.sqrt((sorties.get(spot.id) ?? 0) / most));
      L.marker([spot.lat, spot.lng], {icon: pin(spot, size), title: spot.name})
        .bindTooltip(spot.name, {permanent: true, direction: 'right', offset: [size / 2, 0], className: 'map-label'})
        .on('click', () => select.current(spot))
        .addTo(layer.current);
    }
    if (placed.length === 1) current.setView([placed[0].lat, placed[0].lng], 15);
    if (placed.length > 1) {
      current.fitBounds(L.latLngBounds(placed.map(spot => [spot.lat, spot.lng])), {padding: [48, 48], maxZoom: 15});
    }
  }, [map, spots, sorties]);

  return <div ref={element} className="spots-map" />;
}

/**
 * Where a spot is: a tap on the map puts the pin there, and the pin can be dragged. The other spots show faintly to
 * find the way.
 */
export function LocationPicker({
  value,
  onChange,
  others,
}: {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  others: Spot[];
}) {
  const element = useRef<HTMLDivElement>(null);
  const marker = useRef<L.Marker | null>(null);
  const placedHere = useRef<LatLng | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const map = useMap(element, created => {
    const placed = others.filter(hasLocation);
    for (const spot of placed) {
      L.marker([spot.lat, spot.lng], {icon: pin(spot, 22, true), interactive: false})
        .bindTooltip(spot.name, {permanent: true, direction: 'right', offset: [11, 0], className: 'map-label faint'})
        .addTo(created);
    }
    if (!value && placed.length) {
      created.fitBounds(L.latLngBounds(placed.map(spot => [spot.lat, spot.lng])), {padding: [40, 40], maxZoom: 14});
    }
    created.on('click', event => {
      const next = {lat: Math.round(event.latlng.lat * 1e6) / 1e6, lng: Math.round(event.latlng.lng * 1e6) / 1e6};
      placedHere.current = next;
      change.current(next);
    });
  });

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    // A pin left on a map that was taken down (React mounts twice in development) is made again on this one.
    if (!marker.current || !current.hasLayer(marker.current)) {
      marker.current = L.marker([value.lat, value.lng], {
        icon: pin({id: 'here', name: 'Here', emoji: '📍'}, 30),
        draggable: true,
        autoPan: true,
      }).addTo(current);
      marker.current.on('dragend', () => {
        const at = marker.current!.getLatLng();
        const next = {lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6};
        placedHere.current = next;
        change.current(next);
      });
    } else {
      marker.current.setLatLng([value.lat, value.lng]);
    }
    // A place typed or found by the phone: go there. One set on the map: stay where the pilot is looking.
    const fromMap = placedHere.current?.lat === value.lat && placedHere.current?.lng === value.lng;
    if (!fromMap) current.setView([value.lat, value.lng], Math.max(current.getZoom(), 16));
  }, [map, value]);

  return <div ref={element} className="location-picker" />;
}
