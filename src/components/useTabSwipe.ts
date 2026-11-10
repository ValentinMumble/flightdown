import {useEffect, useRef} from 'react';
import {flushSync} from 'react-dom';

/** How far a sideways swipe must go to change tab. */
const SWIPE = 60;
/** Near the screen's sides a swipe is Safari's own (back and forward). */
const SIDE_MARGIN = 24;
/** How far the finger moves before the swipe knows if it goes sideways (a tab) or down (a scroll). */
const SLOP = 10;
/** The page follows the finger half as far, and barely toward a side with no more tabs. */
const FOLLOW = 0.5;
const EDGE_FOLLOW = 0.15;
/** After a swipe the page leaves to the side, then the next one comes in from the other side. */
const LEAVE_MS = 100;
const ENTER_MS = 200;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Things that take a sideways drag themselves, besides fields and rows that scroll sideways. */
const OWN_DRAG = '.leaflet-container, .recharts-wrapper, .segmented, .damage-map, .chips.scroll, .timeline-scroll';

/** What slides with a swipe: the page, its title bar included. The dock stays put. */
const page = () => document.querySelector<HTMLElement>('.main > .page');

function follow(offset: number) {
  const part = page();
  if (!part) return;
  part.style.transform = `translateX(${offset}px)`;
  part.style.opacity = String(Math.max(0.5, 1 - Math.abs(offset) / 300));
}

/** Puts the page back in place, smoothly from wherever the finger left it. */
function settle() {
  const part = page();
  if (!part) return;
  const from = {transform: part.style.transform || 'none', opacity: part.style.opacity || '1'};
  part.style.transform = '';
  part.style.opacity = '';
  part.animate([from, {transform: 'none', opacity: 1}], {duration: 180, easing: EASE_OUT});
}

/** Slides the page out toward `step` (1: the next tab, to the left), changes tab, and slides the new page in. */
async function slide(step: number, change: () => void) {
  const distance = window.innerWidth * 0.3;
  const leaving = page();
  await leaving?.animate([{transform: `translateX(${-step * distance}px)`, opacity: 0}], {
    duration: LEAVE_MS,
    easing: 'ease-in',
    fill: 'forwards',
  }).finished;
  flushSync(change);
  for (const animation of leaving?.getAnimations() ?? []) animation.cancel();
  if (leaving) {
    leaving.style.transform = '';
    leaving.style.opacity = '';
  }
  page()?.animate(
    [
      {transform: `translateX(${step * distance}px)`, opacity: 0},
      {transform: 'none', opacity: 1},
    ],
    {duration: ENTER_MS, easing: EASE_OUT},
  );
}

/** True when a touch starts on something that takes a sideways drag itself: a field, a map, a chart, a row that scrolls. */
function takesSidewaysDrag(target: Element) {
  if (target.closest(`input, textarea, select, ${OWN_DRAG}`)) return true;
  for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
    const {overflowX} = getComputedStyle(node);
    if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}

/**
 * On a phone, a sideways swipe on a tab's page moves to the next tab (to the left) or the one before (to the right),
 * as in Tillroll and the liquid glass guideline: the page follows the finger at half speed, then slides out as the
 * next one slides in, while the dock stays put and its lens slides along. With Reduce motion it just changes tab. Not
 * from the screen's sides, a field, a map, a chart or a row that scrolls sideways, nor with a sheet open.
 */
export function useTabSwipe(count: number, index: number, go: (index: number) => void) {
  // The latest tab and move, so the listeners added once always use them.
  const latest = useRef({index, go});
  useEffect(() => {
    latest.current = {index, go};
  });

  useEffect(() => {
    let start: {left: number; top: number} | null = null;
    let dragging = false;
    let still = false;
    let sliding = false;

    const neighbour = (across: number) => {
      const next = latest.current.index + (across < 0 ? 1 : -1);
      return latest.current.index >= 0 && next >= 0 && next < count ? next : undefined;
    };

    function onStart(event: TouchEvent) {
      start = null;
      dragging = false;
      const target = event.target;
      if (sliding || event.touches.length !== 1 || !(target instanceof Element) || !target.closest('.main')) return;
      if (latest.current.index < 0 || document.querySelector('.sheet-backdrop')) return;
      if (!window.matchMedia('(max-width: 860px)').matches) return;
      const {clientX, clientY} = event.touches[0];
      if (clientX < SIDE_MARGIN || clientX > window.innerWidth - SIDE_MARGIN || takesSidewaysDrag(target)) return;
      start = {left: clientX, top: clientY};
      still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function onMove(event: TouchEvent) {
      if (!start) return;
      const across = event.touches[0].clientX - start.left;
      const down = event.touches[0].clientY - start.top;
      if (!dragging) {
        if (Math.abs(across) < SLOP && Math.abs(down) < SLOP) return;
        // A scroll down the page that drifts a little never changes tab.
        if (Math.abs(across) <= Math.abs(down)) {
          start = null;
          return;
        }
        dragging = true;
      }
      if (event.cancelable) event.preventDefault();
      if (!still) follow(across * (neighbour(across) === undefined ? EDGE_FOLLOW : FOLLOW));
    }

    async function onEnd(event: TouchEvent) {
      if (!start || !dragging) {
        start = null;
        return;
      }
      const across = event.changedTouches[0].clientX - start.left;
      start = null;
      dragging = false;
      const next = Math.abs(across) >= SWIPE ? neighbour(across) : undefined;
      if (next === undefined) {
        if (!still) settle();
        return;
      }
      if (still) {
        latest.current.go(next);
        return;
      }
      sliding = true;
      try {
        await slide(across < 0 ? 1 : -1, () => latest.current.go(next));
      } finally {
        sliding = false;
      }
    }

    function onCancel() {
      if (dragging && !still) settle();
      start = null;
      dragging = false;
    }

    window.addEventListener('touchstart', onStart, {passive: true});
    // Not passive: once a swipe goes sideways, it stops the page from scrolling.
    window.addEventListener('touchmove', onMove, {passive: false});
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onCancel);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, [count]);
}
