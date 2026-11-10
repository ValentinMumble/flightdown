import {lazy, Suspense, type ComponentProps} from 'react';

/** The Leaflet maps load with their page, not with the app. */
const SpotsMapLater = lazy(async () => ({default: (await import('./SpotMaps')).SpotsMap}));
const LocationPickerLater = lazy(async () => ({default: (await import('./SpotMaps')).LocationPicker}));

export function SpotsMap(props: ComponentProps<typeof SpotsMapLater>) {
  return (
    <Suspense fallback={<div className="spots-map" />}>
      <SpotsMapLater {...props} />
    </Suspense>
  );
}

export function LocationPicker(props: ComponentProps<typeof LocationPickerLater>) {
  return (
    <Suspense fallback={<div className="location-picker" />}>
      <LocationPickerLater {...props} />
    </Suspense>
  );
}
