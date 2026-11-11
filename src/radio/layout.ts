import type {LayoutOptions} from './card';

/**
 * Where EdgeTX 2.12 puts a screen's widgets on the TX16S (480 × 272), from its source: each layout's zones in 60ths of
 * the main view, and the main view what the top bar, the sliders, the trims and the flight mode leave of the screen.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SCREEN = {width: 480, height: 272};
/** The bars of the side and bottom sliders, and the trims: a 15 px icon and a pixel each side. */
const SLIDER_BAR = 17;
const FONT_HEIGHT = 21;
export const TOP_BAR = 45;
/** The margin round the main view once a slider, trim or the flight mode shows. */
const MARGIN = 8;
const TOPBAR_LEFT = 47;
const TOPBAR_SLOT = 74;
const TOPBAR_GAP = 2;
const TOPBAR_INSET = 3;
export const TOPBAR_SLOTS = Math.floor((SCREEN.width - TOPBAR_LEFT - 1 + TOPBAR_SLOT / 2) / TOPBAR_SLOT);

/** Each layout's zones: x, y, width, height in 60ths, in the order the model file numbers them. */
export const LAYOUTS: Record<string, [number, number, number, number][]> = {
  Layout1x1: [[0, 0, 60, 60]],
  Layout1x1AM: [[0, 0, 60, 60]],
  Layout1P2: [
    [0, 0, 60, 30],
    [0, 30, 60, 15],
    [0, 45, 60, 15],
  ],
  Layout1P3: [
    [0, 0, 30, 60],
    [30, 0, 30, 20],
    [30, 20, 30, 20],
    [30, 40, 30, 20],
  ],
  Layout1P4: [
    [0, 0, 30, 60],
    [30, 0, 30, 15],
    [30, 15, 30, 15],
    [30, 30, 30, 15],
    [30, 45, 30, 15],
  ],
  Layout1x2: [
    [0, 0, 60, 30],
    [0, 30, 60, 30],
  ],
  Layout1x3: [
    [0, 0, 60, 20],
    [0, 20, 60, 20],
    [0, 40, 60, 20],
  ],
  Layout1x4: [
    [0, 0, 60, 15],
    [0, 15, 60, 15],
    [0, 30, 60, 15],
    [0, 45, 60, 15],
  ],
  Layout1x6: [
    [0, 0, 60, 10],
    [0, 10, 60, 10],
    [0, 20, 60, 10],
    [0, 30, 60, 10],
    [0, 40, 60, 10],
    [0, 50, 60, 10],
  ],
  // The right zone first: EdgeTX keeps the order of its older layouts.
  Layout2P1: [
    [30, 0, 30, 60],
    [0, 0, 30, 30],
    [0, 30, 30, 30],
  ],
  Layout2P3: [
    [0, 0, 30, 30],
    [0, 30, 30, 30],
    [30, 0, 30, 20],
    [30, 20, 30, 20],
    [30, 40, 30, 20],
  ],
  Layout2x1: [
    [0, 0, 30, 60],
    [30, 0, 30, 60],
  ],
  Layout2x2: [
    [0, 0, 30, 30],
    [0, 30, 30, 30],
    [30, 0, 30, 30],
    [30, 30, 30, 30],
  ],
  Layout2x3: [
    [0, 0, 30, 20],
    [0, 20, 30, 20],
    [0, 40, 30, 20],
    [30, 20, 30, 20],
    [30, 40, 30, 20],
    [30, 0, 30, 20],
  ],
  Layout2x4: [
    [0, 0, 30, 15],
    [0, 15, 30, 15],
    [0, 30, 30, 15],
    [0, 45, 30, 15],
    [30, 0, 30, 15],
    [30, 15, 30, 15],
    [30, 30, 30, 15],
    [30, 45, 30, 15],
  ],
  Layout4P2: [
    [0, 0, 30, 15],
    [0, 15, 30, 15],
    [0, 30, 30, 15],
    [0, 45, 30, 15],
    [30, 0, 30, 30],
    [30, 30, 30, 30],
  ],
  Layout4P2B: [
    [0, 0, 30, 15],
    [0, 15, 30, 15],
    [0, 30, 30, 15],
    [0, 45, 30, 15],
    [30, 0, 30, 45],
    [30, 45, 30, 15],
  ],
};

/** EdgeTX's whole-number sizes: C's division, cut towards zero. */
const part = (size: number, sixtieths: number) => Math.trunc((size * sixtieths) / 60);

/**
 * The main view of a TX16S (side sliders, bottom sliders and the 6-position buttons): what is left once the shown
 * decorations take their room.
 */
export function mainView(options: LayoutOptions): Rect {
  let x = 0;
  let w = SCREEN.width;
  let bottom = 0;
  if (options.sliders) {
    x += SLIDER_BAR;
    w -= 2 * SLIDER_BAR;
    bottom = SLIDER_BAR;
  }
  if (options.trims) {
    x += SLIDER_BAR;
    w -= 2 * SLIDER_BAR;
    bottom += options.flightMode ? FONT_HEIGHT : SLIDER_BAR;
  } else if (options.flightMode) {
    bottom += FONT_HEIGHT;
  }
  let zone = {x, y: 0, w, h: SCREEN.height - bottom};
  if (options.sliders || options.trims || options.flightMode) {
    zone = {x: zone.x + MARGIN, y: MARGIN, w: zone.w - 2 * MARGIN, h: zone.h - 2 * MARGIN};
  }
  if (options.topbar) zone = {...zone, y: zone.y + TOP_BAR, h: zone.h - TOP_BAR};
  return zone;
}

/** A layout's zones on the screen, mirrored when the screen is set so. An unknown layout is one full zone. */
export function layoutZones(layout: string, options: LayoutOptions): Rect[] {
  const view = mainView(options);
  return (LAYOUTS[layout] ?? LAYOUTS.Layout1x1).map(([left, top, wide, tall]) => {
    const w = part(view.w, wide);
    const across = part(view.w, left);
    return {
      x: view.x + (options.mirrored ? view.w - across - w : across),
      y: view.y + part(view.h, top),
      w,
      h: part(view.h, tall),
    };
  });
}

/** The top bar's widget slots, right of the EdgeTX button; a widget may span several (`widths`). */
export function topbarZones(widths: number[] = []): Rect[] {
  const zones: Rect[] = [];
  let x = TOPBAR_LEFT + 1;
  for (let index = 0; index < TOPBAR_SLOTS; index += 1) {
    const span = Math.max(1, widths[index] ?? 1);
    const w = Math.min((span - 1) * (TOPBAR_SLOT + TOPBAR_GAP) + TOPBAR_SLOT, SCREEN.width - x);
    zones.push({x, y: TOPBAR_INSET, w, h: TOP_BAR - 2 * TOPBAR_INSET});
    x += span * (TOPBAR_SLOT + TOPBAR_GAP);
  }
  return zones;
}
