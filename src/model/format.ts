/** How numbers, durations and days are written. Days are YYYY-MM-DD strings, read as local days. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const pad = (value: number) => String(value).padStart(2, '0');

export function toDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromDay(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

export const today = () => toDay(new Date());

/** Whole days from one day to another. */
export function daysBetween(from: string, to: string) {
  return Math.round((fromDay(to).getTime() - fromDay(from).getTime()) / 86_400_000);
}

export function addDays(day: string, count: number) {
  const date = fromDay(day);
  date.setDate(date.getDate() + count);
  return toDay(date);
}

/** "Sat 28 Apr 2023", or without the year when it is this year's. */
export function formatDay(day: string, {weekday = true, year}: {weekday?: boolean; year?: boolean} = {}) {
  const date = fromDay(day);
  const showYear = year ?? date.getFullYear() !== new Date().getFullYear();
  const text = `${date.getDate()} ${MONTHS[date.getMonth()]}${showYear ? ` ${date.getFullYear()}` : ''}`;
  return weekday ? `${DAYS[date.getDay()]} ${text}` : text;
}

/** "Apr 2023" for a YYYY-MM month. */
export function formatMonth(month: string, long = false) {
  const [year, index] = month.split('-').map(Number);
  return `${(long ? LONG_MONTHS : MONTHS)[index - 1]} ${year}`;
}

export const shortMonth = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];

/** "today", "yesterday", "3 days ago", "5 weeks ago", "2 years ago". */
export function ago(day: string, now = today()) {
  const days = daysBetween(day, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 61) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${Math.floor(days / 365.25)} years ago`;
}

/** Airtime: "18 min", "1 h 05", "32 h 08 min" when long. */
export function formatAirtime(seconds: number, long = false) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${pad(minutes % 60)}${long ? ' min' : ''}`;
}

/** Hours with one decimal, for charts: "1.5". */
export const hours = (seconds: number) => Math.round(seconds / 360) / 10;

/** A pack's flight time: "4:30". */
export function formatTimer(seconds: number | null | undefined) {
  if (seconds == null) return '?';
  return `${Math.floor(seconds / 60)}:${pad(Math.round(seconds % 60))}`;
}

/** "4:30", "4.5", "4" (minutes) or "270s" to seconds; null when it says nothing. */
export function parseTimer(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const clock = /^(\d{1,3}):(\d{1,2})$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const seconds = /^(\d+)\s*s$/.exec(value);
  if (seconds) return Number(seconds[1]);
  const minutes = Number(value.replace(',', '.'));
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null;
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function formatNumber(value: number, digits = 0) {
  return value.toLocaleString('en-GB', {minimumFractionDigits: digits, maximumFractionDigits: digits});
}

/** One decimal under ten, none above: "4.1", "12". */
export function formatRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '–';
  return formatNumber(value, value < 10 ? 1 : 0);
}
