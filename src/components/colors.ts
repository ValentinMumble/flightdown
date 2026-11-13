import {OTHER_DARK, RAMP_DARK, SERIES_DARK} from '../model/palette';

/** Flightdown is dark only: charts always take the palette's dark steps. */
export const useDark = () => true;

/** A heli's chart colour by its palette slot; -1 for the grey of folded series. */
export function useSeriesColor() {
  return (slot: number) => (slot < 0 ? OTHER_DARK : SERIES_DARK[slot % SERIES_DARK.length]);
}

export function useRamp() {
  return RAMP_DARK;
}

/** Grid, axis and ink colours for charts, in step with the CSS tokens. */
export function useChartInk() {
  return {
    grid: 'rgba(57, 255, 120, 0.08)',
    axis: 'rgba(57, 255, 120, 0.3)',
    muted: '#3f8f5c',
    surface: '#030a05',
    ink: '#b9ffce',
    label: '#4fd17f',
  };
}
