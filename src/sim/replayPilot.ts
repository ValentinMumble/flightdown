/**
 * Flying a logged pack, as the Sim page's "Watch it" does and `npm run replay` scores it: the log's sticks, its flips and
 * rolls made whole turns (the flip guide), the stand-in pilot adding the corrections the log cannot hold, and the log
 * alone for the seconds before a real crash, so the sim heli crashes about when the real one did (see standIn.ts).
 */
import type {TelemetrySeries} from '../types';
import type {Controls, HeliParams, HeliState} from './physics';
import type {Mapping} from './input';
import {loggedControls} from './replay';
import {
  FlipGuide,
  LET_CRASH,
  motorCuts,
  STAND_IN,
  standIn,
  stickManoeuvres,
  untilCut,
  untilManoeuvre,
  type Manoeuvre,
} from './standIn';

/** What a replay finds in its log before it starts: its flips and rolls, and its motor cuts (its landings). */
export function readReplay(series: TelemetrySeries, mapping: Mapping, params: Pick<HeliParams, 'cyclicRate'>) {
  const controlsAt = (second: number) => loggedControls(series, second, mapping);
  return {
    stretches: stickManoeuvres(series, controlsAt, params),
    cuts: motorCuts(series, second => controlsAt(second).throttle),
  };
}

export interface ReplayPlan {
  series: TelemetrySeries;
  stretches: Manoeuvre[];
  cuts: number[];
  /** Its real crashes, s of its log. */
  crashes: number[];
}

/** The pilot of one replay, from its start: call `controls` once per physics step, in order. */
export class ReplayPilot {
  private readonly plan: ReplayPlan;
  private readonly params: HeliParams;
  private readonly guide: FlipGuide;

  constructor(plan: ReplayPlan, params: HeliParams) {
    this.plan = plan;
    this.params = params;
    this.guide = new FlipGuide(params);
  }

  /** The controls for the physics step at this second of the log, the heli as it is now. */
  controls(second: number, state: HeliState, dt: number, mapping: Mapping): Controls {
    const {series, stretches, cuts, crashes} = this.plan;
    const logged = loggedControls(series, second, mapping);
    const steered = this.guide.steer(logged, state, second, dt, stretches);
    if (crashes.some(crash => second >= crash - LET_CRASH && second <= crash + 1)) return logged;
    return standIn(
      steered.controls,
      state,
      this.params,
      steered.manoeuvre,
      STAND_IN,
      untilCut(cuts, second),
      untilManoeuvre(stretches, second),
    );
  }
}
