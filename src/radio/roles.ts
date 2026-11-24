/**
 * What each switch does on the radio's helis, read by hand from their model files (mixes, logical switches, curves,
 * sounds): the card says which switches a model uses, not what for. Change it here when a model changes on the radio.
 */
export type Position = 'up' | 'middle' | 'down';

/** A position's effect: a few words, and the detail after them. */
export type Effect = [label: string, detail?: string];

/**
 * A switch's job, what each position does, and for the switches that let the motor run (Arm, Throttle hold) where it
 * sits while it does: a replay of a log that kept no switches puts it there while the pack draws current.
 */
export type SwitchRole = {
  job: string;
  running?: Position;
  /** Until when its positions meant the other way round: a log started before then reads its position flipped. */
  flippedBefore?: string;
} & Partial<Record<Position, Effect>>;

/**
 * The M2 EVO and the M4 share one set-up, all but their idle up throttles (flat curves for the ESC's governor, as % of
 * the throttle channel) and what S1 does to them, in words after each idle up's throttle.
 */
function heli(idleUps: [number, number, number], s1: [string, string, string]): Record<string, SwitchRole> {
  const disarmed: Effect = ['Disarmed', 'the motor stays off'];
  const normal: Effect = ['Off', 'full rates'];
  return {
    // Armed with SA up until arm_down.py moved it down, on 12 Nov 2026 at 16:20.
    SA: {
      job: 'Arm',
      up: disarmed,
      middle: disarmed,
      down: ['Armed', 'the motor runs once SF is up too'],
      running: 'down',
      flippedBefore: '2026-11-12T16:20:00',
    },
    SF: {
      job: 'Throttle hold',
      up: ['Throttle on', 'once SA is down too'],
      down: ['Hold', 'the motor stops'],
      running: 'up',
    },
    SE: {
      job: 'Idle up',
      up: ['Idle up 1', `throttle ${idleUps[0]}%${s1[0]}`],
      middle: ['Idle up 2', `throttle ${idleUps[1]}%${s1[1]}`],
      down: ['Idle up 3', `throttle ${idleUps[2]}%${s1[2]}`],
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

/**
 * The K110S (Futaba S-FHSS, its own WLtoys controller, no telemetry): SA arms down, SF holds, SC down is 6G
 * (self-level, else 3D), SE picks the mode as on the M2 EVO, its first Low RPM, and SH held is a rescue built
 * as the M2's: 6G, then a climb.
 */
const K110S: Record<string, SwitchRole> = {
  SA: {
    job: 'Arm',
    up: ['Disarmed', 'the motor stays off'],
    middle: ['Disarmed', 'the motor stays off'],
    down: ['Armed', 'the motor runs once SF is up too'],
    running: 'down',
  },
  SF: {
    job: 'Throttle hold',
    up: ['Throttle on', 'once SA is down too'],
    down: ['Hold', 'the motor stops'],
    running: 'up',
  },
  SE: {
    job: 'Idle up',
    up: ['Low RPM', 'throttle 55%, a soft pitch (-80% to +48%)'],
    middle: ['Idle up 2', 'throttle 70%, pitch ±70%'],
    down: ['Idle up 3', 'throttle 90%, pitch ±90%'],
  },
  SC: {
    job: 'Flight mode',
    up: ['3D', 'full rates, no levelling'],
    middle: ['3D', 'full rates, no levelling'],
    down: ['6G', 'holds itself level'],
  },
  SH: {
    job: 'Rescue, while held',
    up: ['Released'],
    down: ['Rescue', '6G, the pitch flat, then a climb at 40% after 0.1 s'],
  },
  SG: {
    job: 'Practice rates',
    up: ['Off', 'full rates'],
    middle: ['Off', 'full rates'],
    down: ['Practice', 'cyclic 70%, rudder 80%, a gentler pitch around hover in IU2 and IU3 (CPP); "low rates" said'],
  },
};

/** The M2 EVO's practice rates (practice_rates.py in edge-tx), for soft landings. */
const M2_PRACTICE: SwitchRole = {
  job: 'Practice rates',
  up: ['Off', 'full rates'],
  middle: ['Off', 'full rates'],
  down: ['Practice', 'cyclic 70%, rudder 80%, a gentler pitch around hover (CPP, -5° to +9°); "low rates" said'],
};

// S1 adds -20 to +20 % to the M2 EVO's idle ups (-10 to +10 in idle up 3): half that on the throttle's 0 to 100 %.
const ROLES: Record<string, Record<string, SwitchRole>> = {
  'M2 EVO': {...heli([54, 60, 75], [', S1 ±10', ', S1 ±10', ', S1 ±5']), SG: M2_PRACTICE},
  K110S,
  M4: heli([55, 65, 63], [', S1 takes it down to 40%', '', '']),
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
  L17: 'Pack in',
};
const HELI_CHANNELS: Record<number, string> = {
  1: 'Aileron',
  2: 'Elevator',
  3: 'Motor',
  4: 'Tail',
  5: 'Rescue and level',
  6: 'Pitch',
};
/** The K110S's logical switches and channels (Futaba's order: CH5 the flight mode, CH9 the Pack timer's throttle). */
const K110S_CONDITIONS: Record<string, string> = {
  L1: 'Low RPM',
  L2: 'IU 2',
  L3: 'IU 3',
  L4: 'Hold',
  L5: 'Disarmed',
  L6: '6G',
  L8: 'Logging',
  L9: 'Rescue',
  L10: 'Motor off',
};
const K110S_CHANNELS: Record<number, string> = {
  1: 'Aileron',
  2: 'Elevator',
  3: 'Motor',
  4: 'Tail',
  5: '6G or 3D',
  6: 'Pitch',
  9: 'Pack timer',
};
const NAMES: Record<string, {conditions: Record<string, string>; channels: Record<number, string>}> = {
  'M2 EVO': {conditions: HELI_CONDITIONS, channels: HELI_CHANNELS},
  K110S: {conditions: K110S_CONDITIONS, channels: K110S_CHANNELS},
  M4: {conditions: HELI_CONDITIONS, channels: HELI_CHANNELS},
};

/** A logical switch's name on a model (L10 is "Motor off"), if Flightdown knows it. */
export const conditionName = (model: string | undefined, id: string) =>
  model ? NAMES[model]?.conditions[id] : undefined;

/** A channel's name on a model (CH3 is "Motor"), from 1, if Flightdown knows it. */
export const channelName = (model: string | undefined, channel: number) =>
  model ? NAMES[model]?.channels[channel] : undefined;
