/** RGBA pixels, as a canvas gives them. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The darkest channel of a pixel on the paper: white, or the faint shadow a product casts on it. */
const PAPER = 226;
/** How far apart the channels may be: paper has no colour. */
const NEUTRAL = 18;
/** Below this share of paper, the photo is not a product shot on white: it is left as it is. */
const MIN_PAPER = 0.05;

/**
 * Cuts a product shot out of its white background, in place: the paper reached from the borders turns transparent
 * (its faint shadows into a faint dark shadow), and the light rim where the object meets the paper loses its white.
 * White parts inside the object are kept: only paper joined to the borders goes. A white part touching the paper with
 * no edge between them goes with it, so the owner's photos are lifted on the Mac instead (`npm run cutouts`): this is
 * for the others. Returns the box around what is left, or null when the photo is not on white.
 */
export function cutOut({width, height, data}: Pixels): Box | null {
  const count = width * height;
  const paper = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  const isPaper = (pixel: number) => {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const lowest = Math.min(red, green, blue);
    return data[offset + 3] > 0 && lowest >= PAPER && Math.max(red, green, blue) - lowest <= NEUTRAL;
  };
  const visit = (pixel: number) => {
    if (paper[pixel] || !isPaper(pixel)) return;
    paper[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let column = 0; column < width; column += 1) {
    visit(column);
    visit((height - 1) * width + column);
  }
  for (let row = 0; row < height; row += 1) {
    visit(row * width);
    visit(row * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head++];
    const column = pixel % width;
    if (column > 0) visit(pixel - 1);
    if (column < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < count - width) visit(pixel + width);
  }
  if (tail < count * MIN_PAPER) return null;

  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4;
    if (paper[pixel]) {
      // A grey on white is black seen through: as dark as the paper is, as see-through as it is light.
      const light = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = Math.round(255 - light);
      continue;
    }
    const column = pixel % width;
    const onRim =
      (column > 0 && paper[pixel - 1]) ||
      (column < width - 1 && paper[pixel + 1]) ||
      (pixel >= width && paper[pixel - width]) ||
      (pixel < count - width && paper[pixel + width]);
    if (!onRim) continue;
    // The rim blends the object with the paper: the lighter it is, the more of it was paper.
    const lowest = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const white = Math.max(0, Math.min(0.9, (lowest - 150) / 105));
    if (white <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = Math.max(0, Math.round((data[offset + channel] - 255 * white) / (1 - white)));
    }
    data[offset + 3] = Math.round(data[offset + 3] * (1 - white));
  }

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (data[(row * width + column) * 4 + 3] <= 40) continue;
      if (column < left) left = column;
      if (column > right) right = column;
      if (row < top) top = row;
      if (row > bottom) bottom = row;
    }
  }
  if (right < 0) return null;
  return {left, top, width: right - left + 1, height: bottom - top + 1};
}
