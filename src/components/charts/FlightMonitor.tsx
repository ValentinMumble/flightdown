import type {Caution, Exceedance, ExceedanceKind} from '../../model/cockpit';
import {formatTimer} from '../../model/format';

/** The events' marks and names, by kind. */
const KINDS: Record<ExceedanceKind, {label: string; tone: 'caution' | 'warning'}> = {
  current: {label: 'Over current', tone: 'caution'},
  cell: {label: 'Low cell', tone: 'warning'},
  link: {label: 'Link', tone: 'caution'},
  deep: {label: 'Deep', tone: 'caution'},
  strike: {label: 'Strike', tone: 'warning'},
};

/**
 * A pack's log as a cockpit's caution and warning panel: a light for each thing worth a look, dark when all is well,
 * green for an advisory, amber for a caution, red for a warning. Why each lit light is lit is said under the panel.
 */
export function CautionPanel({lights}: {lights: Caution[]}) {
  const lit = lights.filter(light => light.level !== 'off');
  return (
    <div className="caution-panel">
      <div className="caution-lights" role="list" aria-label="Caution panel">
        {lights.map(light => (
          <span
            key={light.key}
            role="listitem"
            className={`caution-light ${light.level}`}
            title={light.why}
            aria-label={`${light.label}: ${light.level === 'off' ? 'off' : light.level}, ${light.why}`}
          >
            {light.label}
          </span>
        ))}
      </div>
      {lit.length > 0 && (
        <ul className="caution-why">
          {lit.map(light => (
            <li key={light.key} className={light.level}>
              <b>{light.label}</b> {light.why}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The events as marks along the recorder's time axis (inside the lanes' plot: from the end of the 34px scale to 6px
 * from the right), between `first` and `last`, the span shown.
 */
export function EventStrip({events, first, last}: {events: Exceedance[]; first: number; last: number}) {
  const shown = events.filter(event => event.end >= first && event.start <= last && last > first);
  if (!shown.length) return null;
  const at = (second: number) => Math.min(1, Math.max(0, (second - first) / (last - first)));
  return (
    <div className="event-strip" aria-hidden>
      {shown.map(event => (
        <span
          key={`${event.kind}-${event.start}`}
          className={`event-mark ${KINDS[event.kind].tone}`}
          title={`${formatTimer(event.start)} ${KINDS[event.kind].label}: ${event.text}`}
          style={{
            left: `calc(34px + (100% - 40px) * ${at(event.start)})`,
            width: `max(4px, calc((100% - 40px) * ${at(event.end) - at(event.start)}))`,
          }}
        />
      ))}
    </div>
  );
}

/** The events as a list, as flight data monitoring reports them: when, what, how bad, how often close together. */
export function EventList({events}: {events: Exceedance[]}) {
  if (!events.length) return null;
  return (
    <div className="event-list">
      <div className="panel-label">Events</div>
      {events.map(event => (
        <div key={`${event.kind}-${event.start}`} className="event-row">
          <span className="tabular">{formatTimer(event.start)}</span>
          <span className={`event-kind ${KINDS[event.kind].tone}`}>{KINDS[event.kind].label}</span>
          <span>
            {event.text}
            {event.times > 1 && <span className="muted"> · {event.times} times</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
