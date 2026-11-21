/**
 * How tall the bar pinned at the top of the screen is (the cockpit bar on a wide screen, the top bar on a phone): a
 * row pinned under it sits this far down.
 */
export const topBarHeight = () =>
  Math.max(0, ...[...document.querySelectorAll<HTMLElement>('.cockpit-bar, .topbar')].map(bar => bar.offsetHeight));
