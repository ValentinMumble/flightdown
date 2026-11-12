import {useEffect, useState, type ReactNode} from 'react';
import {connected, type LogicChannel, type LogicItem, type LogicLine, type ModelLogicView} from '../radio/logic';

type Props = {
  view: ModelLogicView;
  /** Whether a switch is on now, as the radio names it ("L10", "SA0", "TX_BATTERY_LOW"). */
  isOn: (when: string) => boolean;
  /** Where a control is now, in a word or two: "up", "button 2", "40%". */
  where: (control: string) => string;
  /** How many ways a switch goes ("3-way", "spring"), shown as the switch tiles show it. */
  ways: (control: string) => string;
  /** A timer's value now, in seconds (below 0 past a countdown). */
  timer: (index: number) => number;
  /** A channel's output now in µs (from 1), when a replayed pack logged it. */
  output: (channel: number) => number | null;
};

const clock = (seconds: number) =>
  `${seconds < 0 ? '-' : ''}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.abs(seconds) % 60).padStart(2, '0')}`;

/**
 * A channel's lines as the radio applies them, in order: a replacing line (=) that is on wipes out those above it, an
 * added one (+) adds to what is there. What it is made of now, and the lines it is not using.
 */
function channelNow(channel: LogicChannel, isOn: (when: string) => boolean) {
  const active = channel.lines.map(line => !line.when || isOn(line.when));
  const last = channel.lines.reduce((found, line, index) => (line.how === '=' && active[index] ? index : found), -1);
  const now = channel.lines.filter((_line, index) => active[index] && index >= Math.max(0, last));
  return {now, rest: channel.lines.filter(line => !now.includes(line))};
}

/**
 * The model's logic, live, under the screen: the controls, the conditions they make, the channels, and what else comes
 * of them. What is on now stands out; the rest stays quiet, its detail shown when picked. Picking anything lights what
 * it reads and what reads it, and dims the rest.
 */
export function RadioLogic({view, isOn, where, ways, timer, output}: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [, setTick] = useState(0);
  // Delays, timers and a replay move on by themselves: a few times a second follows them.
  useEffect(() => {
    const interval = setInterval(() => setTick(tick => tick + 1), 250);
    return () => clearInterval(interval);
  }, []);

  const lit = picked ? connected(view, picked) : null;
  const tile = (
    item: LogicItem,
    {
      on = false,
      aside = '',
      tag = '',
      wayTag = '',
      hint = '',
      body,
    }: {on?: boolean; aside?: string; tag?: string; wayTag?: string; hint?: string; body?: ReactNode},
  ) => {
    const open = on || picked === item.id || !!lit?.has(item.id);
    return (
      <button
        key={item.id}
        type="button"
        title={hint || undefined}
        className={[
          'logic-item',
          on ? 'on' : 'idle',
          (item.unused || item.off) && 'unset',
          lit && (lit.has(item.id) ? 'lit' : 'dim'),
        ]
          .filter(Boolean)
          .join(' ')}
        aria-pressed={picked === item.id}
        onClick={() => setPicked(current => (current === item.id ? null : item.id))}
      >
        <span className="logic-head">
          <span className="logic-title">
            {item.title}
            {tag && <span className="logic-id">{tag}</span>}
            {wayTag && <span className="radio-switch-ways">{wayTag}</span>}
          </span>
          {aside && <span className="logic-aside">{aside}</span>}
        </span>
        {body}
        {item.detail && (open || item.unused || item.off) && <span className="logic-detail">{item.detail}</span>}
        {(item.radioWide || item.unused || item.off) && (
          <span className="logic-tags">
            {item.radioWide && <span className="logic-tag">radio</span>}
            {item.off && <span className="logic-tag">switched off</span>}
            {item.unused && <span className="logic-tag">not used</span>}
          </span>
        )}
      </button>
    );
  };

  const line = (one: LogicLine, index: number, added: boolean) => (
    <span key={index} className="logic-line">
      <span className="logic-text">
        {added && '+ '}
        {one.text}
      </span>
      <span className="logic-why">{one.label || 'always'}</span>
    </span>
  );

  const channel = (item: LogicChannel) => {
    const {now, rest} = channelNow(item, isOn);
    const value = output(item.channel);
    const open = picked === item.id || !!lit?.has(item.id);
    return tile(item, {
      on: now.length > 0,
      aside: value === null ? '' : `${value} µs`,
      body: (
        <>
          <span className="logic-now">{now.map((one, index) => line(one, index, index > 0 && one.how === '+'))}</span>
          {rest.length > 0 &&
            (open ? (
              <span className="logic-rest">
                {rest.map((one, index) => (
                  <span key={index} className="logic-line">
                    <span className="logic-text">
                      {one.how} {one.text}
                    </span>
                    <span className="logic-why">{one.label || 'always'}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="logic-more">
                {rest.length} other {rest.length === 1 ? 'line' : 'lines'}
              </span>
            ))}
        </>
      ),
    });
  };

  return (
    <section className="radio-logic" aria-label="The model's logic">
      <div className="logic-columns">
        <div>
          <h3>Controls</h3>
          {view.controls.map(item => tile(item, {aside: where(item.id), wayTag: ways(item.id), hint: item.detail}))}
        </div>
        <div>
          <h3>Conditions</h3>
          {view.conditions.map(item => tile(item, {on: isOn(item.id), tag: item.id}))}
        </div>
        <div>
          <h3>Channels</h3>
          {view.channels.map(channel)}
        </div>
        <div>
          <h3>Actions</h3>
          {view.actions.map(item => {
            const index = /^T(\d)$/.exec(item.id);
            return tile(item, {
              on: !item.off && !!item.when && isOn(item.when),
              aside: index ? clock(timer(Number(index[1]) - 1)) : '',
            });
          })}
        </div>
      </div>
      <p className="logic-legend">
        Lit: on now. A channel shows what it is made of now and why; pick it for its other lines. Pick anything to see
        what it reads and what reads it.
      </p>
    </section>
  );
}
