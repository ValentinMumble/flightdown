/**
 * The simulator's drills. Hover: hold the heli in a box over the pad, facing the way asked, as long as you can.
 * Landing: take off, then set it down on the pad as softly as you can. Each is fed every frame and says how it goes.
 */
import {Vector3} from 'three';

export type DrillKind = 'free' | 'hover' | 'landing';

/** Which way the heli faces the pilot in a hover. */
export type Facing = 'tail' | 'left' | 'right' | 'nose';

export const FACINGS: {value: Facing; label: string; heading: number}[] = [
  // The heading the nose points to, radians left of the field (0: nose away from the pilot).
  {value: 'tail', label: 'Tail-in', heading: 0},
  {value: 'left', label: 'Left side-in', heading: -Math.PI / 2},
  {value: 'right', label: 'Right side-in', heading: Math.PI / 2},
  {value: 'nose', label: 'Nose-in', heading: Math.PI},
];

/** The pad: 5 m in front of the pilot. */
export const PAD = new Vector3(0, 0, -5);
/** The hover box: 1.5 m over the pad, 1 m around and 0.75 m up or down, the nose within 30° of the way asked. */
export const HOVER_HEIGHT = 1.5;
const HOVER_RADIUS = 1;
const HOVER_DEPTH = 0.75;
const HOVER_HEADING = (30 * Math.PI) / 180;
/** Hold the box this long and the drill is done, s. */
export const HOVER_GOAL = 30;
/** A landing on the pad is within this of its centre, m. */
export const PAD_RADIUS = 1;
/** Climb this high before a landing counts, m. */
const CLIMB = 1;

export interface HoverDrill {
  kind: 'hover';
  facing: Facing;
  inside: boolean;
  /** Seconds in the box without leaving it, the most so far, and in all. */
  streak: number;
  best: number;
  total: number;
}

export type LandingGrade = 'Soft' | 'Firm' | 'Hard';

export interface Landing {
  speed: number;
  /** From the pad's centre, m. */
  distance: number;
  grade: LandingGrade;
  onPad: boolean;
}

export interface LandingDrill {
  kind: 'landing';
  /** Waiting to take off and climb, or for the landing. */
  phase: 'climb' | 'land';
  last: Landing | null;
  /** The softest on the pad so far. */
  best: Landing | null;
  count: number;
}

export type Drill = {kind: 'free'} | HoverDrill | LandingDrill;

export function startDrill(kind: DrillKind, facing: Facing = 'tail'): Drill {
  if (kind === 'hover') return {kind, facing, inside: false, streak: 0, best: 0, total: 0};
  if (kind === 'landing') return {kind, phase: 'climb', last: null, best: null, count: 0};
  return {kind};
}

const angleBetween = (left: number, right: number) =>
  Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));

export const gradeOf = (speed: number): LandingGrade => (speed < 0.3 ? 'Soft' : speed < 0.8 ? 'Firm' : 'Hard');

/** What the heli did this frame, for the drill. */
export interface Frame {
  dt: number;
  position: Vector3;
  heading: number;
  grounded: boolean;
  crashed: boolean;
  landed?: {speed: number; at: Vector3};
}

/** Moves the drill on by a frame. */
export function updateDrill(drill: Drill, frame: Frame): Drill {
  if (drill.kind === 'hover') {
    const facing = FACINGS.find(one => one.value === drill.facing)!;
    const across = Math.hypot(frame.position.x - PAD.x, frame.position.z - PAD.z);
    const inside =
      !frame.grounded &&
      !frame.crashed &&
      across <= HOVER_RADIUS &&
      Math.abs(frame.position.y - HOVER_HEIGHT) <= HOVER_DEPTH &&
      angleBetween(frame.heading, facing.heading) <= HOVER_HEADING;
    const streak = inside ? drill.streak + frame.dt : 0;
    return {
      ...drill,
      inside,
      streak,
      best: Math.max(drill.best, streak),
      total: drill.total + (inside ? frame.dt : 0),
    };
  }
  if (drill.kind === 'landing') {
    if (drill.phase === 'climb') {
      return !frame.grounded && !frame.crashed && frame.position.y >= CLIMB ? {...drill, phase: 'land'} : drill;
    }
    if (frame.crashed) return {...drill, phase: 'climb'};
    if (!frame.landed) return drill;
    const distance = Math.hypot(frame.landed.at.x - PAD.x, frame.landed.at.z - PAD.z);
    const landing: Landing = {
      speed: frame.landed.speed,
      distance,
      grade: gradeOf(frame.landed.speed),
      onPad: distance <= PAD_RADIUS,
    };
    const better = landing.onPad && (!drill.best || landing.speed < drill.best.speed);
    return {...drill, phase: 'climb', last: landing, best: better ? landing : drill.best, count: drill.count + 1};
  }
  return drill;
}
