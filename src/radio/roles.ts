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
