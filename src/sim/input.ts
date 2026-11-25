/**
 * The sticks for the simulator, read through the browser's Gamepad API: the TX16S plugged in as a USB joystick
 * (EdgeTX's Classic mode sends the model's first eight channels as axes, -1 to 1), a game controller (an Xbox pad), or
 * else the keyboard. Flying the real model (the M2 EVO's, say) sends its outputs, so its rates, expo, curves, idle ups
 * and holds come through as on the field: CH1 aileron, CH2 elevator, CH3 the motor, CH4 rudder, CH6 pitch.
 */
import type {Controls} from './physics';

export type Stick = 'roll' | 'pitch' | 'yaw' | 'collective' | 'throttle';

export interface AxisMap {
  axis: number;
  reverse: boolean;
}

export type Mapping = Record<Stick, AxisMap>;

/** EdgeTX's Classic joystick: channel n on axis n - 1. The M2 EVO's channels, none reversed. */
export const DEFAULT_MAPPING: Mapping = {
  roll: {axis: 0, reverse: false},
  pitch: {axis: 1, reverse: false},
  throttle: {axis: 2, reverse: false},
  yaw: {axis: 3, reverse: false},
  collective: {axis: 5, reverse: false},
};

/** Under this share of its travel the throttle channel is the motor off: throttle cut or hold. */
const MOTOR_OFF = 0.05;
/**
 * Past this, at either end of its travel, the throttle channel is cut (disarmed or held), whichever way the model
 * reverses it: no idle up sits there (the M2 EVO's run 34 to 95 %, the K110S's 55 to 95 %), so a heli picked here that
 * is not the radio's model still stops when it is cut.
 */
const CUT = 0.98;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** The sticks from a gamepad's axes. */
export function readAxes(axes: readonly number[], mapping: Mapping): Controls {
  const value = (stick: Stick) => {
    const {axis, reverse} = mapping[stick];
    const raw = clamp(axes[axis] ?? 0);
    return reverse ? -raw : raw;
  };
  const cut = Math.abs(clamp(axes[mapping.throttle.axis] ?? 0)) >= CUT;
  const throttle = cut ? 0 : (value('throttle') + 1) / 2;
  return {
    roll: value('roll'),
    pitch: value('pitch'),
    yaw: value('yaw'),
    collective: value('collective'),
    throttle: throttle < MOTOR_OFF ? 0 : throttle,
  };
}

/** The steps that set the mapping up, each a move of one stick or switch, read from the axis that moves most. */
export const SETUP_STEPS: {stick: Stick; ask: string}[] = [
  {stick: 'roll', ask: 'Push the right stick to the right, and hold it'},
  {stick: 'pitch', ask: 'Push the right stick forward, and hold it'},
  {stick: 'yaw', ask: 'Push the left stick to the right, and hold it'},
  {stick: 'collective', ask: 'Push the left stick all the way up, and hold it'},
  {stick: 'throttle', ask: 'Arm and take the throttle out of hold, in an idle up (SA down, SF up)'},
];

/** Further than this from where it started, an axis has moved. */
const MOVED = 0.4;

/**
 * The axis that moved the most since `start` (each channel's value then), and whether it went down rather than up;
 * null while none moved far enough. Axes already claimed by earlier steps are left out.
 */
export function movedAxis(start: readonly number[], now: readonly number[], taken: number[] = []): AxisMap | null {
  let best: AxisMap | null = null;
  let most = MOVED;
  now.forEach((value, axis) => {
    if (taken.includes(axis)) return;
    const change = value - (start[axis] ?? 0);
    if (Math.abs(change) > most) {
      most = Math.abs(change);
      best = {axis, reverse: change < 0};
    }
  });
  return best;
}

/** Idle-up throttles for the keyboard (1, 2, 3), as the M2 EVO's: 54, 60 and 75 %. */
const KEY_IDLE_UPS = [0.54, 0.6, 0.75];

/**
 * The keyboard as sticks: the arrows the cyclic, A and D the rudder, W and S move the collective (it stays where it is
 * left), 1, 2 and 3 the idle ups, X arms and disarms (it starts disarmed), Space throttle hold, Q cuts the motor, E
 * the rescue while held, L self-level on and off, P steps through the rates. Springs back to centre like sticks.
 */
export class KeyboardSticks {
  private down = new Set<string>();
  private collective = -0.2;
  private idleUp = 1;
  private hold = true;
  private level = false;
  private rates = 0;

  private armed = false;

  /** The idle up (1 to 3), whether the motor is held, and whether it is armed. */
  get status() {
    return {idleUp: this.idleUp + 1, hold: this.hold, armed: this.armed};
  }

  /** Gives the key to the sticks; true when it is theirs (the page should not scroll for it). */
  press(key: string): boolean {
    const known = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'w',
      's',
      'a',
      'd',
      'e',
      'q',
      'l',
      'p',
      'x',
      ' ',
      '1',
      '2',
      '3',
    ];
    const name = key.length === 1 ? key.toLowerCase() : key;
    if (!known.includes(name)) return false;
    if (name === ' ') this.hold = !this.hold;
    else if (name === 'q') this.hold = true;
    else if (name === 'l') this.level = !this.level;
    else if (name === 'x') this.armed = !this.armed;
    else if (name === 'p') this.rates = (this.rates + 1) % RATES.length;
    else if (['1', '2', '3'].includes(name)) this.idleUp = Number(name) - 1;
    else this.down.add(name);
    return true;
  }

  release(key: string) {
    this.down.delete(key.length === 1 ? key.toLowerCase() : key);
  }

  /** The sticks now, after `dt` seconds of the collective keys held; `raw` leaves the rates to the model's mixer. */
  read(dt: number, raw = false): Controls {
    const axis = (plus: string, minus: string) => Number(this.down.has(plus)) - Number(this.down.has(minus));
    this.collective = clamp(this.collective + axis('w', 's') * 0.8 * dt);
    // The keys give full rate at once: a third of it is plenty for the cyclic; the rudder gets all of it (the tail's
    // 280°/s at full stick, from the replays), as 40 % turned far too slowly.
    const {cyclic, rudder} = raw ? RATES[0] : RATES[this.rates];
    return {
      roll: axis('ArrowRight', 'ArrowLeft') * 0.35 * cyclic,
      pitch: axis('ArrowUp', 'ArrowDown') * 0.35 * cyclic,
      yaw: axis('d', 'a') * rudder,
      collective: this.collective,
      throttle: this.hold || !this.armed ? 0 : KEY_IDLE_UPS[this.idleUp],
      rescue: this.down.has('e'),
      level: this.level,
      rates: RATES[this.rates].label,
      armed: this.armed,
      throttleOn: !this.hold,
    };
  }
}

/** The gamepads connected with axes enough to fly with. */
export function connectedPads(): Gamepad[] {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].filter((pad): pad is Gamepad => !!pad && pad.connected && pad.axes.length >= 4);
}

/**
 * SA and SF as the radio sends them, when the model puts them on CH10 and CH11 (sim_switches.py in edge-tx): EdgeTX's
 * Classic joystick sends CH9 to CH32 as buttons, pressed above 0, so CH10 is button 1 and CH11 button 2. Null for a
 * model that does not.
 */
export function radioSwitches(
  model: {mixes?: {channel: number; name: string}[]} | null | undefined,
  pad: Pick<Gamepad, 'buttons'>,
): {armed: boolean; throttleOn: boolean} | null {
  const sends = (channel: number, name: string) =>
    !!model?.mixes?.some(mix => mix.channel === channel && mix.name === name);
  if (!sends(9, 'SA arm') || !sends(10, 'SF on') || pad.buttons.length < 3) return null;
  return {armed: !!pad.buttons[1]?.pressed, throttleOn: !!pad.buttons[2]?.pressed};
}

/** A game controller (an Xbox pad) rather than a radio: the browser knows its layout. */
export const isGameController = (pad: Pick<Gamepad, 'mapping'>) => pad.mapping === 'standard';

/** The standard layout's buttons, the triggers among them (pressed past half way). */
const BUTTON = {y: 3, leftBumper: 4, rightBumper: 5, leftTrigger: 6, rightTrigger: 7, up: 12};

/**
 * Rates to pick from on a game controller or the keyboard, as SG picks them on the radio: full, or the practice rates
 * (practice_rates.py in edge-tx), named by the cyclic's share. With the model's mixer the model applies them; without
 * it, these shares do.
 */
export const RATES = [
  {label: '100 %', cyclic: 1, rudder: 1},
  {label: '55 %', cyclic: 0.55, rudder: 0.65},
];

/** Rates lower than full: the radio's PRACTICE light. */
export const isLowered = (rates: string | undefined) => !!rates && rates !== RATES[0].label;
/** Game controller sticks rest a little off centre. */
const DEADZONE = 0.08;

const dead = (value: number) =>
  Math.abs(value) < DEADZONE ? 0 : Math.sign(value) * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE));

/**
 * A game controller as a radio in mode 2: the left stick the collective (up and down) and the rudder, the right stick
 * the cyclic. Its sticks spring back to centre, so the collective's centre is the hover pitch (`hover`, -1 to 1). Each
 * pull of the left trigger turns the motor on or off (throttle hold, as SF), the right trigger is the rescue while
 * held (as SH), the left bumper steps through the idle ups, the right one through the rates (as SG), Y turns
 * self-level on and off (as SC), the D-pad's up arrow arms and disarms it (as SA): it starts disarmed, and the motor
 * runs only armed and out of hold, as on the M2 EVO.
 */
export class GameControllerSticks {
  private idleUp = 1;
  private hold = true;
  private armed = false;
  private level = false;
  private rates = 0;
  private pressed = new Set<number>();

  /** The idle up (1 to 3), whether the motor is held, and whether it is armed. */
  get status() {
    return {idleUp: this.idleUp + 1, hold: this.hold, armed: this.armed};
  }

  /**
   * The sticks and switches now. `hover` is the collective stick's centre (-1 to 1). With `raw`, the sticks as a radio's
   * (the model's mixer applies the rates and curves); without, shaped and rated here.
   */
  read(pad: Pick<Gamepad, 'axes' | 'buttons'>, hover: number, raw = false): Controls {
    const held = (button: number) => (pad.buttons[button]?.value ?? 0) > 0.5 || !!pad.buttons[button]?.pressed;
    const tapped = (button: number) => {
      const down = held(button);
      const fresh = down && !this.pressed.has(button);
      if (down) this.pressed.add(button);
      else this.pressed.delete(button);
      return fresh;
    };
    if (tapped(BUTTON.leftTrigger)) this.hold = !this.hold;
    if (tapped(BUTTON.up)) this.armed = !this.armed;
    if (tapped(BUTTON.leftBumper)) this.idleUp = (this.idleUp + 1) % KEY_IDLE_UPS.length;
    if (tapped(BUTTON.y)) this.level = !this.level;
    if (tapped(BUTTON.rightBumper)) this.rates = (this.rates + 1) % RATES.length;
    const {cyclic, rudder} = raw ? RATES[0] : RATES[this.rates];
    // Short game controller sticks, shaped: the cyclic with a light expo (full rate at the ends); the rudder softer
    // round the centre, full rate at the ends; the collective
    // very soft round hover pitch, so a nudge does not shoot the heli up, yet reaching the full pitch at the ends, so
    // it climbs upside down too.
    const expo = (value: number, amount: number) => value * (1 - amount + amount * value * value);
    const lift = expo(-dead(pad.axes[1] ?? 0), 0.8);
    return {
      roll: cyclic * expo(dead(pad.axes[2] ?? 0), 0.25),
      pitch: cyclic * expo(-dead(pad.axes[3] ?? 0), 0.25),
      yaw: raw ? expo(dead(pad.axes[0] ?? 0), 0.3) : rudder * expo(dead(pad.axes[0] ?? 0), 0.6),
      collective: lift >= 0 ? hover + lift * (1 - hover) : hover + lift * (1 + hover),
      throttle: this.hold || !this.armed ? 0 : KEY_IDLE_UPS[this.idleUp],
      rescue: held(BUTTON.rightTrigger),
      level: this.level,
      rates: RATES[this.rates].label,
      armed: this.armed,
      throttleOn: !this.hold,
    };
  }
}
