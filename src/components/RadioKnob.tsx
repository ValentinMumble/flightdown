import {type KeyboardEvent, type PointerEvent, useEffect, useRef} from 'react';

/** How far the pointer turns at either end, from straight up: about three quarters of a turn in all, as on the TX16S. */
const SWEEP = 135;
/** Around its middle the knob sits in its detent: S1 and S2 click into it on the radio. */
const DETENT = 24;
/** What a pixel dragged, a wheel notch and an arrow key turn it by (the radio reads -1024 to 1024). */
const PER_PIXEL = 12;
const PER_NOTCH = 64;
const PER_KEY = 64;

const settle = (value: number) => (Math.abs(value) <= DETENT ? 0 : Math.max(-1024, Math.min(1024, Math.round(value))));

/**
 * One of the radio's knobs (S1, S2): drag it up or right to turn it right, scroll on it or use the arrow keys, and a
 * double-click (or 0) puts it back in its middle detent. Its value as the radio reads it, -1024 to 1024, and its % under
 * it.
 */
export function RadioKnob({name, value, onChange}: {name: string; value: number; onChange: (value: number) => void}) {
  const dial = useRef<HTMLDivElement>(null);
  const drag = useRef<{x: number; y: number; value: number} | null>(null);
  const current = useRef(value);
  current.current = value;
  const percent = Math.round(value / 10.24);
  const shown = `${percent > 0 ? '+' : ''}${percent}%`;

  // Scrolling on the knob turns it rather than the page: a listener React cannot make, one that may stop the scroll.
  useEffect(() => {
    const element = dial.current;
    if (!element) return;
    const turn = (event: WheelEvent) => {
      event.preventDefault();
      onChange(settle(current.current - Math.sign(event.deltaY) * PER_NOTCH));
    };
    element.addEventListener('wheel', turn, {passive: false});
    return () => element.removeEventListener('wheel', turn);
  }, [onChange]);

  const keys: Record<string, (now: number) => number> = {
    ArrowRight: now => now + PER_KEY,
    ArrowUp: now => now + PER_KEY,
    ArrowLeft: now => now - PER_KEY,
    ArrowDown: now => now - PER_KEY,
    PageUp: now => now + 4 * PER_KEY,
    PageDown: now => now - 4 * PER_KEY,
    Home: () => -1024,
    End: () => 1024,
    '0': () => 0,
  };

  return (
    <div className="radio-knob">
      <div
        ref={dial}
        className="radio-knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={`${name} knob`}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={shown}
        title={`${name}: drag or scroll to turn it, double-click for the middle`}
        style={{['--turn' as string]: `${(value / 1024) * SWEEP}deg`}}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {x: event.clientX, y: event.clientY, value};
        }}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          const start = drag.current;
          if (!start) return;
          onChange(settle(start.value + (event.clientX - start.x - (event.clientY - start.y)) * PER_PIXEL));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onChange(0)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const move = keys[event.key];
          if (!move) return;
          event.preventDefault();
          onChange(settle(move(value)));
        }}
      />
      <span className="radio-knob-label">
        {name} {shown}
      </span>
    </div>
  );
}
