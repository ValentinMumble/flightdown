/**
 * What each switch does on the radio's helis, read by hand from their model files (mixes, logical switches, curves,
 * sounds): the card says which switches a model uses, not what for. Change it here when a model changes on the radio.
 */
export type Position = 'up' | 'middle' | 'down';

/** A position's effect: a few words, and the detail after them. */
export type Effect = [label: string, detail?: string];

export type SwitchRole = {job: string} & Partial<Record<Position, Effect>>;

/**
 * The M2 EVO and the M4 share one set-up, all but their idle up throttles (flat curves for the ESC's governor, as % of
 * the throttle channel). S1 takes 0 to 30% off idle up 1 ("Lower" mix), all the way left taking nothing off.
 */
function heli(idleUps: [number, number, number]): Record<string, SwitchRole> {
  const disarmed: Effect = ['Disarmed', 'the motor stays off'];
  const normal: Effect = ['Off', 'full rates'];
  return {
    SA: {job: 'Arm', up: ['Armed', 'the motor runs once SF is up too'], middle: disarmed, down: disarmed},
    SF: {job: 'Throttle hold', up: ['Throttle on', 'once SA is up too'], down: ['Hold', 'the motor stops']},
    SE: {
      job: 'Idle up',
      up: ['Idle up 1', `throttle ${idleUps[0]}%, S1 takes it down to ${idleUps[0] - 15}%`],
      middle: ['Idle up 2', `throttle ${idleUps[1]}%`],
      down: ['Idle up 3', `throttle ${idleUps[2]}%`],
    },
    SC: {
      job: 'Self-level',
      up: normal,
      middle: normal,
      down: ['On', 'holds itself level, rates at 70%, no negative pitch'],
    },
    SH: {
      job: 'Rescue, while held',
      up: ['Released'],
      down: ['Rescue', 'levels and climbs: pitch 85%, 60% or 50% by idle up'],
    },
  };
}

const ROLES: Record<string, Record<string, SwitchRole>> = {
  'M2 EVO': heli([54, 58, 75]),
  M4: heli([55, 65, 63]),
};

/** A switch's role on a model, if Flightdown knows that model. */
export const switchRole = (model: string | undefined, name: string): SwitchRole | undefined =>
  model ? ROLES[model]?.[name] : undefined;

/**
 * The helis' logical switches and channels in a word or two, for the Logic view: the model file only says "L10 = L4 or
 * L5" and "CH3". Both helis number them the same.
 */
const HELI_CONDITIONS: Record<string, string> = {
  L1: 'IU 1',
  L2: 'IU 2',
  L3: 'IU 3',
  L4: 'Hold',
  L5: 'Disarmed',
  L6: 'Rescue',
  L7: 'Self-level',
  L10: 'Motor off',
  L11: 'Rescue in IU 1',
  L12: 'Rescue in IU 2',
  L13: 'Rescue in IU 3',
  L14: 'Held and disarmed',
  L15: 'Low pack',
  L16: 'Pack unplugged',
};
const HELI_CHANNELS: Record<number, string> = {
  1: 'Aileron',
  2: 'Elevator',
  3: 'Motor',
  4: 'Tail',
  5: 'Rescue and level',
  6: 'Pitch',
};
const NAMES: Record<string, {conditions: Record<string, string>; channels: Record<number, string>}> = {
  'M2 EVO': {conditions: HELI_CONDITIONS, channels: HELI_CHANNELS},
  M4: {conditions: HELI_CONDITIONS, channels: HELI_CHANNELS},
};

/** A logical switch's name on a model (L10 is "Motor off"), if Flightdown knows it. */
export const conditionName = (model: string | undefined, id: string) =>
  model ? NAMES[model]?.conditions[id] : undefined;

/** A channel's name on a model (CH3 is "Motor"), from 1, if Flightdown knows it. */
export const channelName = (model: string | undefined, channel: number) =>
  model ? NAMES[model]?.channels[channel] : undefined;
