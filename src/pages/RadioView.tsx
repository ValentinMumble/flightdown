import {useEffect, useMemo, useRef, useState} from 'react';
import {Download, Pause, Play, RotateCcw} from 'lucide-react';
import type {TelemetrySeries} from '../types';
import {useStore} from '../data/store';
import {Segmented} from '../components/ui';
import {Panel} from '../components/instruments';
import {cutout} from '../components/HeliPhoto';
import {buttonPack, joinSeries, sortiePacks} from '../model/packs';
import {formatDay, formatTimer, plural} from '../model/format';
import {buttonOf} from '../model/telemetry';
import {Radio, SCREEN, startLua, type RadioInputs, type WidgetOption, type WidgetRunner} from '../radio/edgetx';
import {ModelTimers} from '../radio/timers';
import {channelOutput, mixSource, outputIndex} from '../radio/mixer';
import {describeLogic} from '../radio/logic';
import {RadioLogic} from '../components/RadioLogic';
import {IdleUps} from '../components/IdleUps';
import {RadioKnob} from '../components/RadioKnob';
import {RadioStick} from '../components/RadioStick';
import type {Card, CardModel} from '../radio/card';
import {switchRole} from '../radio/roles';
import {mainView, TOP_BAR} from '../radio/layout';
import {
  drawBuiltin,
  drawChrome,
  drawMissing,
  isBuiltin,
  loadCardWidget,
  optionLines,
  placeScreen,
  type Placed,
} from '../radio/screen';
import {
  guessSignal,
  followedValue,
  listWidgets,
  radioFile,
  packSignals,
  radioName,
  widgetCode,
  type PackSignal,
  type WidgetFile,
} from '../radio/widgets';
import '../styles/radio.css';
import {readJson, readText, writeJson, writeText} from '../data/storage';
import {readCard} from '../sim/card';
import {
  isSwitch,
  sourceKey,
  guessFor,
  SIDES,
  BUTTONS,
  buttonValue,
  restingValue,
  FROM_THE_PACK,
  waysOf,
  positionOf,
  SourceControl,
} from '../components/radio/RadioControls';

type Mode = 'screen' | 'widget';
/** What the tab shows: a mode, or the model's screens with its logic or its idle ups under them. */
type Shown = Mode | 'logic' | 'idle';

/** Zones a widget can sit in on the TX16S, measured from EdgeTX: the M2 EVO's first. */
const ALL_DECORATIONS = {topbar: true, flightMode: true, sliders: true, trims: true, mirrored: false};
const VIEW = mainView(ALL_DECORATIONS);
/** The main view with the top bar only, no sliders, trims or flight mode: the M2 EVO's cockpit screen. */
const BARE = mainView({...ALL_DECORATIONS, flightMode: false, sliders: false, trims: false});
const ZONES = [
  {key: 'top-left', label: 'Layout 2 + 1, top left', width: VIEW.w / 2, height: Math.trunc(VIEW.h / 2)},
  {key: 'right', label: 'Layout 2 + 1, right', width: VIEW.w / 2, height: VIEW.h},
  {key: 'view', label: 'Whole main view', width: VIEW.w, height: VIEW.h},
  {key: 'bare', label: 'Main view, top bar only (the cockpit)', width: BARE.w, height: BARE.h},
  {key: 'full', label: 'Full screen', width: SCREEN.width, height: SCREEN.height},
  {key: 'topbar', label: 'Top bar slot', width: 74, height: TOP_BAR - 6},
];
const SPEEDS = ['1', '2', '4'];

const PREFERENCES = 'flightdown.radio';
const CODE = 'flightdown.radio.code.';

const remembered = () => readJson<Record<string, string>>(PREFERENCES) ?? {};
/** Private browsing: the choice is just not kept. */
const remember = (key: string, value: string) => writeJson(PREFERENCES, {...remembered(), [key]: value});
const storedCode = (file: string) => readText(CODE + file);
/** Not kept: the edit lasts until the page closes. */
const storeCode = (file: string, code: string | null) => writeText(CODE + file, code);

const message = (error: unknown) => String((error as Error)?.message ?? error);

/**
 * The radio's screen in the Hangar, a TX16S in the browser. Model screens: any model from the radio's card, its
 * screens as the radio draws them, every widget in its zone. One widget: a widget built in edge-tx, the very Lua that
 * goes on the radio, in a zone of its size, with its Lua to edit. Both read the switches set here, or a logged pack
 * replayed through them.
 */
export default function RadioView() {
  const {doc, loadSeries} = useStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const radio = useRef<Radio | null>(null);
  const runner = useRef<WidgetRunner | null>(null);
  const inputs = useRef<RadioInputs | null>(null);

  const saved = useMemo(remembered, []);
  const flying = doc.helis.find(heli => heli.status === 'active') ?? doc.helis[0];
  const [mode, setMode] = useState<Mode>(saved.mode === 'widget' ? 'widget' : 'screen');
  const [logic, setLogic] = useState(saved.mode === 'logic');
  const [idle, setIdle] = useState(saved.mode === 'idle');
  const [card, setCard] = useState<Card | null>(null);
  const [modelId, setModelId] = useState(saved.model ?? '');
  const [screenIndex, setScreenIndex] = useState(0);
  const [widgets, setWidgets] = useState<WidgetFile[]>([]);
  const [file, setFile] = useState(saved.file ?? 'armed-model.lua');
  const [zoneKey, setZoneKey] = useState(saved.zone ?? ZONES[0].key);
  const [heliId, setHeliId] = useState(saved.heli ?? flying?.id ?? '');
  const [built, setBuilt] = useState<{file: string; code: string; changed: number} | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{name: string; options: WidgetOption[]} | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [problem, setProblem] = useState('');
  const [ready, setReady] = useState(false);
  const [imageReady, setImageReady] = useState(0);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number | string>>({});
  const [bindings, setBindings] = useState<Record<string, PackSignal | ''>>({});
  /** Which option each switch feeds, from the screen's widgets: SA is the ArmedModel's ArmedSwitch. */
  const [hints, setHints] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<string[]>([]);
  const [sounds, setSounds] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [packKey, setPackKey] = useState('');
  const [series, setSeries] = useState<TelemetrySeries | null>(null);
  /** When the pack replayed started (YYYY-MM-DDTHH:MM:SS): a switch whose meaning changed since reads flipped. */
  const [seriesStart, setSeriesStart] = useState<string | undefined>(undefined);
  const [replay, setReplay] = useState({at: 0, playing: false, speed: '1'});

  const heli = doc.helis.find(one => one.id === heliId);
  const zone = ZONES.find(one => one.key === zoneKey) ?? ZONES[0];
  const code = edited ?? built?.code ?? '';
  const model =
    card?.models.find(one => one.id === modelId) ??
    card?.models.find(one => one.name === 'M2 EVO') ??
    card?.models.find(one => one.screens.some(screen => screen.zones.length));
  const screen = model?.screens[Math.min(screenIndex, (model?.screens.length ?? 1) - 1)];

  // The model's logic in words, for the Logic view, with the radio's own.
  const logicView = useMemo(() => (model ? describeLogic(model, card?.radio) : null), [model, card?.radio]);

  // The model's timers as the radio runs them: from the start of each pack replayed, else on the clock.
  const timers = useMemo(
    () => (mode === 'screen' && model ? new ModelTimers(model, series ? 0 : null) : null),
    [mode, model, series],
  );

  // What the frame loop reads, always the latest.
  const live = useRef({
    manual,
    bindings,
    series,
    seriesStart,
    replay,
    placed: [] as Placed[],
    chrome: ALL_DECORATIONS as typeof ALL_DECORATIONS | null,
    sensors: [] as string[],
    hints: {} as Record<string, string>,
    outline: false,
    timers: null as ModelTimers | null,
    model: null as CardModel | null,
    last: performance.now(),
  });
  live.current = {
    ...live.current,
    manual,
    bindings,
    series,
    seriesStart,
    chrome:
      mode === 'screen'
        ? (screen?.options ?? null)
        : {...ALL_DECORATIONS, flightMode: false, sliders: false, trims: false},
    sensors: mode === 'screen' ? (model?.sensors ?? []) : [],
    outline: mode === 'widget',
    timers,
    model: mode === 'screen' ? (model ?? null) : null,
  };

  const packs = useMemo(
    () =>
      [...doc.sorties]
        .filter(sortie => sortie.telemetry.length)
        .sort((left, right) => right.date.localeCompare(left.date))
        .flatMap(sortie => {
          const flights = sortiePacks(sortie);
          const name = doc.helis.find(one => one.id === sortie.heliId)?.name ?? 'A heli';
          return flights.map((pack, index) => ({
            key: `${sortie.id}:${index}`,
            sortie,
            pack,
            label: `${formatDay(sortie.date, {weekday: false, year: true})} · ${name}${flights.length > 1 ? ` · pack ${index + 1}` : ''}`,
          }));
        }),
    [doc.sorties, doc.helis],
  );
  const channels = packSignals(series);
  const duration = series?.time[series.time.length - 1] ?? 0;

  // A telemetry source reads as its sensor's name ("tele(5)" is VFAS on the M2 EVO), to find its channel in a pack.
  const sensorName = (source: string, sensors: string[]) => {
    const telemetry = /^tele\([-+]?(\d+)\)$/.exec(source);
    return telemetry ? (sensors[Number(telemetry[1])] ?? source) : source;
  };

  // A source at a moment of the pack replayed (now unless said), or as set by hand. It reads `live`, so the Lua and the
  // Logic view both see the latest.
  const valueAt = (asked: string, second?: number): number => {
    const now = live.current;
    const source = sourceKey(asked);
    const role = switchRole(now.model?.name, source);
    const running = role?.running;
    const flipped = Boolean(role?.flippedBefore && now.seriesStart && now.seriesStart < role.flippedBefore);
    // A source set by hand stays so, even when the pack has a channel of its name.
    const bound = now.bindings[source];
    const channel =
      bound === undefined ? guessFor(source, now.sensors, now.hints, packSignals(now.series), running) : bound;
    if (channel && now.series) return followedValue(now.series, channel, second ?? now.replay.at, running, flipped);
    // An output no log drives: the model's mixer makes it, from the switches and sticks as set, as the radio would.
    const output = outputIndex(asked);
    if (output !== null && now.model) {
      return channelOutput(
        now.model,
        output,
        mixed => valueAt(mixed, second),
        name => logicNow()?.isOn(name) ?? false,
      );
    }
    return now.manual[source] ?? restingValue(source);
  };

  // The model's logic (timers, logical switches) moved on to now: by the screen's timers and by the Logic view.
  const logicNow = () => {
    const {timers: running, series: replayed, replay: at} = live.current;
    running?.advance(
      replayed ? at.at : performance.now() / 1000,
      second => asked => valueAt(asked, replayed ? second : undefined),
    );
    return running;
  };

  // The radio and its Lua, once.
  useEffect(() => {
    if (!canvas.current) return;
    // One radio for the screen, even when React mounts the view twice (development): the Lua draws through it.
    if (!radio.current) {
      inputs.current = {
        value: asked => valueAt(asked),
        timer: index => {
          const running = logicNow();
          return running ? {value: running.value(index), start: running.start(index)} : {value: 0, start: 0};
        },
        model: {name: '', bitmap: ''},
      };
      radio.current = new Radio(canvas.current, inputs.current);
    }
    const made = radio.current;
    let current = true;
    const start = async () => {
      try {
        runner.current = await startLua(made);
        if (current) setReady(true);
      } catch (error) {
        if (current) setProblem(`The Lua engine did not start: ${message(error)}`);
      }
    };
    void start();
    return () => {
      current = false;
    };
  }, []);

  // The radio's card: every kept model's screens and logic, read from edge-tx by /api/radio.
  useEffect(() => {
    let current = true;
    const read = async () => {
      const {card: found, problem: why} = await readCard(true);
      if (!current) return;
      setCard(found ?? {from: '', models: [], widgets: []});
      if (why) setProblem(why);
    };
    void read();
    return () => {
      current = false;
    };
  }, []);

  // The widgets built in edge-tx. While developing, a rebuild there shows here on its own.
  useEffect(() => {
    let current = true;
    const read = async () => {
      try {
        const list = await listWidgets();
        if (current) setWidgets(list);
      } catch {
        if (current) setWidgets([]);
      }
    };
    void read();
    const timer = import.meta.env.DEV ? window.setInterval(read, 1500) : undefined;
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, []);

  const shown = widgets.find(widget => widget.file === file) ?? widgets[0];
  useEffect(() => {
    if (!shown) return;
    let current = true;
    const read = async () => {
      try {
        const text = await widgetCode(shown.file);
        if (!current) return;
        setBuilt({file: shown.file, code: text, changed: shown.changed});
        setEdited(storedCode(shown.file));
        setDraft(null);
      } catch (error) {
        if (current) setProblem(message(error));
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [shown?.file, shown?.changed]);

  /** Puts a picture where the widgets open it, once: a model's own from the card, or a heli's cut-out photo. */
  const loadPicture = async (key: string, source: () => Promise<string | null>) => {
    const screenRadio = radio.current;
    if (!screenRadio || !key || screenRadio.images.has(key)) return;
    try {
      const url = await source();
      if (!url) return;
      const image = new Image();
      image.src = url;
      await image.decode();
      screenRadio.images.set(key, await createImageBitmap(image));
    } catch {
      // No picture: the widget gets nil, as on a radio without the file.
    }
  };

  // One widget: its model is a heli of the log, with its cut-out photo.
  useEffect(() => {
    if (mode !== 'widget' || !inputs.current) return;
    inputs.current.model = {name: heli ? radioName(heli.name) : 'Model', bitmap: heli?.photo ? `heli-${heli.id}` : ''};
    let current = true;
    const photo = heli?.photo;
    void loadPicture(heli ? `heli-${heli.id}` : '', async () => (photo ? ((await cutout(photo)) ?? photo) : null)).then(
      () => current && setImageReady(count => count + 1),
    );
    return () => {
      current = false;
    };
  }, [mode, heli?.id, heli?.name, heli?.photo]);

  /** Takes the widgets off the screen, before others go on it. */
  const clearScreen = () => {
    for (const item of live.current.placed) if (item.kind === 'lua') runner.current?.drop(item.id);
    live.current.placed = [];
    radio.current?.resetBitmaps();
    radio.current?.asked.clear();
    setAsked([]);
    live.current.hints = {};
    setHints({});
  };

  // One widget: (re)started on new code, a new zone or a new model.
  useEffect(() => {
    const lua = runner.current;
    const screenRadio = radio.current;
    if (mode !== 'widget' || !ready || !lua || !screenRadio || !code || !shown) return;
    clearScreen();
    try {
      const key = `edge-tx:${shown.file}`;
      const widget = lua.load(key, code);
      const full = zone.width >= SCREEN.width;
      const rect = full
        ? {x: 0, y: 0, w: zone.width, h: zone.height}
        : {x: VIEW.x, y: VIEW.y, w: zone.width, h: zone.height};
      const declared = widget.options.map(option => ({
        type: option.type === 'source' ? 'Source' : 'Signed',
        value: option.type === 'source' ? option.name : (values[option.name] ?? option.initial),
      }));
      lua.create('single', key, rect.w, rect.h, optionLines(screenRadio, widget.options, declared));
      const item: Placed = {id: 'single', widget: widget.name, rect, kind: 'lua', key, options: declared};
      live.current.placed = [item];
      setPlaced([item]);
      setLoaded(widget);
      setProblem('');
    } catch (error) {
      setProblem(message(error));
    }
    // Option changes go through update, below.
  }, [mode, ready, code, zone.width, zone.height, imageReady]);

  useEffect(() => {
    if (mode !== 'widget' || !loaded || problem || !radio.current) return;
    try {
      const declared = loaded.options.map(option => ({
        type: option.type === 'source' ? 'Source' : option.type === 'string' ? 'String' : 'Signed',
        value: option.type === 'source' ? option.name : (values[option.name] ?? option.initial),
      }));
      runner.current?.update('single', optionLines(radio.current, loaded.options, declared));
    } catch (error) {
      setProblem(message(error));
    }
  }, [values]);

  // Model screens: every zone of the chosen screen, and the top bar, with its widget.
  useEffect(() => {
    const lua = runner.current;
    const screenRadio = radio.current;
    if (mode !== 'screen' || !ready || !lua || !screenRadio || !card || !model) return;
    let current = true;
    const setUp = async () => {
      clearScreen();
      inputs.current!.model = {
        name: model.name,
        bitmap: model.bitmap,
        globals: model.globals,
        reversed: model.reversed,
        curves: (model.curves ?? []).map((curve, index) => curve && {...curve, name: model.curveNames?.[index] ?? ''}),
        inputs: model.inputs,
      };
      await loadPicture(model.bitmap, async () => radioFile(`IMAGES/${model.bitmap}`));
      const next: Placed[] = [];
      const readers: Record<string, string> = {};
      for (const {rect, zone: slot, id} of placeScreen(model, screenIndex)) {
        const base = {id, widget: slot.widget, rect, options: slot.options};
        if (isBuiltin(slot.widget)) {
          next.push({...base, kind: 'builtin'});
          continue;
        }
        const loading = loadCardWidget(card, slot.widget, lua, screenRadio);
        if (!loading) {
          next.push({...base, kind: 'missing', problem: 'Not on the card'});
          continue;
        }
        try {
          const widget = await loading;
          lua.create(id, widget.key, rect.w, rect.h, optionLines(screenRadio, widget.options, slot.options));
          widget.options.forEach((option, index) => {
            const given = slot.options[index];
            if (option.type === 'source' && given?.type === 'Source' && given.value) {
              readers[sourceKey(String(given.value))] = option.name;
            }
          });
          next.push({...base, kind: 'lua', key: widget.key});
        } catch (error) {
          next.push({...base, kind: 'missing', problem: message(error)});
        }
      }
      if (!current) return;
      live.current.placed = next;
      live.current.hints = readers;
      setHints(readers);
      setPlaced(next);
      setProblem('');
    };
    void setUp();
    return () => {
      current = false;
    };
  }, [mode, ready, card, model?.id, screenIndex]);

  // An edit runs half a second after the typing stops, and is kept in this browser.
  useEffect(() => {
    if (draft === null || !built) return;
    const timer = window.setTimeout(() => {
      const next = draft === built.code ? null : draft;
      setEdited(next);
      storeCode(built.file, next);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, built]);

  // The screen, 20 times a second, as the radio refreshes its widgets.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const screenRadio = radio.current;
      const lua = runner.current;
      if (!screenRadio) return;
      const now = performance.now();
      const state = live.current;
      if (state.replay.playing && state.series) {
        const end = state.series.time[state.series.time.length - 1] ?? 0;
        const at = Math.min(end, state.replay.at + ((now - state.last) / 1000) * Number(state.replay.speed));
        state.replay = {...state.replay, at, playing: at < end};
      }
      state.last = now;

      const {context} = screenRadio;
      drawChrome(context, state.chrome);
      if (state.outline) {
        context.save();
        context.fillStyle = '#a0a0a0';
        context.font = '500 14px Roboto, Arial, sans-serif';
        context.textBaseline = 'middle';
        context.fillText(inputs.current?.model.name ?? '', 54, TOP_BAR / 2);
        context.restore();
      }
      for (const item of state.placed) {
        screenRadio.zone = {...item.rect};
        if (item.kind === 'lua' && lua && !item.problem) {
          try {
            lua.refresh(item.id);
          } catch (error) {
            item.problem = message(error);
            if (item.id === 'single') setProblem(item.problem);
          }
        } else if (item.kind === 'builtin') {
          drawBuiltin(screenRadio, item, inputs.current?.model ?? {name: '', bitmap: ''});
        }
        if (item.kind === 'missing' || (item.problem && item.id !== 'single')) drawMissing(screenRadio, item);
        if (state.outline) {
          context.save();
          context.setLineDash([3, 3]);
          context.strokeStyle = 'rgba(126, 224, 160, 0.45)';
          context.strokeRect(item.rect.x - 0.5, item.rect.y - 0.5, item.rect.w + 1, item.rect.h + 1);
          context.restore();
        }
      }
      setReplay(state.replay);
      setSounds(previous => (previous.join() === screenRadio.sounds.join() ? previous : screenRadio.sounds));
      setAsked(previous => (previous.length === screenRadio.asked.size ? previous : [...screenRadio.asked]));
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  const choosePack = async (key: string) => {
    setPackKey(key);
    const chosen = packs.find(one => one.key === key);
    if (!chosen) {
      setSeries(null);
      live.current.replay = {...live.current.replay, at: 0, playing: false};
      return;
    }
    if (chosen.sortie.heliId) setHeliId(chosen.sortie.heliId);
    const parts = await Promise.all(chosen.pack.files.map(one => loadSeries(one.id).catch(() => null)));
    if (parts.some(part => !part)) {
      setProblem('The samples of this pack could not be read.');
      return;
    }
    setSeries(joinSeries(chosen.pack, parts as TelemetrySeries[]));
    setSeriesStart(chosen.pack.start);
    // The pack drives the sticks and the buttons again, even those moved by hand before (the curve's dot follows the
    // collective it logged).
    setBindings(previous =>
      Object.fromEntries(Object.entries(previous).filter(([name]) => !FROM_THE_PACK.includes(name))),
    );
    live.current.replay = {...live.current.replay, at: 0, playing: true};
  };

  const setReplayState = (change: Partial<typeof replay>) => {
    live.current.replay = {...live.current.replay, ...change};
    setReplay(live.current.replay);
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([code], {type: 'text/plain'}));
    link.download = 'main.lua';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const sensors = mode === 'screen' ? (model?.sensors ?? []) : [];
  const sourceOptions = mode === 'widget' ? (loaded?.options.filter(option => option.type === 'source') ?? []) : [];
  const otherOptions = mode === 'widget' ? (loaded?.options.filter(option => option.type !== 'source') ?? []) : [];
  const optionNames = new Set(sourceOptions.map(option => option.name));
  const readByName = [...new Set(asked.map(sourceKey))].filter(name => name && !optionNames.has(name)).sort();
  const sources = [...sourceOptions.map(option => option.name), ...readByName];
  const switches = sources.filter(isSwitch);
  const others = sources.filter(name => !isSwitch(name));
  // Model screens: the radio's eight switches where they sit, and any other a widget reads after them. One widget: the
  // switches it takes as options, shared between the sides.
  const physical = [...SIDES.left, ...SIDES.right];
  const loose = switches.filter(name => !physical.includes(name));
  const side =
    mode === 'screen'
      ? {
          left: [...SIDES.left, ...loose.filter((_name, index) => index % 2 === 0)],
          right: [...SIDES.right, ...loose.filter((_name, index) => index % 2 === 1)],
        }
      : {
          left: switches.filter((_name, index) => index % 2 === 0),
          right: switches.filter((_name, index) => index % 2 === 1),
        };
  // Dimmed: a switch the model uses nowhere (on any screen, in a mix, a logical switch, a sound...); for a card read
  // before Flightdown knew that, one no widget on this screen reads.
  const isUnused = (name: string) =>
    mode === 'screen' && !(model?.switches ? model.switches.includes(name) : switches.includes(name));
  // A source now: what the pack replayed gives it, else what was set by hand, else where it rests.
  const sourceNow = (name: string) => {
    const role = switchRole(model?.name, name);
    const running = role?.running;
    const flipped = Boolean(role?.flippedBefore && seriesStart && seriesStart < role.flippedBefore);
    const followed = bindings[name] ?? guessFor(name, sensors, hints, channels, running);
    return {
      followed,
      value:
        followed && series
          ? followedValue(series, followed, replay.at, running, flipped)
          : (manual[name] ?? restingValue(name)),
    };
  };
  // The 6-position buttons, under the screen as on the radio: always on a model screen, else when the widget reads them.
  const showButtons = mode === 'screen' || sources.includes('6P');
  const buttons = sourceNow('6P');
  // The S1 knob beside them when a widget reads it (the M2 EVO's Cockpit shows what it adds to the head speed).
  const showKnob = sources.includes('S1');
  const folded = others.filter(name => (name !== '6P' || !showButtons) && (name !== 'S1' || !showKnob));
  const turnKnob = (value: number) => {
    setBindings(previous => ({...previous, S1: ''}));
    setManual(previous => ({...previous, S1: value}));
  };
  // The two sticks under the screen (Mode 2): on a model screen, or when the widget reads one. Moved by hand, a stick
  // leaves the pack replayed.
  const showSticks = mode === 'screen' || sources.some(name => ['Ail', 'Ele', 'Thr', 'Rud'].includes(name));
  const moveStick = (name: string, value: number) => {
    setBindings(previous => ({...previous, [name]: ''}));
    setManual(previous => ({...previous, [name]: value}));
  };
  const axis = (name: string, springs = true) => ({name, value: sourceNow(name).value, springs});
  const pressed = buttonOf(buttons.value);
  const pressButton = (button: number) => {
    setBindings(previous => ({...previous, '6P': ''}));
    setManual(previous => ({...previous, '6P': buttonValue(button)}));
  };
  const control = (name: string, unused = false) => {
    const sensor = sensorName(name, sensors);
    const {followed, value} = sourceNow(name);
    return (
      <SourceControl
        key={name}
        name={name}
        unused={unused}
        label={sensor === name ? name : `${name} · ${sensor}`}
        hint={hints[name]}
        role={mode === 'screen' ? switchRole(model?.name, name) : undefined}
        packSignal={guessSignal(name, channels) || (hints[name] && guessSignal(hints[name], channels)) || 'running'}
        value={value}
        onChange={value => setManual(previous => ({...previous, [name]: value}))}
        channel={followed}
        channels={channels}
        onBind={channel => setBindings(previous => ({...previous, [name]: channel}))}
      />
    );
  };
  const chooseMode = (next: Shown) => {
    setMode(next === 'widget' ? 'widget' : 'screen');
    setLogic(next === 'logic');
    setIdle(next === 'idle');
    remember('mode', next);
    setProblem('');
  };

  // The Logic view: what is on now, where each control sits, the timers and the outputs a replay logged.
  const showLogic = logic && mode === 'screen' && logicView !== null;
  const isOnNow = (when: string) =>
    when === 'TX_BATTERY_LOW'
      ? valueAt('TX_VOLTAGE') < (card?.radio?.batteryWarning ?? 0)
      : (logicNow()?.isOn(when) ?? false);
  const whereNow = (control: string) => {
    if (/^S[A-H]$/.test(control)) return positionOf(valueAt(control));
    if (control === '6P') return `button ${buttonOf(valueAt('6P'))}`;
    if (['S1', 'S2', 'LS', 'RS'].includes(control)) return `${Math.round(valueAt(control) / 10.24)}%`;
    if (control === 'telemetry') return isOnNow('TELEMETRY_STREAMING') ? 'coming in' : 'none';
    return '';
  };
  const outputNow = (channel: number) =>
    series?.channels[`ch${channel}`]?.length ? Math.round(1500 + valueAt(`ch(${channel - 1})`) / 2) : null;

  const optionTile = (option: WidgetOption) => (
    <label key={option.name} className="radio-input">
      <span className="radio-input-name">{option.name}</span>
      {option.type === 'bool' ? (
        <input
          type="checkbox"
          checked={Number(values[option.name] ?? option.initial) === 1}
          onChange={event => setValues(previous => ({...previous, [option.name]: event.target.checked ? 1 : 0}))}
        />
      ) : option.type === 'color' ? (
        <input
          type="color"
          className="radio-color"
          onChange={event =>
            setValues(previous => ({...previous, [option.name]: parseInt(event.target.value.slice(1), 16)}))
          }
        />
      ) : (
        <input
          className="input"
          type={option.type === 'value' ? 'number' : 'text'}
          value={values[option.name] ?? option.initial}
          onChange={event =>
            setValues(previous => ({
              ...previous,
              [option.name]: option.type === 'value' ? Number(event.target.value) : event.target.value,
            }))
          }
        />
      )}
    </label>
  );
  const where = (item: Placed) => (item.id.startsWith('top') ? 'top bar' : `zone ${item.id.replace('zone-', '')}`);
  const how = (item: Placed) =>
    item.kind === 'lua'
      ? item.problem
        ? 'Lua, failed'
        : 'Lua from the card'
      : item.kind === 'builtin'
        ? "EdgeTX's own, redrawn"
        : (item.problem ?? '');

  return (
    <div className="radio-view">
      {/* As on the TX16S, the S1 knob and the 6-position buttons sit above the screen (and the switches keep
        their top level with it). */}
      {(showButtons || showKnob) && (
        <div
          className={['radio-buttons', buttons.followed && 'from-pack'].filter(Boolean).join(' ')}
          role="group"
          aria-label="6-position buttons"
        >
          {showKnob && <RadioKnob name="S1" value={sourceNow('S1').value} onChange={turnKnob} />}
          {showButtons && (
            <div className="radio-buttons-set">
              <div className="radio-buttons-row">
                {BUTTONS.map(button => {
                  const pack = buttonPack(button, doc.batteries);
                  return (
                    <button
                      key={button}
                      type="button"
                      className="radio-button"
                      aria-pressed={pressed === button}
                      aria-label={`Button ${button}${pack ? `: ${pack}` : ''}`}
                      title={pack ?? `Button ${button}`}
                      onClick={() => pressButton(button)}
                    >
                      {button}
                    </button>
                  );
                })}
              </div>
              <span className="radio-buttons-pack">
                {buttonPack(pressed, doc.batteries) ?? `Button ${pressed}`}
                {buttons.followed && series ? ', from the pack' : ''}
              </span>
            </div>
          )}
          {/* A light that flashes while a pack replays, as a recorder's: its place kept, so nothing moves. */}
          <span className="radio-replay" aria-hidden={!replay.playing} role="status">
            <span className="radio-replay-dot" />
            Replay
          </span>
        </div>
      )}
      <div className="radio-console">
        <div className="radio-switches left" aria-label="Left switches">
          {side.left.map(name => control(name, isUnused(name)))}
        </div>
        <div className="radio-screen">
          <canvas ref={canvas} width={SCREEN.width} height={SCREEN.height} aria-label="The radio's screen" />
          {showSticks && (
            <div className="radio-sticks">
              <RadioStick label="Left stick" across={axis('Rud')} up={axis('Thr', false)} onChange={moveStick} />
              <RadioStick label="Right stick" across={axis('Ail')} up={axis('Ele')} onChange={moveStick} />
            </div>
          )}
        </div>
        <div className="radio-switches right" aria-label="Right switches">
          {side.right.map(name => control(name, isUnused(name)))}
        </div>
      </div>

      <div className="radio-bar">
        <Segmented<Shown>
          label="Show"
          value={mode === 'widget' ? 'widget' : logic ? 'logic' : idle ? 'idle' : 'screen'}
          onChange={chooseMode}
          options={[
            {value: 'screen', label: 'Model screens'},
            {value: 'logic', label: 'Logic'},
            {value: 'idle', label: 'Idle ups'},
            {value: 'widget', label: 'One widget'},
          ]}
        />
        {mode === 'screen' ? (
          <>
            <select
              className="input"
              aria-label="Model"
              value={model?.id ?? ''}
              onChange={event => {
                setModelId(event.target.value);
                setScreenIndex(0);
                remember('model', event.target.value);
              }}
            >
              {card?.models.map(one => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
            {model && model.screens.length > 1 && (
              <Segmented
                label="Screen"
                value={String(screenIndex)}
                onChange={value => setScreenIndex(Number(value))}
                options={model.screens.map((_page, index) => ({value: String(index), label: `Screen ${index + 1}`}))}
              />
            )}
          </>
        ) : (
          <>
            <select
              className="input"
              aria-label="Widget"
              value={shown?.file ?? ''}
              onChange={event => {
                setFile(event.target.value);
                remember('file', event.target.value);
                setValues({});
              }}
            >
              {widgets.map(widget => (
                <option key={widget.file} value={widget.file}>
                  {widget.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Zone"
              value={zone.key}
              onChange={event => {
                setZoneKey(event.target.value);
                remember('zone', event.target.value);
              }}
            >
              {ZONES.map(one => (
                <option key={one.key} value={one.key}>
                  {one.label} ({one.width} × {one.height})
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Model"
              value={heliId}
              onChange={event => {
                setHeliId(event.target.value);
                remember('heli', event.target.value);
              }}
            >
              {doc.helis.map(one => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="radio-bar-end">
          {mode === 'widget' && edited !== null && <span className="pill caution">Edited here</span>}
          <button
            type="button"
            className="button small ghost"
            onClick={() => {
              radio.current?.pause(!paused);
              setPaused(!paused);
            }}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Run' : 'Freeze'}
          </button>
        </span>
      </div>
      {problem && <pre className="radio-problem">{problem}</pre>}

      <div className="radio-replay">
        {packs.length ? (
          <>
            <select
              className="input"
              aria-label="Pack to replay"
              value={packKey}
              onChange={event => void choosePack(event.target.value)}
            >
              <option value="">Replay a pack…</option>
              {packs.map(one => (
                <option key={one.key} value={one.key}>
                  {one.label}
                </option>
              ))}
            </select>
            {series && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={replay.playing ? 'Pause the pack' : 'Play the pack'}
                  onClick={() => setReplayState({playing: !replay.playing, at: replay.at >= duration ? 0 : replay.at})}
                >
                  {replay.playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={replay.at}
                  onChange={event => setReplayState({at: Number(event.target.value)})}
                  aria-label="Moment of the pack"
                />
                <span className="radio-value">
                  {formatTimer(replay.at)} / {formatTimer(duration)}
                </span>
                <Segmented
                  label="Speed"
                  value={replay.speed}
                  onChange={speed => setReplayState({speed})}
                  options={SPEEDS.map(speed => ({value: speed, label: `${speed}×`}))}
                />
              </>
            )}
          </>
        ) : (
          <span className="muted">No radio log yet: add one to a sortie to replay it here.</span>
        )}
      </div>

      {/* The idle ups under the screen: the stick and switches set by hand, or a replay, read along every curve. */}
      {idle && mode === 'screen' && model && (
        <IdleUps
          model={model}
          now={{
            stick: valueAt('Thr') / 10.24,
            idleUp: Math.round(valueAt('SE') / 1024) + 2,
            practice: valueAt('SG') > 512,
          }}
        />
      )}

      {/* The logic under the screen and the replay, the whole width: flip a switch or play a pack and watch both. */}
      {showLogic && (
        <RadioLogic
          view={logicView}
          isOn={isOnNow}
          where={whereNow}
          ways={waysOf}
          timer={index => logicNow()?.value(index) ?? 0}
          output={outputNow}
          input={source =>
            model
              ? mixSource(
                  model,
                  mixed => valueAt(mixed),
                  name => logicNow()?.isOn(name) ?? false,
                )(source)
              : 0
          }
        />
      )}

      {(folded.length > 0 || otherOptions.length > 0) && (
        <details className="radio-more">
          <summary>Sticks, outputs, sensors and settings · {folded.length + otherOptions.length}</summary>
          <div className="radio-grid">
            {folded.map(name => control(name))}
            {otherOptions.map(optionTile)}
          </div>
        </details>
      )}

      {mode === 'screen' ? (
        <details className="radio-more">
          <summary>On this screen · {plural(placed.length, 'widget')}</summary>
          {placed.length ? (
            <div className="radio-placed">
              {placed.map(item => (
                <div key={item.id} className="radio-placed-row">
                  <b>{item.widget}</b>
                  <span className="muted">{where(item)}</span>
                  <span className="muted tabular">
                    {item.rect.w} × {item.rect.h}
                  </span>
                  <span className="muted">{how(item)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">{model ? 'No widget on this screen.' : 'The card did not load from edge-tx.'}</div>
          )}
          {card?.from && <p className="caption">Read from {card.from}.</p>}
        </details>
      ) : (
        <Panel
          label="Lua"
          note={
            edited !== null
              ? 'Edited here, kept in this browser. Its source is the TypeScript in edge-tx.'
              : 'As built in edge-tx: edit it to try a change.'
          }
          action={
            <span className="toolbar">
              {edited !== null && (
                <button
                  type="button"
                  className="button small ghost"
                  onClick={() => {
                    setDraft(null);
                    setEdited(null);
                    if (built) storeCode(built.file, null);
                  }}
                >
                  <RotateCcw size={14} /> Built one
                </button>
              )}
              <button type="button" className="button small" onClick={download} disabled={!code}>
                <Download size={14} /> main.lua
              </button>
            </span>
          }
        >
          <textarea
            className="input radio-code"
            value={draft ?? code}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Tab') return;
              event.preventDefault();
              const area = event.currentTarget;
              const {selectionStart, selectionEnd, value} = area;
              const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
              setDraft(next);
              requestAnimationFrame(() => area.setSelectionRange(selectionStart + 2, selectionStart + 2));
            }}
            aria-label="The widget's Lua"
          />
          <p className="caption">
            On the radio it goes in WIDGETS/{shown?.name ?? 'the widget'}/main.lua (its folder may have another name).
          </p>
        </Panel>
      )}

      {sounds.length > 0 && <p className="radio-sounds">Played: {sounds.join(' · ')}</p>}
    </div>
  );
}
