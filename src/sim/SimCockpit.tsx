import {useEffect, useRef, useState} from 'react';
import {Radio, SCREEN, startLua, type RadioInputs} from '../radio/edgetx';
import {ModelTimers} from '../radio/timers';
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
import {radioFile} from '../radio/widgets';
import type {CardModel} from '../radio/card';
import {simSource, type SimFeed} from './radioFeed';
import {readCard} from './card';
import {isLowered, RATES} from './input';

const message = (error: unknown) => String((error as Error)?.message ?? error);

/**
 * The TX16S's screen in the sim: the model's first screen, as the radio draws it (the top bar and the Cockpit, its own
 * Lua from the edge-tx card), reading the sim's flight from `feed` 20 times a second, as the radio refreshes its
 * widgets. `model` is the model's name on the radio (M2 EVO, K110S).
 */
export default function SimCockpit({model: name, feed}: {model: string; feed: {current: SimFeed}}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let stopped = false;
    let timer = 0;
    let model: CardModel | null = null;
    let timers: ModelTimers | null = null;
    const read = (asked: string) => simSource(asked, feed.current, model);
    const inputs: RadioInputs = {
      value: read,
      timer: index => {
        if (!timers) return {value: 0, start: 0};
        timers.advance(performance.now() / 1000, () => read);
        return {value: timers.value(index), start: timers.start(index)};
      },
      model: {name: '', bitmap: ''},
    };
    const radio = new Radio(element, inputs);

    const setUp = async () => {
      const [runner, {card}] = await Promise.all([startLua(radio), readCard()]);
      if (stopped) return;
      model = card?.models.find(one => one.name === name) ?? null;
      if (!card || !model) {
        setProblem(`The radio's card has no ${name} model.`);
        return;
      }
      const shown = model;
      const lines = shown.inputs ?? [];
      timers = new ModelTimers(shown, null);
      inputs.model = {
        name: shown.name,
        bitmap: shown.bitmap,
        globals: shown.globals,
        reversed: shown.reversed,
        curves: (shown.curves ?? []).map((curve, index) => curve && {...curve, name: shown.curveNames?.[index] ?? ''}),
        // The practice lines (Prac) follow the sim's own rates, a game controller's or the keyboard's, as they would on
        // the radio: the cyclic's share on the aileron and elevator inputs, the rudder's on the rudder one.
        get inputs() {
          const rates = RATES.find(one => one.label === feed.current.controls.rates);
          if (!rates || !isLowered(rates.label)) return lines;
          return lines.map(line =>
            line.name === 'Prac'
              ? {...line, weight: Math.round(100 * (line.input === 3 ? rates.rudder : rates.cyclic))}
              : line,
          );
        },
      };
      try {
        const image = new Image();
        image.src = radioFile(`IMAGES/${shown.bitmap}`);
        await image.decode();
        radio.images.set(shown.bitmap, await createImageBitmap(image));
      } catch {
        // No picture: the widget gets nil, as on a radio without the file.
      }
      const placed: Placed[] = [];
      for (const {rect, zone: slot, id} of placeScreen(shown, 0)) {
        const base = {id, widget: slot.widget, rect, options: slot.options};
        if (isBuiltin(slot.widget)) {
          placed.push({...base, kind: 'builtin'});
          continue;
        }
        const loading = loadCardWidget(card, slot.widget, runner, radio);
        if (!loading) {
          placed.push({...base, kind: 'missing', problem: 'Not on the card'});
          continue;
        }
        try {
          const widget = await loading;
          runner.create(id, widget.key, rect.w, rect.h, optionLines(radio, widget.options, slot.options));
          placed.push({...base, kind: 'lua', key: widget.key});
        } catch (error) {
          placed.push({...base, kind: 'missing', problem: message(error)});
        }
      }
      if (stopped) return;
      const chrome = shown.screens[0]?.options ?? null;
      timer = window.setInterval(() => {
        drawChrome(radio.context, chrome);
        for (const item of placed) {
          radio.zone = {...item.rect};
          if (item.kind === 'lua' && !item.problem) {
            try {
              runner.refresh(item.id);
            } catch (error) {
              item.problem = message(error);
            }
          } else if (item.kind === 'builtin') drawBuiltin(radio, item, inputs.model);
          if (item.kind === 'missing' || item.problem) drawMissing(radio, item);
        }
      }, 50);
    };
    setUp().catch(error => !stopped && setProblem(`The radio did not start: ${message(error)}`));
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [name, feed]);

  return (
    <div className="sim-radio">
      <canvas ref={canvas} width={SCREEN.width} height={SCREEN.height} aria-label="The radio's screen" />
      {problem && <span className="sim-radio-problem">{problem}</span>}
    </div>
  );
}
