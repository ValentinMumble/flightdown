/**
 * Turns the low-poly Huey (assets/huey/Huey2.0.fbx, by Sami, CC BY 4.0: see assets/huey/CREDIT.md) into the damage
 * map's 3D heli, src/components/charts/huey.json: `npx tsx scripts/huey.ts`.
 *
 * Each damage zone gets its triangles, as a flat list of corners (x, y, z, three a triangle), in the 3D view's frame:
 * millimetres-ish (the heli about 440 long, as the M2 EVO's drawing was), the nose toward -x, up +y, the mast at x 0.
 * The rotors, the mast and the skids are pieces of their own in the model; the body is one, cut across: the cabin
 * front is the canopy, its back and the engine deck the frame (each seam straight, the triangles crossing it cut on
 * it), then the boom, and its end (the fin) with the tail rotor and the stabiliser. A large flat main motor is added
 * inside, centred under the mast, a zone of its own. The weapons and name plates are left out. A Huey shows no servos.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js';
import type {Zone} from '../src/model/debrief';

// The loader asks the page for an <img> per texture; none is wanted here, so it gets one that never loads.
Object.assign(globalThis, {
  self: globalThis,
  document: {createElementNS: () => ({addEventListener() {}, removeEventListener() {}, src: ''})},
});

const SOURCE = 'assets/huey/Huey2.0.fbx';
const TARGET = 'src/components/charts/huey.json';
/** From the model's units (its length about 18) to the view's. */
const SCALE = 24;
/** Where the mast stands along the model, and the height its rotor plane and skids are centred on. */
const MAST = -0.4;
const MIDDLE = 2.8;

/** The model's pieces by name, and the zone each goes to; the body is cut by `bodyZone`. */
const PIECES: Record<string, Zone> = {
  Blade: 'blades',
  Blade_2: 'blades',
  Rotor: 'head',
  Rotor_Guide: 'shaft',
  Skies: 'skids',
  Rear_Rotor: 'tail',
  Rear_Blade: 'tail',
  Rear_Blade_2: 'tail',
  rater: 'tail',
};

/**
 * Where the body is cut, in the model's frame (z along it, the nose at +z): the canopy ahead of the first cut, the
 * frame up to the second; the triangles crossing a cut are cut on it, so each seam is one straight line across.
 */
const CANOPY_BACK = 0;
const FRAME_BACK = -4.5;

/** A body triangle's zone behind the frame, from its middle: the boom, else its end and the fin (the tail). */
const rearZone = (middle: THREE.Vector3): Zone => (middle.z >= -9.6 && middle.y < 3.6 ? 'boom' : 'tail');

/**
 * A triangle cut by the plane z = `at`: the triangles ahead of it (z above) and behind it. One that does not cross it
 * comes back whole on its side; one that does, as the polygon on each side, fanned into triangles.
 */
function cut(triangle: THREE.Vector3[], at: number): {ahead: THREE.Vector3[][]; behind: THREE.Vector3[][]} {
  const ahead: THREE.Vector3[] = [];
  const behind: THREE.Vector3[] = [];
  triangle.forEach((point, index) => {
    const next = triangle[(index + 1) % 3];
    (point.z >= at ? ahead : behind).push(point);
    // An edge crossing the plane adds the point it crosses at to both sides.
    if (point.z >= at !== next.z >= at) {
      const crossing = point.clone().lerp(next, (at - point.z) / (next.z - point.z));
      ahead.push(crossing);
      behind.push(crossing.clone());
    }
  });
  const fan = (polygon: THREE.Vector3[]) =>
    polygon.length < 3 ? [] : polygon.slice(1, -1).map((point, index) => [polygon[0], point, polygon[index + 2]]);
  return {ahead: fan(ahead), behind: fan(behind)};
}

/** A body triangle as its pieces in each zone. */
function bodyPieces(triangle: THREE.Vector3[]): [Zone, THREE.Vector3[]][] {
  const front = cut(triangle, CANOPY_BACK);
  const pieces: [Zone, THREE.Vector3[]][] = front.ahead.map(piece => ['canopy', piece]);
  for (const rest of front.behind) {
    const middle = cut(rest, FRAME_BACK);
    pieces.push(...middle.ahead.map((piece): [Zone, THREE.Vector3[]] => ['frame', piece]));
    for (const piece of middle.behind) {
      pieces.push([rearZone(piece.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(3)), piece]);
    }
  }
  return pieces;
}

const data = readFileSync(SOURCE);
const scene = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
scene.updateMatrixWorld(true);

const zones: Partial<Record<Zone, number[]>> = {};
const corner = new THREE.Vector3();
const round = (value: number) => Math.round(value * 10) / 10;
scene.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const isBody = object.name === 'Body';
  const zone = PIECES[object.name];
  if (!isBody && !zone) return;
  const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
  const position = geometry.attributes.position;
  for (let first = 0; first + 2 < position.count; first += 3) {
    const corners = [0, 1, 2].map(step =>
      corner
        .fromBufferAttribute(position, first + step)
        .applyMatrix4(object.matrixWorld)
        .clone(),
    );
    for (const [target, piece] of isBody ? bodyPieces(corners) : [[zone, corners] as [Zone, THREE.Vector3[]]]) {
      const list = (zones[target] ??= []);
      for (const point of piece) {
        list.push(round(-(point.z - MAST) * SCALE), round((point.y - MIDDLE) * SCALE), round(point.x * SCALE));
      }
    }
  }
});

// The main motor, which the Huey's body hides: a large flat can inside the cabin roof, centred under the mast and just
// below it, a zone of its own. Twelve sides, so its side lines show between its rims. In the view's frame already.
const MOTOR = {radius: 26, height: 10};
const mast = zones.shaft ?? [];
const mastX = mast.filter((_, index) => index % 3 === 0);
const mastY = mast.filter((_, index) => index % 3 === 1);
const mastZ = mast.filter((_, index) => index % 3 === 2);
const middleOf = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
const motor = new THREE.CylinderGeometry(MOTOR.radius, MOTOR.radius, MOTOR.height, 12)
  .toNonIndexed()
  .translate(middleOf(mastX), Math.min(...mastY) - MOTOR.height / 2 - 1, middleOf(mastZ));
const motorCorners = motor.attributes.position;
for (let index = 0; index < motorCorners.count; index++) {
  (zones.motor ??= []).push(
    round(motorCorners.getX(index)),
    round(motorCorners.getY(index)),
    round(motorCorners.getZ(index)),
  );
}

writeFileSync(
  TARGET,
  JSON.stringify({credit: 'Huey model by Sami, CC BY 4.0', link: 'https://samifd3f122.itch.io/helicopter', zones}) +
    '\n',
);
for (const [zone, list] of Object.entries(zones)) console.log(zone.padEnd(7), `${list.length / 9} triangles`);
