/**
 * The chart colours. Eight hues in a fixed order, checked for colour-blind readers on the app's cards (white and
 * #1c1c1e): each heli keeps its slot in every chart. Dark mode uses the same hues stepped for the dark card. White
 * comes ninth, for a white heli: no hue, the lightest mark on the dark panel.
 */
export const SERIES_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
  '#8f969f',
];
export const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
  '#e8eef5',
];
export const SERIES_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Pink', 'Green', 'Violet', 'Red', 'White'];

/** The text colour that reads on a fill: near-black on a light one (the white heli), white on the rest. */
export function inkOn(fill: string) {
  const channels = [1, 3, 5].map(start => parseInt(fill.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map(value =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.4 ? '#0b0f14' : '#ffffff';
}

/** Helis past the first few in a chart fold into this. */
export const OTHER_LIGHT = '#a6a59f';
export const OTHER_DARK = '#5f5e5a';

/** One-hue ramp for amounts (the calendar): near nothing to most. */
export const RAMP_LIGHT = ['#ebeae6', '#b7d3f6', '#6da7ec', '#2a78d6', '#184f95'];
export const RAMP_DARK = ['#2a2a2c', '#184f95', '#256abf', '#3987e5', '#86b6ef'];

/** Palette slot hinted by a colour emoji in a heli's name ("M2 EVO 🟠"). */
export const EMOJI_SLOTS: Record<string, number> = {
  '🔵': 0,
  '🟦': 0,
  '🟠': 1,
  '🟧': 1,
  '🟡': 3,
  '🟨': 3,
  '🩷': 4,
  '🟢': 5,
  '🟩': 5,
  '🟣': 6,
  '🟪': 6,
  '🔴': 7,
  '🟥': 7,
  '⚪': 8,
  '🤍': 8,
  '⬜': 8,
};
