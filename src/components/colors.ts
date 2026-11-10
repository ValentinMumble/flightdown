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
    grid: 'rgba(73, 207, 230, 0.08)',
    axis: 'rgba(150, 180, 210, 0.22)',
    muted: '#6c7787',
    surface: '#0c1118',
    ink: '#e8eef5',
    label: '#49cfe6',
  };
}
