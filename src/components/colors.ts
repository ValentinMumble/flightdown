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
    grid: 'rgba(124, 255, 178, 0.06)',
    axis: 'rgba(150, 200, 175, 0.2)',
    muted: '#6f7f78',
    surface: '#0a0d0f',
    ink: '#edf5f0',
    label: '#6d9a82',
  };
}
