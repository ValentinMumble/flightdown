/**
 * A model's logic in words, as the Radio tab's Logic view shows it: the controls you touch, the conditions they make
 * (logical switches), and what comes of them (each channel's mix lines, the special functions, the timers), with the
 * radio's own global functions beside them. Each item says what it reads, so the view can light a path through it.
 */
import type {CardFunction, CardMix, CardModel, CardRadio, CurveRef} from './card';
import type {LogicalSwitch} from './timers';
import {channelName, conditionName, switchRole} from './roles';

export interface LogicItem {
  /** "SA", "sticks", "L10", "CH3", "F5" (a special function), "G1" (a global one), "T1" (a timer). */
  id: string;
  title: string;
  detail: string;
  /** The ids it reads: controls and conditions. */
  uses: string[];
  /** The switch that runs it, as the radio names it ("L10", "SA0", "ON"): on while that is. */
  when?: string;
  /** The radio's own, for every model. */
  radioWide?: boolean;
  /** Nothing reads it. */
  unused?: boolean;
  /** Set up but switched off. */
  off?: boolean;
}

/** A mix line: what it takes ("Thr, curve FM3"), how (+ added, = replaces, × multiplies), on which switch. */
export interface LogicLine {
  text: string;
  how: '+' | '=' | '×';
  when: string;
  /** The switch in words: "L3 IU 3", or empty for always. */
  label: string;
}

export interface LogicChannel extends LogicItem {
  /** From 1. */
  channel: number;
  lines: LogicLine[];
}

export interface ModelLogicView {
  controls: LogicItem[];
  conditions: LogicItem[];
  channels: LogicChannel[];
  actions: LogicItem[];
}

const POSITIONS = ['up', 'middle', 'down'];
const STICKS: Record<string, string> = {Ail: 'aileron', Ele: 'elevator', Thr: 'throttle', Rud: 'rudder'};
/** The TX16S's knobs, sliders and buttons as EdgeTX 2.12 (P1, SL2) and 2.8 (S1, RS) name them. */
const CONTROLS: Record<string, string> = {
  P1: 'S1',
  S1: 'S1',
  P3: 'S2',
  S2: 'S2',
  P2: '6P',
  '6POS': '6P',
  SL1: 'LS',
  LS: 'LS',
  SL2: 'RS',
  RS: 'RS',
};
const CONTROL_NAMES: Record<string, string> = {
  sticks: 'Sticks',
  S1: 'S1 knob',
  S2: 'S2 knob',
  '6P': '6-position buttons',
  LS: 'Left slider',
  RS: 'Right slider',
  telemetry: 'Telemetry',
};

/** The control a source or switch comes from: SA, sticks, S1, telemetry; a condition (L7) as itself. */
function controlOf(raw: string, model: CardModel): string | null {
  const name = raw.replace(/^!/, '');
  if (/^S[A-H][0-2]?$/.test(name)) return name.slice(0, 2);
  if (STICKS[name]) return 'sticks';
  if (CONTROLS[name]) return CONTROLS[name];
  if (/^6P\d+$/.test(name)) return '6P';
  if (name === 'TELEMETRY_STREAMING' || /^tele\(/.test(name)) return 'telemetry';
  const logical = /^(?:ls\((\d+)\)|L(\d+))$/.exec(name);
  if (logical) return `L${logical[1] ?? logical[2]}`;
  const input = /^I(\d+)$/.exec(name);
  if (input) {
    const line = model.inputs?.find(one => one.input === Number(input[1]));
    return line ? controlOf(line.source, model) : null;
  }
  return null;
}

const sensorName = (model: CardModel, index: number) => model.sensors[index] || `sensor ${index + 1}`;

/** A name inside a sentence: "Motor off" as "motor off", but "IU 1" and "S1 knob" as they are. */
const inSentence = (name: string) =>
  /^[A-Z][A-Z0-9]/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);

/** A source in words: "Thr" (an input), "S1", "L7", "VFAS", "aileron stick". */
export function sourceLabel(raw: string, model: CardModel): string {
  if (STICKS[raw]) return `${STICKS[raw]} stick`;
  const input = /^I(\d+)$/.exec(raw);
  if (input) return model.inputNames?.[Number(input[1])] || `input ${Number(input[1]) + 1}`;
  if (CONTROLS[raw]) return inSentence(CONTROL_NAMES[CONTROLS[raw]] ?? CONTROLS[raw]);
  const logical = /^ls\((\d+)\)$/.exec(raw);
  if (logical) return `L${logical[1]}`;
  const sensor = /^tele\((\d+)\)$/.exec(raw);
  if (sensor) return sensorName(model, Number(sensor[1]));
  const output = /^ch\((\d+)\)$/.exec(raw);
  if (output) return `CH${Number(output[1]) + 1}`;
  if (raw === 'MAX') return 'full';
  return raw;
}

/** A switch in words: "SA up", "SF not up", "motor off" (L10 by its name), "button 1", "always". */
export function switchLabel(raw: string, model: CardModel): string {
  if (!raw || raw === 'NONE' || raw === 'ON') return 'always';
  if (raw === '!TELEMETRY_STREAMING') return 'no telemetry';
  if (raw.startsWith('!')) {
    const position = /^!S([A-H])([0-2])$/.exec(raw);
    return position
      ? `S${position[1]} not ${POSITIONS[Number(position[2])]}`
      : `not ${switchLabel(raw.slice(1), model)}`;
  }
  const position = /^S([A-H])([0-2])$/.exec(raw);
  if (position) return `S${position[1]} ${POSITIONS[Number(position[2])]}`;
  const logical = /^L(\d+)$/.exec(raw);
  if (logical) {
    const name = conditionName(model.name, raw);
    return name ? inSentence(name) : raw;
  }
  const button = /^6P\d(\d)$/.exec(raw);
  if (button) return `button ${Number(button[1]) + 1}`;
  if (raw === 'TELEMETRY_STREAMING') return 'telemetry comes in';
  return raw;
}

function curveLabel(curve: CurveRef | undefined, model: CardModel) {
  if (!curve) return '';
  if (curve.type === 3) return `curve ${model.curveNames?.[curve.value - 1] || curve.value}`;
  if (curve.type === 1) return `expo ${curve.value}%`;
  if (curve.type === 0) return `differential ${curve.value}%`;
  return `function ${curve.value}`;
}

/** A logical switch in words: "SF down", "L4 hold or L5 disarmed", "VFAS below 10.5, for 2 s". */
export function describeCondition(logical: LogicalSwitch, model: CardModel): string {
  const [first = '', second = ''] = logical.def.split(',');
  const joins: Record<string, string> = {FUNC_AND: 'and', FUNC_OR: 'or', FUNC_XOR: 'or else'};
  let text: string;
  if (joins[logical.func]) text = `${switchLabel(first, model)} ${joins[logical.func]} ${switchLabel(second, model)}`;
  else {
    const value = Number(second);
    const sensor = /^tele\((\d+)\)$/.exec(first);
    if (/^S[A-H]$/.test(first)) {
      // A switch reads -100 (up), 0 (middle) or 100 (down) here.
      const position =
        logical.func === 'FUNC_VPOS'
          ? value < 0
            ? 'not up'
            : 'down'
          : logical.func === 'FUNC_VNEG'
            ? value > 0
              ? 'not down'
              : 'up'
            : (POSITIONS[Math.round(value / 100) + 1] ?? `at ${value}`);
      text = `${first} ${position}`;
    } else {
      const shown = sensor ? value / 10 ** (model.precisions?.[Number(sensor[1])] ?? 0) : value;
      const compare = logical.func === 'FUNC_VPOS' ? 'above' : logical.func === 'FUNC_VNEG' ? 'below' : 'at';
      text = `${sourceLabel(first, model)} ${compare} ${shown}${sensor ? '' : '%'}`;
    }
  }
  if (logical.andsw && logical.andsw !== 'NONE') text += `, and ${switchLabel(logical.andsw, model)}`;
  if (logical.delay) text += `, for ${logical.delay / 10} s`;
  return text;
}

/** A mix line in words: "Thr, curve FM3", "S1 -15%, offset -15". */
function describeMix(mix: CardMix, model: CardModel): string {
  return [
    sourceLabel(mix.source, model) + (mix.weight !== 100 ? ` ${mix.weight}%` : ''),
    curveLabel(mix.curve, model),
    mix.offset ? `offset ${mix.offset}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** A special or global function's settings: "armed,1,1x" is the track, on, said once. */
function settings(fn: CardFunction) {
  const [param = '', ...rest] = fn.def.split(',');
  // 2.12 writes whether it is on after the setting; 2.8 did not.
  const active = rest[0] === '0' || rest[0] === '1' ? rest.shift() === '1' : true;
  const repeat = rest[0] ?? '';
  const every = /^\d+$/.test(repeat) && Number(repeat) > 0 ? `, every ${repeat} s` : '';
  return {param, active, every};
}

/** What a special or global function does, in words: 'says "armed"', "resets timer 1", "sets the volume from S2". */
export function describeFunction(fn: CardFunction, model: CardModel): {text: string; active: boolean} {
  const {param, active, every} = settings(fn);
  const timer = /^Tmr(\d)$/.exec(param);
  const texts: Record<string, () => string> = {
    PLAY_TRACK: () => `says "${param}"${every}`,
    PLAY_VALUE: () => `says the ${sourceLabel(param, model)}${every}`,
    PLAY_SOUND: () => `plays ${param}${every}`,
    HAPTIC: () => `buzzes${every}`,
    RESET: () =>
      timer
        ? `resets timer ${timer[1]}`
        : /^\d+$/.test(param)
          ? `resets ${sensorName(model, Number(param))}`
          : `resets ${param.toLowerCase()}`,
    LOGS: () => `logs to the card every ${Number(param) / 10} s`,
    VOLUME: () => `sets the volume from ${sourceLabel(param, model)}`,
    BACKLIGHT: () => `sets the backlight from ${sourceLabel(param, model)}`,
  };
  const text = texts[fn.func]?.() ?? `${fn.func.toLowerCase().replace(/_/g, ' ')} ${param}`.trim();
  return {text, active};
}

/** The controls a function reads beyond its switch: VOLUME from S2 reads S2. */
const functionReads = (fn: CardFunction, model: CardModel) => {
  const read = controlOf(settings(fn).param, model);
  return read ? [read] : [];
};

const switchReads = (raw: string, model: CardModel) => {
  const read = controlOf(raw, model);
  return read ? [read] : [];
};

/** A sound on a switch position: 'SA up: "armed"', said whenever the switch goes there. */
const isSwitchSound = (fn: CardFunction) => fn.func === 'PLAY_TRACK' && /^!?S[A-H][0-2]$/.test(fn.swtch);

/** The whole of a model's logic, and the radio's, as the Logic view lays it out. */
export function describeLogic(model: CardModel, radio?: CardRadio): ModelLogicView {
  const conditions: LogicItem[] = Object.entries(model.logicalSwitches ?? {}).map(([index, logical]) => {
    const id = `L${Number(index) + 1}`;
    const [first = '', second = ''] = logical.def.split(',');
    const uses = [
      ...switchReads(first, model),
      ...(['FUNC_AND', 'FUNC_OR', 'FUNC_XOR'].includes(logical.func) ? switchReads(second, model) : []),
      ...(logical.andsw && logical.andsw !== 'NONE' ? switchReads(logical.andsw, model) : []),
    ];
    return {id, title: conditionName(model.name, id) ?? id, detail: describeCondition(logical, model), uses, when: id};
  });

  const channels: LogicChannel[] = [];
  for (const mix of model.mixes ?? []) {
    const channel = mix.channel + 1;
    let item = channels.find(one => one.channel === channel);
    if (!item) {
      const named = channelName(model.name, channel) ?? mix.name;
      item = {
        id: `CH${channel}`,
        channel,
        title: `CH${channel}${named ? ` ${named}` : ''}`,
        detail: '',
        uses: [],
        lines: [],
      };
      channels.push(item);
    }
    const how = mix.how === 'REPL' ? '=' : mix.how === 'MULT' ? '×' : '+';
    const when = mix.swtch === 'NONE' ? '' : mix.swtch;
    item.lines.push({text: describeMix(mix, model), how, when, label: when ? switchLabel(when, model) : ''});
    item.uses.push(...switchReads(mix.source, model), ...switchReads(mix.swtch, model));
  }
  channels.sort((left, right) => left.channel - right.channel);
  for (const item of channels) item.uses = [...new Set(item.uses)];

  const functions = model.functions ?? [];
  const actions: LogicItem[] = [
    ...(model.timers ?? []).flatMap((timer, index) =>
      timer.mode === 'OFF'
        ? []
        : [
            {
              id: `T${index + 1}`,
              title: timer.start
                ? `Timer ${index + 1} counts down from ${Math.floor(timer.start / 60)}:${String(timer.start % 60).padStart(2, '0')}`
                : `Timer ${index + 1} counts up`,
              detail: `while ${switchLabel(timer.swtch, model)}`,
              uses: switchReads(timer.swtch, model),
              when: timer.swtch,
            },
          ],
    ),
    ...functions.flatMap((fn, index) => {
      if (isSwitchSound(fn)) return [];
      const {text, active} = describeFunction(fn, model);
      return [
        {
          id: `F${index + 1}`,
          title: text.charAt(0).toUpperCase() + text.slice(1),
          detail: `when ${switchLabel(fn.swtch, model)}`,
          uses: [...switchReads(fn.swtch, model), ...functionReads(fn, model)],
          when: fn.swtch,
          ...(active ? {} : {off: true}),
        },
      ];
    }),
    ...(radio?.functions ?? []).map((fn, index) => {
      const {text, active} = describeFunction(fn, model);
      return {
        id: `G${index + 1}`,
        title: text.charAt(0).toUpperCase() + text.slice(1),
        detail: `${switchLabel(fn.swtch, model)}, every model`,
        uses: [...switchReads(fn.swtch, model), ...functionReads(fn, model)],
        when: fn.swtch,
        radioWide: true,
        ...(active ? {} : {off: true}),
      };
    }),
    ...(radio?.batteryWarning
      ? [
          {
            id: 'battery',
            title: `Warns when its own battery is low`,
            detail: `under ${radio.batteryWarning} V, every model`,
            uses: [],
            when: 'TX_BATTERY_LOW',
            radioWide: true,
          },
        ]
      : []),
  ];

  // The controls anything reads, in the radio's order, each with what it says on its positions.
  const read = new Set([...conditions, ...channels, ...actions].flatMap(item => item.uses));
  const readByModel = new Set(
    [...conditions, ...channels, ...actions.filter(item => !item.radioWide)].flatMap(item => item.uses),
  );
  const order = ['SA', 'SB', 'SC', 'SD', 'SE', 'SF', 'SG', 'SH', 'sticks', 'S1', 'S2', '6P', 'LS', 'RS', 'telemetry'];
  const controls: LogicItem[] = order
    .filter(id => read.has(id) || functions.some(fn => isSwitchSound(fn) && fn.swtch.replace('!', '').startsWith(id)))
    .map(id => {
      const sounds = functions
        .filter(fn => isSwitchSound(fn) && fn.swtch.replace('!', '').startsWith(id))
        .map(fn => `${switchLabel(fn.swtch, model).slice(id.length + 1)}: "${settings(fn).param}"`);
      const role = switchRole(model.name, id);
      return {
        id,
        title: CONTROL_NAMES[id] ?? (role ? `${id} ${inSentence(role.job)}` : id),
        detail: sounds.length ? `says ${sounds.join(', ')}` : '',
        uses: [],
        ...(read.has(id) && !readByModel.has(id) ? {radioWide: true} : {}),
      };
    });

  // A condition nothing reads is set up for nothing.
  const readers = [...conditions, ...channels, ...actions];
  for (const condition of conditions) {
    if (!readers.some(item => item.uses.includes(condition.id))) condition.unused = true;
  }
  return {controls, conditions, channels, actions};
}

/** Everything an item leads to and comes from: what lights up when it is picked. */
export function connected(view: ModelLogicView, id: string): Set<string> {
  const items = [...view.controls, ...view.conditions, ...view.channels, ...view.actions];
  const byId = new Map(items.map(item => [item.id, item]));
  const found = new Set([id]);
  // Downstream: whatever reads it, and whatever reads those.
  const down = [id];
  while (down.length) {
    const from = down.shift()!;
    for (const item of items) {
      if (item.uses.includes(from) && !found.has(item.id)) {
        found.add(item.id);
        down.push(item.id);
      }
    }
  }
  // Upstream: whatever it reads, and whatever those read.
  const seen = new Set([id]);
  const up = [id];
  while (up.length) {
    for (const used of byId.get(up.shift()!)?.uses ?? []) {
      if (!seen.has(used)) {
        seen.add(used);
        found.add(used);
        up.push(used);
      }
    }
  }
  return found;
}
