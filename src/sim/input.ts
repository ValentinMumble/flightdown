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

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** The sticks from a gamepad's axes. */
export function readAxes(axes: readonly number[], mapping: Mapping): Controls {
  const value = (stick: Stick) => {
    const {axis, reverse} = mapping[stick];
    const raw = clamp(axes[axis] ?? 0);
    return reverse ? -raw : raw;
  };
  const throttle = (value('throttle') + 1) / 2;
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
 * left), 1, 2 and 3 the idle ups, Space throttle hold. Springs back to centre like sticks.
 */
export class KeyboardSticks {
  private down = new Set<string>();
  private collective = -0.2;
  private idleUp = 1;
  private hold = true;

  /** Gives the key to the sticks; true when it is theirs (the page should not scroll for it). */
  press(key: string): boolean {
    const known = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 's', 'a', 'd', ' ', '1', '2', '3'];
    const name = key.length === 1 ? key.toLowerCase() : key;
    if (!known.includes(name)) return false;
    if (name === ' ') this.hold = !this.hold;
    else if (['1', '2', '3'].includes(name)) this.idleUp = Number(name) - 1;
    else this.down.add(name);
    return true;
  }

  release(key: string) {
    this.down.delete(key.length === 1 ? key.toLowerCase() : key);
  }

  /** The sticks now, after `dt` seconds of the collective keys held. */
  read(dt: number): Controls {
    const axis = (plus: string, minus: string) => Number(this.down.has(plus)) - Number(this.down.has(minus));
    this.collective = clamp(this.collective + axis('w', 's') * 0.8 * dt);
    // The keys give full rate at once: a third of it is plenty.
    return {
      roll: axis('ArrowRight', 'ArrowLeft') * 0.35,
      pitch: axis('ArrowUp', 'ArrowDown') * 0.35,
      yaw: axis('d', 'a') * 0.4,
      collective: this.collective,
      throttle: this.hold ? 0 : KEY_IDLE_UPS[this.idleUp],
    };
  }
}

/** The gamepads connected with axes enough to fly with. */
export function connectedPads(): Gamepad[] {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].filter((pad): pad is Gamepad => !!pad && pad.connected && pad.axes.length >= 4);
}

/** A game controller (an Xbox pad) rather than a radio: the browser knows its layout. */
export const isGameController = (pad: Pick<Gamepad, 'mapping'>) => pad.mapping === 'standard';

/** The standard layout's buttons. */
const BUTTON = {a: 0, y: 3};
/** Game controller sticks rest a little off centre. */
const DEADZONE = 0.08;

const dead = (value: number) =>
  Math.abs(value) < DEADZONE ? 0 : Math.sign(value) * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE));

/**
 * A game controller as a radio in mode 2: the left stick the collective (up and down) and the rudder, the right stick
 * the cyclic. Its sticks spring back to centre, so the collective's centre is the hover pitch (`hover`, -1 to 1). A
 * starts and stops the motor (throttle hold), Y steps through the idle ups.
 */
export class GameControllerSticks {
  private idleUp = 1;
  private hold = true;
  private pressed = new Set<number>();

  /** The idle up (1 to 3) and whether the motor is held, for the screen. */
  get status() {
    return {idleUp: this.idleUp + 1, hold: this.hold};
  }

  read(pad: Pick<Gamepad, 'axes' | 'buttons'>, hover: number): Controls {
    const tapped = (button: number) => {
      const down = !!pad.buttons[button]?.pressed;
      const fresh = down && !this.pressed.has(button);
      if (down) this.pressed.add(button);
      else this.pressed.delete(button);
      return fresh;
    };
    if (tapped(BUTTON.a)) this.hold = !this.hold;
    if (tapped(BUTTON.y)) this.idleUp = (this.idleUp + 1) % KEY_IDLE_UPS.length;
    const lift = -dead(pad.axes[1] ?? 0);
    // Short game controller sticks: half expo, so the centre is gentle and the ends still give full rate.
    const expo = (value: number) => value * (0.5 + 0.5 * value * value);
    return {
      roll: expo(dead(pad.axes[2] ?? 0)),
      pitch: expo(-dead(pad.axes[3] ?? 0)),
      yaw: expo(dead(pad.axes[0] ?? 0)),
      collective: lift >= 0 ? hover + lift * (1 - hover) : hover + lift * (1 + hover),
      throttle: this.hold ? 0 : KEY_IDLE_UPS[this.idleUp],
    };
  }
}
