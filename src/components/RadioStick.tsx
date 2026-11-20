import {type KeyboardEvent, type PointerEvent, useRef} from 'react';

/** One way a stick moves: its source ("Ail"), the radio's value (-1024 to 1024), and whether it springs back. */
export interface StickAxis {
  name: string;
  value: number;
  springs: boolean;
}

/** What an arrow key moves a stick by (the radio reads -1024 to 1024). */
const PER_KEY = 128;

const clamp = (value: number) => Math.max(-1024, Math.min(1024, Math.round(value)));
const percent = (value: number) => {
  const shown = Math.round(value / 10.24);
  return `${shown > 0 ? '+' : ''}${shown}%`;
};

/**
 * One of the radio's sticks, a gimbal seen from the front: its head where the two axes put it (right and up are
 * positive), dragged anywhere in its square or moved with the arrow keys; on release the axes that spring back on the
 * radio (all but the throttle) go back to the middle.
 */
export function RadioStick({
  label,
  across,
  up,
  onChange,
}: {
  label: string;
  across: StickAxis;
  up: StickAxis;
  onChange: (name: string, value: number) => void;
}) {
  const held = useRef(false);
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onChange(across.name, clamp(((event.clientX - box.left) / box.width) * 2048 - 1024));
    onChange(up.name, clamp(1024 - ((event.clientY - box.top) / box.height) * 2048));
  };
  const release = () => {
    if (!held.current) return;
    held.current = false;
    if (across.springs) onChange(across.name, 0);
    if (up.springs) onChange(up.name, 0);
  };
  const keys: Record<string, [StickAxis, number]> = {
    ArrowRight: [across, PER_KEY],
    ArrowLeft: [across, -PER_KEY],
    ArrowUp: [up, PER_KEY],
    ArrowDown: [up, -PER_KEY],
  };

  return (
    <div className="radio-stick">
      <div
        className="radio-stick-gimbal"
        role="group"
        tabIndex={0}
        aria-label={`${label}: ${across.name} ${percent(across.value)}, ${up.name} ${percent(up.value)}`}
        title={`${label}: drag the stick, or use the arrow keys`}
        style={{
          ['--across' as string]: `${(across.value / 1024 + 1) * 50}%`,
          ['--up' as string]: `${(1 - up.value / 1024) * 50}%`,
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          held.current = true;
          moveTo(event);
        }}
        onPointerMove={event => held.current && moveTo(event)}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const move = keys[event.key];
          if (!move) return;
          event.preventDefault();
          onChange(move[0].name, clamp(move[0].value + move[1]));
        }}
      >
        <span className="radio-stick-head" />
      </div>
      <span className="radio-stick-label">
        {across.name} {percent(across.value)} · {up.name} {percent(up.value)}
      </span>
    </div>
  );
}
