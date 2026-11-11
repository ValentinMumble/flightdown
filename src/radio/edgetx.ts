/**
 * A RadioMaster TX16S screen in the browser: the EdgeTX Lua calls a widget makes (lcd, Bitmap, getValue, getTime...)
 * drawn on a canvas the size of the radio's screen. The widget's Lua runs as it is, in Fengari (Lua in JavaScript).
 *
 * It follows the radio (EdgeTX 2.12) where drawing depends on it: coordinates are cut to whole pixels, angles start at
 * 12 o'clock and go clockwise, an arc whose start and end land on the same angle (0 to 360) draws nothing, and a resized
 * picture is fitted and centred in the size asked. Fonts are close, not exact.
 */

export const SCREEN = {width: 480, height: 272};

/** FM2M Concrete, the radio's theme, and EdgeTX's named colours. */
export const THEME = {
  COLOR_THEME_PRIMARY1: 0xa0a0a0,
  COLOR_THEME_PRIMARY2: 0x202020,
  COLOR_THEME_PRIMARY3: 0x505050,
  COLOR_THEME_SECONDARY1: 0x808080,
  COLOR_THEME_SECONDARY2: 0x505050,
  COLOR_THEME_SECONDARY3: 0x303030,
  COLOR_THEME_FOCUS: 0xc0c0c0,
  COLOR_THEME_EDIT: 0xeeeeee,
  COLOR_THEME_ACTIVE: 0x3b75a9,
  COLOR_THEME_WARNING: 0x794044,
  COLOR_THEME_DISABLED: 0x808080,
  WHITE: 0xffffff,
  BLACK: 0x000000,
  LIGHTWHITE: 0xeeeeee,
  LIGHTGREY: 0xc0c0c0,
  GREY: 0x969696,
  DARKGREY: 0x404040,
  RED: 0xe50000,
  DARKRED: 0x800000,
  ORANGE: 0xe58d00,
  YELLOW: 0xf0d000,
  GREEN: 0x19a000,
  DARKGREEN: 0x006400,
  BLUE: 0x0050e0,
  DARKBLUE: 0x00305a,
  CUSTOM_COLOR: 0xffffff,
};

/** Text flags, in the low 16 bits; a colour's palette slot sits above them. The values are this preview's own. */
const FLAG = {
  INVERS: 1,
  BLINK: 2,
  BOLD: 4,
  SHADOWED: 8,
  RIGHT: 16,
  CENTER: 32,
  VCENTER: 64,
  TINSIZE: 128,
  SMLSIZE: 256,
  MIDSIZE: 512,
  DBLSIZE: 1024,
  XXLSIZE: 2048,
  PREC1: 4096,
  PREC2: 8192,
};

const FONT_SIZES: [number, number][] = [
  [FLAG.XXLSIZE, 64],
  [FLAG.DBLSIZE, 32],
  [FLAG.MIDSIZE, 22],
  [FLAG.SMLSIZE, 12],
  [FLAG.TINSIZE, 9],
];

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;
const whole = Math.trunc;

interface RadioBitmap {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Where the picture sits in the bitmap: a resized one keeps its shape, centred. */
  inside: {x: number; y: number; width: number; height: number};
}

/** What the widget reads: its sources' values, and the model it is on. */
export interface RadioInputs {
  value: (source: string) => number;
  /** The model it is on: its name, picture and global variables (first flight mode, by index). */
  model: {name: string; bitmap: string; globals?: Record<number, number>};
}

/**
 * The radio. `refresh` runs one widget refresh in its zone; the inputs (switches, sources, the model) come from
 * `inputs`, which the page sets.
 */
export class Radio {
  readonly context: CanvasRenderingContext2D;
  zone = {x: 0, y: 0, w: SCREEN.width, h: SCREEN.height};
  /** Pictures the widget can open, by the name it opens them with. */
  readonly images = new Map<string, CanvasImageSource & {width: number; height: number}>();
  /** A widget's own Lua files, by their path on the card (/WIDGETS/LibGUI/libgui.lua), for loadScript. */
  readonly files = new Map<string, string>();
  /** Sources the widget asked for, so the page can give each a control. */
  readonly asked = new Set<string>();
  /** The last sounds and vibrations it played, newest first. */
  sounds: string[] = [];
  private palette: number[] = [0];
  private slots = new Map<string, number>();
  private names: Record<string, number> = {};
  private bitmaps: RadioBitmap[] = [];
  private started = performance.now();
  private pausedAt: number | null = null;

  private inputs: RadioInputs;

  constructor(canvas: HTMLCanvasElement, inputs: RadioInputs) {
    this.inputs = inputs;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    this.context = context;
    for (const [name, rgb] of Object.entries(THEME)) this.names[name] = this.colorFlag(rgb, name);
  }

  // Colours: a palette slot, kept in bits 16 and up of a flag, so they mix with text flags as on the radio.
  private colorFlag(rgb: number, name?: string) {
    const key = name ?? `rgb:${rgb}`;
    if (!this.slots.has(key)) {
      this.slots.set(key, this.palette.length);
      this.palette.push(rgb);
    }
    return this.slots.get(key)! << 16;
  }

  private color(flags: number | undefined, fallback = THEME.COLOR_THEME_PRIMARY1) {
    const slot = ((flags ?? 0) >>> 16) & 0xfff;
    return hex(slot ? this.palette[slot] : fallback);
  }

  constants() {
    return {...FLAG, ...this.names, LCD_W: SCREEN.width, LCD_H: SCREEN.height};
  }

  RGB(red: number, green?: number, blue?: number) {
    const rgb = green === undefined ? red & 0xffffff : ((red & 255) << 16) | ((green & 255) << 8) | ((blue ?? 0) & 255);
    return this.colorFlag(rgb);
  }

  setColor(slotFlag: number, colorFlag: number) {
    const slot = (slotFlag >>> 16) & 0xfff;
    const from = (colorFlag >>> 16) & 0xfff;
    if (slot) this.palette[slot] = this.palette[from] ?? 0;
  }

  // Time and inputs.
  getTime() {
    return Math.floor(((this.pausedAt ?? performance.now()) - this.started) / 10);
  }

  get paused() {
    return this.pausedAt !== null;
  }

  pause(paused: boolean) {
    if (paused && this.pausedAt === null) this.pausedAt = performance.now();
    if (!paused && this.pausedAt !== null) {
      this.started += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  getValue(source: unknown) {
    const key = String(source);
    this.asked.add(key);
    return this.inputs.value(key);
  }

  modelName() {
    return this.inputs.model.name;
  }

  modelBitmap() {
    return this.inputs.model.bitmap;
  }

  modelGlobal(index: number) {
    return this.inputs.model.globals?.[index] ?? 0;
  }

  play(kind: string, what: unknown) {
    this.sounds = [`${kind} ${String(what)}`, ...this.sounds].slice(0, 8);
  }

  // Bitmaps: loaded by the page beforehand, so a widget can read a size right after opening one.
  readFile(path: string) {
    return this.files.get(String(path).replace(/^\//, '')) ?? '';
  }

  /** A model picture by its file name (/IMAGES/M2_EVO_o.png), a widget's own by its path (/WIDGETS/Battery/a.png). */
  bitmapOpen(path: string) {
    const key = String(path).replace(/^\//, '');
    const image = this.images.get(key.replace(/^IMAGES\//, '')) ?? this.images.get(key);
    if (!image) return -1;
    const {width, height} = image;
    this.bitmaps.push({image, width, height, inside: {x: 0, y: 0, width, height}});
    return this.bitmaps.length - 1;
  }

  bitmapWidth(id: number) {
    return this.bitmaps[id]?.width ?? 0;
  }

  bitmapHeight(id: number) {
    return this.bitmaps[id]?.height ?? 0;
  }

  /** As the radio's: a bitmap of the size asked, the picture scaled to fit inside it, keeping its shape, centred. */
  bitmapResize(id: number, width: number, height: number) {
    const bitmap = this.bitmaps[id];
    if (!bitmap) return -1;
    const [wide, tall] = [whole(width), whole(height)];
    const scale = Math.min(wide / bitmap.inside.width, tall / bitmap.inside.height);
    const [fitWidth, fitHeight] = [bitmap.inside.width * scale, bitmap.inside.height * scale];
    this.bitmaps.push({
      image: bitmap.image,
      width: wide,
      height: tall,
      inside: {x: whole((wide - fitWidth) / 2), y: whole((tall - fitHeight) / 2), width: fitWidth, height: fitHeight},
    });
    return this.bitmaps.length - 1;
  }

  /** Forgets the bitmaps a widget opened, when it starts again. */
  resetBitmaps() {
    this.bitmaps = [];
  }

  // Drawing, inside the zone.
  private withZone(draw: (context: CanvasRenderingContext2D) => void) {
    const {context, zone} = this;
    context.save();
    context.beginPath();
    context.rect(zone.x, zone.y, zone.w, zone.h);
    context.clip();
    context.translate(zone.x, zone.y);
    draw(context);
    context.restore();
  }

  clear(flags?: number) {
    this.withZone(context => {
      context.fillStyle = this.color(flags, THEME.COLOR_THEME_SECONDARY3);
      context.fillRect(0, 0, this.zone.w, this.zone.h);
    });
  }

  drawPoint(x: number, y: number, flags?: number) {
    this.withZone(context => {
      context.fillStyle = this.color(flags);
      context.fillRect(whole(x), whole(y), 1, 1);
    });
  }

  /** A pixel at a time (Bresenham), as the radio draws a line; any pattern but SOLID dots it. */
  drawLine(x1: number, y1: number, x2: number, y2: number, pattern?: number, flags?: number) {
    let fromX = whole(x1);
    let fromY = whole(y1);
    const [toX, toY] = [whole(x2), whole(y2)];
    const dotted = Boolean(pattern);
    this.withZone(context => {
      context.fillStyle = this.color(flags);
      const stepX = Math.abs(toX - fromX);
      const stepY = -Math.abs(toY - fromY);
      const directionX = fromX < toX ? 1 : -1;
      const directionY = fromY < toY ? 1 : -1;
      let error = stepX + stepY;
      for (let count = 0; ; count += 1) {
        if (!dotted || count % 2 === 0) context.fillRect(fromX, fromY, 1, 1);
        if (fromX === toX && fromY === toY) break;
        const doubled = 2 * error;
        if (doubled >= stepY) {
          error += stepY;
          fromX += directionX;
        }
        if (doubled <= stepX) {
          error += stepX;
          fromY += directionY;
        }
      }
    });
  }

  drawRectangle(x: number, y: number, width: number, height: number, flags?: number, thickness = 1, opacity = 0) {
    const line = Math.max(1, whole(thickness ?? 1));
    const [left, top, wide, tall] = [x, y, width, height].map(whole);
    this.withZone(context => {
      context.globalAlpha = 1 - ((opacity ?? 0) & 15) / 16;
      context.fillStyle = this.color(flags);
      context.fillRect(left, top, wide, line);
      context.fillRect(left, top + tall - line, wide, line);
      context.fillRect(left, top, line, tall);
      context.fillRect(left + wide - line, top, line, tall);
    });
  }

  /** Opacity as the radio counts it: 0 is solid, 15 nearly see-through. */
  drawFilledRectangle(x: number, y: number, width: number, height: number, flags?: number, opacity = 0) {
    this.withZone(context => {
      context.globalAlpha = 1 - ((opacity ?? 0) & 15) / 16;
      context.fillStyle = this.color(flags);
      context.fillRect(whole(x), whole(y), whole(width), whole(height));
    });
  }

  invertRect(x: number, y: number, width: number, height: number) {
    this.withZone(context => {
      context.globalCompositeOperation = 'difference';
      context.fillStyle = '#ffffff';
      context.fillRect(whole(x), whole(y), whole(width), whole(height));
    });
  }

  drawCircle(x: number, y: number, radius: number, flags?: number) {
    this.withZone(context => {
      context.strokeStyle = this.color(flags);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(whole(x) + 0.5, whole(y) + 0.5, whole(radius), 0, Math.PI * 2);
      context.stroke();
    });
  }

  drawFilledCircle(x: number, y: number, radius: number, flags?: number) {
    this.withZone(context => {
      context.fillStyle = this.color(flags);
      context.beginPath();
      context.arc(whole(x) + 0.5, whole(y) + 0.5, whole(radius) + 0.5, 0, Math.PI * 2);
      context.fill();
    });
  }

  private triangle(points: number[], flags: number | undefined, filled: boolean) {
    const [x1, y1, x2, y2, x3, y3] = points.map(whole);
    const shift = filled ? 0 : 0.5;
    this.withZone(context => {
      context.beginPath();
      context.moveTo(x1 + shift, y1 + shift);
      context.lineTo(x2 + shift, y2 + shift);
      context.lineTo(x3 + shift, y3 + shift);
      context.closePath();
      if (filled) {
        context.fillStyle = this.color(flags);
        context.fill();
      } else {
        context.strokeStyle = this.color(flags);
        context.lineWidth = 1;
        context.stroke();
      }
    });
  }

  drawTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, flags?: number) {
    this.triangle([x1, y1, x2, y2, x3, y3], flags, false);
  }

  drawFilledTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, flags?: number) {
    this.triangle([x1, y1, x2, y2, x3, y3], flags, true);
  }

  /** The radio's arcs: angles from 12 o'clock, clockwise; the same start and end draws nothing. */
  private annulusSector(
    x: number,
    y: number,
    inner: number,
    outer: number,
    start: number,
    end: number,
    flags?: number,
  ) {
    let from = whole(start);
    let to = whole(end);
    if (to === from) to += 1;
    from -= 90;
    if (from < 0) from += 360;
    to -= 90;
    if (to < 0) to += 360;
    if (from === to || outer <= inner) return;
    const [centerX, centerY] = [whole(x) + 0.5, whole(y) + 0.5];
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    this.withZone(context => {
      context.fillStyle = this.color(flags);
      context.beginPath();
      context.arc(centerX, centerY, outer, radians(from), radians(to));
      if (inner > 0) context.arc(centerX, centerY, inner, radians(to), radians(from), true);
      else context.lineTo(centerX, centerY);
      context.closePath();
      context.fill();
    });
  }

  drawArc(x: number, y: number, radius: number, start: number, end: number, flags?: number) {
    const outer = whole(radius);
    if (outer > 0) this.annulusSector(x, y, outer - 1, outer, start, end, flags);
  }

  drawPie(x: number, y: number, radius: number, start: number, end: number, flags?: number) {
    const outer = whole(radius);
    if (outer > 0) this.annulusSector(x, y, 0, outer, start, end, flags);
  }

  drawAnnulus(x: number, y: number, inner: number, outer: number, start: number, end: number, flags?: number) {
    this.annulusSector(x, y, whole(inner), whole(outer), start, end, flags);
  }

  // Text.
  private font(flags = 0) {
    const size = FONT_SIZES.find(([flag]) => (flags & 0xf80) === flag)?.[1] ?? 16;
    return {size, css: `${flags & FLAG.BOLD ? 700 : 500} ${size}px Roboto, "Helvetica Neue", Arial, sans-serif`};
  }

  sizeTextWidth(text: unknown, flags?: number) {
    this.context.font = this.font(flags ?? 0).css;
    return Math.ceil(this.context.measureText(String(text)).width);
  }

  sizeTextHeight(flags?: number) {
    return Math.round(this.font(flags ?? 0).size * 1.2);
  }

  drawText(x: number, y: number, text: unknown, flags?: number, inverseColor?: number) {
    const value = String(text);
    const options = flags ?? 0;
    const {size, css} = this.font(options);
    this.withZone(context => {
      context.font = css;
      const width = context.measureText(value).width;
      let left = whole(x);
      if (options & FLAG.RIGHT) left -= width;
      else if (options & FLAG.CENTER) left -= width / 2;
      let top = whole(y);
      if (options & FLAG.VCENTER) top -= (size * 1.2) / 2;
      if (options & FLAG.INVERS) {
        context.fillStyle = this.color(inverseColor, THEME.COLOR_THEME_FOCUS);
        context.fillRect(left - 2, top, width + 4, size * 1.2);
      }
      context.textBaseline = 'top';
      if (options & FLAG.SHADOWED) {
        context.fillStyle = '#000000';
        context.fillText(value, left + 1, top + size * 0.1 + 1);
      }
      context.fillStyle = this.color(options);
      context.fillText(value, left, top + size * 0.1);
    });
  }

  drawNumber(x: number, y: number, value: number, flags?: number) {
    const options = flags ?? 0;
    const digits = options & FLAG.PREC2 ? 2 : options & FLAG.PREC1 ? 1 : 0;
    this.drawText(x, y, (Number(value) / 10 ** digits).toFixed(digits), options);
  }

  drawTimer(x: number, y: number, seconds: number, flags?: number) {
    const total = whole(Math.abs(Number(seconds)));
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    this.drawText(x, y, `${seconds < 0 ? '-' : ''}${minutes}:${String(total % 60).padStart(2, '0')}`, flags);
  }

  drawSource(x: number, y: number, source: unknown, flags?: number) {
    this.drawText(x, y, String(source), flags);
  }

  drawGauge(x: number, y: number, width: number, height: number, fill: number, maximum: number, flags?: number) {
    this.drawRectangle(x, y, width, height, flags);
    const share = maximum ? Math.max(0, Math.min(1, fill / maximum)) : 0;
    this.drawFilledRectangle(x + 1, y + 1, (width - 2) * share, height - 2, flags);
  }

  /**
   * A mask (Bitmap.toMask) drawn in a colour: as the radio's, its dark pixels show and its light ones do not. With
   * angles, only the pie of it between them, around its centre (a timer's ring).
   */
  drawBitmapPattern(id: number, x: number, y: number, flags?: number, start?: number, end?: number) {
    const bitmap = this.bitmaps[id];
    if (!bitmap) return;
    const {inside} = bitmap;
    const tint = document.createElement('canvas');
    tint.width = Math.max(1, Math.ceil(inside.width));
    tint.height = Math.max(1, Math.ceil(inside.height));
    const paint = tint.getContext('2d', {willReadFrequently: true});
    if (!paint) return;
    paint.drawImage(bitmap.image, 0, 0, inside.width, inside.height);
    try {
      const pixels = paint.getImageData(0, 0, tint.width, tint.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const [red, green, blue, alpha] = pixels.data.slice(index, index + 4);
        pixels.data[index + 3] = Math.round((255 - (red + green + blue) / 3) * (alpha / 255));
      }
      paint.putImageData(pixels, 0, 0);
    } catch {
      // A picture from elsewhere cannot be read: its own transparency stands in for the mask.
    }
    paint.globalCompositeOperation = 'source-in';
    paint.fillStyle = this.color(flags);
    paint.fillRect(0, 0, tint.width, tint.height);
    const [left, top] = [whole(x) + inside.x, whole(y) + inside.y];
    this.withZone(context => {
      if (start !== undefined && end !== undefined) {
        let from = whole(start) - 90;
        let to = whole(end) - 90;
        if (from < 0) from += 360;
        if (to < 0) to += 360;
        const [centerX, centerY] = [left + tint.width / 2, top + tint.height / 2];
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.arc(centerX, centerY, Math.max(tint.width, tint.height), (from * Math.PI) / 180, (to * Math.PI) / 180);
        context.closePath();
        context.clip();
      }
      context.drawImage(tint, left, top);
    });
  }

  drawBitmap(id: number, x: number, y: number, scale?: number) {
    const bitmap = this.bitmaps[id];
    if (!bitmap) return;
    const factor = (scale || 100) / 100;
    const {inside} = bitmap;
    this.withZone(context => {
      context.drawImage(
        bitmap.image,
        whole(x) + inside.x * factor,
        whole(y) + inside.y * factor,
        inside.width * factor,
        inside.height * factor,
      );
    });
  }
}

/**
 * The EdgeTX API in Lua, each call handed to the radio above (window.edgetx). The __preview functions take a first
 * argument they ignore: Fengari passes JavaScript's `this` there when the page calls them.
 */
export const PRELUDE = String.raw`
local host = js.global.edgetx
local function int(value) return math.tointeger(value) or value end
local function bits(value) return math.tointeger(value) or math.tointeger(math.floor(value or 0)) or 0 end

bit32 = {}
function bit32.bor(...) local result = 0 for _, value in ipairs({...}) do result = result | bits(value) end return result end
function bit32.band(...) local result = -1 for _, value in ipairs({...}) do result = result & bits(value) end return result end
function bit32.bxor(...) local result = 0 for _, value in ipairs({...}) do result = result ~ bits(value) end return result end
function bit32.bnot(value) return ~bits(value) end
function bit32.btest(...) return bit32.band(...) ~= 0 end
function bit32.lshift(value, count) return bits(value) << count end
function bit32.rshift(value, count) return (bits(value) & 0xffffffff) >> count end
function bit32.arshift(value, count) return bits(value) // (1 << count) end

for name, value in pairs({SOLID = 0, DOTTED = 1, FORCE = 0, ERASE = 0, VALUE = 0, SOURCE = 1, BOOL = 2, STRING = 3, TIMER = 4,
  COLOR = 5, SWITCH = 6, TEXT_SIZE = 7, ALIGNMENT = 8, SLIDER = 9, CHOICE = 10, EVT_VIRTUAL_ENTER = 1,
  EVT_VIRTUAL_EXIT = 2, EVT_VIRTUAL_NEXT = 3, EVT_VIRTUAL_PREV = 4, EVT_VIRTUAL_NEXT_PAGE = 5,
  EVT_VIRTUAL_PREV_PAGE = 6}) do _G[name] = value end
do
  local constants = host:constants()
  for _, name in ipairs({'INVERS', 'BLINK', 'BOLD', 'SHADOWED', 'RIGHT', 'CENTER', 'VCENTER', 'TINSIZE', 'SMLSIZE',
    'MIDSIZE', 'DBLSIZE', 'XXLSIZE', 'PREC1', 'PREC2', 'LCD_W', 'LCD_H', 'COLOR_THEME_PRIMARY1',
    'COLOR_THEME_PRIMARY2', 'COLOR_THEME_PRIMARY3', 'COLOR_THEME_SECONDARY1', 'COLOR_THEME_SECONDARY2',
    'COLOR_THEME_SECONDARY3', 'COLOR_THEME_FOCUS', 'COLOR_THEME_EDIT', 'COLOR_THEME_ACTIVE', 'COLOR_THEME_WARNING',
    'COLOR_THEME_DISABLED', 'WHITE', 'BLACK', 'LIGHTWHITE', 'LIGHTGREY', 'GREY', 'DARKGREY', 'RED', 'DARKRED',
    'ORANGE', 'YELLOW', 'GREEN', 'DARKGREEN', 'BLUE', 'DARKBLUE', 'CUSTOM_COLOR'}) do
    _G[name] = int(constants[name])
  end
  LEFT = 0
end

lcd = {}
for _, name in ipairs({'drawPoint', 'drawLine', 'drawRectangle', 'drawFilledRectangle', 'invertRect', 'drawText',
  'drawTimer', 'drawNumber', 'drawSource', 'drawCircle', 'drawFilledCircle', 'drawTriangle', 'drawFilledTriangle',
  'drawArc', 'drawPie', 'drawAnnulus', 'drawGauge', 'clear', 'setColor'}) do
  lcd[name] = function(...) host[name](host, ...) end
end
function lcd.RGB(red, green, blue) return int(host:RGB(red, green, blue)) end
function lcd.sizeText(text, flags) return int(host:sizeTextWidth(text, flags)), int(host:sizeTextHeight(flags)) end
function lcd.drawBitmap(bitmap, x, y, scale) if bitmap then host:drawBitmap(bitmap.id, x, y, scale) end end
function lcd.refresh() end
function lcd.resetBacklightTimeout() end
function lcd.exitFullScreen() end
RGB = lcd.RGB

Bitmap = {}
function Bitmap.open(path)
  local id = int(host:bitmapOpen(path))
  if id < 0 then return nil end
  return {id = id}
end
function Bitmap.getSize(bitmap) return int(host:bitmapWidth(bitmap.id)), int(host:bitmapHeight(bitmap.id)) end
function Bitmap.resize(bitmap, width, height)
  local id = int(host:bitmapResize(bitmap.id, width, height))
  if id < 0 then return nil end
  return {id = id}
end
function Bitmap.toMask(bitmap) return bitmap end
function lcd.drawBitmapPattern(mask, x, y, flags) if mask then host:drawBitmapPattern(mask.id, x, y, flags) end end
function lcd.drawBitmapPatternPie(mask, x, y, start, finish, flags)
  if mask then host:drawBitmapPattern(mask.id, x, y, flags, start, finish) end
end

model = {}
local globalVariables = {}
function model.getInfo() return {name = host:modelName(), bitmap = host:modelBitmap()} end
-- What a widget set, else the model's own value (first flight mode).
function model.getGlobalVariable(index, phase)
  local set = globalVariables[(phase or 0) * 100 + index]
  if set ~= nil then return set end
  if (phase or 0) == 0 then return int(host:modelGlobal(index)) end
  return 0
end
function model.setGlobalVariable(index, phase, value) globalVariables[(phase or 0) * 100 + index] = value end
function model.getTimer(index)
  return {value = int(host:getTime()) // 100, start = 0, mode = 1, countdownBeep = 0, minuteBeep = false,
    persistent = 0, name = ''}
end
function model.getOutput(index)
  return {name = 'CH' .. (index + 1), min = -1000, max = 1000, offset = 0, ppmCenter = 1500, symetrical = 0,
    revert = 0}
end
function getOutputValue(index) return int(host:getValue('CH' .. (index + 1))) end
function getRSSI() return int(host:getValue('RSSI')), 45, 42 end
function getValue(source) return int(host:getValue(source)) end
function getTime() return int(host:getTime()) end
function getDateTime()
  local now = os.date('*t')
  return {year = now.year, mon = now.month, day = now.day, hour = now.hour, min = now.min, sec = now.sec}
end
function playFile(file) host:play('file', file) end
function playNumber(value, unit) host:play('number', value) end
function playTone(frequency) host:play('tone', frequency) end
function playHaptic(duration) host:play('haptic', duration) end

local modules, instances = {}, {}
local function optionsFrom(values)
  local options = {}
  for line in values:gmatch('[^\n]+') do
    local name, value = line:match('^([^\t]*)\t(.*)$')
    if name then options[name] = int(tonumber(value)) or value end
  end
  return options
end

-- A widget's own files (LibGUI, a loadable part): read from those the page fetched with it.
function loadScript(path, mode, env)
  local code = host:readFile(path)
  if not code or code == '' then return nil, 'No such script: ' .. tostring(path) end
  return load(code, '=' .. path, 't', env or _G)
end
function getUsage() return 10 end
function getFieldInfo(name) return {id = 0, name = tostring(name), desc = tostring(name), unit = 0} end

-- Widgets by key (a module loaded once), and their instances by id (one a zone).
function __preview_load(_, key, code)
  local chunk, problem = load(code, '=' .. key, 't')
  if not chunk then error(problem, 0) end
  local module = chunk()
  if type(module) ~= 'table' then error(key .. ' returned no widget', 0) end
  modules[key] = module
  local lines = {module.name or '?'}
  for _, option in ipairs(module.options or {}) do
    lines[#lines + 1] = string.format('%s\t%s\t%s', option[1], tostring(option[2]), tostring(option[3]))
  end
  return table.concat(lines, '\n')
end

function __preview_create(_, id, key, width, height, values)
  local module = modules[key]
  local zone = {x = 0, y = 0, w = int(width), h = int(height)}
  instances[id] = {module = module, state = module.create(zone, optionsFrom(values))}
end

function __preview_update(_, id, values)
  local instance = instances[id]
  if instance and instance.module.update then instance.module.update(instance.state, optionsFrom(values)) end
end

function __preview_refresh(_, id)
  local instance = instances[id]
  if instance then instance.module.refresh(instance.state, nil, nil) end
end

function __preview_drop(_, id)
  instances[id] = nil
end
`;

export type OptionType = 'value' | 'source' | 'bool' | 'string' | 'color';
const OPTION_TYPES: Record<string, OptionType> = {0: 'value', 1: 'source', 2: 'bool', 3: 'string', 5: 'color'};

export interface WidgetOption {
  name: string;
  type: OptionType;
  initial: number;
}

/**
 * The Lua side of the preview: widgets loaded once by key, and created as instances by id, one a zone, each refreshed
 * in its own zone.
 */
export interface WidgetRunner {
  /** Loads a widget's Lua: its name and its options. Throws the Lua error when it does not load. */
  load: (key: string, code: string) => {name: string; options: WidgetOption[]};
  create: (id: string, key: string, width: number, height: number, options: string) => void;
  update: (id: string, options: string) => void;
  refresh: (id: string) => void;
  drop: (id: string) => void;
}

/** Starts Fengari with the EdgeTX API around `radio`. Fengari is only fetched with the Radio tab. */
export async function startLua(radio: Radio): Promise<WidgetRunner> {
  const {load} = await import('fengari-web');
  (window as unknown as {edgetx: Radio}).edgetx = radio;
  load(PRELUDE, '=edgetx')();
  const call = (name: string) => load(`return ${name}`)() as (...args: unknown[]) => unknown;
  const [loadWidget, create, update, refresh, drop] = [
    '__preview_load',
    '__preview_create',
    '__preview_update',
    '__preview_refresh',
    '__preview_drop',
  ].map(call);
  return {
    load: (key, code) => {
      const [name, ...lines] = String(loadWidget(key, code)).split('\n');
      const options = lines.map(line => {
        const [optionName, type, initial] = line.split('\t');
        return {name: optionName, type: OPTION_TYPES[type] ?? 'value', initial: Number(initial) || 0};
      });
      return {name, options};
    },
    create: (id, key, width, height, options) => void create(id, key, width, height, options),
    update: (id, options) => void update(id, options),
    refresh: id => void refresh(id),
    drop: id => void drop(id),
  };
}
