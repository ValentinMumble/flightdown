import {EDGETX_WIDGETS, type Card, type CardModel, type CardOption, type CardZone, type LayoutOptions} from './card';
import {layoutZones, mainView, TOP_BAR, topbarZones, type Rect} from './layout';
import {SCREEN, THEME, type Radio, type WidgetOption, type WidgetRunner} from './edgetx';
import {radioFile} from './widgets';

/**
 * A model's whole screen on the simulated radio: the screen around the zones (top bar, sliders, trims), each zone's
 * widget, Lua from the card or one of EdgeTX's own redrawn here, and the conversion of the options the model file keeps.
 */

/** A widget put in a zone of the screen. */
export interface Placed {
  id: string;
  widget: string;
  rect: Rect;
  kind: 'lua' | 'builtin' | 'missing';
  /** The card widget's folder, its key for the Lua side. */
  key?: string;
  options: CardOption[];
  problem?: string;
}

const THEME_ORDER = [
  'COLOR_THEME_PRIMARY1',
  'COLOR_THEME_PRIMARY2',
  'COLOR_THEME_PRIMARY3',
  'COLOR_THEME_SECONDARY1',
  'COLOR_THEME_SECONDARY2',
  'COLOR_THEME_SECONDARY3',
  'COLOR_THEME_FOCUS',
  'COLOR_THEME_EDIT',
  'COLOR_THEME_ACTIVE',
  'COLOR_THEME_WARNING',
  'COLOR_THEME_DISABLED',
];

/** A colour option as the widget gets it: a colour flag, from "0xF8F8F8" or a theme colour (COLIDX3). */
function colorFlag(radio: Radio, value: number | string) {
  if (typeof value === 'number') return radio.RGB(value);
  const themed = /^COLIDX(\d+)$/.exec(value);
  const constants = radio.constants() as Record<string, number>;
  if (themed) return constants[THEME_ORDER[Number(themed[1])] ?? 'COLOR_THEME_PRIMARY1'];
  return radio.RGB(parseInt(value.replace(/^0x/i, ''), 16) || 0);
}

/** The options a model gives a Lua widget, by the names the widget declares them, as the Lua side reads them. */
export function optionLines(radio: Radio, declared: WidgetOption[], values: CardOption[]) {
  return declared
    .map((option, index) => {
      const given = values[index];
      let value: number | string = option.type === 'source' ? '' : option.initial;
      if (given) {
        if (given.type === 'Color') value = colorFlag(radio, given.value);
        else if (given.type === 'Source' || given.type === 'String') value = String(given.value);
        else value = Number(given.value) || 0;
      }
      return `${option.name}\t${value}`;
    })
    .join('\n');
}

/** The zones of a model's screen (or its top bar) with the widget each holds. */
export function placeScreen(model: CardModel, screen: number): {rect: Rect; zone: CardZone; id: string}[] {
  const page = model.screens[screen];
  const placed: {rect: Rect; zone: CardZone; id: string}[] = [];
  if (!page || page.options.topbar) {
    const slots = topbarZones(model.topbarWidths);
    for (const zone of model.topbar) {
      if (slots[zone.index]) placed.push({rect: slots[zone.index], zone, id: `top-${zone.index}`});
    }
  }
  if (page) {
    const rects = layoutZones(page.layout, page.options);
    for (const zone of page.zones) {
      if (rects[zone.index]) placed.push({rect: rects[zone.index], zone, id: `zone-${zone.index}`});
    }
  }
  return placed;
}

const loaded = new Map<string, Promise<{name: string; options: WidgetOption[]}>>();

/**
 * A card widget, ready to create: its Lua files and pictures fetched (for loadScript and Bitmap.open), its main.lua
 * loaded once. Null when the card has no Lua widget of that name.
 */
export function loadCardWidget(card: Card, name: string, runner: WidgetRunner, radio: Radio) {
  const widget = card.widgets.find(one => one.name === name);
  if (!widget) return null;
  const known = loaded.get(widget.folder);
  if (known) return known.then(result => ({...result, key: widget.folder}));
  const load = async () => {
    let main = '';
    for (const file of widget.files) {
      const path = `WIDGETS/${widget.folder}/${file}`;
      const url = radioFile(path);
      if (file.toLowerCase().endsWith('.lua')) {
        const code = await (await fetch(url)).text();
        radio.files.set(path, code);
        if (file === 'main.lua') main = code;
      } else {
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          radio.images.set(path, await createImageBitmap(image));
        } catch {
          // A picture the browser cannot read: the widget gets nil for it, as for a missing file.
        }
      }
    }
    return runner.load(widget.folder, main);
  };
  const promise = load();
  loaded.set(widget.folder, promise);
  promise.catch(() => loaded.delete(widget.folder));
  return promise.then(result => ({...result, key: widget.folder}));
}

export const isBuiltin = (name: string) => EDGETX_WIDGETS.includes(name);

/** The model's timer: here, the time since the simulator started. */
const timerSeconds = (radio: Radio) => Math.floor(radio.getTime() / 100);

/**
 * EdgeTX's own widgets, redrawn: close to the radio's, not the same. Draws in `radio.zone`, set to the widget's zone.
 */
export function drawBuiltin(radio: Radio, placed: Placed, model: {name: string; bitmap: string}) {
  const {w, h} = placed.rect;
  const colors = radio.constants() as Record<string, number>;
  const ink = colors.COLOR_THEME_PRIMARY1;
  const strong = colors.COLOR_THEME_EDIT;
  const small = colors.SMLSIZE;
  const option = (index: number) => placed.options[index]?.value;
  switch (placed.widget) {
    case 'ModelBmp': {
      radio.drawText(w / 2, 2, model.name, small + colors.CENTER + strong);
      const id = radio.bitmapOpen(`/IMAGES/${model.bitmap}`);
      if (id >= 0) radio.drawBitmap(radio.bitmapResize(id, w - 4, h - 22), 2, 20);
      return;
    }
    case 'Model Name':
      radio.drawText(w / 2, h / 2, model.name, colors.CENTER + colors.VCENTER + strong);
      return;
    case 'Timer': {
      radio.drawText(4, 2, 'TMR1', small + ink);
      const big = h >= 60 ? colors.DBLSIZE : colors.MIDSIZE;
      radio.drawTimer(w / 2, h / 2 + 6, timerSeconds(radio), big + colors.CENTER + colors.VCENTER + strong);
      return;
    }
    case 'Value': {
      const source = String(option(0) ?? '');
      radio.drawText(4, 2, source || 'Value', small + ink);
      radio.drawText(4, h / 2, String(radio.getValue(source)), colors.MIDSIZE + strong);
      return;
    }
    case 'Text':
      radio.drawText(4, h / 2, String(option(0) ?? 'Text'), colors.VCENTER + strong);
      return;
    case 'Outputs': {
      // Its options, as EdgeTX reads them: the first channel, fill the background, its colour, the text's, the bars'.
      const first = Math.max(1, Number(option(0)) || 1);
      const color = (index: number, fallback: number) => {
        const value = option(index);
        return value === undefined ? fallback : colorFlag(radio, value);
      };
      if (Number(option(1)) === 1) radio.drawFilledRectangle(0, 0, w, h, color(2, colors.COLOR_THEME_SECONDARY3));
      const text = color(3, ink);
      const fill = color(4, colors.COLOR_THEME_SECONDARY1);
      const count = Math.max(1, Math.min(8, Math.floor((h - 4) / 14)));
      const bar = Math.min(18, Math.floor((h - 4) / count) - 2);
      for (let index = 0; index < count; index += 1) {
        const channel = first - 1 + index;
        const top = 2 + index * (bar + 2);
        const value = radio.getValue(`ch(${channel})`);
        radio.drawFilledRectangle(2, top, w - 4, bar, colors.COLOR_THEME_SECONDARY2);
        const half = (w - 4) / 2;
        const length = Math.round((Math.max(-1024, Math.min(1024, value)) / 1024) * half);
        radio.drawFilledRectangle(2 + half + Math.min(0, length), top, Math.abs(length) || 1, bar, fill);
        radio.drawText(6, top + bar / 2, `CH${channel + 1}`, small + colors.VCENTER + text);
      }
      return;
    }
    case 'Gauge': {
      const source = String(option(0) ?? '');
      const value = radio.getValue(source);
      radio.drawText(4, 2, source || 'Gauge', small + ink);
      radio.drawGauge(4, h / 2, w - 8, Math.min(16, h / 3), Math.max(0, value + 1024), 2048, colors.COLOR_THEME_ACTIVE);
      return;
    }
    case 'Date Time': {
      const now = new Date();
      const two = (value: number) => String(value).padStart(2, '0');
      // Both lines in its colour option, the theme's PRIMARY2 unless set (EdgeTX's HeaderDateTime).
      const color =
        option(0) === undefined ? colors.COLOR_THEME_PRIMARY2 : colorFlag(radio, option(0) as number | string);
      radio.drawText(w / 2, 4, `${two(now.getHours())}:${two(now.getMinutes())}`, colors.CENTER + color);
      radio.drawText(w / 2, h - 16, `${two(now.getDate())}/${two(now.getMonth() + 1)}`, small + colors.CENTER + color);
      return;
    }
    case 'Radio Info': {
      // The radio's battery and the link, as bars.
      for (let index = 0; index < 5; index += 1) {
        radio.drawFilledRectangle(
          4 + index * 5,
          h - 8 - index * 3,
          3,
          6 + index * 3,
          index < 4 ? ink : colors.COLOR_THEME_SECONDARY2,
        );
      }
      radio.drawRectangle(36, h / 2 - 6, 26, 12, ink);
      radio.drawFilledRectangle(38, h / 2 - 4, 18, 8, colors.GREEN);
      return;
    }
  }
}

/** A zone whose widget is not on the card (or failed): its frame and its name, as a note. */
export function drawMissing(radio: Radio, placed: Placed) {
  const colors = radio.constants() as Record<string, number>;
  radio.drawRectangle(0, 0, placed.rect.w, placed.rect.h, colors.COLOR_THEME_SECONDARY2);
  radio.drawText(4, 2, placed.widget, colors.SMLSIZE + colors.COLOR_THEME_PRIMARY1);
  if (placed.problem) {
    radio.drawText(4, 18, placed.problem.slice(0, 60), colors.SMLSIZE + colors.COLOR_THEME_WARNING);
  }
}

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * The screen around the widgets: the theme's background, the top bar with the EdgeTX button, and the sliders, trims and
 * flight mode a layout shows, as plain bars.
 */
export function drawChrome(context: CanvasRenderingContext2D, options: LayoutOptions | null, flightMode = 'Normal') {
  context.save();
  context.fillStyle = hex(THEME.COLOR_THEME_SECONDARY3);
  context.fillRect(0, 0, SCREEN.width, SCREEN.height);
  const shown = options ?? {topbar: true, flightMode: false, sliders: false, trims: false, mirrored: false};
  if (shown.topbar) {
    // EdgeTX paints the top bar in the theme's SECONDARY1: near black in the radio's Cockpit theme.
    context.fillStyle = hex(THEME.COLOR_THEME_SECONDARY1);
    context.fillRect(0, 0, SCREEN.width, TOP_BAR);
    // The EdgeTX button.
    context.fillStyle = hex(THEME.COLOR_THEME_SECONDARY2);
    context.beginPath();
    context.roundRect(4, 4, 39, TOP_BAR - 8, 6);
    context.fill();
    context.fillStyle = hex(THEME.COLOR_THEME_PRIMARY2);
    context.font = '700 11px Roboto, Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('ETX', 23.5, TOP_BAR / 2);
    context.textAlign = 'left';
  }
  const view = mainView(shown);
  const top = shown.topbar ? TOP_BAR : 0;
  const bar = (x: number, y: number, w: number, h: number) => {
    context.fillStyle = hex(THEME.COLOR_THEME_SECONDARY2);
    context.beginPath();
    context.roundRect(x, y, w, h, Math.min(w, h) / 2);
    context.fill();
    context.fillStyle = hex(THEME.COLOR_THEME_PRIMARY1);
    if (w < h) context.fillRect(x, y + h / 2 - 1, w, 2);
    else context.fillRect(x + w / 2 - 1, y, 2, h);
  };
  const bottom = SCREEN.height;
  if (shown.sliders) {
    bar(4, top + 10, 9, view.h + 8);
    bar(SCREEN.width - 13, top + 10, 9, view.h + 8);
    bar(40, bottom - 15, 150, 9);
    bar(SCREEN.width - 190, bottom - 15, 150, 9);
  }
  if (shown.trims) {
    const left = shown.sliders ? 21 : 4;
    bar(left, top + 10, 9, view.h + 8);
    bar(SCREEN.width - left - 9, top + 10, 9, view.h + 8);
    const row = bottom - (shown.sliders ? 32 : 15);
    bar(40, row, 150, 9);
    bar(SCREEN.width - 190, row, 150, 9);
  }
  if (shown.flightMode) {
    context.fillStyle = hex(THEME.COLOR_THEME_PRIMARY1);
    context.font = '500 13px Roboto, Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(flightMode, SCREEN.width / 2, bottom - (shown.sliders ? 28 : 11));
    context.textAlign = 'left';
  }
  context.restore();
}
