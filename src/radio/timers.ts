/**
 * A model's timers, run as the radio runs them: each counts while its switch is on, and the special functions that
 * reset it do. Its switches can be logical switches, so these run too, enough of them for a timer: a > x, a < x, a = x
 * on a switch, stick or sensor, AND, OR and XOR of two switches, an AND switch, and a delay before turning on.
 */

/** A logical switch as the model file writes it: FUNC_VPOS with "tele(4),30" is Curr above 3.0 A. */
export interface LogicalSwitch {
  func: string;
  def: string;
  andsw: string;
  /** Tenths of a second its condition must hold before it turns on. */
  delay: number;
}

export interface ModelTimer {
  /** Seconds it counts down from, 0 for one that counts up. */
  start: number;
  /** The switch that runs it: "L17", "!L10", "NONE" for always. */
  swtch: string;
  /** OFF for a timer the model does not use. */
  mode: string;
}

/** What a model's timers need of it: its timers, logical switches, resets and telemetry sensors. */
export interface TimedModel {
  timers?: ModelTimer[];
  /** By index: L1 is 0. */
  logicalSwitches?: Record<number, LogicalSwitch>;
  /** The special functions that reset a timer: their switch, and the timer (0 for Tmr1). */
  timerResets?: {swtch: string; timer: number}[];
  /** Telemetry sensor names and precisions by index: "tele(4),30" on Curr (precision 1) is 3.0 A. */
  sensors: string[];
  precisions?: number[];
}

/** Reads a source as the radio does: switches and sticks from -1024 to 1024, sensors in their own units. */
export type Read = (source: string) => number;

/** How far apart the steps of a replay are, in seconds: fine enough for a one-second delay. */
const STEPS_A_SECOND = 10;
const STEP = 1 / STEPS_A_SECOND;

export class ModelTimers {
  private elapsed: number[];
  private clock: number | null = null;
  /** Where its clock starts: 0 for a replay, so a replay taken back counts again from its start. */
  private origin: number | null;
  /** When each delayed logical switch's condition started to hold, by index. */
  private since = new Map<number, number>();
  /** Each logical switch as the last step left it, and what that step read: for isOn. */
  private states = new Map<number, boolean>();
  private lastRead: Read | null = null;

  private model: TimedModel;

  constructor(model: TimedModel, origin: number | null = null) {
    this.model = model;
    this.origin = origin;
    this.elapsed = (model.timers ?? []).map(() => 0);
  }

  /** Back to the start: every timer at 0, no time counted yet. */
  reset() {
    this.elapsed = this.elapsed.map(() => 0);
    this.clock = null;
    this.since.clear();
    this.states.clear();
    this.lastRead = null;
  }

  /**
   * Moves on to `clock` (seconds), reading the sources at each moment with `readAt`: in steps of a tenth of a second
   * from where it was, so a replay that jumps ahead counts what happened in between. A clock that went back counts
   * again from its start.
   */
  advance(clock: number, readAt: (second: number) => Read) {
    if (this.clock !== null && clock < this.clock) this.reset();
    if (this.clock === null) {
      const from = Math.min(this.origin ?? clock, clock);
      this.step(from, 0, readAt(from));
    }
    if (this.clock === null) return;
    // On whole tenths of a second (699 / 10, not 0.1 added up 699 times), so a step falls on the second it should.
    while (clock - this.clock > STEP) {
      const next = (Math.floor(this.clock * STEPS_A_SECOND + 1e-6) + 1) / STEPS_A_SECOND;
      this.step(next, next - this.clock, readAt(next));
    }
    if (clock > this.clock) this.step(clock, clock - this.clock, readAt(clock));
    // Not moved on (a replay paused): read again, so a switch set by hand reaches the logical switches at once.
    else if (clock === this.clock) this.step(clock, 0, readAt(clock));
  }

  /** A timer's value as the radio gives it to Lua: the time left when it counts down (below 0 past it), else run. */
  value(index: number) {
    const timer = this.model.timers?.[index];
    if (!timer) return 0;
    // Tenths of a second added up drift a hair under the whole second (28.9999…): not a second less.
    const run = Math.floor((this.elapsed[index] ?? 0) + 1e-6);
    return timer.start ? timer.start - run : run;
  }

  start(index: number) {
    return this.model.timers?.[index]?.start ?? 0;
  }

  /** A switch as the radio has it at the last step ("L10", "!SA0", "6P10"): the Logic view lights what is on. */
  isOn(name: string) {
    if (this.clock === null || !this.lastRead) return false;
    // The logical switches as the step left them: asking does not move their delays on.
    return this.switchAt(name, this.clock, this.lastRead, new Map(this.states));
  }

  private step(clock: number, seconds: number, read: Read) {
    this.clock = clock;
    const known = new Map<number, boolean>();
    const on = (name: string) => this.switchAt(name, clock, read, known);
    for (const reset of this.model.timerResets ?? []) {
      if (on(reset.swtch) && reset.timer < this.elapsed.length) this.elapsed[reset.timer] = 0;
    }
    (this.model.timers ?? []).forEach((timer, index) => {
      if (timer.mode !== 'OFF' && (timer.swtch === 'NONE' || on(timer.swtch))) this.elapsed[index] += seconds;
    });
    // Every logical switch, so each one's delay runs whether a timer reads it or not.
    for (const index of Object.keys(this.model.logicalSwitches ?? {})) this.logical(Number(index), clock, read, known);
    this.states = known;
    this.lastRead = read;
  }

  /** Whether telemetry comes in: any of the model's sensors reads something. */
  private streaming(read: Read) {
    return this.model.sensors.some((name, index) => name && read(`tele(${index})`) !== 0);
  }

  /** A switch as a timer or a logical switch names it: "!L10", "SA0" (SA up), "TELEMETRY_STREAMING", "ON". */
  private switchAt(name: string, clock: number, read: Read, known: Map<number, boolean>): boolean {
    if (name.startsWith('!')) return !this.switchAt(name.slice(1), clock, read, known);
    if (name === 'ON') return true;
    if (name === 'TELEMETRY_STREAMING') return this.streaming(read);
    const logical = /^L(\d+)$/.exec(name);
    if (logical) return this.logical(Number(logical[1]) - 1, clock, read, known);
    const position = /^S([A-H])([0-2])$/.exec(name);
    if (position) {
      const value = read(`S${position[1]}`);
      return (value <= -512 ? 0 : value >= 512 ? 2 : 1) === Number(position[2]);
    }
    // A 6-position button: 6P10 is button 1, read from -1024 to 1024 in six steps.
    const button = /^6P\d(\d)$/.exec(name);
    if (button) return Math.round((read('6P') + 1024) / 409.6) === Number(button[1]);
    return false;
  }

  private logical(index: number, clock: number, read: Read, known: Map<number, boolean>): boolean {
    const cached = known.get(index);
    if (cached !== undefined) return cached;
    // A switch that names itself, directly or not, is off rather than endless.
    known.set(index, false);
    const definition = this.model.logicalSwitches?.[index];
    let holds = definition ? this.condition(definition, clock, read, known) : false;
    if (holds && definition?.andsw && definition.andsw !== 'NONE')
      holds = this.switchAt(definition.andsw, clock, read, known);
    // A delay: on only once the condition has held that long.
    if (!holds) this.since.delete(index);
    else if (!this.since.has(index)) this.since.set(index, clock);
    const result = holds && clock - (this.since.get(index) ?? clock) >= (definition?.delay ?? 0) / 10 - 1e-9;
    known.set(index, result);
    return result;
  }

  private condition(definition: LogicalSwitch, clock: number, read: Read, known: Map<number, boolean>) {
    const [first, second] = definition.def.split(',');
    const on = (name: string) => this.switchAt(name, clock, read, known);
    switch (definition.func) {
      case 'FUNC_AND':
        return on(first) && on(second);
      case 'FUNC_OR':
        return on(first) || on(second);
      case 'FUNC_XOR':
        return on(first) !== on(second);
    }
    const telemetry = /^tele\((\d+)\)$/.exec(first);
    // A sensor compares only while telemetry comes in, in its own steps (Curr, precision 1, in tenths of an amp).
    if (telemetry && !this.streaming(read)) return false;
    const value = telemetry
      ? read(first) * 10 ** (this.model.precisions?.[Number(telemetry[1])] ?? 0)
      : (read(first) * 100) / 1024;
    const against = Number(second);
    switch (definition.func) {
      case 'FUNC_VPOS':
        return value > against;
      case 'FUNC_VNEG':
        return value < against;
      case 'FUNC_VEQUAL':
        return Math.round(value) === against;
    }
    return false;
  }
}
